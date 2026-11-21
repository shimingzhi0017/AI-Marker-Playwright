import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelJson, repairInvalidJsonEscapes, recoverCorruptedLatexControls } from '../src/model-json.mjs';
import { parseResult, promptFor } from '../src/domain.mjs';
import { generateRubric } from '../src/rubric-generator.mjs';
import { rubricPolicy, rubricSubjects, solutionGradingPolicy } from '../ui/rubric-prompts.js';
import { subjectReviewRules } from '../ui/subject-review-rules.js';

const CONFLICTING_PROCESS_PHRASES = [
  /解答题有效解法与合并步骤规则/,
  /解答题错算与错误延续规则/,
  /物理解答题方程与结果赋分规则/,
  /数学解答题关键过程赋分规则/,
  /宽松和正常口径的满分判断先于逐点扣分/,
  /宽松模式下的解答题/,
  /正常模式下的解答题/,
  /严格模式下的解答题/
];

test('answers mode removes conflicting process-grading policies across all 9 subjects and 3 strictnesses', async () => {
  for (const subject of Object.keys(rubricSubjects)) {
    for (const strictness of ['lenient', 'normal', 'strict']) {
      const answersPolicy = rubricPolicy({ subject, strictness, scoringMethod: 'answers' });
      const pointsPolicy = rubricPolicy({ subject, strictness, scoringMethod: 'points' });
      assert.ok(answersPolicy.length < pointsPolicy.length, `${subject}/${strictness}: expected answers < points`);
      assert.match(answersPolicy, /按答案逐项给分规则/);
      assert.match(answersPolicy, /客观选择、填空不套用解答题过程要求/);
      assert.ok(answersPolicy.includes(subjectReviewRules[subject][0]), `${subject}/${strictness} missing subject rule`);

      let requested = '';
      const generated = await generateRubric(
        { providers: { p: {} } },
        {
          version: 2,
          provider: 'p',
          model: 'fixture',
          subject,
          strictness,
          scoringMethod: 'answers',
          question: '填空题',
          answer: '42',
          maxScore: 4,
          roundStep: 1
        },
        async (_provider, _model, prompt) => {
          requested = prompt;
          return JSON.stringify({
            question: '填空题',
            answer: '42',
            items: [{ label: '第1空', maxScore: 4, criteria: '填42得4分，其余0分。' }],
            warnings: []
          });
        }
      );

      const gradingPrompt = promptFor({ answer: '42', rubric: generated.rubric, scoring: { maxScore: 4, units: [] } });
      const shared = solutionGradingPolicy({ subject, strictness, scoringMethod: 'answers' });
      assert.equal(gradingPrompt.split(shared).length - 1, 1, `${subject}/${strictness} shared policy duplicated`);

      for (const text of [answersPolicy, requested, generated.rubric, gradingPrompt]) {
        for (const pattern of CONFLICTING_PROCESS_PHRASES) {
          assert.doesNotMatch(text, pattern, `${subject}/${strictness} unexpectedly matched ${pattern}`);
        }
      }
    }
  }
});

test('holistic mode removes conflicting calculation policies across all 9 subjects and 3 strictnesses', async () => {
  for (const subject of Object.keys(rubricSubjects)) {
    for (const strictness of ['lenient', 'normal', 'strict']) {
      const holisticPolicy = rubricPolicy({ subject, strictness, scoringMethod: 'holistic' });
      const pointsPolicy = rubricPolicy({ subject, strictness, scoringMethod: 'points' });
      assert.ok(holisticPolicy.length < pointsPolicy.length, `${subject}/${strictness}: expected holistic < points`);
      assert.match(holisticPolicy, /按等级综合评价规则/);
      assert.match(holisticPolicy, /客观选择、填空不套用解答题过程要求/);
      assert.match(holisticPolicy, /写作、开放论述按题型评价/);
      assert.ok(holisticPolicy.includes(subjectReviewRules[subject][0]), `${subject}/${strictness} missing subject rule`);

      let requested = '';
      const generated = await generateRubric(
        { providers: { p: {} } },
        {
          version: 2,
          provider: 'p',
          model: 'fixture',
          subject,
          strictness,
          scoringMethod: 'holistic',
          question: '综合论述题',
          answer: '参考立意与论证要点',
          maxScore: 10,
          roundStep: 1
        },
        async (_provider, _model, prompt) => {
          requested = prompt;
          return JSON.stringify({
            question: '综合论述题',
            answer: '参考立意与论证要点',
            items: [{ label: '综合评价', maxScore: 10, criteria: '按内容、结构、论证、表达分档给分。' }],
            warnings: []
          });
        }
      );

      const gradingPrompt = promptFor({ answer: '参考立意', rubric: generated.rubric, scoring: { maxScore: 10, units: [] } });
      const shared = solutionGradingPolicy({ subject, strictness, scoringMethod: 'holistic' });
      assert.equal(gradingPrompt.split(shared).length - 1, 1, `${subject}/${strictness} holistic shared policy duplicated`);
      assert.match(gradingPrompt, /本次给分方式：按等级综合评价/);

      for (const text of [holisticPolicy, requested, generated.rubric, gradingPrompt]) {
        for (const pattern of CONFLICTING_PROCESS_PHRASES) {
          assert.doesNotMatch(text, pattern, `${subject}/${strictness}/holistic unexpectedly matched ${pattern}`);
        }
      }
    }
  }
});

test('prompt sizes remain within deduplicated length budgets across all 9 subjects', async () => {
  for (const subject of Object.keys(rubricSubjects)) {
    for (const scoringMethod of ['auto', 'answers', 'holistic']) {
      let genLen = 0;
      const generated = await generateRubric(
        { providers: { p: {} } },
        {
          version: 2,
          provider: 'p',
          model: 'fixture',
          subject,
          strictness: 'lenient',
          scoringMethod,
          question: '测试题',
          answer: '参考答案',
          maxScore: 4,
          roundStep: 1
        },
        async (_provider, _model, prompt) => {
          genLen = prompt.length;
          return JSON.stringify({
            question: '测试题',
            answer: '参考答案',
            items: [{ label: '第（1）问', maxScore: 4, criteria: '标准条款。' }],
            warnings: []
          });
        }
      );
      const gradeLen = promptFor({ answer: '参考答案', rubric: generated.rubric, scoring: { maxScore: 4, units: [] } }).length;
      const maxGen = scoringMethod === 'answers'
        ? (subject === 'physics' ? 5500 : 5000)
        : scoringMethod === 'holistic'
          ? 5000
          : subject === 'physics' ? 7200 : subject === 'mathematics' ? 6500 : 5500;
      const maxGrade = scoringMethod === 'answers'
        ? (subject === 'physics' ? 5000 : 4500)
        : scoringMethod === 'holistic'
          ? 4500
          : subject === 'physics' ? 6500 : subject === 'mathematics' ? 5800 : 4900;
      assert.ok(genLen <= maxGen, `${subject}/${scoringMethod} genLen=${genLen} > ${maxGen}`);
      assert.ok(gradeLen <= maxGrade, `${subject}/${scoringMethod} gradeLen=${gradeLen} > ${maxGrade}`);
    }
  }
});

test('promptFor structures prompt into clear sections and removes strict bias phrase across modes', () => {
  for (const strictness of ['lenient', 'normal', 'strict']) {
    const prompt = promptFor({
      answer: '8m/s',
      rubric: '第（1）问：满分4分\n按标准评分。\n学科：物理。',
      scoring: { strictness, maxScore: 4, units: [] }
    });
    assert.match(prompt, /===== 评分策略与步长 =====/);
    assert.match(prompt, /===== 网页评分框与勤勉度 =====/);
    assert.match(prompt, /===== 书写识别要求 =====/);
    assert.match(prompt, /===== 规则疑点要求 =====/);
    assert.match(prompt, /===== 评分项清单与输出要求 =====/);
    assert.match(prompt, /按本次指定口径与已保存评分标准客观评分/);
    assert.doesNotMatch(prompt, /严格按照评分标准评分/);
    assert.match(prompt, new RegExp(`本次实际阅卷口径[：:].*[（(]${strictness}[）)]`));
  }
});

test('parseModelJson extracts JSON wrapped in think blocks, prose and code fences', () => {
  const payload = [
    '让我先思考一下示例格式：',
    '<think>',
    '参考示例：{"score": 0, "note": "inside think"}',
    '</think>',
    '以下是最终评分结果：',
    '```json',
    '{"score": 4, "studentAnswer": "x=2", "comment": "完整正确"}',
    '```',
    '请查收。'
  ].join('\n');
  const parsed = parseModelJson(payload, { requiredKeys: ['score'] });
  assert.equal(parsed.score, 4);
  assert.equal(parsed.studentAnswer, 'x=2');
  assert.equal(parsed.comment, '完整正确');

  const fallbackThink = '<think>{"question":"q","answer":"a","rubric":"r"}</think>';
  assert.equal(parseModelJson(fallbackThink, { requiredKeys: ['question', 'answer', 'rubric'] }).rubric, 'r');
});

test('parseModelJson and parseResult repair unescaped LaTeX and recover control-char commands without breaking valid escapes', () => {
  // 1. Invalid JSON escapes (\sqrt, \cdot, \alpha, \le, \{, \}) mixed with single-escaped \frac/\times and valid \n & \\frac
  const mixedRaw = '{"score":4,"studentAnswer":"$\\\\frac{1}{2} + \\sqrt{2} \\cdot \\alpha \\le \\{1\\}$","comment":"第一行\\n第二行：$\\frac{3}{4} \\times 2$","subScores":[]}';
  const cfg = { answer: 'a', rubric: 'r', scoring: { maxScore: 4, units: [] } };
  const parsedMixed = parseResult(mixedRaw, cfg);
  assert.equal(parsedMixed.score, 4);
  assert.equal(parsedMixed.studentAnswer, '$\\frac{1}{2} + \\sqrt{2} \\cdot \\alpha \\le \\{1\\}$');
  assert.equal(parsedMixed.comment, '第一行\n第二行：$\\frac{3}{4} \\times 2$');

  // 2. Valid JSON syntax where single-escaped \f, \t, \b, \r got parsed into control chars by JSON.parse
  const controlRaw = '{"score":3,"studentAnswer":"ok","comment":"\\frac{1}{2}, \\times, \\text{m/s}, \\theta, \\beta, \\begin{a}, \\boxed{2}, \\right), \\rho\\t对齐\\total","subScores":[]}';
  const parsedControls = parseResult(controlRaw, cfg);
  assert.equal(parsedControls.score, 3);
  assert.equal(
    parsedControls.comment,
    '\\frac{1}{2}, \\times, \\text{m/s}, \\theta, \\beta, \\begin{a}, \\boxed{2}, \\right), \\rho\t对齐\total'
  );

  // 3. Properly double-escaped JSON remains intact
  const alreadyValid = '{"score":2,"comment":"$\\frac{1}{2}$\\n\\t换行制表","subScores":[]}';
  const parsedValid = parseResult(alreadyValid, cfg);
  assert.equal(parsedValid.comment, '$\\frac{1}{2}$\n\t换行制表');
  assert.equal(repairInvalidJsonEscapes('{"a":"\\\\frac{1}{2}\\n"}'), '{"a":"\\\\frac{1}{2}\\n"}');
  assert.equal(recoverCorruptedLatexControls('plain\ttext'), 'plain\ttext');

  // 4. Non-JSON text still preserves original parseResult error contract
  assert.throws(() => parseResult('not json', cfg), /模型没有返回完整JSON评分结果/);
  assert.throws(() => parseResult('{"x":1}', cfg), /总分无效/);
});

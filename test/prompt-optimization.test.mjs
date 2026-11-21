import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelJson, repairInvalidJsonEscapes, recoverCorruptedLatexControls } from '../src/model-json.mjs';
import { parseResult, promptFor } from '../src/domain.mjs';
import { generateRubric, lintGeneratedRubric } from '../src/rubric-generator.mjs';
import { rubricPolicy, rubricSubjects, solutionGradingPolicy, rubricGradingSettings } from '../ui/rubric-prompts.js';
import { subjectReviewRules, subjectTaskTypes } from '../ui/subject-review-rules.js';

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

test('humanities isolation, 3-tier answers/holistic policies, scoped physics example, and 7 enriched subjects', () => {
  const humanities = ['chinese', 'english', 'politics', 'history', 'geography'];
  for (const subject of humanities) {
    for (const strictness of ['lenient', 'normal', 'strict']) {
      for (const scoringMethod of ['auto', 'points']) {
        const policy = solutionGradingPolicy({ subject, strictness, scoringMethod });
        assert.match(policy, /文科与综合要点评分规则/);
        for (const pattern of CONFLICTING_PROCESS_PHRASES) {
          assert.doesNotMatch(policy, pattern, `${subject}/${strictness}/${scoringMethod} leaked science rule`);
        }
      }
    }
  }

  for (const subject of Object.keys(rubricSubjects)) {
    for (const scoringMethod of ['answers', 'holistic']) {
      const tiers = ['lenient', 'normal', 'strict'].map(strictness =>
        solutionGradingPolicy({ subject, strictness, scoringMethod })
      );
      assert.equal(new Set(tiers).size, 3, `${subject}/${scoringMethod} should distinguish 3 strictnesses`);
    }
  }

  assert.match(solutionGradingPolicy({ subject: 'physics', scoringMethod: 'points' }), /刹车区间的充分证据示例/);
  assert.doesNotMatch(solutionGradingPolicy({ subject: 'physics', scoringMethod: 'answers' }), /刹车区间的充分证据示例/);
  assert.doesNotMatch(solutionGradingPolicy({ subject: 'physics', scoringMethod: 'holistic' }), /刹车区间的充分证据示例/);

  assert.match(rubricPolicy({ subject: 'chemistry', scoringMethod: 'points' }), /-CHO 与 -COH[\s\S]*ΔH[\s\S]*坩埚\/研钵/);
  const biologyPolicy = rubricPolicy({ subject: 'biology', scoringMethod: 'points' });
  assert.match(biologyPolicy, /遗传图解要素/);
  assert.match(biologyPolicy, /净光合与总光合/);
  assert.match(rubricPolicy({ subject: 'chinese', scoringMethod: 'points' }), /默写执行零容错边界[\s\S]*文言翻译按/);
  assert.match(rubricPolicy({ subject: 'english', scoringMethod: 'points' }), /应用文[\s\S]*读后续写/);
  assert.match(rubricPolicy({ subject: 'politics', scoringMethod: 'points' }), /跨模块作答[\s\S]*双层赋分/);
  assert.match(rubricPolicy({ subject: 'history', scoringMethod: 'points' }), /观点论述\/小论文题/);
  assert.match(rubricPolicy({ subject: 'geography', scoringMethod: 'points' }), /有利\/不利条件[\s\S]*因果链/);
});

test('humanities generation and grading remove residual science phrases and unnecessary LaTeX requirement', async () => {
  const humanities = ['chinese', 'english', 'politics', 'history', 'geography'];
  const residualSciencePhrases = [
    /需要过程的解答题/,
    /完全只写答案、没有过程的过程题/,
    /理科解答题默认一主问一项/,
    /列式、计算、单位与错算延续为项内细则/,
    /公式\/代入\/前问结果已体现/,
    /局部错算/
  ];

  for (const subject of humanities) {
    for (const strictness of ['lenient', 'normal', 'strict']) {
      for (const scoringMethod of ['auto', 'points', 'answers', 'holistic']) {
        let requested = '';
        const generated = await generateRubric(
          { providers: { p: {} } },
          {
            version: 2,
            provider: 'p',
            model: 'fixture',
            subject,
            strictness,
            scoringMethod,
            question: '材料题',
            answer: '参考要点',
            maxScore: 4,
            roundStep: 1
          },
          async (_provider, _model, prompt) => {
            requested = prompt;
            return JSON.stringify({
              question: '材料题',
              answer: '参考要点',
              items: [{ label: '第（1）问', maxScore: 4, criteria: '按内容、依据与分档要求给分。' }],
              warnings: []
            });
          }
        );
        const grading = promptFor({ answer: '参考要点', rubric: generated.rubric, scoring: { maxScore: 4, units: [] } });
        for (const text of [requested, generated.rubric, grading]) {
          for (const pattern of residualSciencePhrases) {
            assert.doesNotMatch(text, pattern, `${subject}/${strictness}/${scoringMethod} leaked ${pattern}`);
          }
        }
        if (subject !== 'geography') {
          assert.doesNotMatch(requested, /公式用LaTeX/);
        }
      }
    }
  }
});

test('answers and holistic modes exclude science top-level item phrasing across all 9 subjects', () => {
  for (const subject of Object.keys(rubricSubjects)) {
    for (const strictness of ['lenient', 'normal', 'strict']) {
      for (const scoringMethod of ['answers', 'holistic']) {
        const policy = rubricPolicy({ subject, strictness, scoringMethod });
        assert.doesNotMatch(policy, /理科解答题默认一主问一项/);
        assert.doesNotMatch(policy, /列式、计算、单位与错算延续为项内细则/);
      }
    }
  }
});

test('subjectTaskTypes integrate across generation, persistence, grading deduplication, and physics scoping', async () => {
  for (const [subject, tasks] of Object.entries(subjectTaskTypes)) {
    for (const [taskType, entry] of Object.entries(tasks)) {
      let requested = '';
      const generated = await generateRubric(
        { providers: { p: {} } },
        {
          version: 2,
          provider: 'p',
          model: 'fixture',
          subject,
          taskType,
          strictness: 'normal',
          scoringMethod: 'auto',
          question: '测试小题',
          answer: '参考答案',
          maxScore: 4,
          roundStep: 1
        },
        async (_provider, _model, prompt) => {
          requested = prompt;
          return JSON.stringify({
            question: '测试小题',
            answer: '参考答案',
            items: [{ label: '第（1）问', maxScore: 4, criteria: '按核心条款给4分。' }],
            warnings: []
          });
        }
      );
      assert.ok(requested.includes(`题型细分：${entry.label}`));
      assert.ok(requested.includes(entry.guidance));
      assert.ok(generated.rubric.includes(`题型细分：${entry.label}。`));

      const resolved = rubricGradingSettings(generated.rubric);
      assert.equal(resolved.subject, subject);
      assert.equal(resolved.taskType, taskType);

      const grading = promptFor({ answer: '参考答案', rubric: generated.rubric, scoring: { maxScore: 4, units: [] } });
      assert.equal(grading.split(entry.guidance).length - 1, 1, `${subject}/${taskType} duplicated in grading`);
    }
  }

  assert.throws(() => rubricPolicy({ subject: 'chinese', taskType: 'mechanics_calc' }), /题型细分选项无效/);
  await assert.rejects(
    generateRubric(
      { providers: { p: {} } },
      { version: 2, provider: 'p', model: 'fixture', subject: 'chinese', taskType: 'nonexistent', question: 'q', answer: 'a', maxScore: 4 },
      async () => '{}'
    ),
    /题型细分选项无效/
  );

  const mechanics = solutionGradingPolicy({ subject: 'physics', taskType: 'mechanics_calc', scoringMethod: 'points' });
  const electricity = solutionGradingPolicy({ subject: 'physics', taskType: 'electricity_exp', scoringMethod: 'points' });
  const graph = solutionGradingPolicy({ subject: 'physics', taskType: 'graph_analysis', scoringMethod: 'points' });
  assert.match(mechanics, /刹车区间的充分证据示例/);
  assert.doesNotMatch(electricity, /刹车区间的充分证据示例/);
  assert.doesNotMatch(graph, /刹车区间的充分证据示例/);
  assert.match(electricity, /器材替代方案/);
  assert.match(graph, /斜率、截距与围成面积/);

  const switched = rubricGradingSettings('学科：物理。\n评分口径：正常。', { subject: 'chinese', taskType: 'translation' });
  assert.equal(switched.subject, 'physics');
  assert.equal(switched.taskType, '');
});

test('lintGeneratedRubric flags ambiguous clauses and mode contradictions while exempting valid constructs', async () => {
  assert.deepEqual(lintGeneratedRubric('正确得4分，错别字扣1分。', { step: 1, scoringMethod: 'auto' }), []);
  assert.deepEqual(lintGeneratedRubric('不得出现“酌情扣分”，禁止酌情给分，切勿适当扣分。', { step: 1, scoringMethod: 'auto' }), []);
  assert.deepEqual(lintGeneratedRubric('0.5分钟内完成3-5分米位移；一等（16—20分）。', { step: 1, scoringMethod: 'auto' }), []);
  assert.deepEqual(lintGeneratedRubric('一等16—20分，内容立意深刻，语言流畅。', { step: 1, scoringMethod: 'holistic' }), []);
  assert.deepEqual(lintGeneratedRubric('写对得2分，写错0分；不设过程分，不拆步骤分。', { step: 1, scoringMethod: 'answers' }), []);

  const vague = lintGeneratedRubric('核心要点正确，若有偏差酌情扣分；思路合理可适当给分。', { step: 1, scoringMethod: 'points' });
  assert.equal(vague.length, 2);
  assert.match(vague[0], /模糊条款/);

  const rangeWarnings = lintGeneratedRubric('每处错别字扣1—2分；结论给1~3分。', { step: 1, scoringMethod: 'points' });
  assert.equal(rangeWarnings.length, 2);
  assert.match(rangeWarnings[0], /区间分值/);

  const answersWarnings = lintGeneratedRubric('答案正确得2分，仅式子对可给过程分1分。', { step: 1, scoringMethod: 'answers' });
  assert.equal(answersWarnings.length, 1);
  assert.match(answersWarnings[0], /按答案逐项给分/);

  const holisticWarnings = lintGeneratedRubric('观点明确且论述完整即可获得较高分数。', { step: 1, scoringMethod: 'holistic' });
  assert.equal(holisticWarnings.length, 1);
  assert.match(holisticWarnings[0], /按等级综合评价/);

  const generated = await generateRubric(
    { providers: { p: {} } },
    { version: 2, provider: 'p', model: 'fixture', subject: 'chinese', strictness: 'normal', scoringMethod: 'points', question: '阅读题', answer: '要点', maxScore: 4, roundStep: 1 },
    async () => JSON.stringify({
      question: '阅读题',
      answer: '要点',
      items: [{ label: '第（1）问', maxScore: 4, criteria: '要点对给4分，缺依据酌情扣分，错字扣1—2分。' }],
      warnings: ['请确认分值']
    })
  );
  assert.equal(generated.warnings.length, 3);
  assert.equal(generated.warnings[0], '请确认分值');
  assert.match(generated.warnings.join('\n'), /模糊条款[\s\S]*区间分值/);
});

test('calibrated three-tier science policies enforce lenient vs normal distinction within budgets', () => {
  for (const subject of ['mathematics', 'physics', 'chemistry', 'biology']) {
    const lenient = rubricPolicy({ subject, strictness: 'lenient', scoringMethod: 'points' });
    const normal = rubricPolicy({ subject, strictness: 'normal', scoringMethod: 'points' });
    assert.match(lenient, /不苛求过程严谨或完整|过程是否严谨、完整.*不重要/);
    assert.match(lenient, /答案正确且.*写有.*解题过程/);
    assert.match(normal, /足以支持结论[\s\S]*满分/);
    assert.match(normal, /不因过程不完整判零/);
    for (const tier of ['lenient', 'normal', 'strict']) {
      const points = rubricPolicy({ subject, strictness: tier, scoringMethod: 'points' });
      const answers = rubricPolicy({ subject, strictness: tier, scoringMethod: 'answers' });
      const holistic = rubricPolicy({ subject, strictness: tier, scoringMethod: 'holistic' });
      assert.ok(answers.length < points.length, `${subject}/${tier}: answers >= points`);
      assert.ok(holistic.length < points.length, `${subject}/${tier}: holistic >= points`);
    }
  }
});

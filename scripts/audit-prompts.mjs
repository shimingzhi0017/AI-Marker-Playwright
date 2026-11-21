import assert from 'node:assert/strict';
import { generateRubric } from '../src/rubric-generator.mjs';
import { promptFor } from '../src/domain.mjs';
import { rubricSubjects, rubricScoringMethods, solutionGradingPolicy } from '../ui/rubric-prompts.js';
import { subjectReviewRules } from '../ui/subject-review-rules.js';

const subjects = Object.keys(rubricSubjects);
const strictnesses = ['lenient', 'normal', 'strict'];
const scoringMethods = Object.keys(rubricScoringMethods);

const FORBIDDEN_IN_ANSWERS_OR_HOLISTIC = [
  '解答题有效解法与合并步骤规则',
  '解答题错算与错误延续规则',
  '物理解答题方程与结果赋分规则',
  '数学解答题关键过程赋分规则',
  '宽松和正常口径的满分判断先于逐点扣分',
  '宽松模式下的解答题',
  '正常模式下的解答题',
  '严格模式下的解答题'
];

const EXPECTED_SECTIONS = [
  '===== 评分策略与步长 =====',
  '===== 网页评分框与勤勉度 =====',
  '===== 书写识别要求 =====',
  '===== 规则疑点要求 =====',
  '===== 评分项清单与输出要求 ====='
];

function budgetFor(subject, scoringMethod) {
  if (scoringMethod === 'answers') {
    return subject === 'physics' ? { gen: 5500, grade: 5000 } : { gen: 5000, grade: 4500 };
  }
  if (scoringMethod === 'holistic') {
    return { gen: 5000, grade: 4500 };
  }
  if (subject === 'physics') return { gen: 7200, grade: 6500 };
  if (subject === 'mathematics') return { gen: 6500, grade: 5800 };
  return { gen: 5500, grade: 4900 };
}

const stats = new Map();
let totalCombinations = 0;

for (const subject of subjects) {
  const row = { genAuto: 0, genAnswers: 0, genHolistic: 0, gradeAuto: 0, gradeAnswers: 0, gradeHolistic: 0 };
  for (const strictness of strictnesses) {
    for (const scoringMethod of scoringMethods) {
      totalCombinations++;
      let generationPrompt = '';
      const generated = await generateRubric(
        { providers: { offline: {} } },
        {
          version: 2,
          provider: 'offline',
          model: 'audit',
          subject,
          strictness,
          scoringMethod,
          question: '测试题目',
          answer: '测试答案',
          maxScore: 4,
          roundStep: 1
        },
        async (_provider, _model, prompt) => {
          generationPrompt = prompt;
          return JSON.stringify({
            question: '测试题目',
            answer: '测试答案',
            items: [{ label: '第（1）问', maxScore: 4, criteria: '按标准条款评分。' }],
            warnings: []
          });
        }
      );

      const gradingPrompt = promptFor({
        answer: '测试答案',
        rubric: generated.rubric,
        scoring: { maxScore: 4, units: [] }
      });

      if (strictness === 'normal') {
        if (scoringMethod === 'auto') { row.genAuto = generationPrompt.length; row.gradeAuto = gradingPrompt.length; }
        if (scoringMethod === 'answers') { row.genAnswers = generationPrompt.length; row.gradeAnswers = gradingPrompt.length; }
        if (scoringMethod === 'holistic') { row.genHolistic = generationPrompt.length; row.gradeHolistic = gradingPrompt.length; }
      }

      const budget = budgetFor(subject, scoringMethod);
      assert.ok(
        generationPrompt.length <= budget.gen,
        `${subject}/${strictness}/${scoringMethod} 生成提示词超出预算: ${generationPrompt.length} > ${budget.gen}`
      );
      assert.ok(
        gradingPrompt.length <= budget.grade,
        `${subject}/${strictness}/${scoringMethod} 阅卷提示词超出预算: ${gradingPrompt.length} > ${budget.grade}`
      );

      if (scoringMethod === 'answers' || scoringMethod === 'holistic') {
        for (const phrase of FORBIDDEN_IN_ANSWERS_OR_HOLISTIC) {
          assert.ok(!generationPrompt.includes(phrase), `${subject}/${strictness}/${scoringMethod} 生成提示词不应包含: ${phrase}`);
          assert.ok(!generated.rubric.includes(phrase), `${subject}/${strictness}/${scoringMethod} 标准正文不应包含: ${phrase}`);
          assert.ok(!gradingPrompt.includes(phrase), `${subject}/${strictness}/${scoringMethod} 阅卷提示词不应包含: ${phrase}`);
        }
        const requiredMarker = scoringMethod === 'answers' ? '按答案逐项给分规则' : '按等级综合评价规则';
        assert.ok(generationPrompt.includes(requiredMarker), `${subject}/${strictness}/${scoringMethod} 缺少 ${requiredMarker}`);
        assert.ok(gradingPrompt.includes(requiredMarker), `${subject}/${strictness}/${scoringMethod} 阅卷缺少 ${requiredMarker}`);
      }

      // Check subject boundary presence and absence of cross-subject leakage.
      assert.ok(generationPrompt.includes(subjectReviewRules[subject][0]), `${subject}/${strictness}/${scoringMethod} 生成缺少本学科规则`);
      assert.ok(gradingPrompt.includes(subjectReviewRules[subject][0]), `${subject}/${strictness}/${scoringMethod} 阅卷缺少本学科规则`);
      for (const other of subjects) {
        if (other === subject) continue;
        assert.ok(!generationPrompt.includes(subjectReviewRules[other][0]), `${subject} 生成泄漏了 ${other} 规则`);
        assert.ok(!gradingPrompt.includes(subjectReviewRules[other][0]), `${subject} 阅卷泄漏了 ${other} 规则`);
      }

      // Check deduplication of shared solution policy in promptFor().
      const sharedPolicy = solutionGradingPolicy({ subject, strictness, scoringMethod });
      assert.equal(gradingPrompt.split(sharedPolicy).length - 1, 1, `${subject}/${strictness}/${scoringMethod} 共享策略重复次数不为 1`);

      // Check section markers and absence of biased phrasing.
      for (const header of EXPECTED_SECTIONS) {
        assert.ok(gradingPrompt.includes(header), `${subject}/${strictness}/${scoringMethod} 缺少分段标记 ${header}`);
      }
      assert.ok(!gradingPrompt.includes('严格按照评分标准评分'), `${subject}/${strictness}/${scoringMethod} 仍含偏严旧句`);
      if (strictness === 'lenient' || strictness === 'normal') {
        assert.ok(!gradingPrompt.includes('严格的阅卷老师'), `${subject}/${strictness}/${scoringMethod} 仍含严格的阅卷老师`);
      }
    }
  }
  stats.set(subject, row);
}

console.log(`提示词离线体检通过：共检查 ${totalCombinations} 组（${subjects.length} 学科 × ${strictnesses.length} 口径 × ${scoringMethods.length} 给分方式）。`);
console.log('正常口径下 auto / answers / holistic 提示词字符数对比：');
for (const [subject, row] of stats.entries()) {
  console.log(
    `  ${rubricSubjects[subject].label} (${subject}): ` +
    `生成 auto=${row.genAuto} answers=${row.genAnswers} holistic=${row.genHolistic} | ` +
    `阅卷 auto=${row.gradeAuto} answers=${row.gradeAnswers} holistic=${row.gradeHolistic}`
  );
}

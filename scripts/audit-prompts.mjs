import assert from 'node:assert/strict';
import { generateRubric } from '../src/rubric-generator.mjs';
import { promptFor } from '../src/domain.mjs';
import { rubricSubjects, rubricScoringMethods, solutionGradingPolicy } from '../ui/rubric-prompts.js';
import { subjectReviewRules, subjectTaskTypes } from '../ui/subject-review-rules.js';

const subjects = Object.keys(rubricSubjects);
const strictnesses = ['lenient', 'normal', 'strict'];
const scoringMethods = Object.keys(rubricScoringMethods);
const HUMANITIES_SUBJECTS = new Set(['chinese', 'english', 'politics', 'history', 'geography']);

const FORBIDDEN_IN_ANSWERS_OR_HOLISTIC = [
  '解答题有效解法与合并步骤规则',
  '解答题错算与错误延续规则',
  '物理解答题方程与结果赋分规则',
  '数学解答题关键过程赋分规则',
  '宽松和正常口径的满分判断先于逐点扣分',
  '宽松模式下的解答题',
  '正常模式下的解答题',
  '严格模式下的解答题',
  '理科解答题默认一主问一项',
  '列式、计算、单位与错算延续为项内细则'
];

const FORBIDDEN_IN_HUMANITIES = [
  '需要过程的解答题',
  '完全只写答案、没有过程的过程题',
  '理科解答题默认一主问一项',
  '列式、计算、单位与错算延续为项内细则',
  '公式/代入/前问结果已体现',
  '局部错算'
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

      if (scoringMethod === 'answers' || scoringMethod === 'holistic' || HUMANITIES_SUBJECTS.has(subject)) {
        for (const phrase of FORBIDDEN_IN_ANSWERS_OR_HOLISTIC) {
          assert.ok(!generationPrompt.includes(phrase), `${subject}/${strictness}/${scoringMethod} 生成提示词不应包含: ${phrase}`);
          assert.ok(!generated.rubric.includes(phrase), `${subject}/${strictness}/${scoringMethod} 标准正文不应包含: ${phrase}`);
          assert.ok(!gradingPrompt.includes(phrase), `${subject}/${strictness}/${scoringMethod} 阅卷提示词不应包含: ${phrase}`);
        }
      }
      if (HUMANITIES_SUBJECTS.has(subject)) {
        for (const phrase of FORBIDDEN_IN_HUMANITIES) {
          assert.ok(!generationPrompt.includes(phrase), `${subject}/${strictness}/${scoringMethod} 文科生成提示词不应残留理科表述: ${phrase}`);
          assert.ok(!generated.rubric.includes(phrase), `${subject}/${strictness}/${scoringMethod} 文科标准正文不应残留理科表述: ${phrase}`);
          assert.ok(!gradingPrompt.includes(phrase), `${subject}/${strictness}/${scoringMethod} 文科阅卷提示词不应残留理科表述: ${phrase}`);
        }
      }
      if (scoringMethod === 'answers' || scoringMethod === 'holistic') {
        const requiredMarker = scoringMethod === 'answers' ? '按答案逐项给分规则' : '按等级综合评价规则';
        assert.ok(generationPrompt.includes(requiredMarker), `${subject}/${strictness}/${scoringMethod} 缺少 ${requiredMarker}`);
        assert.ok(gradingPrompt.includes(requiredMarker), `${subject}/${strictness}/${scoringMethod} 阅卷缺少 ${requiredMarker}`);
      } else if (HUMANITIES_SUBJECTS.has(subject)) {
        assert.ok(generationPrompt.includes('文科与综合要点评分规则'), `${subject}/${strictness}/${scoringMethod} 生成缺少文科要点规则`);
        assert.ok(gradingPrompt.includes('文科与综合要点评分规则'), `${subject}/${strictness}/${scoringMethod} 阅卷缺少文科要点规则`);
      }

      if (subject === 'physics') {
        if (scoringMethod === 'answers' || scoringMethod === 'holistic') {
          assert.ok(!generationPrompt.includes('刹车区间的充分证据示例'), `${subject}/${strictness}/${scoringMethod} 不应混入运动学刹车案例`);
          assert.ok(!gradingPrompt.includes('刹车区间的充分证据示例'), `${subject}/${strictness}/${scoringMethod} 阅卷不应混入运动学刹车案例`);
        } else {
          assert.ok(generationPrompt.includes('刹车区间的充分证据示例'), `${subject}/${strictness}/${scoringMethod} 缺少物理解答题示范`);
          assert.ok(gradingPrompt.includes('刹车区间的充分证据示例'), `${subject}/${strictness}/${scoringMethod} 阅卷缺少物理解答题示范`);
        }
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

for (const subject of subjects) {
  for (const scoringMethod of ['answers', 'holistic']) {
    const tiers = strictnesses.map(strictness => solutionGradingPolicy({ subject, strictness, scoringMethod }));
    assert.equal(new Set(tiers).size, 3, `${subject}/${scoringMethod} 宽严三档应彼此区分`);
  }
}

let taskTypeCount = 0;
for (const subject of subjects) {
  const tasks = subjectTaskTypes[subject] || {};
  assert.ok(Object.keys(tasks).length >= 2, `${subject} 至少应配置 2 个细分题型`);
  const budget = budgetFor(subject, 'auto');
  for (const [taskType, entry] of Object.entries(tasks)) {
    taskTypeCount++;
    let generationPrompt = '';
    const generated = await generateRubric(
      { providers: { offline: {} } },
      {
        version: 2,
        provider: 'offline',
        model: 'audit',
        subject,
        taskType,
        strictness: 'normal',
        scoringMethod: 'auto',
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
    assert.ok(generated.rubric.includes(`题型细分：${entry.label}。`), `${subject}/${taskType} 未持久化题型细分标记`);
    assert.ok(generationPrompt.includes(entry.guidance), `${subject}/${taskType} 生成缺少细分指导`);
    assert.equal(gradingPrompt.split(entry.guidance).length - 1, 1, `${subject}/${taskType} 细分指导在阅卷提示词中未精确出现 1 次`);
    assert.ok(generationPrompt.length <= budget.gen + 250, `${subject}/${taskType} 生成提示词超出预算: ${generationPrompt.length}`);
    assert.ok(gradingPrompt.length <= budget.grade + 250, `${subject}/${taskType} 阅卷提示词超出预算: ${gradingPrompt.length}`);
    for (const other of subjects) {
      if (other === subject) continue;
      assert.ok(!generationPrompt.includes(subjectReviewRules[other][0]), `${subject}/${taskType} 生成泄漏 ${other}`);
      assert.ok(!gradingPrompt.includes(subjectReviewRules[other][0]), `${subject}/${taskType} 阅卷泄漏 ${other}`);
    }
    if (subject === 'physics') {
      if (taskType === 'electricity_exp' || taskType === 'graph_analysis') {
        assert.ok(!generationPrompt.includes('刹车区间的充分证据示例'), `${subject}/${taskType} 不应混入运动学刹车案例`);
        assert.ok(!gradingPrompt.includes('刹车区间的充分证据示例'), `${subject}/${taskType} 阅卷不应混入运动学刹车案例`);
      } else {
        assert.ok(generationPrompt.includes('刹车区间的充分证据示例'), `${subject}/${taskType} 应保留力学刹车示范`);
        assert.ok(gradingPrompt.includes('刹车区间的充分证据示例'), `${subject}/${taskType} 阅卷应保留力学刹车示范`);
      }
    }
  }
}

console.log(`提示词离线体检通过：共检查 ${totalCombinations} 组基础组合（${subjects.length} 学科 × ${strictnesses.length} 口径 × ${scoringMethods.length} 给分方式）及 ${taskTypeCount} 组细分题型。`);
console.log('正常口径下 auto / answers / holistic 提示词字符数对比：');
for (const [subject, row] of stats.entries()) {
  console.log(
    `  ${rubricSubjects[subject].label} (${subject}): ` +
    `生成 auto=${row.genAuto} answers=${row.genAnswers} holistic=${row.genHolistic} | ` +
    `阅卷 auto=${row.gradeAuto} answers=${row.gradeAnswers} holistic=${row.gradeHolistic}`
  );
}

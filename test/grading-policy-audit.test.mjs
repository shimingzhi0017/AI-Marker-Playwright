import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { auditGradingResult, gradingPolicyIssues, policyRetryPrompt } from '../src/grading-policy-audit.mjs';
import { grade } from '../src/models.mjs';
import { Runner } from '../src/runner.mjs';
import { summarizeTaskMetrics } from '../src/task-metrics.mjs';

const baseConfig = {
  workflowId: 'w',
  answer: '12m；3m/s；0.75m',
  rubric: '第（1）问：满分3分\n第（2）问：满分3分\n第（3）问：满分4分\n学科：物理。\n评分口径：正常；给分方式为按要点／步骤给分。',
  scoring: { strictness: 'lenient', maxScore: 10, units: [] }
};

function makeResult({ score = 9, last = 3, reason = '结果正确，有效简要过程正确。', comment = `总分：${score}分。`, gradingMode = 'lenient', reportedScore, details } = {}) {
  return {
    gradingMode,
    score,
    ...(reportedScore !== undefined ? { reportedScore } : {}),
    studentAnswer: 'x1=12m; v2=3m/s; x3=0.75m',
    comment,
    recognition: { status: 'clear', coverageChecked: true, notes: [], issues: [] },
    gradingIssues: [],
    subScores: [],
    scoringDetails: details || [
      { label: '第（1）问', score: 3, maxScore: 3, reason: '计算正确，得3分。' },
      { label: '第（2）问', score: 3, maxScore: 3, reason: '计算正确，得3分。' },
      { label: '第（3）问', score: last, maxScore: 4, reason }
    ]
  };
}

test('B1: explicit strict deductions are caught in multiple phrasings, but exemptions and strict mode pass', () => {
  for (const reason of [
    '从严评分，未单列文字说明扣1分。',
    '结果正确，扣1分，属严格核对要求。',
    '严格扣1分，缺少书面方向说明。',
    '依据严格细则不给分。'
  ]) {
    const audit = auditGradingResult(baseConfig, makeResult({ score: 9, last: 3, reason }));
    assert.ok(audit.policyIssues.some(i => /非严格口径出现严格扣分依据/.test(i)), reason);
  }

  for (const reason of [
    '若按严格标准可扣1分，但本次不扣；本项另有计算错误。',
    '即使按严格要求也不扣分，此处因数值代入错误扣1分。',
    '非严格模式免扣分，因公式代入错误扣1分。'
  ]) {
    assert.deepEqual(gradingPolicyIssues(baseConfig, makeResult({ score: 9, last: 3, reason })), []);
  }

  assert.deepEqual(
    gradingPolicyIssues(
      { ...baseConfig, scoring: { ...baseConfig.scoring, strictness: 'strict' } },
      makeResult({ score: 9, last: 3, gradingMode: 'strict', reason: '按严格标准扣1分。' })
    ),
    []
  );
});

test('B2 & B3: implicit over-deductions trigger in lenient/normal while genuine omissions, proofs, task requirements and custom rubrics are exempt', () => {
  for (const reason of [
    '结果正确，但未采用参考答案解法扣1分。',
    '未单列中间量扣1分。',
    '未单独声明正方向文字说明扣1分。',
    '省略了常规代入运算扣1分。'
  ]) {
    for (const strictness of ['lenient', 'normal']) {
      const cfg = { ...baseConfig, scoring: { ...baseConfig.scoring, strictness } };
      const issues = gradingPolicyIssues(cfg, makeResult({ score: 9, last: 3, gradingMode: strictness, reason }));
      assert.ok(issues.length >= 1, `${strictness}: ${reason}`);
    }
  }

  for (const reason of [
    '未单列原始方程扣1分。',
    '过程过于简略，按小问标准扣1分。',
    '省略中间步骤导致未达到参考步骤数量，扣1分。',
    '不影响含义的单位省略扣1分。'
  ]) {
    const lenientIssues = gradingPolicyIssues(baseConfig, makeResult({ score: 9, last: 3, reason }));
    assert.ok(lenientIssues.some(i => /宽松口径出现疑似过度扣分依据/.test(i)), reason);
  }

  const zeroPartial = gradingPolicyIssues(
    baseConfig,
    makeResult({ score: 6, last: 0, reason: '过程过于简略，按不完整判零。', comment: '总分6分。' })
  );
  assert.ok(zeroPartial.some(i => /宽松口径不得因过程简略或不完整而判零/.test(i)));

  // Exemptions
  for (const reason of [
    '题目明确要求列出原始方程，未单列扣1分。',
    '证明题关键论证缺失，过程过于简略扣2分。',
    '学生只写了最终答案，未写过程，扣3分。',
    '单位省略不扣分；因速度代入错误扣1分。'
  ]) {
    assert.deepEqual(gradingPolicyIssues(baseConfig, makeResult({ score: 9, last: 3, reason })), [], reason);
  }
  assert.deepEqual(
    gradingPolicyIssues(baseConfig, makeResult({ score: 6, last: 0, reason: '公式错误且推导无效，过程过于简略判零。', comment: '总分6分。' })),
    []
  );
  assert.deepEqual(
    gradingPolicyIssues(
      { ...baseConfig, rubricGeneration: { strictness: 'custom', useCustomPrompt: true }, rubric: '评分口径：自定义。\n第（1）问：满分10分', scoring: { maxScore: 10, units: [] } },
      makeResult({ score: 9, last: 3, gradingMode: 'custom', reason: '未单列中间量扣1分。' })
    ),
    []
  );
});

test('C: answers scoring method forbids process/step partial credit while allowing valid incomplete multiple-choice credit', () => {
  const answersConfig = {
    workflowId: 'w',
    answer: 'AB',
    rubric: '第（1）问：满分6分\n学科：物理。\n评分口径：正常；给分方式为按答案逐项给分。',
    scoring: { maxScore: 6, units: [] }
  };
  const violation = makeResult({
    gradingMode: 'normal',
    score: 3,
    comment: '总分3分。',
    details: [{ label: '第（1）问', score: 3, maxScore: 6, reason: '答案不完整，但酌情给予过程分3分。' }]
  });
  assert.ok(gradingPolicyIssues(answersConfig, violation).some(i => /不得增加过程分/.test(i)));

  const validMultiChoice = makeResult({
    gradingMode: 'normal',
    score: 3,
    comment: '总分3分。',
    details: [{ label: '第（1）问', score: 3, maxScore: 6, reason: '正确选项AB，学生选A漏选B，不设过程分，按标准漏选得3分。' }]
  });
  assert.deepEqual(gradingPolicyIssues(answersConfig, validMultiChoice), []);
});

test('D1-D4: consistency audit detects hidden deductions and prose/score mismatches without false positives on subpoints or repaired totals', () => {
  // D1: full-mark item or full total with unnegated deduction vs negated/conditional rules
  const d1Item = makeResult({ score: 10, last: 4, reason: '基本思路成立，但缺少必要单位扣1分。' });
  assert.ok(auditGradingResult(baseConfig, d1Item).consistencyIssues.some(i => /得分已为满分4分/.test(i)));

  const d1Total = makeResult({
    score: 10,
    last: 4,
    reason: '正确，得4分。',
    comment: '总评：总体不错，但第三问扣1分。最终总分：10分。'
  });
  assert.ok(auditGradingResult(baseConfig, d1Total).consistencyIssues.some(i => /总分已为满分10分/.test(i)));

  const negatedDeduction = makeResult({
    score: 10,
    last: 4,
    reason: '按标准原应扣1分，但宽松口径不扣分；若漏公式才扣2分，最多扣2分，本问扣0分。',
    comment: '总分：$3+3+4=10$分。'
  });
  assert.deepEqual(gradingPolicyIssues(baseConfig, negatedDeduction), []);

  // D2: deducted item praising full marks or spotless work vs valid partial credit
  const d2Hidden = makeResult({ score: 9, last: 3, reason: '作答全部正确，无扣分。' });
  assert.ok(auditGradingResult(baseConfig, d2Hidden).consistencyIssues.some(i => /疑似暗扣/.test(i)));

  const d2FullClaim = makeResult({ score: 8, last: 2, reason: '关键关系成立，本问应得满分。', comment: '总分8分。' });
  assert.ok(auditGradingResult(baseConfig, d2FullClaim).consistencyIssues.some(i => /评语写明给满分/.test(i)));

  const d2ValidDefect = makeResult({ score: 9, last: 3, reason: '单位省略不扣分，但末尾计算错误仅得3分。' });
  assert.deepEqual(gradingPolicyIssues(baseConfig, d2ValidDefect), []);

  // D3: item stated score mismatch & zero-work claim on positive score, but subpoint breakdown passes
  const d3StatedMismatch = makeResult({ score: 8, last: 2, reason: '前两步得2分，本问实得3分。', comment: '总分8分。' });
  assert.ok(auditGradingResult(baseConfig, d3StatedMismatch).consistencyIssues.some(i => /评语写明得分3分，但分项score为2分/.test(i)));

  const d3BlankPositive = makeResult({ score: 8, last: 2, reason: '未作答。', comment: '总分8分。' });
  assert.ok(auditGradingResult(baseConfig, d3BlankPositive).consistencyIssues.some(i => /评语写明未作答或不得分/.test(i)));

  const d3SubpointsOk = makeResult({ score: 8, last: 2, reason: '列式得1分，代入计算得1分。', comment: '总分8分。' });
  assert.deepEqual(gradingPolicyIssues(baseConfig, d3SubpointsOk), []);

  // D4: comment total mismatch (including LaTeX), ignoring per-question sums
  const d4LatexOk = makeResult({
    score: 10,
    last: 4,
    reason: '过程完整，得4分。',
    comment: '（1）得3分。\n（2）得3分。\n（3）得4分。\n总分：$3+3+4=10$分。'
  });
  assert.deepEqual(gradingPolicyIssues(baseConfig, d4LatexOk), []);

  const d4LatexMismatch = makeResult({
    score: 9,
    last: 3,
    reason: '计算正确3分，扣1分。',
    comment: '（1）列式1分，结果2分，合计3分；\n（2）合计3分；\n总分：$3+3+4=10$分。'
  });
  assert.ok(auditGradingResult(baseConfig, d4LatexMismatch).consistencyIssues.some(i => /评语写明总分10分，但score为9分/.test(i)));

  const d4LocalSumOnly = makeResult({
    score: 9,
    last: 3,
    reason: '计算正确3分，扣1分。',
    comment: '（1）列式1分，计算2分，合计3分。\n（2）第1问+第2问得分6分。\n（3）得3分。'
  });
  assert.deepEqual(gradingPolicyIssues(baseConfig, d4LocalSumOnly), []);

  // Repaired totals bypass category D so totalVerification retains ownership
  const withRepaired = makeResult({
    score: 9,
    reportedScore: 10,
    last: 3,
    reason: '本问实得4分。',
    comment: '总分：10分。'
  });
  assert.deepEqual(auditGradingResult(baseConfig, withRepaired).consistencyIssues, []);

  // policyRetryPrompt preserves system prompt and appends consistency guidance
  const partsPrompt = policyRetryPrompt({ system: 'SYS_FIXED', user: 'USR' }, baseConfig, d2Hidden, ['分项评语与得分矛盾（第（3）问）：疑似暗扣。']);
  assert.equal(partsPrompt.system, 'SYS_FIXED');
  assert.match(partsPrompt.user, /评分口径核验重试：/);
  assert.match(partsPrompt.user, /消除自相矛盾与暗扣/);
});

test('E2E: implicit over-deduction and hidden deduction trigger bounded single retry with identical system prompt; unresolved blocks unattended runner', async t => {
  const requests = [];
  let scenario = 'implicit_recover';
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    let reply;
    if (scenario === 'implicit_recover') {
      reply = requests.length === 1
        ? makeResult({ score: 9, last: 3, reason: '过程过于简略，扣1分。' })
        : makeResult({ score: 10, last: 4, reason: '有效简要过程足以支持结论，得4分。', comment: '总分：10分。' });
    } else if (scenario === 'hidden_recover') {
      reply = requests.length === 1
        ? makeResult({ score: 9, last: 3, reason: '步骤全部正确，无扣分。', comment: '总分9分。' })
        : makeResult({ score: 10, last: 4, reason: '所有有效步骤及结论均正确，得4分。', comment: '总分10分。' });
    } else {
      reply = makeResult({ score: 9, last: 3, reason: '作答全部正确，无扣分。', comment: '总分9分。' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const settings = {
    requestBudget: 6,
    providers: { p: { endpoint: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture' } },
    workflows: { w: { model: { provider: 'p', model: 'primary' }, dualEval: { enabled: false } } }
  };

  const implicitResult = await grade(baseConfig, settings, []);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].messages[0].content, requests[1].messages[0].content);
  assert.equal(implicitResult.score, 10);
  assert.equal(implicitResult.policyAudit, undefined);
  assert.equal(implicitResult.policyVerification.previous.policyAudit.policyIssues.length, 1);
  assert.equal(implicitResult.policyVerification.status, 'verified');
  assert.equal(implicitResult.formatWarning, undefined);
  assert.match(implicitResult.formatNote, /评分口径冲突已按原答卷和当前要求重新核验/);

  requests.length = 0;
  scenario = 'hidden_recover';
  const hiddenResult = await grade(baseConfig, settings, []);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].messages[0].content, requests[1].messages[0].content);
  assert.equal(hiddenResult.score, 10);
  assert.equal(hiddenResult.policyAudit, undefined);
  assert.equal(hiddenResult.policyVerification.previous.policyAudit.consistencyIssues.length, 1);
  assert.equal(hiddenResult.policyVerification.status, 'verified');
  assert.equal(hiddenResult.formatWarning, undefined);
  assert.match(hiddenResult.formatNote, /评分评语与分值冲突已按原答卷和当前要求重新核验/);

  requests.length = 0;
  scenario = 'unresolved';
  const unresolved = await grade(baseConfig, settings, []);
  assert.equal(requests.length, 2);
  assert.equal(unresolved.score, 9);
  assert.equal(unresolved.policyAudit.consistencyIssues.length, 1);
  assert.equal(unresolved.policyVerification.status, 'unresolved');
  assert.match(unresolved.formatWarning, /评分自洽冲突.*疑似暗扣/);

  requests.length = 0;
  scenario = 'implicit_recover';
  const budgetBlocked = await grade(baseConfig, { ...settings, requestBudget: 1 }, []);
  assert.equal(budgetBlocked.policyAudit.policyIssues.length, 1);
  const metrics = summarizeTaskMetrics([
    { id: 'u-1', state: 'review', result: unresolved },
    { id: 'u-2', state: 'review', result: budgetBlocked }
  ]);
  assert.equal(metrics.verification.consistencyIssueCount, 1);
  assert.equal(metrics.verification.policyIssueCount, 1);

  let filled = false;
  let reviewMode;
  const records = [];
  const runner = new Runner(
    { ready: async () => ({ identity: 'hidden-deduction', taskId: 't', units: [] }), images: async () => [], fill: async () => { filled = true; } },
    { records: () => [], save: r => records.push(structuredClone(r)), log: () => {}, images: async () => [] },
    { active: 'p', presets: { p: baseConfig }, mode: 'unattended' },
    async (_record, mode) => { reviewMode = mode; return 'stop'; },
    async () => unresolved
  );
  await runner.run();
  assert.equal(reviewMode, 'trial');
  assert.equal(filled, false);
  assert.equal(records.at(-1).state, 'paused');
});

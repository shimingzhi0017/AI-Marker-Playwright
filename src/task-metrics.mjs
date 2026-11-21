import { isMeaningfulCorrectionReason } from './correction-feedback.mjs';

function wasArbitrated(record) {
  return record?.result?.dualEval?.result === 'arbitration'
    || Boolean(record?.result?.recognitionArbitration)
    || record?.originalResult?.dualEval?.result === 'arbitration'
    || Boolean(record?.originalResult?.recognitionArbitration);
}

function isCorrected(record) {
  return Boolean(
    record?.correctionReason
    || record?.corrected
    || (record?.originalResult && Number.isFinite(record?.result?.score) && record.originalResult.score !== record.result.score)
  );
}

/**
 * Compute task-level quality, arbitration, policy audit, and token cache metrics across records.
 */
export function summarizeTaskMetrics(records = []) {
  const list = Array.isArray(records) ? records : [];
  const byState = {};
  const presetMap = new Map();

  let scoredCount = 0;
  let scoreSum = 0;
  let submittedCount = 0;
  let pendingReviewCount = 0;
  let pausedCount = 0;
  let uncertainStateCount = 0;
  let blankCount = 0;
  let correctionCount = 0;
  let meaningfulCorrectionCount = 0;

  let dualEvalTotal = 0;
  let dualEvalArbitrated = 0;
  let recognitionUncertainCount = 0;
  let gradingIssueCount = 0;
  let policyIssueCount = 0;
  let consistencyIssueCount = 0;
  let formatWarningCount = 0;

  let trackedRecords = 0;
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cachedTokens = 0;
  let reasoningTokens = 0;

  for (const record of list) {
    const state = record?.state || 'unknown';
    byState[state] = (byState[state] || 0) + 1;
    if (state === 'submitted') submittedCount++;
    else if (state === 'review') pendingReviewCount++;
    else if (state === 'paused') pausedCount++;
    else if (state === 'uncertain') uncertainStateCount++;

    if (record?.blankDetection?.isBlank) blankCount++;

    const presetName = record?.presetName || '未命名方案';
    let presetEntry = presetMap.get(presetName);
    if (!presetEntry) {
      presetEntry = {
        presetName,
        total: 0,
        scoredCount: 0,
        _scoreSum: 0,
        correctionCount: 0,
        arbitratedCount: 0,
        totalTokens: 0,
        cachedTokens: 0
      };
      presetMap.set(presetName, presetEntry);
    }
    presetEntry.total++;

    const score = record?.result?.score;
    if (typeof score === 'number' && Number.isFinite(score)) {
      scoredCount++;
      scoreSum += score;
      presetEntry.scoredCount++;
      presetEntry._scoreSum += score;
    }

    if (isCorrected(record)) {
      correctionCount++;
      presetEntry.correctionCount++;
      if (isMeaningfulCorrectionReason(record?.correctionReason)) meaningfulCorrectionCount++;
    }

    const arbitrated = wasArbitrated(record);
    if (record?.result?.dualEval || record?.originalResult?.dualEval) {
      dualEvalTotal++;
    }
    if (arbitrated) {
      dualEvalArbitrated++;
      presetEntry.arbitratedCount++;
    }

    if (record?.result?.recognition?.status === 'uncertain' || Boolean(record?.result?.recognitionWarning)) {
      recognitionUncertainCount++;
    }
    if (Array.isArray(record?.result?.gradingIssues) && record.result.gradingIssues.length > 0) {
      gradingIssueCount++;
    }
    if (Array.isArray(record?.result?.policyAudit?.policyIssues) && record.result.policyAudit.policyIssues.length > 0) {
      policyIssueCount++;
    }
    if (Array.isArray(record?.result?.policyAudit?.consistencyIssues) && record.result.policyAudit.consistencyIssues.length > 0) {
      consistencyIssueCount++;
    }
    if (record?.result?.formatWarning) {
      formatWarningCount++;
    }

    const usage = record?.result?.totalUsage || record?.originalResult?.totalUsage;
    if (usage && typeof usage === 'object') {
      trackedRecords++;
      calls += Number(usage.calls) || 0;
      inputTokens += Number(usage.inputTokens) || 0;
      outputTokens += Number(usage.outputTokens) || 0;
      totalTokens += Number(usage.totalTokens) || 0;
      cachedTokens += Number(usage.cachedTokens) || 0;
      reasoningTokens += Number(usage.reasoningTokens) || 0;
      presetEntry.totalTokens += Number(usage.totalTokens) || 0;
      presetEntry.cachedTokens += Number(usage.cachedTokens) || 0;
    }
  }

  const byPreset = [...presetMap.values()]
    .map(({ _scoreSum, ...entry }) => ({
      ...entry,
      averageScore: entry.scoredCount ? Number((_scoreSum / entry.scoredCount).toFixed(2)) : null
    }))
    .sort((a, b) => b.total - a.total || a.presetName.localeCompare(b.presetName, 'zh-CN'));

  return {
    total: list.length,
    byState,
    scoredCount,
    submittedCount,
    pendingReviewCount,
    pausedCount,
    uncertainStateCount,
    blankCount,
    averageScore: scoredCount ? Number((scoreSum / scoredCount).toFixed(2)) : null,
    correctionCount,
    meaningfulCorrectionCount,
    correctionRate: scoredCount ? Number((correctionCount / scoredCount).toFixed(4)) : 0,
    dualEval: {
      total: dualEvalTotal,
      arbitrated: dualEvalArbitrated,
      arbitrationRate: dualEvalTotal ? Number((dualEvalArbitrated / dualEvalTotal).toFixed(4)) : 0
    },
    recognition: {
      uncertainCount: recognitionUncertainCount
    },
    verification: {
      gradingIssueCount,
      policyIssueCount,
      consistencyIssueCount,
      formatWarningCount
    },
    usage: {
      trackedRecords,
      calls,
      inputTokens,
      outputTokens,
      totalTokens,
      cachedTokens,
      reasoningTokens,
      cacheHitRate: inputTokens > 0 ? Number((cachedTokens / inputTokens).toFixed(4)) : 0,
      avgTokensPerRecord: trackedRecords > 0 ? Math.round(totalTokens / trackedRecords) : 0
    },
    byPreset
  };
}

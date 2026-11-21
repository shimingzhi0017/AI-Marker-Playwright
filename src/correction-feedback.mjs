export const MAX_CALIBRATION_NOTES_LENGTH = 2000;

const DEFAULT_CORRECTION_REASONS = new Set(['教师在界面修改', '教师修改评分依据']);

function stripRulePrefix(line) {
  return String(line || '').trim().replace(/^(?:[-*•]\s*|\d+[.、．]\s*)/u, '').trim();
}

function cleanCalibrationLines(notes) {
  const rawLines = Array.isArray(notes)
    ? notes.flatMap(entry => String(entry || '').split(/\r?\n/u))
    : typeof notes === 'string'
      ? notes.split(/\r?\n/u)
      : [];
  const lines = [];
  const seen = new Set();
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = stripRulePrefix(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lines.push(trimmed);
  }
  return lines;
}

export function isMeaningfulCorrectionReason(reason) {
  if (typeof reason !== 'string') return false;
  const cleaned = reason.replace(/[\r\n]+/gu, ' ').trim();
  return Boolean(cleaned) && !DEFAULT_CORRECTION_REASONS.has(cleaned);
}

export function normalizeCalibrationNotes(notes) {
  const joined = cleanCalibrationLines(notes).join('\n');
  if (joined.length > MAX_CALIBRATION_NOTES_LENGTH) {
    throw Error('教师校标补充最多2000字，请精简后再添加');
  }
  return joined;
}

export function appendCalibrationRule(existing, rule) {
  const cleanRule = typeof rule === 'string' ? rule.replace(/[\r\n]+/gu, ' ').trim() : '';
  const baseText = typeof existing === 'string' ? existing.trim() : normalizeCalibrationNotes(existing);
  if (!isMeaningfulCorrectionReason(cleanRule)) return baseText;

  const bareRule = stripRulePrefix(cleanRule);
  if (!bareRule) return baseText;

  const existingLines = cleanCalibrationLines(baseText);
  if (existingLines.some(line => stripRulePrefix(line) === bareRule)) {
    return existingLines.join('\n');
  }

  const next = existingLines.length ? `${existingLines.join('\n')}\n- ${bareRule}` : `- ${bareRule}`;
  if (next.length > MAX_CALIBRATION_NOTES_LENGTH) {
    throw Error('教师校标补充最多2000字，请精简后再添加');
  }
  return next;
}

export function formatCalibrationNotesBlock(notes) {
  const cleaned = cleanCalibrationLines(notes).join('\n');
  if (!cleaned) return '';
  return `【教师校标补充（人工改分沉淀，本任务优先遵循）】\n${cleaned}`;
}

export function collectPresetCorrections(records, presetName, { limit = 50 } = {}) {
  const scopedName = typeof presetName === 'string' && presetName.trim() ? presetName : '';
  const items = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue;
    if (scopedName && record.presetName !== scopedName) continue;
    if (!record.originalResult && !isMeaningfulCorrectionReason(record.correctionReason)) continue;

    const originalScore = Number.isFinite(record.originalResult?.score)
      ? record.originalResult.score
      : Number.isFinite(record.result?.score)
        ? record.result.score
        : null;
    const finalScore = Number.isFinite(record.result?.score) ? record.result.score : null;
    const delta = originalScore !== null && finalScore !== null
      ? Math.round((finalScore - originalScore) * 100) / 100
      : 0;
    const reason = typeof record.correctionReason === 'string'
      ? record.correctionReason.replace(/[\r\n]+/gu, ' ').trim()
      : '';

    items.push({
      id: record.id || '',
      time: record.time || '',
      submissionCode: record.submissionCode || '',
      presetName: record.presetName || '',
      originalScore,
      finalScore,
      delta,
      reason,
      hasCustomReason: isMeaningfulCorrectionReason(reason),
      studentAnswer: String(record.result?.studentAnswer || record.originalResult?.studentAnswer || '').trim().slice(0, 200),
      originalComment: String(record.originalResult?.comment || '').trim().slice(0, 240),
      finalComment: String(record.result?.comment || '').trim().slice(0, 240)
    });
  }

  items.sort((a, b) => (Date.parse(b.time || '') || 0) - (Date.parse(a.time || '') || 0));
  return Number.isFinite(limit) ? items.slice(0, Math.max(0, limit)) : items;
}

export function summarizeCorrections(records, presetName, { existingText = '' } = {}) {
  const scopedName = typeof presetName === 'string' && presetName.trim() ? presetName : '';
  const scopedRecords = (Array.isArray(records) ? records : []).filter(record =>
    record && typeof record === 'object' && (!scopedName || record.presetName === scopedName)
  );
  const allItems = collectPresetCorrections(scopedRecords, scopedName, { limit: Infinity });
  const correctedCount = allItems.length;
  const raisedCount = allItems.filter(item => item.delta > 0).length;
  const loweredCount = allItems.filter(item => item.delta < 0).length;
  const commentOnlyCount = allItems.filter(item => item.delta === 0).length;
  const averageDelta = correctedCount
    ? Math.round((allItems.reduce((sum, item) => sum + item.delta, 0) / correctedCount) * 100) / 100
    : 0;

  const grouped = new Map();
  for (const item of allItems) {
    if (!item.hasCustomReason) continue;
    const entry = grouped.get(item.reason) || { reason: item.reason, count: 0, raised: 0, lowered: 0, sampleIds: [] };
    entry.count++;
    if (item.delta > 0) entry.raised++;
    else if (item.delta < 0) entry.lowered++;
    if (item.id && entry.sampleIds.length < 10) entry.sampleIds.push(item.id);
    grouped.set(item.reason, entry);
  }

  const topReasons = [...grouped.values()].sort((a, b) => b.count - a.count);
  const existing = String(existingText || '');
  const suggestedRules = topReasons
    .filter(entry => !existing.includes(stripRulePrefix(entry.reason)))
    .slice(0, 10)
    .map(entry => ({ rule: entry.reason, count: entry.count, raised: entry.raised, lowered: entry.lowered }));

  let policyHint = '';
  if (raisedCount >= 3 && raisedCount >= loweredCount * 2) {
    policyHint = '近期人工调高分数较多（模型偏严），建议检查评分口径是否可放宽，或将常见免扣情形沉淀到校标补充。';
  } else if (loweredCount >= 3 && loweredCount >= raisedCount * 2) {
    policyHint = '近期人工调低分数较多（模型偏松），建议检查评分口径或将常见误给分边界沉淀到校标补充。';
  }

  return {
    presetName: scopedName,
    totalRecords: scopedRecords.length,
    correctedCount,
    raisedCount,
    loweredCount,
    commentOnlyCount,
    averageDelta,
    topReasons,
    suggestedRules,
    policyHint,
    items: allItems.slice(0, 50)
  };
}

export function formatCorrectionsForRubric(corrections) {
  if (typeof corrections === 'string') return corrections.trim().slice(0, 3000);
  if (!Array.isArray(corrections) || !corrections.length) return '';

  const lines = [];
  let length = 0;
  for (const [index, item] of corrections.slice(0, 12).entries()) {
    if (!item || typeof item !== 'object') continue;
    const orig = Number.isFinite(item.originalScore) ? item.originalScore : '未知';
    const finalScore = Number.isFinite(item.finalScore) ? item.finalScore : '未知';
    const reason = typeof item.reason === 'string' && item.reason.trim() ? `；原因：${item.reason.trim()}` : '';
    const answer = typeof item.studentAnswer === 'string' && item.studentAnswer.trim()
      ? `；作答摘要：${item.studentAnswer.trim().slice(0, 80)}`
      : '';
    const line = `${index + 1}. 原分${orig}→实分${finalScore}${reason}${answer}`;
    const addedLength = (lines.length ? 1 : 0) + line.length;
    if (length + addedLength > 3000) break;
    lines.push(line);
    length += addedLength;
  }
  return lines.join('\n');
}

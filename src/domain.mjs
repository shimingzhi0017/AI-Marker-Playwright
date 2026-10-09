import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(new URL('../vendor/prompt.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../vendor/score.js', import.meta.url), 'utf8') + '\nglobalThis.calculator=ScoreCalculator;', context);
export const fieldText = context.extractFieldText;
export const fieldImages = context.collectFieldImages;
export function maxScore(config) {
  const units = config.scoring?.units || [];
  return units.length ? units.reduce((s, u) => s + Number(u.maxScore), 0) : Number(config.scoring?.maxScore);
}
export function validateConfig(config) {
  if (!fieldText(config.answer).trim() || !fieldText(config.rubric).trim()) throw Error('参考答案和评分标准不能为空');
  if (!Number.isFinite(maxScore(config)) || maxScore(config) <= 0) throw Error('满分配置无效');
  const units = config.scoring?.units || [];
  for (const unit of units) if (!unit.label || !Number.isFinite(unit.maxScore) || unit.maxScore <= 0) throw Error('评分单元配置无效');
  if (new Set(units.map(u => u.label)).size !== units.length) throw Error('评分单元名称不能重复');
  if(config.scoring?.roundStep!==undefined&&(!Number.isFinite(config.scoring.roundStep)||config.scoring.roundStep<=0))throw Error('取整步长无效');
  if(config.scoring?.roundMethod&&!['round','floor','ceil'].includes(config.scoring.roundMethod))throw Error('取整方式无效');
  for(const u of units)if(u.roundStep!==undefined&&(!Number.isFinite(u.roundStep)||u.roundStep<=0))throw Error('分项步长无效');
}
export function promptFor(config) {
  const units = config.scoring?.units || [];
  const cfg = { ...config, maxScore: maxScore(config), subQuestions: units.map((u, i) => ({ ...u, id: String(i) })) };
  const original = units.length > 1 ? context.buildSubQuestionPrompt(cfg) : context.buildStructuredPrompt(cfg);
  const input = original.split('===== 输出要求 =====')[0];
  const diligence = config.scoring?.diligence;
  const diligencePrompt = diligence?.enabled ? `\ndiligenceLevel为1到5的整数，参考标准：${diligence.criteria || '字数较多且书写较为工整'}；学生答案不超过15字或未作答时为1。` : '\ndiligenceLevel固定为0。';
  const unitPrompt = `\n网页评分框共${units.length}个，标签、满分和顺序为：${JSON.stringify(units.map(u => ({ label: u.label, maxScore: u.maxScore })))}。subScores对应网页评分框，不对应评分标准中的小问或评分点。${units.length === 1 ? `只有一个总分框时，subScores必须仅有一项，label固定为${JSON.stringify(units[0].label)}，score等于总分；小问明细写在comment里。` : ''}`;
  return input + diligencePrompt + unitPrompt + `\n读取完整答题区，忽略明确划掉的旧内容，识别归属明确的替代内容；模糊内容不得猜测。严格按照评分标准评分。\n唯一输出格式为JSON对象，不要返回Markdown或【得分】等段落。score必须是JSON数字，不能是字符串、空值或“数值总分”等占位文字，范围为0到${maxScore(config)}。subScores按下列标签和顺序返回，分数之和必须等于score；无评分单元时返回空数组。示例中的0仅说明数字类型，不代表本份应得0分。\n` +
    JSON.stringify({ studentAnswer: '实际识别内容', score: 0, comment: '逐项评分依据和分数计算', diligenceLevel: 0, subScores: units.map(u => ({ label: u.label, score: 0 })) });
}
export function validateResult(result, config) {
  if (!result || !Number.isFinite(result.score)) throw Error(`模型总分无效：score必须是数字，收到${result?.score === undefined ? '缺失字段' : JSON.stringify(result.score)}；本题满分${maxScore(config)}。`);
  if (result.score < 0 || result.score > maxScore(config)) throw Error(`模型总分越界：收到${result.score}，允许范围0到${maxScore(config)}。`);
  const units = config.scoring?.units || [];
  if (units.length) {
    if (!Array.isArray(result.subScores) || result.subScores.length !== units.length) throw Error(`模型评分单元不完整：网页需要${units.length}项，模型返回${Array.isArray(result.subScores) ? result.subScores.length : 0}项。`);
    result.subScores.forEach((s, i) => {
      if (s.label !== units[i].label || !Number.isFinite(s.score) || s.score < 0 || s.score > units[i].maxScore) throw Error('评分单元名称、顺序或分数无效');
    });
    if (Math.abs(result.subScores.reduce((s, u) => s + u.score, 0) - result.score) > 1e-8) throw Error('模型总分与单元合计不一致');
  }
  return result;
}
export function parseResult(text, config) {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let result;
  try { result = JSON.parse(clean); } catch { throw Error('模型没有返回完整JSON评分结果'); }
  // Some compatible endpoints return numbers as strings. Accept only an entire numeric literal.
  const numeric = value => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : value;
  if (result && typeof result === 'object') {
    result.score = numeric(result.score);
    if (Array.isArray(result.subScores)) result.subScores.forEach(unit => { if (unit && typeof unit === 'object') unit.score = numeric(unit.score); });
    if (Array.isArray(result.scoringDetails)) result.scoringDetails.forEach(unit => { if (unit && typeof unit === 'object') unit.score = numeric(unit.score); });
  }
  if (result?.scoringDetails !== undefined) validateScoringDetails(result.scoringDetails, result.score, maxScore(config));
  const units = config.scoring?.units || [];
  if (units.length === 1 && Array.isArray(result?.subScores) && result.subScores.length > 1) {
    validateResult(result, { ...config, scoring: { ...config.scoring, units: [], maxScore: maxScore(config) } });
    const details = result.subScores;
    validateScoringDetails(details, result.score, maxScore(config));
    if (result.scoringDetails && JSON.stringify(result.scoringDetails.map(s => [s.label, s.score])) !== JSON.stringify(details.map(s => [s.label, s.score]))) throw Error('模型两组评分明细不一致，无法汇总');
    result.scoringDetails = structuredClone(details);
    result.subScores = [{ label: units[0].label, score: result.score }];
    result.formatWarning = `模型返回了${details.length}个小问明细，已核对合计并汇总到唯一的${units[0].label}总分框，请人工确认。`;
  }
  return validateResult(result, config);
}
export function validateScoringDetails(details, score, maximum) {
  if (!Array.isArray(details) || !details.length || details.some(s => !s || typeof s.label !== 'string' || !s.label.trim() || !Number.isFinite(s.score) || s.score < 0 || s.score > maximum) || new Set(details.map(s => s.label)).size !== details.length) throw Error('模型小问评分明细无效，无法逐项核对');
  if (Math.abs(details.reduce((sum, s) => sum + s.score, 0) - score) > 1e-8) throw Error('模型总分与小问明细合计不一致，无法汇总');
}
export function calculate(result, config) {
  const units = config.scoring?.units || [];
  const calculated = context.calculator.calculate({ aiScore: result.score, maxScore: maxScore(config),
    diligenceLevel: (result.studentAnswer || '').replace(/\s/g, '').length > 15 ? result.diligenceLevel || 0 : 0,
    scoringConfig: { roundStep: 1, roundMethod: 'round', ...config.scoring },
    aiUnitScores: units.length ? result.subScores.map((u, i) => ({ ...u, ...units[i], score: u.score })) : null });
  const final = { ...result, rawScore: result.score, score: calculated.finalScore,
    subScores: calculated.finalUnitScores || [], calculation: calculated.breakdown };
  return validateResult(final, config);
}

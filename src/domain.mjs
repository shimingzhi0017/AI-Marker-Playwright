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
  return original + '\n读取完整答题区，忽略明确划掉的旧内容，识别归属明确的替代内容；模糊内容不得猜测。\n最终只返回JSON对象，不要返回Markdown：' +
    JSON.stringify({ studentAnswer: '实际识别内容', score: '数值总分', comment: '评分依据', diligenceLevel: 0, subScores: units.map(u => ({ label: u.label, score: '数值分数' })) });
}
export function validateResult(result, config) {
  if (!result || !Number.isFinite(result.score) || result.score < 0 || result.score > maxScore(config)) throw Error('模型总分无效或越界');
  const units = config.scoring?.units || [];
  if (units.length) {
    if (!Array.isArray(result.subScores) || result.subScores.length !== units.length) throw Error('模型评分单元不完整');
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
  return validateResult(result, config);
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

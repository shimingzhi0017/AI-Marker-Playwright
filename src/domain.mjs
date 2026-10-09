import fs from 'node:fs';
import vm from 'node:vm';
import { scoringLabelKey, matchScoringItem } from '../ui/scoring-labels.js';

const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(new URL('../vendor/prompt.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../vendor/score.js', import.meta.url), 'utf8') + '\nglobalThis.calculator=ScoreCalculator;', context);
export const fieldText = context.extractFieldText;
export const fieldImages = context.collectFieldImages;
function rubricScoringItems(config) {
  // Read only explicit item maxima; never infer points from deductions or examples.
  const number = '(?:[①-⑳]|\\d+[.、．]|[（(]\\d+[）)]|[一二三四五六七八九十]+、)';
  const pattern = new RegExp(`^\\s*(?:${number}\\s*)?([^\\n：:]+)[：:]\\s*(?:满分\\s*)?(\\d+(?:\\.\\d+)?)\\s*分[。.]?\\s*$`, 'gmu');
  let items = [...fieldText(config.rubric).matchAll(pattern)]
    .map((match, index) => ({ id: `scoring-item-${index + 1}`, label: match[1].trim(), maxScore: Number(match[2]) }));
  const valid=items=>items.length && items.every(item=>item.maxScore>0) &&
    new Set(items.map(item=>scoringLabelKey(item.label))).size===items.length &&
    Math.abs(items.reduce((sum,item)=>sum+item.maxScore,0)-maxScore(config))<1e-8;
  if(!valid(items)) {
    // Explicit all-or-nothing headings are maxima, unlike isolated deduction examples.
    const heading=/^\s*(?:[一二三四五六七八九十]+、|[①-⑳]\s*)?((?:第\s*)?[（(]\d+[）)]\s*(?:问)?[^\n：:]*)[：:]\s*(?:只能给|只给|得分为)\s*0\s*分\s*(?:或|或者|、)\s*(\d+(?:\.\d+)?)\s*分[。.]?\s*$/gmu;
    items=[...fieldText(config.rubric).matchAll(heading)].map((m,i)=>({id:`scoring-item-${i+1}`,label:m[1].trim(),maxScore:Number(m[2])}));
  }
  if(!valid(items)) {
    // Markdown rubric sections have explicit awarded scores within each numbered heading.
    const sections=[...fieldText(config.rubric).matchAll(/^\s*#{1,6}\s+([^\n]+)\s*$/gmu)];
    items=[];
    for(let i=0;i<sections.length;i++) {
      const label=sections[i][1].trim();
      if(!/^(?:第\s*)?[（(]\d+[）)]/u.test(label))continue;
      const body=fieldText(config.rubric).slice(sections[i].index+sections[i][0].length,sections[i+1]?.index);
      const awards=[...body.matchAll(/^\s*[-*]\s*(\d+(?:\.\d+)?)\s*分\s*[：:]/gmu)].map(m=>Number(m[1]));
      if(!awards.length){items=[];break;}
      items.push({id:`scoring-item-${items.length+1}`,label,maxScore:Math.max(...awards)});
    }
  }
  return items.length && items.every(item=>item.maxScore>0) &&
    new Set(items.map(item=>scoringLabelKey(item.label))).size===items.length &&
    Math.abs(items.reduce((sum,item)=>sum+item.maxScore,0)-maxScore(config))<1e-8 ? items : [];
}
export function scoringItemSchema(config) {
  const fromRubric = rubricScoringItems(config);
  if (fromRubric.length) return fromRubric;
  if (Array.isArray(config.scoring?.items) && config.scoring.items.length) {
    const items = config.scoring.items;
    if (items.some(item=>!item || typeof item.id!=='string' || !item.id.trim() || typeof item.label!=='string' || !item.label.trim() || !Number.isFinite(item.maxScore) || item.maxScore<=0) || new Set(items.map(item=>item.id)).size!==items.length || Math.abs(items.reduce((sum,item)=>sum+item.maxScore,0)-maxScore(config))>1e-8) throw Error('固定评分项配置无效，请核对编号和满分合计');
    return items;
  }
  return [];
}
function applyScoringItemSchema(result, config) {
  const schema = scoringItemSchema(config);
  if (!schema.length) return;
  const details = result.scoringDetails;
  if (!Array.isArray(details) || details.length !== schema.length) throw Error(`模型评分项不完整：评分标准要求${schema.length}项，请按固定编号返回。`);
  const used = new Set();
  for (const detail of details) {
    const item = matchScoringItem(detail,schema,details);
    if (!item || used.has(item.id) || detail.score > item.maxScore) throw Error('模型评分项编号缺失、重复、不对应或分项越界，请核对评分标准');
    used.add(item.id); detail.originalLabel = detail.label; detail.label = item.label; detail.id = item.id; detail.maxScore = item.maxScore;
  }
  result.scoringDetails = schema.map(item=>details.find(detail=>detail.id===item.id));
}
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
  const unitPrompt = `\n网页评分框共${units.length}个，标签、满分和顺序为：${JSON.stringify(units.map(u => ({ label: u.label, maxScore: u.maxScore })))}。subScores对应网页评分框，不对应评分标准中的小问或评分点。${units.length === 1 ? `只有一个总分框时，subScores必须仅有一项，label固定为${JSON.stringify(units[0].label)}，score等于总分；小问明细写在scoringDetails里，comment只补充说明。` : ''}`;
  const readingPrompt = `\n书写识别要求：仅检查提供的学生答题图片范围，逐张扫描整个区域，包括横线上方、右侧、边缘、涂抹旁和箭头指向的位置，不得只读取预设填空位置；不扩大答题范围。先忠实转录学生实际保留的书写，再对照参考答案评分。明确删除的旧内容不得计入；归属明确的替代答案必须保留。不得根据参考答案、常见公式或语义补齐、纠正、改写学生的字词、数字、符号或缺失步骤。无法辨认处写[无法辨认]，不得当成空白或自行猜测；无法确定答案归属、是否删除或替换且可能影响得分时必须报告疑点。判定采用适度宽松标准：可辨认的潦草字、位置偏移、横线上方或右侧作答、明确划掉的旧答案、清楚的箭头或替换关系，只写入notes，不属于评分疑点。明确写错、漏步骤或未作答，按标准给分或扣分，不因答案不正确而报告识别疑点。局部看不清但不参与计分、且不影响任何评分点结论时只记录说明；只有无法确认的有效答案、关键数字或符号可能改变得分时才报告评分疑点，不要求每个笔画都完美清晰。禁止利用参考答案猜测仍然适用。\n必须返回recognition对象：{status:"clear"或"uncertain",coverageChecked:true或false,notes:[实际观察到的涂改或位置说明],issues:[{location:图片序号及区域或小问位置,observed:实际可见内容,reason:无法确认的原因,affectsScore:true或false,impactReason:对具体评分点的影响说明}]}。仅在完整检查了所有题图区域且没有影响评分的识别疑点时status为clear、coverageChecked为true；有影响评分的疑点时status为uncertain，issues逐项列出；affectsScore为false必须具体说明为什么不影响任何评分点，不得把关键答案看不清标为无影响。studentAnswer仅记录可见的有效作答及无法辨认标记；评分疑点交由程序根据三评一致性及用户的人工/仲裁设置处理，不得为普通书写差异机械报告uncertain。`;
  const schema = scoringItemSchema(config);
  const schemaPrompt = schema.length ? `\n当前任务评分标准确定的评分项共${schema.length}项：${JSON.stringify(schema)}。scoringDetails必须逐项返回{id,label,score,maxScore,studentAnswer,reason}，id严格复制清单固定编号，一项一次不得遗漏，不得自创新编号；label只用于展示，禁止改名。主评、复评、仲裁共用同一清单，按清单顺序返回。` : '\nscoringDetails必须根据当前评分标准的独立计分项逐项返回{label,score,maxScore,studentAnswer,reason}。数量由当前评分标准决定，没有固定数量；不得沿用其他题目的分项，不得擅自合并或拆分评分点。每项满分依照标准，总分为各项得分之和。网页评分框数量不决定评分明细数量。';
  return input + diligencePrompt + unitPrompt + readingPrompt + schemaPrompt + `\n读取完整答题区，忽略明确划掉的旧内容，识别归属明确的替代内容；模糊内容不得猜测。严格按照评分标准评分。comment每个评分项独占一段，使用换行分点论述，末尾总分另起一段。涉及公式必须使用LaTeX数学标记（行内用$...$，分式用\\frac{分子}{分母}，上下标用_{...}和^{...}）；JSON中的反斜杠必须正确转义。不得输出代码块。comment按评分标准逐项写明满分、学生答案、给分或扣分依据和该项得分，最后列出总分计算；不得只给总分或笼统评价。\n唯一输出格式为JSON对象，不要返回Markdown或【得分】等段落。score必须是JSON数字，不能是字符串、空值或“数值总分”等占位文字，范围为0到${maxScore(config)}。subScores按下列标签和顺序返回，分数之和必须等于score；无评分单元时返回空数组。示例中的0仅说明数字类型，不代表本份应得0分。\n` +
    JSON.stringify({ studentAnswer: '实际识别内容', recognition: { status: 'clear', coverageChecked: true, notes: [], issues: [] }, score: 0, comment: '逐项评分依据和分数计算', diligenceLevel: 0, subScores: units.map(u => ({ label: u.label, score: 0 })), ...(schema.length ? {scoringDetails:schema.map(item=>({...item,score:0,studentAnswer:'实际识别内容',reason:'依据当前标准'}))} : {}) });
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
export function recognitionWarning(result) {
  const reading = result?.recognition;
  if (!reading || !['clear', 'uncertain'].includes(reading.status) || typeof reading.coverageChecked !== 'boolean' ||
      !Array.isArray(reading.notes) || !reading.notes.every(note => typeof note === 'string') ||
      !Array.isArray(reading.issues) || !reading.issues.every(issue => issue &&
        ['location', 'observed', 'reason'].every(key => typeof issue[key] === 'string' && issue[key].trim()))) {
    return '模型未提供完整的书写识别检查，请核对原图后确认评分。';
  }
  const scoringIssues = reading.issues.filter(issue => !(issue.affectsScore === false && typeof issue.impactReason === 'string' && issue.impactReason.trim()));
  if (!reading.coverageChecked || scoringIssues.length || (reading.status === 'uncertain' && !reading.issues.length)) {
    return '书写识别存疑或答题区域尚未检查完整，请核对原图；当前分数为待确认评分。';
  }
  return '';
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
  applyScoringItemSchema(result, config);
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

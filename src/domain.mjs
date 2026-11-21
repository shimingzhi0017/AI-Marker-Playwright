import fs from 'node:fs';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';
import { scoringLabelKey, matchScoringItem } from '../ui/scoring-labels.js';
import { gradingPolicyForRubric, gradingModeInstruction, activeGradingMode, stripEmbeddedPolicyTemplates } from '../ui/rubric-prompts.js';
import { parseModelJson } from './model-json.mjs';
import { formatCalibrationNotesBlock, MAX_CALIBRATION_NOTES_LENGTH } from './correction-feedback.mjs';

const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(new URL('../vendor/score.js', import.meta.url), 'utf8') + '\nglobalThis.calculator=ScoreCalculator;', context);

function fieldImageList(field) {
  return field && typeof field === 'object' && Array.isArray(field.images) ? field.images : [];
}

export function fieldText(field) {
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object') {
    const t = field.text;
    if (typeof t === 'string') return t;
    if (t && typeof t === 'object' && typeof t.text === 'string') return t.text;
  }
  return '';
}

export function fieldImages(config) {
  return [...fieldImageList(config.question), ...fieldImageList(config.answer), ...fieldImageList(config.rubric)];
}

function buildImageAnnotation(config) {
  const qLen = fieldImageList(config.question).length;
  const aLen = fieldImageList(config.answer).length;
  const rLen = fieldImageList(config.rubric).length;
  if (qLen + aLen + rLen === 0) return '';

  const parts = [];
  let idx = 1;
  if (qLen > 0) {
    parts.push(`第${idx}-${idx + qLen - 1}张为题目配图`);
    idx += qLen;
  }
  if (aLen > 0) {
    parts.push(`第${idx}-${idx + aLen - 1}张为参考答案配图`);
    idx += aLen;
  }
  if (rLen > 0) {
    parts.push(`第${idx}-${idx + rLen - 1}张为评分标准配图`);
  }
  return `\n（图片说明：${parts.join('，')}）`;
}

function buildInputSection(config, units) {
  const questionText = fieldText(config.question);
  const answerText = fieldText(config.answer);
  const rubricText = stripEmbeddedPolicyTemplates(config.rubric, { strictness: config.scoring?.strictness });
  const imgAnnotation = buildImageAnnotation(config);

  let prompt = '你是阅卷老师，请按本次明确指定的评分口径评价学生实际作答。\n\n===== 输入信息 =====';
  if (units.length > 1) {
    if (questionText) prompt += `\n【题目】${imgAnnotation}\n${questionText}`;
    if (answerText) prompt += `\n【参考答案】\n${answerText}`;
    if (rubricText) prompt += `\n【评分标准】\n${rubricText}`;
    prompt += '\n【各小题评分要求】\n';
    for (const sq of units) {
      const maxScoreText = sq.maxScore > 0 ? `满分${sq.maxScore}分` : '满分未指定，请根据常规满分评判';
      prompt += `\n### ${sq.label}（${maxScoreText}）`;
      if (sq.answer) prompt += `\n参考答案：${sq.answer}`;
      if (sq.rubric) prompt += `\n评分标准：${sq.rubric}`;
      prompt += '\n';
    }
  } else {
    const maximum = maxScore(config);
    const maxScoreText = maximum > 0 ? `满分${maximum}分` : '满分未指定，请根据常规满分评判';
    if (questionText) prompt += `\n【题目】${imgAnnotation}\n${questionText}`;
    if (answerText) prompt += `\n【标准答案】\n${answerText}`;
    if (rubricText) prompt += `\n【评分标准】\n${rubricText}`;
    prompt += `\n【满分】\n${maxScoreText}`;
  }

  const calibrationBlock = formatCalibrationNotesBlock(config.calibrationNotes);
  if (calibrationBlock) prompt += `\n${calibrationBlock}`;
  return prompt;
}
function rubricScoringItems(config) {
  // Read only explicit item maxima; never infer points from deductions or examples.
  const number = '(?:[①-⑳]|\\d+[.、．]|[（(]\\d+[）)]|[一二三四五六七八九十]+、)';
  const pattern = new RegExp(`^\\s*(?:${number}\\s*)?([^\\n]+?)[：:]\\s*(?:满分\\s*)?(\\d+(?:\\.\\d+)?)\\s*分[。.]?\\s*$`, 'gmu');
  let items = [...fieldText(config.rubric).matchAll(pattern)]
    .map((match, index) => ({ id: `scoring-item-${index + 1}`, label: match[1].trim(), maxScore: Number(match[2]) }));
  const valid=items=>items.length && items.every(item=>item.maxScore>0) &&
    new Set(items.map(item=>scoringLabelKey(item.label))).size===items.length &&
    Math.abs(items.reduce((sum,item)=>sum+item.maxScore,0)-maxScore(config))<1e-8;
  // A constructed-response question may list several named criteria, each
  // carrying part of that question's maximum. Keep those criteria nested in
  // the rubric, but expose one score detail for the top-level question.
  const questionNumber=item=>item.label.match(/^\s*第\s*[（(](\d+)[）)]\s*问(?=\s|[：:]|$)/u)?.[1];
  const grouped=new Map();
  for(const item of items) {
    const number=questionNumber(item);
    if(!number || /第\s*[（(]?\d+[）)]?\s*(?:空|填空)|\b[Ａ-ＺA-Z]\s*空/u.test(item.label))continue;
    const group=grouped.get(number)||[];group.push(item);grouped.set(number,group);
  }
  const groupedItems=items.filter(item=>!questionNumber(item)||/第\s*[（(]?\d+[）)]?\s*(?:空|填空)|\b[Ａ-ＺA-Z]\s*空/u.test(item.label))
    .concat([...grouped].map(([number,group])=>({id:`scoring-item-question-${number}`,label:`第（${number}）问`,maxScore:group.reduce((sum,item)=>sum+item.maxScore,0)})));
  if(valid(groupedItems))return groupedItems;
  const hasNumberedSubpoints = /^(?:\s*第\s*[（(]\d+[）)]\s*问|\s*[一二三四五六七八九十百]+[、.])[^\n]*满分\s*\d+(?:\.\d+)?\s*分[\s\S]*?(?:^|[。；;]|\s)\d+[、.]\s+/mu.test(fieldText(config.rubric));
  if(!valid(items)) {
    // Explicit all-or-nothing headings are maxima, unlike isolated deduction examples.
    const heading=/^\s*(?:[一二三四五六七八九十]+、|[①-⑳]\s*)?((?:第\s*)?[（(]\d+[）)]\s*(?:问)?[^\n：:]*)[：:]\s*(?:只能给|只给|得分为)\s*0\s*分\s*(?:或|或者|、)\s*(\d+(?:\.\d+)?)\s*分[。.]?\s*$/gmu;
    items=[...fieldText(config.rubric).matchAll(heading)].map((m,i)=>({id:`scoring-item-${i+1}`,label:m[1].trim(),maxScore:Number(m[2])}));
  }
  if(!valid(items) || hasNumberedSubpoints) {
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
  if(!valid(items)) {
    // Some rubrics put each question's maximum in its heading, then list numbered
    // scoring points inline or in a paragraph. Extract only explicit per-point
    // awards and require them to add up to the configured total.
    const text=fieldText(config.rubric);
    const headings=[...text.matchAll(/^\s*((?:第\s*[（(]\d+[）)]\s*问|[一二三四五六七八九十百]+[、.]|\d+[、.])[^\n]*?满分\s*\d+(?:\.\d+)?\s*分[^\n]*)$/gmu)];
    items=[];
    for(let h=0;h<headings.length;h++) {
      const start=headings[h].index+headings[h][0].length;
      const nextHeading=headings[h+1]?.index ?? text.length;
      const bodyEnd=text.slice(start,nextHeading).search(/^\s*全题合计\b/gmu);
      const end=bodyEnd<0?nextHeading:start+bodyEnd;
      const body=text.slice(start,end);
      const points=[...body.matchAll(/(?:^|[。；;]|\s)(\d+)[、.]\s*/gmu)];
      if(!points.length){items=[];break;}
      for(let i=0;i<points.length;i++) {
        const pointStart=points[i].index+points[i][0].length;
        const pointEnd=points[i+1]?.index ?? body.length;
        const point=body.slice(pointStart,pointEnd).trim();
        const award=point.match(/(?:得|共)\s*(\d+(?:\.\d+)?)\s*分/u);
        if(!award){items=[];break;}
        const headingLabel=headings[h][1].replace(/\s+/gu,' ').replace(/满分\s*\d+(?:\.\d+)?\s*分.*$/u,'').replace(/[：:]\s*$/u,'').trim();
        const label=`${headingLabel}第${points[i][1]}点：${point.replace(/\s+/gu,' ').slice(0,180)}`;
        items.push({id:`scoring-item-${items.length+1}`,label,maxScore:Number(award[1])});
      }
      if(!items.length)break;
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
function scoringSchemaError(message, schema, details) {
  const error = Error(message);
  error.code = 'MODEL_SCORING_SCHEMA';
  error.scoringDiagnostics = { expectedItems: schema, receivedCount: Array.isArray(details) ? details.length : 0,
    receivedItems: Array.isArray(details) ? details.map(item=>({id:item?.id,label:item?.label,score:item?.score,maxScore:item?.maxScore})) : [],
    missingIds: schema.filter(item=>!details?.some?.(detail=>detail?.id===item.id)).map(item=>item.id) };
  return error;
}

function normalizeRepeatedScoringItems(result, schema) {
  const details = result?.scoringDetails;
  if (!schema.length || !Array.isArray(details) || details.length <= schema.length) return;
  // A complete, correctly numbered baseline must exist before any row can be
  // discarded. Never infer a missing award from a total or an unknown ID.
  const baseline = schema.map(item=>details.find(detail=>detail?.id===item.id));
  if (baseline.some((detail,index)=>!detail || scoringLabelKey(detail.label)!==scoringLabelKey(schema[index].label) || detail.maxScore!==schema[index].maxScore)) return;
  const withoutId = ({id,...detail})=>detail;
  const extras = details.filter(detail=>!baseline.includes(detail));
  if (extras.some(detail=>!detail || !baseline.some(original=>
    (detail.id===undefined || detail.id===original.id || !schema.some(item=>item.id===detail.id)) &&
    isDeepStrictEqual(withoutId(detail),withoutId(original))))) return;
  result.scoringDetails = baseline;
  result.scoringNormalization = { type:'duplicate-scoring-items', removedItems:structuredClone(extras) };
  result.formatNote = `模型重复输出了${extras.length}个完全相同的评分项；已按固定编号核对完整项目并去重，各项得分未改变。`;
}

function applyScoringItemSchema(result, config) {
  const schema = scoringItemSchema(config);
  if (!schema.length) return;
  const details = result.scoringDetails;
  if (!Array.isArray(details) || details.length !== schema.length) throw scoringSchemaError(`模型评分项不完整：评分标准要求${schema.length}项，实际返回${Array.isArray(details)?details.length:0}项${details?.length>schema.length?'（含多余或重复项）':''}，请按固定编号返回。`,schema,details);
  const used = new Set();
  let positional = false;
  for (const detail of details) {
    const item = matchScoringItem(detail,schema,details);
    if (!item || used.has(item.id)) { positional = true; break; }
    used.add(item.id);
  }
  if(positional) {
    if(details.some(detail=>detail?.id!==undefined) || details.length!==schema.length || details.some((detail,index)=>!detail || typeof detail.label!=='string' || !detail.label.trim() || detail.maxScore!==schema[index].maxScore)) throw scoringSchemaError('模型评分项编号缺失、重复、不对应或分项越界，请核对评分标准',schema,details);
    details.forEach((detail,index)=>{ detail.originalLabel=detail.label;detail.label=schema[index].label;detail.id=schema[index].id;detail.maxScore=schema[index].maxScore; });
  } else {
    for(const detail of details) {
      const item=matchScoringItem(detail,schema,details);
      if(detail.score>item.maxScore)throw scoringSchemaError('模型评分项编号缺失、重复、不对应或分项越界，请核对评分标准',schema,details);
      detail.originalLabel=detail.label;detail.label=item.label;detail.id=item.id;detail.maxScore=item.maxScore;
    }
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
  if(config.scoring?.strictness && !['lenient','normal','strict'].includes(config.scoring.strictness))throw Error('实际阅卷口径无效');
  if(config.calibrationNotes !== undefined && (typeof config.calibrationNotes !== 'string' || config.calibrationNotes.length > MAX_CALIBRATION_NOTES_LENGTH))throw Error('教师校标补充最多2000字');
  for(const u of units)if(u.roundStep!==undefined&&(!Number.isFinite(u.roundStep)||u.roundStep<=0))throw Error('分项步长无效');
}
export function promptFor(config) {
  const units = config.scoring?.units || [];
  const input = `${gradingModeInstruction(config)}\n${buildInputSection(config, units)}\n\n`;
  const diligence = config.scoring?.diligence;
  const solutionPolicy=gradingPolicyForRubric(config.rubric,config.rubricGeneration,config.scoring?.strictness);
  const gradingIssuePrompt='\n必须返回gradingIssues（无疑点返回[]）：仅当已保存标准缺失决定性条款、条款冲突、资料缺失或标答有无法核验疑点时，逐项列{location,reason}并在comment说明依据（不自创扣分/封顶）；普通答错、有效简写/等价解法不属此类，识别疑点写recognition，规则疑点由程序转人工。';
  const step=config.scoring?.roundStep || 1;
  const stepPrompt=`\n${solutionPolicy}\n得分步长：${step}分。步骤分、扣分、scoringDetails得分及总分须为${step}分非负整数倍${step===1?'（禁0.5分）':''}；冲突按${config.scoring?.roundMethod || 'round'}取整并说明。各评分框步长：${JSON.stringify(units.map(u=>({label:u.label,roundStep:u.roundStep||step})))}。`;

  const diligencePrompt = diligence?.enabled ? `\ndiligenceLevel为1-5整数（参考：${diligence.criteria || '字数较多且书写工整'}；≤15字或未作答为1）。` : '\ndiligenceLevel固定为0。';
  const unitPrompt = `\n网页评分框共${units.length}个：${JSON.stringify(units.map(u => ({ label: u.label, maxScore: u.maxScore })))}。subScores对应网页评分框而非标准内小问。${units.length === 1 ? `只有一个总分框时，subScores仅一项且label固定为${JSON.stringify(units[0].label)}、score等于总分，小问明细写scoringDetails。` : ''}`;
  const readingPrompt = `\n书写识别要求：仅扫描学生答题区全图（含横线上方、右侧、边缘、涂抹旁和箭头指向处），不扩大答题范围。先忠实转录最终保留作答（明确删去排除，归属清晰移位计入），不得根据参考答案猜补、改写文字、数字、符号或缺失步骤；看不清写[无法辨认]。判定适度宽松，不要求每个笔画都完美清晰：可辨认潦草、位置偏移与清晰涂改只记入notes；明确写错、漏步骤或未作答按标准扣分，不报识别疑点；仅当无法确认有效内容且可能改分时才标uncertain。解答题遇不同方法时，先独立核验该方法是否符合题设、学科规律与结论，等价有效解法同等给分；题目明确要求特定方法、过程或证明形式时须遵守。\n必须返回recognition:{status:"clear"|"uncertain",coverageChecked:true|false,notes:[],issues:[{location,observed,reason,affectsScore,impactReason}]}：完整检图且无改分疑点才填clear与true；affectsScore为false须说明为何不影响任何评分点；仅报告识别情况，由程序结合单双评/仲裁决定流程。`;
  const schema = scoringItemSchema(config);
  const schemaPrompt = (schema.length ? `\n评分标准固定清单共${schema.length}项：${JSON.stringify(schema)}。scoringDetails须逐项按序返回{id,label,score,maxScore,studentAnswer,reason}，严格复制id且禁止改名、漏项或自创。` : '\nscoringDetails按当前标准独立计分项逐项返回{label,score,maxScore,studentAnswer,reason}，数量由当前评分标准决定，勿沿用他题或擅自拆并，总分为各项之和。') + '\n必须先完成scoringDetails逐项评定，再求和得到score与subScores，严禁先估总分再倒推；输出前核对reason、comment、scoringDetails之和、score及subScores完全一致，存疑时亦仅给出单一当前得分。';
  return input +
    '\n===== 评分策略与步长 =====' + stepPrompt +
    '\n===== 网页评分框与勤勉度 =====' + unitPrompt + diligencePrompt +
    '\n===== 书写识别要求 =====' + readingPrompt +
    '\n===== 规则疑点要求 =====' + gradingIssuePrompt +
    '\n===== 评分项清单与输出要求 =====' + schemaPrompt +
    `\n按本次指定口径与已保存评分标准客观评分。comment按评分项换行分段写明满分、学生作答、给扣分依据和得分，末尾列总分计算；公式用LaTeX（$...$、\\frac{分子}{分母}、_{...}、^{...}）并正确转义JSON反斜杠。\n仅输出合法JSON对象（无代码块或【得分】），score为0到${maxScore(config)}的数字（示例0仅表类型），subScores按上述标签顺序返回且合计等于score（无单元返回[]）：\n` +
    JSON.stringify({ studentAnswer: '实际识别内容', gradingMode:activeGradingMode(config), recognition: { status: 'clear', coverageChecked: true, notes: [], issues: [] }, gradingIssues:[], ...(schema.length ? {scoringDetails:schema.map(item=>({...item,score:0,studentAnswer:'实际识别内容',reason:'依据当前标准'}))} : {}), score: 0, comment: '逐项评分依据和分数计算', diligenceLevel: 0, subScores: units.map(u => ({ label: u.label, score: 0 })) });
}
export function promptPartsFor(config) {
  const system = promptFor(config);
  const referenceImages = fieldImages(config).length;
  const user = referenceImages > 0
    ? `请按系统指令与评分标准审阅附图并仅输出合法 JSON 评分结果：前 ${referenceImages} 张为题目/参考答案/评分标准配图，其余为学生实际作答图片。`
    : '请按系统指令与评分标准审阅学生实际作答图片，并仅输出合法 JSON 评分结果。';
  return { system, user };
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
  let result;
  try { result = parseModelJson(text, { requiredKeys: ['score'] }); }
  catch { throw Error('模型没有返回完整JSON评分结果'); }
  // Some compatible endpoints return numbers as strings. Accept only an entire numeric literal.
  const numeric = value => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : value;
  if (result && typeof result === 'object') {
    result.score = numeric(result.score);
    if (Array.isArray(result.subScores)) result.subScores.forEach(unit => { if (unit && typeof unit === 'object') unit.score = numeric(unit.score); });
    if (Array.isArray(result.scoringDetails)) result.scoringDetails.forEach(unit => { if (unit && typeof unit === 'object') { unit.score = numeric(unit.score); if (unit.maxScore !== undefined) unit.maxScore = numeric(unit.maxScore); } });
  }
  // Repair a redundant total only with a fixed rubric schema or a complete set
  // of explicit item maxima. Keep the warning so independent review is required.
  const configuredUnits=config.scoring?.units || [];
  const schema = scoringItemSchema(config);
  normalizeRepeatedScoringItems(result,schema);
  const details = result?.scoringDetails;
  const hasCompleteMaxima = Array.isArray(details) && details.length > 0 &&
    details.every(item => item && Number.isFinite(item.maxScore) && item.maxScore > 0 && Number.isFinite(item.score) && item.score >= 0 && item.score <= item.maxScore) &&
    Math.abs(details.reduce((sum, item) => sum + item.maxScore, 0) - maxScore(config)) < 1e-8;
  if((schema.length || hasCompleteMaxima) && configuredUnits.length<=1 && Array.isArray(result?.scoringDetails) && result.scoringDetails.length && (result.subScores === undefined || Array.isArray(result.subScores) && result.subScores.length<=1)) {
    // Match every rubric item before using its sum as the authoritative total.
    // No per-item score is changed when correcting redundant total fields.
    applyScoringItemSchema(result,config);
    const sum=result.scoringDetails.reduce((total,item)=>total+item.score,0);
    const subScores = result.subScores || [];
    const hasMatchingUnit = configuredUnits.length===1 && subScores.length === 1 && subScores[0]?.label === configuredUnits[0].label && subScores[0]?.score === sum;
    const hasEmptyUnit = subScores.length === 0;
    const hasRedundantUnit = schema.length && configuredUnits.length===1 && subScores.length===1 && subScores[0]?.label===configuredUnits[0].label && Number.isFinite(subScores[0]?.score) && subScores[0].score>=0 && subScores[0].score<=configuredUnits[0].maxScore;
    if(Number.isFinite(result.score) && result.score>=0 && result.score<=maxScore(config) && (hasMatchingUnit || hasEmptyUnit || hasRedundantUnit)) {
      validateScoringDetails(result.scoringDetails,sum,maxScore(config));
      const repaired = { ...result, score: sum, subScores: configuredUnits.length ? [{ label: configuredUnits[0].label, score: sum }] : [] };
      validateResult(repaired,config);
      if (Math.abs(result.score-sum)>1e-8 || subScores.some(item=>Math.abs(item.score-sum)>1e-8)) {
        result.reportedScore=result.score;
        result.reportedSubScores=structuredClone(subScores);
        const field = Math.abs(result.reportedScore-sum)>1e-8 ? `模型总分字段为${result.reportedScore}` : `模型网页总分字段为${subScores[0].score}`;
        result.formatWarning=`${field}，与完整分项合计${sum}不一致；已按分项合计修正，请人工确认。`;
      }
      result.score=sum;
      result.subScores = repaired.subScores;
    }
  }
  // With multiple webpage fields, their configured labels and maxima define
  // the complete set. Recompute only the total; never distribute points among
  // fields. If rubric details are also present, both representations must agree.
  if (configuredUnits.length>1 && Array.isArray(result?.subScores) && result.subScores.length===configuredUnits.length) {
    const sum=result.subScores.reduce((total,item)=>total+item?.score,0);
    const repaired={...result,score:sum};
    validateResult(repaired,config);
    applyScoringItemSchema(repaired,config);
    if (repaired.scoringDetails!==undefined) validateScoringDetails(repaired.scoringDetails,sum,maxScore(config));
    if (Number.isFinite(result.score) && result.score>=0 && result.score<=maxScore(config) && Math.abs(result.score-sum)>1e-8) {
      result.reportedScore=result.score;
      result.reportedSubScores=structuredClone(result.subScores);
      result.score=sum;
      result.formatWarning=`模型总分字段为${result.reportedScore}，与完整分项合计${sum}不一致；已按分项合计修正，请人工确认。`;
    }
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
  // Validate score type, bounds, and totals before checking the score increment.
  validateResult(result, config);
  const step=config.scoring?.roundStep || 1;
  const aligned=(score,increment)=>Math.abs(score/increment-Math.round(score/increment))<1e-8;
  if(!aligned(result.score,step) || result.scoringDetails?.some(item=>!aligned(item.score,step)) || result.subScores?.some((item,index)=>!aligned(item.score,units[index]?.roundStep||step)))throw Error(`模型得分不符合${step}分步长，请按允许的分值重新评分`);
  return validateResult(result, config);
}
export function validateScoringDetails(details, score, maximum) {
  if (!Array.isArray(details) || !details.length || details.some(s => !s || typeof s.label !== 'string' || !s.label.trim() || !Number.isFinite(s.score) || s.score < 0 || s.score > maximum) || new Set(details.map(s => s.label)).size !== details.length) throw Error('模型小问评分明细无效，无法逐项核对');
  if (details.some(s => s.maxScore !== undefined && (!Number.isFinite(s.maxScore) || s.maxScore<=0 || s.maxScore>maximum || s.score>s.maxScore))) throw Error('模型小问评分明细无效：分项满分无效或得分越界');
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

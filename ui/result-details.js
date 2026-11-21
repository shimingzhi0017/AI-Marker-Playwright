import {renderFeedback, renderInlineFeedback} from './feedback.js';
import { alignScoringItems } from './scoring-labels.js';
import { rubricPrompts } from './rubric-prompts.js';
const items = result => result?.scoringDetails?.length ? result.scoringDetails : result?.subScores || [];
const value = score => Number.isFinite(score) ? `${score} 分` : '未提供';
function formatUsage(usage) {
  if (!usage || typeof usage !== 'object') return '';
  const hasAny = ['inputTokens', 'outputTokens', 'totalTokens'].some(k => Number.isFinite(usage[k]) && usage[k] > 0);
  if (!hasAny) return '';
  const input = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
  const output = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
  const total = Number.isFinite(usage.totalTokens) ? usage.totalTokens : input + output;
  const cached = Number.isFinite(usage.cachedTokens) && usage.cachedTokens > 0 ? usage.cachedTokens : 0;
  const reasoning = Number.isFinite(usage.reasoningTokens) && usage.reasoningTokens > 0 ? usage.reasoningTokens : 0;
  const hitRate = cached > 0 && input > 0 ? `，${Math.round((cached / input) * 100)}%` : '';
  const inputPart = cached > 0 ? `输入 ${input}（缓存命中 ${cached}${hitRate}）` : `输入 ${input}`;
  const outputPart = reasoning > 0 ? `输出 ${output}（思考 ${reasoning}）` : `输出 ${output}`;
  const callsPart = Number.isFinite(usage.calls) && usage.calls > 1 ? `（共 ${usage.calls} 次请求）` : '';
  return `${inputPart} · ${outputPart} · 合计 ${total} tokens${callsPart}`;
}
function node(tag, text) { const el = document.createElement(tag); if(text !== undefined) el.textContent = text; return el; }
function formattedNode(tag, text) { const el = node(tag); renderInlineFeedback(el, text); return el; }
const DEDUCTION_LABELS = {
  substantive: '实质错误/未答',
  task_requirement: '违反明确限定',
  missing_key_step: '缺关键步骤',
  minor_brevity: '过程简略/跳步',
  strict_detail: '严格细节缺失',
  non_reference_method: '非参考解法',
  non_verbatim_wording: '非参考原词句式'
};
const FORBIDDEN_LENIENT = new Set(['strict_detail', 'non_reference_method', 'non_verbatim_wording', 'minor_brevity', 'missing_key_step']);
const FORBIDDEN_NORMAL = new Set(['strict_detail', 'non_reference_method', 'non_verbatim_wording']);
function appendDeductionBadges(container, item, expectedMode) {
  const list = Array.isArray(item?.deductions) ? item.deductions.filter(d => d && Number(d.points) > 0) : [];
  if (!list.length) return;
  const wrap = node('div');
  wrap.className = 'deduction-badges';
  for (const d of list) {
    const cat = typeof d.category === 'string' ? d.category.trim() : '';
    const forbidden = (expectedMode === 'lenient' && FORBIDDEN_LENIENT.has(cat) && !(cat === 'missing_key_step' && item.score === 0)) ||
      (expectedMode === 'normal' && FORBIDDEN_NORMAL.has(cat));
    const badge = node('span', `-${d.points}分 · ${DEDUCTION_LABELS[cat] || cat || '扣分'}${d.evidence ? `（${d.evidence}）` : ''}`);
    badge.className = 'deduction-badge' + (forbidden ? ' deduction-badge-conflict' : '');
    if (cat) badge.dataset.category = cat;
    wrap.append(badge);
  }
  container.append(wrap);
}
function paragraph(container, title, text) {
  if(text === undefined || text === null || text === '') return;
  const content=node('div');renderFeedback(content,text);container.append(node('h3',title),content);
}
function historySection(container, title, text) {
  const section=node('section');section.className='review-section';section.append(node('h3',title));
  const content=node('div');content.className='review-content';renderFeedback(content,text);section.append(content);container.append(section);return content;
}
function reviewCard(container,title,result,arbitration=false) {
  const card=node('div');card.className='review-score-card'+(arbitration?' review-arbitration':'');
  card.append(node('h4',title));
  const row=node('div');row.className='review-score-row';row.append(node('span',arbitration?'仲裁得分':'得分'),node('strong',result?.outputFailure?'未通过校验':value(result?.score)));card.append(row);
  if(result?.model) {const model=node('p',result.model);model.className='review-model';card.append(model);}
  const evidence=node('details');evidence.append(node('summary','查看识别与评分依据'));
  paragraph(evidence,'输出结构异常',result?.outputFailure?.message);
  paragraph(evidence,'识别答案',result?.studentAnswer || '未提供');paragraph(evidence,'评分依据',result?.comment || '未提供');
  paragraph(evidence,'模型用量',formatUsage(result?.usage));
  card.append(evidence);container.append(card);
}
function historyOverview(container,record) {
  const result=record.result,grid=node('div');grid.className='review-overview';
  const student=record.student || record.snapshot?.networkTopic?.student;
  for(const [label,text,large] of [
    ['答卷编号',record.submissionCode || '尚未分配（成功提交后生成）'],
    ['学生姓名 / 编号',`${student?.name || '未保存姓名'} / ${student?.userCode || student?.userId || '未保存编号'}`],
    ['平台答卷 ID',record.snapshot?.networkTopic?.scanRecordId || record.snapshot?.paperId || '未保存'],
    ['题号 / 考试 ID',`${record.snapshot?.legacyTaskId || record.taskId || '未保存题号'} / ${record.snapshot?.pageContext?.examId || '未保存考试 ID'}`],
    ['时间',record.time?new Date(record.time).toLocaleString('zh-CN'):'未记录'],
    ['方案 / 模式',`${record.presetName || '未记录'} · ${{trial:'人工确认',normal:'5秒倒计时提交',unattended:'无人值守'}[record.mode] || '旧记录未保存模式'}`],
    ['AI评分',result.rawScore ?? record.originalResult?.score ?? result.score,true],['最终分数',result.score,true]
  ]) {const item=node('div');item.append(node('span',label));const display=node('div',text);display.className=large?'review-score':'review-meta';item.append(display);grid.append(item);}
  container.append(grid);
  const locate=node('p','可按答卷编号在本机历史中查找；查看或修改网站分数时，请在平台已阅/复核入口按学生编号、题号定位，并核对答卷原图。');container.append(locate);
  const copy=node('button','复制定位信息');copy.type='button';
  copy.onclick=async()=>{try{await navigator.clipboard.writeText([
    `答卷编号：${record.submissionCode || '未分配'}`,`方案：${record.presetName || ''}`,
    `学生姓名：${student?.name || ''}`,`学生编号：${student?.userCode || student?.userId || ''}`,
    `平台答卷 ID：${record.snapshot?.networkTopic?.scanRecordId || record.snapshot?.paperId || ''}`,
    `题号：${record.snapshot?.legacyTaskId || record.taskId || ''}`,`考试 ID：${record.snapshot?.pageContext?.examId || ''}`,
    `最终分数：${result.score}`,`时间：${record.time || ''}`
  ].join('\n'));copy.textContent='已复制定位信息';}catch{copy.textContent='复制失败，请选中上方信息复制';}};
  container.append(copy);
  const dual=result.dualEval;
  if(dual) {
    const section=node('section');section.className='review-section';section.append(node('h3','双评结果'));
    const summary=node('div');summary.className='review-score-card';
    const delta=node('div');delta.className='review-score-row';delta.append(node('span','分差'),node('strong',value(Math.abs(dual.a?.score-dual.b?.score))));
    const status=node('div');status.className='review-score-row';status.append(node('span','判定结果'));
    const badge=node('strong',({consensus:'逐项一致',average:'阈值内平均',arbitration:'⚠ 三评仲裁'})[dual.result]||dual.result);if(dual.result==='arbitration')badge.className='review-arbitration-text';status.append(badge);
    summary.append(delta,status);section.append(summary);
    reviewCard(section,'老师A 评分',dual.a);reviewCard(section,'老师B 评分',dual.b);
    if(dual.result==='arbitration')reviewCard(section,'仲裁结果',dual.verdict || result,true);
    container.append(section);
  } else if(result.recognitionArbitration) {
    const section=node('section');section.className='review-section';section.append(node('h3','识别复核'));
    reviewCard(section,'首次评分',result.recognitionArbitration.primary);reviewCard(section,'仲裁结果',result.recognitionArbitration.verdict,true);container.append(section);
  }
  const finalItems=items(result.dualEval?.verdict || result);
  if(finalItems.length){
    const section=node('section');section.className='review-section review-item-summary';section.append(node('h3','分项得分'));
    const list=node('div');list.className='review-item-list';
    for(const item of finalItems){
      const row=node('div');row.className='review-item-row';
      row.append(formattedNode('span',String(item.label || '未命名评分项')),node('strong',`${value(item.score)}${Number.isFinite(item.maxScore)?` / ${item.maxScore} 分`:''}`));
      list.append(row);
    }
    section.append(list);container.append(section);
  }
  historySection(container,'识别答案',result.studentAnswer || '未能识别');
  historySection(container,'AI评语',result.comment || '无');
  historySection(container,'模型用量',formatUsage(result.totalUsage || result.usage));
  if(record.correctionReason)historySection(container,'人工改分原因',record.correctionReason);
  const audit=node('details');audit.className='review-audit';audit.append(node('summary','逐项对照、书写检查与提交状态'));
  const body=node('div');renderResultDetails(body,record,false);audit.append(body);container.append(audit);
}
function readingDetails(container, result) {
  paragraph(container,'本次评分口径',rubricPrompts[result?.expectedGradingMode]?.label);
  if(result?.outputFailure){paragraph(container,'输出结构异常',`${result.outputFailure.message}；此输出未作为有效分数使用，原始输出已存档。`);return;}
  paragraph(container,'待人工核对',result?.formatWarning);
  paragraph(container,'评分格式核对',result?.formatNote);
  if(result?.policyVerification?.previous){
    const pv=result.policyVerification;
    paragraph(container,'口径与自洽核验',pv.status==='verified'
      ? `已自动重试核验并通过（核验前得分 ${value(pv.previous.score)} → 当前 ${value(result.score)}）`
      : `自动核验未消除冲突（初评 ${value(pv.previous.score)}；${pv.message || '请人工核对'}）`);
  }
  paragraph(container, '书写识别检查', result?.recognitionWarning || ((result?.recognition?.status === 'clear' || result?.recognitionWarning === '') && result.recognition?.coverageChecked ? '模型报告已检查完整答题区域，未报告影响评分的识别疑点。' : '此结果未记录完整的书写识别检查。'));
  paragraph(container, '学生实际作答', result?.studentAnswer);
  for (const note of Array.isArray(result?.recognition?.notes) ? result.recognition.notes : []) if (typeof note === 'string') paragraph(container, '涂改及位置说明', note);
  for (const issue of Array.isArray(result?.recognition?.issues) ? result.recognition.issues : []) if (issue && typeof issue === 'object') paragraph(container, `${issue.affectsScore === false && issue.impactReason ? '书写说明（模型判定不影响评分）' : '识别疑点'} · ${issue.location || '位置未说明'}`, `可见内容：${issue.observed || '未说明'}；说明：${issue.reason || '未说明'}${issue.impactReason ? '；评分影响：' + issue.impactReason : ''}`);
}
export function renderResultDetails(container, record, history = false) {
  container.replaceChildren(); const result = record.result;
  if(record.modelRequestFailure) paragraph(container,'模型请求失败',`${record.modelRequestFailure.provider || '供应商未记录'} · ${record.modelRequestFailure.model || '模型未记录'} · ${record.modelRequestFailure.type || '请求失败'}${record.modelRequestFailure.attempts ? ` · 请求${record.modelRequestFailure.attempts}次` : ''}`);
  if(!result) { paragraph(container,'异常说明',record.error); return; }
  if(history) { historyOverview(container,record); return; }
  if(record.submissionCode) paragraph(container,'答卷编号',record.submissionCode);
  paragraph(container,'模型总分 → 最终分数',`${value(result.rawScore ?? record.originalResult?.score ?? result.score)} → ${value(result.score)}`);
  paragraph(container,'评分格式核对',result.formatNote);
  paragraph(container,'模型用量',formatUsage(result.totalUsage || result.usage));
  readingDetails(container, result);
  if (result.recognitionDecision === 'arbitration') paragraph(container, '存疑处理', '按当前任务设置采用仲裁分数；识别疑点仍保留，请结合原图审查。');
  if (result.recognitionDecision === 'three-way-consensus') paragraph(container, '存疑处理', '主评、复评、仲裁的总分及逐项分数均一致，按一致分数继续；识别疑点保留供审查。');
  if (result.recognitionArbitration) {
    for (const [title, r] of [['首次识别', result.recognitionArbitration.primary], ['识别仲裁', result.recognitionArbitration.verdict]]) {
      const detail=node('details');detail.append(node('summary',`${title} · ${r?.model || '模型名未记录'} · ${value(r?.score)}`));readingDetails(detail,r);paragraph(detail,'评分依据',r?.comment);paragraph(detail,'模型用量',formatUsage(r?.usage));container.append(detail);
    }
  }
  const dual = result.dualEval;
  if(dual) {
    paragraph(container,'双阅判定',`${{consensus:'逐项一致',average:'主观题阈值内平均',arbitration:'已调用仲裁'}[dual.result] || dual.result}；主评 ${value(dual.a?.score)}，复评 ${value(dual.b?.score)}，总分差 ${value(Math.abs(dual.a?.score - dual.b?.score))}。总分差不代表各项一致。`);
  }
  const finalItems = items(dual?.verdict || result), aItems = items(dual?.a), bItems = items(dual?.b);
  // Subjective threshold averaging combines corresponding model details by
  // position. Models often explain the same point with different wording, so
  // strict label matching would render every row as missing even when both
  // models returned the same number of ordered scoring points.
  const positionalAverage = dual?.result === 'average' && finalItems.length > 0 &&
    finalItems.length === aItems.length && aItems.length === bItems.length
    ? finalItems.map((item, index) => ({ label: item.label || aItems[index].label || bItems[index].label, items: [item, aItems[index], bItems[index]], ambiguous: false }))
    : null;
  const aligned = positionalAverage || alignScoringItems(finalItems, aItems, bItems);
  if(aligned.length) {
    container.append(node('h3',dual ? '逐项评分对照' : '逐项评分'));
    const wrap = node('div'); wrap.className='table-wrap';
    const table=node('table'), head=node('tr');
    (dual ? ['评分项','主评','复评','最终模型评分','核对情况'] : ['评分项','得分','满分','评分依据']).forEach(t=>head.append(node('th',t)));
    const thead=node('thead');thead.append(head);table.append(thead);const tbody=node('tbody');
    for(const {label, items: [f, a, b], ambiguous} of aligned) {
      const row=node('tr');
      const cells=dual ? [label,value(a?.score),value(b?.score),value(f?.score),ambiguous ? '标签重复，需人工核对' : a && b ? a.score === b.score ? '分数一致' : '分数不一致' : '明细缺失或标签不对应'] : [label,value(f?.score),value(f?.maxScore),f?.reason || f?.comment || '见下方评分依据'];
      cells.forEach((t,index)=>{
        const cell=index===0 || (!dual && index===3) ? formattedNode('td',t) : node('td',t);
        if(index===0)cell.className='scoring-label-cell';
        if(!dual && index===3)appendDeductionBadges(cell,f,result?.expectedGradingMode);
        if(dual && index===4)appendDeductionBadges(cell,f,result?.expectedGradingMode);
        row.append(cell);
      });tbody.append(row);
    }
    table.append(tbody);wrap.append(table);container.append(wrap);
  } else paragraph(container,'逐项评分','此记录未保存逐项明细；不能从总分补推各项得分。');
  if(dual) for(const [title,r] of [['主评',dual.a],['复评',dual.b],...(dual.result==='arbitration' ? [['仲裁',dual.verdict || result]] : [])]) {
    const detail=node('details');detail.append(node('summary',`${title} · ${r?.model || '模型名未记录'} · ${value(r?.score)}`));
    paragraph(detail,'识别答案',r?.studentAnswer || '未提供');
    readingDetails(detail, r);
    for(const item of items(r)) paragraph(detail,`${item.label} · ${value(item.score)}`,item.reason || item.comment);
    paragraph(detail,'评分依据',r?.comment || '未提供');paragraph(detail,'模型用量',formatUsage(r?.usage));container.append(detail);
  }
  paragraph(container,'人工改分原因',record.correctionReason);
  if(record.originalResult) paragraph(container,'人工调整前得分',value(record.originalResult.score));
  paragraph(container,'提交状态',record.receipt?.confirmed ? `服务器已确认保存：${(record.receipt.scores || [result.score]).map(value).join('、')}` : record.state === 'filled' ? '已填分，尚无服务器确认回执' : record.state === 'submitted' ? '已提交；此旧记录未保存核验回执' : '尚未确认提交');
  paragraph(container,'异常说明',record.error);
}

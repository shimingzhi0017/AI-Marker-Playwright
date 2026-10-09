import {renderFeedback} from './feedback.js';
import { alignScoringItems } from './scoring-labels.js';
const items = result => result?.scoringDetails?.length ? result.scoringDetails : result?.subScores || [];
const value = score => Number.isFinite(score) ? `${score} 分` : '未提供';
function node(tag, text) { const el = document.createElement(tag); if(text !== undefined) el.textContent = text; return el; }
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
  const row=node('div');row.className='review-score-row';row.append(node('span',arbitration?'仲裁得分':'得分'),node('strong',value(result?.score)));card.append(row);
  if(result?.model) {const model=node('p',result.model);model.className='review-model';card.append(model);}
  const evidence=node('details');evidence.append(node('summary','查看识别与评分依据'));
  paragraph(evidence,'识别答案',result?.studentAnswer || '未提供');paragraph(evidence,'评分依据',result?.comment || '未提供');
  card.append(evidence);container.append(card);
}
function historyOverview(container,record) {
  const result=record.result,grid=node('div');grid.className='review-overview';
  for(const [label,text,large] of [
    ['时间',record.time?new Date(record.time).toLocaleString('zh-CN'):'未记录'],
    ['方案 / 模式',`${record.presetName || '未记录'} · ${{trial:'人工确认',normal:'5秒倒计时提交',unattended:'无人值守'}[record.mode] || '旧记录未保存模式'}`],
    ['AI评分',result.rawScore ?? record.originalResult?.score ?? result.score,true],['最终分数',result.score,true]
  ]) {const item=node('div');item.append(node('span',label));const display=node('div',text);display.className=large?'review-score':'review-meta';item.append(display);grid.append(item);}
  container.append(grid);
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
  historySection(container,'识别答案',result.studentAnswer || '未能识别');
  historySection(container,'AI评语',result.comment || '无');
  if(record.correctionReason)historySection(container,'人工改分原因',record.correctionReason);
  const audit=node('details');audit.className='review-audit';audit.append(node('summary','逐项对照、书写检查与提交状态'));
  const body=node('div');renderResultDetails(body,record,false);audit.append(body);container.append(audit);
}
function readingDetails(container, result) {
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
  if(history) {
    paragraph(container,'方案 / 运行模式',`${record.presetName || '未记录'} / ${{trial:'人工确认',normal:'5秒倒计时提交',unattended:'无人值守'}[record.mode] || '旧记录未保存模式'}`);
    paragraph(container,'评分时间',record.time ? new Date(record.time).toLocaleString('zh-CN') : undefined);
  }
  paragraph(container,'模型总分 → 最终分数',`${value(result.rawScore ?? record.originalResult?.score ?? result.score)} → ${value(result.score)}`);
  readingDetails(container, result);
  if (result.recognitionDecision === 'arbitration') paragraph(container, '存疑处理', '按当前任务设置采用仲裁分数；识别疑点仍保留，请结合原图审查。');
  if (result.recognitionDecision === 'three-way-consensus') paragraph(container, '存疑处理', '主评、复评、仲裁的总分及逐项分数均一致，按一致分数继续；识别疑点保留供审查。');
  if (result.recognitionArbitration) {
    for (const [title, r] of [['首次识别', result.recognitionArbitration.primary], ['识别仲裁', result.recognitionArbitration.verdict]]) {
      const detail=node('details');detail.append(node('summary',`${title} · ${r?.model || '模型名未记录'} · ${value(r?.score)}`));readingDetails(detail,r);paragraph(detail,'评分依据',r?.comment);container.append(detail);
    }
  }
  const dual = result.dualEval;
  if(dual) {
    paragraph(container,'双阅判定',`${{consensus:'逐项一致',average:'主观题阈值内平均',arbitration:'已调用仲裁'}[dual.result] || dual.result}；主评 ${value(dual.a?.score)}，复评 ${value(dual.b?.score)}，总分差 ${value(Math.abs(dual.a?.score - dual.b?.score))}。总分差不代表各项一致。`);
  }
  const finalItems = items(dual?.verdict || result), aItems = items(dual?.a), bItems = items(dual?.b);
  const aligned = alignScoringItems(finalItems, aItems, bItems);
  if(aligned.length) {
    container.append(node('h3',dual ? '逐项评分对照' : '逐项评分'));
    const wrap = node('div'); wrap.className='table-wrap';
    const table=node('table'), head=node('tr');
    (dual ? ['评分项','主评','复评','最终模型评分','核对情况'] : ['评分项','得分','满分','评分依据']).forEach(t=>head.append(node('th',t)));
    const thead=node('thead');thead.append(head);table.append(thead);const tbody=node('tbody');
    for(const {label, items: [f, a, b], ambiguous} of aligned) {
      const row=node('tr');
      const cells=dual ? [label,value(a?.score),value(b?.score),value(f?.score),ambiguous ? '标签重复，需人工核对' : a && b ? a.score === b.score ? '分数一致' : '分数不一致' : '明细缺失或标签不对应'] : [label,value(f?.score),value(f?.maxScore),f?.reason || f?.comment || '见下方评分依据'];
      cells.forEach(t=>row.append(node('td',t)));tbody.append(row);
    }
    table.append(tbody);wrap.append(table);container.append(wrap);
  } else paragraph(container,'逐项评分','此记录未保存逐项明细；不能从总分补推各项得分。');
  if(dual) for(const [title,r] of [['主评',dual.a],['复评',dual.b],...(dual.result==='arbitration' ? [['仲裁',dual.verdict || result]] : [])]) {
    const detail=node('details');detail.append(node('summary',`${title} · ${r?.model || '模型名未记录'} · ${value(r?.score)}`));
    paragraph(detail,'识别答案',r?.studentAnswer || '未提供');
    readingDetails(detail, r);
    for(const item of items(r)) paragraph(detail,`${item.label} · ${value(item.score)}`,item.reason || item.comment);
    paragraph(detail,'评分依据',r?.comment || '未提供');container.append(detail);
  }
  if(history) { paragraph(container,'识别内容',result.studentAnswer); paragraph(container,'最终评分依据',result.comment); }
  paragraph(container,'人工改分原因',record.correctionReason);
  if(record.originalResult) paragraph(container,'人工调整前得分',value(record.originalResult.score));
  paragraph(container,'提交状态',record.receipt?.confirmed ? `服务器已确认保存：${(record.receipt.scores || [result.score]).map(value).join('、')}` : record.state === 'filled' ? '已填分，尚无服务器确认回执' : record.state === 'submitted' ? '已提交；此旧记录未保存核验回执' : '尚未确认提交');
  paragraph(container,'异常说明',record.error);
}

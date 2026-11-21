import fs from 'node:fs';
import { detectImageMime } from './image-optimize.mjs';
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const details = result => result?.scoringDetails?.length ? result.scoringDetails : result?.subScores || [];
// Old records can recover student metadata only by an exact network paper ID match.
export function enrichStudents(records, observationFile) {
  const students = new Map();
  if(fs.existsSync(observationFile)) for(const line of fs.readFileSync(observationFile,'utf8').split('\n')) {
    try {
      const event=JSON.parse(line); if(event.type !== 'network-response' || event.body?.code !== 200) continue;
      for(const topic of [event.body.data?.topicInfo,event.body.data?.nextTopicInfo]) {
        const d=topic?.detail; if(!d?.scanRecordId || !d.markingPaperId) continue;
        const student={userId:topic.item?.userId || d.userId || '',userCode:d.userCode || topic.item?.userCode || '',name:d.userName || '',classId:d.classId || topic.item?.classId || '',schoolId:d.schoolId || ''};
        students.set(`${d.markingPaperId}:${d.scanRecordId}`,student);
      }
    } catch {}
  }
  return records.map(r=>({...r,student:r.snapshot?.networkTopic?.student || students.get(`${r.snapshot?.networkTopic?.markingPaperId}:${r.snapshot?.networkTopic?.scanRecordId}`) || null}));
}
export function exportHistory(records, file) {
  if (file.endsWith('.csv')) {
    const labels=[...new Set(records.flatMap(r=>details(r.result).map(s=>s.label)))];
    const rows = [['记录ID','答卷编号','所属任务','时间','学生姓名','学生编号','学生用户ID','班级ID','学生信息状态','答卷ID','考试ID','题号','方案','运行模式','状态','模型总分','最终分数','主评总分','复评总分','双阅结果','实际口径','总Token','缓存Token','口径核验','规则疑点','识别状态','识别答案','评分依据','人工改分原因','服务器确认','错误原因',...labels.map(l=>`${l}得分`),...labels.map(l=>`${l}评分依据`)], ...records.map(r => {
      const s=r.student || r.snapshot?.networkTopic?.student; const result=r.result, d=result?.dualEval;
      const issueSummary = (result?.gradingIssues || []).map(i => i?.reason || i?.location).filter(Boolean).join('；');
      const policyStatus = result?.policyVerification?.status || (result?.policyAudit?.issues?.length ? `待核对(${result.policyAudit.issues.length})` : '');
      return [r.id,r.submissionCode,r.workspaceName,r.time,s?.name,s?.userCode,s?.userId,s?.classId,s?.userCode || s?.userId ? '已匹配' : '未保存学生标识',r.snapshot?.networkTopic?.scanRecordId || r.snapshot?.paperId,r.snapshot?.pageContext?.examId,r.snapshot?.legacyTaskId || r.taskId,r.presetName,r.mode,r.state,result?.rawScore ?? result?.score,result?.score,d?.a?.score,d?.b?.score,d?.result,result?.gradingMode,result?.totalUsage?.totalTokens,result?.totalUsage?.cachedTokens,policyStatus,issueSummary,result?.recognition?.status,result?.studentAnswer,result?.comment,r.correctionReason,r.receipt?.confirmed ? '是' : '否',r.error,...labels.map(l=>details(result).find(s=>s.label===l)?.score),...labels.map(l=>{const s=details(result).find(s=>s.label===l);return s?.reason || s?.comment;})];
    })];
    fs.writeFileSync(file, '\ufeff' + rows.map(row => row.map(cell => {const text=String(cell ?? '');return `"${(/^[=+@-]/.test(text) ? "'"+text : text).replace(/"/g, '""')}"`;}).join(',')).join('\r\n')); return;
  }
  if (file.endsWith('.html')) {
    const articles = records.map(r => {
      const usageInfo = r.result?.totalUsage ? `Token：共 ${r.result.totalUsage.totalTokens}（缓存 ${r.result.totalUsage.cachedTokens || 0}，调用 ${r.result.totalUsage.calls || 0} 次）` : '';
      const verifyInfo = [r.result?.gradingMode ? `口径：${r.result.gradingMode}` : '', r.result?.policyVerification?.status ? `核验：${r.result.policyVerification.status}` : '', r.result?.recognition?.status ? `识别：${r.result.recognition.status}` : ''].filter(Boolean).join(' · ');
      const metaLine = [verifyInfo, usageInfo].filter(Boolean).join(' · ');
      const issueLine = r.result?.gradingIssues?.length ? `<p>规则疑点：${escape(r.result.gradingIssues.map(i => `${i.location ? `${i.location}：` : ''}${i.reason}`).join('；'))}</p>` : '';
      const imgTags = (r.imageFiles || []).map(imgFile => {
        if (!fs.existsSync(imgFile)) return '';
        const buf = fs.readFileSync(imgFile);
        return `<img alt="答卷存档" src="data:${detectImageMime(buf)};base64,${buf.toString('base64')}">`;
      }).join('');
      return `<article><h2>${escape(r.presetName)} · ${escape(r.state)}</h2><p>答卷编号：${escape(r.submissionCode || "未分配")} · ${escape(r.time)}</p><p>记录 ID：${escape(r.id)}</p><p>平台答卷 ID：${escape(r.snapshot?.networkTopic?.scanRecordId || r.snapshot?.paperId)} · 题号：${escape(r.snapshot?.legacyTaskId || r.taskId)} · 考试 ID：${escape(r.snapshot?.pageContext?.examId)}</p><p>学生编号：${escape(r.student?.userCode || r.snapshot?.networkTopic?.student?.userCode || '未保存')} · 班级：${escape(r.student?.classId || r.snapshot?.networkTopic?.student?.classId)}</p><p>最终分数：${escape(r.result?.score)}</p>${metaLine ? `<p>${escape(metaLine)}</p>` : ''}${issueLine}<pre>${escape(r.result?.studentAnswer)}</pre><pre>${escape(r.result?.comment || r.error)}</pre>${details(r.result).map(s=>`<p>${escape(s.label)}：${escape(s.score)}分 ${escape(s.reason || s.comment)}</p>`).join('')}${r.result?.dualEval ? [ ['主评',r.result.dualEval.a],['复评',r.result.dualEval.b],['仲裁',r.result.dualEval.verdict] ].filter(([,s])=>s).map(([title,s])=>`<details><summary>${title}：${escape(s.score)}分</summary><pre>${escape(s.studentAnswer)}</pre><pre>${escape(s.comment)}</pre></details>`).join('') : ''}${imgTags}</article>`;
    }).join('');
    fs.writeFileSync(file, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>评阅历史</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px}article{border-bottom:1px solid #ddd;padding:24px 0}pre{white-space:pre-wrap}img{max-width:100%;display:block;margin:12px 0}</style><h1>评阅历史</h1>${articles}</html>`); return;
  }
  fs.writeFileSync(file, JSON.stringify(records, null, 2));
}

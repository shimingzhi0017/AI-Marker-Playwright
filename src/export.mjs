import fs from 'node:fs';
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function exportHistory(records, file) {
  if (file.endsWith('.csv')) {
    const rows = [['ID', '任务', '方案', '状态', '最终分数', '评语', '错误原因'], ...records.map(r => [r.id, r.taskId, r.presetName, r.state, r.result?.score, r.result?.comment, r.error])];
    fs.writeFileSync(file, '\ufeff' + rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')); return;
  }
  if (file.endsWith('.html')) {
    const articles = records.map(r => `<article><h2>${escape(r.presetName)} · ${escape(r.state)}</h2><p>${escape(r.id)} · ${escape(r.time)}</p><p>最终分数：${escape(r.result?.score)}</p><pre>${escape(r.result?.comment || r.error)}</pre>${(r.imageFiles || []).map(file => fs.existsSync(file) ? `<img alt="答卷存档" src="data:image/png;base64,${fs.readFileSync(file).toString('base64')}">` : '').join('')}</article>`).join('');
    fs.writeFileSync(file, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>评阅历史</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px}article{border-bottom:1px solid #ddd;padding:24px 0}pre{white-space:pre-wrap}img{max-width:100%;display:block;margin:12px 0}</style><h1>评阅历史</h1>${articles}</html>`); return;
  }
  fs.writeFileSync(file, JSON.stringify(records, null, 2));
}

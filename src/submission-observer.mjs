import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sensitive = /token|password|passwd|authorization|cookie|secret|apikey|api_key|signature|ossaccesskeyid/i;
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, sensitive.test(key) ? '[redacted]' : redact(v)]));
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return `[image-data sha256:${crypto.createHash('sha256').update(value).digest('hex')}]`;
    try {
      const url = new URL(value);
      for (const key of [...url.searchParams.keys()]) if (sensitive.test(key)) url.searchParams.set(key, '[redacted]');
      return url.href;
    } catch {}
  }
  return value;
}
function body(text) {
  if (!text) return null;
  if (text.length > 200000) return { omitted: 'body exceeds 200KB', length: text.length };
  try { return redact(JSON.parse(text)); } catch {}
  // Form fields are recorded as structured values; unstructured bodies are omitted.
  if (text.includes('=')) return redact(Object.fromEntries(new URLSearchParams(text)));
  return { omitted: 'unstructured body', length: text.length };
}

export async function observeSubmissions(context, { directory, getPlatform, getRecord, note, intervalMs = 750 }) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'submission-observations.jsonl');
  const write = event => fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), ...redact(event) }) + '\n');
  let closed = false, busy = false, windowUntil = 0, clickId, before, changed = false;
  const requests = new Map();
  const pending = new Set();
  const track = promise => { pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); };
  await context.exposeBinding('__markerSubmissionObserved', async (source, clicked) => {
    if (closed || source.page !== getPlatform()?.page) return;
    clickId = crypto.randomUUID(); windowUntil = Date.now() + 30000; changed = false;
    const record = getRecord(); before = record?.snapshot;
    write({ type: 'submit-click', clickId, recordId: record?.id, recordState: record?.state, clicked });
    note('已记录网页提交点击，正在等待服务器响应及换卷。');
  });
  await context.addInitScript(() => {
    document.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('#bnt_save,button,input[type=submit]') : null;
      if (!button || !(button.id === 'bnt_save' || /提交/.test(button.textContent || button.value || ''))) return;
      const scores = [...document.querySelectorAll('input[name="topicTxt"],#txt_marking_all')].map(el => ({ id: el.id, value: el.value }));
      const identityCandidates = [...document.querySelectorAll('input[type=hidden],[data-paper-id],[data-student-id]')].filter(el => /paper|student|answer|sheet|scan/i.test(el.id + ' ' + el.name + ' ' + [...el.attributes].map(a => a.name).join(' '))).map(el => ({ id: el.id, name: el.name, value: el.value, paperId: el.getAttribute('data-paper-id'), studentId: el.getAttribute('data-student-id') })).slice(0, 40);
      window.__markerSubmissionObserved({ url: location.href, button: button.id || button.textContent.trim(), scores, identityCandidates }).catch(() => {});
    }, true);
  });
  const requestHandler = request => {
    if (closed) return;
    let url; try { url = new URL(request.url()); } catch { return; }
    const platform = getPlatform(); if (!platform) return;
    let markingHost; try { markingHost = new URL(platform.page.url()).hostname; } catch { return; }
    const relevantHost = url.hostname === markingHost || (markingHost.endsWith('zhixue.com') && (url.hostname === 'zhixue.com' || url.hostname.endsWith('.zhixue.com')));
    if (!relevantHost || !['xhr', 'fetch'].includes(request.resourceType()) || /login|logout|oauth|auth\/|password/i.test(url.pathname)) return;
    if (Date.now() > windowUntil && !/mark|paper|sheet|answer|scan/i.test(url.pathname)) return;
    const id = crypto.randomUUID();
    const item = { requestId: id, clickId: Date.now() <= windowUntil ? clickId : undefined, url: request.url(), method: request.method() };
    requests.set(request, item);
    if (requests.size > 300) requests.delete(requests.keys().next().value);
    write({ type: 'network-request', ...item, body: body(request.postData()) });
  };
  const responseHandler = response => {
    const item = requests.get(response.request()); if (!item || closed) return;
    requests.delete(response.request());
    track((async () => {
      try {
        const contentType = response.headers()['content-type'] || '';
        write({ type: 'network-response', ...item, status: response.status(), body: /json|text\/plain/.test(contentType) ? body(await response.text()) : { omitted: 'non-JSON response' } });
      } catch (error) { write({ type: 'response-unavailable', ...item, error: error.message }); }
    })());
  };
  const failedHandler = request => {
    const item = requests.get(request); if (!item || closed) return;
    requests.delete(request); write({ type: 'network-failed', ...item, error: request.failure()?.errorText });
  };
  context.on('request', requestHandler); context.on('response', responseHandler); context.on('requestfailed', failedHandler);
  const timer = setInterval(async () => {
    if (closed || busy || !clickId || Date.now() > windowUntil || changed) return;
    busy = true;
    try {
      const platform = getPlatform(); if (!platform) return;
      const snapshot = await platform.snapshot();
      if (before && snapshot.identity !== before.identity && snapshot.images.length && snapshot.images.every(i => i.ready)) {
        changed = true; write({ type: 'next-answer-observed', clickId, previousIdentity: before.identity, snapshot });
        const record = getRecord();
        note(record?.state === 'submitted' && record.receipt?.confirmed ? '服务器已确认提交成功，答卷编号和分数核验通过，已切换到下一份。' : '已记录提交后换卷，后台请求已保存；提交结果以正式回执核验为准。');
      }
    } catch {} finally { busy = false; }
  }, intervalMs);
  write({ type: 'observer-start', note: 'Read-only; no automatic submission or success-state changes.' });
  return { file, async close() { closed = true; clearInterval(timer); context.off('request', requestHandler); context.off('response', responseHandler); context.off('requestfailed', failedHandler); await Promise.allSettled([...pending]); } };
}

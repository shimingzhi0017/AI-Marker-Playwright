import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { parseResult, calculate } from '../src/domain.mjs';
import { grade, extractResponse, requestModel } from '../src/models.mjs';
import { Store, importSettings } from '../src/store.mjs';
import { ZhixuePlatform, stableImageKey, pageContext } from '../src/platform.mjs';
import { Runner } from '../src/runner.mjs';
import { detectBlank, blackRatio } from '../src/blank.mjs';
import { exportHistory } from '../src/export.mjs';

const config = { answer: 'test reference', rubric: 'test criterion', workflowId: 'w', scoring: { units: [{ label: 'a', maxScore: 2 }, { label: 'b', maxScore: 2 }], roundStep: 0.5, roundMethod: 'round' } };
const result = scores => ({ score: scores.reduce((a, b) => a + b, 0), studentAnswer: 'test', comment: 'test', subScores: scores.map((s, i) => ({ label: ['a', 'b'][i], score: s })) });
test('OSS签名更新不产生新答卷标识，裁剪与资源路径仍参与标识', () => {
  const base = 'https://example.oss-cn-hangzhou.aliyuncs.com/scan.jpg';
  const first = `${base}?Expires=1&Signature=a&OSSAccessKeyId=b&x-oss-process=image%2Fcrop%2Cx_1`;
  const second = `${base}?Expires=2&Signature=c&OSSAccessKeyId=d&x-oss-process=image%2Fcrop%2Cx_1`;
  assert.equal(stableImageKey(first), stableImageKey(second));
  assert.notEqual(stableImageKey(first), stableImageKey(second.replace('x_1', 'x_2')));
  assert.notEqual(stableImageKey(first), stableImageKey(second.replace('scan.jpg', 'next.jpg')));
  assert.deepEqual(pageContext('https://www.zhixue.com/webmarking/task/#/marking/personal/?markingPaperId=group&examId=exam'), { examId: 'exam', markingPaperId: 'group' });
});
test('零分、小数与单元合计校验', () => {
  assert.equal(calculate(parseResult(JSON.stringify(result([0, 0])), config), config).score, 0);
  assert.equal(calculate(result([0.5, 1]), config).score, 1.5);
  assert.throws(() => parseResult(JSON.stringify({ ...result([1, 1]), score: 3 }), config), /合计/);
  assert.throws(() => parseResult(JSON.stringify(result([3, 0])), config), /无效/);
  assert.throws(() => parseResult('【得分】2', config), /JSON/);
});
test('模型返回协议拒绝截断与空正文结构', () => {
  assert.throws(() => extractResponse({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }, 'chat'), /截断/);
  assert.equal(extractResponse({ choices: [{ finish_reason: 'stop', message: { content: [{ text: 'ok' }] } }] }, 'chat'), 'ok');
  assert.equal(extractResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }, 'responses'), 'ok');
  assert.equal(extractResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }] }, 'gemini'), 'ok');
});
test('导入油猴配置保留供应商及客观双评规则', () => {
  const imported = importSettings({ presets: { active: 'p', list: { p: config } }, providers: { providers: { personal: { apiKey: 'test' } } }, workflows: { workflows: { '名称': { id: 'w', dualEval: { questionType: 'objective' } } } } });
  assert.equal(imported.presets.p.workflowId, 'w'); assert.equal(imported.providers.personal.apiKey, 'test'); assert.equal(imported.platform.verified, false);
  assert.equal(imported.workflows.w.dualEval.questionType, 'objective');
});

async function fixture(t, failSubmit = false, options = {}) {
  const image = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#fff' } }).png().toBuffer();
  let submits = 0, modelCalls = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/image')) { res.setHeader('Content-Type', 'image/png'); res.end(image); return; }
    if (req.url === '/submit') { submits++; if (options.dropResponse) { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' }); res.flushHeaders(); setTimeout(() => res.destroy(), 30); return; } res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: !failSubmit })); return; }
    if (req.url === '/v1/chat/completions') {
      let body = ''; for await (const c of req) body += c;
      const request = JSON.parse(body); modelCalls++;
      if (options.modelTimeout) { setTimeout(() => res.end('{}'), 300); return; }
      if (options.model503 && modelCalls === 1) { res.writeHead(503); res.end('busy'); return; }
      const value = request.model === 'B' ? result([0, 2]) : result([2, 0]);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] })); return;
    }
    if (req.url === '/frame') { res.setHeader('Content-Type', 'text/html'); res.end(`<div id="task">task</div><div id="paper" data-paper-id="p1">p1</div><div name="topicImg"><img src="/image/1"></div><input name="topicTxt" data-label="a" score="2"><input name="topicTxt" data-label="b" score="2"><button id="bnt_save" onclick="submit()">提交分数</button><div id="done" hidden>任务完成</div><script>let number=1;async function submit(){const r=await fetch('/submit',{method:'POST'});const j=await r.json();if(j.success){document.querySelectorAll('input').forEach(i=>i.value='');setTimeout(()=>{number++;if(number>${options.papers || 2}){document.querySelector('#done').hidden=false;return;}document.querySelector('#paper').setAttribute('data-paper-id','p'+number);document.querySelector('#paper').textContent='p'+number;document.querySelector('img').src='/image/'+number},${options.delay ?? 700});}}</script>`); return; }
    res.setHeader('Content-Type', 'text/html'); res.end('<iframe src="about:blank"></iframe><iframe src="/frame"></iframe>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const page = await browser.newPage(); await page.goto(url);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-migration-'));
  const settings = { active: 'p', presets: { p: config }, providers: { local: { endpoint: url, apiKey: 'local-test' } }, workflows: { w: { model: { provider: 'local', model: 'A' } } }, mode: 'unattended', batchLimit: 1,
    platform: { verified: true, paperIdSelector: '#paper', taskIdSelector: '#task', completionSelector: '#done', submitResponseUrlPattern: '/submit$', loadTimeoutMs: 1800 } };
  const platform = new ZhixuePlatform(page, settings, path.join(dir, 'diagnostic'));
  const store = new Store(dir);
  t.after(async () => { store.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); });
  return { platform, page, store, settings, submits: () => submits, modelCalls: () => modelCalls, dir };
}
test('选择正确iframe、提交确认、零分输入不会提前触发下一份', async t => {
  const f = await fixture(t);
  const snapshot = await f.platform.ready(); assert.equal(snapshot.paperId, 'p1');
  const images = await f.platform.images(snapshot); assert.equal(images.length, 1);
  await f.platform.fill(snapshot, [0, 0]);
  assert.equal((await f.platform.snapshot()).paperId, 'p1');
  await f.platform.submit(snapshot, [0, 0]);
  const started = Date.now(); const next = await f.platform.ready(snapshot);
  assert.ok(Date.now() - started >= 500); assert.equal(next.paperId, 'p2'); assert.equal(f.submits(), 1);
});
test('自动流程仅平台确认后计数，重启后阻止重复处理', async t => {
  const f = await fixture(t);
  const run = new Runner(f.platform, f.store, f.settings, async () => 'submit', async () => result([1, 1]));
  assert.equal((await run.run()).count, 1); assert.equal(f.store.records()[0].state, 'submitted');
  const again = await new Runner(f.platform, f.store, f.settings, async () => 'submit', async () => result([1, 1])).run();
  assert.equal(again.count, 0); assert.match(again.reason, /已提交过/);
});
test('平台业务拒绝保存时不计数，不盲目重交', async t => {
  const f = await fixture(t, true);
  const run = await new Runner(f.platform, f.store, f.settings, async () => 'submit', async () => result([1, 1])).run();
  assert.equal(run.count, 0); assert.equal(f.store.records()[0].state, 'uncertain');
  await new Runner(f.platform, f.store, f.settings, async () => 'submit', async () => result([1, 1])).run();
  assert.equal(f.submits(), 1);
});
test('用户在模型评分期间切页，旧结果不得填入新答卷', async t => {
  const f = await fixture(t);
  const run = await new Runner(f.platform, f.store, f.settings, async () => 'submit', async () => {
    const frame = await f.platform.frame(); await frame.locator('#paper').evaluate(el => el.setAttribute('data-paper-id', 'new')); return result([1, 1]);
  }).run();
  assert.match(run.reason, /答卷已变化/); assert.equal(f.submits(), 0);
});
test('客观双评总分相同而单元不同，仍调用第三模型', async t => {
  const f = await fixture(t);
  f.settings.workflows.w.dualEval = { enabled: true, questionType: 'objective', secondary: { provider: 'local', model: 'B' }, arbitration: { provider: 'local', model: 'C' } };
  const value = await grade(config, f.settings, [], new AbortController().signal);
  assert.equal(value.dualEval.result, 'arbitration'); assert.equal(f.modelCalls(), 3);
});
test('暂停使迟到模型结果无法继续操作', async t => {
  const f = await fixture(t);
  let run;
  run = new Runner(f.platform, f.store, f.settings, async () => 'submit', async () => { run.pause(); return result([1, 1]); });
  const outcome = await run.run(); assert.equal(outcome.count, 0); assert.equal(f.submits(), 0); assert.equal(f.store.records()[0].state, 'paused');
});
test('空白范本必须与图片对应，损坏图片不能判零', async () => {
  const buffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
  const reference = [await blackRatio(buffer)];
  assert.equal((await detectBlank([{ buffer }], reference)).isBlank, true);
  await assert.rejects(detectBlank([{ buffer: Buffer.from('bad') }], reference));
  await assert.rejects(detectBlank([{ buffer }], []), /数量/);
});
test('历史导出保留零分且HTML转义模型内容', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-export-'));
  const record = { id: 'test', state: 'submitted', result: { score: 0, comment: '<script>bad()</script>' } };
  exportHistory([record], path.join(dir, 'report.html')); exportHistory([record], path.join(dir, 'report.csv'));
  assert.ok(fs.readFileSync(path.join(dir, 'report.html'), 'utf8').includes('&lt;script&gt;'));
  assert.ok(fs.readFileSync(path.join(dir, 'report.csv'), 'utf8').includes('"0"'));
});
test('未加载图片超时只能暂停，不能误判阅完', async t => {
  const f = await fixture(t); f.platform.options.loadTimeoutMs = 500;
  const frame = await f.platform.frame(); await frame.locator('img').evaluate(el => el.remove());
  await assert.rejects(f.platform.ready(), /未就绪/);
});
test('零分输入被网站清空时必须阻止提交', async t => {
  const f = await fixture(t);
  const snapshot = await f.platform.ready();
  const frame = await f.platform.frame();
  await frame.locator('input').evaluateAll(inputs => inputs.forEach(input => input.addEventListener('change', () => input.value = '')));
  await assert.rejects(f.platform.fill(snapshot, [0, 0]), /读回/);
  assert.equal(f.submits(), 0);
});
test('填分后零分被清空：提交前再次检查并阻止点击', async t => {
  const f = await fixture(t); const snapshot = await f.platform.ready();
  await f.platform.fill(snapshot, [0, 0]);
  const frame = await f.platform.frame(); await frame.locator('input').nth(0).fill('');
  await assert.rejects(f.platform.submit(snapshot, [0, 0]), /分数已变化/); assert.equal(f.submits(), 0);
});
test('输入控件减少时不能部分填分或提交', async t => {
  const f = await fixture(t);
  const snapshot = await f.platform.ready();
  const frame = await f.platform.frame(); await frame.locator('input').nth(1).evaluate(el => el.remove());
  await assert.rejects(f.platform.fill(snapshot, [1, 1]), /数量/); assert.equal(f.submits(), 0);
});
test('提交请求已发出但响应丢失：保存不明状态且重启不重交', async t => {
  const f = await fixture(t, false, { dropResponse: true }); f.platform.options.submitTimeoutMs = 500;
  const outcome = await new Runner(f.platform, f.store, f.settings, async () => 'submit', async () => result([1, 1])).run();
  assert.equal(outcome.count, 0); assert.equal(f.submits(), 1); assert.equal(f.store.records()[0].state, 'uncertain');
  const reopened = new Store(f.dir);
  try {
    const restarted = await new Runner(f.platform, reopened, f.settings, async () => 'submit', async () => result([1, 1])).run();
    assert.match(restarted.reason, /状态不明/); assert.equal(f.submits(), 1);
  } finally { reopened.close(); }
});
test('iframe重新加载后重新定位，不沿用旧文档', async t => {
  const f = await fixture(t);
  const old = await f.platform.ready();
  await f.page.locator('iframe').nth(1).evaluate(el => { const replacement = el.cloneNode(); el.replaceWith(replacement); });
  const snapshot = await f.platform.ready(); assert.equal(snapshot.paperId, old.paperId);
  await f.platform.fill(snapshot, [0.5, 1]); assert.equal(f.submits(), 0);
});
test('模型服务503只有限重试，成功结果完整解析', async t => {
  const f = await fixture(t, false, { model503: true });
  const value = await grade(config, f.settings, [], new AbortController().signal);
  assert.equal(value.score, 2); assert.equal(f.modelCalls(), 2);
});
test('模型请求超时不会重复请求', async t => {
  const f = await fixture(t, false, { modelTimeout: true });
  const provider = { ...f.settings.providers.local, timeoutMs: 80 };
  await assert.rejects(requestModel(provider, 'A', 'test', [], new AbortController().signal));
  assert.equal(f.modelCalls(), 1);
});
test('连续100份答卷：每份只提交一次且记录、计数对应', { timeout: 120000 }, async t => {
  const f = await fixture(t, false, { papers: 100, delay: 15 }); f.settings.batchLimit = 0;
  const outcome = await new Runner(f.platform, f.store, f.settings, async () => 'submit', async () => result([1, 1])).run();
  assert.equal(outcome.count, 100); assert.equal(f.submits(), 100); assert.equal(outcome.paused, undefined);
  assert.match(outcome.reason, /明确/);
  const records = f.store.records(); assert.equal(records.length, 100);
  assert.equal(new Set(records.map(r => r.identity)).size, 100); assert.ok(records.every(r => r.state === 'submitted'));
});

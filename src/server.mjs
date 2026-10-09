import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchPersistentBrowser } from './browser.mjs';
import { Store, importSettings, loadSettings } from './store.mjs';
import { Runner } from './runner.mjs';
import { ZhixuePlatform } from './platform.mjs';
import { validateConfig, validateResult } from './domain.mjs';
import { exportHistory, enrichStudents } from './export.mjs';
import { blackRatio } from './blank.mjs';
import { observeSubmissions } from './submission-observer.mjs';
import { trackZhixueTopics } from './zhixue-receipt.mjs';
import { installImageProvenance } from './image-provenance.mjs';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const text = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
function sanitizeSettings(settings) {
  if (settings.version !== 1 || !settings.presets || !settings.providers || !settings.workflows) throw Error('配置格式无效');
  for (const group of ['presets', 'providers', 'workflows']) {
    if (typeof settings[group] !== 'object' || Array.isArray(settings[group])) throw Error('配置列表格式无效');
    if (Object.keys(settings[group]).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw Error('配置名称无效');
  }
  if (!settings.presets[settings.active]) throw Error('请选择有效方案');
  return settings;
}
export async function createApp({ root = defaultRoot, browserFactory = opts => launchPersistentBrowser(opts.profile, opts.launch), gradeFunction, coordinator, child = false } = {}) {
  const children = new Map();
  if (!coordinator) {
    const locks = new Map(), stores = new Set();
    coordinator = { stores, acquire(identity, ownStore) {
      if (locks.has(identity)) throw Error('另一并发任务正在处理同一答卷，已暂停');
      for (const other of stores) if (other !== ownStore && other.records().some(r => r.identity === identity && ['submitted','filled','uncertain','submitting'].includes(r.state))) throw Error('另一任务已填分、提交或有待核对记录，请先核对同一答卷');
      const owner = Symbol(); locks.set(identity, owner);
      return () => { if (locks.get(identity) === owner) locks.delete(identity); };
    } };
  }
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'config.json'), data = path.join(root, 'data');
  if (!fs.existsSync(file)) fs.copyFileSync(path.join(defaultRoot, 'config.example.json'), file);
  const store = new Store(data);
  coordinator.stores.add(store);
  const state = { running: false, phase: '待开始', reason: '请导入原插件配置，或在设置中填写方案和模型。', count: 0, record: null, snapshot: null, browserOpen: false, review: false, countdown: null };
  let context, page, platform, runner, pendingReview, timer, runPromise, submissionObserver, topicTracker, opening = false, generation = 0;
  const events = [];
  const note = message => { events.unshift({ time: new Date().toISOString(), message }); if (events.length > 80) events.pop(); };
  const originalSave = store.save.bind(store);
  store.save = record => {
    originalSave(record);
    if (state.running) {
      state.record = structuredClone(record);
      state.phase = { loading: '正在获取图片', grading: '模型正在评分', review: '请确认评分', submitting: '正在确认提交', submitted: '已提交，等待下一份', paused: '已暂停', uncertain: '提交状态待核对', filled: '已填分' }[record.state] || record.state;
      if (record.state === 'submitted') state.count++;
    }
  };
  function settings() { return loadSettings(file); }
  function writeSettings(value) {
    if (state.running || state.starting) throw Error('请先暂停阅卷，再修改配置');
    sanitizeSettings(value);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2)); fs.renameSync(`${file}.tmp`, file);
    if (page) { platform = new ZhixuePlatform(page, value, path.join(data, 'diagnostics')); platform.topicTracker = topicTracker; }
    note('设置已保存');
  }
  async function openBrowser() {
    if (context || opening) { if (page) await page.bringToFront(); return; }
    opening = true;
    try {
      const cfg = settings();
      const target = new URL(cfg.browser?.url || 'https://www.zhixue.com/');
      if (!['http:', 'https:'].includes(target.protocol)) throw Error('阅卷地址必须是网页地址');
      context = await browserFactory({ profile: path.join(root, 'browser-profile'), launch: { headless: false, viewport: null } });
      submissionObserver = await observeSubmissions(context, { directory: path.join(data, 'diagnostics'), getPlatform: () => platform, getRecord: () => state.record, note });
      context.on('close', () => { submissionObserver?.close(); context = page = platform = null; state.browserOpen = false; pause(); state.reason = '阅卷浏览器已关闭，请重新打开。'; });
      page = context.pages()[0] || await context.newPage();
      await context.addInitScript(installImageProvenance);
      topicTracker = trackZhixueTopics(page);
      platform = new ZhixuePlatform(page, cfg, path.join(data, 'diagnostics'));
      platform.topicTracker = topicTracker;
      state.browserOpen = true;
      await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      state.reason = '请在阅卷浏览器中登录并进入阅卷页面，然后点击“检查页面”。'; note('阅卷浏览器已打开');
    } finally { opening = false; }
  }
  function finishReview(decision) {
    clearInterval(timer); timer = null; state.review = false; state.countdown = null;
    const resolve = pendingReview; pendingReview = null; resolve?.(decision);
  }
  function pause() { generation++; runner?.pause(); finishReview('stop'); note('已请求暂停'); }
  async function start() {
    if (state.running || state.starting) throw Error('阅卷正在进行');
    state.starting = true; const expectedGeneration = generation;
    try {
    if (!platform) throw Error('请先打开阅卷浏览器');
    const cfg = settings();
    const snapshot = await platform.ready();
    if (generation !== expectedGeneration) throw Error('启动已取消');
    if (!snapshot) throw Error('平台已显示任务完成');
    const preset = cfg.presets[cfg.bindings?.[snapshot.taskId] || cfg.active]; validateConfig(preset);
    const workflow = cfg.workflows[preset.workflowId];
    for (const entry of [workflow?.model, ...(workflow?.dualEval?.enabled ? [workflow.dualEval.secondary, workflow.dualEval.arbitration] : [])]) {
      const provider = cfg.providers[entry?.provider];
      if (!entry?.model || !provider?.endpoint || !(provider.apiKey || process.env[provider.apiKeyEnv || ''])) throw Error('请在“模型接口”中填写接口地址、密钥和工作流模型');
    }
    if (cfg.mode !== 'trial' && (!cfg.platform?.verified || !snapshot.strongIdentity || !cfg.platform.submitResponseUrlPattern)) throw Error('自动提交尚未实测，请使用“人工确认”模式，评分后点击“只填分”。');
    state.running = true; state.count = 0; state.record = null; state.reason = ''; state.snapshot = snapshot; state.phase = '准备阅卷';
    runner = new Runner(platform, store, cfg, (record, mode) => {
      state.record = structuredClone(record); state.review = true; state.phase = '请确认评分';
      state.reason = [record.blankDetection?.warning, record.result?.formatWarning].filter(Boolean).join(' ');
      return new Promise(resolve => {
        pendingReview = resolve;
        if (mode === 'unattended') { finishReview('submit'); return; }
        if (mode === 'normal') {
          state.countdown = 5;
          timer = setInterval(() => { state.countdown--; if (state.countdown <= 0) finishReview('submit'); }, 1000);
        }
      });
    }, gradeFunction, coordinator);
    // Review edits must update the live record read by Runner, not only its UI clone.
    const reviewFn = runner.review;
    runner.review = (record, mode) => { state.liveRecord = record; return reviewFn(record, mode); };
    note('开始阅卷');
    runPromise = runner.run().then(result => {
      state.running = false; state.count = result.count; state.reason = result.reason; state.phase = result.paused ? '已暂停' : '已停止';
      note(result.reason); delete state.liveRecord; runner = null; finishReview('stop');
    }).catch(error => { state.running = false; state.phase = '已暂停'; state.reason = error.message; note(error.message); finishReview('stop'); });
    } finally { state.starting = false; }
  }
  const token = crypto.randomBytes(24).toString('hex');
  let origin;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) { text(res, 403, { error: '不允许的访问地址' }); return; }
      const url = new URL(req.url, origin);
      if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (url.pathname === '/') {
        if (req.method !== 'GET') { text(res, 405, { error: '请求方法无效' }); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': `marker=${token}; HttpOnly; SameSite=Strict; Path=/`, 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
        res.end(fs.readFileSync(new URL('../ui/index.html', import.meta.url))); return;
      }
      if (['/app.js', '/enhancements.js', '/result-details.js', '/style.css'].includes(url.pathname)) {
        res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' });
        res.end(fs.readFileSync(new URL(`../ui${url.pathname}`, import.meta.url))); return;
      }
      if (!req.headers.cookie?.split(';').some(c => c.trim() === `marker=${token}`) || (req.headers.origin && req.headers.origin !== origin)) { text(res, 403, { error: '请从本地控制台操作' }); return; }
      if (!child && url.pathname === '/api/workspaces' && req.method === 'GET') {
        text(res, 200, [{ id: 'default', name:settings().workspaceName || '任务 1', running: state.running, phase: state.phase, count: state.count,review:state.review }, ...[...children].map(([id,c]) => ({ id, name:c.app.name(), running:c.app.state.running, phase:c.app.state.phase, count:c.app.state.count,review:c.app.state.review }))]); return;
      }
      const workspace = url.searchParams.get('workspace');
      if (!child && workspace && workspace !== 'default') {
        const target = children.get(workspace);
        if (!target) throw Error('并发任务不存在，请重新选择');
        if (req.method !== 'GET' && (req.method !== 'POST' || req.headers.origin !== origin)) { text(res,403,{error:'请求来源无效'}); return; }
        url.searchParams.delete('workspace');
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 25 * 1024 * 1024) throw Error('文件过大'); }
        const response = await fetch(target.app.url + url.pathname + url.search, { method:req.method, headers:{ Cookie:target.cookie, Origin:target.app.url, 'Content-Type':'application/json' }, ...(req.method === 'POST' ? {body} : {}) });
        res.writeHead(response.status, Object.fromEntries(['content-type','content-disposition','cache-control'].map(k=>[k,response.headers.get(k)]).filter(([,v])=>v))); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (req.method === 'GET') {
        if (url.pathname === '/api/state') { const { liveRecord, ...publicState } = state; text(res, 200, { ...publicState, events }); return; }
        if (url.pathname === '/api/settings') { text(res, 200, settings()); return; }
        if (url.pathname === '/api/history') { text(res, 200, store.records()); return; }
        if (url.pathname === '/api/image') {
          const record = store.records().find(r => r.id === url.searchParams.get('id'));
          const image = record?.imageFiles?.[Number(url.searchParams.get('index') || 0)];
          if (!image || !fs.existsSync(image)) { text(res, 404, { error: '图片不存在' }); return; }
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(image)); return;
        }
        if (url.pathname === '/api/export') {
          const format = url.searchParams.get('format'); if (!['json', 'csv', 'html'].includes(format)) throw Error('导出格式无效');
          const destination = path.join(data, `export.${format}`); exportHistory(enrichStudents(store.records(), path.join(data, 'diagnostics', 'submission-observations.jsonl')), destination);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="history.${format}"` }); res.end(fs.readFileSync(destination)); return;
        }
      }
      if (req.method !== 'POST' || req.headers.origin !== origin) { text(res, 403, { error: '请求来源无效' }); return; }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 25 * 1024 * 1024) throw Error('文件过大'); }
      const input = body ? JSON.parse(body) : {};
      switch (url.pathname) {
        case '/api/workspaces': {
          if (child) throw Error('只能在主控制台新建任务');
          if(input.action==='delete') {
            const target=children.get(input.id);
            if(!target)throw Error('请选择新建的任务；主任务不能删除');
            if(target.app.state.running||target.app.state.starting)throw Error('请先暂停此任务，再删除');
            const source=path.resolve(root,'sessions',input.id), archiveRoot=path.resolve(root,'archived-sessions');
            if(!/^[a-f0-9-]{36}$/.test(input.id)||path.dirname(source)!==path.resolve(root,'sessions'))throw Error('任务路径无效');
            await target.app.close();fs.mkdirSync(archiveRoot,{recursive:true});
            const destination=path.join(archiveRoot,`${input.id}-${Date.now()}`);
            fs.renameSync(source,destination);children.delete(input.id);
            text(res,200,{ok:true,archived:true});return;
          }
          const id = crypto.randomUUID(), directory = path.join(root,'sessions',id);
          fs.mkdirSync(directory,{recursive:true}); fs.copyFileSync(file,path.join(directory,'config.json'));
          const app = await createApp({root:directory,browserFactory,gradeFunction,coordinator,child:true});
          const response = await fetch(app.url); const cookie = response.headers.get('set-cookie').split(';')[0];
          const name = String(input.name || `任务 ${children.size+2}`).slice(0,80);
          const childSettings=JSON.parse(fs.readFileSync(path.join(directory,'config.json'),'utf8'));childSettings.workspaceName=name;fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify(childSettings,null,2));
          fs.writeFileSync(path.join(directory,'workspace.json'),JSON.stringify({name}));
          children.set(id,{app,cookie,name});
          text(res,200,{ok:true,id}); return;
        }
        case '/api/settings': writeSettings(input); break;
        case '/api/workspace-name': { const cfg=settings();cfg.workspaceName=String(input.name||'').trim().slice(0,80);if(!cfg.workspaceName)throw Error('任务名称不能为空');fs.writeFileSync(file,JSON.stringify(cfg,null,2));break; }
        case '/api/import': writeSettings(importSettings(input)); break;
        case '/api/open': await openBrowser(); break;
        case '/api/diagnose': {
          if (state.running) throw Error('请先暂停'); if (!platform) throw Error('请先打开阅卷浏览器');
          state.snapshot = await platform.snapshot();
          state.phase = '页面已识别'; state.reason = `找到${state.snapshot.images.length}张图片、${state.snapshot.units.length}个评分框。${state.snapshot.strongIdentity ? '' : '尚未确认稳定答卷ID，可先评分并只填分。'}`;
          await platform.diagnostic('可视化页面诊断'); note(state.reason); break;
        }
        case '/api/export-file': {
          if (!['json','csv','html'].includes(input.format)) throw Error('导出格式无效');
          const records = enrichStudents(store.records(), path.join(data,'diagnostics','submission-observations.jsonl'));
          const directory = path.join(data,'exports'); fs.mkdirSync(directory,{recursive:true});
          const destination = path.join(directory, 'history-'+Date.now()+'.'+input.format);
          exportHistory(records,destination); text(res,200,{path:destination,count:records.length}); return;
        }
        case '/api/start': await start(); break;
        case '/api/pause': pause(); break;
        case '/api/hold': {
          if (!state.review || input.recordId!==state.liveRecord?.id) throw Error('评分记录已变化');
          clearInterval(timer);timer=null;state.countdown=null;note('正在编辑评分，倒计时已停止，请手动确认');break;
        }
        case '/api/review': {
          if (!state.review || !state.liveRecord || !pendingReview) throw Error('当前没有待确认评分');
          if (input.recordId && input.recordId !== state.liveRecord.id) throw Error('评分记录已变化，请确认当前答卷');
          if (!['fill', 'submit', 'stop'].includes(input.decision)) throw Error('操作无效');
          if (input.decision === 'submit' && ((!settings().platform?.verified && !(settings().platform?.manualSubmissionTest && runner.settings.mode === 'trial' && Number.isInteger(runner.settings.batchLimit) && runner.settings.batchLimit >= 0 && state.liveRecord.snapshot.networkTopic)) || !state.liveRecord.snapshot.strongIdentity || !settings().platform?.submitResponseUrlPattern)) throw Error('自动提交尚未验收，请点击“只填分”，再在网站手动提交。');
          const record = state.liveRecord;
          if(input.comment!==undefined&&(typeof input.comment!=='string'||input.comment.length>100000))throw Error('评分依据格式无效');
          if (input.scores) {
            if (!Array.isArray(input.scores) || input.scores.some(s => typeof s !== 'number' || !Number.isFinite(s))) throw Error('分数无效');
            const cfg = runner.settings.presets[record.presetName], units = cfg.scoring?.units || [];
            if (input.scores.length !== (units.length || 1)) throw Error('分数数量不一致');
            const edited = { ...record.result, score: input.scores.reduce((s, n) => s + n, 0), subScores: units.map((u, i) => ({ label: u.label, score: input.scores[i] })) };
            validateResult(edited, cfg);
            if (JSON.stringify(edited.subScores) !== JSON.stringify(record.result.subScores) || edited.score !== record.result.score) { record.originalResult ||= structuredClone(record.result); record.correctionReason = input.reason || '教师在界面修改'; }
            record.result = edited; store.save(record);
          }
          if(input.comment!==undefined&&input.comment!==record.result.comment){record.originalResult ||= structuredClone(record.result);record.result.comment=input.comment;record.correctionReason=input.reason||'教师修改评分依据';store.save(record);}
          finishReview(input.decision); break;
        }
        case '/api/resolve': {
          if (state.running) throw Error('请先暂停');
          const record = store.records().find(r => r.id === input.id);
          if (!record || !['uncertain', 'submitting'].includes(record.state) || !['submitted', 'not-submitted'].includes(input.outcome)) throw Error('核对记录无效');
          record.state = input.outcome === 'submitted' ? 'submitted' : 'resolved-not-submitted'; record.manuallyResolved = true; originalSave(record); note('提交状态已人工核对'); break;
        }
        case '/api/blank': {
          if (state.running) throw Error('请先暂停'); const record = store.records().find(r => r.id === input.id);
          if (!record?.imageFiles?.length) throw Error('没有可用图片'); const cfg = settings();
          cfg.presets[record.presetName].blankDetection = { enabled: true, threshold: 0.01, reference: await Promise.all(record.imageFiles.map(f => blackRatio(fs.readFileSync(f)))) };
          writeSettings(cfg); note('空白范本已保存'); break;
        }
        case '/api/models': {
          if (state.running) throw Error('请先暂停'); const cfg = settings(), provider = cfg.providers[input.name];
          if (!provider) throw Error('供应商不存在'); const key = provider.apiKey || process.env[provider.apiKeyEnv || '']; if (!key) throw Error('请先保存接口密钥');
          const base = provider.endpoint.replace(/\/(chat\/completions|responses)\/?$/, '').replace(/\/$/, '');
          const address = provider.protocol === 'gemini' ? `${base}/models` : `${base}${base.endsWith('/v1') ? '' : '/v1'}/models`;
          const response = await fetch(address, { headers: provider.protocol === 'gemini' ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
          if (!response.ok) throw Error(`模型目录请求失败（${response.status}）`); const value = await response.json();
          provider.models = provider.protocol === 'gemini' ? (value.models || []).map(m => m.name.replace(/^models\//, '')) : (value.data || []).map(m => m.id);
          writeSettings(cfg); break;
        }
        default: text(res, 404, { error: '接口不存在' }); return;
      }
      text(res, 200, { ok: true });
    } catch (error) { note(error.message); text(res, 400, { error: error.message }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  if (!child && fs.existsSync(path.join(root,'sessions'))) {
    for (const id of fs.readdirSync(path.join(root,'sessions'))) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      const directory = path.join(root,'sessions',id), metadata = path.join(directory,'workspace.json');
      if (!fs.existsSync(metadata)) continue;
      const app = await createApp({root:directory,browserFactory,gradeFunction,coordinator,child:true});
      const response = await fetch(app.url), cookie = response.headers.get('set-cookie').split(';')[0];
      children.set(id,{app,cookie,name:JSON.parse(fs.readFileSync(metadata,'utf8')).name});
    }
  }
  let closing;
  return { url: origin, server, state, store, name:()=>settings().workspaceName||'任务', close: () => closing ||= (async () => { pause(); await Promise.all([...children.values()].map(c=>c.app.close())); await runPromise; await submissionObserver?.close(); await context?.close(); await new Promise(resolve => server.close(resolve)); coordinator.stores.delete(store); store.close(); })() };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp(); console.log(`可视化阅卷控制台：${app.url}\n关闭本窗口会停止控制台。`);
  let uiBrowser;
  try {
    uiBrowser = await launchPersistentBrowser(path.join(defaultRoot, 'ui-profile'), { headless: false, viewport: null, args: [`--app=${app.url}`] });
    uiBrowser.on('close', () => app.close().then(() => process.exit(0)));
  } catch (error) { console.log(`自动打开窗口失败：${error.message}\n请在浏览器中打开上面的本地地址，或按首次运行说明检查浏览器。`); }
  process.once('SIGINT', () => app.close().then(async () => { await uiBrowser?.close(); process.exit(0); }));
}

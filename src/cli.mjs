import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { launchPersistentBrowser } from './browser.mjs';
import { Store, importSettings, loadSettings } from './store.mjs';
import { ZhixuePlatform } from './platform.mjs';
import { Runner } from './runner.mjs';
import { exportHistory } from './export.mjs';
import { validateResult } from './domain.mjs';
import { blackRatio } from './blank.mjs';

const [command = 'help', ...args] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
const configFile = path.resolve(args[0] || 'config.json');
const dataDir = path.join(root, 'data');
const help = `智学网Playwright迁移版
  npm run tool -- login [配置文件]        打开专用浏览器，手动登录
  npm run tool -- diagnose [配置文件]     只读检查阅卷区域
  npm run tool -- run [配置文件]          评阅；默认人工确认
  npm run tool -- import 导出.json 配置.json
  npm run tool -- export [输出.json]      导出历史记录
  npm run tool -- models 配置.json 供应商  刷新供应商模型目录
  npm run tool -- blank 配置.json 记录ID   用已保存图片建立空白范本
  npm run tool -- resolve 记录ID submitted|not-submitted
  运行时Ctrl+C暂停。请先复制config.example.json并填写配置。`;
async function main() {
  if (command === 'help') { console.log(help); return; }
  if (command === 'models') {
    const settings = loadSettings(configFile), provider = settings.providers[args[1]];
    if (!provider) throw Error('供应商不存在');
    const key = provider.apiKey || process.env[provider.apiKeyEnv || '']; if (!key) throw Error('供应商密钥未配置');
    const base = provider.endpoint.replace(/\/(chat\/completions|responses)\/?$/, '').replace(/\/$/, '');
    const url = provider.protocol === 'gemini' ? `${base}/models` : `${base}${base.endsWith('/v1') ? '' : '/v1'}/models`;
    const response = await fetch(url, { headers: provider.protocol === 'gemini' ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
    if (!response.ok()) throw Error(`模型目录HTTP ${response.status}`);
    const json = await response.json();
    provider.models = provider.protocol === 'gemini' ? (json.models || []).map(m => m.name.replace(/^models\//, '')) : (json.data || []).map(m => m.id);
    fs.writeFileSync(configFile, JSON.stringify(settings, null, 2)); console.log(`保存${provider.models.length}个模型ID，视觉能力需另行验证。`); return;
  }
  if (command === 'blank') {
    const settings = loadSettings(configFile), store = new Store(dataDir);
    try {
      const record = store.records().find(r => r.id === args[1]); if (!record?.imageFiles?.length) throw Error('记录不存在或未保存图片');
      const preset = settings.presets[record.presetName]; if (!preset) throw Error('方案不存在');
      preset.blankDetection = { enabled: true, threshold: 0.01, reference: await Promise.all(record.imageFiles.map(file => blackRatio(fs.readFileSync(file)))) };
      fs.writeFileSync(configFile, JSON.stringify(settings, null, 2)); console.log('空白范本已保存。请确认所选记录确实为空白答卷。');
    } finally { store.close(); } return;
  }
  if (command === 'import') { if (!args[0] || !args[1]) throw Error('需要输入和输出文件'); fs.writeFileSync(args[1], JSON.stringify(importSettings(JSON.parse(fs.readFileSync(args[0], 'utf8'))), null, 2)); console.log('配置已导入，密钥包含在私人配置文件中；请检查工作流和页面配置。'); return; }
  if (command === 'export' || command === 'resolve') {
    const store = new Store(dataDir);
    try {
      if (command === 'export') { exportHistory(store.records(), args[0] || 'history.json'); console.log('历史已导出'); }
      else {
        const record = store.records().find(r => r.id === args[0]);
        if (!record || !['uncertain', 'submitting'].includes(record.state) || !['submitted', 'not-submitted'].includes(args[1])) throw Error('请提供状态不明记录ID和核对结果');
        record.state = args[1] === 'submitted' ? 'submitted' : 'resolved-not-submitted'; record.manuallyResolved = true; store.save(record); console.log('人工核对结果已保存');
      }
    } finally { store.close(); } return;
  }
  if (!['login', 'diagnose', 'run'].includes(command)) throw Error(help);
  const settings = loadSettings(configFile);
  const context = await launchPersistentBrowser(path.join(root, 'browser-profile'), { headless: settings.browser?.headless ?? false, viewport: null });
  const page = context.pages()[0] || await context.newPage();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const store = new Store(dataDir);
  let runner;
  const interrupt = () => { runner?.pause(); rl.close(); };
  process.on('SIGINT', interrupt);
  try {
    await context.tracing.start({ screenshots: true, snapshots: true });
    await page.goto(settings.browser?.url || 'https://www.zhixue.com/', { waitUntil: 'domcontentloaded' });
    await rl.question('请在专用浏览器中登录并进入阅卷页面，准备好后按回车。');
    const platform = new ZhixuePlatform(page, settings, path.join(dataDir, 'diagnostics'));
    if (command === 'login') { console.log('浏览器会话已保存。'); return; }
    if (command === 'diagnose') {
      try { console.log(JSON.stringify(await platform.snapshot(), null, 2)); } finally { await platform.diagnostic('只读诊断'); } return;
    }
    runner = new Runner(platform, store, settings, async (record, mode) => {
      console.log(`\n方案：${record.presetName}\n评分：${record.result.score}\n${record.result.comment || ''}`);
      if (mode === 'unattended') return 'submit';
      if (mode === 'normal') { console.log('5秒后提交，Ctrl+C可暂停。'); await new Promise(r => setTimeout(r, 5000)); return 'submit'; }
      let answer = await rl.question('输入 s 提交并继续，f 只填分，c 修改分数，回车停止：');
      if (answer === 'c') {
        const scores = (await rl.question('按评分单元顺序输入分数，用逗号分隔：')).split(',').map(s => Number(s.trim()));
        if (scores.some(s => !Number.isFinite(s))) throw Error('修改分数无效');
        const cfg = settings.presets[record.presetName];
        record.originalResult = structuredClone(record.result);
        const units = cfg.scoring?.units || [];
        if (scores.length !== (units.length || 1)) throw Error('修改分数数量不一致');
        record.result.score = scores.reduce((s, n) => s + n, 0);
        record.result.subScores = units.map((u, i) => ({ label: u.label, score: scores[i] }));
        validateResult(record.result, cfg); record.correctionReason = await rl.question('修改原因：'); store.save(record);
        answer = await rl.question('修改已保存，s 提交，f 只填分，回车停止：');
      }
      return answer === 's' ? 'submit' : answer === 'f' ? 'fill' : 'stop';
    });
    console.log(await runner.run());
  } finally {
    process.off('SIGINT', interrupt); rl.close(); store.close();
    fs.mkdirSync(dataDir, { recursive: true });
    await context.tracing.stop({ path: path.join(dataDir, `trace-${Date.now()}.zip`) }).catch(() => {});
    await context.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

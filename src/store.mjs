import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class Store {
  constructor(dir) {
    this.dir = path.resolve(dir); fs.mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dir, 'history.sqlite'));
    this.db.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL)');
  }
  save(record) {
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data,updated=excluded.updated').run(record.id, record.state, JSON.stringify(record), new Date().toISOString());
  }
  records() { return this.db.prepare('SELECT data FROM records ORDER BY updated DESC').all().map(r => JSON.parse(r.data)); }
  log(event, details = {}) { fs.appendFileSync(path.join(this.dir, 'events.jsonl'), JSON.stringify({ time: new Date().toISOString(), event, ...details }) + '\n'); }
  async images(id, images) {
    const dir = path.join(this.dir, 'images', id); fs.mkdirSync(dir, { recursive: true });
    return images.map((img, i) => { const file = path.join(dir, `${i}.bin`); fs.writeFileSync(file, img.buffer); return file; });
  }
  close() { this.db.close(); }
}
export function importSettings(input) {
  const unwrap = value => typeof value === 'string' ? JSON.parse(value) : value;
  if (input.version === 1 && input.presets && !input.presets.list) return input;
  const presets = unwrap(input.presets), providers = unwrap(input.providers), workflows = unwrap(input.workflows);
  if (!presets?.list || !providers?.providers) throw Error('不是可识别的油猴配置导出文件');
  const workflowMap = {};
  for (const [name, workflow] of Object.entries(workflows?.workflows || workflows?.list || {})) {
    workflowMap[workflow.id || name] = structuredClone(workflow);
    if (workflowMap[workflow.id || name].dualEval?.enabled && !workflowMap[workflow.id || name].dualEval.questionType) workflowMap[workflow.id || name].dualEval.questionType = 'subjective';
  }
  return { version: 1, active: presets.active, presets: presets.list, bindings: presets.bindings || {}, providers: providers.providers,
    workflows: workflowMap, browser: { url: 'https://www.zhixue.com/', headless: false },
    platform: { verified: false }, mode: 'trial', requestBudget: 6 };
}
export function loadSettings(file) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.version !== 1 || !config.presets || !config.providers || !config.workflows) throw Error('配置结构无效');
  return config;
}

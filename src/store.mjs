import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export class Store {
  constructor(dir) {
    this.dir = path.resolve(dir); fs.mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dir, 'history.sqlite'));
    this.db.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_records_updated ON records(updated DESC); CREATE INDEX IF NOT EXISTS idx_records_state_updated ON records(state, updated DESC)');
    this.db.exec('CREATE TABLE IF NOT EXISTS store_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS submission_numbers (sequence INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL UNIQUE)');
    this.db.prepare('INSERT OR IGNORE INTO store_metadata(key,value) VALUES(?,?)').run('submissionPrefix',crypto.randomBytes(4).toString('hex').toUpperCase());
    this.submissionPrefix=this.db.prepare('SELECT value FROM store_metadata WHERE key=?').get('submissionPrefix').value;
    this.selectById = this.db.prepare('SELECT data FROM records WHERE id = ?');
    this.findSubmissionNumber = this.db.prepare('SELECT sequence FROM submission_numbers WHERE record_id=?');
    this.insertSubmissionNumber = this.db.prepare('INSERT INTO submission_numbers(record_id) VALUES(?)');
    this.upsertRecord = this.db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data,updated=excluded.updated');
    try {
      this.transaction(() => this.backfillSubmissionNumbers());
    } catch(error) { this.db.close();throw error; }
  }
  transaction(write) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = write();
      this.db.exec('COMMIT');
      return result;
    } catch(error) { this.db.exec('ROLLBACK');throw error; }
  }
  backfillSubmissionNumbers() {
    // Only repair missing or inconsistent numbers; leave settled history untouched.
    const rows = this.db.prepare(`
      SELECT r.id,r.data FROM records r
      LEFT JOIN submission_numbers n ON n.record_id=r.id
      WHERE r.state='submitted' AND (
        n.sequence IS NULL OR json_extract(r.data,'$.submissionNumber') IS NOT n.sequence
        OR json_extract(r.data,'$.submissionCode') IS NOT (? || '-' || printf('%06d',n.sequence))
      )
      ORDER BY coalesce(json_extract(r.data,'$.time'),r.updated),r.id
    `).all(this.submissionPrefix);
    const update = this.db.prepare('UPDATE records SET data=? WHERE id=?');
    for (const row of rows) {
      const record = JSON.parse(row.data);
      this.assignSubmissionNumber(record);
      update.run(JSON.stringify(record),row.id);
    }
  }
  assignSubmissionNumber(record) {
    let row=this.findSubmissionNumber.get(record.id);
    if(!row && record.state!=='submitted')return;
    if(!row) {
      const inserted=this.insertSubmissionNumber.run(record.id);
      row={sequence:Number(inserted.lastInsertRowid)};
    }
    record.submissionNumber=row.sequence;
    record.submissionCode=`${this.submissionPrefix}-${String(row.sequence).padStart(6,'0')}`;
  }
  save(record) {
    const saved={...record};
    this.transaction(() => {
      this.assignSubmissionNumber(saved);
      this.upsertRecord.run(saved.id, saved.state, JSON.stringify(saved), new Date().toISOString());
    });
    if(saved.submissionCode) {
      record.submissionCode=saved.submissionCode;
      record.submissionNumber=saved.submissionNumber;
    }
  }
  records() { return this.db.prepare('SELECT data FROM records ORDER BY updated DESC').all().map(r => JSON.parse(r.data)); }
  getById(id) {
    if (typeof id !== 'string' || !id) return null;
    const row = this.selectById.get(id);
    return row ? JSON.parse(row.data) : null;
  }
  hasStates(states) {
    if (!Array.isArray(states) || !states.length) return false;
    const placeholders = states.map(() => '?').join(',');
    return !!this.db.prepare(`SELECT 1 FROM records WHERE state IN (${placeholders}) LIMIT 1`).get(...states);
  }
  hasIdentityInStates(identity, states) {
    if (typeof identity !== 'string' || !identity || !Array.isArray(states) || !states.length) return false;
    const placeholders = states.map(() => '?').join(',');
    return !!this.db.prepare(`SELECT 1 FROM records WHERE state IN (${placeholders}) AND json_extract(data,'$.identity') = ? LIMIT 1`).get(...states, identity);
  }
  historyPage({ page = 1, pageSize = 50, state = '', search = '', arbitrated = false, corrected = false, alerted = false, gradingIssues = false } = {}) {
    page = Math.max(1, Math.floor(Number(page) || 1));
    pageSize = Math.min(200, Math.max(1, Math.floor(Number(pageSize) || 50)));
    const clauses = [], params = [];
    if (state) { clauses.push('state = ?'); params.push(state); }
    if (search) {
      const escaped = String(search).replace(/[\\%_]/g, '\\$&').toLowerCase();
      const fields=['submissionCode','submissionNumber','presetName','result.studentAnswer','result.comment','correctionReason','snapshot.legacyTaskId','snapshot.paperId','snapshot.pageContext.examId','snapshot.networkTopic.scanRecordId','snapshot.networkTopic.student.userCode','snapshot.networkTopic.student.userId','snapshot.networkTopic.student.name'];
      clauses.push(`lower(${fields.map(field=>`coalesce(json_extract(data,'$.${field}'),'')`).join(" || ' ' || ")}) LIKE ? ESCAPE '\\'`); params.push(`%${escaped}%`);
    }
    if (arbitrated) clauses.push("(json_extract(data,'$.result.dualEval.result') = 'arbitration' OR json_extract(data,'$.result.recognitionArbitration') IS NOT NULL OR json_extract(data,'$.originalResult.dualEval.result') = 'arbitration' OR json_extract(data,'$.originalResult.recognitionArbitration') IS NOT NULL)");
    if (corrected) clauses.push("((json_extract(data,'$.correctionReason') IS NOT NULL AND json_extract(data,'$.correctionReason') != '') OR (json_extract(data,'$.originalResult.score') IS NOT NULL AND json_extract(data,'$.result.score') IS NOT json_extract(data,'$.originalResult.score')))");
    if (alerted) clauses.push("(json_array_length(coalesce(json_extract(data,'$.result.policyAudit.issues'),'[]')) > 0 OR json_array_length(coalesce(json_extract(data,'$.result.gradingIssues'),'[]')) > 0 OR (json_extract(data,'$.result.formatWarning') IS NOT NULL AND json_extract(data,'$.result.formatWarning') != ''))");
    if (gradingIssues) clauses.push("(json_array_length(coalesce(json_extract(data,'$.result.gradingIssues'),'[]')) > 0)");
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM records${where}`).get(...params).count;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(page, totalPages);
    const rows = this.db.prepare(`SELECT data FROM records${where} ORDER BY updated DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
    return { items: rows.map(r => JSON.parse(r.data)), total, page, pageSize, totalPages };
  }
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
    const providerMap=Object.fromEntries(Object.entries(providers.providers).map(([name,provider])=>[name,{...provider,protocol:provider.protocol || 'chat',models:Array.isArray(provider.models)?provider.models:Object.keys(provider.models || {}),modelMetadata:provider.modelMetadata || (!Array.isArray(provider.models)?provider.models:{})}]));
    return { version: 1, active: presets.active, presets: presets.list, bindings: presets.bindings || {}, providers: providerMap,
    workflows: workflowMap, browser: { url: 'https://www.zhixue.com/', headless: false },
    platform: { verified: false }, notifications: { sound: true, popup: true, volume: 0.6 }, mode: 'trial', requestBudget: 6, gradingTimeoutMs: 600000 };
}
export function loadSettings(file) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.version !== 1 || !config.presets || !config.providers || !config.workflows) throw Error('配置结构无效');
  return config;
}

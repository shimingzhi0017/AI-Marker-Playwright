import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { exportHistory } from '../src/export.mjs';

function workspace(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'marker-number-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function submitted(id,extra={}) {
  return {id,state:'submitted',time:'2026-11-11T01:00:00Z',presetName:'物理',result:{score:6},receipt:{confirmed:true,scores:[6]},...extra};
}

test('numbers are issued only on submission and survive restart and stale updates',t=>{
  const dir=workspace(t);let store=new Store(dir);
  try {
    for(const state of ['review','filled','submitting','uncertain','paused']) {
      const record={id:state,state};store.save(record);assert.equal(record.submissionCode,undefined);
    }
    const record=submitted('review');store.save(record);
    assert.match(record.submissionCode,/^[A-F0-9]{8}-000001$/);
    const code=record.submissionCode;store.close();store=new Store(dir);
    const stale=submitted('review');store.save(stale);assert.equal(stale.submissionCode,code);
    const next=submitted('next');store.save(next);assert.equal(next.submissionNumber,2);
    assert.equal(store.records().find(r=>r.id==='review').submissionCode,code);
  } finally {store.close();}
});

test('old submitted records are backfilled without changing ordering, scores or receipts',t=>{
  const dir=workspace(t),db=new DatabaseSync(path.join(dir,'history.sqlite'));
  db.exec('CREATE TABLE records (id TEXT PRIMARY KEY,state TEXT NOT NULL,data TEXT NOT NULL,updated TEXT NOT NULL)');
  const old=submitted('old'),newer=submitted('new',{time:'2026-11-12T01:00:00Z'});
  const insert=db.prepare('INSERT INTO records VALUES(?,?,?,?)');
  insert.run('old','submitted',JSON.stringify(old),'2026-11-15');
  insert.run('new','submitted',JSON.stringify(newer),'2026-11-14');
  insert.run('pending','uncertain',JSON.stringify({id:'pending',state:'uncertain'}),'2026-11-13');db.close();
  const store=new Store(dir);
  try {
    const records=store.records();assert.deepEqual(records.map(r=>r.id),['old','new','pending']);
    assert.equal(records[0].submissionNumber,1);assert.equal(records[1].submissionNumber,2);
    assert.equal(records[2].submissionCode,undefined);
    for(const original of [old,newer]) {
      const {submissionNumber,submissionCode,...saved}=records.find(r=>r.id===original.id);
      assert.deepEqual(saved,original);
    }
    assert.equal(store.db.prepare('SELECT updated FROM records WHERE id=?').get('old').updated,'2026-11-15');
  } finally {store.close();}
});

test('separate connections share stable unique numbering',t=>{
  const dir=workspace(t),a=new Store(dir),b=new Store(dir);
  try {
    const first=submitted('a'),second=submitted('b');a.save(first);b.save(second);
    assert.equal(first.submissionNumber,1);assert.equal(second.submissionNumber,2);
    const repeated=submitted('a');b.save(repeated);assert.equal(repeated.submissionCode,first.submissionCode);
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM submission_numbers').get().n,2);
  } finally {a.close();b.close();}
});

test('startup only repairs missing or inconsistent numbers without rewriting settled records',t=>{
  const dir=workspace(t);
  let store=new Store(dir);
  try {
    const settled=submitted('settled'),damaged=submitted('damaged');
    store.save(settled);store.save(damaged);
    const original=store.db.prepare('SELECT data,updated FROM records WHERE id=?').get(settled.id);
    const damagedUpdated=store.db.prepare('SELECT updated FROM records WHERE id=?').get(damaged.id).updated;
    // Simulate an old/stale record while retaining its authoritative number allocation.
    store.db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...damaged,submissionNumber:99,submissionCode:'wrong'}),damaged.id);
    store.db.exec(`
      CREATE TABLE record_updates (id TEXT);
      CREATE TRIGGER count_record_updates AFTER UPDATE ON records
      BEGIN INSERT INTO record_updates VALUES(NEW.id); END;
    `);
    store.close();store=new Store(dir);
    assert.deepEqual(store.db.prepare('SELECT id FROM record_updates').all().map(row=>row.id),['damaged']);
    assert.deepEqual(store.db.prepare('SELECT data,updated FROM records WHERE id=?').get(settled.id),original);
    const repaired=store.records().find(record=>record.id===damaged.id);
    assert.equal(repaired.submissionCode,damaged.submissionCode);
    assert.equal(repaired.submissionNumber,damaged.submissionNumber);
    assert.equal(store.db.prepare('SELECT updated FROM records WHERE id=?').get(damaged.id).updated,damagedUpdated);
    store.close();store=new Store(dir);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM record_updates').get().n,1);
    const next=submitted('next');store.save(next);assert.equal(next.submissionNumber,3);
  } finally {store.close();}
});

test('a failed save rolls back numbering allocation',t=>{
  const store=new Store(workspace(t));
  try {
    const circular=submitted('bad');circular.circular=circular;assert.throws(()=>store.save(circular));
    assert.equal(circular.submissionCode,undefined);
    const good=submitted('good');store.save(good);assert.equal(good.submissionNumber,1);
    assert.equal(store.records().length,1);
  } finally {store.close();}
});

test('history finds number and student/platform identifiers, with literal wildcard escaping',t=>{
  const store=new Store(workspace(t));
  try {
    const record=submitted('a',{snapshot:{legacyTaskId:'题13',paperId:'paper-123',networkTopic:{student:{userCode:'student%_42',name:'张三'}}}});
    store.save(record);store.save(submitted('b'));
    for(const query of [record.submissionCode,record.submissionCode.toLowerCase(),'student%_42','paper-123','题13','张三']) {
      assert.deepEqual(store.historyPage({search:query}).items.map(r=>r.id),['a']);
    }
    assert.equal(store.historyPage({search:'%'}).total,1);
    assert.equal(store.historyPage({search:record.submissionCode,state:'filled'}).total,0);
  } finally {store.close();}
});

test('all export formats preserve permanent number and locating information',t=>{
  const dir=workspace(t),store=new Store(dir);
  try {
    const record=submitted('a',{snapshot:{legacyTaskId:'13',paperId:'paper<123>',pageContext:{examId:'exam-456'},networkTopic:{student:{userCode:'student-789'}}}});
    store.save(record);
    for(const format of ['csv','html','json']) {
      const file=path.join(dir,`history.${format}`);exportHistory(store.records(),file);
      const output=fs.readFileSync(file,'utf8');assert.ok(output.includes(record.submissionCode));
      assert.ok(output.includes('student-789'));assert.ok(output.includes('exam-456'));
      if(format==='csv')assert.match(output,/"记录ID","答卷编号","所属任务"/);
      if(format==='html'){assert.ok(output.includes('paper&lt;123&gt;'));assert.ok(!output.includes('paper<123>'));}
    }
  } finally {store.close();}
});

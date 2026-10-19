import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';

test('历史分页在数据库内筛选并返回稳定页数与仲裁记录', t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-history-page-'));
  const store=new Store(root);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  for(let i=0;i<123;i++)store.save({id:String(i),state:i%2?'submitted':'review',time:new Date(1700000000000+i).toISOString(),presetName:i%3?'方案A':'方案B',result:{score:i,studentAnswer:i===77?'目标内容':'普通内容',comment:'评分依据',...(i===77?{dualEval:{result:'arbitration'}}:{})}});
  const second=store.historyPage({page:2,pageSize:50});
  assert.equal(second.total,123);assert.equal(second.items.length,50);assert.equal(second.page,2);assert.equal(second.totalPages,3);
  const filtered=store.historyPage({page:1,pageSize:50,state:'submitted',search:'目标内容',arbitrated:true});
  assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,'77');
  const clamped=store.historyPage({page:99,pageSize:50});assert.equal(clamped.items.length,23);assert.equal(clamped.page,3);
  assert.equal(store.historyPage({page:1,pageSize:500}).pageSize,200);
});

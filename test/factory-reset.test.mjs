import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resetPersonalData,resetConfirmation} from '../src/factory-reset.mjs';
import {createApp} from '../src/server.mjs';

test('整机还原保留功能文件、备份个人资料并生成空白默认配置',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-reset-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const dir of ['data','sessions','archived-sessions','browser-profile','ui-profile','vendor','src','ui']){fs.mkdirSync(path.join(root,dir));fs.writeFileSync(path.join(root,dir,'fixture.txt'),dir);}
  for(const file of ['config.json','shared-providers.json','config.json.before-test','.env','.env.local','default-task-deleted.json'])fs.writeFileSync(path.join(root,file),'private');
  const defaults=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));
  const backup=resetPersonalData(root,defaults);
  for(const name of ['data','sessions','archived-sessions','browser-profile','ui-profile','.env','.env.local','default-task-deleted.json']){assert.ok(!fs.existsSync(path.join(root,name)));assert.ok(fs.existsSync(path.join(backup,name)));}
  for(const name of ['src','ui','vendor'])assert.equal(fs.readFileSync(path.join(root,name,'fixture.txt'),'utf8'),name);
  const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));assert.deepEqual(config.presets,defaults.presets);assert.deepEqual(config.workflows,defaults.workflows);assert.equal(config.batchLimit,0);assert.equal(config.mode,'trial');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'shared-providers.json'),'utf8')),defaults.providers);
  assert.equal(fs.readFileSync(path.join(backup,'shared-providers.json'),'utf8'),'private');
});

test('还原入口必须确认，运行任务时拒绝，任意任务面板请求交给全局处理',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-reset-api-'));let called=0;
  const app=await createApp({root,onFactoryReset:()=>called++});t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
  const initial=await fetch(app.url);const cookie=initial.headers.get('set-cookie').split(';')[0];
  const request=confirmation=>fetch(app.url+'/api/factory-reset?workspace=some-task',{method:'POST',headers:{cookie,origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({confirmation})});
  assert.equal((await request('wrong')).status,400);
  app.state.running=true;assert.equal((await request(resetConfirmation)).status,400);app.state.running=false;
  assert.equal((await request(resetConfirmation)).status,200);await new Promise(r=>setTimeout(r,550));assert.equal(called,1);
});

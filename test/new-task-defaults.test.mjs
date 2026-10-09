import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';

test('新任务恢复全部任务默认值，不复制来源配置或恢复已删全局接口',async t=>{
  for(const providers of [{自定义接口:{endpoint:'https://fixture.test',models:['old-model']}},{}]) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-default-task-'));
    const defaults=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));
    const old=structuredClone(defaults);
    Object.assign(old,{providers,mode:'unattended',batchLimit:37,bindings:{old:'old'},workspaceName:'旧任务',requestBudget:99});
    old.browser.url='https://fixture.test/old';
    old.presets[old.active]={question:'旧题',answer:'旧答案',rubric:'旧标准',workflowId:'old',blankDetection:{enabled:true,reference:[0.2]},scoring:{maxScore:10,items:[{id:'old',label:'旧项',maxScore:10}]}};
    old.workflows={old:{model:{provider:'自定义接口',model:'old-model'},recognitionPolicy:'arbitration',dualEval:{enabled:true}}};
    old.platform={verified:true,paperIdSelector:'#old',submitResponseUrlPattern:'old',acceptance:{time:'old'}};
    old.adaptationGroups=[{id:'old',name:'旧分组',url:'https://fixture.test/',platform:old.platform}];
    fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(old));
    const app=await createApp({root});t.after(()=>app.close());
    const home=await fetch(app.url),cookie=home.headers.get('set-cookie').split(';')[0];
    const created=await(await fetch(app.url+'/api/workspaces',{method:'POST',headers:{origin:app.url,cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'新任务'})})).json();
    assert.ok(created.id);
    const fresh=await(await fetch(app.url+'/api/settings?workspace='+created.id,{headers:{cookie}})).json();
    for(const key of ['presets','browser','platform','mode','batchLimit','requestBudget','bindings']) assert.deepEqual(fresh[key],defaults[key],key);
    assert.deepEqual(fresh.providers,providers);
    assert.equal(fresh.workspaceName,'新任务');
    const workflow=fresh.workflows['我的工作流'];
    assert.equal(workflow.model.model,'');assert.equal(workflow.dualEval.enabled,false);
    assert.equal(workflow.model.provider,Object.keys(providers)[0]||'');
    assert.equal(fresh.adaptationGroups[0].platform.verified,false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')).presets[old.active].rubric,'旧标准');
    await app.close();
  }
});

test('删除默认任务归档历史和登录目录，保留其他任务与全局接口，重启不恢复',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-delete-default-'));
  let app=await createApp({root});t.after(()=>app.close());
  const request=async(url,body)=>{
    const home=await fetch(app.url),cookie=home.headers.get('set-cookie').split(';')[0];
    const response=await fetch(app.url+url,{headers:{cookie,origin:app.url,'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
    return {status:response.status,value:await response.json()};
  };
  const next=(await request('/api/workspaces',{name:'保留任务'})).value.id;
  app.store.save({id:'archived-record',state:'submitted',result:{score:2}});
  fs.mkdirSync(path.join(root,'browser-profile'));fs.writeFileSync(path.join(root,'browser-profile','fixture'),'login');
  const providers=fs.readFileSync(path.join(root,'shared-providers.json'),'utf8');
  app.state.running=true;assert.equal((await request('/api/workspaces',{action:'delete',id:'default'})).status,400);app.state.running=false;
  const deleted=await request('/api/workspaces',{action:'delete',id:'default'});
  assert.equal(deleted.status,200);assert.equal(deleted.value.nextId,next);
  const archive=JSON.parse(fs.readFileSync(path.join(root,'default-task-deleted.json'),'utf8')).archive;
  assert.ok(fs.existsSync(path.join(archive,'data','history.sqlite')));
  const {Store}=await import('../src/store.mjs');const archived=new Store(path.join(archive,'data'));
  assert.equal(archived.records()[0].id,'archived-record');archived.close();
  assert.equal(fs.readFileSync(path.join(archive,'browser-profile','fixture'),'utf8'),'login');
  assert.deepEqual(app.store.records(),[]);assert.equal(fs.readFileSync(path.join(root,'shared-providers.json'),'utf8'),providers);
  assert.deepEqual((await request('/api/workspaces')).value.map(w=>w.id),[next]);
  await app.close();app=await createApp({root});
  assert.deepEqual((await request('/api/workspaces')).value.map(w=>w.id),[next]);
  const last=await request('/api/workspaces',{action:'delete',id:next});assert.equal(last.status,200);
  assert.notEqual(last.value.nextId,'default');assert.notEqual(last.value.nextId,next);
  const empty=(await request('/api/settings?workspace='+last.value.nextId)).value;
  assert.equal(empty.presets[empty.active].rubric,'');
});

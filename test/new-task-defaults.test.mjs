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

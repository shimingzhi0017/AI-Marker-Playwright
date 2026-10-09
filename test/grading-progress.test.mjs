import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {grade} from '../src/models.mjs';

test('双阅单路失败立即结束并取消另一请求；整份超时有明确记录；各角色进度可见',async t=>{
  let mode='failure';const sockets=new Set();
  const result={score:2,studentAnswer:'fixture',comment:'fixture',subScores:[],scoringDetails:[{label:'评分点',score:2,maxScore:2}],recognition:{status:'clear',coverageChecked:true,notes:[],issues:[]}};
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;const model=JSON.parse(body).model;
    if(mode==='failure'&&model==='primary'){res.writeHead(401);res.end('{}');return;}
    if(mode!=='success')return;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}));
  });server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{for(const s of sockets)s.destroy();return new Promise(resolve=>server.close(resolve));});
  const config={answer:'fixture',rubric:'评分点：2分',workflowId:'w',scoring:{maxScore:2}};
  const settings={gradingTimeoutMs:1000,providers:{p:{endpoint:`http://127.0.0.1:${server.address().port}`,apiKey:'fixture'}},workflows:{w:{model:{provider:'p',model:'primary'},dualEval:{enabled:true,secondary:{provider:'p',model:'secondary'},arbitration:{provider:'p',model:'arbitration'}}}}};
  const events=[];const start=Date.now();
  await assert.rejects(grade(config,settings,[],undefined,e=>events.push(e)),/401/);
  assert.ok(Date.now()-start<700);assert.ok(events.some(e=>e.role==='主评'&&e.status==='failed'));assert.ok(events.some(e=>e.role==='复评'&&e.status==='requesting'));
  mode='hang';settings.gradingTimeoutMs=100;
  await assert.rejects(grade(config,settings,[]),error=>error.modelRequestFailure?.type==='整份评分超时');
  mode='success';settings.gradingTimeoutMs=1000;events.length=0;
  const final=await grade(config,settings,[],undefined,e=>events.push(e));assert.equal(final.score,2);assert.equal(final.dualEval.result,'consensus');
  assert.ok(events.some(e=>e.role==='主评'&&e.status==='completed'));assert.ok(events.some(e=>e.role==='复评'&&e.status==='completed'));
});

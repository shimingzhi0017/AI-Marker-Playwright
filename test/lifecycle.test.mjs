import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import sharp from 'sharp';
import {createApp} from '../src/server.mjs';
import {launchBrowser} from '../src/browser.mjs';

test('关闭控制台释放已连接但未发送HTTP请求的浏览器连接', {timeout:5000}, async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-idle-close-'));
  const app=await createApp({root});
  const accepted=new Promise(resolve=>app.server.once('connection',resolve));
  const socket=net.connect({host:'127.0.0.1',port:new URL(app.url).port});
  t.after(async()=>{socket.destroy();await app.close();fs.rmSync(root,{recursive:true,force:true});});
  await accepted;
  const closing=app.close();assert.equal(app.close(),closing);
  let timer;
  try{await Promise.race([closing,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('关闭仍在等待未发送请求的连接')),1000);})]);}
  finally{clearTimeout(timer);}
  assert.equal(app.server.listening,false);
  await new Promise(resolve=>socket.destroyed?resolve():socket.once('close',resolve));
  assert.equal(socket.destroyed,true);
});

test('单评忽略无效旧仲裁配置，关闭未结束诊断响应后保留评分并能重启', {timeout:20000}, async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-lifecycle-'));
  const responseStarted=Promise.withResolvers();
  const image=await sharp({create:{width:180,height:90,channels:3,background:'#fff'}}).png().toBuffer();
  const fixture=http.createServer((req,res)=>{
    if(req.url==='/image'){res.setHeader('Content-Type','image/png');res.end(image);return;}
    if(req.url==='/mark/pending'){
      res.writeHead(200,{'Content-Type':'application/json'});res.flushHeaders();responseStarted.resolve();return;
    }
    res.setHeader('Content-Type','text/html');
    res.end('<div id="paper" data-paper-id="paper1"></div><div id="task">task</div><div name="topicImg"><img src="/image"></div><input name="topicTxt" score="4"><button id="bnt_save">提交</button>');
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const config=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));
  const base=`http://127.0.0.1:${fixture.address().port}`;
  config.browser.url=base+'/mark';config.platform={paperIdSelector:'#paper',taskIdSelector:'#task',loadTimeoutMs:1000};
  config.presets[config.active]={answer:'模拟参考',rubric:'模拟标准',workflowId:'我的工作流',scoring:{maxScore:4,roundStep:1,units:[]}};
  config.providers={fixture:{endpoint:base,apiKey:'fixture'}};
  config.workflows['我的工作流']={model:{provider:'fixture',model:'primary'},recognitionPolicy:'arbitration',dualEval:{enabled:false,arbitration:{provider:'deleted-provider',model:'unused'}}};
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(config));
  const browser=await launchBrowser({headless:true});let context,app,modelCalls=0;
  const opts={root,browserFactory:async()=>{context=await browser.newContext();return context;},gradeFunction:async()=>{modelCalls++;return {score:2,studentAnswer:'模拟答案',comment:'模拟依据',subScores:[]};}};
  t.after(async()=>{fixture.closeAllConnections();await app?.close();await browser.close();await new Promise(resolve=>fixture.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  app=await createApp(opts);
  let cookie=(await fetch(app.url)).headers.get('set-cookie').split(';')[0];
  const request=async(url,body)=>{const response=await fetch(app.url+url,{method:body===undefined?'GET':'POST',headers:{cookie,origin:app.url,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,value:await response.json()};};
  assert.equal((await request('/api/open',{})).status,200);
  assert.equal((await request('/api/start',{})).status,200);
  const deadline=Date.now()+3000;while(!app.state.review&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(app.state.review,true,app.state.reason);assert.equal(modelCalls,1);
  const recordId=app.state.record.id;
  assert.equal((await request('/api/review',{decision:'fill',recordId,scores:[2]})).status,200);
  while(app.state.running&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(app.store.records()[0].state,'filled');
  const page=context.pages()[0];
  const receivedHeaders=page.waitForResponse(response=>response.url()===base+'/mark/pending');
  await page.evaluate(()=>{fetch('/mark/pending',{method:'POST'}).then(response=>response.text()).catch(()=>{});});
  await responseStarted.promise;await receivedHeaders;
  await app.close();await app.close();
  const log=fs.readFileSync(path.join(root,'data','diagnostics','submission-observations.jsonl'),'utf8');
  assert.match(log,/response-unavailable/);assert.match(log,/诊断已停止/);
  app=await createApp(opts);cookie=(await fetch(app.url)).headers.get('set-cookie').split(';')[0];
  assert.equal(app.state.running,false);assert.equal(app.state.browserOpen,false);
  const records=(await request('/api/history')).value;
  assert.equal(records.length,1);assert.equal(records[0].id,recordId);assert.equal(records[0].state,'filled');assert.equal(records[0].result.score,2);
  assert.equal(modelCalls,1);
});

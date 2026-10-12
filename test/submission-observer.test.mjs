import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { launchBrowser } from '../src/browser.mjs';
import { observeSubmissions, redact } from '../src/submission-observer.mjs';
test('手动提交诊断记录请求、响应和换卷，不点击或修改历史状态', async t => {
  let submits = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/mark/save') { submits++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({success:true,token:'response-secret',data:{paperId:'p1'}})); return; }
    res.setHeader('Content-Type','text/html');
    res.end(`<input type="hidden" id="answerSheetId" value="p1"><input name="topicTxt" value="2"><button id="bnt_save" onclick="fetch('/mark/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paperId:'p1',score:2,token:'request-secret'})}).then(()=>document.querySelector('#answerSheetId').value='p2')">提交</button>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await launchBrowser({headless:true});const context=await browser.newContext();const page=await context.newPage();
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'submission-observer-'));
  const record={id:'r1',state:'filled',snapshot:{identity:'p1'}};
  const platform={page,snapshot:async()=>({identity:await page.locator('#answerSheetId').inputValue(),images:[{ready:true,url:'https://fixture/next.png'}]})};
  const observer=await observeSubmissions(context,{directory,getPlatform:()=>platform,getRecord:()=>record,note:()=>{},intervalMs:50});
  t.after(async()=>{await observer.close();await browser.close();await new Promise(resolve=>server.close(resolve));});
  await page.goto(`http://127.0.0.1:${server.address().port}`);assert.equal(submits,0);await page.locator('#bnt_save').click();
  const deadline=Date.now()+5000;while(Date.now()<deadline){const log=fs.readFileSync(observer.file,'utf8');if(log.includes('next-answer-observed')&&log.includes('network-response'))break;await new Promise(resolve=>setTimeout(resolve,50));}
  const raw=fs.readFileSync(observer.file,'utf8');const events=raw.trim().split('\n').map(JSON.parse);
  assert.equal(submits,1);assert.equal(record.state,'filled');
  for(const type of ['submit-click','network-request','network-response','next-answer-observed'])assert.ok(events.some(e=>e.type===type),type);
  assert.doesNotMatch(raw,/request-secret|response-secret/);assert.equal(events.find(e=>e.type==='network-response').body.success,true);assert.equal(events.find(e=>e.type==='network-request').body.score,2);
  assert.equal(redact({apiKey:'secret',url:'https://fixture/x?Signature=secret'}).apiKey,'[redacted]');
});

test('关闭诊断不等待未结束的响应正文，不在关闭后追加换卷记录', {timeout:5000}, async()=>{
  let onClick;
  const context=new EventEmitter();context.exposeBinding=async(_name,callback)=>{onClick=callback;};context.addInitScript=async()=>{};
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'submission-close-'));
  const snapshotStarted=Promise.withResolvers(),snapshot=Promise.withResolvers();
  const platform={page:{url:()=> 'https://fixture.test/mark'},snapshot:()=>{snapshotStarted.resolve();return snapshot.promise;}};
  const observer=await observeSubmissions(context,{directory,getPlatform:()=>platform,getRecord:()=>({snapshot:{identity:'before'}}),note:()=>{},intervalMs:10});
  const request={url:()=> 'https://fixture.test/mark/save',resourceType:()=> 'fetch',method:()=> 'POST',postData:()=> '{"score":2}'};
  const pending=Promise.withResolvers();
  context.emit('request',request);
  context.emit('response',{request:()=>request,status:()=>200,headers:()=>({'content-type':'application/json'}),text:()=>pending.promise});
  try{
    await onClick({page:platform.page},{});await snapshotStarted.promise;
    await observer.close();await observer.close();
    assert.equal(context.listenerCount('response'),0);
    const log=fs.readFileSync(observer.file,'utf8');
    assert.match(log,/response-unavailable/);assert.match(log,/诊断已停止/);
    pending.resolve('{"success":true}');snapshot.resolve({identity:'after',images:[{ready:true}]});await new Promise(resolve=>setImmediate(resolve));
    context.emit('request',request);
    assert.equal(fs.readFileSync(observer.file,'utf8'),log);
  }finally{pending.resolve('');snapshot.resolve({identity:'after',images:[]});await observer.close();fs.rmSync(directory,{recursive:true,force:true});}
});

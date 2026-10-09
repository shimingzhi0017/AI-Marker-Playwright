import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import sharp from 'sharp';
import {launchBrowser} from '../src/browser.mjs';
import {ZhixuePlatform} from '../src/platform.mjs';
import {AdaptationDebugger,matchingGroup,applyGroup,fingerprint,installPicker,verifyManualResponse} from '../src/adaptation.mjs';

test('网址分组精确域名、路由前缀及歧义拒绝，规则修改使指纹变化',()=>{
  const groups=[{id:'root',url:'https://fixture.test/',platform:{verified:false}},{id:'specific',url:'https://fixture.test/mark/#/personal',platform:{verified:true}}];
  assert.equal(matchingGroup(groups,'https://fixture.test/mark/#/personal?paper=1').id,'specific');
  assert.equal(matchingGroup(groups,'https://other.test/'),null);
  assert.equal(applyGroup({adaptationGroups:groups},'https://other.test/').platform.verified,false);
  assert.throws(()=>matchingGroup([...groups,{...groups[1],id:'duplicate'}],'https://fixture.test/mark/#/personal'),/多个/);
  assert.notEqual(fingerprint({imageSelector:'#one'}),fingerprint({imageSelector:'#two'}));
});

test('通用平台提交验证拒绝错误编号、分数及失败回执',()=>{
  const options={identityRequestField:'id',scoresRequestField:'scores',successField:'result',successValue:'success'};
  const snapshot={paperId:'paper1',strongIdentity:true};
  const candidate={status:200,requestBody:{id:'paper1',scores:'[2]'},responseBody:{result:'success'}};
  assert.equal(verifyManualResponse(options,snapshot,[2],candidate).confirmed,true);
  assert.throws(()=>verifyManualResponse(options,snapshot,[3],candidate),/分数/);
  assert.throws(()=>verifyManualResponse(options,{...snapshot,paperId:'paper2'},[2],candidate),/ID/);
  assert.throws(()=>verifyManualResponse(options,snapshot,[2],{...candidate,responseBody:{result:'failed'}}),/成功/);
});

test('浏览器完整自主调试：点选拦截、只填分、手动提交、回执及换卷', {timeout:30000},async t=>{
  const image=await sharp({create:{width:160,height:80,channels:3,background:'white'}}).png().toBuffer();let submits=0;
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/image')){res.setHeader('Content-Type','image/png');res.end(image);return;}
    if(req.url==='/commit'){submits++;res.setHeader('Content-Type','application/json');res.end('{"result":"success"}');return;}
    res.setHeader('Content-Type','text/html');res.end(`<div id="paper" data-paper-id="paper1">paper1</div><div id="task">12</div><img id="answer" src="/image1"><input id="score" name="topicTxt" max="10"><button id="bnt_save" onclick="fetch('/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:document.querySelector('#paper').dataset.paperId,scores:[Number(document.querySelector('#score').value)]})}).then(()=>{document.querySelector('#paper').dataset.paperId='paper2';document.querySelector('#answer').src='/image2'})">提交</button>`);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await launchBrowser({headless:true});const page=await browser.newPage();
  t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});await page.goto(`http://127.0.0.1:${server.address().port}`);
  let picked;await page.exposeFunction('__markerAdaptationPicked',value=>{picked=value;});
  await page.evaluate(installPicker,{key:'submitSelector',token:'test'});await page.locator('#bnt_save').click();assert.equal(submits,0);assert.equal(picked.selector,'#bnt_save');
  const options={imageSelector:'#answer',taskIdSelector:'#task',paperIdSelector:'#paper',scoreSelector:'#score',submitSelector:'#bnt_save',identityRequestField:'id',scoresRequestField:'scores',successField:'result',successValue:'success',loadTimeoutMs:2000};
  const platform=new ZhixuePlatform(page,{platform:options},os.tmpdir());const debug=new AdaptationDebugger(()=>platform);
  await debug.fill([2]);assert.equal(await page.locator('#score').inputValue(),'2');assert.equal(submits,0);
  await debug.record();await page.locator('#bnt_save').click();await page.waitForFunction(()=>document.querySelector('#paper').dataset.paperId==='paper2');
  for(let i=0;i<20&&!debug.candidates.length;i++)await page.waitForTimeout(50);
  const index=debug.candidates.findIndex(c=>c.url.endsWith('/commit'));assert.ok(index>=0);
  const result=await debug.verify(index);assert.equal(result.receipt.confirmed,true);assert.equal(submits,1);assert.equal(debug.status.phase,'verified');
});

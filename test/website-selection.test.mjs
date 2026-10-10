import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {launchBrowser} from '../src/browser.mjs';
import {applyGroup} from '../src/adaptation.mjs';

test('选择的网站优先使用对应规则，其余网址继续自动匹配',()=>{
  const a={id:'a',url:'https://fixture.test/',platform:{scoreSelector:'#a'}};
  const b={id:'b',url:'https://fixture.test/',platform:{scoreSelector:'#b'}};
  const c={id:'c',url:'https://other.test/',platform:{scoreSelector:'#c'}};
  const settings={selectedAdaptationGroupId:'b',adaptationGroups:[a,b,c]};
  assert.equal(applyGroup(settings,'https://fixture.test/mark').platform.scoreSelector,'#b');
  assert.equal(applyGroup(settings,'https://other.test/mark').platform.scoreSelector,'#c');
});

test('网站选择保存网址、切换已打开浏览器、保留草稿并在刷新后恢复', {timeout:30000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-websites-'));
  const cfg=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));
  cfg.browser.url='https://fixture.test/first';
  cfg.adaptationGroups=[
    {id:'first',name:'网站一',url:'https://fixture.test/first',platform:{scoreSelector:'#first',verified:false}},
    {id:'second',name:'网站二',url:'https://fixture.test/second',platform:{scoreSelector:'#second',verified:false}},
    {id:'builtin',name:'智学网',templateId:'zhixue',url:'https://www.zhixue.com/',platform:{verified:false}}
  ];
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(cfg));
  const browser=await launchBrowser({headless:true});let gradingPage,context;
  const app=await createApp({root,browserFactory:async()=>{
    context=await browser.newContext();await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<h1>Website fixture</h1>'}));
    gradingPage=await context.newPage();return context;
  }});
  t.after(async()=>{await browser.close();await app.close();});
  const page=await browser.newPage({viewport:{width:1440,height:950}});page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);await page.waitForFunction(()=>document.querySelector('#adaptWebsite').options.length>20);
  await page.locator('#question').fill('未保存的题目草稿');
  await page.locator('[data-tab=grading]').click();
  await page.locator('[name=runMode][value=normal]').check();
  await page.locator('#adaptWebsite').selectOption('template:zhixue');
  await page.waitForFunction(()=>document.querySelector('#websiteAddress').textContent==='https://www.zhixue.com/');
  let saved=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
  assert.equal(saved.browser.url,'https://www.zhixue.com/');assert.equal(saved.selectedAdaptationGroupId,'builtin');
  assert.equal(await page.locator('#mode').inputValue(),'normal');
  assert.equal(await page.locator('#question').inputValue(),'未保存的题目草稿');
  await page.locator('#open').click();await page.waitForFunction(()=>!document.querySelector('#diagnose').disabled);
  assert.equal(gradingPage.url(),'https://www.zhixue.com/');
  app.state.snapshot={images:[{}],units:[{}],strongIdentity:true};app.state.diagnosisError='旧错误';
  await page.locator('#adaptWebsite').selectOption('group:second');
  await page.waitForFunction(()=>document.querySelector('#websiteAddress').textContent==='https://fixture.test/second');
  assert.equal(gradingPage.url(),'https://fixture.test/second');assert.equal(app.state.snapshot,null);assert.equal(app.state.diagnosisError,'');
  saved=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
  assert.equal(saved.browser.url,'https://fixture.test/second');assert.equal(saved.platform.scoreSelector,'#second');
  assert.equal(await page.locator('[data-platform="browser.url"]').inputValue(),'https://fixture.test/second');
  assert.equal(await page.locator('#question').inputValue(),'未保存的题目草稿');
  await page.locator('#adaptWebsite').selectOption('template:zhixue');
  await page.waitForFunction(()=>document.querySelector('#websiteAddress').textContent==='https://www.zhixue.com/');
  assert.equal(gradingPage.url(),'https://www.zhixue.com/');
  saved=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
  assert.equal(saved.adaptationGroups.filter(g=>g.templateId==='zhixue').length,1);
  // A new built-in choice uses the same save/navigation path.
  await page.locator('#adaptWebsite').selectOption('template:c30');
  await page.waitForFunction(()=>document.querySelector('#adaptUrl').value!== 'https://www.zhixue.com/');
  saved=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));assert.equal(gradingPage.url(),saved.browser.url);
  await page.locator('#adaptWebsite').selectOption('group:second');await page.waitForFunction(()=>document.querySelector('#websiteAddress').textContent==='https://fixture.test/second');
  page.once('dialog',dialog=>dialog.accept());await page.reload();await page.locator('[data-tab=grading]').click();
  assert.equal(await page.locator('#adaptWebsite').inputValue(),'group:second');assert.equal(await page.locator('#websiteAddress').innerText(),'https://fixture.test/second');
  await context.close();await page.waitForFunction(()=>document.querySelector('#diagnose').disabled);
  await page.locator('#open').click();await page.waitForFunction(()=>!document.querySelector('#diagnose').disabled);assert.equal(gradingPage.url(),'https://fixture.test/second');
  assert.deepEqual(errors,[]);
});

import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createApp} from '../../src/server.mjs';

const project=fileURLToPath(new URL('../../',import.meta.url));
let browser;
before(async()=>{
  const directory=path.join(project,'browsers');
  const revision=fs.existsSync(directory)?fs.readdirSync(directory).find(name=>/^chromium-\d+$/.test(name)):null;
  const bundled=revision&&path.join(directory,revision,'chrome-win64','chrome.exe');
  browser=await chromium.launch({headless:true,...(bundled&&fs.existsSync(bundled)?{executablePath:bundled}:{})});
});
after(async()=>{await browser?.close();});

const text=value=>typeof value==='string'?value:value?.text;
async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-save-ui-'));
  const app=await createApp({root});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await context.close();await app.close();fs.rmSync(root,{recursive:true,force:true});assert.deepEqual(errors,[]);});
  await page.goto(app.url);
  await page.waitForFunction(()=>document.getElementById('presetSelect').options.length>0&&document.getElementById('workspaceCards').children.length>0);
  await page.locator('.task-tabs [data-tab="presets"]').click();
  const settings=()=>JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
  return {root,app,context,page,settings};
}
async function shown(page,tab){await page.waitForFunction(id=>!document.getElementById(id).hidden,tab);}
async function delayFirstSave(page,failFirst=false) {
  let release,started;
  const gate=new Promise(resolve=>release=resolve),start=new Promise(resolve=>started=resolve);
  let count=0;
  await page.route('**/api/settings*',async route=>{
    if(route.request().method()==='POST'&&++count===1){started();await gate;if(failFirst){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'测试保存失败'})});return;}}
    await route.continue();
  });
  return {start,release,get count(){return count;}};
}

test('next saves the complete preset, including images, and persists across reload',async t=>{
  const {page,settings}=await fixture(t);
  await page.locator('#answer').fill('下一步保存参考答案');
  await page.locator('#rubric').fill('下一步保存评分标准');
  await page.locator('#maxScore').fill('10');
  await page.locator('#roundStep').fill('0.5');
  await page.locator('#answerUpload').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
  await page.locator('#answerReferenceImages img').waitFor({state:'attached'});
  await page.locator('#nextScoringSettings').click();await shown(page,'workflows');
  const saved=settings().presets['我的方案'];
  assert.equal(text(saved.answer),'下一步保存参考答案');
  assert.equal(text(saved.rubric),'下一步保存评分标准');
  assert.equal(saved.answer.images.length,1);
  assert.equal(saved.scoring.maxScore,10);assert.equal(saved.scoring.roundStep,0.5);
  assert.equal(await page.locator('#dirtyBadge').isVisible(),false);
  await page.reload();
  await page.locator('.task-tabs [data-tab="presets"]').click();
  assert.equal(await page.locator('#answer').inputValue(),'下一步保存参考答案');
  assert.equal(await page.locator('#rubric').inputValue(),'下一步保存评分标准');
});

test('next waits for disk save, shows progress, and saves edits made while the request is pending',async t=>{
  const {page,settings}=await fixture(t),delay=await delayFirstSave(page);
  await page.locator('#rubric').fill('保存请求发出前的标准');
  await page.locator('#nextScoringSettings').click();await delay.start;
  assert.equal(await page.locator('#presets').isVisible(),true);
  assert.equal(await page.locator('#nextScoringSettings').textContent(),'正在保存…');
  assert.equal(await page.locator('#nextScoringSettings').isDisabled(),true);
  assert.notEqual(text(settings().presets['我的方案'].rubric),'保存请求发出前的标准');
  await page.locator('#rubric').fill('请求等待期间继续修改的最终标准');
  delay.release();await shown(page,'workflows');
  assert.equal(text(settings().presets['我的方案'].rubric),'请求等待期间继续修改的最终标准');
  assert.equal(delay.count,2);
});

test('next pressed during another save is queued instead of silently ignored',async t=>{
  const {page,settings}=await fixture(t),delay=await delayFirstSave(page);
  await page.locator('#rubric').fill('手动保存中的旧标准');
  await page.locator('#savePreset').click();await delay.start;
  await page.locator('#rubric').fill('点击下一步时的新标准');
  await page.locator('#nextScoringSettings').click();
  assert.match(await page.locator('#presetSaveStatus').textContent(),/随后自动保存/);
  delay.release();await shown(page,'workflows');
  assert.equal(text(settings().presets['我的方案'].rubric),'点击下一步时的新标准');
  assert.equal(delay.count,2);
});

test('failed autosave keeps edits and stays on the preset page, with a working retry',async t=>{
  const {page,settings}=await fixture(t);
  await page.route('**/api/settings*',route=>route.request().method()==='POST'?route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'测试保存失败'})}):route.continue());
  await page.locator('#rubric').fill('保存失败后仍保留的标准');
  await page.locator('#nextScoringSettings').click();
  await page.waitForFunction(()=>document.getElementById('presetSaveStatus').textContent.includes('保存失败'));
  assert.equal(await page.locator('#presets').isVisible(),true);
  assert.equal(await page.locator('#rubric').inputValue(),'保存失败后仍保留的标准');
  assert.notEqual(text(settings().presets['我的方案'].rubric),'保存失败后仍保留的标准');
  assert.equal(await page.locator('#dirtyBadge').isVisible(),true);
  await page.unroute('**/api/settings*');
  await page.locator('#nextScoringSettings').click();await shown(page,'workflows');
  assert.equal(text(settings().presets['我的方案'].rubric),'保存失败后仍保留的标准');
});

test('a failed earlier action cancels the queued next step and leaves an actionable status',async t=>{
  const {page,settings}=await fixture(t),delay=await delayFirstSave(page,true);
  await page.locator('#rubric').fill('前一操作失败时保留的标准');
  await page.locator('#savePreset').click();await delay.start;
  await page.locator('#nextScoringSettings').click();delay.release();
  await page.waitForFunction(()=>document.getElementById('presetSaveStatus').textContent.includes('当前操作失败'));
  assert.equal(await page.locator('#presets').isVisible(),true);
  assert.equal(await page.locator('#dirtyBadge').isVisible(),true);
  assert.equal(delay.count,1);
  assert.notEqual(text(settings().presets['我的方案'].rubric),'前一操作失败时保留的标准');
  await page.unroute('**/api/settings*');
  await page.locator('#nextScoringSettings').click();await shown(page,'workflows');
  assert.equal(text(settings().presets['我的方案'].rubric),'前一操作失败时保留的标准');
});

test('the workflow next button also saves before returning to the grading page',async t=>{
  const {page,settings}=await fixture(t);
  await page.locator('#nextScoringSettings').click();await shown(page,'workflows');
  await page.locator('#primaryModel').fill('autosave-model');
  let starts=0;page.on('request',request=>{if(request.url().includes('/api/start'))starts++;});
  await page.locator('#nextStartGrading').click();await shown(page,'grading');
  assert.equal(settings().workflows['我的工作流'].model.model,'autosave-model');
  assert.equal(await page.locator('#dirtyBadge').isVisible(),false);
  assert.equal(starts,0);
});

test('autosave writes to the selected child task without changing the default task',async t=>{
  const {root,app,context,page,settings}=await fixture(t);
  const original=settings();
  const response=await context.request.post(app.url+'/api/workspaces',{headers:{Origin:app.url},data:{}});
  assert.equal(response.ok(),true);const {id}=await response.json();
  await page.locator(`[data-workspace="${id}"]`).waitFor();
  const loaded=page.waitForResponse(response=>response.request().method()==='GET'&&response.url().includes('/api/settings?workspace='+id));
  await page.locator(`[data-workspace="${id}"]`).click();await loaded;
  await page.locator('.task-tabs [data-tab="presets"]').click();
  await page.locator('#rubric').fill('仅保存当前子任务');
  await page.locator('#nextScoringSettings').click();await shown(page,'workflows');
  const child=JSON.parse(fs.readFileSync(path.join(root,'sessions',id,'config.json'),'utf8'));
  assert.equal(text(child.presets[child.active].rubric),'仅保存当前子任务');
  assert.deepEqual(settings(),original);
});

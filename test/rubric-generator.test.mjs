import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import sharp from 'sharp';
import {generateRubric} from '../src/rubric-generator.mjs';
import {createApp} from '../src/server.mjs';
import {launchBrowser} from '../src/browser.mjs';

test('评分标准生成验证分值并拒绝缺少题目或答案', async () => {
  const settings={providers:{demo:{}}}, input={provider:'demo',model:'vision',question:'题目',answer:'答案',maxScore:4};
  await assert.rejects(generateRubric(settings,{...input,answer:''}),/参考答案/);
  await assert.rejects(generateRubric(settings,input,async()=>JSON.stringify({question:'题目',answer:'答案',rubric:'① 第一空：满分3分',warnings:[]})),/分项/);
  const result=await generateRubric(settings,input,async()=>JSON.stringify({question:'题目',answer:'答案',rubric:'① 第一空：满分4分\n正确4分，错误0分',warnings:['分值分配须确认']}));
  assert.equal(result.warnings.length,1);
});

test('图片经已有接口生成草稿，预览回填后保存并保留原始图片', {timeout:45000}, async t => {
  let received;
  const fixture=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    received=JSON.parse(body);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question:'识别题目',answer:'识别答案',rubric:'第一空2分，第二空2分，共4分',items:[{label:'第一空',maxScore:2,criteria:'正确2分，错误0分。'},{label:'第二空',maxScore:2,criteria:'正确2分，错误0分。'}],warnings:['建议分值，请教师确认']})}}]}));
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-rubric-'));
  const app=await createApp({root});
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
  const provider=Object.keys(cfg.providers)[0];
  cfg.providers[provider]={protocol:'chat',endpoint:`http://127.0.0.1:${fixture.address().port}/v1`,apiKey:'fixture-key',models:['vision']};
  fs.writeFileSync(path.join(root,'shared-providers.json'),JSON.stringify(cfg.providers));
  cfg.presets[cfg.active].scoring.maxScore=0;
  cfg.workflows[cfg.presets[cfg.active].workflowId].model={provider,model:'vision'};
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(cfg));
  const before=fs.readFileSync(path.join(root,'config.json'),'utf8');
  const browser=await launchBrowser({headless:true});
  t.after(async()=>{await browser.close();await app.close();await new Promise(resolve=>fixture.close(resolve));});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);await page.locator('[data-tab=presets]').click();
  const image=await sharp({create:{width:30,height:30,channels:3,background:'white'}}).png().toBuffer();
  await page.locator('#question').evaluate((element,base64)=>{
    const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
    const data=new DataTransfer();data.items.add(new File([bytes],'clipboard.png',{type:'image/png'}));
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
    element.dispatchEvent(event);if(!event.defaultPrevented)throw Error('Image paste was not handled');
  },image.toString('base64'));
  await page.waitForFunction(()=>document.querySelectorAll('#questionReferenceImages img').length===1);
  const textPastePrevented=await page.locator('#question').evaluate(element=>{
    const data=new DataTransfer();data.setData('text/plain','普通文字');
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
    element.dispatchEvent(event);return event.defaultPrevented;
  });
  assert.equal(textPastePrevented,false);
  await page.locator('#answer').evaluate((element,base64)=>{
    const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(base64),char=>char.charCodeAt(0))],'answer.png',{type:'image/png'}));
    element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  },image.toString('base64'));
  await page.waitForFunction(()=>document.querySelectorAll('#answerReferenceImages img').length===1);
  assert.equal(await page.locator('#grading #answerImages img').count(),0);
  assert.equal(await page.locator('#presets #answerReferenceImages img').count(),1);
  assert.equal(await page.locator('#answerImages').count(),1);
  await page.locator('#openRubricGenerator').click();
  assert.equal(await page.locator('#rubricMaxScore').inputValue(),'');
  assert.equal(await page.locator('#rubricStrictness').inputValue(),'normal');
  await page.locator('#rubricMaxScore').fill('4');
  await page.locator('#rubricScoreAllocation').fill('第一空2分，第二空2分，忽略图片原分值');
  await page.locator('#rubricStrictness').selectOption('lenient');
  assert.match(await page.locator('#rubricRequirements').inputValue(),/简写/);
  await page.locator('#rubricStrictness').selectOption('custom');
  await page.locator('#rubricRequirements').fill('允许同义词，但必须写出单位');
  await page.locator('#generateRubric').click();
  await page.locator('#rubricDraft').waitFor({state:'visible'});
  assert.equal(received.model,'vision');assert.equal(received.messages[0].content.filter(part=>part.type==='image_url').length,2);
  assert.match(received.messages[0].content[0].text,/不得固定为四项/);
  assert.match(received.messages[0].content[0].text,/总分：4分/);
  assert.match(received.messages[0].content[0].text,/第一空2分，第二空2分/);
  assert.match(received.messages[0].content[0].text,/忽略题目图片、答案图片/);
  assert.match(received.messages[0].content[0].text,/允许同义词，但必须写出单位/);
  assert.equal(fs.readFileSync(path.join(root,'config.json'),'utf8'),before);
  await page.locator('#applyGeneratedRubric').click();
  assert.equal(await page.locator('#question').inputValue(),'识别题目');
  assert.equal(await page.locator('#answer').inputValue(),'识别答案');
  await page.locator('#savePreset').click();await page.waitForFunction(()=>document.querySelector('#dirtyBadge').hidden);
  const saved=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')).presets[cfg.active];
  assert.equal(saved.question.images.length,1);assert.equal(saved.answer.images.length,1);
  assert.match(saved.rubric.text || saved.rubric,/第一空/);
  assert.equal(saved.scoring.maxScore,4);
  assert.equal(saved.rubricGeneration.strictness,'custom');
  assert.equal(saved.rubricGeneration.scoreAllocation,'第一空2分，第二空2分，忽略图片原分值');
  await page.reload();await page.locator('[data-tab=presets]').click();await page.locator('#openRubricGenerator').click();
  assert.equal(await page.locator('#rubricRequirements').inputValue(),'允许同义词，但必须写出单位');
  assert.equal(await page.locator('#rubricMaxScore').inputValue(),'4');
  assert.deepEqual(errors,[]);
});


test('AI接口未保存修改不阻止返回当前任务或切换另一任务', {timeout:30000}, async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-navigation-'));
  const app=await createApp({root});const browser=await launchBrowser({headless:true});
  t.after(async()=>{await browser.close();await app.close();});
  const page=await browser.newPage();const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
  await page.goto(app.url);await page.locator('.workspace-card.active').waitFor();
  await page.locator('[data-tab=models]').click();await page.locator('#editProvider').click();
  await page.locator('#endpoint').fill('https://draft.example/v1');await page.locator('#providerDialog').press('Escape');
  await page.locator('.workspace-card.active').click();
  assert.ok(await page.locator('.task-tabs').isVisible());assert.ok(await page.locator('#grading').isVisible());
  await page.locator('[data-tab=models]').click();await page.locator('#editProvider').click();
  assert.equal(await page.locator('#endpoint').inputValue(),'https://draft.example/v1');await page.locator('#providerDialog').press('Escape');
  await page.evaluate(async()=>{await fetch('/api/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});});
  await page.waitForFunction(()=>document.querySelectorAll('.workspace-card').length===2);
  await page.locator('.workspace-card:not(.active)').click();
  await page.waitForFunction(()=>document.querySelector('.task-tabs').hidden===false);
  await page.locator('[data-tab=models]').click();await page.locator('#editProvider').click();
  assert.equal(await page.locator('#endpoint').inputValue(),'https://draft.example/v1');
  assert.equal(dialogs.length,0);
});

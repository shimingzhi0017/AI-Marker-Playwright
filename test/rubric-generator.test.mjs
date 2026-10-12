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
import {promptFor,parseResult} from '../src/domain.mjs';
import {rubricSubjects,rubricRequirements,rubricPolicy,rubricScoringMethods,rubricGenerationSettings} from '../ui/rubric-prompts.js';

test('九学科三梯度生成不同提示词，接口使用对应模板并校验学科',async()=>{
  const subjects=Object.entries(rubricSubjects),prompts=[];
  assert.equal(subjects.length,9);
  const output=JSON.stringify({question:'题目',answer:'答案',rubric:'',warnings:[],items:[{label:'第一问',maxScore:4,criteria:'正确4分，错误0分。'}]});
  for(const [subject,entry]of subjects)for(const strictness of ['strict','normal','lenient']){
    const requirements=rubricRequirements(subject,strictness);prompts.push(requirements);
    assert.ok(requirements.includes(entry.label));assert.match(requirements,/不得猜补/);
    const result=await generateRubric({providers:{demo:{}}},{provider:'demo',model:'vision',question:'题目',answer:'答案',maxScore:4,subject,strictness},async(_provider,_model,prompt)=>{
      assert.ok(prompt.includes(`学科：${entry.label}`));assert.ok(prompt.includes(requirements));return output;
    });
    assert.ok(result.rubric.includes(requirements));
  }
  assert.equal(new Set(prompts).size,27);
  assert.match(rubricRequirements('physics','lenient'),/等价公式|公式变形/);
  assert.match(rubricRequirements('english','strict'),/词形、时态、拼写/);
  assert.equal(rubricRequirements('physics','custom'),'');
  await assert.rejects(generateRubric({providers:{demo:{}}},{provider:'demo',model:'vision',question:'题目',answer:'答案',maxScore:4,subject:'unknown'},async()=>output),/学科/);
});

test('教师给分方式独立于双评题型，特殊要求和评分边界进入生成提示词',async()=>{
  const settings={providers:{demo:{}}},input={version:2,provider:'demo',model:'vision',question:'题目',answer:'答案',maxScore:4,subject:'physics',strictness:'lenient',notes:'单位缺失只扣一次；有效数字按题目要求'};
  const output=JSON.stringify({question:'题目',answer:'答案',rubric:'',warnings:[],items:[{label:'第一问',maxScore:4,criteria:'正确4分，错误0分。'}]});
  for(const [scoringMethod,method] of Object.entries(rubricScoringMethods)){
    let prompt;
    const result=await generateRubric(settings,{...input,scoringMethod,questionType:'objective'},async(_provider,_model,text)=>{prompt=text;return output;});
    assert.ok(prompt.includes(method.text));assert.match(prompt,/单位缺失只扣一次/);assert.match(prompt,/同一错误不得重复扣分/);
    assert.match(prompt,/不得猜补/);assert.match(prompt,/具体题型根据本题设问确定/);assert.ok(result.rubric.includes(method.label));
    if(scoringMethod==='answers')assert.match(prompt,/不拆过程分/);
    if(scoringMethod==='points')assert.match(prompt,/客观选择或填空仍正确满分、错误零分/);
    if(scoringMethod==='holistic')assert.match(prompt,/分数边界及档内给分依据/);
    await generateRubric(settings,{...input,scoringMethod,questionType:'subjective'},async(_provider,_model,text)=>{assert.equal(text,prompt);return output;});
  }
  await generateRubric(settings,{...input,useCustomPrompt:true,customRequirements:'限定使用本题定义的符号',scoringMethod:'answers'},async(_provider,_model,prompt)=>{
    assert.match(prompt,/限定使用本题定义的符号/);assert.match(prompt,/单位缺失只扣一次/);assert.match(prompt,/不拆过程分/);assert.doesNotMatch(prompt,/充分认可物理意义/);return output;
  });
  const invalid=[{scoringMethod:'unknown'},{notes:'x'.repeat(2001)},{useCustomPrompt:true,customRequirements:''},{useCustomPrompt:true,customRequirements:'x'.repeat(6001)},{strictness:'custom'},{useCustomPrompt:'yes'}];
  for(const changes of invalid)await assert.rejects(generateRubric(settings,{...input,...changes},async()=>{assert.fail('无效设置不应发出请求');}));
});

test('旧模板及编辑过的提示词迁移时保留教师文字，新版设置再次打开不重复叠加',()=>{
  const base={subject:'physics',strictness:'normal',scoreAllocation:'第一问4分'};
  const normal=rubricGenerationSettings({...base,requirements:rubricRequirements('physics','normal')});
  assert.equal(normal.useCustomPrompt,false);assert.equal(normal.scoringMethod,'auto');
  const oldNormal='按通常教学与考试要求评分。核心概念、逻辑和结果正确即可认可合理等价表述；主观题按正确步骤给部分分。非关键措辞差异不扣分；单位、必要条件等按题目要求明确处理。';
  const currentNormal=rubricRequirements('','normal');
  assert.equal(rubricGenerationSettings({...base,requirements:rubricRequirements('physics','normal').replace(currentNormal,oldNormal)}).useCustomPrompt,false);
  for(const strictness of ['custom','normal']){
    const saved=rubricGenerationSettings({...base,strictness,requirements:'允许同义词，但必须写出单位'});
    assert.equal(saved.useCustomPrompt,true);assert.equal(saved.customRequirements,'允许同义词，但必须写出单位');assert.equal(saved.strictness,'normal');
    assert.match(rubricPolicy(saved),/允许同义词，但必须写出单位/);
    assert.deepEqual(rubricGenerationSettings(saved),saved);
  }
  const saved={...normal,notes:'本题必须写出方向',scoringMethod:'points'};
  assert.deepEqual(rubricGenerationSettings(saved),saved);
  assert.equal(rubricPolicy(saved).split('本题必须写出方向').length,2);
});

test('生成规则和实际模型评分遵守同一得分步长',async()=>{
  const settings={providers:{demo:{}}},input={provider:'demo',model:'vision',question:'题目',answer:'答案',maxScore:4,roundStep:1};
  const output=JSON.stringify({question:'题目',answer:'答案',rubric:'',warnings:[],items:[{label:'第一问',maxScore:4,criteria:'正确4分，部分正确0.5分。'}]});
  await assert.rejects(generateRubric(settings,input,async(_provider,_model,prompt)=>{assert.match(prompt,/得分步长：1分/);return output;}),/步长/);
  const half=await generateRubric(settings,{...input,roundStep:0.5},async()=>output);assert.match(half.rubric,/得分步长为0.5分/);
  const config={answer:'答案',rubric:'按规则评分',scoring:{maxScore:4,roundStep:1}};
  assert.match(promptFor(config),/得分步长：1分/);
  await assert.rejects(generateRubric(settings,{...input,maxScore:3.5},async()=>output),/整数倍/);
  assert.throws(()=>parseResult(JSON.stringify({score:0.5,studentAnswer:'答案',comment:'部分正确',subScores:[]}),config),/步长/);
});

test('评分标准生成验证分值并拒绝缺少题目或答案', async () => {
  const settings={providers:{demo:{}}}, input={provider:'demo',model:'vision',question:'题目',answer:'答案',maxScore:4};
  await assert.rejects(generateRubric(settings,{...input,answer:''}),/参考答案/);
  await assert.rejects(generateRubric(settings,input,async()=>JSON.stringify({question:'题目',answer:'答案',rubric:'① 第一空：满分3分',warnings:[]})),/分项/);
  const result=await generateRubric(settings,input,async()=>JSON.stringify({question:'题目',answer:'答案',rubric:'① 第一空：满分4分\n正确4分，错误0分',warnings:['分值分配须确认']}));
  assert.equal(result.warnings.length,1);
});

test('图片经已有接口生成草稿，预览回填后保存并保留原始图片', {timeout:45000}, async t => {
  let received;
  const requestStarted=Promise.withResolvers(),reply=Promise.withResolvers();
  const fixture=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    received=JSON.parse(body);
    requestStarted.resolve();await reply.promise;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question:'识别题目',answer:'识别答案',rubric:'第一空2分，第二空2分，共4分',items:[{label:'第一空',maxScore:2,criteria:'正确2分，错误0分。'},{label:'第二空',maxScore:2,criteria:'正确2分，错误0分。'}],warnings:['建议分值，请教师确认']})}}]}));
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-rubric-'));
  const app=await createApp({root});
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
  const provider=Object.keys(cfg.providers)[0];
  cfg.providers[provider]={protocol:'chat',endpoint:`http://127.0.0.1:${fixture.address().port}/v1`,apiKey:'fixture-key',models:['vision','other-vision']};
  fs.writeFileSync(path.join(root,'shared-providers.json'),JSON.stringify(cfg.providers));
  cfg.presets[cfg.active].scoring.maxScore=0;
  cfg.workflows[cfg.presets[cfg.active].workflowId].model={provider,model:'vision'};
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(cfg));
  const before=fs.readFileSync(path.join(root,'config.json'),'utf8');
  const browser=await launchBrowser({headless:true});
  t.after(async()=>{reply.resolve();await browser.close();await app.close();await new Promise(resolve=>fixture.close(resolve));});
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
  assert.equal(await page.locator('#rubricModel').getAttribute('list'),null);
  await page.locator('#rubricChooseModel').click();
  assert.equal(await page.locator('#rubricModelChoices button').count(),2);
  await page.locator('#rubricModelSearch').fill('other');
  await page.locator('#rubricModelChoices button').click();
  assert.equal(await page.locator('#rubricModel').inputValue(),'other-vision');
  await page.waitForTimeout(800);assert.equal(await page.locator('#rubricModel').inputValue(),'other-vision');
  await page.locator('#rubricChooseModel').click();
  assert.equal(await page.locator('#rubricModelChoices button').count(),2);
  await page.locator('#rubricModelChoices button').filter({hasText:/^vision$/}).click();
  assert.equal(await page.locator('#rubricMaxScore').inputValue(),'');
  assert.equal(await page.locator('#rubricStrictness').inputValue(),'normal');
  assert.equal(await page.locator('#rubricStrictness option').count(),3);
  assert.equal(await page.locator('#rubricScoringMethod').inputValue(),'auto');
  assert.equal(await page.locator('#rubricPromptDetails').getAttribute('open'),null);
  assert.equal(await page.locator('#rubricRequirements').evaluate(el=>el.readOnly),true);
  assert.equal(await page.locator('#rubricSubject option').count(),10);
  await page.locator('#rubricSubject').selectOption('physics');
  assert.match(await page.locator('#rubricRequirements').inputValue(),/学科：物理/);
  await page.locator('#rubricMaxScore').fill('4');
  assert.equal(await page.locator('#rubricRoundStep').inputValue(),'1');
  await page.locator('#rubricScoreAllocation').fill('第一空2分，第二空2分，忽略图片原分值');
  await page.locator('#rubricTeacherNotes').fill('单位缺失只扣一次');
  await page.locator('#rubricStrictness').selectOption('lenient');
  assert.match(await page.locator('#rubricRequirements').inputValue(),/简写/);
  const physicsLenient=await page.locator('#rubricRequirements').inputValue();
  await page.waitForTimeout(800);assert.equal(await page.locator('#rubricRequirements').inputValue(),physicsLenient);
  await page.locator('#rubricSubject').selectOption('english');
  assert.match(await page.locator('#rubricRequirements').inputValue(),/学科：英语/);
  assert.notEqual(await page.locator('#rubricRequirements').inputValue(),physicsLenient);
  await page.locator('#rubricStrictness').selectOption('strict');
  assert.match(await page.locator('#rubricRequirements').inputValue(),/必需词形、时态、拼写/);
  await page.locator('#rubricSubject').selectOption('physics');
  await page.locator('#rubricScoringMethod').selectOption('answers');
  await page.locator('#rubricPromptDetails summary').click();
  await page.locator('#rubricUseCustomPrompt').check();
  await page.locator('#rubricRequirements').fill('允许同义词，但必须写出单位');
  await page.locator('#rubricSubject').selectOption('chemistry');
  assert.equal(await page.locator('#rubricRequirements').inputValue(),'允许同义词，但必须写出单位');
  await page.locator('#rubricSubject').selectOption('physics');
  assert.equal(await page.locator('#rubricTeacherNotes').inputValue(),'单位缺失只扣一次');
  await page.locator('#rubricUseCustomPrompt').uncheck();
  assert.match(await page.locator('#rubricRequirements').inputValue(),/给分方式：按答案逐项给分/);
  assert.match(await page.locator('#rubricRequirements').inputValue(),/单位缺失只扣一次/);
  await page.locator('#rubricUseCustomPrompt').check();
  assert.equal(await page.locator('#rubricRequirements').inputValue(),'允许同义词，但必须写出单位');
  await page.locator('#generateRubric').click();
  await requestStarted.promise;
  for(const id of ['rubricSubject','rubricStrictness','rubricScoringMethod','rubricTeacherNotes','rubricUseCustomPrompt','rubricRequirements','closeRubricGenerator'])assert.equal(await page.locator('#'+id).isDisabled(),true);
  reply.resolve();
  await page.locator('#rubricDraft').waitFor({state:'visible'});
  assert.equal(await page.locator('#rubricScoringMethod').isEnabled(),true);
  assert.equal(received.model,'vision');assert.equal(received.messages[0].content.filter(part=>part.type==='image_url').length,2);
  assert.match(received.messages[0].content[0].text,/不得固定为四项/);
  assert.match(received.messages[0].content[0].text,/总分：4分/);
  assert.match(received.messages[0].content[0].text,/第一空2分，第二空2分/);
  assert.match(received.messages[0].content[0].text,/忽略题目图片、答案图片/);
  assert.match(received.messages[0].content[0].text,/允许同义词，但必须写出单位/);
  assert.match(received.messages[0].content[0].text,/学科：物理/);
  assert.match(received.messages[0].content[0].text,/不拆过程分/);
  assert.match(received.messages[0].content[0].text,/单位缺失只扣一次/);
  assert.equal(fs.readFileSync(path.join(root,'config.json'),'utf8'),before);
  await page.locator('#applyGeneratedRubric').click();
  assert.equal(await page.locator('#question').inputValue(),'识别题目');
  assert.equal(await page.locator('#answer').inputValue(),'识别答案');
  await page.locator('#savePreset').click();await page.waitForFunction(()=>document.querySelector('#dirtyBadge').hidden);
  const saved=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')).presets[cfg.active];
  assert.equal(saved.question.images.length,1);assert.equal(saved.answer.images.length,1);
  assert.match(saved.rubric.text || saved.rubric,/第一空/);
  assert.equal(saved.scoring.maxScore,4);
  assert.equal(saved.rubricGeneration.version,2);
  assert.equal(saved.rubricGeneration.strictness,'strict');
  assert.equal(saved.rubricGeneration.useCustomPrompt,true);
  assert.equal(saved.rubricGeneration.scoringMethod,'answers');
  assert.equal(saved.rubricGeneration.notes,'单位缺失只扣一次');
  assert.equal(saved.rubricGeneration.subject,'physics');
  assert.equal(saved.rubricGeneration.scoreAllocation,'第一空2分，第二空2分，忽略图片原分值');
  await page.reload();await page.locator('[data-tab=presets]').click();await page.locator('#openRubricGenerator').click();
  assert.equal(await page.locator('#rubricRequirements').inputValue(),'允许同义词，但必须写出单位');
  assert.equal(await page.locator('#rubricMaxScore').inputValue(),'4');
  assert.equal(await page.locator('#rubricSubject').inputValue(),'physics');
  assert.equal(await page.locator('#rubricTeacherNotes').inputValue(),'单位缺失只扣一次');
  assert.equal(await page.locator('#rubricScoringMethod').inputValue(),'answers');
  assert.equal(await page.locator('#rubricUseCustomPrompt').isChecked(),true);
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


test('网站模板先于任务配置返回时不报初始化错误', {timeout:30000}, async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-init-'));const app=await createApp({root});const browser=await launchBrowser({headless:true});
  t.after(async()=>{await browser.close();await app.close();});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/workspaces',async route=>{await new Promise(resolve=>setTimeout(resolve,700));await route.continue();});
  await page.goto(app.url);await page.waitForFunction(()=>document.querySelector('#adaptWebsite').options.length>20);
  assert.deepEqual(errors,[]);assert.equal(await page.locator('#notice').textContent(),'');
});


test('调试网址同步、空录制提示和保存不清空阅卷方案草稿', {timeout:30000}, async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-debug-ui-'));const app=await createApp({root});const browser=await launchBrowser({headless:true});
 t.after(async()=>{await browser.close();await app.close();});const page=await browser.newPage();await page.goto(app.url);
 await page.locator('[data-tab=presets]').click();await page.locator('#question').fill('未保存的题目草稿');
 await page.locator('[data-tab=grading]').click();await page.locator('#adaptAddCustom').click();
 assert.equal(await page.locator('#adaptVerify').isDisabled(),true);assert.match(await page.locator('#adaptCandidate').innerText(),/暂无提交接口/);
 await page.locator('#adaptUrl').fill('https://fixture.test/mark');
 await page.locator('[data-platform="browser.url"]').evaluate(el=>{if(el.value!=='https://fixture.test/mark')throw Error('URL out of sync');});
 await page.locator('#adaptSave').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent==='网址分组已保存');
 await page.locator('[data-tab=presets]').click();assert.equal(await page.locator('#question').inputValue(),'未保存的题目草稿');
});

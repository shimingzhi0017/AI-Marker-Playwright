import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {launchBrowser} from '../src/browser.mjs';
import {createApp} from '../src/server.mjs';

const root=process.env.AI_MARKER_DATA_ROOT;
try {
  const image=await sharp({create:{width:100,height:50,channels:3,background:'#fff'}}).png().toBuffer();
  if((await sharp(image).metadata()).width!==100)throw Error('图片组件失败');
  const browser=await launchBrowser({headless:true});
  const app=await createApp({root});
  try {
    const page=await browser.newPage();await page.goto(app.url);await page.waitForSelector('#workspaceCards .workspace-card');
    await page.locator('[data-tab=presets]').click();await page.locator('#openRubricGenerator').click();
    const subjects=await page.locator('#rubricSubject option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean));
    if(subjects.length!==9)throw Error('九学科模板未完整加载');
    for(const subject of subjects){
      await page.locator('#rubricSubject').selectOption(subject);
      if(!(await page.locator('#rubricSubjectReviewSummary').innerText()) || !(await page.locator('#rubricRequirements').inputValue()).includes('真实阅卷'))throw Error(`学科模板未接入：${subject}`);
      if((await page.locator('#rubricTaskType option').count())<3)throw Error(`题型细分未接入：${subject}`);
    }
  }
  finally {await app.close();await browser.close();}
  fs.writeFileSync(path.join(root,'verified.json'),JSON.stringify({success:true,node:process.version,image:true,browser:true,ui:true,nineSubjectPrompts:true}));
}catch(error){fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'verified.json'),JSON.stringify({success:false,error:error.stack}));process.exitCode=1;}

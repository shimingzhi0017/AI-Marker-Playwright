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
  try {const page=await browser.newPage();await page.goto(app.url);await page.waitForSelector('#workspaceCards .workspace-card');if(await page.locator('#factoryReset').count())throw Error('还原按钮未移除');}
  finally {await app.close();await browser.close();}
  fs.writeFileSync(path.join(root,'verified.json'),JSON.stringify({success:true,node:process.version,image:true,browser:true,ui:true}));
}catch(error){fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'verified.json'),JSON.stringify({success:false,error:error.stack}));process.exitCode=1;}

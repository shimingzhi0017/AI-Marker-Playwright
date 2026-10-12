import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';
import {launchBrowser} from '../src/browser.mjs';

test('保存等待中仍可选择顶部栏目，操作完成后应用最后一次选择', {timeout:20000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-navigation-'));
  const app=await createApp({root}),browser=await launchBrowser({headless:true});
  const entered=Promise.withResolvers(),released=Promise.withResolvers();
  t.after(async()=>{released.resolve();await browser.close();await app.close();fs.rmSync(root,{recursive:true,force:true});});
  const page=await browser.newPage();
  await page.goto(app.url);await page.waitForFunction(()=>document.querySelector('#phase').textContent==='待开始');
  await page.route('**/api/settings',async route=>{
    if(route.request().method()==='POST'){entered.resolve();await released.promise;}
    await route.continue();
  });
  await page.locator('#answer').fill('模拟参考');await page.locator('#rubric').fill('模拟标准');await page.locator('#maxScore').fill('4');
  await page.locator('#savePreset').click();await entered.promise;
  await page.locator('[data-tab=workflows]').click();await page.locator('[data-tab=grading]').click();
  assert.equal(await page.locator('#presets').isVisible(),true);
  released.resolve();
  await page.waitForFunction(()=>document.querySelector('#grading').hidden===false);
  assert.equal(await page.locator('[data-tab=grading]').getAttribute('class'),'active');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')).presets['我的方案'].answer,'模拟参考');
});

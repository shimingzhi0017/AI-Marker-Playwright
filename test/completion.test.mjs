import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchBrowser} from '../src/browser.mjs';
import {ZhixuePlatform} from '../src/platform.mjs';
import {Runner} from '../src/runner.mjs';

test('截图中的智学网结束弹窗自动识别，隐藏提示及其他错误不误判，不点击切题',async t=>{
  const browser=await launchBrowser({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.route('https://www.zhixue.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<div id="dialog" style="display:none"><p>该题已全部阅完，请选择留在当前题或切换到下一题？</p><button onclick="window.clicked=true">切换下一题</button><button>留在当前题</button></div>'}));
  await page.goto('https://www.zhixue.com/webmarking/test/');const platform=new ZhixuePlatform(page,{platform:{}},'.');
  assert.equal(await platform.completed(),false);
  await page.locator('#dialog').evaluate(el=>el.style.display='block');
  assert.equal(await platform.completed(),true);assert.equal(await platform.ready(),null);
  let modelCalls=0;const log=[];
  const runner=new Runner(platform,{records:()=>[],log:event=>log.push(event)}, {},async()=>{},async()=>{modelCalls++;});
  const result=await runner.run();assert.equal(result.completed,true);assert.equal(result.count,0);assert.equal(modelCalls,0);assert.deepEqual(log,['completed']);
  assert.equal(await page.evaluate(()=>window.clicked),undefined);
  await page.locator('p').evaluate(el=>el.textContent='网络异常，请稍后重试');assert.equal(await platform.completed(),false);
});


test('分配份额完成只点击继续多阅，检查不点击、结束不继续、其他网站不点击',async t=>{
 const browser=await launchBrowser({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 const html='<div id="quota"><p>您该题任务量已完成，请选择继续多阅或切换到下一题？</p><button onclick="window.next=true">切换下一题</button><button onclick="window.continued=(window.continued||0)+1;document.querySelector(\'#quota\').remove()">继续多阅</button></div>';
 await page.route('https://**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));await page.goto('https://www.zhixue.com/webmarking/test/');
 const platform=new ZhixuePlatform(page,{platform:{}},'.');assert.equal(await platform.completed(),false);assert.equal(await page.evaluate(()=>window.continued),undefined);
 platform.snapshot=async()=>({images:[{ready:true}],units:[{}],identity:'new'});
 await platform.ready(undefined,undefined,false,true);assert.equal(await page.evaluate(()=>window.continued),1);assert.equal(await page.evaluate(()=>window.next),undefined);
 await page.goto('https://www.zhixue.com/webmarking/test/');await page.locator('p').evaluate(el=>el.textContent='该题已全部阅完，请选择留在当前题或切换到下一题？');assert.equal(await platform.ready(undefined,undefined,false,true),null);assert.equal(await page.evaluate(()=>window.continued),undefined);
 await page.goto('https://example.com/test/');assert.equal(await platform.continueQuota(),false);assert.equal(await page.evaluate(()=>window.continued),undefined);
});

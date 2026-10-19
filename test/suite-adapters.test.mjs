import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchBrowser} from '../src/browser.mjs';
import {installSuiteAdapters,suiteAdapters,patternMatches} from '../src/suite-adapters.mjs';
import {SuitePlatform} from '../src/suite-platform.mjs';

test('C30原API回调接通，Canvas不可导出时读取当前接口图片', {timeout:30000},async t=>{
  const browser=await launchBrowser({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext();await installSuiteAdapters(context);
  await context.route('https://zy.iclass30.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<input class="el-input__inner" placeholder="满分8分"><canvas id="canvasImg"></canvas>'}));
  await context.route('**/getCorrectStuList',route=>route.fulfill({json:{code:1,data:[{correctState:0,stuNewResList:[{source:'https://fixture.test/current.png'}]}]}}));
  const page=await context.newPage();await page.goto('https://zy.iclass30.com/#/webCorrect');
  await page.evaluate(async()=>{document.querySelector('canvas').toDataURL=()=>{throw Error('tainted');};await fetch('/getCorrectStuList');});
  await page.waitForFunction(()=>window.__C30_STATE__.latestImageUrl);
  assert.equal(await page.evaluate(()=>window.__markerSuiteBridge.select()?.id),'c30',JSON.stringify(await page.evaluate(()=>({html:document.body.innerHTML,adapters:window.__markerSuiteBridge.adapters(),inputs:window.__C30_ADAPTER__.getScoreInputs().length}))));
  const snapshot=await new SuitePlatform(page,{platform:{}},'.').snapshot();
  assert.equal(snapshot.adapterId,'c30');assert.equal(snapshot.images[0].url,'https://fixture.test/current.png');assert.equal(snapshot.units[0].maxScore,8);
});

test('原脚本27个适配器完整引入，网址模式精确域名和动态路径',()=>{
  assert.equal(suiteAdapters.length,27);
  assert.equal(patternMatches('*://*.7net.cc/*','https://yj1.7net.cc/'),true);
  assert.equal(patternMatches('*://*.7net.cc/*','https://yj1.7net.cc.attacker.test/'),false);
  assert.equal(patternMatches('*://*/Marking/DisPlay*','http://192.0.2.1:8080/Marking/DisPlay?id=1'),true);
  assert.equal(patternMatches('*://*/Marking/DisPlay*','http://192.0.2.1/other'),false);
});

test('按钮给分网站可识别，但只填分不得点击或触发自动提交', {timeout:30000},async t=>{
  const browser=await launchBrowser({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext();await installSuiteAdapters(context);
  await context.route('https://aisusheng.runjian.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div class="read-paper__view"><div class="img-box" style="background-image:url(https://fixture.test/paper.png)"></div></div><div class="score-list"><button class="score-item-button" onclick="window.clicked=true"><span>0</span></button><button class="score-item-button" onclick="window.clicked=true"><span>2</span></button></div><div class="el-form-item__label">12</div><div class="score-footer"><button class="el-button--primary" onclick="window.submitted=true">提交</button></div>'}));
  const page=await context.newPage();await page.goto('https://aisusheng.runjian.com/read-paper/');
  const platform=new SuitePlatform(page,{platform:{}},'.'),snapshot=await platform.snapshot();
  assert.equal(snapshot.adapterId,'runjian');assert.equal(snapshot.units[0].type,'click');
  await assert.rejects(platform.fill(snapshot,[2]),/人工填分/);
  assert.equal(await page.evaluate(()=>window.clicked||window.submitted||false),false);
});

test('浏览器复用七天和好分数原适配器：图片、评分框、多项填分、旧卷防护及提交校验', {timeout:30000},async t=>{
  const browser=await launchBrowser({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext();await installSuiteAdapters(context);
  await context.route('https://**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname==='yj1.7net.cc')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<div id="paperImage"><div class="reviewimg"><img src="data:image/png;base64,a"></div></div><input id="tbs1" max="10"><input type="button" id="subfen"><div class="timuScore"><table><tr><td>第1题</td></tr></table></div>'});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<div class="images-box"><svg><image class="svg-image" href="https://fixture.test/answer.png"></image></svg></div><div class="score-list"><div class="block-title">第一问</div><input class="score-input" placeholder="满分2分"></div><div class="score-list"><div class="block-title">第二问</div><input class="score-input" placeholder="满分3分"></div><button class="submit-button">提交</button>'});
  });
  for(const url of ['https://yj1.7net.cc/review?km=physics&th=12','https://yue.haofenshu.com/minions/review']){
    const page=await context.newPage();await page.goto(url);const platform=new SuitePlatform(page,{platform:{}},'.');
    const snapshot=await platform.snapshot();assert.equal(snapshot.adapterId,url.includes('7net')?'qitian':'haofenshu');
    assert.equal(snapshot.images.length,1);assert.equal(snapshot.strongIdentity,false);
    const scores=snapshot.units.map((_,i)=>i+1);await platform.fill(snapshot,scores);
    await assert.rejects(platform.submit(snapshot,scores),/回执/);
    if(snapshot.adapterId==='haofenshu') {
      assert.deepEqual(snapshot.units.map(u=>u.maxScore),[2,3]);
      await page.locator('image').evaluate(el=>el.setAttribute('href','https://fixture.test/next.png'));
      await assert.rejects(platform.fill(snapshot,scores),/答卷已变化/);
    }
  }
});

test('每个原脚本适配器在对应网址可加载，默认不执行给分/提交钩子', {timeout:30000},async t=>{
  const browser=await launchBrowser({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext();await installSuiteAdapters(context);
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<html><body><div>fixture</div></body></html>'}));
  for(const adapter of suiteAdapters.filter(a=>a.id!=='zhixue')) {
    const pattern=adapter.patterns[0],url=pattern.replace(/^\*:/,'https:').replace('*.','fixture.').replace('://*/','://fixture.test/').replace(/\*$/,'fixture');
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
    const ids=await page.evaluate(()=>window.__markerSuiteBridge.adapters().map(a=>a.id));
    assert.ok(ids.includes(adapter.id),adapter.id+' failed to load: '+errors.join(','));
    await page.close();
  }
});

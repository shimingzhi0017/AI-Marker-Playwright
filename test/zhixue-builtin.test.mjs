import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import {launchBrowser} from '../src/browser.mjs';
import {trackZhixueTopics} from '../src/zhixue-receipt.mjs';
import {ZhixuePlatform,pageContext} from '../src/platform.mjs';
import {applyGroup,submissionReadinessError} from '../src/adaptation.mjs';

test('智学网空白默认设置自动启用内置规则，其他网站及自定义规则保持调试流程',()=>{
  const cfg=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));
  const active=applyGroup(cfg,'https://www.zhixue.com/webmarking/new/#/personal?markingPaperId=paper');
  assert.equal(active.platform.identityMode,'zhixue-network');assert.equal(active.platform.builtinAdapter,'zhixue');
  assert.equal(submissionReadinessError(active,{strongIdentity:true}),'');
  assert.match(submissionReadinessError(active,{strongIdentity:false}),/编号/);
  assert.equal(applyGroup(cfg,'https://www.zhixue.com.attacker.test/').platform.verified,false);
  const custom={...cfg,adaptationGroups:[{url:'https://www.zhixue.com/',platform:{verified:false,scoreSelector:'#custom'}}]};
  assert.equal(applyGroup(custom,'https://www.zhixue.com/').platform.verified,false);
  const nested='/webmarking/new/#/personal?examId=exam&markingPaperId=paper';
  assert.deepEqual(pageContext('https://www.zhixue.com/main?app-17='+encodeURIComponent(encodeURIComponent(nested))),{examId:'exam',markingPaperId:'paper'});
});

test('真实浏览器新任务默认配置：任意题网址、两路由、SPA与新标签页直接识别并核验模拟回执', {timeout:30000},async t=>{
  const browser=await launchBrowser({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext();const tracker=trackZhixueTopics(context);t.after(()=>tracker.close());
  const image=await sharp({create:{width:200,height:100,channels:3,background:'white'}}).png().toBuffer();
  let host='pt-ali-bj.zhixue.com',paper='paper1',scan='scan1',commits=0;
  await context.route('https://**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/image.png')return route.fulfill({contentType:'image/png',body:image});
    if(u.pathname.endsWith('/scanrecorddetail/'))return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({code:200,data:{topicInfo:{detail:{scanRecordId:scan,markingPaperId:paper,topicImageIds:['https://www.zhixue.com/image.png']},item:{id:JSON.stringify([scan])},topicNumStr:'12,-1'}}})});
    if(u.pathname.endsWith('/commitTopic/')){commits++;return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{"result":"success"}'});}
    return route.fulfill({contentType:'text/html',body:`<div id="currentTopicIndex">第12题</div><div name="topicImg"><img src="/image.png"></div><input name="topicTxt" score="10"><button id="bnt_save" onclick="fetch('https://${host}/marking/marking/commitTopic/',{method:'POST',body:new URLSearchParams({markingPaperId:'${paper}',id:'[&quot;${scan}&quot;]',markingScores:&quot;{'12,-1':2}&quot;})})">提交</button><script>fetch('https://${host}/marking/marking/personal/scanrecorddetail/',{method:'POST'})</script>`});
  });
  const cfg=JSON.parse(fs.readFileSync(new URL('../config.example.json',import.meta.url),'utf8'));
  for(let i=0;i<2;i++) {
    host=i?'pt-ali-bj-re.zhixue.com':'pt-ali-bj.zhixue.com';paper='paper'+i;scan='scan'+i;
    const page=await context.newPage(),url=`https://www.zhixue.com/webmarking/different-${i}/#/personal?examId=exam&markingPaperId=${paper}`;
    await page.goto(url);const platform=new ZhixuePlatform(page,applyGroup(cfg,url),'.');platform.topicTracker=tracker;
    const snapshot=await platform.ready(undefined,undefined,true);
    assert.equal(snapshot.paperId,scan);assert.equal(snapshot.strongIdentity,true);assert.equal(snapshot.builtinAdapter,'zhixue');
    await platform.fill(snapshot,[2]);assert.equal((await platform.submit(snapshot,[2])).confirmed,true);
    assert.equal(await tracker.match(snapshot.imageKeys,paper,{}),null);
  }
  assert.equal(commits,2);
});

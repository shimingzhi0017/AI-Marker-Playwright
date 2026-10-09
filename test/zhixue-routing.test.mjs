import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { trackZhixueTopics, isZhixueApiUrl, matchesZhixueCommitUrl } from '../src/zhixue-receipt.mjs';
import { verifyManualResponse } from '../src/adaptation.mjs';
import { ZhixuePlatform } from '../src/platform.mjs';

const hosts = ['pt-ali-bj.zhixue.com', 'pt-ali-bj-re.zhixue.com'];
const info = scan => ({detail:{scanRecordId:scan,markingPaperId:'paper',topicImageIds:['https://fixture.test/image.jpg']},item:{id:'["item"]'},topicNumStr:'12,-1'});
const commit = host => `https://${host}/marking/marking/commitTopic/`;
const body = {markingPaperId:'paper',id:'["item"]',markingScores:"{'12,-1':2}"};

test('两种真实路由均识别当前及预取答卷，仍按来源页面隔离', async () => {
  const context = new EventEmitter(), pages = [{}, {}]; context.pages = () => pages;
  const tracker = trackZhixueTopics(context);
  const emit = (host, page, prefetch = false) => context.emit('response', {
    url:()=>`https://${host}/marking/marking/personal/${prefetch?'preLoadScanrecorddetail':'scanrecorddetail'}/`,
    request:()=>({method:()=> 'POST',frame:()=>({page:()=>page})}),
    json:async()=>({code:200,data:{[prefetch?'nextTopicInfo':'topicInfo']:info(prefetch?'next':host)}})
  });
  for (const [i,host] of hosts.entries()) emit(host,pages[i]);
  for (const [i,host] of hosts.entries()) {
    const topic = await tracker.match(['https://fixture.test/image.jpg'],'paper',pages[i]);
    assert.equal(topic.scanRecordId,host); assert.equal(topic.apiOrigin,`https://${host}`);
    assert.equal(matchesZhixueCommitUrl(commit(host),topic),true);
    assert.equal(matchesZhixueCommitUrl(commit(hosts[1-i]),topic),false);
    assert.equal(await tracker.match(['https://fixture.test/other.jpg'],'paper',pages[i]),null);
    assert.equal(await tracker.match(['https://fixture.test/image.jpg'],'other',pages[i]),null);
  }
  emit('pt-ali-bj.zhixue.com.attacker.test',pages[0]);
  assert.equal((await tracker.match(['https://fixture.test/image.jpg'],'paper',pages[0])).scanRecordId,hosts[0]);
  emit(hosts[0],pages[0],true);
  assert.equal(await tracker.match(['https://fixture.test/image.jpg'],'paper',pages[0]),null);
  tracker.close();
});

test('仅接受已观察到的HTTPS路由，提交来源及原答卷分数必须匹配', () => {
  for (const value of ['http://pt-ali-bj.zhixue.com','https://pt-ali-bj.zhixue.com:444','https://pt-ali-bj.zhixue.com.attacker.test','https://evil.zhixue.com','https://user@pt-ali-bj.zhixue.com']) assert.equal(isZhixueApiUrl(value),false);
  for (const host of hosts) {
    const snapshot={networkTopic:{scanRecordId:'scan',markingPaperId:'paper',itemIds:['item'],topicNumStr:'12,-1',apiOrigin:`https://${host}`}};
    const candidate={url:commit(host),status:200,requestBody:body,responseBody:{result:'success'}};
    assert.equal(verifyManualResponse({},snapshot,[2],candidate).confirmed,true);
    assert.throws(()=>verifyManualResponse({},snapshot,[2],{...candidate,url:commit(hosts.find(h=>h!==host))}),/接口/);
    assert.throws(()=>verifyManualResponse({},snapshot,[3],candidate),/分数/);
    assert.throws(()=>verifyManualResponse({},snapshot,[2],{...candidate,requestBody:{...body,id:'["other"]'}}),/编号/);
    assert.throws(()=>verifyManualResponse({},snapshot,[2],{...candidate,responseBody:{result:'failed'}}),/成功/);
  }
});

test('提交跟随当前答卷接口来源，旧测试域名配置不阻塞新路由', async () => {
  for (const host of hosts) {
    let clicked=0;
    const request={method:()=> 'POST',url:()=>commit(host),postData:()=>new URLSearchParams(body).toString()};
    const response={url:()=>commit(host),request:()=>request,ok:()=>true,status:()=>200,json:async()=>({result:'success'})};
    const page={waitForResponse:predicate=>{
      assert.equal(predicate({...response,url:()=>commit(hosts.find(h=>h!==host))}),false);
      assert.equal(predicate(response),true);return Promise.resolve(response);
    }};
    const platform=new ZhixuePlatform(page,{platform:{verified:true,submitResponseUrlPattern:'^https://pt-ali-bj-re\\.zhixue\\.com/marking/marking/commitTopic/$'}},'.');
    platform.assertCurrent=async()=>{};
    platform.frame=async()=>({locator:selector=>selector===platform.inputSelector()?{count:async()=>1,nth:()=>({inputValue:async()=> '2'})}:{click:async()=>{clicked++;}}});
    const topic={scanRecordId:'scan',markingPaperId:'paper',itemIds:['item'],topicNumStr:'12,-1',apiOrigin:`https://${host}`};
    assert.equal((await platform.submit({networkTopic:topic},[2])).confirmed,true);assert.equal(clicked,1);
    await assert.rejects(platform.submit({networkTopic:{...topic,apiOrigin:undefined}},[2]),/来源/);
    assert.equal(clicked,1);
  }
});

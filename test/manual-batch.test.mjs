import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { Runner } from '../src/runner.mjs';
import { ZhixuePlatform } from '../src/platform.mjs';
import { trackZhixueTopics } from '../src/zhixue-receipt.mjs';
import { installImageProvenance } from '../src/image-provenance.mjs';
import { launchBrowser } from '../src/browser.mjs';

test('自定义份数按成功提交计数并停止，无上限可人工停止，失败回执不计数', async () => {
  for (const mode of ['trial', 'normal', 'unattended']) {
  for (const [limit, fail] of [[1,false], [3,false], [4,false], [20,false], [100,false], [0,false], [20,true]]) {
    const settings = JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url)));
    settings.mode = mode; settings.batchLimit = limit;
    settings.presets[settings.active].scoring.maxScore = 10;
    settings.presets[settings.active].answer = '模拟参考答案';
    settings.presets[settings.active].rubric = '模拟评分标准';
    const records = new Map(); let submits = 0, reviews = 0, reads = 0;
    const platform = {
      options: { manualSubmissionTest: true, verified: mode !== 'trial', submitResponseUrlPattern: 'commit' },
      async ready() { reads++; return { identity: `paper${submits}`, taskId: 'task', units: [{label:'12',maxScore:10}], strongIdentity: true, networkTopic: {scanRecordId:`paper${submits}`} }; },
      async images() { return [{ data:'image', hash:'hash' }]; }, async fill() {}, async diagnostic() {},
      async submit(snapshot, scores, options) { assert.equal(options.manualTest, mode === 'trial'); if(fail) throw Error('模拟回执失败'); submits++; return {confirmed:true}; }
    };
    const store = {records:()=>[...records.values()],save:r=>records.set(r.id,structuredClone(r)),log(){},async images(){return [];} };
    const runner = new Runner(platform, store, settings, async (r, reviewMode) => {assert.equal(reviewMode,mode);reviews++;return limit === 0 && reviews === 6 ? 'stop' : 'submit';}, async()=>({score:4,comment:'test',subScores:[]}));
    const result = await runner.run();
    assert.equal(submits, fail ? 0 : limit || 5);
    assert.equal(reviews, fail ? 1 : limit || 6);
    assert.equal(reads, reviews);
    assert.equal(result.count, submits);
    if(limit && !fail) assert.match(result.reason, /数量限制/);
    if(fail) assert.equal([...records.values()][0].state,'uncertain');
  }
  }
});

test('预取答卷只有实际显示对应图片时才匹配，歧义及未知增强图片拒绝', async () => {
  const page = new EventEmitter(); const tracker = trackZhixueTopics(page);
  const emit = (scan, path, image, field) => page.emit('response', {url:()=>`https://pt-ali-bj-re.zhixue.com/marking/marking/personal/${path}/`,request:()=>({method:()=> 'POST'}),json:async()=>({code:200,data:{[field]:{detail:{scanRecordId:scan,markingPaperId:'paper',topicImageIds:[image]},item:{id:JSON.stringify([scan])},topicNumStr:'12,-1'}}})});
  emit('first','scanrecorddetail','https://example.com/1.png','topicInfo');
  emit('next','preLoadScanrecorddetail','https://example.com/2.png','nextTopicInfo');
  assert.equal((await tracker.current()).scanRecordId,'first');
  assert.equal((await tracker.match(['https://example.com/2.png'],'paper')).scanRecordId,'next');
  assert.equal(await tracker.match(['data:image/png;base64,unknown'],'paper'),null);
  assert.equal(await tracker.match(['https://example.com/2.png'],'other'),null);
  emit('ambiguous','scanrecorddetail','https://example.com/2.png','topicInfo');
  assert.equal(await tracker.match(['https://example.com/2.png'],'paper'),null);
  tracker.close();
});

test('真实浏览器记录图片经画布增强后的原始来源，混合图片不映射', {timeout:30000}, async t => {
  const browser = await launchBrowser({headless:true}); t.after(()=>browser.close());
  const context = await browser.newContext(); await context.addInitScript(installImageProvenance);
  const page = await context.newPage();
  await page.route('https://fixture.test/**', route => route.fulfill({contentType:route.request().url().endsWith('.svg')?'image/svg+xml':'text/html',body:route.request().url().endsWith('.svg')?'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>':'<html></html>'}));
  await page.goto('https://fixture.test/');
  const results = await page.evaluate(async () => {
    const img = new Image(); img.src='https://fixture.test/one.svg'; await img.decode();
    const canvas = document.createElement('canvas'); const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0);
    const output=canvas.toDataURL(); const source=window.__aiMarkerImageSources.get(output);
    const other=new Image(); other.src='https://fixture.test/two.svg'; await other.decode();ctx.drawImage(other,20,0);
    const mixed=window.__aiMarkerImageSources.has(canvas.toDataURL());
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(other,0,0);const cleared=window.__aiMarkerImageSources.get(canvas.toDataURL());
    canvas.width=canvas.width;ctx.drawImage(img,0,0);const resized=window.__aiMarkerImageSources.get(canvas.toDataURL());
    return {source,mixed,cleared,resized};
  });
  assert.deepEqual(results,{source:'https://fixture.test/one.svg',mixed:false,cleared:'https://fixture.test/two.svg',resized:'https://fixture.test/one.svg'});
});

test('自动模式等待当前编号匹配，人工模式允许只填分，未知编号拒绝',async()=>{
  const platform=new ZhixuePlatform({}, {platform:{loadTimeoutMs:500}},'');platform.completed=async()=>false;
  let reads=0;platform.snapshot=async()=>({images:[{ready:true}],units:[{}],identity:'fixture',strongIdentity:++reads>1});
  const snapshot=await platform.ready(undefined,undefined,true);assert.equal(snapshot.strongIdentity,true);assert.equal(reads,2);
  platform.snapshot=async()=>({images:[{ready:true}],units:[{}],identity:'fixture',strongIdentity:false});
  assert.equal((await platform.ready()).strongIdentity,false);
  await assert.rejects(platform.ready(undefined,undefined,true),/编号尚未与图片匹配/);
});

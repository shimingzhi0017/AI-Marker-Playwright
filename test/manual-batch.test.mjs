import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { Runner } from '../src/runner.mjs';
import { trackZhixueTopics } from '../src/zhixue-receipt.mjs';
import { installImageProvenance } from '../src/image-provenance.mjs';
import { launchBrowser } from '../src/browser.mjs';

test('1至3份测试逐份确认，达到限制停止；无上限及超过3份禁止测试提交', async () => {
  for (const limit of [1, 2, 3, 0, 4]) {
    const settings = JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url)));
    settings.mode = 'trial'; settings.batchLimit = limit;
    settings.presets[settings.active].scoring.maxScore = 10;
    settings.presets[settings.active].answer = '模拟参考答案';
    settings.presets[settings.active].rubric = '模拟评分标准';
    const records = new Map(); let submits = 0, reviews = 0;
    const platform = {
      options: { manualSubmissionTest: true, verified: false, submitResponseUrlPattern: 'commit' },
      async ready() { return { identity: `paper${submits}`, taskId: 'task', units: [{label:'12',maxScore:10}], strongIdentity: true, networkTopic: {scanRecordId:`paper${submits}`} }; },
      async images() { return [{ data:'image', hash:'hash' }]; }, async fill() {}, async diagnostic() {},
      async submit(snapshot, scores, options) { assert.equal(options.manualTest, true); submits++; return {confirmed:true}; }
    };
    const store = {records:()=>[...records.values()],save:r=>records.set(r.id,structuredClone(r)),log(){},async images(){return [];} };
    const runner = new Runner(platform, store, settings, async (r, mode) => {assert.equal(mode,'trial');reviews++;return 'submit';}, async()=>({score:4,comment:'test',subScores:[]}));
    const result = await runner.run();
    assert.equal(submits, limit >= 1 && limit <= 3 ? limit : 0);
    assert.equal(reviews, submits || 1);
    assert.equal(result.count, submits);
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
    return {source,mixed:window.__aiMarkerImageSources.has(canvas.toDataURL())};
  });
  assert.deepEqual(results,{source:'https://fixture.test/one.svg',mixed:false});
});

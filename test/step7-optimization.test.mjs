import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { detectImageMime, optimizeAnswerImage } from '../src/image-optimize.mjs';
import { ZhixuePlatform } from '../src/platform.mjs';
import { createApp } from '../src/server.mjs';
import { exportHistory } from '../src/export.mjs';
import { summarizeTaskMetrics } from '../src/task-metrics.mjs';
import { stripEmbeddedPolicyTemplates, rubricPrompts } from '../ui/rubric-prompts.js';
import { realWorldReviewPolicy, subjectReviewPolicy } from '../ui/subject-review-rules.js';
import { promptFor } from '../src/domain.mjs';
import { evaluateRecords, replayBenchmark, formatBenchmarkReport } from '../scripts/eval-benchmark.mjs';
import { launchBrowser } from '../src/browser.mjs';

test('image MIME detection, resizing, RGBA white flatten, and lossless vs JPEG selection', async () => {
  assert.equal(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d])), 'image/png');
  assert.equal(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectImageMime(Buffer.from('RIFF1234WEBP')), 'image/webp');
  assert.equal(detectImageMime(Buffer.from('GIF89a')), 'image/gif');
  assert.equal(detectImageMime(Buffer.from('BM1234')), 'image/bmp');
  assert.equal(detectImageMime(Buffer.alloc(2)), 'image/png');

  const tiny = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(() => optimizeAnswerImage(tiny), /图片无法解码或尺寸过小/);

  const smallPng = await sharp({ create: { width: 300, height: 150, channels: 3, background: '#fff' } }).png().toBuffer();
  const kept = await optimizeAnswerImage(smallPng);
  assert.equal(kept.mime, 'image/png');
  assert.equal(kept.resized, false);

  const widePng = await sharp({ create: { width: 2800, height: 1400, channels: 3, background: '#fff' } }).png().toBuffer();
  const downscaled = await optimizeAnswerImage(widePng, { maxEdge: 2048 });
  assert.equal(downscaled.width, 2048);
  assert.equal(downscaled.height, 1024);
  assert.equal(downscaled.resized, true);

  // Heavy noisy photographic buffer should be converted to JPEG and shrink substantially.
  const width = 2200, height = 1200;
  const noisyRaw = crypto.randomBytes(width * height * 3);
  const noisyPng = await sharp(noisyRaw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
  assert.ok(noisyPng.length > 400 * 1024);
  const compressed = await optimizeAnswerImage(noisyPng);
  assert.equal(compressed.mime, 'image/jpeg');
  assert.equal(compressed.width, 2048);
  assert.ok(compressed.optimizedBytes < noisyPng.length * 0.5);

  // Transparent black pixels on a heavy scan flattened over #ffffff must become white, not black.
  const tw = 900, th = 900;
  const transparentRaw = crypto.randomBytes(tw * th * 4);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const idx = (y * tw + x) * 4;
      if (x < 100 && y < 100) {
        transparentRaw[idx] = 0;
        transparentRaw[idx + 1] = 0;
        transparentRaw[idx + 2] = 0;
        transparentRaw[idx + 3] = 0;
      } else {
        transparentRaw[idx + 3] = 255;
      }
    }
  }
  const transparentPng = await sharp(transparentRaw, { raw: { width: tw, height: th, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer();
  const flattened = await optimizeAnswerImage(transparentPng);
  assert.equal(flattened.mime, 'image/jpeg');
  const { data } = await sharp(flattened.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 240 && data[1] > 240 && data[2] > 240);
});

test('platform image optimization wires into /api/image dynamic MIME and HTML/CSV exports', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-step7-img-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const noisyRaw = crypto.randomBytes(800 * 600 * 3);
  const densePng = await sharp(noisyRaw, { raw: { width: 800, height: 600, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
  const smallPng = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();

  const snapshot = {
    identity: 'paper-1',
    url: 'https://example.test/grade',
    images: [
      { url: 'https://example.test/1.png', ready: true },
      { url: 'https://example.test/2.png', ready: true }
    ]
  };
  const fakePage = {
    url: () => 'https://www.zhixue.com/',
    context: () => ({
      request: {
        get: async reqUrl => ({
          ok: () => true,
          status: () => 200,
          body: async () => (reqUrl.endsWith('1.png') ? densePng : smallPng)
        })
      }
    })
  };
  const platform = new ZhixuePlatform(fakePage, { imageOptions: { preferJpegMinBytes: 100 * 1024 } }, root);
  platform.snapshot = async () => snapshot;

  const imgs = await platform.images(snapshot);
  assert.equal(imgs.length, 2);
  assert.equal(imgs[0].mime, 'image/jpeg');
  assert.ok(imgs[0].data.startsWith('data:image/jpeg;base64,'));
  assert.equal(imgs[1].mime, 'image/png');
  assert.ok(imgs[1].data.startsWith('data:image/png;base64,'));

  const app = await createApp({ root });
  t.after(() => app.close());

  const imageFiles = await app.store.images('rec-img-1', imgs);
  app.store.save({
    id: 'rec-img-1',
    presetName: '物理大题',
    state: 'submitted',
    mode: 'normal',
    time: new Date().toISOString(),
    imageFiles,
    result: {
      score: 9,
      gradingMode: 'lenient',
      recognition: { status: 'clear', coverageChecked: true },
      gradingIssues: [{ location: '第2问', reason: '标准未注明g取值' }],
      policyVerification: { status: 'verified' },
      totalUsage: { calls: 2, inputTokens: 1200, outputTokens: 300, totalTokens: 1500, cachedTokens: 800, reasoningTokens: 40 },
      studentAnswer: 'v0=15m/s',
      comment: '过程合理，得9分',
      subScores: []
    }
  });

  const home = await fetch(app.url);
  const cookie = home.headers.get('set-cookie').split(';')[0];
  const res0 = await fetch(`${app.url}/api/image?id=rec-img-1&index=0`, { headers: { Cookie: cookie } });
  assert.equal(res0.status, 200);
  assert.equal(res0.headers.get('content-type'), 'image/jpeg');
  const res1 = await fetch(`${app.url}/api/image?id=rec-img-1&index=1`, { headers: { Cookie: cookie } });
  assert.equal(res1.status, 200);
  assert.equal(res1.headers.get('content-type'), 'image/png');

  const csvFile = path.join(root, 'out.csv');
  const htmlFile = path.join(root, 'out.html');
  const all = app.store.records();
  exportHistory(all, csvFile);
  exportHistory(all, htmlFile);

  const csv = fs.readFileSync(csvFile, 'utf8');
  assert.match(csv, /"实际口径","总Token","缓存Token","口径核验","规则疑点","识别状态"/);
  assert.match(csv, /"lenient","1500","800","verified","标准未注明g取值","clear"/);

  const html = fs.readFileSync(htmlFile, 'utf8');
  assert.match(html, /data:image\/jpeg;base64,/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /Token：共 1500（缓存 800，调用 2 次）/);
  assert.match(html, /规则疑点：第2问：标准未注明g取值/);
});

test('stripEmbeddedPolicyTemplates cleans legacy/conflicting policies without mutating saved rubric', () => {
  const legacyText = [
    '学科：物理；答案要求：严格。',
    realWorldReviewPolicy,
    subjectReviewPolicy('physics'),
    rubricPrompts.strict.text,
    '第（1）问：满分5分',
    '必须列出动能定理原始方程，禁止直接用推论。'
  ].join('\n');

  const cleaned = stripEmbeddedPolicyTemplates(legacyText, { strictness: 'lenient' });
  assert.doesNotMatch(cleaned, /答案要求：严格/);
  assert.doesNotMatch(cleaned, /真实作答通用边界/);
  assert.doesNotMatch(cleaned, /刹车区间的充分证据示例/);
  assert.match(cleaned, /学科：物理/);
  assert.match(cleaned, /必须列出动能定理原始方程/);

  const rubricObj = { text: legacyText, images: [] };
  const snapshot = structuredClone(rubricObj);
  const prompt = promptFor({
    rubric: rubricObj,
    answer: 'v=5m/s',
    scoring: { strictness: 'lenient', maxScore: 5, units: [] }
  });

  assert.deepEqual(rubricObj, snapshot);
  assert.match(prompt, /本次实际阅卷口径：宽松（lenient）/);
  assert.doesNotMatch(prompt, /答案要求：严格/);
  assert.doesNotMatch(prompt, /严格模式下的解答题：/);
  assert.equal(prompt.split('真实作答通用边界').length - 1, 1);
  assert.equal(prompt.split('宽松模式下的解答题：').length - 1, 1);
  assert.match(prompt, /必须列出动能定理原始方程/);
});

test('task metrics API, UI history metrics banner, and offline benchmark/replay CLI work end to end', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-step7-metrics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const app = await createApp({ root });
  t.after(() => app.close());

  const imgBuf = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } }).jpeg({ quality: 88 }).toBuffer();
  const imgFiles = await app.store.images('m-1', [{ buffer: imgBuf }]);

  app.store.save({
    id: 'm-1',
    presetName: '方案A',
    state: 'submitted',
    mode: 'normal',
    time: new Date().toISOString(),
    imageFiles: imgFiles,
    originalResult: { score: 6 },
    correctionReason: '补充写出列式，按正常口径加2分',
    result: {
      score: 8,
      dualEval: { result: 'arbitration' },
      recognition: { status: 'clear' },
      totalUsage: { calls: 3, inputTokens: 1000, outputTokens: 200, totalTokens: 1200, cachedTokens: 600, reasoningTokens: 50 },
      studentAnswer: 'a=2',
      comment: 'ok',
      subScores: []
    }
  });
  app.store.save({
    id: 'm-2',
    presetName: '方案A',
    state: 'submitted',
    mode: 'normal',
    time: new Date().toISOString(),
    result: {
      score: 10,
      dualEval: { result: 'agree' },
      recognition: { status: 'uncertain' },
      policyAudit: { policyIssues: [{ code: 'strict-deduction-in-lenient' }], consistencyIssues: [], issues: [{ code: 'strict-deduction-in-lenient' }] },
      totalUsage: { calls: 2, inputTokens: 1000, outputTokens: 100, totalTokens: 1100, cachedTokens: 400, reasoningTokens: 0 },
      studentAnswer: 'a=3',
      comment: 'ok',
      subScores: []
    }
  });
  app.store.save({
    id: 'm-3',
    presetName: '方案B',
    state: 'paused',
    mode: 'trial',
    time: new Date().toISOString(),
    blankDetection: { isBlank: true }
  });

  const home = await fetch(app.url);
  const cookie = home.headers.get('set-cookie').split(';')[0];
  const allMetrics = await (await fetch(`${app.url}/api/metrics`, { headers: { Cookie: cookie } })).json();
  assert.equal(allMetrics.total, 3);
  assert.equal(allMetrics.scoredCount, 2);
  assert.equal(allMetrics.submittedCount, 2);
  assert.equal(allMetrics.pausedCount, 1);
  assert.equal(allMetrics.blankCount, 1);
  assert.equal(allMetrics.averageScore, 9);
  assert.equal(allMetrics.correctionCount, 1);
  assert.equal(allMetrics.meaningfulCorrectionCount, 1);
  assert.equal(allMetrics.dualEval.total, 2);
  assert.equal(allMetrics.dualEval.arbitrated, 1);
  assert.equal(allMetrics.recognition.uncertainCount, 1);
  assert.equal(allMetrics.verification.policyIssueCount, 1);
  assert.equal(allMetrics.usage.totalTokens, 2300);
  assert.equal(allMetrics.usage.cachedTokens, 1000);
  assert.equal(allMetrics.usage.cacheHitRate, 0.5);
  assert.equal(allMetrics.byPreset.length, 2);

  const filteredMetrics = await (await fetch(`${app.url}/api/metrics?preset=${encodeURIComponent('方案A')}`, { headers: { Cookie: cookie } })).json();
  assert.equal(filteredMetrics.total, 2);
  assert.equal(filteredMetrics.submittedCount, 2);

  const browser = await launchBrowser({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(app.url);
  await page.locator('[data-tab=history]').click();
  await page.waitForFunction(() => {
    const el = document.querySelector('#historyMetrics');
    return el && !el.hidden && el.textContent.includes('Token 2300');
  });
  const banner = await page.locator('#historyMetrics').innerText();
  assert.match(banner, /均分：9/);
  assert.match(banner, /已提交 2\/3/);
  assert.match(banner, /仲裁 1\/2/);
  assert.match(banner, /改分 1 次/);
  assert.match(banner, /缓存 50%/);
  assert.match(banner, /核验告警 1/);

  // Benchmark evaluation + replay + CLI execution
  const evalCfg = { answer: 'a=2', rubric: '第1问：满分10分\n答案a=2。', scoring: { strictness: 'lenient', maxScore: 10, units: [] } };
  const evaluated = evaluateRecords(app.store.records(), { preset: '方案A', config: evalCfg });
  assert.equal(evaluated.totalRecords, 2);
  assert.equal(evaluated.accuracy.count, 2);
  assert.equal(evaluated.accuracy.exactMatches, 1);
  assert.equal(evaluated.accuracy.mae, 1);
  assert.equal(evaluated.accuracy.bias, -1);

  const replayed = await replayBenchmark({
    records: [app.store.getById('m-1')],
    config: evalCfg,
    gradeFn: async (_cfg, _settings, images) => {
      assert.ok(images[0].startsWith('data:image/jpeg;base64,'));
      return { gradingMode: 'lenient', score: 8, studentAnswer: 'a=2', comment: '过程有效得8分', subScores: [] };
    }
  });
  assert.equal(replayed.accuracy.exactMatchRate, 1);

  const md = formatBenchmarkReport(evaluated);
  assert.match(md, /# 阅卷离线基准评估报告（方案A）/);
  assert.match(md, /完全一致率：50\.0%/);

  const cliOut = execFileSync(process.execPath, [
    path.resolve('scripts/eval-benchmark.mjs'),
    '--db', path.join(root, 'data'),
    '--json'
  ], { encoding: 'utf8' });
  const parsedCli = JSON.parse(cliOut);
  assert.equal(parsedCli.totalRecords, 3);
  assert.equal(parsedCli.metrics.usage.totalTokens, 2300);

  // Sanity check summarizeTaskMetrics empty edge case
  assert.equal(summarizeTaskMetrics([]).averageScore, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import sharp from 'sharp';
import {
  MAX_CALIBRATION_NOTES_LENGTH,
  isMeaningfulCorrectionReason,
  normalizeCalibrationNotes,
  appendCalibrationRule,
  formatCalibrationNotesBlock,
  collectPresetCorrections,
  summarizeCorrections,
  formatCorrectionsForRubric
} from '../src/correction-feedback.mjs';
import { fieldText, fieldImages, promptFor, promptPartsFor, validateConfig } from '../src/domain.mjs';
import { generateRubric } from '../src/rubric-generator.mjs';
import { Store } from '../src/store.mjs';
import { launchBrowser } from '../src/browser.mjs';
import { createApp } from '../src/server.mjs';

test('correction-feedback aggregates custom reasons, filters defaults, deduplicates suggestions, and detects strict/lenient drift', () => {
  assert.equal(isMeaningfulCorrectionReason('教师在界面修改'), false);
  assert.equal(isMeaningfulCorrectionReason('教师修改评分依据'), false);
  assert.equal(isMeaningfulCorrectionReason('  简写v=20-4t不扣分  '), true);

  assert.equal(normalizeCalibrationNotes('  - 规则A \n\n 规则A \n - 规则B '), '- 规则A\n- 规则B');
  let notes = appendCalibrationRule('', '简写v=20-4t已体现减速，不扣分');
  assert.equal(notes, '- 简写v=20-4t已体现减速，不扣分');
  notes = appendCalibrationRule(notes, '简写v=20-4t已体现减速，不扣分');
  assert.equal(notes, '- 简写v=20-4t已体现减速，不扣分');
  notes = appendCalibrationRule(notes, '未判断停车时间直接代入3s不得分');
  assert.equal(notes, '- 简写v=20-4t已体现减速，不扣分\n- 未判断停车时间直接代入3s不得分');
  assert.throws(() => appendCalibrationRule('a'.repeat(1995), '超过长度的新规则'), /最多2000字/);

  const records = [
    { id: '1', time: '2026-11-21T01:00:00Z', presetName: '物理第13题', correctionReason: '简写v=20-4t已体现减速，不扣分', originalResult: { score: 8 }, result: { score: 10, studentAnswer: 'v=20-4t', comment: '调整' } },
    { id: '2', time: '2026-11-21T02:00:00Z', presetName: '物理第13题', correctionReason: '简写v=20-4t已体现减速，不扣分', originalResult: { score: 9 }, result: { score: 10, studentAnswer: 'v=20-4*2', comment: '调整' } },
    { id: '3', time: '2026-11-21T03:00:00Z', presetName: '物理第13题', correctionReason: '教师在界面修改', originalResult: { score: 6 }, result: { score: 7, studentAnswer: '过程略' } },
    { id: '4', time: '2026-11-21T04:00:00Z', presetName: '物理第13题', correctionReason: '只改评语措辞', originalResult: { score: 10, comment: '原' }, result: { score: 10, comment: '新' } },
    { id: 'other', time: '2026-11-21T05:00:00Z', presetName: '另一方案', correctionReason: '跨方案不混入', originalResult: { score: 4 }, result: { score: 2 } }
  ];

  const items = collectPresetCorrections(records, '物理第13题');
  assert.equal(items.length, 4);
  assert.equal(items[0].id, '4');

  const summary = summarizeCorrections(records, '物理第13题', { existingText: '' });
  assert.equal(summary.totalRecords, 4);
  assert.equal(summary.correctedCount, 4);
  assert.equal(summary.raisedCount, 3);
  assert.equal(summary.loweredCount, 0);
  assert.equal(summary.commentOnlyCount, 1);
  assert.equal(summary.averageDelta, 1);
  assert.match(summary.policyHint, /偏严/);
  assert.deepEqual(summary.topReasons.map(r => [r.reason, r.count]), [
    ['简写v=20-4t已体现减速，不扣分', 2],
    ['只改评语措辞', 1]
  ]);
  assert.equal(summary.suggestedRules.length, 2);

  const deduped = summarizeCorrections(records, '物理第13题', { existingText: '已有规则：简写v=20-4t已体现减速，不扣分' });
  assert.deepEqual(deduped.suggestedRules.map(s => s.rule), ['只改评语措辞']);

  const lowerSummary = summarizeCorrections([
    { id: 'a', presetName: 'p', originalResult: { score: 8 }, result: { score: 6 } },
    { id: 'b', presetName: 'p', originalResult: { score: 8 }, result: { score: 7 } },
    { id: 'c', presetName: 'p', originalResult: { score: 8 }, result: { score: 5 } }
  ], 'p');
  assert.match(lowerSummary.policyHint, /偏松/);

  const rubricText = formatCorrectionsForRubric(summary.items);
  assert.match(rubricText, /原分8→实分10/);
  assert.match(rubricText, /只改评语措辞/);
});

test('domain decouples vendor/prompt.js, preserves single/multi-unit formatting, and injects calibrationNotes into system prompt', async () => {
  const domainSource = fs.readFileSync(new URL('../src/domain.mjs', import.meta.url), 'utf8');
  assert.equal(domainSource.includes('vendor/prompt.js'), false);

  assert.equal(fieldText({ text: { text: '嵌套文本' } }), '嵌套文本');
  assert.deepEqual(fieldImages({ question: { images: ['q1'] }, answer: { images: ['a1'] }, rubric: { images: ['r1'] } }), ['q1', 'a1', 'r1']);

  const img = 'data:image/png;base64,QQ==';
  const singleConfig = {
    question: { text: '求位移', images: [img] },
    answer: { text: '12m', images: [img] },
    rubric: '第（1）问：满分4分\n完整正确得4分。',
    scoring: { maxScore: 4, units: [] }
  };
  const basePrompt = promptFor(singleConfig);
  assert.match(basePrompt, /（图片说明：第1-1张为题目配图，第2-2张为参考答案配图）/);
  assert.match(basePrompt, /【标准答案】\n12m/);
  assert.doesNotMatch(basePrompt, /【教师校标补充/);

  const multiConfig = {
    ...singleConfig,
    scoring: {
      maxScore: 10,
      units: [
        { label: '第（1）问', maxScore: 4, answer: '2s', rubric: '列式2分，结果2分' },
        { label: '第（2）问', maxScore: 6 }
      ]
    },
    calibrationNotes: '- 简写v=20-4t已体现减速，不扣分'
  };
  const multiParts = promptPartsFor(multiConfig);
  assert.match(multiParts.system, /【参考答案】/);
  assert.match(multiParts.system, /### 第（1）问（满分4分）/);
  assert.match(multiParts.system, /参考答案：2s/);
  assert.match(multiParts.system, /【教师校标补充（人工改分沉淀，本任务优先遵循）】\n- 简写v=20-4t已体现减速，不扣分/);

  assert.throws(() => validateConfig({ ...singleConfig, calibrationNotes: 'x'.repeat(MAX_CALIBRATION_NOTES_LENGTH + 1) }), /最多2000字/);

  let withoutCorrections = '';
  let withCorrections = '';
  const rubricInput = {
    version: 2,
    provider: 'p',
    model: 'm',
    subject: 'physics',
    strictness: 'normal',
    scoringMethod: 'points',
    question: '求刹车位移',
    answer: '0.75m',
    maxScore: 4,
    roundStep: 1
  };
  const fakeRequest = async (_provider, _model, prompt) => {
    if (!withoutCorrections) withoutCorrections = prompt;
    else withCorrections = prompt;
    return JSON.stringify({ question: '求刹车位移', answer: '0.75m', warnings: [], items: [{ label: '第（1）问', maxScore: 4, criteria: '完整正确得4分。' }] });
  };
  await generateRubric({ providers: { p: {} } }, rubricInput, fakeRequest);
  await generateRubric({ providers: { p: {} } }, { ...rubricInput, corrections: [{ originalScore: 3, finalScore: 4, reason: '简写v=20-4t已体现减速，不扣分', studentAnswer: '20-4*3=8' }] }, fakeRequest);
  assert.doesNotMatch(withoutCorrections, /近期教师人工改分纠偏记录/);
  assert.match(withCorrections, /近期教师人工改分纠偏记录（仅作共性边界参考/);
  assert.match(withCorrections, /原分3→实分4；原因：简写v=20-4t已体现减速，不扣分/);
});

test('server review沉淀 calibrationNotes immediately applies to next paper, store searches correctionReason, and UI manages suggestions safely', { timeout: 60000 }, async t => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-corr-store-'));
  const store = new Store(storeDir);
  store.save({ id: 'c1', state: 'submitted', time: '2026-11-21T01:00:00Z', presetName: '方案A', correctionReason: '矢量简写免扣边界', result: { score: 4, studentAnswer: 'x=2', comment: 'ok' } });
  const found = store.historyPage({ search: '矢量简写免扣边界' });
  assert.equal(found.total, 1);
  assert.equal(found.items[0].id, 'c1');
  store.close();
  fs.rmSync(storeDir, { recursive: true, force: true });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-corr-app-'));
  const image = await sharp({ create: { width: 160, height: 80, channels: 3, background: '#fff' } }).png().toBuffer();
  let paperIndex = 0;
  let submits = 0;
  const fixture = http.createServer((req, res) => {
    if (req.url === '/image') { res.setHeader('Content-Type', 'image/png'); res.end(image); return; }
    if (req.url === '/submit') { submits++; res.setHeader('Content-Type', 'application/json'); res.end('{"success":true}'); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<div id="task">t1</div><div id="paper" data-paper-id="p1">p1</div><div name="topicImg"><img src="/image"></div><input name="topicTxt" score="4"><button id="bnt_save" onclick="submitScore()">提交</button><script>window.paper=1;function submitScore(){fetch('/submit',{method:'POST'}).then(()=>{window.paper++;const el=document.getElementById('paper');el.setAttribute('data-paper-id','p'+window.paper);el.textContent='p'+window.paper;});}</script>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;
  const browser = await launchBrowser({ headless: true });

  const seenCalibrationNotes = [];
  const seenPrompts = [];
  const app = await createApp({
    root,
    browserFactory: async () => await browser.newContext(),
    gradeFunction: async config => {
      paperIndex++;
      seenCalibrationNotes.push(config.calibrationNotes || '');
      seenPrompts.push(promptFor(config));
      return { score: 3, studentAnswer: `v=20-4t#${paperIndex}`, comment: '首次扣1分', subScores: [] };
    }
  });
  t.after(async () => {
    await app.close();
    await browser.close();
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Configure valid preset, shared provider, workflow, & verified fixture platform
  const initCfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const active = initCfg.active;
  initCfg.presets[active].answer = '参考答案';
  initCfg.presets[active].rubric = '第（1）问：满分4分\n按有效过程与答案给分。';
  initCfg.presets[active].scoring = { maxScore: 4, units: [], roundStep: 1, roundMethod: 'round' };
  const sharedProviders = { '测试': { protocol: 'chat', endpoint: fixtureUrl, apiKey: 'test-key', models: ['m1'] } };
  initCfg.providers = sharedProviders;
  initCfg.workflows[initCfg.presets[active].workflowId] = {
    model: { provider: '测试', model: 'm1' },
    dualEval: { enabled: false }
  };
  initCfg.browser = { url: fixtureUrl, headless: true };
  initCfg.platform = {
    verified: true,
    paperIdSelector: '#paper',
    taskIdSelector: '#task',
    imageSelector: '[name="topicImg"] img',
    scoreSelector: 'input[name="topicTxt"]',
    submitSelector: '#bnt_save',
    submitResponseUrlPattern: '/submit$'
  };
  initCfg.adaptationGroups = [{ id: 'g1', name: '测试站', url: fixtureUrl, platform: initCfg.platform }];
  initCfg.selectedAdaptationGroupId = 'g1';
  fs.writeFileSync(path.join(root, 'shared-providers.json'), JSON.stringify(sharedProviders, null, 2));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(initCfg, null, 2));

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(app.url);
  await page.waitForFunction(() => document.querySelector('#phase').textContent === '待开始');

  await page.locator('#open').click();
  await page.waitForFunction(() => !document.querySelector('#diagnose').disabled);
  await page.locator('#diagnose').click();
  await page.waitForFunction(() => document.querySelector('#phase').textContent === '页面已识别');
  await page.locator('#start').click();
  await page.waitForFunction(() => !document.querySelector('#submit').disabled);

  // Paper 1: teacher edits score to 4, writes custom reason, checks #saveCorrectionRule, and submits
  await page.locator('[data-score]').fill('4');
  await page.locator('#correction').fill('简写v=20-4t已体现减速，不扣分');
  await page.locator('#saveCorrectionRule').check();
  await page.locator('#submit').click();

  // Wait until paper 2 finishes grading and enters review
  await page.waitForFunction(() => document.querySelector('#ocr')?.textContent?.includes('v=20-4t#2'));
  assert.equal(submits, 1);
  assert.equal(seenCalibrationNotes[0], '');
  assert.equal(seenCalibrationNotes[1], '- 简写v=20-4t已体现减速，不扣分');
  assert.match(seenPrompts[1], /【教师校标补充（人工改分沉淀，本任务优先遵循）】\n- 简写v=20-4t已体现减速，不扣分/);

  // Stop grading cleanly so we can manage calibration panel in presets UI
  await page.locator('#stopReview').click();
  await page.waitForFunction(() => !document.querySelector('#savePreset').disabled);

  // Check GET /api/corrections and duplicate suggestion filtering + POST /api/calibration-note
  const corrections = await page.evaluate(async () => await (await fetch('/api/corrections')).json());
  assert.equal(corrections.correctedCount, 1);
  assert.equal(corrections.raisedCount, 1);
  assert.equal(corrections.suggestedRules.length, 0);

  const apiAdded = await page.evaluate(async () => {
    const res = await fetch('/api/calibration-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: '未写明停车判断不得第3问过程分' })
    });
    return await res.json();
  });
  assert.equal(apiAdded.ok, true);
  assert.match(apiAdded.calibrationNotes, /未写明停车判断不得第3问过程分/);

  // Also seed an un-adopted custom correction reason via store and verify UI #loadCorrectionSuggestions adopts it
  app.store.save({
    id: 'extra-corr',
    state: 'submitted',
    time: new Date().toISOString(),
    presetName: active,
    correctionReason: '最终答案正确且含有效列式应给满分',
    originalResult: { score: 3 },
    result: { score: 4, studentAnswer: 'x=2', comment: '人工加回1分' }
  });

  await page.reload();
  await page.locator('[data-tab="presets"]').click();
  await page.locator('#calibrationPanel > summary').click();
  assert.match(await page.locator('#calibrationNotes').inputValue(), /简写v=20-4t已体现减速，不扣分/);
  assert.match(await page.locator('#calibrationStatus').textContent(), /已添加 2 条/);

  await page.locator('#loadCorrectionSuggestions').click();
  await page.waitForFunction(() => document.querySelectorAll('#calibrationSuggestions button').length === 1);
  assert.match(await page.locator('#calibrationStats').textContent(), /已改分 2 份（调高 2 \/ 调低 0）/);
  await page.locator('#calibrationSuggestions button').click();
  assert.match(await page.locator('#calibrationNotes').inputValue(), /最终答案正确且含有效列式应给满分/);

  await page.locator('#savePreset').click();
  await page.waitForFunction(() => document.querySelector('#dirtyBadge').hidden);
  await page.reload();
  await page.locator('[data-tab="presets"]').click();
  assert.match(await page.locator('#calibrationNotes').inputValue(), /最终答案正确且含有效列式应给满分/);

  // Verify rubric generator sends recent corrections when #rubricIncludeCorrections is checked
  let rubricRequestPayload = null;
  await page.route('**/api/generate-rubric*', async route => {
    rubricRequestPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ question: 'Q', answer: 'A', rubric: '第（1）问：满分4分\n已整合改分边界。', warnings: [] })
    });
  });
  await page.locator('#openRubricGenerator').click();
  assert.equal(await page.locator('#rubricIncludeCorrections').isChecked(), false);
  await page.locator('#rubricIncludeCorrections').check();
  await page.locator('#generateRubric').click();
  await page.waitForFunction(() => !document.querySelector('#rubricDraft').hidden);
  assert.ok(Array.isArray(rubricRequestPayload?.corrections));
  assert.equal(rubricRequestPayload.corrections.length, 2);
  await page.locator('#closeRubricGenerator').click();

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

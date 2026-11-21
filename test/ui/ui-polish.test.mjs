import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import sharp from 'sharp';
import { launchBrowser } from '../../src/browser.mjs';
import { createApp } from '../../src/server.mjs';

test('UI incremental polish: metrics chips, row badges, mobile 6-col table, calibration layout, alert banner, zoom/rotate, polling stability, and shortcuts', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-ui-polish-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const image = await sharp({ create: { width: 240, height: 120, channels: 3, background: '#fff' } }).png().toBuffer();
  const fixture = http.createServer((req, res) => {
    if (req.url === '/image') { res.setHeader('Content-Type', 'image/png'); res.end(image); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<div id="task">demo</div><div id="paper" data-paper-id="p1">p1</div><div name="topicImg"><img src="/image"></div><input name="topicTxt" score="5"><button id="bnt_save">提交</button>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;

  const browser = await launchBrowser({ headless: true });
  let gradingPage;
  const app = await createApp({
    root,
    browserFactory: async () => {
      const context = await browser.newContext();
      gradingPage = await context.newPage();
      return context;
    },
    gradeFunction: async () => ({
      score: 4,
      studentAnswer: '作答过程略',
      comment: '扣1分',
      formatWarning: '评分口径冲突：非严格口径出现严格扣分依据，请人工核对。',
      subScores: []
    })
  });
  t.after(async () => {
    await app.close();
    await browser.close();
    await new Promise(resolve => fixture.close(resolve));
  });

  // Pre-seed history records to test badges, metrics chips, and mobile 6-column table
  app.store.save({
    id: 'ui-rec-1',
    presetName: '测试方案',
    state: 'submitted',
    mode: 'trial',
    time: new Date().toISOString(),
    originalResult: { score: 3 },
    correctionReason: '补充步骤得分',
    result: {
      score: 5,
      dualEval: { result: 'arbitration' },
      policyAudit: { issues: ['评分口径冲突'] },
      totalUsage: { calls: 2, inputTokens: 800, outputTokens: 200, totalTokens: 1000, cachedTokens: 400 }
    }
  });

  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(10000);

  let searchRequests = 0;
  page.on('request', req => {
    if (req.url().includes('/api/history') && req.url().includes('search=')) searchRequests++;
  });

  await page.goto(app.url);
  await page.waitForFunction(() => document.querySelector('#phase').textContent === '待开始');

  // Check #calibrationPanel single-column layout inside Presets tab
  await page.locator('[data-tab=presets]').click();
  await page.locator('#calibrationPanel > summary').click();
  const calCols = await page.locator('#calibrationPanel .calibration-body').evaluate(el => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
  assert.equal(calCols, 1);

  // Check History tab: chips + badges + search debounce + mobile 6-column table
  await page.locator('[data-tab=history]').click();
  await page.waitForFunction(() => document.querySelectorAll('#historyMetrics .history-metric-chip').length >= 4);
  const firstRowText = await page.locator('#historyRows tr:first-child td:nth-child(3)').innerText();
  assert.match(firstRowText, /已仲裁/);
  assert.match(firstRowText, /核验告警/);
  assert.match(firstRowText, /已改分/);
  const rowClass = await page.locator('#historyRows tr:first-child').getAttribute('class');
  assert.match(rowClass, /history-conflict/);

  // Debounce check: rapid typing should coalesce into a single /api/history?search=... request
  searchRequests = 0;
  await page.locator('#historySearch').focus();
  await page.keyboard.type('测试查', { delay: 15 });
  await page.waitForTimeout(320);
  assert.equal(searchRequests, 1);
  await page.locator('#historySearch').fill('');
  await page.waitForFunction(() => document.querySelectorAll('#historyRows tr').length >= 1);

  // Mobile 6-column table layout check
  await page.setViewportSize({ width: 700, height: 900 });
  const btnWidth = await page.locator('#historyRows tr:first-child td:nth-child(6) button').evaluate(el => el.getBoundingClientRect().width);
  const codeCellText = await page.locator('#historyRows tr:first-child td:nth-child(5)').innerText();
  assert.ok(btnWidth > 300, `expected full-width button in column 6 on mobile, got ${btnWidth}`);
  assert.ok(codeCellText.length > 0);
  await page.setViewportSize({ width: 1366, height: 900 });

  // Configure valid preset, provider, & workflow so we can trigger review panel in grading tab
  const home = await fetch(app.url);
  const cookie = home.headers.get('set-cookie').split(';')[0];
  const cfgRes = await fetch(`${app.url}/api/settings`, { headers: { Cookie: cookie } });
  const cfg = await cfgRes.json();
  cfg.providers['test-p'] = { protocol: 'chat', endpoint: 'http://127.0.0.1:9/v1', apiKey: 'k', models: ['m'] };
  await fetch(`${app.url}/api/providers`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: app.url, 'Content-Type': 'application/json' },
    body: JSON.stringify({ providers: cfg.providers })
  });
  const wfId = Object.keys(cfg.workflows)[0] || 'default';
  cfg.browser = { url: fixtureUrl, headless: true };
  cfg.workflows[wfId] = { ...cfg.workflows[wfId], id: wfId, model: { provider: 'test-p', model: 'm' }, dualEval: { enabled: false } };
  cfg.presets[cfg.active] = {
    question: 'Q',
    answer: 'A',
    rubric: '第1问：满分5分\n正确得5分。',
    workflowId: wfId,
    scoring: { maxScore: 5, roundStep: 1, units: [] }
  };
  await fetch(`${app.url}/api/settings`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: app.url, 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg)
  });

  await page.reload();
  await page.locator('[data-tab=grading]').click();
  await page.locator('#open').click();
  await page.waitForFunction(() => document.querySelector('#browserStatus').classList.contains('connected'));
  await gradingPage.waitForSelector('#paper');
  await page.locator('#diagnose').click();
  await page.waitForFunction(() => document.querySelector('#checkTitle').textContent === '页面已识别');

  // Verify polling does not churn #events DOM nodes when events are unchanged
  await page.evaluate(() => { window.__firstEventNode = document.querySelector('#events li'); });
  await page.waitForTimeout(1600);
  const sameEventNode = await page.evaluate(() => window.__firstEventNode !== null && window.__firstEventNode === document.querySelector('#events li'));
  assert.equal(sameEventNode, true);

  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelector('#phase').textContent === '请确认评分');

  // Check #resultAlertBanner displays warning visibly
  assert.equal(await page.locator('#resultAlertBanner').isVisible(), true);
  assert.match(await page.locator('#resultAlertBanner').innerText(), /需人工重点核对[\s\S]*评分口径冲突/);

  // Check #imageDialog zoom, rotate, reset, close
  await page.locator('#answerImages img').click();
  assert.equal(await page.locator('#imageDialog').isVisible(), true);
  await page.locator('#zoomInImage').click();
  assert.equal(await page.locator('#imageZoomLabel').innerText(), '125%');
  await page.locator('#rotateImage').click();
  assert.equal(await page.locator('#largeImage').getAttribute('data-angle'), '90');
  await page.locator('#zoomResetImage').click();
  assert.equal(await page.locator('#largeImage').getAttribute('data-scale'), '1');
  assert.equal(await page.locator('#largeImage').getAttribute('data-angle'), '0');
  await page.locator('#closeImage').click();
  assert.equal(await page.locator('#imageDialog').isVisible(), false);

  // Check Ctrl+Enter shortcut executes review fill while focus is in textarea
  await page.locator('#commentEditor > summary').click();
  await page.locator('#comment').focus();
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => document.querySelector('#reason').textContent.includes('等待用户在网站提交'));
  assert.equal(await gradingPage.locator('input[name=topicTxt]').inputValue(), '4');
});

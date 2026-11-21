import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Store } from '../src/store.mjs';
import { Runner } from '../src/runner.mjs';
import { blackRatio, detectBlank } from '../src/blank.mjs';
import {
  requestModel,
  resetModelCapabilityCache,
  parseRetryAfterMs,
  extractHttpErrorSummary
} from '../src/models.mjs';
import { createApp } from '../src/server.mjs';
import { launchBrowser } from '../src/browser.mjs';

test('Store indexes, point queries getById/hasStates/hasIdentityInStates and Runner integration', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-store-hardening-'));
  const store = new Store(dir);
  try {
    const indexes = store.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='records'").all().map(r => r.name);
    assert.ok(indexes.includes('idx_records_updated'));
    assert.ok(indexes.includes('idx_records_state_updated'));

    assert.equal(store.getById('missing'), null);
    assert.equal(store.getById(''), null);
    assert.equal(store.hasStates(['submitting', 'uncertain']), false);

    store.save({ id: 'rec-1', state: 'submitted', identity: 'task1:paper1', time: '2026-11-21T01:00:00Z', result: { score: 4, subScores: [] } });
    store.save({ id: 'rec-2', state: 'uncertain', identity: 'task1:paper2', time: '2026-11-21T02:00:00Z', result: { score: 2, subScores: [] } });

    assert.equal(store.getById('rec-1')?.identity, 'task1:paper1');
    assert.equal(store.hasStates(['submitting', 'uncertain']), true);
    assert.equal(store.hasStates(['filled']), false);
    assert.equal(store.hasIdentityInStates('task1:paper1', ['submitted']), true);
    assert.equal(store.hasIdentityInStates('task1:paper2', ['submitted']), false);

    // Runner stops cleanly on unresolved states via store.hasStates
    const runner = new Runner(
      { ready: async () => { throw Error('should not be reached'); }, diagnostic: async () => {} },
      store,
      { active: 'p', presets: {}, mode: 'trial' },
      async () => 'stop'
    );
    const blocked = await runner.run();
    assert.equal(blocked.paused, true);
    assert.match(blocked.reason, /提交状态不明/);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('model-client capability cache isolates models, handles double 429 with Retry-After, and sanitizes HTTP errors', async t => {
  resetModelCapabilityCache();

  assert.equal(parseRetryAfterMs('0'), 50);
  assert.equal(parseRetryAfterMs('2'), 2000);
  assert.equal(parseRetryAfterMs('120'), 15000);
  assert.equal(parseRetryAfterMs('invalid'), null);
  assert.ok(parseRetryAfterMs(new Date(Date.now() + 5000).toUTCString()) >= 50);

  assert.equal(
    extractHttpErrorSummary(JSON.stringify({ error: { message: 'Invalid Bearer secret_token_123 and sk-1234567890abcdef at https://x.test?api_key=abc999' } })),
    'Invalid Bearer [redacted] and sk-[redacted] at https://x.test?api_key=[redacted]'
  );
  assert.equal(extractHttpErrorSummary('<!doctype html><html><body>502 Bad Gateway</body></html>'), '');

  let mode = 'cache_test';
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    bodies.push(body);
    res.setHeader('Content-Type', 'application/json');

    if (mode === 'cache_test') {
      if (body.model === 'legacy-m' && (body.response_format || body.messages.some(m => m.role === 'system'))) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: { message: 'response_format unsupported and system role not allowed' } }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"score":4}' } }] }));
      return;
    }

    if (mode === 'rate_limit_recover') {
      if (bodies.length <= 2) {
        res.writeHead(429, { 'Retry-After': '0' });
        res.end(JSON.stringify({ error: { message: 'Rate limit exceeded' } }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"score":4}' } }] }));
      return;
    }

    if (mode === 'rate_limit_exhausted') {
      res.writeHead(429, { 'Retry-After': '0' });
      res.end(JSON.stringify({ error: { message: 'Quota exceeded for sk-abcdefgh123456' } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const provider = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'test-key', jsonMode: true };
  const prompt = { system: 'SYS', user: 'USR' };

  // First call downgrades legacy-m after 400 and caches it
  await requestModel(provider, 'legacy-m', prompt, [], undefined, { remaining: 6 });
  assert.equal(bodies.length, 2);

  // Second call to legacy-m uses cache directly in 1 request
  bodies.length = 0;
  await requestModel(provider, 'legacy-m', prompt, [], undefined, { remaining: 6 });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].response_format, undefined);
  assert.equal(bodies[0].messages.length, 1);

  // Different model on same endpoint is not downgraded
  bodies.length = 0;
  await requestModel(provider, 'modern-m', prompt, [], undefined, { remaining: 6 });
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].response_format, { type: 'json_object' });
  assert.equal(bodies[0].messages[0].role, 'system');

  // Double 429 recovers on 3rd attempt when Retry-After is small
  mode = 'rate_limit_recover';
  bodies.length = 0;
  const recovered = await requestModel(provider, 'modern-m', prompt, [], undefined, { remaining: 6 });
  assert.equal(recovered, '{"score":4}');
  assert.equal(bodies.length, 3);

  // Exhausted 429 surfaces sanitized upstream summary
  mode = 'rate_limit_exhausted';
  bodies.length = 0;
  await assert.rejects(
    requestModel(provider, 'modern-m', prompt, [], undefined, { remaining: 6 }),
    /模型服务HTTP 429：Quota exceeded for sk-\[redacted\]/
  );
  assert.equal(bodies.length, 3);
});

test('cli.mjs models uses listModels without response.ok() TypeError and saves models atomically', async t => {
  let requestedUrl = '';
  const server = http.createServer((req, res) => {
    requestedUrl = req.url;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'cli-model-1' }, { id: 'cli-model-2' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-cli-models-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    version: 1,
    active: 'p',
    presets: { p: { answer: 'a', rubric: 'r', scoring: { maxScore: 4 } } },
    providers: { main: { protocol: 'chat', endpoint: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'cli-key', models: [] } },
    workflows: { w: { model: { provider: 'main', model: '' } } }
  }, null, 2));

  const cliPath = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, 'models', configPath, 'main'], { encoding: 'utf8' });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /保存2个模型ID/);
  assert.equal(requestedUrl, '/v1/models');
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(saved.providers.main.models, ['cli-model-1', 'cli-model-2']);
});

test('blank.mjs computes exact pixel ratios without Array spread allocation', async () => {
  const white = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const black = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#000000' } }).png().toBuffer();

  const wRatio = await blackRatio(white, 128);
  const bRatio = await blackRatio(black, 128);
  assert.equal(wRatio.ratio, 0);
  assert.equal(bRatio.ratio, 1);

  assert.equal((await detectBlank([{ buffer: white }], [wRatio])).isBlank, true);
  assert.equal((await detectBlank([{ buffer: black }], [wRatio])).isBlank, false);
});

test('/api/workspace-name updates config.json atomically without leaking shared-providers.json', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-workspace-atomic-'));
  const browser = await launchBrowser({ headless: true });
  const app = await createApp({ root, browserFactory: async () => await browser.newContext() });
  t.after(async () => {
    await app.close();
    await browser.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const sharedPath = path.join(root, 'shared-providers.json');
  fs.writeFileSync(sharedPath, JSON.stringify({ secretProvider: { protocol: 'chat', endpoint: 'https://api.example.com/v1', apiKey: 'do-not-leak' } }, null, 2));

  const page = await browser.newPage();
  await page.goto(app.url);
  await page.waitForFunction(() => document.querySelector('#phase').textContent === '待开始');
  const res = await page.evaluate(async () => {
    const response = await fetch('/api/workspace-name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '原子任务名' })
    });
    return await response.json();
  });
  assert.equal(res.ok, true);

  const localCfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  assert.equal(localCfg.workspaceName, '原子任务名');
  assert.equal(Object.hasOwn(localCfg.providers || {}, 'secretProvider'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { promptFor, promptPartsFor } from '../src/domain.mjs';
import { requestModel, extractUsage, grade, resetModelCapabilityCache } from '../src/models.mjs';
import { generateRubric } from '../src/rubric-generator.mjs';
import { launchBrowser } from '../src/browser.mjs';

const validPayload = (score = 4) => ({
  studentAnswer: 'x=2',
  gradingMode: 'normal',
  recognition: { status: 'clear', coverageChecked: true, notes: [], issues: [] },
  gradingIssues: [],
  scoringDetails: [{ id: 'scoring-item-question-1', label: '第（1）问', maxScore: 4, score, studentAnswer: 'x=2', reason: '完整正确' }],
  score,
  comment: '第（1）问得' + score + '分',
  diligenceLevel: 0,
  subScores: []
});

test('chat, responses and gemini send system/user separation, jsonMode toggles, and mergeSystemPrompt', async t => {
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    bodies.push({ url: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes(':generateContent')) {
      res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(validPayload(4)) }] } }] }));
    } else if (req.url.endsWith('/responses')) {
      res.end(JSON.stringify({ status: 'completed', output_text: JSON.stringify(validPayload(4)) }));
    } else {
      const text = body.messages.map(m => typeof m.content === 'string' ? m.content : m.content[0]?.text || '').join('\n');
    const content = text.includes('评分标准编写助手')
      ? JSON.stringify({ question: 'Q', answer: 'A', items: [{ label: '第（1）问', maxScore: 4, criteria: '完整正确得4分。' }], warnings: [] })
      : JSON.stringify(validPayload(4));
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const parts = { system: 'SYSTEM_CONTRACT', user: 'USER_JSON_TASK' };
  const img = 'data:image/png;base64,AAAA';

  await requestModel({ protocol: 'chat', endpoint: base, apiKey: 'k', jsonMode: true }, 'm', parts, [img]);
  await requestModel({ protocol: 'responses', endpoint: base, apiKey: 'k', jsonMode: true }, 'm', parts, [img]);
  await requestModel({ protocol: 'gemini', endpoint: base, apiKey: 'k', jsonMode: true }, 'm', parts, [img]);
  await requestModel({ protocol: 'chat', endpoint: base, apiKey: 'k', jsonMode: false, mergeSystemPrompt: true }, 'm', parts, [img]);
  await requestModel({ protocol: 'gemini', endpoint: base, apiKey: 'k', jsonMode: false }, 'm', parts, [img]);

  assert.equal(bodies[0].body.messages.length, 2);
  assert.equal(bodies[0].body.messages[0].role, 'system');
  assert.equal(bodies[0].body.messages[0].content, 'SYSTEM_CONTRACT');
  assert.equal(bodies[0].body.messages[1].role, 'user');
  assert.equal(bodies[0].body.messages[1].content[0].text, 'USER_JSON_TASK');
  assert.deepEqual(bodies[0].body.response_format, { type: 'json_object' });

  assert.equal(bodies[1].body.instructions, 'SYSTEM_CONTRACT');
  assert.equal(bodies[1].body.input[0].role, 'user');
  assert.equal(bodies[1].body.input[0].content[0].text, 'USER_JSON_TASK');
  assert.deepEqual(bodies[1].body.text, { format: { type: 'json_object' } });

  assert.equal(bodies[2].body.systemInstruction.parts[0].text, 'SYSTEM_CONTRACT');
  assert.equal(bodies[2].body.contents[0].parts[0].text, 'USER_JSON_TASK');
  assert.equal(bodies[2].body.generationConfig.responseMimeType, 'application/json');

  assert.equal(bodies[3].body.messages.length, 1);
  assert.equal(bodies[3].body.messages[0].role, 'user');
  assert.match(bodies[3].body.messages[0].content[0].text, /^SYSTEM_CONTRACT\n\nUSER_JSON_TASK$/);
  assert.equal(bodies[3].body.response_format, undefined);

  assert.equal(bodies[4].body.generationConfig?.responseMimeType, undefined);
});

test('prompt caching stability: system stays byte-identical across retries, dual review and arbitration', async t => {
  const requests = [];
  let callIndex = 0;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    callIndex++;
    res.setHeader('Content-Type', 'application/json');
    let content;
    if (body.model === 'primary') {
      if (callIndex === 1) {
        content = 'not json';
      } else {
        content = JSON.stringify({
          ...validPayload(3),
          score: 4,
          scoringDetails: [{ id: 'scoring-item-question-1', label: '第（1）问', maxScore: 4, score: 3, studentAnswer: 'x=2', reason: '按严格标准扣1分' }]
        });
      }
    } else if (body.model === 'secondary') {
      content = JSON.stringify({
        ...validPayload(4),
        gradingMode: 'strict',
        scoringDetails: [{ id: 'scoring-item-question-1', label: '第（1）问', maxScore: 4, score: 4, studentAnswer: 'x=2', reason: '满分' }]
      });
    } else {
      content = JSON.stringify(validPayload(4));
    }
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const config = {
    workflowId: 'w',
    question: { text: '解方程', images: ['data:image/png;base64,QQ=='] },
    answer: 'x=2',
    rubric: '① 第（1）问：满分4分\n完整正确得4分。',
    scoring: { strictness: 'normal', maxScore: 4, units: [] }
  };
  const parts = promptPartsFor(config);
  assert.equal(parts.system, promptFor(config));
  assert.match(parts.user, /前 1 张/);
  assert.match(parts.user, /JSON/);

  const settings = {
    requestBudget: 8,
    providers: { p: { endpoint: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture' } },
    workflows: {
      w: {
        model: { provider: 'p', model: 'primary' },
        dualEval: {
          enabled: true,
          questionType: 'objective',
          secondary: { provider: 'p', model: 'secondary' },
          arbitration: { provider: 'p', model: 'arbiter' }
        }
      }
    }
  };
  const result = await grade(config, settings, ['data:image/png;base64,U1RV']);
  assert.equal(result.score, 4);
  assert.ok(requests.length >= 4);
  const firstSystem = requests[0].messages[0].content;
  assert.match(firstSystem, /双阅额外要求/);
  for (const req of requests) {
    assert.equal(req.messages[0].role, 'system');
    assert.equal(req.messages[0].content, firstSystem);
    assert.deepEqual(req.response_format, { type: 'json_object' });
  }
  const primaryRetryUser = requests.find((r, i) => i > 0 && r.model === 'primary').messages[1].content[0].text;
  assert.match(primaryRetryUser, /上一版不是完整合法的JSON/);
  const secondaryRetryUser = requests.filter(r => r.model === 'secondary').at(-1).messages[1].content[0].text;
  assert.match(secondaryRetryUser, /评分口径核验重试/);
  const arbiterUser = requests.find(r => r.model === 'arbiter').messages[1].content[0].text;
  assert.match(arbiterUser, /本次触发原因/);
});

test('HTTP 400/422 gracefully downgrades unsupported response_format and system role, but does not retry unrelated 400', async t => {
  let mode = 'reject_json';
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    bodies.push(body);
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'reject_json' && body.response_format) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: { message: 'Unsupported parameter: response_format json_object' } }));
      return;
    }
    if (mode === 'reject_system' && body.messages.some(m => m.role === 'system')) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: { message: 'system role is not supported for this model' } }));
      return;
    }
    if (mode === 'reject_both' && (body.response_format || body.messages.some(m => m.role === 'system'))) {
      res.writeHead(422);
      res.end(JSON.stringify({ error: { message: 'response_format is unsupported and system role not allowed' } }));
      return;
    }
    if (mode === 'bad_model') {
      res.writeHead(400);
      res.end(JSON.stringify({ error: { message: 'model not found: unknown' } }));
      return;
    }
    const text = body.messages.map(m => typeof m.content === 'string' ? m.content : m.content[0]?.text || '').join('\n');
    const content = text.includes('评分标准编写助手')
      ? JSON.stringify({ question: 'Q', answer: 'A', items: [{ label: '第（1）问', maxScore: 4, criteria: '完整正确得4分。' }], warnings: [] })
      : JSON.stringify(validPayload(4));
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const provider = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'k', jsonMode: true };
  const parts = { system: 'SYS', user: 'USR JSON' };

  resetModelCapabilityCache();
  bodies.length = 0;
  await requestModel(provider, 'm', parts, [], undefined, { remaining: 4 });
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0].response_format);
  assert.equal(bodies[1].response_format, undefined);
  assert.equal(bodies[1].messages[0].role, 'system');

  mode = 'reject_system';
  resetModelCapabilityCache();
  bodies.length = 0;
  await requestModel(provider, 'm', parts, [], undefined, { remaining: 4 });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].messages.length, 1);
  assert.equal(bodies[1].messages[0].role, 'user');
  assert.match(bodies[1].messages[0].content[0].text, /^SYS\n\nUSR JSON$/);
  assert.ok(bodies[1].response_format);

  mode = 'reject_both';
  resetModelCapabilityCache();
  bodies.length = 0;
  await requestModel(provider, 'm', parts, [], undefined, { remaining: 4 });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].response_format, undefined);
  assert.equal(bodies[1].messages.length, 1);

  // Subsequent call uses cached downgrade without probing 422 again
  bodies.length = 0;
  await requestModel(provider, 'm', parts, [], undefined, { remaining: 4 });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].response_format, undefined);
  assert.equal(bodies[0].messages.length, 1);

  mode = 'bad_model';
  bodies.length = 0;
  await assert.rejects(requestModel(provider, 'unknown', parts, [], undefined, { remaining: 4 }), /HTTP 400：model not found/);
  assert.equal(bodies.length, 1);

  // generateRubric also sends jsonMode by default unless disabled
  mode = 'reject_json';
  resetModelCapabilityCache();
  bodies.length = 0;
  const generated = await generateRubric(
    { providers: { p: { endpoint: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'k' } } },
    { version: 2, provider: 'p', model: 'm', subject: 'mathematics', strictness: 'normal', scoringMethod: 'auto', question: 'Q', answer: 'A', maxScore: 4 }
  );
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0].response_format, { type: 'json_object' });
  assert.equal(bodies[1].response_format, undefined);
  assert.match(generated.rubric, /满分4分/);
});

test('extractUsage handles OpenAI, DeepSeek, Responses and Gemini; grade aggregates usage and UI displays it', async t => {
  assert.deepEqual(
    extractUsage({ usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, prompt_tokens_details: { cached_tokens: 800 }, completion_tokens_details: { reasoning_tokens: 50 } } }, 'chat'),
    { inputTokens: 1000, outputTokens: 200, totalTokens: 1200, cachedTokens: 800, reasoningTokens: 50 }
  );
  assert.deepEqual(
    extractUsage({ usage: { prompt_tokens: 2000, completion_tokens: 300, prompt_cache_hit_tokens: 1800 } }, 'chat'),
    { inputTokens: 2000, outputTokens: 300, totalTokens: 2300, cachedTokens: 1800, reasoningTokens: 0 }
  );
  assert.deepEqual(
    extractUsage({ usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600, input_tokens_details: { cached_tokens: 400 }, output_tokens_details: { reasoning_tokens: 30 } } }, 'responses'),
    { inputTokens: 500, outputTokens: 100, totalTokens: 600, cachedTokens: 400, reasoningTokens: 30 }
  );
  assert.deepEqual(
    extractUsage({ usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 150, totalTokenCount: 1050, cachedContentTokenCount: 700, thoughtsTokenCount: 40 } }, 'gemini'),
    { inputTokens: 900, outputTokens: 150, totalTokens: 1050, cachedTokens: 700, reasoningTokens: 40 }
  );
  assert.equal(extractUsage({}, 'chat'), null);

  let callNum = 0;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    callNum++;
    res.setHeader('Content-Type', 'application/json');
    if (body.model === 'primary' && callNum === 1) {
      res.end(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: 'not json' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, prompt_tokens_details: { cached_tokens: 800 } }
      }));
      return;
    }
    res.end(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(validPayload(4)) } }],
      usage: { prompt_tokens: 1100, completion_tokens: 150, total_tokens: 1250, prompt_tokens_details: { cached_tokens: 1000 }, completion_tokens_details: { reasoning_tokens: 70 } }
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const config = {
    workflowId: 'w',
    answer: 'x=2',
    rubric: '① 第（1）问：满分4分\n完整正确得4分。',
    scoring: { maxScore: 4, units: [] }
  };
  const settings = {
    requestBudget: 6,
    providers: { p: { endpoint: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'k' } },
    workflows: { w: { model: { provider: 'p', model: 'primary' } } }
  };
  const single = await grade(config, settings, []);
  assert.deepEqual(single.usage, { calls: 2, inputTokens: 2100, outputTokens: 200, totalTokens: 2300, cachedTokens: 1800, reasoningTokens: 70 });
  assert.deepEqual(single.totalUsage, single.usage);

  // Verify UI renders usage cleanly when present and omits it when absent
  const browser = await launchBrowser({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('https://fixture.test/**', route => route.fulfill({
    contentType: route.request().url().match(/\.m?js$/) ? 'text/javascript' : 'text/html',
    body: route.request().url().match(/\.m?js$/)
      ? fs.readFileSync(new URL(`../ui${new URL(route.request().url()).pathname}`, import.meta.url), 'utf8')
      : '<!doctype html><div id="details"></div>'
  }));
  await page.goto('https://fixture.test/');
  await page.evaluate(async result => {
    const { renderResultDetails } = await import('/result-details.js');
    renderResultDetails(document.querySelector('#details'), { result }, false);
  }, single);
  const withUsage = await page.locator('#details').innerText();
  assert.match(withUsage, /模型用量/);
  assert.match(withUsage, /输入 2100（缓存命中 1800，86%）/);
  assert.match(withUsage, /输出 200（思考 70）/);
  assert.match(withUsage, /合计 2300 tokens（共 2 次请求）/);

  await page.evaluate(async () => {
    const { renderResultDetails } = await import('/result-details.js');
    renderResultDetails(document.querySelector('#details'), { result: { score: 4, subScores: [] } }, false);
  });
  const withoutUsage = await page.locator('#details').innerText();
  assert.doesNotMatch(withoutUsage, /模型用量/);
});

test('requestModel survives stacked 429, 500 and dual 400 downgrades within attempt bound', async t => {
  let step = 0;
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) {}
    step++;
    res.setHeader('Content-Type', 'application/json');
    if (step <= 2) {
      res.writeHead(429, { 'Retry-After': '0.05' });
      res.end(JSON.stringify({ error: { message: 'rate limit' } }));
      return;
    }
    if (step === 3) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: { message: 'upstream error' } }));
      return;
    }
    if (step === 4) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: { message: 'Unsupported parameter: response_format json_object' } }));
      return;
    }
    if (step === 5) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: { message: 'system role is not supported' } }));
      return;
    }
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"score":4}' } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  resetModelCapabilityCache();
  const provider = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'k', jsonMode: true, disableCapabilityCache: true };
  const text = await requestModel(provider, 'm', { system: 'SYS', user: 'USR' }, [], undefined, { remaining: 8 });
  assert.equal(step, 6);
  assert.equal(text, '{"score":4}');
});

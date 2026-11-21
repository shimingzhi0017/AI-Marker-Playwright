import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promptFor } from '../src/domain.mjs';
import { requestModel, resetModelCapabilityCache } from '../src/models.mjs';
import { auditGradingResult } from '../src/grading-policy-audit.mjs';
import { selectFewShotCorrections } from '../src/correction-feedback.mjs';
import { buildGoldenSet, configHash } from '../scripts/build-golden-set.mjs';
import { evaluateRecords, compareBenchmarkReports } from '../scripts/eval-benchmark.mjs';

const config = {
  question: 'Q', answer: 'x=2',
  rubric: '第（1）问：满分4分\n答案正确得4分。',
  scoring: { maxScore: 4, units: [{ label: '总分', maxScore: 4 }] }
};

test('scoring JSON example puts evidence and deductions before score at item and top level', () => {
  const prompt = promptFor(config);
  const example = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
  const itemKeys = Object.keys(example.scoringDetails[0]);
  assert.ok(itemKeys.indexOf('studentAnswer') < itemKeys.indexOf('score'));
  assert.ok(itemKeys.indexOf('reason') < itemKeys.indexOf('deductions'));
  assert.ok(itemKeys.indexOf('deductions') < itemKeys.indexOf('score'));
  const topKeys = Object.keys(example);
  assert.ok(topKeys.indexOf('scoringDetails') < topKeys.indexOf('comment'));
  assert.ok(topKeys.indexOf('comment') < topKeys.indexOf('score'));
  assert.match(prompt, /\{id,label,maxScore,studentAnswer,reason,deductions,score\}/u);
});

async function withServer(handler, fn) {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    handler(JSON.parse(raw), req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}/v1`); }
  finally { server.close(); }
}

const ok = res => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"score":1}' } }] }));
};

test('temperature is sent for chat, responses and gemini when configured', async () => {
  resetModelCapabilityCache();
  const bodies = [];
  await withServer((body, req, res) => {
    bodies.push({ url: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes(':generateContent')) res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"score":1}' }] } }] }));
    else if (req.url.endsWith('/responses')) res.end(JSON.stringify({ status: 'completed', output_text: '{"score":1}' }));
    else ok(res);
  }, async baseUrl => {
    for (const protocol of ['chat', 'responses', 'gemini']) {
      await requestModel({ endpoint: baseUrl, apiKey: 'k', protocol, temperature: 0, disableCapabilityCache: true }, 'm', 'hi', []);
    }
    await requestModel({ endpoint: baseUrl, apiKey: 'k', protocol: 'chat', disableCapabilityCache: true }, 'm', 'hi', []);
  });
  assert.equal(bodies[0].body.temperature, 0);
  assert.equal(bodies[1].body.temperature, 0);
  assert.equal(bodies[2].body.generationConfig.temperature, 0);
  assert.equal('temperature' in bodies[3].body, false);
});

test('rejected temperature is dropped, retried and remembered per model', async () => {
  resetModelCapabilityCache();
  const bodies = [];
  await withServer((body, req, res) => {
    bodies.push(body);
    if ('temperature' in body) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0 with this model." } }));
      return;
    }
    ok(res);
  }, async baseUrl => {
    const provider = { endpoint: baseUrl, apiKey: 'k', protocol: 'chat', temperature: 0 };
    assert.equal(await requestModel(provider, 'reasoner', 'hi', []), '{"score":1}');
    assert.equal(await requestModel(provider, 'reasoner', 'hi', []), '{"score":1}');
  });
  assert.deepEqual(bodies.map(body => 'temperature' in body), [true, false, false]);
});

test('structured deductions trigger policy and consistency audits even when prose avoids keywords', () => {
  const lenientCfg = {
    answer: 'x=2',
    rubric: '第（1）问：满分4分\n学科：物理。\n评分口径：宽松；给分方式为按要点／步骤给分。',
    scoring: { strictness: 'lenient', maxScore: 4, units: [] }
  };
  const policyHit = auditGradingResult(lenientCfg, {
    gradingMode: 'lenient',
    score: 3,
    comment: '第（1）问得3分。',
    scoringDetails: [{
      label: '第（1）问', maxScore: 4, score: 3, reason: '综合评定给3分。',
      deductions: [{ points: 1, category: 'minor_brevity', evidence: '跳步' }]
    }]
  });
  assert.ok(policyHit.policyIssues.some(i => /minor_brevity/.test(i)));

  const normalAllowed = auditGradingResult({ ...lenientCfg, scoring: { strictness: 'normal', maxScore: 4, units: [] } }, {
    gradingMode: 'normal',
    score: 3,
    comment: '第（1）问得3分。',
    scoringDetails: [{
      label: '第（1）问', maxScore: 4, score: 3, reason: '缺核心方程。',
      deductions: [{ points: 1, category: 'missing_key_step', evidence: '未列牛顿第二定律' }]
    }]
  });
  assert.deepEqual(normalAllowed.issues, []);

  const sumMismatch = auditGradingResult(lenientCfg, {
    gradingMode: 'lenient',
    score: 3,
    comment: '第（1）问得3分。',
    scoringDetails: [{
      label: '第（1）问', maxScore: 4, score: 3, reason: '数值算错。',
      deductions: [{ points: 2, category: 'substantive', evidence: '算错' }]
    }]
  });
  assert.ok(sumMismatch.consistencyIssues.some(i => /满分4分减扣分合计2分不等于得分3分/.test(i)));
});

test('few-shot corrections deduplicate by reason, rank by frequency, and render into prompt', () => {
  const records = [
    { id: '1', presetName: 'P', time: '2026-11-20T01:00:00Z', originalResult: { score: 2, studentAnswer: 'v=20-4t, x=50m' }, result: { score: 4, studentAnswer: 'v=20-4t, x=50m' }, correctionReason: '简写已体现减速，给满分' },
    { id: '2', presetName: 'P', time: '2026-11-20T02:00:00Z', originalResult: { score: 2, studentAnswer: 'v=20-4t => t=5s' }, result: { score: 4, studentAnswer: 'v=20-4t => t=5s' }, correctionReason: '简写已体现减速，给满分' },
    { id: '3', presetName: 'P', time: '2026-11-20T03:00:00Z', originalResult: { score: 4, studentAnswer: 'x=55m' }, result: { score: 1, studentAnswer: 'x=55m' }, correctionReason: '未判断停车时刻，后段结果不给分' },
    { id: '4', presetName: 'P', time: '2026-11-20T04:00:00Z', originalResult: { score: 3, studentAnswer: 'x=50m' }, result: { score: 3, studentAnswer: 'x=50m' }, correctionReason: '教师在界面修改' }
  ];
  const examples = selectFewShotCorrections(records, 'P', { limit: 3 });
  assert.equal(examples.length, 2);
  assert.equal(examples[0].reason, '简写已体现减速，给满分');
  assert.equal(examples[1].reason, '未判断停车时刻，后段结果不给分');
  const prompt = promptFor({ ...config, calibrationExamples: examples });
  assert.match(prompt, /【教师改分校准示例/);
  assert.match(prompt, /模型原判2分→教师改判4分/);
});

test('golden set freezes confirmed records and benchmark computes retry, stability, groups and deltas', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-test-'));
  try {
    const imgPath = path.join(tmp, 'ans.bin');
    fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const presetCfg = {
      answer: 'x=2',
      rubric: '第（1）问：满分4分\n学科：物理。\n评分口径：宽松。',
      scoring: { strictness: 'lenient', maxScore: 4, units: [] }
    };
    const records = [
      { id: 'ok-1', presetName: 'P', state: 'submitted', mode: 'trial', configHash: configHash(presetCfg), imageFiles: [imgPath], originalResult: { score: 3 }, result: { score: 4 }, correctionReason: '有效简写给满分' },
      { id: 'skip-unattended', presetName: 'P', state: 'submitted', mode: 'unattended', configHash: configHash(presetCfg), imageFiles: [imgPath], result: { score: 4 } },
      { id: 'skip-drift', presetName: 'P', state: 'submitted', mode: 'trial', configHash: 'old-hash', imageFiles: [imgPath], result: { score: 4 } }
    ];
    const { stats } = buildGoldenSet({ records, presets: { P: presetCfg }, outDir: path.join(tmp, 'out') });
    assert.equal(stats.exported, 1);
    assert.equal(stats.unconfirmed, 1);
    assert.equal(stats.configDrift, 1);

    const baseReport = evaluateRecords([
      { id: 'c1#1', caseId: 'c1', presetName: 'P', config: presetCfg, expectedScore: 4, result: { score: 3, usage: { calls: 2 } } },
      { id: 'c1#2', caseId: 'c1', presetName: 'P', config: presetCfg, expectedScore: 4, result: { score: 4, usage: { calls: 1 } } }
    ]);
    const currReport = evaluateRecords([
      { id: 'c1#1', caseId: 'c1', presetName: 'P', config: presetCfg, expectedScore: 4, result: { score: 4, usage: { calls: 1 } } },
      { id: 'c1#2', caseId: 'c1', presetName: 'P', config: presetCfg, expectedScore: 4, result: { score: 4, usage: { calls: 1 } } }
    ]);
    assert.equal(baseReport.retries.retryRate, 0.5);
    assert.equal(baseReport.stability.identicalScoreRate, 0);
    assert.equal(currReport.stability.identicalScoreRate, 1);
    const cmp = compareBenchmarkReports(baseReport, currReport);
    assert.equal(cmp.exactMatchRateDelta, 0.5);
    assert.equal(cmp.maeDelta, -0.5);
    assert.equal(cmp.retryRateDelta, -0.5);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

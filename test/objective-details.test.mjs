import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { grade } from '../src/models.mjs';

test('单总分框客观双阅逐项比较，任意分歧或缺失必须仲裁', async t => {
  const config = { answer: 'fixture', rubric: 'part-1: 5; part-2: 5', workflowId: 'w', scoring: { units: [{ label: '12', maxScore: 10 }] } };
  const response = scores => ({ score: scores.reduce((a, b) => a + b, 0), studentAnswer: 'fixture', comment: 'fixture', subScores: [{ label: '12', score: scores.reduce((a, b) => a + b, 0) }], scoringDetails: scores.map((score, i) => ({ label: `part-${i + 1}`, score })) });
  let replies, calls;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); calls.push(request.model);
    assert.match(request.messages[0].content[0].text, /scoringDetails/);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(replies[request.model]) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const entry = model => ({ provider: 'local', model });
  const settings = { providers: { local: { endpoint: `http://127.0.0.1:${server.address().port}`, apiKey: 'fixture' } }, workflows: { w: { model: entry('A'), dualEval: { enabled: true, questionType: 'objective', threshold: 99, secondary: entry('B'), arbitration: entry('C') } } } };
  const scenarios = [
    { a: response([1, 3]), b: response([2, 2]), expected: 'arbitration' },
    { a: response([1, 3]), b: response([1, 2]), expected: 'arbitration' },
    { a: response([0, 0]), b: response([0, 0]), expected: 'consensus' },
    { a: response([1, 3]), b: response([1, 3]), expected: 'consensus' },
    { a: response([1, 3]), b: { ...response([1, 3]), scoringDetails: undefined }, expected: 'arbitration' },
    { a: { ...response([1, 3]), scoringDetails: undefined }, b: { ...response([1, 3]), scoringDetails: undefined }, expected: 'arbitration' },
    { a: response([1, 3]), b: { ...response([1, 3]), scoringDetails: [{ label: 'different', score: 1 }, { label: 'part-2', score: 3 }] }, expected: 'arbitration' },
  ];
  for (const scenario of scenarios) {
    calls = []; replies = { A: scenario.a, B: scenario.b, C: response([2, 3]) };
    const result = await grade(config, settings, [], new AbortController().signal);
    assert.equal(result.dualEval.result, scenario.expected);
    assert.equal(calls.includes('C'), scenario.expected === 'arbitration');
    if (scenario.expected === 'arbitration') { assert.equal(result.score, 5); assert.deepEqual(result.subScores, [{ label: '12', score: 5 }]); }
  }
  calls = []; replies = { A: response([1, 3]), B: response([2, 2]), C: { ...response([2, 3]), scoringDetails: undefined } };
  await assert.rejects(grade(config, settings, [], new AbortController().signal), /仲裁模型未返回逐项/);
  calls = []; replies = { A: { ...response([1, 3]), score: 5, subScores: [{ label: '12', score: 5 }] }, B: response([2, 2]), C: response([2, 3]) };
  await assert.rejects(grade(config, settings, [], new AbortController().signal), /合计/);
  assert.equal(calls.includes('C'), false);
});

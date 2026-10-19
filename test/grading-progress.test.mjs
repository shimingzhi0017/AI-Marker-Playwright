import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {grade} from '../src/models.mjs';

test('双阅单路失败立即结束并取消另一请求；整份超时有明确记录；各角色进度可见',async t=>{
  let mode='failure';const sockets=new Set();
  const result={score:2,studentAnswer:'fixture',comment:'fixture',subScores:[],scoringDetails:[{label:'评分点',score:2,maxScore:2}],recognition:{status:'clear',coverageChecked:true,notes:[],issues:[]}};
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;const model=JSON.parse(body).model;
    if(mode==='failure'&&model==='primary'){res.writeHead(401);res.end('{}');return;}
    if(mode!=='success')return;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}));
  });server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{for(const s of sockets)s.destroy();return new Promise(resolve=>server.close(resolve));});
  const config={answer:'fixture',rubric:'评分点：2分',workflowId:'w',scoring:{maxScore:2}};
  const settings={gradingTimeoutMs:1000,providers:{p:{endpoint:`http://127.0.0.1:${server.address().port}`,apiKey:'fixture'}},workflows:{w:{model:{provider:'p',model:'primary'},dualEval:{enabled:true,secondary:{provider:'p',model:'secondary'},arbitration:{provider:'p',model:'arbitration'}}}}};
  const events=[];const start=Date.now();
  await assert.rejects(grade(config,settings,[],undefined,e=>events.push(e)),/401/);
  assert.ok(Date.now()-start<700);assert.ok(events.some(e=>e.role==='主评'&&e.status==='failed'));assert.ok(events.some(e=>e.role==='复评'&&e.status==='requesting'));
  mode='hang';settings.gradingTimeoutMs=100;
  await assert.rejects(grade(config,settings,[]),error=>error.modelRequestFailure?.type==='整份评分超时');
  mode='success';settings.gradingTimeoutMs=1000;events.length=0;
  const final=await grade(config,settings,[],undefined,e=>events.push(e));assert.equal(final.score,2);assert.equal(final.dualEval.result,'consensus');
  assert.ok(events.some(e=>e.role==='主评'&&e.status==='completed'));assert.ok(events.some(e=>e.role==='复评'&&e.status==='completed'));
});

test('模型偶发返回坏JSON时只自动重试一次并继续评分', async t => {
  let calls = 0;
  const result = { score: 2, studentAnswer: 'fixture', comment: 'fixture', subScores: [], scoringDetails: [{ label: '评分点', score: 2, maxScore: 2 }], recognition: { status: 'clear', coverageChecked: true, notes: [], issues: [] } };
  const server = http.createServer(async (req, res) => {
    calls++;
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    const content = calls === 1 ? '模型暂时没有按要求输出JSON' : JSON.stringify(result);
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = { answer: 'fixture', rubric: '评分点：2分', workflowId: 'w', scoring: { maxScore: 2 } };
  const settings = { gradingTimeoutMs: 1000, requestBudget: 3, providers: { p: { endpoint: `http://127.0.0.1:${server.address().port}`, apiKey: 'fixture' } }, workflows: { w: { model: { provider: 'p', model: 'primary' }, dualEval: { enabled: false } } } };
  const events = [];
  const graded = await grade(config, settings, [], undefined, event => events.push(event));
  assert.equal(graded.score, 2);
  assert.equal(calls, 2);
  assert.ok(events.some(event => event.status === 'retrying'));
});

test('单次请求超时可在整份评分期限内重试；鉴权失败不重试', async t => {
  let mode = 'timeout', calls = 0;
  const result = { score: 2, studentAnswer: 'fixture', comment: 'fixture', subScores: [], scoringDetails: [{ label: '评分点', score: 2, maxScore: 2 }], recognition: { status: 'clear', coverageChecked: true, notes: [], issues: [] } };
  const server = http.createServer(async (req, res) => {
    calls++;
    let body = ''; for await (const chunk of req) body += chunk;
    if (mode === 'timeout' && calls === 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!res.destroyed && !res.writableEnded) res.end('{}');
      return;
    }
    if (mode === 'unauthorized') { res.writeHead(401); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = { answer: 'fixture', rubric: '评分点：2分', workflowId: 'w', scoring: { maxScore: 2 } };
  const settings = { gradingTimeoutMs: 1000, requestBudget: 3, providers: { p: { endpoint: `http://127.0.0.1:${server.address().port}`, apiKey: 'fixture', timeoutMs: 30 } }, workflows: { w: { model: { provider: 'p', model: 'primary' }, dualEval: { enabled: false } } } };
  const graded = await grade(config, settings, []);
  assert.equal(graded.score, 2);
  assert.equal(calls, 2);

  mode = 'unauthorized'; calls = 0;
  await assert.rejects(grade(config, settings, []), /HTTP 401/);
  assert.equal(calls, 1);
});

test('双评逐项一致时可交叉验证并解除冗余总分字段修正的人工拦截', async t => {
  const scores = [2, 3, 2, 1, 1, 0, 0];
  const maximums = [2, 3, 2, 1, 3, 3, 3];
  const rubric = '第（1）问：甲队报价：满分8分\n1. 正确列式，得2分。2. 正确求最小值，得3分。3. 得到等号条件，得2分。4. 写出结论，得1分。\n\n第（2）问：乙队参数：满分9分\n1. 建立不等式，得3分。2. 证明下界，得3分。3. 得出范围，得3分。';
  const replies = {
    primary: { score: 9, studentAnswer: 'fixture', comment: 'fixture', subScores: [], scoringDetails: scores.map((score, i) => ({ label: `第${i < 4 ? '（1）' : '（2）'}问第${i < 4 ? i + 1 : i - 3}点`, score, maxScore: maximums[i] })), recognition: { status: 'clear', coverageChecked: true, notes: [], issues: [] } },
    secondary: { score: 12, studentAnswer: 'fixture', comment: 'fixture', subScores: [], scoringDetails: scores.map((score, i) => ({ label: `第${i < 4 ? '（1）' : '（2）'}问第${i < 4 ? i + 1 : i - 3}点`, score, maxScore: maximums[i] })), recognition: { status: 'clear', coverageChecked: true, notes: [], issues: [] } }
  };
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const model = JSON.parse(body).model;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(replies[model]) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = { answer: 'fixture', rubric, workflowId: 'w', scoring: { maxScore: 17 } };
  const entry = model => ({ provider: 'p', model });
  const settings = { requestBudget: 6, providers: { p: { endpoint: `http://127.0.0.1:${server.address().port}`, apiKey: 'fixture' } }, workflows: { w: { model: entry('primary'), dualEval: { enabled: true, questionType: 'subjective', threshold: 2, secondary: entry('secondary'), arbitration: entry('arbitration') } } } };
  const graded = await grade(config, settings, []);
  assert.equal(graded.score, 9);
  assert.equal(graded.dualEval.result, 'average');
  assert.equal(graded.dualEval.b.reportedScore, 12);
  assert.equal(graded.scoringDetails.reduce((sum, item) => sum + item.score, 0), 9);
  assert.equal(graded.formatWarning, undefined);
  assert.match(graded.formatNote, /逐项核对一致/);

  replies.secondary = { ...replies.secondary, scoringDetails: replies.secondary.scoringDetails.map((item, i) => i === 0 ? { ...item, score: 0 } : i === 4 ? { ...item, score: 3 } : item) };
  const inconsistent = await grade(config, settings, []);
  assert.ok(inconsistent.formatWarning);
  assert.equal(inconsistent.formatNote, undefined);
});

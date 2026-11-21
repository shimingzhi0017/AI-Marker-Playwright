import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {parseResult,scoringItemSchema} from '../src/domain.mjs';
import {grade} from '../src/models.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/scoring-duplicate-item.json',import.meta.url),'utf8'));
const complete=()=>({...structuredClone(fixture.value),scoringDetails:structuredClone(fixture.value.scoringDetails.slice(0,3))});

test('real failed response: an invented fourth ID repeats the third item verbatim',()=>{
  const result=parseResult(JSON.stringify(fixture.value),fixture.config);
  assert.equal(result.score,10);
  assert.deepEqual(result.scoringDetails.map(d=>d.score),[3,3,4]);
  assert.equal(result.scoringDetails.length,3);
  assert.equal(result.formatWarning,undefined);
  assert.match(result.formatNote,/去重/);
  assert.equal(result.scoringNormalization.removedItems[0].id,'scoring-item-4');
  assert.equal(fixture.value.scoringDetails.length,4);
});

for(const count of [1,2,3,5,8,13]) {
  test(`exact duplicate recovery uses the current schema with ${count} items`,()=>{
    const config={rubric:Array.from({length:count},(_,i)=>`项目${i+1}：满分2分`).join('\n'),scoring:{maxScore:count*2,roundStep:1}};
    const details=scoringItemSchema(config).map(item=>({...item,score:1,studentAnswer:'实际作答',reason:'对应方法分1分'}));
    const duplicate={...details.at(-1),id:'invented-duplicate'};
    const value={score:count,subScores:[],scoringDetails:[duplicate,...details,structuredClone(details[0])]};
    const result=parseResult(JSON.stringify(value),config);
    assert.equal(result.scoringDetails.length,count);
    assert.equal(result.score,count);
    assert.equal(result.scoringNormalization.removedItems.length,2);
    assert.equal(result.formatWarning,undefined);
  });
}

for(const field of ['score','maxScore','reason','studentAnswer','label']) {
  test(`an extra item with conflicting ${field} cannot be silently removed`,()=>{
    const value=structuredClone(fixture.value);
    value.scoringDetails[3][field]=field==='score'?3:field==='maxScore'?5:'与原项不同的内容';
    assert.throws(()=>parseResult(JSON.stringify(value),fixture.config),error=>
      error.code==='MODEL_SCORING_SCHEMA'&&error.scoringDiagnostics.receivedCount===4);
  });
}

test('missing a valid ID cannot be repaired by an unknown duplicate ID',()=>{
  const value=structuredClone(fixture.value);value.scoringDetails.splice(2,1);
  assert.throws(()=>parseResult(JSON.stringify(value),fixture.config),/编号/);
});

test('an extra zero-mark item or conflicting valid ID is still rejected',()=>{
  const value=complete();value.scoringDetails.push({id:'unknown',label:'额外评分点',maxScore:1,score:0});
  assert.throws(()=>parseResult(JSON.stringify(value),fixture.config),/实际返回4项/);
  value.scoringDetails[3]={...value.scoringDetails[2],id:value.scoringDetails[0].id};
  assert.throws(()=>parseResult(JSON.stringify(value),fixture.config),/评分项/);
});

test('deduplication does not disable total, increment or score-bound checks',()=>{
  const value=structuredClone(fixture.value);value.score=9;
  assert.match(parseResult(JSON.stringify(value),fixture.config).formatWarning,/人工确认/);
  const fractional=structuredClone(fixture.value);fractional.scoringDetails[0].score=2.5;
  assert.throws(()=>parseResult(JSON.stringify(fractional),fixture.config),/步长/);
  const overflow=structuredClone(fixture.value);overflow.scoringDetails[0].score=4;
  assert.throws(()=>parseResult(JSON.stringify(overflow),fixture.config),/越界/);
});

function settings(dual=true,requestBudget=6) {
  const entry=model=>({provider:'test',model});
  return {requestBudget,providers:{test:{endpoint:'https://model.invalid/v1',apiKey:'fixture'}},
    workflows:{test:{model:entry('primary'),dualEval:{enabled:dual,questionType:'objective',secondary:entry('secondary'),arbitration:entry('arbiter')}}}};
}
function reply(value) {
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
}

test('real duplicate output completes dual review without a retry or arbitration',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    const body=JSON.parse(init.body);calls.push(body.model);
    return reply(body.model==='secondary'?fixture.value:complete());
  });
  const result=await grade(fixture.config,settings(),[]);
  assert.equal(result.score,10);assert.equal(result.dualEval.result,'consensus');
  assert.deepEqual(calls,['primary','secondary']);
  assert.equal(result.dualEval.b.scoringNormalization.type,'duplicate-scoring-items');
});

test('a true missing item gets the actual prior items and exact schema in its retry',async t=>{
  const prompts=[];
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    const body=JSON.parse(init.body);prompts.push(body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='text').map(p=>p.text):[m.content]).join('\n'));
    const value=complete();if(prompts.length===1)value.scoringDetails.pop();return reply(value);
  });
  const result=await grade(fixture.config,settings(false),[]);
  assert.equal(result.score,10);assert.equal(prompts.length,2);
  assert.match(prompts[1],/标准要求3项，上一版实际返回2项/);
  assert.match(prompts[1],/"missingIds":\["scoring-item-3"\]/);
  assert.match(prompts[1],/不得凭总分补造/);
});

test('persistent invalid review output falls back to an independent arbiter, never an average',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    const body=JSON.parse(init.body);calls.push(body.model);const value=complete();
    if(body.model==='secondary')value.scoringDetails.pop();
    if(body.model==='arbiter'){value.scoringDetails[1].score=2;value.scoringDetails[1].reason='局部计算偏差扣1分，得2分。';value.score=9;value.comment='第（2）问得2分，总分：9分。';}
    return reply(value);
  });
  const result=await grade(fixture.config,settings(),[]);
  assert.equal(calls.filter(m=>m==='secondary').length,2);
  assert.equal(calls.filter(m=>m==='arbiter').length,1);
  assert.equal(result.score,9);assert.equal(result.formatWarning,undefined);
  assert.equal(result.dualEval.result,'arbitration');
  assert.equal(result.dualEval.b.score,undefined);
  assert.equal(result.dualEval.b.outputFailure.diagnostics.receivedCount,2);
  assert.ok(result.dualEval.b.rawResponse);
});

test('single review structural failure can also use its configured arbiter',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    const body=JSON.parse(init.body);calls.push(body.model);const value=complete();
    if(body.model==='primary')value.scoringDetails.pop();return reply(value);
  });
  const result=await grade(fixture.config,settings(false),[]);
  assert.deepEqual(calls,['primary','primary','arbiter']);
  assert.equal(result.score,10);assert.ok(result.dualEval.a.outputFailure);
});

test('invalid arbitration remains an error instead of inventing missing marks',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    const body=JSON.parse(init.body);calls.push(body.model);const value=complete();
    if(body.model!=='primary')value.scoringDetails.pop();return reply(value);
  });
  await assert.rejects(grade(fixture.config,settings(),[]),error=>error.code==='MODEL_SCORING_SCHEMA');
  assert.equal(calls.filter(m=>m==='arbiter').length,2);assert.equal(calls.length,5);
});

test('request budget is still enforced for structural recovery',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;const value=complete();value.scoringDetails.pop();return reply(value);});
  await assert.rejects(grade(fixture.config,settings(false,2),[]),/评分项不完整/);
  assert.equal(calls,2);
});

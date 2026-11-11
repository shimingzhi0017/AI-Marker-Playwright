import assert from 'node:assert/strict';
import test from 'node:test';
import { parseResult, recognitionWarning, scoringItemSchema, promptFor } from '../src/domain.mjs';
import { grade } from '../src/models.mjs';
import { rubricPolicy } from '../ui/rubric-prompts.js';

const config = {
  workflowId: 'test', answer: '参考答案', rubric: '按五项评分，满分十分。',
  scoring: { maxScore: 10, units: [{ label: '13', maxScore: 10 }], roundStep: 1 }
};
function response() {
  return {
    score: 8, subScores: [], studentAnswer: '部分内容无法辨认',
    recognition: { status: 'uncertain', coverageChecked: true, notes: [], issues: [
      { location: '水平运动方程', observed: '涂改重叠', reason: '符号无法辨认', affectsScore: true, impactReason: '可能影响一分' }
    ] },
    scoringDetails: [
      { label: '时间', score: 2, maxScore: 3 },
      { label: '位移', score: 0, maxScore: 2 },
      { label: '水平速度', score: 1, maxScore: 2 },
      { label: '竖直速度', score: 1, maxScore: 1 },
      { label: '速度合成', score: 2, maxScore: 2 }
    ]
  };
}
const parse = value => parseResult(JSON.stringify(value), config);

test('complete maxima allow total repair without a fixed rubric schema', () => {
  const result = parse(response());
  assert.equal(result.score, 6);
  assert.equal(result.reportedScore, 8);
  assert.deepEqual(result.subScores, [{ label: '13', score: 6 }]);
  assert.match(result.formatWarning, /人工确认/);
  assert.match(recognitionWarning(result), /书写识别存疑/);
});

test('incomplete maxima do not allow a total repair', () => {
  const value = response(); value.scoringDetails.pop();
  assert.throws(() => parse(value), /合计不一致/);
});

test('missing maxima and scores above item maxima are rejected', () => {
  const missing = response(); delete missing.scoringDetails[0].maxScore;
  assert.throws(() => parse(missing), /合计不一致/);
  const excessive = response(); excessive.scoringDetails[1].score = 3;
  assert.throws(() => parse(excessive), /明细无效/);
});

test('duplicate labels and conflicting webpage totals are rejected', () => {
  const duplicate = response(); duplicate.scoringDetails[1].label = '时间';
  assert.throws(() => parse(duplicate), /明细无效/);
  const conflict = response(); conflict.subScores = [{ label: '13', score: 8 }];
  assert.throws(() => parse(conflict), /合计不一致/);
});

test('score increments and total bounds still apply after repair', () => {
  const fractional = response(); fractional.scoringDetails[0].score = 1.5;
  assert.throws(() => parse(fractional), /步长/);
  const excessive = response(); excessive.score = 11;
  assert.throws(() => parse(excessive), /合计不一致|越界/);
});

test('multiple webpage units are not inferred from item totals', () => {
  assert.throws(() => parseResult(JSON.stringify(response()), {
    ...config, scoring: { ...config.scoring, units: [{ label: 'a', maxScore: 5 }, { label: 'b', maxScore: 5 }] }
  }), /合计不一致/);
});

test('a repaired total triggers independent arbitration even when both reviews agree', async t => {
  const calls = [];
  const clear = { status: 'clear', coverageChecked: true, notes: [], issues: [] };
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body.model);
    const value = response(); value.recognition = clear;
    if (body.model === 'arbiter') {
      value.score = 7; value.scoringDetails[0].score = 3;
      value.subScores = [{ label: '13', score: 7 }];
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
  });
  const entry = model => ({ provider: 'test', model });
  const result = await grade(config, {
    providers: { test: { endpoint: 'https://model.invalid/v1', apiKey: 'test' } },
    workflows: { test: { model: entry('primary'), dualEval: {
      enabled: true, questionType: 'objective', secondary: entry('secondary'), arbitration: entry('arbiter')
    } } }
  }, []);
  assert.deepEqual(calls, ['primary', 'secondary', 'arbiter']);
  assert.equal(result.score, 7);
  assert.equal(result.dualEval.result, 'arbitration');
  assert.equal(result.formatWarning, undefined);
});

function dynamicCase(count) {
  const items=Array.from({length:count},(_,i)=>({label:`第（${i+1}）问：评分点`,maxScore:i%3+1,score:i%3}));
  const maximum=items.reduce((sum,item)=>sum+item.maxScore,0);
  const sum=items.reduce((sum,item)=>sum+item.score,0);
  return {
    sum, items,
    config:{...config,rubric:items.map(item=>`${item.label}：满分${item.maxScore}分\n按该项标准评分。`).join('\n\n'),scoring:{...config.scoring,maxScore:maximum,units:[{label:'总分',maxScore:maximum}]}},
    value:{...response(),score:sum+1,subScores:[{label:'总分',score:sum+1}],scoringDetails:items}
  };
}

for(const count of [1,2,3,5,8,13]) {
  test(`rubric items and totals are derived dynamically for ${count} items`,()=>{
    const sample=dynamicCase(count);
    const schema=scoringItemSchema(sample.config);
    assert.equal(schema.length,count);
    assert.deepEqual(schema.map(item=>item.maxScore),sample.items.map(item=>item.maxScore));
    const result=parseResult(JSON.stringify(sample.value),sample.config);
    assert.equal(result.score,sample.sum);
    assert.deepEqual(result.scoringDetails.map(item=>item.score),sample.items.map(item=>item.score));
    assert.equal(result.subScores[0].score,sample.sum);
    assert.match(result.formatWarning,/人工确认/);
    const prompt=promptFor(sample.config);
    assert.ok(prompt.indexOf('"scoringDetails"')<prompt.lastIndexOf('"score":0,"comment"'));
  });
}

test('a correct detail sum fills an omitted single total field',()=>{
  const sample=dynamicCase(3); sample.value.score=sample.sum; delete sample.value.subScores;
  const result=parseResult(JSON.stringify(sample.value),sample.config);
  assert.equal(result.score,sample.sum);
  assert.deepEqual(result.subScores,[{label:'总分',score:sample.sum}]);
  assert.equal(result.formatWarning,undefined);
});

test('a conflicting redundant webpage total retains an explicit warning',()=>{
  const sample=dynamicCase(3); sample.value.score=sample.sum;
  const result=parseResult(JSON.stringify(sample.value),sample.config);
  assert.equal(result.score,sample.sum);
  assert.match(result.formatWarning,/模型网页总分字段/);
  assert.equal(result.reportedSubScores[0].score,sample.sum+1);
});

test('fixed schemas still reject omissions, duplicate ids, and individual score overflow',()=>{
  for(const change of [v=>v.scoringDetails.pop(),v=>{v.scoringDetails[0].score=2;},v=>{v.scoringDetails.forEach(d=>d.id='scoring-item-1');}]){
    const sample=dynamicCase(3); change(sample.value);
    assert.throws(()=>parseResult(JSON.stringify(sample.value),sample.config),/评分项|明细无效/);
  }
});

test('numeric string item maxima are normalized without changing awarded scores',()=>{
  const value=response(); value.scoringDetails.forEach(item=>{item.score=String(item.score);item.maxScore=String(item.maxScore);});
  assert.equal(parse(value).score,6);
});

for(const count of [2,4,7]) {
  test(`complete webpage fields define the total for ${count} units`,()=>{
    const units=Array.from({length:count},(_,i)=>({label:`小题${i+1}`,maxScore:2}));
    const settings={...config,scoring:{...config.scoring,units}};
    const value={score:count+1,subScores:units.map(u=>({label:u.label,score:1}))};
    const result=parseResult(JSON.stringify(value),settings);
    assert.equal(result.score,count);
    assert.equal(result.reportedScore,count+1);
    assert.deepEqual(result.subScores,value.subScores);
    assert.match(result.formatWarning,/人工确认/);
  });
}

test('multiple webpage fields cannot override contradictory detailed awards',()=>{
  const settings={...config,scoring:{...config.scoring,units:[{label:'甲',maxScore:5},{label:'乙',maxScore:5}]}};
  const value=response(); value.subScores=[{label:'甲',score:4},{label:'乙',score:4}];
  assert.throws(()=>parseResult(JSON.stringify(value),settings),/合计不一致/);
});

test('a retry includes actual previous structured awards and their computed sum',async t=>{
  const prompts=[];
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    const body=JSON.parse(init.body);prompts.push(body.messages[0].content[0].text);
    const value=response();
    // Neither a schema nor complete item maxima: require a model correction.
    delete value.scoringDetails[0].maxScore;
    if(prompts.length===2){value.score=6;value.subScores=[{label:'13',score:6}];}
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
  });
  const result=await grade(config,{
    providers:{test:{endpoint:'https://model.invalid/v1',apiKey:'test'}},
    workflows:{test:{model:{provider:'test',model:'primary'}}}
  },[]);
  assert.equal(result.score,6);
  assert.equal(prompts.length,2);
  assert.match(prompts[1],/"computedDetailSum":6/);
  assert.match(prompts[1],/"score":8/);
});

test('decimal awards and arbitrary full marks obey the configured increment',()=>{
  const settings={...config,scoring:{maxScore:4.5,roundStep:0.5,units:[]}};
  const value={score:4,subScores:[],scoringDetails:[
    {label:'方法',maxScore:1.5,score:0.5},{label:'结果',maxScore:3,score:2}
  ]};
  const result=parseResult(JSON.stringify(value),settings);
  assert.equal(result.score,2.5);
  assert.deepEqual(result.subScores,[]);
  assert.equal(result.reportedScore,4);
});

test('multiple field and rubric detail sums must independently agree before repair',()=>{
  const settings={...config,scoring:{...config.scoring,units:[{label:'甲',maxScore:5},{label:'乙',maxScore:5}]}};
  const value=response(); value.subScores=[{label:'甲',score:3},{label:'乙',score:3}];
  const result=parseResult(JSON.stringify(value),settings);
  assert.equal(result.score,6);
  assert.deepEqual(result.subScores,value.subScores);
  value.subScores[0].label='不存在的题号';
  assert.throws(()=>parseResult(JSON.stringify(value),settings),/评分单元/);
});

test('same constructed-response question criteria collapse into one top-level score',()=>{
  const rubric=`第（1）问 竖直运动规律与飞行时间：满分4分
列出正确模型得1分；列式得1分；求得时间得1分；单位正确得1分。

第（2）问 位移几何关系：满分1分
关系正确得1分。

第（2）问 水平运动方程与水平速度：满分2分
方程得1分；速度结果得1分。

第（2）问 竖直速度关系：满分1分
关系正确得1分。

第（2）问 着陆速度合成与结论：满分2分
合成关系得1分；结论得1分。

全题合计10分。`;
  const schema=scoringItemSchema({rubric,scoring:{maxScore:10}});
  assert.deepEqual(schema.map(item=>[item.label,item.maxScore]),[['第（1）问',4],['第（2）问',6]]);
});

test('separate objective blanks remain separate even under the same question number',()=>{
  const rubric=`第（1）问第1空：满分1分
答案正确得1分。

第（1）问第2空：满分1分
答案正确得1分。

全题合计2分。`;
  const schema=scoringItemSchema({rubric,scoring:{maxScore:2}});
  assert.deepEqual(schema.map(item=>item.maxScore),[1,1]);
});

test('scoring guidance recognizes equivalent valid science methods',()=>{
  const rules=rubricPolicy({subject:'physics',scoringMethod:'points'});
  assert.match(rules,/等价解法/);
  assert.match(rules,/不得仅因解法不同于参考答案而扣分/);
  assert.match(rules,/指定方法/);
  const prompt=promptFor({...config,rubric:'第（1）问：满分10分\n按有效方法给步骤分。'});
  assert.match(prompt,/先独立核验该方法/);
  assert.match(prompt,/题目明确要求特定方法/);
});

test('a repaired arbitration total is retained for human confirmation',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    calls.push(JSON.parse(init.body).model);
    const value=response();value.recognition={status:'clear',coverageChecked:true,notes:[],issues:[]};
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
  });
  const entry=model=>({provider:'test',model});
  const result=await grade(config,{
    providers:{test:{endpoint:'https://model.invalid/v1',apiKey:'test'}},
    workflows:{test:{model:entry('primary'),dualEval:{enabled:true,questionType:'objective',secondary:entry('secondary'),arbitration:entry('arbiter')}}}
  },[]);
  assert.deepEqual(calls,['primary','secondary','arbiter']);
  assert.equal(result.score,6);
  assert.match(result.formatWarning,/人工确认/);
});

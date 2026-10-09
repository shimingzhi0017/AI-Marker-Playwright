import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoringItemSchema,promptFor,parseResult} from '../src/domain.mjs';
import {sameScoringItems,alignScoringItems} from '../ui/scoring-labels.js';
test('评分标准固定编号对齐改名结果，拒绝漏项重复未知及分项越界',()=>{
  const cfg={answer:'fixture',rubric:'①第（1）问：2分。\n②第（2）问：4分。\n③第（3）问A空箱质量：2分。\n④第（3）问B空箱质量：2分。',scoring:{units:[{label:'12',maxScore:10}]}};
  const schema=scoringItemSchema(cfg);assert.equal(schema.length,4);assert.match(promptFor(cfg),/scoring-item-4/);
  const result={score:0,subScores:[{label:'12',score:0}],scoringDetails:schema.map(item=>({...item,label:'模型自行改名'+item.id,score:0}))};
  const parsed=parseResult(JSON.stringify(result),cfg);assert.deepEqual(parsed.scoringDetails.map(item=>item.label),schema.map(item=>item.label));
  assert.equal(sameScoringItems(parsed.scoringDetails,result.scoringDetails),true);
  assert.equal(alignScoringItems(parsed.scoringDetails,result.scoringDetails).length,4);
  const legacy={...result,scoringDetails:['第(1)问','第(2)问','第(3)问A质量','第(3)问B质量'].map(label=>({label,score:0}))};
  assert.deepEqual(parseResult(JSON.stringify(legacy),cfg).scoringDetails.map(item=>item.id),schema.map(item=>item.id));
  for(const details of [result.scoringDetails.slice(0,3),result.scoringDetails.map((item,i)=>({...item,id:i===3?'unknown':item.id})),result.scoringDetails.map((item,i)=>({...item,id:i===3?schema[0].id:item.id}))]) assert.throws(()=>parseResult(JSON.stringify({...result,scoringDetails:details}),cfg),/评分项/);
  const out={...result,score:3,subScores:[{label:'12',score:3}],scoringDetails:result.scoringDetails.map((item,i)=>({...item,score:i===0?3:0}))};assert.throws(()=>parseResult(JSON.stringify(out),cfg),/分项越界/);
  assert.equal(scoringItemSchema({...cfg,rubric:'①第（1）问：2分。'}).length,0);
});

test('任意数量及常见编号格式随当前评分标准生成，覆盖旧任务分项',()=>{
  for (const count of [1,2,3,5,8,24]) {
    const cfg={answer:'fixture',rubric:Array.from({length:count},(_,i)=>`${i+1}. 评分点${i+1}：满分2分。`).join('\n'),scoring:{maxScore:count*2,items:[{id:'old',label:'旧题目',maxScore:count*2}]}};
    const schema=scoringItemSchema(cfg);assert.equal(schema.length,count);
    assert.equal(schema[0].label,'评分点1');
    const result={score:count,subScores:[],scoringDetails:schema.map(item=>({...item,score:1}))};
    assert.equal(parseResult(JSON.stringify(result),cfg).scoringDetails.length,count);
    assert.match(promptFor(cfg),new RegExp(`共${count}项`));
    assert.throws(()=>parseResult(JSON.stringify({...result,scoringDetails:[...result.scoringDetails,{label:'自增项',score:0}]}),cfg),/评分项不完整/);
  }
  for (const rubric of ['(1) 内容：2分\n（2）表达：3分','一、内容：2分\n二、表达：3分','内容：2分\n表达：3分']) {
    assert.deepEqual(scoringItemSchema({rubric,scoring:{maxScore:5}}).map(x=>x.label),['内容','表达']);
  }
  const free={answer:'fixture',rubric:'按论证完整程度给分，最高10分；不能划分固定小问。',scoring:{maxScore:10}};
  assert.equal(scoringItemSchema(free).length,0);assert.match(promptFor(free),/数量由当前评分标准决定/);
  assert.equal(scoringItemSchema({...free,rubric:'①步骤一：2分\n②步骤二：3分'}).length,0);
});

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

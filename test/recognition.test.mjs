import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptFor, recognitionWarning } from '../src/domain.mjs';
import { Runner } from '../src/runner.mjs';

test('完整区域忠实转录规则及识别疑点必须进入人工确认', async () => {
  const config = { answer:'参考', rubric:'规则', scoring:{maxScore:4,units:[]} };
  const prompt = promptFor(config);
  assert.match(prompt,/横线上方、右侧/); assert.match(prompt,/不得根据参考答案/); assert.match(prompt,/不扩大答题范围/);
  const clear = {status:'clear',coverageChecked:true,notes:[],issues:[]};
  assert.equal(recognitionWarning({recognition:clear}),'');
  assert.match(prompt,/明确写错、漏步骤或未作答/);
  assert.match(prompt,/不要求每个笔画都完美清晰/);
  assert.equal(recognitionWarning({recognition:{...clear,notes:['答案写在横线上方，清楚可辨']}}),'');
  const harmless={location:'图1左侧',observed:'划掉的草稿字迹不清',reason:'被删除的旧内容有重叠',affectsScore:false,impactReason:'旧草稿已明确删除，最终答案清楚，不影响评分点'};
  assert.equal(recognitionWarning({recognition:{...clear,status:'uncertain',issues:[harmless]}}),'');
  assert.ok(recognitionWarning({recognition:{...clear,issues:[{...harmless,impactReason:''}]}}));
  assert.ok(recognitionWarning({recognition:{...clear,issues:[{...harmless,affectsScore:true}]}}));
  for (const recognition of [undefined, {...clear,coverageChecked:false}, {...clear,status:'uncertain'}, {...clear,issues:[{location:'图1右上',observed:'[无法辨认]',reason:'涂抹重叠'}]}, {...clear,issues:'invalid'}]) {
    assert.ok(recognitionWarning({recognition}));
  }
  const records=[];
  const store={records:()=>[],save:r=>records.push(structuredClone(r)),log:()=>{},images:async()=>[]};
  let filled=false;
  const platform={ready:async()=>({identity:'fixture',taskId:'12',units:[]}),images:async()=>[],fill:async()=>{filled=true;},diagnostic:async()=>{}};
  const result={score:2,studentAnswer:'[无法辨认]',subScores:[],recognition:{...clear,status:'uncertain',issues:[{location:'图1右上',observed:'[无法辨认]',reason:'涂抹重叠'}]}};
  const runner=new Runner(platform,store,{active:'p',presets:{p:config},mode:'unattended'},async(record,mode)=>{
    assert.equal(mode,'trial'); assert.match(record.result.recognitionWarning,/存疑/); return 'stop';
  },async()=>({...result,recognitionWarning:recognitionWarning(result)}));
  await runner.run(); assert.equal(filled,false); assert.equal(records.at(-1).state,'paused');
  const arbitrationRunner=new Runner(platform,store,{active:'p',presets:{p:config},mode:'normal'},async(record,mode)=>{
    assert.equal(mode,'normal');assert.ok(record.result.recognitionWarning);return 'stop';
  },async()=>({...result,recognitionWarning:recognitionWarning(result),recognitionDecision:'arbitration'}));
  await arbitrationRunner.run();assert.equal(filled,false);
  const tripleRunner=new Runner(platform,store,{active:'p',presets:{p:config},mode:'unattended'},async(record,mode)=>{assert.equal(mode,'unattended');return 'stop';},async()=>({...result,recognitionWarning:recognitionWarning(result),recognitionDecision:'three-way-consensus'}));
  await tripleRunner.run();
});

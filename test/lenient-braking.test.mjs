import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promptFor } from '../src/domain.mjs';
import { grade } from '../src/models.mjs';
import { gradingPolicyIssues } from '../src/grading-policy-audit.mjs';
import { withGradingIssueWarnings } from '../src/grading-issues.mjs';
import { Runner } from '../src/runner.mjs';

const studentAnswer='以行进方向为正，v0=54km/h=15m/s，a=-6m/s²。x1=v0t+1/2at²=12m；v(2)=v0+at=3m/s；刹车时间15/6=2.5s<3s，已刹停，第3s位移3²/(2×6)=0.75m。';
const config={workflowId:'w',answer:'12m；3m/s；0.75m',rubric:'第（1）问：满分3分\n第（2）问：满分3分\n第（3）问：满分4分\n学科：物理。\n评分口径：严格；给分方式为按要点／步骤给分。',scoring:{strictness:'lenient',maxScore:10,units:[]}};
const response=(last=3,reason='结果正确，但未清晰说明位移区间，按严格核对扣1分过程分。')=>({gradingMode:'lenient',score:6+last,studentAnswer,comment:reason,subScores:[],scoringDetails:[{label:'第（1）问',score:3,maxScore:3,reason:'计算正确'},{label:'第（2）问',score:3,maxScore:3,reason:'计算正确'},{label:'第（3）问',score:last,maxScore:4,reason}]});

async function mockGrade(t,replies,{budget=6,dual=false,strictness='lenient'}={}){
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const request=JSON.parse(body);requests.push(request);
    const reply=typeof replies==='function'?replies(request,requests.length):replies[Math.min(requests.length-1,replies.length-1)];
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:typeof reply==='string'?reply:JSON.stringify(reply)}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const result=await grade({...config,scoring:{...config.scoring,strictness}},{requestBudget:budget,providers:{p:{endpoint:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'fixture'}},workflows:{w:{model:{provider:'p',model:'primary'},dualEval:dual?{enabled:true,questionType:'objective',secondary:{provider:'p',model:'secondary'},arbitration:{provider:'p',model:'arbitration'}}:undefined}}},[]);
  return {result,requests};
}

test('explicit lenient choice overrides old strict rubric for total and separate score boxes',()=>{
  for(const units of [[],[1,2,3].map((n,i)=>({label:`第（${n}）问`,maxScore:[3,3,4][i]}))]){
    const prompt=promptFor({...config,scoring:{...config.scoring,units}});
    assert.match(prompt,/本次实际阅卷口径[：:]宽松/);
    assert.doesNotMatch(prompt,/你是一位严格的阅卷老师/);
    assert.match(prompt,/0\.75/);
    assert.match(prompt,/先.*满分|满分.*先/);
  }
  assert.equal(15-6*2,3);assert.equal(15/6,2.5);assert.equal(3**2/(2*6),0.75);
});

test('braking 9/10 caused by explicit strict deduction gets one original-answer re-evaluation to 10/10',async t=>{
  const {result,requests}=await mockGrade(t,[response(),response(4,'刹停时间和2秒末速度已体现区间，有效简要过程及结果正确，得4分。')]);
  assert.equal(requests.length,2);assert.equal(result.score,10);
  assert.equal(result.policyVerification.status,'verified');assert.equal(result.policyVerification.previous.score,9);
  assert.equal(result.formatWarning,undefined);
  assert.match(requests[1].messages[0].content[0].text,/不能直接机械加分/);
});

test('unresolved strict deduction stops unattended filling instead of silently accepting 9/10',async t=>{
  const {result,requests}=await mockGrade(t,[response()]);
  assert.equal(requests.length,2);assert.equal(result.score,9);assert.match(result.formatWarning,/评分口径冲突/);
  let filled=false,mode;const records=[];
  const runner=new Runner({ready:async()=>({identity:'braking',taskId:'t',units:[]}),images:async()=>[],fill:async()=>{filled=true;}},
    {records:()=>[],save:r=>records.push(structuredClone(r)),log:()=>{},images:async()=>[]},
    {active:'p',presets:{p:config},mode:'unattended'},async(_record,m)=>{mode=m;return 'stop';},async()=>result);
  await runner.run();assert.equal(mode,'trial');assert.equal(filled,false);assert.equal(records.at(-1).state,'paused');
});

test('budget exhaustion and invalid re-evaluation preserve the original anomaly for manual review',async t=>{
  const limited=await mockGrade(t,[response()],{budget:1});
  assert.equal(limited.requests.length,1);assert.equal(limited.result.score,9);assert.match(limited.result.formatWarning,/评分口径冲突/);
  const invalid=await mockGrade(t,[response(),'not json']);
  assert.equal(invalid.result.policyVerification.status,'unresolved');assert.equal(invalid.result.score,9);assert.match(invalid.result.formatWarning,/评分口径冲突/);
});

test('lenient grading keeps genuine errors and accepts compatible old responses',async t=>{
  const wrong=response(3,'仍以匀减速公式计算停车后的倒退位移，运动阶段判断错误，扣1分。');delete wrong.gradingMode;
  const {result,requests}=await mockGrade(t,[wrong]);
  assert.equal(requests.length,1);assert.equal(result.score,9);assert.equal(result.formatWarning,undefined);
  for(const strictness of ['strict'])assert.deepEqual(gradingPolicyIssues({...config,scoring:{...config.scoring,strictness}}, {...response(),gradingMode:strictness}),[]);
  assert.deepEqual(gradingPolicyIssues(config,response(3,'若按严格标准可扣1分，但本次不扣；本项存在另一个错算。')),[]);
});

test('reported wrong mode is reviewed even with full marks; secondary warnings survive agreement',()=>{
  assert.equal(gradingPolicyIssues(config,{...response(4),gradingMode:'strict'}).length,1);
  const warning='评分口径冲突：复评按严格标准扣分，请人工核对。';
  const result=withGradingIssueWarnings({score:9,dualEval:{b:{score:9,policyWarning:warning}}});
  assert.equal(result.score,9);assert.match(result.formatWarning,/复评按严格/);
});

test('normal mode also re-evaluates the braking strict deduction using existing interval evidence',async t=>{
  const initial={...response(),gradingMode:'normal'},corrected={...response(4,'已有刹停时间和剩余制动距离，必要关系充分，正常口径得满分。'),gradingMode:'normal'};
  const {result,requests}=await mockGrade(t,[initial,corrected],{strictness:'normal'});
  assert.equal(requests.length,2);assert.equal(result.score,10);assert.equal(result.expectedGradingMode,'normal');
  assert.match(requests[0].messages[0].content[0].text,/宽松和正常口径的满分判断先于逐点扣分/);
  assert.equal(result.policyVerification.status,'verified');
});

test('strict mode keeps specified detail requirements without forcing deductions on sufficient evidence',()=>{
  const prompt=promptFor({...config,scoring:{...config.scoring,strictness:'strict'}});
  assert.match(prompt,/没有该要求时仍认可已有充分证据/);
  assert.match(prompt,/不能为了区分三档而强行扣分/);
  assert.doesNotMatch(prompt,/宽松和正常口径的满分判断先于逐点扣分/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateRubric } from '../src/rubric-generator.mjs';
import { promptFor } from '../src/domain.mjs';
import { rubricPolicy, rubricScoringMethods } from '../ui/rubric-prompts.js';
import { subjectReviewRules } from '../ui/subject-review-rules.js';
import { withGradingIssueWarnings } from '../src/grading-issues.mjs';
import { grade } from '../src/models.mjs';
import { Runner } from '../src/runner.mjs';

const scenarios = {
  chinese:{question:'翻译句子并解释人物形象。',answer:'准确译意与有文本依据的人物分析。',criteria:'准确译意2分，人物分析2分。',checks:[/不强求逐字对译/,/版本不同而无法确认/,/字数不足、标题/]},
  mathematics:{question:'解含参数的方程并检验解的实际意义。',answer:'满足范围的完整解集。',criteria:'有效求解2分，解集与检验2分。',checks:[/除以可能为零的量/,/端点、开闭区间/,/整数性/]},
  english:{question:'阅读后给朋友写一封建议信。',answer:'准确回应任务要点的合理建议信。',criteria:'任务内容2分，表达与组织2分。',checks:[/英美拼写/,/交际目的/,/情态强度/]},
  physics:{question:'由速度图像求分阶段位移并说明方向。',answer:'按各段有符号面积求和。',criteria:'图像关系2分，计算与方向2分。',checks:[/运动阶段/,/斜率、截距和面积/,/实验读数/]},
  chemistry:{question:'写离子方程式并解释实验现象。',answer:'符合体系条件的反应式和现象解释。',criteria:'反应式2分，现象与解释2分。',checks:[/电荷守恒/,/系数成比例/,/体积状态/]},
  biology:{question:'提出验证假设的实验设计及可能结果。',answer:'对照合理并区分预测和结论。',criteria:'设计2分，预测与结论边界2分。',checks:[/空白对照/,/条件概率的分母/,/不能强迫学生提前写成参考结论/]},
  politics:{question:'根据指定年份材料，评析企业应采取的措施。',answer:'按材料主体权限和条件论证。',criteria:'观点2分，材料联系2分。',checks:[/原因、意义、措施、评析/,/主体责任互换/,/题目时间/]},
  history:{question:'比较两则史料，评价对同一事件的解释。',answer:'比较来源和论证限度。',criteria:'史实与材料2分，评价与比较2分。',checks:[/不同历法/,/一手材料/,/不能仅并列两段/]},
  geography:{question:'比较两地人口增长图，并给出适用措施。',answer:'按相同比较维度及指标分析。',criteria:'比较与数据2分，措施2分。',checks:[/来自.*流向/,/总量、比重、增量、增长率/,/不强行要求所有题都写正反两面/]}
};

for(const [subject,scenario] of Object.entries(scenarios)){
  test(`${subject}: real task boundaries survive generation, saving and all three grading modes`,async()=>{
    for(const strictness of ['lenient','normal','strict']){
      let requested='';
      const generated=await generateRubric({providers:{p:{}}},{version:2,provider:'p',model:'fixture',subject,strictness,scoringMethod:'auto',question:scenario.question,answer:scenario.answer,maxScore:4},async(_provider,_model,prompt)=>{
        requested=prompt;
        return JSON.stringify({question:scenario.question,answer:scenario.answer,items:[{label:'第（1）问',maxScore:4,criteria:scenario.criteria}],warnings:[]});
      });
      const grading=promptFor({answer:scenario.answer,rubric:generated.rubric,scoring:{maxScore:4,units:[]}});
      for(const text of [requested,generated.rubric,grading]){
        for(const check of scenario.checks)assert.match(text,check);
        assert.match(text,/填在空格里的解释、实验设计或论证仍按实际任务评价/);
        assert.match(text,/并列保留且互相冲突的答案不能只挑正确项/);
        assert.match(text,/不能自行套用其他考试规则/);
      }
      // Subject-specific checks must not leak into a different discipline.
      const other=subject==='physics'?'english':'physics';
      assert.ok(!rubricPolicy({subject:other}).includes(subjectReviewRules[subject][0]));
    }
  });
}

test('custom instructions and full-length teacher notes remain usable without adding default subject rules',()=>{
  for(const subject of Object.keys(scenarios)){
    const custom=rubricPolicy({subject,useCustomPrompt:true,customRequirements:'本题使用指定标准，不额外设置扣分。'});
    assert.ok(!custom.includes(subjectReviewRules[subject][0]));
    assert.match(custom,/教师自定义给分边界和已保存的明确条款优先/);
    for(const scoringMethod of Object.keys(rubricScoringMethods)){
      const policy=rubricPolicy({subject,scoringMethod,notes:'教师说明'.repeat(500)});
      assert.ok(policy.length<=12000,`${subject}/${scoringMethod}: ${policy.length}`);
    }
  }
});

test('grading issue warnings preserve scores, legacy responses, malformed flags and secondary evidence',()=>{
  const base={score:4,gradingIssues:[]};
  assert.equal(withGradingIssueWarnings(base),base);
  const old={score:4};assert.equal(withGradingIssueWarnings(old),old);
  for(const gradingIssues of [null,{},[{}],[{location:'第1问',reason:'多答条款缺失'}]]){
    const result=withGradingIssueWarnings({...base,formatWarning:'原有合计异常',dualEval:{b:{gradingIssues}}});
    assert.equal(result.score,4);assert.match(result.formatWarning,/原有合计异常/);assert.match(result.formatWarning,/人工/);
  }
});

test('a secondary model reporting a missing rule blocks unattended submission despite score agreement',async t=>{
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const model=JSON.parse(body).model;
    const result={score:4,studentAnswer:'两个未删除的矛盾答案',comment:'待核对多答规则',subScores:[],scoringDetails:[{label:'第（1）问',score:4,maxScore:4}],recognition:{status:'clear',coverageChecked:true,notes:[],issues:[]},gradingIssues:model==='secondary'?[{location:'第（1）问',reason:'标准未规定矛盾多答如何处理，影响本项得分'}]:[]};
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const config={workflowId:'w',answer:'参考',rubric:'第（1）问：满分4分\n根据答案给分。',scoring:{maxScore:4,units:[]}};
  const result=await grade(config,{providers:{p:{endpoint:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'fixture'}},workflows:{w:{model:{provider:'p',model:'primary'},dualEval:{enabled:true,questionType:'objective',secondary:{provider:'p',model:'secondary'},arbitration:{provider:'p',model:'arbitration'}}}}},[]);
  assert.equal(result.dualEval.result,'consensus');assert.equal(result.score,4);
  assert.match(result.formatWarning,/矛盾多答/);
  let filled=false;let reviewMode;
  const records=[];
  const runner=new Runner({ready:async()=>({identity:'rule-issue',taskId:'t',units:[]}),images:async()=>[],fill:async()=>{filled=true;}},
    {records:()=>[],save:r=>records.push(structuredClone(r)),log:()=>{},images:async()=>[]},
    {active:'p',presets:{p:config},mode:'unattended'},async(_record,mode)=>{reviewMode=mode;return 'stop';},async()=>result);
  await runner.run();
  assert.equal(reviewMode,'trial');assert.equal(filled,false);assert.equal(records.at(-1).state,'paused');
});

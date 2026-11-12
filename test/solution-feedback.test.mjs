import test from 'node:test';
import assert from 'node:assert/strict';
import { rubricPolicy, rubricPrompts, rubricRequirements, solutionGradingPolicy } from '../ui/rubric-prompts.js';
import { promptFor, scoringItemSchema } from '../src/domain.mjs';
import { generateRubric } from '../src/rubric-generator.mjs';

const config={answer:'正确结论',rubric:'第（1）问：满分4分\n方法与结果按标准给分。',scoring:{maxScore:4,units:[]}};

for (const subject of ['physics','mathematics']) {
  for (const strictness of ['lenient','normal','strict']) {
    test(`${subject} ${strictness} requirements remain distinct through generation, saving and grading`,async()=>{
      let requested='';
      const criteria='关键关系2分；最终结果2分。';
      const generated=await generateRubric({providers:{test:{}}},{
        version:2,provider:'test',model:'test',subject,strictness,scoringMethod:'points',
        question:'计算并说明过程。',answer:'正确结果。',maxScore:4,roundStep:1
      },async(_provider,_model,prompt)=>{
        requested=prompt;
        return JSON.stringify({items:[{label:'第（1）问',maxScore:4,criteria}],warnings:[]});
      });
      const saved={...config,rubric:generated.rubric,rubricGeneration:{subject,strictness:'normal'}};
      assert.deepEqual(scoringItemSchema(saved).map(item=>item.maxScore),[4]);
      assert.ok(generated.rubric.includes(criteria));
      assert.ok(generated.rubric.includes(`评分口径：${rubricPrompts[strictness].label}`));
      for (const prompt of [requested,generated.rubric,promptFor(saved)]) {
        assert.match(prompt,/以已保存的各小问具体条款为准/);
        assert.match(prompt,/具体扣几分/);
        if (strictness==='lenient') {
          assert.match(prompt,/只要最终答案正确，且学生实际写出任何与本题相关、经核验有效的公式、列式、运算或简要推理，就必须给分/);
          assert.match(prompt,/过程过于简略或未达到参考步骤数量而判零/);
          assert.match(prompt,/若这段有效过程足以支持结论，应给该小问满分/);
          assert.match(prompt,/完全没有写过程、只写最终答案的过程题，不给过程分/);
          assert.match(prompt,/不得在识别文本中补写/);
          assert.doesNotMatch(prompt,/关键推理实际缺失仍按标准处理|常规运算仅限于/);
        } else if (strictness==='normal') {
          assert.match(prompt,/正常模式下的解答题：答案正确且必要过程充分/);
          assert.match(prompt,/最终答案正确也不能免除此类扣分/);
          assert.match(prompt,/不能把“未单列”和“确实缺失”混同/);
          assert.doesNotMatch(prompt,/严格模式下的解答题|宽松模式下的解答题/);
        } else {
          assert.match(prompt,/严格模式下的解答题：答案正确、必要过程完备/);
          assert.match(prompt,/漏写已明确要求的单位或基本关系也须扣分/);
          assert.match(prompt,/不强制照抄参考方程/);
          assert.match(prompt,/各项细节扣分须纳入已有小问分值和步长/);
          assert.doesNotMatch(prompt,/正常或严格模式下的解答题|宽松模式下的解答题/);
        }
      }
      if (subject==='mathematics') {
        assert.match(promptFor(saved),/不把宽松规则允许的过程省略认定为上游错误/);
        assert.match(promptFor(saved),/不得给B完整分值/);
      }
    });
  }
}

test('custom requirements bypass all three default tolerance policies',()=>{
  const policy=solutionGradingPolicy({subject:'physics',strictness:'strict',useCustomPrompt:true});
  assert.match(policy,/遵守教师自定义要求/);
  assert.doesNotMatch(policy,/宽松模式下的解答题|正常模式下的解答题|严格模式下的解答题/);
});

test('objective and non-calculation tasks retain their own requirements in every mode',()=>{
  for (const strictness of ['lenient','normal','strict']) {
    const prompt=rubricPolicy({subject:'physics',strictness,scoringMethod:'answers'});
    assert.match(prompt,/每个独立答案项只取满分或零分/);
    assert.match(prompt,/客观选择、填空不套用解答题过程要求/);
    assert.match(prompt,/写作、开放论述按题型评价/);
  }
  assert.match(rubricRequirements('mathematics','lenient'),/证明题仍需有效的关键论证/);
  assert.match(rubricRequirements('physics','strict'),/最终有量纲结果缺单位/);
});

for(const strictness of ['lenient','normal','strict']) {
  test(`${strictness} generation and grading require specific deductions and method feedback`,()=>{
    const generation=rubricPolicy({subject:'physics',scoringMethod:'points',strictness});
    const grading=promptFor({...config,rubricGeneration:{version:2,strictness}});
    for(const prompt of [generation,grading]){
      assert.match(prompt,/对应哪条评分标准/);
      assert.match(prompt,/具体扣几分/);
      assert.match(prompt,/不能仅因细节扣分就笼统评价为不会解题/);
      assert.match(prompt,/不必经过参考解法的全部中间量/);
      assert.match(prompt,/不因未单列中间量或重复说明扣分/);
      assert.match(prompt,/只有正确终值而无任何有效过程、无效推导或无法辨认时/);
      assert.match(prompt,/新的独立错误另按对应点处理/);
      assert.match(prompt,/不固定为每次扣1分/);
      if(strictness==='lenient'){
        assert.match(prompt,/优先看学生是否掌握解题方法/);
        assert.match(prompt,/单位省略/);
        assert.match(prompt,/题目明确考查的单位/);
        assert.match(prompt,/明确“不扣分”/);
        assert.match(prompt,/常规代入运算及重复说明可以省略/);
      } else {
        assert.match(prompt,/明确说明“方法正确”/);
        assert.doesNotMatch(prompt,/宽松模式下的解答题/);
      }
    }
  });
}

test('an explicit rubric mode takes precedence over older generator preferences',()=>{
  const prompt=promptFor({...config,rubric:config.rubric+'\n评分口径：严格；给分方式为按要点／步骤给分。',rubricGeneration:{strictness:'lenient'}});
  assert.match(prompt,/严格模式下的解答题/);
  assert.doesNotMatch(prompt,/宽松模式下的解答题/);
});

test('old rubrics with a lenient marker receive the lenient guidance',()=>{
  assert.match(promptFor({...config,rubric:config.rubric+'\n评分口径：宽松；给分方式为按要点／步骤给分。'}),/宽松模式下的解答题/);
});

test('lenient process answers receive credit even when incomplete, while answer-only work earns no process credit',()=>{
  const policy=solutionGradingPolicy({subject:'mathematics',strictness:'lenient'});
  assert.match(policy,/任何与本题相关、经核验有效的公式、列式、运算或简要推理，就必须给分/);
  assert.match(policy,/过程过于简略或未达到参考步骤数量而判零/);
  assert.match(policy,/不得把“未得满分”处理成“不得分”/);
  assert.match(policy,/完全没有写过程、只写最终答案的过程题，不给过程分/);
});

test('all natural-science lenient templates award partial credit for valid but incomplete work',()=>{
  for(const subject of ['mathematics','physics','chemistry','biology']){
    const requirements=rubricRequirements(subject,'lenient');
    assert.match(requirements,/任何相关、有效的/ ,subject);
    assert.match(requirements,/按.*有效内容给部分分|按有效内容给部分分/,subject);
    assert.match(requirements,/不得因过程不完整判零/,subject);
    const grading=promptFor({...config,rubricGeneration:{subject,strictness:'lenient'}});
    assert.match(grading,/过程过于简略或未达到参考步骤数量而判零/,subject);
    assert.match(grading,/不得把“未得满分”处理成“不得分”/,subject);
  }
});

test('custom grading retains teacher boundaries and detailed feedback',()=>{
  const prompt=promptFor({...config,rubricGeneration:{strictness:'lenient',useCustomPrompt:true}});
  assert.match(prompt,/遵守教师自定义要求/);
  assert.match(prompt,/具体扣几分/);
  assert.doesNotMatch(prompt,/宽松模式下的解答题/);
});

test('generated drafts retain the selected tolerance and feedback policy after saving',async()=>{
  let requestedPrompt='';
  const result=await generateRubric({providers:{test:{}}},{
    provider:'test',model:'test',version:2,subject:'physics',strictness:'lenient',scoringMethod:'points',
    question:'说明解题过程。',answer:'方法及结论正确。',maxScore:4,roundStep:1
  },async(_provider,_model,prompt)=>{
    requestedPrompt=prompt;
    return JSON.stringify({question:'说明解题过程。',answer:'方法及结论正确。',rubric:'评分标准',warnings:[],items:[{label:'第（1）问',maxScore:4,criteria:'按有效方法与正确结论给分。'}]});
  });
  assert.match(requestedPrompt,/优先看学生是否掌握解题方法/);
  assert.match(result.rubric,/宽松模式下的解答题/);
  assert.match(result.rubric,/具体扣几分/);
  assert.match(requestedPrompt,/执行正文中不得以“建议扣分”/);
  assert.doesNotMatch(requestedPrompt,/若题目与教师未说明，提出建议/);
  assert.match(result.rubric,/完整正确且满足题目及教师明确要求的解答应得该小问满分/);
  assert.match(promptFor({...config,rubric:result.rubric}),/宽松模式下的解答题/);
});

test('generated solution rules preserve two question scores through generation and actual grading',async()=>{
  const result=await generateRubric({providers:{test:{}}},{
    provider:'test',model:'test',version:2,subject:'physics',strictness:'lenient',scoringMethod:'points',
    question:'求（1）飞行时间（2）着陆速度。',answer:'（1）2 s；（2）10√7 m/s。',maxScore:10,roundStep:1
  },async()=>JSON.stringify({warnings:[],items:[
    {label:'第（1）问：飞行时间',maxScore:4,criteria:'建立有效关系并得到正确时间。'},
    {label:'第（2）问：着陆速度',maxScore:6,criteria:'核验实际推导，认可合并公式或其他有效方法。'}
  ]}));
  const saved={rubric:result.rubric,answer:'2 s；10√7 m/s',scoring:{maxScore:10,roundStep:1,units:[]}};
  assert.deepEqual(scoringItemSchema(saved).map(item=>item.maxScore),[4,6]);
  for(const text of [result.rubric,promptFor(saved)]) {
    assert.match(text,/合并公式、消元、整体关系或简洁推导/);
    assert.match(text,/步骤或小问一致沿用该错误数值/);
    assert.match(text,/只有正确终值而无任何有效过程/);
    assert.match(text,/物理解答题方程与结果赋分规则/);
    assert.match(text,/最终结果预留1—2分/);
    assert.match(text,/不能把整个正确方程点判零/);
  }
});

test('physics vector conventions persist through generation, saving and grading in every mode',async()=>{
  for(const strictness of ['lenient','normal','strict']){
    let requested='';
    const generated=await generateRubric({providers:{test:{}}},{version:2,provider:'test',model:'test',subject:'physics',strictness,scoringMethod:'points',question:'汽车初速度20m/s，以4m/s²的加速度大小刹车，求3秒末速度。',answer:'8m/s',maxScore:4,roundStep:1},async(_provider,_model,prompt)=>{
      requested=prompt;
      return JSON.stringify({items:[{label:'第（1）问',maxScore:4,criteria:'正确列式与计算共4分。'}],warnings:[]});
    });
    for(const prompt of [requested,generated.rubric,promptFor({...config,rubric:generated.rubric})]){
      assert.match(prompt,/物理矢量与正负号判定规则/);
      assert.match(prompt,/v=20\+\(-4\)\*3=8/);
      assert.match(prompt,/两种自洽写法同等认可/);
      assert.match(prompt,/实际代入20-4\*3/);
      assert.match(prompt,/不得反推学生使用了负加速度/);
      assert.match(prompt,/不能因终值碰巧正确而认可错误推导/);
      assert.match(prompt,/核对停止时间/);
      assert.match(prompt,/物理含义与等价表达核验/);
      assert.match(prompt,/负电流可表示实际方向相反/);
      assert.match(prompt,/外界对系统做功与系统对外做功/);
      assert.match(prompt,/表压与绝对压强须按定义转换/);
      assert.match(prompt,/不能自行设置固定容差/);
      assert.match(prompt,/不把所有物理专题例子机械加入每道题/);
    }
    assert.match(requested,/参考答案核验与规则编写分开/);
    assert.match(requested,/不静默改写answer/);
    assert.match(requested,/rubric留空且items为空/);
  }
  assert.doesNotMatch(solutionGradingPolicy({subject:'mathematics'}),/物理矢量与正负号判定规则/);
});

test('physics equation policy follows explicit subject markers over saved generator settings',()=>{
  const physics=promptFor({...config,rubric:config.rubric+'\n学科：物理。',rubricGeneration:{subject:'mathematics'}});
  assert.match(physics,/物理解答题方程与结果赋分规则/);
  assert.match(physics,/不得临时重新分配分值/);
  const mathematics=promptFor({...config,rubric:config.rubric+'\n学科：数学。',rubricGeneration:{subject:'physics'}});
  assert.doesNotMatch(mathematics,/物理解答题方程与结果赋分规则/);
  const fallback=promptFor({...config,rubricGeneration:{subject:'physics'}});
  assert.match(fallback,/物理解答题方程与结果赋分规则/);
});

test('physics defaults apply to all tolerance levels and respect custom teacher boundaries',()=>{
  for(const strictness of ['normal','lenient','strict']) {
    const prompt=rubricPolicy({subject:'physics',strictness,scoringMethod:'points'});
    assert.match(prompt,/物理解答题方程与结果赋分规则/);
    assert.match(prompt,/不把常规代入、移项、解方程、开方或每个中间数值机械拆成独立得分点/);
    assert.match(prompt,/小问总分、得分步长或教师要求不允许这样分配时/);
    assert.match(prompt,/选择、填空及不以数值求解为目标的实验、论证题按各自题意评分/);
  }
  const custom=rubricPolicy({subject:'physics',useCustomPrompt:true,customRequirements:'本题结果分为3分，过程分为7分。'});
  assert.match(custom,/本题结果分为3分，过程分为7分/);
  assert.match(custom,/教师未另行指定时/);
  assert.match(custom,/遵守教师自定义要求/);
  for(const subject of ['mathematics','chemistry','chinese','']) {
    assert.doesNotMatch(rubricPolicy({subject}),/物理解答题方程与结果赋分规则|最终结果预留1—2分/);
  }
});

test('mathematics policies assess key computations without treating every written line as a scoring point',()=>{
  for(const strictness of ['lenient','normal','strict']) {
    for(const prompt of [
      rubricPolicy({subject:'mathematics',strictness,scoringMethod:'points'}),
      promptFor({...config,rubricGeneration:{subject:'mathematics',strictness}})
    ]) {
      assert.match(prompt,/数学解答题关键过程赋分规则/);
      assert.match(prompt,/不按每一行或每次加减乘除机械拆分/);
      assert.match(prompt,/证明题重点评价依据、推理链及必要分类/);
      assert.match(prompt,/仅检查起始方程正确不足以认定已完成后续关键运算/);
      assert.match(prompt,/不能自动保留全部后续分值/);
      assert.match(prompt,/不能一律只扣最终结果分/);
      assert.match(prompt,/不因同一偏差逐行追加扣分/);
      assert.match(prompt,/不能一次算错就把后续全部判零/);
      assert.match(prompt,/不统一规定最终结果占1—2分/);
      assert.match(prompt,/关键变形|等价变形/);
      assert.doesNotMatch(prompt,/物理解答题方程与结果赋分规则/);
      assert.doesNotMatch(prompt,/只在首次受影响的计分点按该点分值扣分/);
      assert.match(prompt,/具体扣几分/);
    }
  }
});

test('mathematics rules follow saved subject markers, respect teacher allocation and leave other subjects unchanged',()=>{
  assert.match(promptFor({...config,rubric:config.rubric+'\n学科：数学。',rubricGeneration:{subject:'physics'}}),/数学解答题关键过程赋分规则/);
  for(const subject of ['physics','chemistry','chinese','']) {
    const marker=subject==='physics'?'物理':subject==='chemistry'?'化学':subject==='chinese'?'语文':'通用';
    assert.doesNotMatch(promptFor({...config,rubric:config.rubric+`\n学科：${marker}。`,rubricGeneration:{subject:'mathematics'}}),/数学解答题关键过程赋分规则/);
  }
  const custom=rubricPolicy({subject:'mathematics',scoringMethod:'points',useCustomPrompt:true,customRequirements:'第（1）问最终结果3分，过程5分。'});
  assert.match(custom,/最终结果3分，过程5分/);
  assert.match(custom,/遵守教师自定义要求/);
  assert.match(custom,/遵守题目或教师已明确的细则/);
});

test('mathematics generation carries task-specific rules into saved rubrics and grading without splitting question totals',async()=>{
  let requested='';
  const result=await generateRubric({providers:{test:{}}},{
    provider:'test',model:'test',version:2,subject:'mathematics',strictness:'lenient',scoringMethod:'auto',
    question:'（1）解方程；（2）证明结论。',answer:'（1）x=2；（2）证明成立。',maxScore:12,roundStep:1,
    scoreAllocation:'第（1）问5分，第（2）问7分。'
  },async(_provider,_model,prompt)=>{
    requested=prompt;
    return JSON.stringify({warnings:[],items:[
      {label:'第（1）问：解方程',maxScore:5,criteria:'等价变形2分；有效求解2分；结果及必要检验1分。'},
      {label:'第（2）问：证明',maxScore:7,criteria:'有效依据2分；关键推理3分；完整论证与结论2分。'}
    ]});
  });
  const saved={...config,rubric:result.rubric,scoring:{maxScore:12,roundStep:1,units:[]}};
  assert.deepEqual(scoringItemSchema(saved).map(item=>item.maxScore),[5,7]);
  for(const text of [requested,result.rubric,promptFor(saved)]) {
    assert.match(text,/数学解答题关键过程赋分规则/);
    assert.match(text,/宽松计算求解题允许省略中间变形、常规运算及非必要说明/);
    assert.match(text,/关键条件、分类情况或明显降低后续难度/);
    assert.doesNotMatch(text,/物理解答题方程与结果赋分规则/);
  }
  assert.match(result.rubric,/等价变形2分；有效求解2分/);
});

test('mathematics dependency rules distinguish invalid premises, independent work and recovered reasoning in all modes',()=>{
  for(const strictness of ['lenient','normal','strict']) {
    for(const prompt of [
      rubricPolicy({subject:'mathematics',strictness,scoringMethod:'points'}),
      promptFor({...config,rubricGeneration:{subject:'mathematics',strictness}})
    ]) {
      assert.match(prompt,/若A是B的必要前提/);
      assert.match(prompt,/B即使运算形式正确或偶然得到正确数值/);
      assert.match(prompt,/默认仅可获得少量可独立核验的方法分/);
      assert.match(prompt,/C完整正确时给其满分/);
      assert.match(prompt,/包括跨小问及间接依赖/);
      assert.match(prompt,/不限于A、B、C三个步骤/);
      assert.match(prompt,/从原题条件独立重建有效依据/);
      assert.match(prompt,/不能把参考解法的依赖关系强加给正确的替代解法/);
      assert.match(prompt,/不能因前面出现过错误就永久限分/);
      assert.match(prompt,/上限必须是确定分值/);
      assert.match(prompt,/必要时可以为0分/);
      assert.match(prompt,/哪些独立步骤未受影响/);
      assert.doesNotMatch(prompt,/受错误数值影响但方法仍有效、条件仍满足且未绕开核心考查内容的部分，可按生成标准明确保留的方法分给分/);
    }
  }
});

test('generated mathematical dependency caps persist within a single question through saving and grading',async()=>{
  let requested='';
  const criteria='A建立前提，满分2分；B依赖A，满分4分，A错误且未纠正时仅给独立方法分，上限1分；C不依赖A，满分4分，完整正确给4分。';
  const result=await generateRubric({providers:{test:{}}},{
    provider:'test',model:'test',version:2,subject:'mathematics',strictness:'lenient',scoringMethod:'points',
    question:'第（1）问含相互依赖与独立的推理环节。',answer:'有效依据及推导。',maxScore:10,roundStep:1
  },async(_provider,_model,prompt)=>{
    requested=prompt;
    return JSON.stringify({warnings:[],items:[{label:'第（1）问',maxScore:10,criteria}]});
  });
  const saved={...config,rubric:result.rubric,scoring:{maxScore:10,roundStep:1,units:[]}};
  assert.deepEqual(scoringItemSchema(saved).map(item=>item.maxScore),[10]);
  for(const text of [requested,result.rubric,promptFor(saved)]) {
    assert.match(text,/小问内部明确各关键步骤的依赖前提/);
    assert.match(text,/不得给B完整分值/);
    assert.match(text,/C完整正确时给其满分/);
    assert.match(text,/具体扣分和小问得分/);
  }
  for(const text of [result.rubric,promptFor(saved)]) {
    assert.ok(text.includes(criteria));
    assert.match(text,/不能自动保留全部后续分值/);
  }
});

test('legacy generation also requests definite rules while objective blanks retain separate scores',async()=>{
  let requested='';
  const result=await generateRubric({providers:{test:{}}},{
    provider:'test',model:'test',questionType:'objective',subject:'physics',strictness:'normal',
    question:'第（1）问有三空。',answer:'甲、乙、丙',maxScore:6,roundStep:0.5
  },async(_provider,_model,prompt)=>{
    requested=prompt;
    return JSON.stringify({warnings:[],items:[1,2,3].map(n=>({label:`第（1）问 第${n}空`,maxScore:2,criteria:'正确2分，错误0分。'}))});
  });
  assert.match(requested,/执行正文中不得以“建议扣分”/);
  assert.match(requested,/题目或教师已明确规定时按该规定执行/);
  assert.match(result.rubric,/客观选择、填空仍按独立答案项评分/);
  assert.deepEqual(scoringItemSchema({rubric:result.rubric,scoring:{maxScore:6}}).map(item=>item.maxScore),[2,2,2]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { rubricGradingSettings, gradingPolicyForRubric, rubricSubjects, rubricScoringMethods, solutionGradingPolicy } from '../ui/rubric-prompts.js';
import { subjectReviewRules, subjectReviewSummaries } from '../ui/subject-review-rules.js';
import { generateRubric } from '../src/rubric-generator.mjs';
import { promptFor } from '../src/domain.mjs';

test('the editor and grading resolve the saved rubric before stale generation preferences',()=>{
  const old={version:2,subject:'physics',strictness:'lenient',scoringMethod:'points',notes:'保留教师说明',useCustomPrompt:true,customRequirements:'保留教师要求'};
  const rubric={text:'第一问：满分4分\n正确4分。\n学科：英语。\n评分口径：严格；给分方式为按答案逐项给分。'};
  const resolved=rubricGradingSettings(rubric,old);
  assert.equal(resolved.subject,'english');assert.equal(resolved.strictness,'strict');assert.equal(resolved.scoringMethod,'answers');assert.equal(resolved.useCustomPrompt,false);
  assert.equal(resolved.notes,old.notes);assert.equal(resolved.customRequirements,old.customRequirements);
  const before=structuredClone(rubric);
  const prompt=promptFor({rubric,answer:'答案',rubricGeneration:old,scoring:{maxScore:4,units:[]}});
  assert.match(prompt,/英语真实阅卷核验/);assert.doesNotMatch(prompt,/物理矢量与正负号/);
  assert.match(prompt,/本次给分方式：按答案逐项给分/);assert.match(prompt,/不套用其他模板的过程分/);
  assert.deepEqual(rubric,before);
  assert.equal(rubricGradingSettings('学科：通用。',old).subject,'');
  assert.equal(rubricGradingSettings('学科：未知。',old).subject,'');
});

test('legacy rubrics retain preferences and explicit custom marking stays custom',()=>{
  const saved={version:2,subject:'chemistry',strictness:'lenient',scoringMethod:'points',notes:'本题备注',useCustomPrompt:true,customRequirements:'教师约定'};
  const fallback=rubricGradingSettings('旧手写标准',saved);
  assert.equal(fallback.subject,'chemistry');assert.equal(fallback.strictness,'lenient');assert.equal(fallback.useCustomPrompt,true);
  const custom=rubricGradingSettings('学科：生物。\n评分口径：自定义；给分方式为按要点／步骤给分。',saved);
  assert.equal(custom.subject,'biology');assert.equal(custom.useCustomPrompt,true);assert.equal(custom.customRequirements,'教师约定');
  assert.doesNotMatch(gradingPolicyForRubric('评分口径：自定义。',saved),/化学真实阅卷核验/);
  const imported=rubricGradingSettings('旧手写标准',{subject:'physics',strictness:'lenient',useCustomPrompt:true});
  assert.equal(imported.useCustomPrompt,true);
  assert.match(gradingPolicyForRubric('旧手写标准',{useCustomPrompt:true}),/遵守教师自定义要求/);
});

test('all nine generated rubrics carry each shared rule once into real grading',async()=>{
  for(const [subject,entry] of Object.entries(rubricSubjects))for(const strictness of ['lenient','normal','strict']){
    const generated=await generateRubric({providers:{fixture:{}}},{version:2,provider:'fixture',model:'offline',subject,strictness,scoringMethod:'points',question:'本题',answer:'答案',maxScore:4},async()=>JSON.stringify({question:'本题',answer:'答案',items:[{label:'第一问',maxScore:4,criteria:'已保存的本题条款。'}],warnings:[]}));
    const config={rubric:generated.rubric,answer:'答案',scoring:{maxScore:4,units:[]}};
    const prompt=promptFor(config);
    assert.equal(prompt.split(subjectReviewRules[subject][0]).length-1,1,`${subject}/${strictness}`);
    assert.equal(prompt.split(solutionGradingPolicy({subject,strictness})).length-1,1);
    assert.match(prompt,/本次给分方式：按要点／步骤给分/);
    assert.equal(rubricGradingSettings(generated.rubric).subject,subject);
    assert.equal(rubricGradingSettings(generated.rubric).strictness,strictness);
    assert.ok(subjectReviewSummaries[subject],entry.label);
    assert.equal(config.rubric,generated.rubric);
  }
});

test('all saved scoring methods survive without replacing teacher allocation',()=>{
  for(const [scoringMethod,entry] of Object.entries(rubricScoringMethods)){
    const text=`第一问：满分4分\n教师固定条款。\n学科：数学。\n评分口径：正常；给分方式为${entry.label}。`;
    assert.equal(rubricGradingSettings(text,{scoringMethod:'answers'}).scoringMethod,scoringMethod);
    assert.ok(gradingPolicyForRubric(text).includes(`本次给分方式：${entry.label}`));
  }
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRubric } from '../src/rubric-generator.mjs';
import { rubricSubjects, rubricPrompts } from '../ui/rubric-prompts.js';

// Capture the exact production request through its existing injection point.
// No provider credentials, network requests or model-generated answers are used.
const output = fileURLToPath(new URL('../docs/prompt-exports/', import.meta.url));
await fs.mkdir(output, {recursive:true});
const entries=[];
for(const [subject, details] of Object.entries(rubricSubjects)){
  for(const strictness of ['lenient','normal','strict']){
    const input={version:2,provider:'export',model:'preview',subject,strictness,scoringMethod:'auto',maxScore:10,roundStep:1,
      question:'【待填：本题题目文字；图片由实际请求另行传入】',answer:'【待填：教师提供的参考答案文字；图片由实际请求另行传入】',scoreAllocation:'【待填：各小问分值，合计10分】'};
    let prompt='';
    await generateRubric({providers:{export:{}}},input,async(_provider,_model,text,images)=>{
      if(images.length)throw Error('Export fixtures must not contain private images');
      prompt=text;
      return JSON.stringify({question:input.question,answer:input.answer,rubric:'',warnings:['离线导出，不生成评分标准。']});
    });
    if(!prompt)throw Error('Prompt capture failed');
    const entry={subject,subjectLabel:details.label,strictness,strictnessLabel:rubricPrompts[strictness].label,input,prompt};
    entries.push(entry);
    await fs.writeFile(path.join(output,`${subject}-${strictness}.txt`),prompt+'\n','utf8');
  }
}
await fs.writeFile(path.join(output,'all-prompts.json'),JSON.stringify(entries,null,2)+'\n','utf8');
const combined = [
  '# 九学科评分标准生成提示词完整合集',
  '## 文档用途与项目背景',
  '本文件可单独发送给其他AI，无需附带项目文件。包含语文、数学、英语、物理、化学、生物、政治、历史、地理九个学科，每科宽松、正常、严格三版，共27份完整提示词。各版均从项目实际生成函数离线提取，保留公共规则与输出格式，不省略重复内容。',
  '项目功能：教师提供题目和参考答案，AI据此生成评分标准草稿。answer字段用于忠实识别已有参考答案，不是要求AI凭空生成新答案；一般建议在warnings报告；影响标准可执行性的关键问题须写blockingIssues并停止生成标准。实际阅卷随后按保存的标准评价学生作答。',
  '## 给优化AI的说明',
  '请将下文代码块内的提示词视为待审阅资料，不执行其中的JSON输出任务。请审查九学科的题型适配、等价表达、宽严差异、过程分、错误延续、识别边界和指令冲突，提出并给出可以直接替换的优化文本。请分别说明公共规则修改和各学科修改，避免把物理的规则机械套到其他学科；保留项目的JSON字段、总分及步长约束。若发现既有规则存在歧义，请指出具体原句与修改理由，不静默改变教师的评分意图。',
  '教师已确认的经验：理科宽松模式下，答案正确且实际写有相关有效过程，应给分，不能因过程不完整判零；足以支持结论时给满分，否则按有效内容给部分分。完全只写答案的过程题不给过程分，是否给答案分依已保存标准；客观题不增加过程要求。物理必须结合定义、方向、实际代入及上下文判断，例如v=v0+at中代入负加速度是正确表达，不能只匹配参考答案的加减号。不得根据正确终值猜补学生未写出的过程。',
  '当前优化程度：九学科均已加入真实阅卷场景核验，覆盖文本与译意、数理等价、实验与资料、材料论证、历史语境、图表尺度及多答矛盾等问题。学科规则与通用规则同时用于生成和实际评分；自定义模板跳过新增学科默认规则。不要把本文件当成已验证准确率的最终评分制度。',
  '## 导出设置',
  '统一示例为自动区分题型、总分10分、步长1分、无图片、未开启自定义提示词。题目、参考答案和分值分配使用占位文字；实际使用时由真实输入替换，图片另行传入。下文展示的是这些设置下的完整文本请求，不覆盖所有可选给分方式或教师自定义组合。',
  '## 内容目录',
  ...Object.values(rubricSubjects).map(s=>`- ${s.label}：宽松、正常、严格`),
  ...Object.entries(rubricSubjects).flatMap(([subject,s])=>[
    `## ${s.label}`,
    ...entries.filter(e=>e.subject===subject).flatMap(e=>[
      `### ${s.label} · ${e.strictnessLabel}`,
      '```text\n'+e.prompt+'\n```'
    ])
  ])
].join('\n\n')+'\n';
await fs.writeFile(path.join(output,'九学科提示词完整合集.md'),combined,'utf8');
for(const [subject, details] of Object.entries(rubricSubjects)){
  const sections=entries.filter(entry=>entry.subject===subject).map(entry=>[
    `## ${entry.strictnessLabel}口径`,
    '```text\n'+entry.prompt+'\n```'
  ].join('\n\n'));
  const document=[
    `# ${details.label}学科评分标准生成提示词`,
    '本文包含本学科宽松、正常、严格三种口径下的完整提示词。由 `node scripts/export-prompts.mjs` 从项目实际生成函数离线导出。',
    '功能说明：教师提供题目和参考答案，AI生成评分标准草稿。下方使用总分10分、得分步长1分、无图片的示例设置；方括号占位文字需在审阅或复用时替换。',
    '传递给其他AI优化时，需将代码块内容视为待优化文本；保留项目现有JSON结构和总分、步长校验，并说明任何评分意图上的修改。',
    ...sections
  ].join('\n\n')+'\n';
  await fs.writeFile(path.join(output,`${details.label}.md`),document,'utf8');
}
const index=`# AI生成评分标准：提示词导出\n\n本目录由项目真实生成函数离线导出。运行命令：\`node scripts/export-prompts.mjs\`。\n\n## 阅读说明\n\n当前功能根据教师提供的题目和参考答案生成评分标准；answer字段忠实识别已有参考答案，不是无输入自动解题。一般建议写入warnings；影响可执行标准的关键问题写入blockingIssues，无法确定正确答案或给分边界时停止生成可执行标准。\n\n以下为自动区分题型、总分10分、步长1分、无图片的模板快照，题目、答案及分值分配使用明确占位文字，并非当前教师方案。实际请求会带入实际设置和图片；粘贴到其他工具前需替换占位内容并提供对应图片。\n\n## 本次优化\n\n- 四门理科宽松口径：正确答案配相关有效过程应给分，不因过程简略判零。\n- 文科独立模板与宽严分化：语文、英语、政治、历史、地理使用文科专用采分、同义概括与等级评价条款，彻底剥离残留数理过程与错算表述及非必要 LaTeX 要求，并为 `+'`answers`/`holistic`'+` 补齐宽松、正常、严格三档差异。\n- 七科真实阅卷细节补强：补全语文默写/文言/作文、英语应用文/读后续写、化学用语/热化学/实验、生物遗传/光合/对照、政治模块与双层赋分、历史史料/小论文及地理因果链规则。\n- 九学科 26 组可选题型细分（`+'`taskType`'+`）：生成弹窗与阅卷共用细分模板；物理电磁/实验与图像题自动剥离运动学刹车示范。\n- 生成后质量自检（`+'`lintGeneratedRubric`'+`）：自动拦截“酌情扣分”等模糊条款、非分档区间分值与模式冲突，并提示教师确认。\n- 物理按量定义、方向、参考系、零点、实际代入和适用条件核验等价性；接受刹车时用加号公式代入负加速度、负电流表示反向及等价整体变号等自洽写法。\n- 区分做功定义、变化量与减少量、表压与绝对压强、速度与速率等实质差别。\n- 仅将本题相关边界写入各小问，避免把所有专题要求机械加入每题；参考答案识别与核验分开，不静默改原答案，不猜补学生过程。\n\n## 优先查看物理完整提示词\n\n[宽松](physics-lenient.txt) · [正常](physics-normal.txt) · [严格](physics-strict.txt)\n\n## 九学科、三种口径\n\n| 学科 | 宽松 | 正常 | 严格 |\n| --- | --- | --- | --- |\n${Object.entries(rubricSubjects).map(([id,s])=>`| ${s.label} | [查看](${id}-lenient.txt) | [查看](${id}-normal.txt) | [查看](${id}-strict.txt) |`).join('\n')}\n\n[全部27份提示词及示例设置（JSON）](all-prompts.json)\n\n导出与规则传递测试不等于真实模型判分验收；应使用已判分答卷试评。\n`;
await fs.writeFile(path.join(output,'README.md'),index,'utf8');
await fs.appendFile(path.join(output,'README.md'),[
  '\n## 九学科真实阅卷规则更新',
  '已逐科补充真实场景，并同步用于标准生成和阅卷。执行中的规则缺失、矛盾及关键资料缺失使用gradingIssues报告，程序强制转人工确认；不与字迹识别混为一类。',
  ...Object.values(rubricSubjects).map(s=>`- [${s.label}完整 Markdown](${s.label}.md)`),
  '[按学科拆分的 ZIP](九学科提示词-按学科拆分.zip)。在 Windows 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-prompts.ps1` 可重新生成 Markdown 和压缩包。执行策略参数只用于本次进程。'
].join('\n\n')+'\n','utf8');
console.log(`Exported ${entries.length} production prompt snapshots to ${output}`);

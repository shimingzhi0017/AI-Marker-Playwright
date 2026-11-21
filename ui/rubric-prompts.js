import { realWorldReviewPolicy, subjectReviewPolicy, physicsBrakingExample, subjectTaskTypes, taskTypePolicy, isValidTaskType } from './subject-review-rules.js';

export const HUMANITIES_SUBJECTS = new Set(['chinese', 'english', 'politics', 'history', 'geography']);

export function isHumanitiesSubject(subject) {
  return HUMANITIES_SUBJECTS.has(subject);
}

const humanitiesRubricPrompts = {
  strict: '主观题要求核心观点、采分点、文本或材料依据及本题明确限定的模块、主体、词形、格式与字数齐全。生成标准时逐项明确必答内容、遗漏的确定扣分及上限；认可准确同义概括，不强求照抄参考原词，不对本题未要求的条件额外扣分。',
  normal: '主观题要求核心观点准确、关键采分点完整且有效结合文本或材料。核心要点缺失、未按要求联系材料或概念主体错位时按本题明确条款扣分；认可含义一致的同义表述与合理语序，不因未命中参考原词扣分。',
  lenient: '主观题优先识别学生已表达的核心观点、有效采分点与合理文本或材料依据，认可同义概括和简要有效表述；已覆盖核心要求时给该小问满分，不完整时按已体现的有效要点给对应部分分，不得仅因未照抄参考原词判零。默写与限定词形的客观题仍按标准答案逐项判定，作文与开放论述按实际任务维度评价。'
};

export const rubricPrompts = {
  strict: { label:'严格', text:'解答题要求答案正确、必要过程完备，并核对本题适用的单位、原始方程或等价基本关系、符号及条件说明等细节。生成标准时逐项明确必写内容、遗漏的确定扣分及上限；正确结果不能抵消过程或细节失分。认可有效替代解法，不要求照抄参考答案；不对本题不适用的单位或形式要求扣分。' },
  normal: { label:'正常', text:'解答题要求答案正确且必要过程充分。关键方程、必要计算、推理依据或论证环节实际缺失时，即使最终答案正确也按本题明确条款扣分；认可有效合并步骤，不把常规简写、重复说明或不影响含义的格式差异当成必要过程缺失。' },
  lenient: { label:'宽松', text:'需要过程的解答题，只要答案正确且学生实际写出任何与本题相关、有效的过程，就必须给分；不要求过程完整。过程足以支持结论时给该小问满分，否则按已体现的有效内容给部分分，不得判零。完全只写答案、没有过程的过程题，不给过程分，仅按标准明确规定给答案分。客观题仍按答案项判定，证明、实验、论证及写作按其实际任务要求评价。' },
  custom: { label:'自定义', text:'' }
};

export const rubricSubjects = {
  chinese: {
    label:'语文',
    focus:'按题型区分字词、默写、阅读、文言翻译和写作。阅读依据文本与题目设问，翻译区分关键词和句意，写作依据题意、内容、结构与表达；只列本题涉及的要求。',
    strict:'字词和默写按题目要求核对准确书写；阅读逐项明确核心信息及文本依据，翻译明确必要实词、虚词与句式。关键内容缺失或歪曲不给对应分；合理同义概括不因未使用参考答案原词而扣分。',
    normal:'阅读核心信息、文本依据与分析关系正确即可认可不同表述；翻译按关键词与整体句意给分，作文分别评价内容和表达。局部语言问题按本题规则处理，避免同一错误重复扣分。',
    lenient:'充分认可有文本依据的不同理解、合理概括和同义表述，阅读与翻译按已表达的有效信息给对应分。轻微措辞差异不扣分；字词、默写的实质错字、错误句意和偏离题意不能视为正确。'
  },
  mathematics: {
    label:'数学',
    focus:'区分计算求解、证明论证、应用建模等任务，评价关键推理、必要运算及结论，注明定义域、适用条件、检验及作图要求是否为本题必需。按关键数学环节赋分，不按书写行数或每个细碎算式机械给分；认可有效的不同解法。',
    strict:'明确每个必要推理环节、适用条件、解的检验和证明依据。关键论证缺失时不给对应步骤分；结论正确不能替代本题要求的证明过程，符号和范围错误按影响扣分。',
    normal:'依据本题考查目标为关键列式、必要变形、有效推理与结论分配分值，运算正确性本身是考查目标时必须评价，不能只看最初方程。局部计算错误保留已经成立的部分，后续分值按错误对条件、难度和推理有效性的实际影响处理。',
    lenient:'计算求解题答案正确且实际写有任何相关、有效的列式、运算或简要推理时必须给分；过程足以支持结论可给满分，否则按有效内容给部分分，不得因过程不完整判零。完全只写答案时不给过程分。允许省略中间变形、求解计算、常规代入运算和重复说明，不因过程未逐项展开扣分。错误定义域、漏解、增根、无效推理不能放宽。证明题仍需有效的关键论证，按实际写出的有效论证给分，不能只写待证结论；题目明确要求展示的分类讨论、检验或指定步骤仍须满足。'
  },
  english: {
    label:'英语',
    focus:'区分词汇语法、阅读、翻译与写作，明确本题是否限定词形、时态、拼写或字数。阅读以原文证据为准，写作分别评价任务完成、内容组织与语言表达。',
    strict:'词汇语法题明确必需词形、时态、拼写与搭配；阅读和翻译核对关键信息。写作语言错误按其具体影响处理，题目要求唯一形式时不能用意思接近的词替代。',
    normal:'开放性阅读与翻译认可准确的同义表达；写作按内容、结构和语言分项给分。局部语法或拼写错误不直接否定整段有效内容，具体扣分遵循题目要求。',
    lenient:'开放表达充分认可同义替换、合理句式和可理解的简洁表达，轻微语言问题按影响有限处理。不能改变核心语义、否定关系或时间关系；限定词形、拼写的客观题仍按要求核对。'
  },
  physics: {
    label:'物理',
    focus:'区分物理概念、模型、规律选择、列式、计算及实验分析；仅要求本题必要的方向、单位、有效数字与适用条件。认可等价公式和合理解法，公式中的符号含义必须一致。',
    strict:'明确物理模型、规律适用条件、原始方程或等价基本关系及必要方向约定。只有数值代入式或最终结果而缺少标准要求的基本关系时，扣对应过程分；最终有量纲结果缺单位、明确写错单位或缺少必需说明，按生成标准确定条款扣分。有效数字仅在题目或教师明确要求时计分；不同有效解法按其自身基本关系评价。',
    normal:'计算类解答题过程分主要看关键方程和物理关系是否正确，最终结果通常占该小问1—2分，具体遵守教师分配及得分步长；不把每次代入或中间运算单独设分。认可等价公式及不同合理解法。方程正确而局部计算错误时保留方程分，单位问题按明确规则处理，避免同一错误重复扣分。',
    lenient:'物理计算解答题答案正确且实际写有任何相关、有效的物理关系、公式、列式、运算或简要推导时必须给分；过程足以支持结论给满分，否则按已体现的有效内容给部分分，不得因过程不完整判零。完全只写答案时不给过程分。允许省略原始方程的单列、中间代入、常规运算和重复说明。不影响含义的单位省略和符号简写不扣分；不放宽错误物理规律、关键方向、明确的量纲矛盾或题目明确考查的单位。'
  },
  chemistry: {
    label:'化学',
    focus:'区分概念、物质与离子判断、化学用语、方程式、实验和计算。依据本题明确化学式、电荷、配平、反应条件、现象与结论的必要要求。',
    strict:'化学式、电荷、方程式配平及必要反应条件逐项准确核对；实验明确操作目的、现象和推理关系。关键粒子、条件或守恒关系错误不给对应分，不能以意思相近掩盖化学用语错误。',
    normal:'文字解释认可化学含义相同的表述，计算按列式与过程给分，实验按有效操作和证据给分。化学用语的实质错误与一般文字措辞区别处理。',
    lenient:'化学计算、实验分析及需要说明过程的解答题，答案正确且实际写有任何相关、有效的化学关系、方程式、计算、操作依据或简要推理时必须给分；过程足以支持结论给满分，否则按已体现的有效内容给部分分，不得因过程不完整判零。完全只写答案时不给过程分。认可合理同义表述、可行替代操作及有效计算方法；化学式、电荷、守恒关系和关键反应条件错误时按实际有效内容评分，不能猜补缺失内容。'
  },
  biology: {
    label:'生物',
    focus:'区分概念术语、结构功能、机制过程、实验设计与数据解释。依据题目明确对象、条件、变量和因果关系，不能凭常见结论代替本题材料证据。',
    strict:'核心术语、作用对象、机制环节和因果方向准确核对；实验明确必要对照、自变量与因变量。关键机制或实验控制缺失不给对应分，概念混淆不能按表述接近认可。',
    normal:'认可生物学含义相同的表达，机制解释按有效环节给分，实验和数据分析按证据与逻辑分别给分。非关键措辞差异不扣分。',
    lenient:'生物机制、实验分析及需要说明过程的解答题，答案正确且实际写有任何相关、有效的机制环节、证据、实验依据或简要推理时必须给分；过程足以支持结论给满分，否则按已体现的有效内容给部分分，不得因过程不完整判零。完全只写答案时不给过程分。认可含义准确的通俗解释、合理概括和可行实验方案；关键术语指代、因果方向和必要实验控制错误时按实际有效内容评分。'
  },
  politics: {
    label:'政治',
    focus:'区分概念原理、材料分析、论证与措施建议。按本题所需知识范围明确观点、材料证据及二者联系，不能机械套用与材料无关的关键词。',
    strict:'核对核心概念、原理及适用范围，明确材料与观点的对应关系；仅堆砌术语而无本题要求的分析不给相应分析分。关键观点错误或因果关系颠倒不给对应分。',
    normal:'核心观点正确、材料结合恰当即可认可同义表述；按观点、材料分析和论证关系分别给分。措施建议需切合题意，避免同一观点换词重复计分。',
    lenient:'认可有依据的不同论述角度、通俗但准确的概念表达与可行建议，有效分析尽量给对应分。不能把材料无关的套话、错误概念或缺少论证的结论当作完整答案。'
  },
  history: {
    label:'历史',
    focus:'区分史实、时序、背景原因、影响与史料论证，明确题目要求的时间范围、主体和材料依据。认可有史实支持的合理解释，不能用空泛结论替代证据。',
    strict:'关键人物、事件、时间关系和历史概念准确核对，论证需具备必要史料或史实依据。时序错置、主体混淆和因果错误不给对应分。',
    normal:'按准确史实、合理解释与论证分别给分，认可含义一致的概括和有依据的不同角度。表述与参考答案不同但史实逻辑成立时不机械扣分。',
    lenient:'认可符合史实的同义概括、合理多角度解释和简洁论述，已表达的有效史实与分析给对应分。不能放宽关键史实、时序或主体错误，也不补充未写出的论据。'
  },
  geography: {
    label:'地理',
    focus:'区分区域定位、空间关系、自然与人文过程、图表分析及措施建议。依据题目明确尺度、方向、条件、数据单位和因果链，结论必须适用于本题区域与材料。',
    strict:'核对区域、尺度、方向与关键条件，过程解释明确必要因果环节。图表数据、比较对象或空间关系错误不给对应分，措施必须针对材料中的具体问题。',
    normal:'认可地理含义相同的表述，按条件、过程、结论和材料证据分别给分；图表描述与成因分析区别计分，避免同一因素重复给分。',
    lenient:'认可适用于本题区域的合理替代分析、通俗概括和可行措施，已呈现的有效因果环节给对应分。不能放宽错误方向、尺度、关键数据或与本地区条件矛盾的解释。'
  }
};

export function rubricRequirements(subject,strictness='normal') {
  const level=rubricPrompts[strictness];
  if(!level)throw Error('答案要求选项无效');
  if(strictness==='custom')return '';
  if(!subject)return level.text;
  const entry=rubricSubjects[subject];
  if(!entry)throw Error('学科选项无效');
  const levelText=HUMANITIES_SUBJECTS.has(subject)?humanitiesRubricPrompts[strictness]:level.text;
  return `学科：${entry.label}；答案要求：${level.label}。\n${entry.focus}\n${levelText}\n${entry[strictness]}\n只根据本题、参考答案和教师明确设置编写规则；模板不能增加题目未要求的条件。客观题按标准逐项判定，不能擅自增加部分分。宽严不改变总分、分值分配和得分步长，不得猜补看不清或未书写的内容。`;
}

export const rubricScoringMethods = {
  auto: {label:'按题目自动区分', summary:'选择、填空按答案项判定；解答题按小问汇总步骤分；写作按等级评价。', text:'根据题目设问逐小问选择给分方式，不依据单双评设置推断题型。选择、填空等客观项按独立答案逐项正确满分、错误零分；理科计算、证明等解答题以题目中的每个主问题（如（1）、（2））作为一个评分项，在该项标准内部列出公式、推理、计算、结论等步骤分，步骤分合计不得超过该小问满分；阅读、材料分析等按小问汇总要点分；写作等整体评价题列出等级与维度。混合题分别说明各项方式。除非教师明确指定必须使用某种方法，认可经核验正确且适用于本题的等价解法，不因未采用参考答案的方法而扣分。'},
  answers: {label:'按答案逐项给分', summary:'逐空或逐小问核对答案，正确满分、错误零分，认可等价答案。', text:'按答案逐项给分。每个独立答案项只取满分或零分，列出标准答案、可接受的等价答案和判错边界；不拆过程分，不因思路接近增加部分分。'},
  points: {label:'按要点／步骤给分', summary:'按小问列总分，在小问内说明步骤、部分分和扣分边界。', text:'按要点／步骤给分。理科计算、证明等解答题以每个主问题（如（1）、（2））作为顶层评分项，顶层项满分等于该小问总分；公式、推理、计算、结论及错误延续等作为该项内部的评分细则，步骤分合计不得超过小问满分，不要把每个步骤另列为与小问并列的顶层评分项。阅读、材料分析也按题目小问汇总要点分。题内客观选择或填空仍按独立答案项判定，正确满分、错误零分，不擅自增加过程分。对正确且适用于本题的等价解法按相同评分要点给分；仅当题目明确要求指定方法时才限制解法。'},
  holistic: {label:'按等级综合评价', summary:'明确评价维度、等级描述和分数边界，适合作文与开放性论述。', text:'按等级综合评价。仅对写作或开放性论述等适用项设置内容、结构、论证或表达等本题必要维度，明确各等级表现、分数边界及档内给分依据，不能只写笼统的优良中差。非整体评价项仍按题意逐项给分；不强行把填空、计算结果改成等级评分。'}
};

const humanitiesScoringMethodText = {
  auto: '根据题目设问逐小问选择给分方式，不依据单双评设置推断题型。选择、默写、字词与词形填空等客观项按独立答案逐项正确满分、错误零分；阅读、文言翻译、材料分析、区域分析等主观题以每个主问题作为一个顶层评分项，在该项标准内部列出各采分点与材料依据分，要点分合计不得超过该小问满分；作文与观点论述等整体评价题列出维度与等级边界。混合题分别说明各项方式。认可准确且有依据的同义概括与多元合理角度，不因未照抄参考原词扣分。',
  points: '按要点／步骤给分。阅读、文言翻译、材料分析、区域成因与措施等主观题以每个主问题作为顶层评分项，顶层项满分等于该小问总分；核心观点、材料或文本依据、因果论证及限定模块或主体等作为该项内部的采分细则，要点分合计不得超过小问满分，不要把每个零碎采分点另列为与小问并列的顶层评分项。题内默写、选择或限定词形填空仍按独立答案项判定，正确满分、错误零分。认可含义准确的同义概括与合理表达；仅当题目明确限定模块、主体或固定表达时按限定核对。'
};

const teacherRules = '编写顺序：先定顶层评分项及满分（理科解答题默认一主问一项，列式、计算、单位与错算延续为项内细则，仅教师明确要求分开录分时再拆；选择、填空一空一项），再列各项目标、标准答案、等价解法、部分分及扣分边界。除题目限定方法外，认可正确且适用于本题的等价解法，不得仅因解法不同于参考答案而扣分，不认表面相似的无效推导。明确扣分上限，同一错误不得重复扣分，同义不重复计分；各项在0至满分间。忠实保留涂改后有效作答，不得猜补未写或看不清内容；模板不增加题外条件，严格模式写清本题适用的细节及扣分。教师分值、总分与步长须遵守，补充要求冲突时在warnings说明，不静默更改。';

const answersTeacherRules = '编写顺序：先定独立答案项及满分（选择、填空、默写一空一项），再列每项标准答案、可接受的等价表达及明确判错边界。明确扣分与判错边界，同一错误不得重复扣分；各项在0至满分间。忠实保留涂改后有效作答，不得猜补未写或看不清内容；模板不增加题外条件，严格模式写清本题限定字形、词形、符号或单位。教师分值、总分与步长须遵守，补充要求冲突时在warnings说明，不静默更改。';

const holisticTeacherRules = '编写顺序：先定整体评价项及满分，再列本题必要的评价维度（内容立意、结构组织、材料/史实论证、语言表达）、各等级分数边界及档内升降依据；非整体评价项按题意逐项给分。认可符合题意的合理立意与表达差异，明确缺题、字数、偏题或残篇封顶上限，同一错误不得重复扣分；各项在0至满分间。忠实保留涂改后有效作答，不得猜补未写或看不清内容；教师分值、总分与步长须遵守，补充要求冲突时在warnings说明，不静默更改。';

const humanitiesTeacherRules = '编写顺序：先定顶层评分项及满分（主观题默认一主问一项，各采分点、材料/文本结合、同义概括边界与模块/主体限定为项内细则，仅教师明确要求分开录分时再拆；选择、默写、固定词形填空一空一项），再列各项目标、标准答案、可认可等价概括、部分分及不得分边界。明确扣分上限，同一错误不得重复扣分，同义不重复计分；各项在0至满分间。忠实保留涂改后有效作答，不得猜补未写或看不清内容；模板不增加题外条件，严格模式写清本题限定的术语、依据、格式或字数。教师分值、总分与步长须遵守，补充要求冲突时在warnings说明，不静默更改。';

const physicsSolutionPolicy='物理解答题方程与结果赋分规则：仅用于物理计算解答题；选择、填空及不以数值求解为目标的实验、论证题按各自题意评分。教师未另行指定时，过程分主要分配给关键物理方程、必要几何关系与适用条件（等价方程组或合并关系同等覆盖），不把常规代入、移项、解方程、开方或每个中间数值机械拆成独立得分点。有数值结果的小问通常为最终结果预留1—2分（正文明确为1分或2分，不留区间），小问总分、得分步长或教师要求不允许这样分配时以这些约束为准并在warnings说明；实际阅卷按保存条款执行，不得临时重新分配分值。方程与关系正确仅代入或代数算错时，保留方程分只扣受影响的结果分，不能把整个正确方程点判零；沿用错数且后续方法有效不重复扣分。错误物理/几何关系、条件失效或量纲矛盾按实质影响处理；只写答案不补过程分，严格模式另列的细节扣分不据此免除，反馈区分“方程正确、算错/结果错”与“物理关系错”。';

const mathematicsSolutionPolicy='数学解答题关键过程赋分规则：用于数学解答题，选择、填空按独立答案项判分。在小问内依据考查目标为关键列式/建模、等价变形与核心运算、有效推理及结论分配分值，不按每一行或每次加减乘除机械拆分；证明题重点评价依据、推理链及必要分类，应用题核验建模、求解与实际意义检验。正常与严格模式下，仅检查起始方程正确不足以认定已完成后续关键运算；宽松计算求解题允许省略中间变形、常规运算及非必要说明，答案正确且有有效过程按宽松满分条件处理（证明及题设要求步骤仍须满足）。只写终值仅给标准明确允许的分值；不统一规定最终结果占1—2分。三档均核验等价变形、定义域、分类与增根漏解，不从终值猜补关键计算或证明。\n数学错算与步骤依赖规则：遵守题目或教师已明确的细则，不把宽松规则允许的过程省略认定为上游错误。按学生实际解法判断步骤依赖（包括跨小问及间接依赖），不能把参考解法的依赖关系强加给正确的替代解法，保留已成立的过程分。若A是B的必要前提且A错未纠正，B即使运算形式正确或偶然得到正确数值，不得给B完整分值，默认仅可获得少量可独立核验的方法分（上限由标准明确），不能自动保留全部后续分值；若C不依赖错误A且独立成立，C完整正确时给其满分；此规则适用于任意数量步骤（不限于A、B、C三个步骤），纠正上游或从原题条件独立重建有效依据后恢复正常评价，不能因前面出现过错误就永久限分。生成时在小问内部明确各关键步骤的依赖前提、独立方法分及前提错误时的确定上限（上限必须是确定分值、遵守步长，必要时可以为0分，不另增顶层项），并核查错误是否改变定义域、关键条件、分类情况或明显降低后续难度；不因同一偏差逐行追加扣分，不能一律只扣最终结果分，也不能一次算错就把后续全部判零。反馈须写明首错、受影响环节、保留分、具体扣分和小问得分、各依赖步骤限分上限与实得分，以及哪些独立步骤未受影响。';

const solutionMethodsPolicy = '解答题有效解法与合并步骤规则：用于过程题，客观选择、填空仍按独立答案项评分。内部得分点不要求逐式复现：先核验学生实际解法，有效等价方法按体现的学科关系给分，不必经过参考解法的全部中间量。合并公式、消元、整体关系或简洁推导覆盖多个要点时计入对应分值，不因未单列中间量或重复说明扣分；完整正确且满足题目及教师明确要求的解答应得该小问满分。仅实际缺少必要依据才扣分；限定方法或必须展示的环节仍须遵守；只有正确终值而无任何有效过程、无效推导或无法辨认时，不得补过程或判满分。实际阅卷以已保存的各小问具体条款为准，不用新版默认口径改写旧标准或重分配分值。';

const errorCarryPolicy = '解答题错算与错误延续规则：题目或教师已明确规定时按该规定执行。未规定时，局部运算错误只在首次受影响的计分点按该点分值扣分；后续步骤或小问一致沿用该错误数值且方法、条件与后续运算有效时，保留后续分值不再重复扣分；新的独立错误另按对应点处理。错误模型、规律或导致方法失效时不按单纯错算全留后续分。扣分遵守分值与步长，不固定为每次扣1分，反馈须说明首错、实扣及保留依据。';

const solutionFeedbackPolicy = '解答题反馈要求：分清“方法掌握但有细节问题”与“核心方法/推理错误”，不能仅因细节扣分就笼统评价为不会解题。凡扣分，comment和scoringDetails.reason须写清实际写法或遗漏、对应哪条评分标准、具体扣几分及小问实得分，不得只写“不规范”“酌情扣分”。细节不影响思路时先肯定方法再给建议；宽松接受的省略可提建议但须明确“不扣分”，不得暗扣；无法辨认报识别疑点，不猜测。';

const lenientSolutionPolicy = '宽松模式下的解答题：优先看学生是否掌握解题方法。需过程的计算求解题，只要最终答案正确，且学生实际写出任何与本题相关、经核验有效的公式、列式、运算或简要推理，就必须给分；不因省略中间步、过程过于简略或未达到参考步骤数量而判零。若这段有效过程足以支持结论，应给该小问满分；否则给有效部分分，不得把“未得满分”处理成“不得分”。完全没有写过程、只写最终答案的过程题，不给过程分，仅可按标准给明确答案分，不得在识别文本中补写步骤。常规代入运算及重复说明可以省略；不影响含义的单位省略与简写不扣分，题目明确考查的单位仍按标准评分。';

const normalSolutionPolicy = '正常模式下的解答题：答案正确且必要过程充分才能得满分。各小问明确关键方程、必要计算或论证及实际缺失扣分上限，实际缺失时最终答案正确也不能免除此类扣分。有效合并式或简洁推导已体现必要依据时正常计分，不能把“未单列”和“确实缺失”混同；常规代入、重复说明及含义明确的单位省略通常不扣，题设明确要求的单位、原始方程或证明仍须满足。因过程缺失失分时须明确说明“方法正确”及具体缺失与分值。';

const strictSolutionPolicy = '严格模式下的解答题：答案正确、必要过程完备且本题适用的细节齐全才给满分。生成时明确应写的原始方程或等价基本关系、有量纲终值单位、必要符号与条件及缺失确定扣分和上限；即使答案对，漏写已明确要求的单位或基本关系也须扣分。有效数字等按题设或教师要求；不同解法按自身基本关系评价，不强制照抄参考方程或无量纲硬加单位。各项细节扣分须纳入已有小问分值和步长，写清合并上限且不重复扣分，反馈须明确说明“方法正确”或方法错误及扣分依据。';

const solutionStrictnessPolicies = new Map([
  ['lenient',lenientSolutionPolicy],
  ['normal',normalSolutionPolicy],
  ['strict',strictSolutionPolicy]
]);

const physicsVectorPolicy = '物理矢量与正负号判定规则：结合公式、代入、图示与上下文区分有符号分量与大小，核对同一方向约定是否自洽，不按参考公式表面加减号判错。以初速度为正时，v=v0+at取负a（如v0=20、a=-4、t=3得v=20+(-4)*3=8）与令减速度大小b=4写v=v0-bt两种自洽写法同等认可。未单列文字声明但实际代入20-4*3或图示已体现负加速度时，宽松和正常模式不扣分；严格模式仅在保存标准明确要求单列方向说明时按该细节扣分，不得否定正确关系。若符号方向矛盾或用正大小代入+at，按受影响点扣分，不能因终值碰巧正确而认可错误推导；只有终值看不到代入依据时不得反推学生使用了负加速度。刹车停止后静止的题目须核对停止时间，禁止将制动公式延伸至停车后解释为倒车。';

const physicsEquivalencePolicy = [
  '物理含义与等价表达核验：先识别所求量、对象与过程区间，再核对定义、正方向、参考系、零点、适用条件及公式代入结论；只采纳已写内容，不强求重复声明已明约定。',
  '方向与定义：速度、位移、力等分量可用负值或正大小配方向表达，不与速率、路程混同；负电流可表示实际方向相反，回路变向或方程整体变号自洽即可认可。区分力做功与克服做功、变化量与减少量、外界对系统做功与系统对外做功；核对电势/势能零点差值、参考系转换、表压与绝对压强须按定义转换及自洽光学符号。',
  '等价边界：平均速度/速率、位移/路程仅在题设相等时可换；单位不同先核换算，近似、有效数字与容差依题设或教师要求，不能自行设置固定容差，错误近似或区间不用终值抵消。生成时仅把本题相关项写入items.criteria，不把所有物理专题例子机械加入每道题；反馈写清约定与依据。'
].join('\n');

const subjectSolutionPolicies = new Map([
  ['physics', {grading:[physicsSolutionPolicy,physicsBrakingExample,physicsVectorPolicy,physicsEquivalencePolicy].join('\n'), carry:errorCarryPolicy}],
  ['mathematics', {grading:mathematicsSolutionPolicy, carry:''}]
]);

function physicsSolutionPolicyFor(taskType) {
  const excludeBraking = Boolean(taskType && subjectTaskTypes.physics?.[taskType]?.excludeBraking);
  return (excludeBraking
    ? [physicsSolutionPolicy, physicsVectorPolicy, physicsEquivalencePolicy]
    : [physicsSolutionPolicy, physicsBrakingExample, physicsVectorPolicy, physicsEquivalencePolicy]
  ).join('\n');
}

const sufficientEvidencePolicy='宽松和正常口径的满分判断先于逐点扣分：先核结论，再查公式、代入、中间量、图示及归属明确的前问结果是否已充分体现必要关系；满足即可直接给该小问满分，不因未另写重复文字或叙述顺序不同扣分。两档均不凭印象猜补实际缺失的关键依据；确有缺失、实质错误或违背题设/教师指定要求时，指明具体缺失的学科关系后按条款处理，纯表达建议注明不扣分。';

const executableRubricPolicy='评分标准执行顺序：先判适用整体满分条件，再对应独立得分点；写清可观察证据、分值、前提与“同时/任一满足”，替代解法互斥路径不叠加，任选要点写明计数上限；同一要点不改名重复计分。最后核对合计与依赖，不从预估总分倒推；等级题按档界与升降依据评分。扣分须对应当前口径适用条款，标准不明报告疑点，不编造罚分。';

const answersModePolicy = '按答案逐项给分规则：仅按每个独立答案项判定正确满分或错误零分；列清标准答案、可接受的等价表达及判错边界。不设过程分、不拆步骤分，不套用解答题的错算延续或充分证据部分分规则；不得猜补看不清或未书写的内容。';

const answersStrictnessPolicies = new Map([
  ['lenient', '按答案逐项给分（宽松）：充分认可学科等价写法、同义表述及无歧义简写，可辨认潦草不误判。'],
  ['normal', '按答案逐项给分（正常）：认可常规等价写法与单位换算，限定词形、字形、符号或格式仍须准确。'],
  ['strict', '按答案逐项给分（严格）：准确核对大小写、字形拼写、词形时态、正负符号与题目限定单位，缺写按明确条款判错。']
]);

const answersRuleWritingPolicy = '客观选择、填空不套用解答题过程要求；写作、开放论述按题型评价，不生搬数值结果和原始方程要求。逐项写清标准答案、可接受等价表达与明确判错边界，执行正文中不得以“建议扣分”“建议不再扣分”“酌情扣分”或多个未选定方案代替确定条款；确实缺少关键条件、无法制定一致规则时，在warnings提出问题，不得把待定条款混入执行标准。';

const holisticModePolicy = '按等级综合评价规则：仅依据本题必要维度（内容、结构、论证、表达等）、清晰档次边界及档内升降依据评分，认可合理的立意角度与表达差异，同一问题不跨维度重复扣分；非整体评价项按题意逐项给分，不套用理科计算步骤分或错算延续模板。';

const holisticStrictnessPolicies = new Map([
  ['lenient', '等级评价倾向（宽松）：先肯定立意、核心要点与有效论证，局部语言或衔接瑕疵从宽，符合本档核心特征时宜取档内偏上分值。'],
  ['normal', '等级评价倾向（正常）：均衡评估内容、结构、论证与语言表达，切合本档边界居间赋分，不随意跨档升降。'],
  ['strict', '等级评价倾向（严格）：紧扣题意文体、论证深度、逻辑与规范要求分档，缺失关键要素或明显瑕疵按明确条款降档或扣分。']
]);

const holisticRuleWritingPolicy = '客观选择、填空不套用解答题过程要求；写作、开放论述按题型评价，不生搬数值结果和原始方程要求。写清各评价维度、等级表现、分数边界与档内升降依据，避免笼统优良中差；执行正文中不得以“建议扣分”“酌情扣分”或多个未选定方案代替确定条款，缺关键条件时在warnings提出。';

const humanitiesPointsPolicy = '文科与综合要点评分规则：依据设问角度、限定模块（防跨模块套答）、核心概念与材料/史实结合分点给分，默写与客观项仍按答案项判分；认可含义准确的同义概括与不同语序表达，同义不重复计分，局部错误只影响对应要点。';

const humanitiesStrictnessPolicies = new Map([
  ['lenient', '宽松模式下的文科答题：优先识别核心观点、关键采分点与合理图文依据，认可同义概括和简要有效表述；非默写题的轻微措辞或局部非关键错别字不扣分，切勿因未命中参考答案原词而判零。'],
  ['normal', '正常模式下的文科答题：依据采分点核对核心观点、材料联系与因果论证；认可含义一致的等价表达，缺失关键要点、未按要求联系材料或概念主体错位按明确条款扣分。'],
  ['strict', '严格模式下的文科答题：准确核对核心术语、文本/史料依据、逻辑层次及限定模块、主体、格式或字数要求；不强求照搬参考答案原词，但核心表达缺失或分析不到位按标准扣分。']
]);

const humanitiesEvidencePolicy = '文科与综合要点满分先核查：核查学生作答是否已覆盖本题所需的核心观点、关键采分点及必要材料/史实依据；已完整体现即给该要点或小问满分，不因语序、句式或未照抄参考原词扣分，确实缺失要点或背离题意再按条款扣分。';

const humanitiesFeedbackPolicy = '评分反馈要求：分清“核心观点/采分点正确但表述有细节瑕疵”与“核心观点错误/未联系材料/偏离设问”。凡扣分，comment和scoringDetails.reason须写明实际作答与遗漏、对应哪条评分标准、具体扣几分及实得分；宽松认可的等价概括可提建议但须明确“不扣分”，不得暗扣；无法辨认报识别疑点，不猜测。';

const humanitiesRuleWritingPolicy = '文科与综合题标准须按小问写明各采分点、可认可的等价概括、模块与主体限定，并将宽严落实到正文（宽松写清等价与宽容边界，正常写清要点与材料结合要求，严格写清术语、依据与细节扣分上限）；默写/客观题按答案项判分，写作按维度定档并明确缺题/字数等硬条款；不生搬数理过程与错算延续规则，不得出现“酌情扣分”。';

export function solutionGradingPolicy({subject='',strictness='normal',useCustomPrompt=false,scoringMethod='auto',taskType=''}={}) {
  const feedbackPolicy = HUMANITIES_SUBJECTS.has(subject) ? humanitiesFeedbackPolicy : solutionFeedbackPolicy;
  const taskPolicy = useCustomPrompt ? '' : taskTypePolicy(subject, taskType);
  if (scoringMethod === 'answers') {
    const strictnessPolicy = useCustomPrompt
      ? '给分边界遵守教师自定义要求。'
      : [answersModePolicy, answersStrictnessPolicies.get(strictness) || answersStrictnessPolicies.get('normal')].join('\n');
    return [
      realWorldReviewPolicy,
      strictnessPolicy,
      subject === 'physics' ? physicsEquivalencePolicy : '',
      useCustomPrompt ? '' : subjectReviewPolicy(subject),
      taskPolicy,
      executableRubricPolicy,
      feedbackPolicy
    ].filter(Boolean).join('\n');
  }
  if (scoringMethod === 'holistic') {
    const strictnessPolicy = useCustomPrompt
      ? '给分边界遵守教师自定义要求。'
      : [holisticModePolicy, holisticStrictnessPolicies.get(strictness) || holisticStrictnessPolicies.get('normal')].join('\n');
    return [
      realWorldReviewPolicy,
      strictnessPolicy,
      useCustomPrompt ? '' : subjectReviewPolicy(subject),
      taskPolicy,
      executableRubricPolicy,
      feedbackPolicy
    ].filter(Boolean).join('\n');
  }
  if (HUMANITIES_SUBJECTS.has(subject)) {
    const strictnessPolicy = useCustomPrompt
      ? '要点与给分边界遵守教师自定义要求。'
      : humanitiesStrictnessPolicies.get(strictness) || humanitiesStrictnessPolicies.get('normal');
    return [
      realWorldReviewPolicy,
      humanitiesPointsPolicy,
      strictnessPolicy,
      !useCustomPrompt && ['lenient','normal'].includes(strictness) ? humanitiesEvidencePolicy : '',
      useCustomPrompt ? '' : subjectReviewPolicy(subject),
      taskPolicy,
      executableRubricPolicy,
      humanitiesFeedbackPolicy
    ].filter(Boolean).join('\n');
  }
  const policy = subjectSolutionPolicies.get(subject);
  const subjectGrading = subject === 'physics' ? physicsSolutionPolicyFor(taskType) : policy?.grading;
  const strictnessPolicy = useCustomPrompt
    ? '解答题宽严与给分边界遵守教师自定义要求。'
    : solutionStrictnessPolicies.get(strictness) || normalSolutionPolicy;
  // Mathematics uses dependency-based limits instead of the generic carry rule.
  return [
    realWorldReviewPolicy,
    solutionMethodsPolicy,
    policy?.carry ?? errorCarryPolicy,
    strictnessPolicy,
    !useCustomPrompt && ['lenient','normal'].includes(strictness) ? sufficientEvidencePolicy : '',
    subjectGrading,
    useCustomPrompt ? '' : subjectReviewPolicy(subject),
    taskPolicy,
    executableRubricPolicy,
    solutionFeedbackPolicy
  ].filter(Boolean).join('\n');
}

export const solutionRuleWritingPolicy='过程题标准须写明有效解法、合并步骤与错算延续条款，避免逐字照搬参考步骤；并将所选宽严落实到各小问正文（宽松写清简要有效过程满分条件，正常写清不可缺少的依据与扣分，严格补充本题适用细节及扣分，不把三档写成同一套要求）。客观选择、填空不套用解答题过程要求；写作、开放论述按题型评价，不生搬数值与原始方程。写定首错扣分点、后续保留条件与新错规则（未指定按默认并在warnings说明）；执行正文中不得以“建议扣分”“酌情扣分”或未定方案代替确定条款，缺条件在warnings提出，不擅改教师原意。';

export function rubricPolicy({subject='',strictness='normal',scoringMethod='auto',taskType='',notes='',useCustomPrompt=false,customRequirements='' }={}) {
  if(!Object.hasOwn(rubricScoringMethods,scoringMethod))throw Error('给分方式选项无效');
  if(taskType && !isValidTaskType(subject,taskType))throw Error('题型细分选项无效');
  if(typeof notes!=='string'||notes.length>2000)throw Error('本题补充要求最多2000字');
  if(typeof customRequirements!=='string'||customRequirements.length>6000)throw Error('自定义提示词最多6000字');
  const template=useCustomPrompt?customRequirements.trim():rubricRequirements(subject,strictness);
  if(!template)throw Error('请填写自定义提示词');
  const methodText = HUMANITIES_SUBJECTS.has(subject) && Object.hasOwn(humanitiesScoringMethodText, scoringMethod)
    ? humanitiesScoringMethodText[scoringMethod]
    : rubricScoringMethods[scoringMethod].text;
  const activeTeacherRules = scoringMethod === 'answers'
    ? answersTeacherRules
    : scoringMethod === 'holistic'
      ? holisticTeacherRules
      : HUMANITIES_SUBJECTS.has(subject)
        ? humanitiesTeacherRules
        : teacherRules;
  const writingPolicy = scoringMethod === 'answers'
    ? answersRuleWritingPolicy
    : scoringMethod === 'holistic'
      ? holisticRuleWritingPolicy
      : HUMANITIES_SUBJECTS.has(subject)
        ? humanitiesRuleWritingPolicy
        : solutionRuleWritingPolicy;
  return `${template}\n给分方式：${rubricScoringMethods[scoringMethod].label}。${methodText}\n${activeTeacherRules}\n${solutionGradingPolicy({subject,strictness,useCustomPrompt,scoringMethod,taskType})}\n${writingPolicy}\n编写标准时，将上述宽严口径落实为各小问可执行的细节容错范围、实际扣分条款和反馈要求，而不是只在末尾标注“宽松/严格”。${notes.trim()?`\n本题补充要求（教师填写）：${notes.trim()}`:''}`;
}

export function rubricGenerationSettings(saved={}) {
  const subject=Object.hasOwn(rubricSubjects,saved.subject)?saved.subject:'';
  const taskType=typeof saved.taskType==='string' && isValidTaskType(subject,saved.taskType)?saved.taskType:'';
  const strictness=Object.hasOwn(rubricPrompts,saved.strictness)&&saved.strictness!=='custom'?saved.strictness:'normal';
  const template=rubricRequirements(subject,strictness);
  const previousText={normal:'按通常教学与考试要求评分。核心概念、逻辑和结果正确即可认可合理等价表述；主观题按正确步骤给部分分。非关键措辞差异不扣分；单位、必要条件等按题目要求明确处理。',lenient:'在不改变正确答案的前提下，充分认可合理同义表述、数学等价式、简写和有效解法；主观题核心思路正确的步骤尽量给对应部分分。轻微措辞或非关键格式问题不扣分，但错误结论、缺失关键条件不能当作正确。'};
  const baseLevelText=HUMANITIES_SUBJECTS.has(subject)?humanitiesRubricPrompts[strictness]:rubricPrompts[strictness].text;
  const legacyScienceTemplate=HUMANITIES_SUBJECTS.has(subject)?template.replace(humanitiesRubricPrompts[strictness],rubricPrompts[strictness].text):'';
  const previousTemplate=previousText[strictness]?template.replace(baseLevelText,previousText[strictness]):template;
  const legacyCustom=saved.version!==2 && typeof saved.requirements==='string' && (saved.strictness==='custom'||(saved.requirements!==template&&saved.requirements!==previousTemplate&&(!legacyScienceTemplate||saved.requirements!==legacyScienceTemplate)));
  return {version:2,subject,taskType,strictness,scoringMethod:Object.hasOwn(rubricScoringMethods,saved.scoringMethod)?saved.scoringMethod:'auto',notes:saved.notes||'',useCustomPrompt:saved.version===2?!!saved.useCustomPrompt:legacyCustom,customRequirements:saved.customRequirements??(legacyCustom?saved.requirements:''),scoreAllocation:saved.scoreAllocation||''};
}

// The saved rubric is the marking contract. Use this resolver both when the
// editor reopens it and when the server builds the actual grading request.
export function rubricGradingSettings(rubric, saved={}, strictnessOverride='') {
  const settings=rubricGenerationSettings(saved);
  // Some imported presets have the explicit switch without a version tag.
  if(typeof saved.useCustomPrompt==='boolean')settings.useCustomPrompt=saved.useCustomPrompt;
  const text=typeof rubric==='string'?rubric:rubric?.text || '';
  const mode=text.match(/(?:评分口径|答案要求)[：:]\s*(宽松|正常|严格|自定义)/u)?.[1];
  const subject=text.match(/^[\t ]*学科[：:][\t ]*([^。；;\r\n]+)/mu)?.[1]?.trim();
  const taskLabel=text.match(/^[\t ]*题型细分[：:][\t ]*([^。；;\r\n]+)/mu)?.[1]?.trim();
  const method=text.match(/(?:给分方式为|给分方式[：:])[\t ]*([^。；;\r\n]+)/u)?.[1]?.trim();
  if(subject)settings.subject=Object.entries(rubricSubjects).find(([,entry])=>entry.label===subject)?.[0] || '';
  if(taskLabel){
    settings.taskType=Object.entries(subjectTaskTypes[settings.subject] || {}).find(([,entry])=>entry.label===taskLabel)?.[0] || '';
  } else if(!isValidTaskType(settings.subject,settings.taskType)){
    settings.taskType='';
  }
  if(mode){
    settings.useCustomPrompt=mode==='自定义';
    if(!settings.useCustomPrompt)settings.strictness=({宽松:'lenient',正常:'normal',严格:'strict'})[mode];
  }
  if(method)settings.scoringMethod=Object.entries(rubricScoringMethods).find(([,entry])=>entry.label===method)?.[0] || settings.scoringMethod;
  if(['lenient','normal','strict'].includes(strictnessOverride)){
    settings.strictness=strictnessOverride;
    settings.useCustomPrompt=false;
  }
  return settings;
}

export function gradingPolicyForRubric(rubric, saved={}, strictnessOverride='') {
  const settings=rubricGradingSettings(rubric,saved,strictnessOverride);
  const text=typeof rubric==='string'?rubric:rubric?.text || '';
  const cleanedText=stripEmbeddedPolicyTemplates(text,{strictness:strictnessOverride});
  const policy=solutionGradingPolicy(settings);
  const method=rubricScoringMethods[settings.scoringMethod];
  const boundary=settings.scoringMethod==='answers'
    ? '按答案逐项给分不设过程分，不套用其他模板的过程分或错算延续部分分。'
    : settings.scoringMethod==='holistic'
      ? '按等级综合评价依已保存维度、档次边界与档内升降依据评分，不套用理科计算步骤分或错算延续部分分。'
      : '只在已保存标准适用的任务和评分点内采用过程、要点或等级评价，不重新分配分值。';
  return [cleanedText.includes(policy)?'':policy,`本次给分方式：${method.label}。${boundary}已保存标准的明确条款优先，规则冲突按gradingIssues报告。`].filter(Boolean).join('\n');
}

export function activeGradingMode(config) {
  const settings=rubricGradingSettings(config.rubric,config.rubricGeneration,config.scoring?.strictness);
  return settings.useCustomPrompt?'custom':settings.strictness;
}

export function gradingModeInstruction(config) {
  const mode=activeGradingMode(config);
  return `本次实际阅卷口径：${rubricPrompts[mode].label}（${mode}）。整个评分、复评和仲裁均执行此口径，不能自行切换宽严。${config.scoring?.strictness?'教师已明确选择实际阅卷口径，优先于旧标准中的模式标记和仅适用于其他模式的模板条款；按本次口径解释常规过程与细节要求。题目或教师特别指定的必写内容、方法限制和分值仍保留，无法兼容时报告gradingIssues，不静默改用其他模式。':''}输出gradingMode字段填写实际执行的口径；扣分前核对该扣分是否被本次口径允许。`;
}

let cachedEmbeddedPolicyLines = null;
function embeddedPolicyLineSet() {
  if (cachedEmbeddedPolicyLines) return cachedEmbeddedPolicyLines;
  const blocks = [
    realWorldReviewPolicy,
    physicsSolutionPolicy,
    physicsBrakingExample,
    mathematicsSolutionPolicy,
    solutionMethodsPolicy,
    errorCarryPolicy,
    solutionFeedbackPolicy,
    lenientSolutionPolicy,
    normalSolutionPolicy,
    strictSolutionPolicy,
    physicsVectorPolicy,
    physicsEquivalencePolicy,
    sufficientEvidencePolicy,
    executableRubricPolicy,
    answersModePolicy,
    ...answersStrictnessPolicies.values(),
    answersRuleWritingPolicy,
    holisticModePolicy,
    ...holisticStrictnessPolicies.values(),
    holisticRuleWritingPolicy,
    humanitiesPointsPolicy,
    ...humanitiesStrictnessPolicies.values(),
    humanitiesEvidencePolicy,
    humanitiesFeedbackPolicy,
    humanitiesRuleWritingPolicy,
    solutionRuleWritingPolicy,
    teacherRules,
    answersTeacherRules,
    holisticTeacherRules,
    humanitiesTeacherRules,
    '只根据本题、参考答案和教师明确设置编写规则；模板不能增加题目未要求的条件。客观题按标准逐项判定，不能擅自增加部分分。宽严不改变总分、分值分配和得分步长，不得猜补看不清或未书写的内容。',
    '编写标准时，将上述宽严口径落实为各小问可执行的细节容错范围、实际扣分条款和反馈要求，而不是只在末尾标注“宽松/严格”。',
    ...Object.values(rubricPrompts).map(p => p.text),
    ...Object.values(humanitiesRubricPrompts),
    ...Object.values(rubricScoringMethods).flatMap(m => [m.text, `给分方式：${m.label}。${m.text}`]),
    ...Object.entries(humanitiesScoringMethodText).flatMap(([k, t]) => [t, `给分方式：${rubricScoringMethods[k].label}。${t}`]),
    ...Object.keys(rubricSubjects).flatMap(s => [
      subjectReviewPolicy(s),
      rubricSubjects[s].focus,
      rubricSubjects[s].strict,
      rubricSubjects[s].normal,
      rubricSubjects[s].lenient
    ]),
    ...Object.values(subjectTaskTypes).flatMap(map => Object.values(map).map(t => t.guidance))
  ];
  const lines = new Set();
  for (const block of blocks) {
    if (!block) continue;
    for (const line of String(block).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) lines.add(trimmed);
    }
  }
  cachedEmbeddedPolicyLines = lines;
  return lines;
}

/**
 * Strip duplicate/stale built-in policy paragraphs (and conflicting mode headers
 * when overridden) at prompt assembly time without mutating the saved rubric.
 */
export function stripEmbeddedPolicyTemplates(rubric, options = {}) {
  const raw = typeof rubric === 'string' ? rubric : (rubric?.text || '');
  if (!raw) return '';
  const policyLines = embeddedPolicyLineSet();
  const overrideLabel = ['lenient', 'normal', 'strict'].includes(options.strictness)
    ? rubricPrompts[options.strictness].label
    : '';
  const modePattern = /(?:评分口径|答案要求)[：:]\s*(宽松|正常|严格|自定义)(?:\s*[；;。.]?\s*)?/gu;

  const cleaned = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) {
      if (cleaned.length && cleaned[cleaned.length - 1] !== '') cleaned.push('');
      continue;
    }
    if (policyLines.has(line)) continue;
    if (overrideLabel) {
      let changed = false;
      line = line.replace(modePattern, (match, foundLabel) => {
        if (foundLabel === overrideLabel) return match;
        changed = true;
        return '';
      });
      if (changed) {
        line = line.replace(/[；;]+([。.])/g, '$1').replace(/^[；;。.\s]+|[；;\s]+$/g, '').trim();
        if (!line) continue;
      }
    }
    cleaned.push(line);
  }
  while (cleaned.length && cleaned[cleaned.length - 1] === '') cleaned.pop();
  return cleaned.join('\n');
}

export const rubricPrompts = {
  strict: { label:'严格', text:'严格核对答案的关键条件、概念、单位和必要步骤；遗漏影响结论的要点时不给对应分。明确每项必需内容，不因表述接近而视为正确。数学等价式和含义完全相同的表述应认可，不要求逐字照抄。' },
  normal: { label:'正常', text:'按通常教学与考试要求评分。核心概念、逻辑和结果正确即可认可合理等价表述。非关键措辞差异不扣分；单位、必要条件等按题目要求明确处理，是否给部分分遵循所选给分方式。' },
  lenient: { label:'宽松', text:'在不改变正确答案的前提下，充分认可合理同义表述、数学等价式、简写和有效解法。轻微措辞或非关键格式问题不扣分，但错误结论、缺失关键条件不能当作正确，不能超出所选给分方式增加部分分。' },
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
    focus:'区分最终结果、推理过程、计算和证明，注明定义域、条件、单位及作图要求是否为本题必需。认可数学等价式与有效的不同解法，不能只按参考解法逐字匹配。',
    strict:'明确每个必要推理环节、适用条件、解的检验和证明依据。关键论证缺失时不给对应步骤分；结论正确不能替代本题要求的证明过程，符号和范围错误按影响扣分。',
    normal:'按正确列式、推理与计算分配步骤分。局部计算错误按本题规则处理，后续若方法仍成立，可给相应方法分，避免把同一错误造成的后果重复扣分。',
    lenient:'认可简洁推导、等价表达和有效替代解法，已明确展示的正确思路尽量给对应步骤分。非关键书写格式不扣分；不得补写学生省略的关键证明，也不能忽略错误定义域、漏解或增根。'
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
    strict:'明确物理模型、规律适用条件、关键方程及方向约定；关键条件或方程错误不给对应分。单位、方向和有效数字按题目规定列出扣分，不凭未写出的步骤推断正确过程。',
    normal:'按正确规律、列式、计算与结论分别给分，等价公式及不同合理解法认可。局部计算错误可保留已展示的正确方法分，单位问题按明确规则扣分，避免同一错误重复扣分。',
    lenient:'充分认可物理意义明确的公式变形、简写和简洁推导；已表达的正确建模与列式给对应步骤分。非关键格式差异不扣分；不放宽错误物理规律、关键方向、量纲或题目明确要求的单位。'
  },
  chemistry: {
    label:'化学',
    focus:'区分概念、物质与离子判断、化学用语、方程式、实验和计算。依据本题明确化学式、电荷、配平、反应条件、现象与结论的必要要求。',
    strict:'化学式、电荷、方程式配平及必要反应条件逐项准确核对；实验明确操作目的、现象和推理关系。关键粒子、条件或守恒关系错误不给对应分，不能以意思相近掩盖化学用语错误。',
    normal:'文字解释认可化学含义相同的表述，计算按列式与过程给分，实验按有效操作和证据给分。化学用语的实质错误与一般文字措辞区别处理。',
    lenient:'开放解释与实验分析充分认可合理同义表述、可行替代操作及有效计算方法。轻微非关键措辞不扣分；化学式、电荷、守恒关系和关键反应条件仍须正确，不能猜补缺失内容。'
  },
  biology: {
    label:'生物',
    focus:'区分概念术语、结构功能、机制过程、实验设计与数据解释。依据题目明确对象、条件、变量和因果关系，不能凭常见结论代替本题材料证据。',
    strict:'核心术语、作用对象、机制环节和因果方向准确核对；实验明确必要对照、自变量与因变量。关键机制或实验控制缺失不给对应分，概念混淆不能按表述接近认可。',
    normal:'认可生物学含义相同的表达，机制解释按有效环节给分，实验和数据分析按证据与逻辑分别给分。非关键措辞差异不扣分。',
    lenient:'认可核心含义准确的通俗解释、合理概括和可行实验方案，已明确表达的机制与证据给对应分。关键术语指代、因果方向和必要实验控制不能放宽。'
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
  return `学科：${entry.label}；答案要求：${level.label}。\n${entry.focus}\n${level.text}\n${entry[strictness]}\n只根据本题、参考答案和教师明确设置编写规则；模板不能增加题目未要求的条件。客观题按标准逐项判定，不能擅自增加部分分。宽严不改变总分、分值分配和得分步长，不得猜补看不清或未书写的内容。`;
}

export const rubricScoringMethods = {
  auto: {label:'按题目自动区分', summary:'选择、填空逐项判定；解答、阅读按要点给分；写作明确等级标准。', text:'根据题目设问逐小问选择给分方式，不依据单双评设置推断题型。选择、填空等客观项逐项正确满分、错误零分；解答、阅读等主观项按必要要点或步骤给分；写作等整体评价题列出等级与维度。混合题分别说明各项方式。'},
  answers: {label:'按答案逐项给分', summary:'逐空或逐小问核对答案，正确满分、错误零分，认可等价答案。', text:'按答案逐项给分。每个独立答案项只取满分或零分，列出标准答案、可接受的等价答案和判错边界；不拆过程分，不因思路接近增加部分分。'},
  points: {label:'按要点／步骤给分', summary:'列清得分点、部分分和扣分边界，适合解答题、阅读与材料分析。', text:'按要点／步骤给分。主观项列出独立且可核对的知识要点、推理步骤或材料依据，说明各得分点满分、部分满足与不给分的条件。题内客观选择或填空仍正确满分、错误零分，不擅自增加过程分。'},
  holistic: {label:'按等级综合评价', summary:'明确评价维度、等级描述和分数边界，适合作文与开放性论述。', text:'按等级综合评价。仅对写作或开放性论述等适用项设置内容、结构、论证或表达等本题必要维度，明确各等级表现、分数边界及档内给分依据，不能只写笼统的优良中差。非整体评价项仍按题意逐项给分；不强行把填空、计算结果改成等级评分。'}
};

const teacherRules = '编写顺序：先按题目顺序确定独立评分项及标准答案，再列可接受的等价表述或替代解法，最后明确给分与扣分条件。学科模板中关于步骤、过程和语言错误的要求，只在本题及所选给分方式适用时采用，不能给客观答案项添加步骤分。\n对适用的过程题明确一次错算对后续方法分的影响；若题目与教师未说明，提出建议并在warnings请教师确认。对适用的扣分项明确扣分上限，同一错误不得重复扣分；同义要点不得重复计分，各项最低零分、最高该项满分。\n忠实保留学生实际书写，完整检查题内答题区域的涂改与移位；不得猜补看不清或未书写的内容，不以标准答案反推学生答案。模板不能增加题目未要求的单位、格式或必要条件。教师分值分配、总分及得分步长必须遵守；教师补充与题意、参考答案或给分方式冲突时在warnings说明，不得静默更改。';

export function rubricPolicy({subject='',strictness='normal',scoringMethod='auto',notes='',useCustomPrompt=false,customRequirements='' }={}) {
  if(!Object.hasOwn(rubricScoringMethods,scoringMethod))throw Error('给分方式选项无效');
  if(typeof notes!=='string'||notes.length>2000)throw Error('本题补充要求最多2000字');
  if(typeof customRequirements!=='string'||customRequirements.length>6000)throw Error('自定义提示词最多6000字');
  const template=useCustomPrompt?customRequirements.trim():rubricRequirements(subject,strictness);
  if(!template)throw Error('请填写自定义提示词');
  return `${template}\n给分方式：${rubricScoringMethods[scoringMethod].label}。${rubricScoringMethods[scoringMethod].text}\n${teacherRules}${notes.trim()?`\n本题补充要求（教师填写）：${notes.trim()}`:''}`;
}

export function rubricGenerationSettings(saved={}) {
  const subject=Object.hasOwn(rubricSubjects,saved.subject)?saved.subject:'';
  const strictness=Object.hasOwn(rubricPrompts,saved.strictness)&&saved.strictness!=='custom'?saved.strictness:'normal';
  const template=rubricRequirements(subject,strictness);
  const previousText={normal:'按通常教学与考试要求评分。核心概念、逻辑和结果正确即可认可合理等价表述；主观题按正确步骤给部分分。非关键措辞差异不扣分；单位、必要条件等按题目要求明确处理。',lenient:'在不改变正确答案的前提下，充分认可合理同义表述、数学等价式、简写和有效解法；主观题核心思路正确的步骤尽量给对应部分分。轻微措辞或非关键格式问题不扣分，但错误结论、缺失关键条件不能当作正确。'};
  const previousTemplate=previousText[strictness]?template.replace(rubricPrompts[strictness].text,previousText[strictness]):template;
  const legacyCustom=saved.version!==2 && typeof saved.requirements==='string' && (saved.strictness==='custom'||saved.requirements!==template&&saved.requirements!==previousTemplate);
  return {version:2,subject,strictness,scoringMethod:Object.hasOwn(rubricScoringMethods,saved.scoringMethod)?saved.scoringMethod:'auto',notes:saved.notes||'',useCustomPrompt:saved.version===2?!!saved.useCustomPrompt:legacyCustom,customRequirements:saved.customRequirements??(legacyCustom?saved.requirements:''),scoreAllocation:saved.scoreAllocation||''};
}

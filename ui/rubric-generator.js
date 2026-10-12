import {rubricSubjects,rubricRequirements,rubricScoringMethods,rubricPolicy,rubricGenerationSettings} from './rubric-prompts.js';
export function setupRubricGenerator({getConfig, getImages, action, api, markDirty}) {
  const $ = id => document.getElementById(id);
  $('rubric').closest('label').insertAdjacentHTML('beforebegin', '<div class="wide"><button id="openRubricGenerator">AI生成评分标准</button><p class="hint">使用上方题目和参考答案的文字、图片生成草稿。填写分值、选择评分口径，生成后检查并保存方案。</p></div>');
  document.body.insertAdjacentHTML('beforeend', `<dialog id="rubricGeneratorDialog" aria-labelledby="rubricGeneratorTitle"><div class="image-dialog-heading"><h2 id="rubricGeneratorTitle">AI生成评分标准</h2><button id="closeRubricGenerator">关闭</button></div><div class="form-grid"><label>AI接口<select id="rubricProvider"></select></label><label>模型<input id="rubricModel" list="rubricModels" placeholder="选择或输入支持图片的模型"></label><datalist id="rubricModels"></datalist><label>题目总分<input id="rubricMaxScore" type="number" min="0.5" step="0.5" placeholder="例如：10"></label><label>答案要求<select id="rubricStrictness"><option value="strict">严格</option><option value="normal" selected>正常</option><option value="lenient">宽松</option><option value="custom">自定义</option></select></label><label class="wide">分值设置（文字输入）<textarea id="rubricScoreAllocation" rows="3" maxlength="6000" placeholder="例如：第（1）问4分，第（2）问6分，第（3）问6分；或第一问列式2分、计算2分"></textarea><span class="hint">以这里的分配和总分为准，忽略图片中的原分值。留空时由AI建议分配。</span></label><label class="wide">答案要求提示词（可编辑）<textarea id="rubricRequirements" rows="4" maxlength="6000"></textarea></label></div><p class="hint">复用已保存的接口密钥；本次选择只用于生成标准。上传图片时请选择支持视觉的模型。</p><button id="generateRubric" class="primary">生成草稿</button><p id="rubricGenerationStatus" role="status"></p><div id="rubricDraft" hidden><h3>需要确认</h3><ul id="rubricWarnings"></ul><label>识别的题目<textarea id="generatedQuestion" rows="3" readonly></textarea></label><label>识别的参考答案<textarea id="generatedAnswer" rows="3" readonly></textarea></label><label>评分标准草稿（可编辑）<textarea id="generatedRubric" rows="12"></textarea></label><label class="check"><input id="fillRecognizedText" type="checkbox" checked>将识别文字补入空白的题目说明、参考答案</label><div class="footer-actions"><button id="applyGeneratedRubric" class="primary">使用此草稿</button></div><p class="hint">使用后仍需点击“保存方案”。已有文字和图片会保留；原评分标准文字将由草稿替换。</p></div></dialog>`);
  const form = $('rubricMaxScore').closest('.form-grid');
  $('rubricMaxScore').closest('label').insertAdjacentHTML('afterend','<label>得分步长<input id="rubricRoundStep" type="number" min="0.01" step="0.1" value="1"><span class="hint">1：只给整分；0.5：允许半分。生成标准和实际评分共用。</span></label>');
  const subjectLevel=document.createElement('div');subjectLevel.className='rubric-subject-level';
  subjectLevel.innerHTML='<label>学科<select id="rubricSubject"><option value="">选择学科</option></select></label>';
  const subjectSelect=subjectLevel.querySelector('select');
  subjectSelect.append(...Object.entries(rubricSubjects).map(([value,subject])=>Object.assign(document.createElement('option'),{value,textContent:subject.label})));
  $('rubricStrictness').querySelector('[value="custom"]').remove();
  $('rubricStrictness').closest('label').firstChild.textContent='宽严程度';
  subjectLevel.append($('rubricStrictness').closest('label'));
  const settingsColumns = document.createElement('div');
  settingsColumns.className = 'rubric-settings-columns wide';
  const scoreColumn = document.createElement('div');
  const answerColumn = document.createElement('div');
  scoreColumn.className = answerColumn.className = 'rubric-settings-column';
  settingsColumns.append(scoreColumn,answerColumn);form.append(settingsColumns);
  scoreColumn.append($('rubricMaxScore').closest('label'), $('rubricRoundStep').closest('label'), $('rubricScoreAllocation').closest('label'));
  answerColumn.append(subjectLevel);
  answerColumn.insertAdjacentHTML('beforeend',`<label>给分方式<select id="rubricScoringMethod"></select><span id="rubricMethodHint" class="hint"></span></label>
    <label>本题补充要求 <span class="rubric-optional">选填</span><textarea id="rubricTeacherNotes" rows="3" maxlength="2000"></textarea><span class="hint">写本题的特殊约定即可，切换学科或宽严程度会保留。</span></label>
    <div class="rubric-policy-summary"><strong>当前评分口径</strong><p id="rubricPolicySummary"></p><span>遵守分值与步长 · 认可等价答案 · 不猜补学生作答</span></div>`);
  $('rubricScoringMethod').append(...Object.entries(rubricScoringMethods).map(([value,method])=>Object.assign(document.createElement('option'),{value,textContent:method.label})));
  const promptDetails=document.createElement('details');promptDetails.id='rubricPromptDetails';promptDetails.className='rubric-prompt-details';
  promptDetails.innerHTML='<summary>查看／自定义提示词 <span id="rubricPromptMode">使用模板</span></summary><div class="rubric-prompt-body"><label class="check"><input id="rubricUseCustomPrompt" type="checkbox">使用自定义提示词</label></div>';
  promptDetails.querySelector('.rubric-prompt-body').append($('rubricRequirements').closest('label'));
  promptDetails.querySelector('.rubric-prompt-body').insertAdjacentHTML('beforeend','<p id="rubricPromptHint" class="hint"></p>');answerColumn.append(promptDetails);
  const dialog=$('rubricGeneratorDialog');
  const heading=dialog.querySelector('.image-dialog-heading');
  const titleBlock=document.createElement('div');
  titleBlock.append($('rubricGeneratorTitle'));
  titleBlock.insertAdjacentHTML('beforeend','<p class="rubric-subtitle">把题目与参考答案，整理成清晰可执行的评分标准</p>');
  heading.prepend(titleBlock);
  const modelPanel=document.createElement('section');modelPanel.className='rubric-model-panel';
  modelPanel.append($('rubricProvider').closest('label'),$('rubricModel').closest('label'),$('rubricModels'));
  form.prepend(modelPanel);
  $('rubricModel').removeAttribute('list');
  const modelInputRow=document.createElement('div');modelInputRow.className='rubric-model-input';
  $('rubricModel').before(modelInputRow);modelInputRow.append($('rubricModel'));
  modelInputRow.insertAdjacentHTML('beforeend','<button id="rubricChooseModel" type="button" aria-expanded="false" aria-controls="rubricModelPicker">选择模型</button>');
  modelPanel.insertAdjacentHTML('beforeend','<section id="rubricModelPicker" class="rubric-model-picker" hidden><label>搜索模型<input id="rubricModelSearch" placeholder="输入名称筛选模型" autocomplete="off"></label><p id="rubricModelHint" class="hint"></p><div id="rubricModelChoices" class="model-choice-list"></div></section>');
  scoreColumn.insertAdjacentHTML('afterbegin','<div class="rubric-panel-heading"><h3>分值规则</h3><span>明确总分与各小题分配</span></div>');
  answerColumn.insertAdjacentHTML('afterbegin','<div class="rubric-panel-heading"><h3>评分口径</h3><span>按教学要求确定怎样给分</span></div>');
  const scoreNumbers=document.createElement('div');scoreNumbers.className='rubric-score-numbers';
  scoreNumbers.append($('rubricMaxScore').closest('label'),$('rubricRoundStep').closest('label'));
  scoreColumn.querySelector('.rubric-panel-heading').after(scoreNumbers);
  const stepHint=$('rubricRoundStep').closest('label').querySelector('.hint');
  stepHint.textContent='1分：整分 · 0.5分：允许半分';scoreNumbers.after(stepHint);
  $('rubricScoreAllocation').closest('label').firstChild.textContent='小题分值分配';
  const promptLabel=$('rubricRequirements').closest('label').firstChild;
  const footer=document.createElement('div');footer.className='rubric-generator-footer';
  const modelHint=form.nextElementSibling;modelHint.textContent='使用已保存的AI接口；含图片时请选择支持视觉的模型。';
  footer.append(modelHint,$('generateRubric'));form.after(footer);
  let generating = false, draftSettings, customRequirements='';
  const policySettings=()=>({version:2,subject:$('rubricSubject').value,strictness:$('rubricStrictness').value,scoringMethod:$('rubricScoringMethod').value,notes:$('rubricTeacherNotes').value,useCustomPrompt:$('rubricUseCustomPrompt').checked,customRequirements,scoreAllocation:$('rubricScoreAllocation').value});
  const updateRequirements=()=>{
    const settings=policySettings(),method=rubricScoringMethods[settings.scoringMethod];
    $('rubricMethodHint').textContent=method.summary;
    const subject=rubricSubjects[settings.subject]?.label||'通用';
    const levels={strict:'准确核对关键条件与必要表达',normal:'按常规要求认可等价表述',lenient:'充分认可合理简写与非关键表达差异'};
    $('rubricPolicySummary').textContent=`${subject} · ${settings.useCustomPrompt?'自定义要求':levels[settings.strictness]} · ${method.label}。${settings.notes.trim()?'已加入本题补充要求。':''}`;
    const examples={physics:'例如：单位缺失只扣一次；错算后的正确方法仍给分；有效数字按题目要求。',mathematics:'例如：认可其他正确解法；写明错算后续方法分；证明必须说明关键依据。',english:'例如：本题必须使用过去式；开放表达允许同义替换；说明字数要求。',chinese:'例如：阅读每个有效要点独立给分；同义概括认可；默写错字不给本空分。',chemistry:'例如：说明配平、反应条件与单位要求；实验现象和解释分别给分。'};
    $('rubricTeacherNotes').placeholder=examples[settings.subject]||'例如：同义要点不重复计分；列出必需关键词；说明一次错误如何扣分。';
    $('rubricRequirements').readOnly=!settings.useCustomPrompt;
    $('rubricRequirements').maxLength=settings.useCustomPrompt?6000:12000;
    $('rubricRequirements').value=settings.useCustomPrompt?customRequirements:rubricPolicy(settings);
    promptLabel.textContent=settings.useCustomPrompt?'自定义提示词':'完整提示词预览';
    $('rubricPromptMode').textContent=settings.useCustomPrompt?'已自定义':'使用模板';
    $('rubricPromptHint').textContent=settings.useCustomPrompt?'替换学科与宽严模板；给分方式、本题补充、分值与步长约束仍会加入。取消勾选可恢复模板，自定义文字会保留。':'模板随选项更新；通常只需填写本题补充要求。需要更改模板时，勾选上方自定义。';
  };
  $('rubricSubject').onchange=updateRequirements;$('rubricStrictness').onchange=updateRequirements;$('rubricScoringMethod').onchange=updateRequirements;$('rubricTeacherNotes').oninput=updateRequirements;
  $('rubricUseCustomPrompt').onchange=()=>{if($('rubricUseCustomPrompt').checked&&!customRequirements)customRequirements=rubricRequirements($('rubricSubject').value,$('rubricStrictness').value);updateRequirements();};
  $('rubricRequirements').oninput=()=>{if($('rubricUseCustomPrompt').checked)customRequirements=$('rubricRequirements').value;};
  const generationControls = ['generateRubric','closeRubricGenerator','rubricProvider','rubricModel','rubricChooseModel','rubricModelSearch','rubricMaxScore','rubricRoundStep','rubricSubject','rubricStrictness','rubricScoringMethod','rubricTeacherNotes','rubricUseCustomPrompt','rubricRequirements','rubricScoreAllocation','applyGeneratedRubric'];
  const closeModelPicker=()=>{$('rubricModelPicker').hidden=true;$('rubricChooseModel').setAttribute('aria-expanded','false');};
  const catalog = () => {
    const models=getConfig().providers[$('rubricProvider').value]?.models || [],query=$('rubricModelSearch').value.trim().toLowerCase();
    const matching=models.filter(model=>model.toLowerCase().includes(query));
    $('rubricModelHint').textContent=!models.length?'此接口尚无模型目录，请在AI接口中获取目录，或直接输入模型名称。':matching.length?`共 ${models.length} 个模型，显示 ${matching.length} 个`:'没有匹配的模型，请修改搜索词或直接输入模型名称。';
    $('rubricModelChoices').replaceChildren(...matching.map(model=>{
      const button=document.createElement('button');button.type='button';button.textContent=model;button.setAttribute('aria-pressed',String($('rubricModel').value===model));
      button.onclick=()=>{if(generating)return;$('rubricModel').value=model;closeModelPicker();$('rubricModel').focus();};return button;
    }));
  };
  $('rubricChooseModel').onclick=()=>{if(!$('rubricModelPicker').hidden){closeModelPicker();return;}$('rubricModelSearch').value='';catalog();$('rubricModelPicker').hidden=false;$('rubricChooseModel').setAttribute('aria-expanded','true');$('rubricModelSearch').focus();};
  $('rubricModelSearch').oninput=catalog;
  $('openRubricGenerator').onclick = () => {
    if (generating) return;
    const config = getConfig(), workflow = config.workflows[$('presetWorkflow').value];
    $('rubricProvider').replaceChildren(...Object.keys(config.providers).map(name => Object.assign(document.createElement('option'), {value:name,textContent:name})));
    if (config.providers[workflow?.model?.provider]) $('rubricProvider').value = workflow.model.provider;
    const saved = rubricGenerationSettings(config.presets[$('presetSelect').value]?.rubricGeneration);
    $('rubricScoreAllocation').value = saved.scoreAllocation || '';
    $('rubricMaxScore').value = Number($('maxScore').value) > 0 ? $('maxScore').value : '';
    $('rubricRoundStep').value = $('roundStep').value || '1';
    $('rubricSubject').value = saved.subject;$('rubricStrictness').value = saved.strictness;
    $('rubricScoringMethod').value=saved.scoringMethod;$('rubricTeacherNotes').value=saved.notes;
    $('rubricUseCustomPrompt').checked=saved.useCustomPrompt;customRequirements=saved.customRequirements;
    promptDetails.open=saved.useCustomPrompt;updateRequirements();
    $('rubricModel').value = config.providers[workflow?.model?.provider] ? workflow?.model?.model || '' : '';closeModelPicker();$('rubricModelSearch').value='';catalog();
    $('rubricDraft').hidden = true; $('rubricGenerationStatus').textContent = '';
    $('rubricGeneratorDialog').showModal();
  };
  $('rubricProvider').onchange = () => { $('rubricModel').value = '';$('rubricModelSearch').value='';catalog(); };
  $('closeRubricGenerator').onclick = () => { if (!generating) $('rubricGeneratorDialog').close(); };
  $('rubricGeneratorDialog').addEventListener('cancel', event => { if (generating) event.preventDefault(); });
  $('generateRubric').onclick = () => action(async () => {
    generating = true;
    closeModelPicker();
    for (const id of generationControls) $(id).disabled = true;
    $('rubricDraft').hidden = true;
    $('rubricGenerationStatus').textContent = '正在读取题目和参考答案并生成评分标准…';
    try {
      draftSettings = {...policySettings(),maxScore:Number($('rubricMaxScore').value), roundStep:Number($('rubricRoundStep').value)};
      const result = await api('/api/generate-rubric', {provider:$('rubricProvider').value, model:$('rubricModel').value, question:{text:$('question').value,images:getImages('question')}, answer:{text:$('answer').value,images:getImages('answer')}, ...draftSettings, rubric:$('rubric').value});
      $('generatedQuestion').value = result.question; $('generatedAnswer').value = result.answer; $('generatedRubric').value = result.rubric;
      $('rubricWarnings').replaceChildren(...(result.warnings.length ? result.warnings : ['模型未报告疑点，请检查答案、分项和总分分配。']).map(text => Object.assign(document.createElement('li'), {textContent:text})));
      $('rubricDraft').hidden = false; $('rubricGenerationStatus').textContent = result.rubric ? '草稿已生成，请检查后使用。' : '资料不足，未生成标准；请补充下列内容后重试。';
    } catch (error) { $('rubricGenerationStatus').textContent = error.message; }
    finally { generating = false; for (const id of generationControls) $(id).disabled = false; }
  });
  $('applyGeneratedRubric').onclick = () => {
    if (!$('generatedRubric').value.trim()) return;
    $('rubric').value = $('generatedRubric').value;
    $('maxScore').value = draftSettings.maxScore;
    $('roundStep').value = draftSettings.roundStep;
    const {maxScore,roundStep,...generationSettings}=draftSettings;
    getConfig().presets[$('presetSelect').value].rubricGeneration = generationSettings;
    if ($('fillRecognizedText').checked) for (const field of ['question','answer']) if (!$(field).value.trim()) $(field).value = $(field === 'question' ? 'generatedQuestion' : 'generatedAnswer').value;
    document.dispatchEvent(new Event('preset-preview-refresh'));
    markDirty('presets'); $('rubricGeneratorDialog').close();
  };
}

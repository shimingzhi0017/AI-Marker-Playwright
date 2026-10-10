import {rubricPrompts,rubricSubjects,rubricRequirements} from './rubric-prompts.js';
export function setupRubricGenerator({getConfig, getImages, action, api, markDirty}) {
  const $ = id => document.getElementById(id);
  $('rubric').closest('label').insertAdjacentHTML('beforebegin', '<div class="wide"><button id="openRubricGenerator">AI生成评分标准</button><p class="hint">使用上方题目和参考答案的文字、图片生成草稿。在弹窗内填写总分和答案要求，生成后检查并保存方案。</p></div>');
  document.body.insertAdjacentHTML('beforeend', `<dialog id="rubricGeneratorDialog" aria-labelledby="rubricGeneratorTitle"><div class="image-dialog-heading"><h2 id="rubricGeneratorTitle">AI生成评分标准</h2><button id="closeRubricGenerator">关闭</button></div><div class="form-grid"><label>AI接口<select id="rubricProvider"></select></label><label>模型<input id="rubricModel" list="rubricModels" placeholder="选择或输入支持图片的模型"></label><datalist id="rubricModels"></datalist><label>题目总分<input id="rubricMaxScore" type="number" min="0.5" step="0.5" placeholder="例如：10"></label><label>答案要求<select id="rubricStrictness"><option value="strict">严格</option><option value="normal" selected>正常</option><option value="lenient">宽松</option><option value="custom">自定义</option></select></label><label class="wide">分值设置（文字输入）<textarea id="rubricScoreAllocation" rows="3" maxlength="6000" placeholder="例如：第（1）问4分，第（2）问6分，第（3）问6分；或第一问列式2分、计算2分"></textarea><span class="hint">以这里的分配和总分为准，忽略图片中的原分值。留空时由AI建议分配。</span></label><label class="wide">答案要求提示词（可编辑）<textarea id="rubricRequirements" rows="4" maxlength="6000"></textarea></label></div><p class="hint">复用已保存的接口密钥；本次选择只用于生成标准。上传图片时请选择支持视觉的模型。</p><button id="generateRubric" class="primary">生成草稿</button><p id="rubricGenerationStatus" role="status"></p><div id="rubricDraft" hidden><h3>需要确认</h3><ul id="rubricWarnings"></ul><label>识别的题目<textarea id="generatedQuestion" rows="3" readonly></textarea></label><label>识别的参考答案<textarea id="generatedAnswer" rows="3" readonly></textarea></label><label>评分标准草稿（可编辑）<textarea id="generatedRubric" rows="12"></textarea></label><label class="check"><input id="fillRecognizedText" type="checkbox" checked>将识别文字补入空白的题目说明、参考答案</label><div class="footer-actions"><button id="applyGeneratedRubric" class="primary">使用此草稿</button></div><p class="hint">使用后仍需点击“保存方案”。已有文字和图片会保留；原评分标准文字将由草稿替换。</p></div></dialog>`);
  const form = $('rubricMaxScore').closest('.form-grid');
  $('rubricMaxScore').closest('label').insertAdjacentHTML('afterend','<label>得分步长<input id="rubricRoundStep" type="number" min="0.01" step="0.1" value="1"><span class="hint">1：只给整分；0.5：允许半分。生成标准和实际评分共用。</span></label>');
  const subjectLevel=document.createElement('div');subjectLevel.className='rubric-subject-level';
  subjectLevel.innerHTML='<label>学科<select id="rubricSubject"><option value="">选择学科</option></select></label>';
  const subjectSelect=subjectLevel.querySelector('select');
  subjectSelect.append(...Object.entries(rubricSubjects).map(([value,subject])=>Object.assign(document.createElement('option'),{value,textContent:subject.label})));
  subjectLevel.append($('rubricStrictness').closest('label'));
  const settingsColumns = document.createElement('div');
  settingsColumns.className = 'rubric-settings-columns wide';
  const scoreColumn = document.createElement('div');
  const answerColumn = document.createElement('div');
  scoreColumn.className = answerColumn.className = 'rubric-settings-column';
  scoreColumn.append($('rubricMaxScore').closest('label'), $('rubricRoundStep').closest('label'), $('rubricScoreAllocation').closest('label'));
  answerColumn.append(subjectLevel, $('rubricRequirements').closest('label'));
  const promptHint=document.createElement('p');promptHint.className='hint';promptHint.textContent='选择学科与严格、正常或宽松，自动带入对应提示词；可直接编辑，也可选择自定义。';answerColumn.append(promptHint);
  settingsColumns.append(scoreColumn, answerColumn); form.append(settingsColumns);
  const dialog=$('rubricGeneratorDialog');
  const heading=dialog.querySelector('.image-dialog-heading');
  const titleBlock=document.createElement('div');
  titleBlock.append($('rubricGeneratorTitle'));
  titleBlock.insertAdjacentHTML('beforeend','<p class="rubric-subtitle">把题目与参考答案，整理成清晰可执行的评分标准</p>');
  heading.prepend(titleBlock);
  const modelPanel=document.createElement('section');modelPanel.className='rubric-model-panel';
  modelPanel.append($('rubricProvider').closest('label'),$('rubricModel').closest('label'),$('rubricModels'));
  form.prepend(modelPanel);
  scoreColumn.insertAdjacentHTML('afterbegin','<div class="rubric-panel-heading"><h3>分值规则</h3><span>明确总分与各小题分配</span></div>');
  answerColumn.insertAdjacentHTML('afterbegin','<div class="rubric-panel-heading"><h3>学科与要求</h3><span>选择模板，也可自行调整</span></div>');
  const scoreNumbers=document.createElement('div');scoreNumbers.className='rubric-score-numbers';
  scoreNumbers.append($('rubricMaxScore').closest('label'),$('rubricRoundStep').closest('label'));
  scoreColumn.querySelector('.rubric-panel-heading').after(scoreNumbers);
  const stepHint=$('rubricRoundStep').closest('label').querySelector('.hint');
  stepHint.textContent='1分：整分 · 0.5分：允许半分';scoreNumbers.after(stepHint);
  $('rubricScoreAllocation').closest('label').firstChild.textContent='小题分值分配';
  $('rubricRequirements').closest('label').firstChild.textContent='提示词';
  $('rubricRequirements').closest('label').insertAdjacentHTML('afterbegin','<span class="rubric-editable">可编辑</span>');
  promptHint.textContent='切换学科或宽严程度自动更新；选择“自定义”保留你的提示词。';
  const footer=document.createElement('div');footer.className='rubric-generator-footer';
  const modelHint=form.nextElementSibling;modelHint.textContent='使用已保存的AI接口；含图片时请选择支持视觉的模型。';
  footer.append(modelHint,$('generateRubric'));form.after(footer);
  let generating = false, draftSettings;
  const updateRequirements=()=>{if($('rubricStrictness').value!=='custom')$('rubricRequirements').value=rubricRequirements($('rubricSubject').value,$('rubricStrictness').value);};
  $('rubricSubject').onchange=updateRequirements;$('rubricStrictness').onchange=updateRequirements;
  const generationControls = ['generateRubric','closeRubricGenerator','rubricProvider','rubricModel','rubricMaxScore','rubricRoundStep','rubricSubject','rubricStrictness','rubricRequirements','rubricScoreAllocation','applyGeneratedRubric'];
  const catalog = () => {
    $('rubricModels').replaceChildren(...(getConfig().providers[$('rubricProvider').value]?.models || []).map(model => Object.assign(document.createElement('option'), {value:model})));
  };
  $('openRubricGenerator').onclick = () => {
    if (generating) return;
    const config = getConfig(), workflow = config.workflows[$('presetWorkflow').value];
    $('rubricProvider').replaceChildren(...Object.keys(config.providers).map(name => Object.assign(document.createElement('option'), {value:name,textContent:name})));
    if (config.providers[workflow?.model?.provider]) $('rubricProvider').value = workflow.model.provider;
    const saved = config.presets[$('presetSelect').value]?.rubricGeneration || {};
    $('rubricScoreAllocation').value = saved.scoreAllocation || '';
    $('rubricMaxScore').value = Number($('maxScore').value) > 0 ? $('maxScore').value : '';
    $('rubricRoundStep').value = $('roundStep').value || '1';
    $('rubricSubject').value = Object.hasOwn(rubricSubjects,saved.subject) ? saved.subject : '';
    $('rubricStrictness').value = Object.hasOwn(rubricPrompts,saved.strictness) ? saved.strictness : 'normal';
    $('rubricRequirements').value = saved.requirements ?? rubricRequirements($('rubricSubject').value,$('rubricStrictness').value);
    $('rubricModel').value = workflow?.model?.model || ''; catalog();
    $('rubricDraft').hidden = true; $('rubricGenerationStatus').textContent = '';
    $('rubricGeneratorDialog').showModal();
  };
  $('rubricProvider').onchange = () => { $('rubricModel').value = ''; catalog(); };
  $('closeRubricGenerator').onclick = () => { if (!generating) $('rubricGeneratorDialog').close(); };
  $('rubricGeneratorDialog').addEventListener('cancel', event => { if (generating) event.preventDefault(); });
  $('generateRubric').onclick = () => action(async () => {
    generating = true;
    for (const id of generationControls) $(id).disabled = true;
    $('rubricDraft').hidden = true;
    $('rubricGenerationStatus').textContent = '正在读取题目和参考答案并生成评分标准…';
    try {
      const config = getConfig(), workflow = config.workflows[$('presetWorkflow').value];
      draftSettings = {maxScore:Number($('rubricMaxScore').value), roundStep:Number($('rubricRoundStep').value), subject:$('rubricSubject').value, strictness:$('rubricStrictness').value, requirements:$('rubricRequirements').value, scoreAllocation:$('rubricScoreAllocation').value};
      const result = await api('/api/generate-rubric', {provider:$('rubricProvider').value, model:$('rubricModel').value, question:{text:$('question').value,images:getImages('question')}, answer:{text:$('answer').value,images:getImages('answer')}, ...draftSettings, rubric:$('rubric').value, questionType:workflow?.dualEval?.questionType});
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
    getConfig().presets[$('presetSelect').value].rubricGeneration = {subject:draftSettings.subject,strictness:draftSettings.strictness,requirements:draftSettings.requirements,scoreAllocation:draftSettings.scoreAllocation};
    if ($('fillRecognizedText').checked) for (const field of ['question','answer']) if (!$(field).value.trim()) $(field).value = $(field === 'question' ? 'generatedQuestion' : 'generatedAnswer').value;
    document.dispatchEvent(new Event('preset-preview-refresh'));
    markDirty('presets'); $('rubricGeneratorDialog').close();
  };
}

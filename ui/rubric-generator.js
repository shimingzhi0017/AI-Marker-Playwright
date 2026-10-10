import {rubricPrompts} from './rubric-prompts.js';
export function setupRubricGenerator({getConfig, getImages, action, api, markDirty}) {
  const $ = id => document.getElementById(id);
  $('rubric').closest('label').insertAdjacentHTML('beforebegin', '<div class="wide"><button id="openRubricGenerator">AI生成评分标准</button><p class="hint">使用上方题目和参考答案的文字、图片生成草稿。在弹窗内填写总分和答案要求，生成后检查并保存方案。</p></div>');
  document.body.insertAdjacentHTML('beforeend', `<dialog id="rubricGeneratorDialog" aria-labelledby="rubricGeneratorTitle"><div class="image-dialog-heading"><h2 id="rubricGeneratorTitle">AI生成评分标准</h2><button id="closeRubricGenerator">关闭</button></div><div class="form-grid"><label>AI接口<select id="rubricProvider"></select></label><label>模型<input id="rubricModel" list="rubricModels" placeholder="选择或输入支持图片的模型"></label><datalist id="rubricModels"></datalist><label>题目总分<input id="rubricMaxScore" type="number" min="0.5" step="0.5" placeholder="例如：10"></label><label>答案要求<select id="rubricStrictness"><option value="strict">严格</option><option value="normal" selected>正常</option><option value="lenient">宽松</option><option value="custom">自定义</option></select></label><label class="wide">分值设置（文字输入）<textarea id="rubricScoreAllocation" rows="3" maxlength="6000" placeholder="例如：第（1）问4分，第（2）问6分，第（3）问6分；或第一问列式2分、计算2分"></textarea><span class="hint">以这里的分配和总分为准，忽略图片中的原分值。留空时由AI建议分配。</span></label><label class="wide">答案要求提示词（可编辑）<textarea id="rubricRequirements" rows="4" maxlength="6000"></textarea></label></div><p class="hint">复用已保存的接口密钥；本次选择只用于生成标准。上传图片时请选择支持视觉的模型。</p><button id="generateRubric" class="primary">生成草稿</button><p id="rubricGenerationStatus" role="status"></p><div id="rubricDraft" hidden><h3>需要确认</h3><ul id="rubricWarnings"></ul><label>识别的题目<textarea id="generatedQuestion" rows="3" readonly></textarea></label><label>识别的参考答案<textarea id="generatedAnswer" rows="3" readonly></textarea></label><label>评分标准草稿（可编辑）<textarea id="generatedRubric" rows="12"></textarea></label><label class="check"><input id="fillRecognizedText" type="checkbox" checked>将识别文字补入空白的题目说明、参考答案</label><div class="footer-actions"><button id="applyGeneratedRubric" class="primary">使用此草稿</button></div><p class="hint">使用后仍需点击“保存方案”。已有文字和图片会保留；原评分标准文字将由草稿替换。</p></div></dialog>`);
  const form = $('rubricMaxScore').closest('.form-grid');
  const settingsColumns = document.createElement('div');
  settingsColumns.className = 'rubric-settings-columns wide';
  const scoreColumn = document.createElement('div');
  const answerColumn = document.createElement('div');
  scoreColumn.className = answerColumn.className = 'rubric-settings-column';
  scoreColumn.append($('rubricMaxScore').closest('label'), $('rubricScoreAllocation').closest('label'));
  answerColumn.append($('rubricStrictness').closest('label'), $('rubricRequirements').closest('label'));
  settingsColumns.append(scoreColumn, answerColumn); form.append(settingsColumns);
  let generating = false, draftSettings;
  $('rubricStrictness').onchange = () => { $('rubricRequirements').value = rubricPrompts[$('rubricStrictness').value].text; };
  const generationControls = ['generateRubric','closeRubricGenerator','rubricProvider','rubricModel','rubricMaxScore','rubricStrictness','rubricRequirements','rubricScoreAllocation','applyGeneratedRubric'];
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
    $('rubricStrictness').value = Object.hasOwn(rubricPrompts,saved.strictness) ? saved.strictness : 'normal';
    $('rubricRequirements').value = saved.requirements ?? rubricPrompts[$('rubricStrictness').value].text;
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
      draftSettings = {maxScore:Number($('rubricMaxScore').value), strictness:$('rubricStrictness').value, requirements:$('rubricRequirements').value, scoreAllocation:$('rubricScoreAllocation').value};
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
    getConfig().presets[$('presetSelect').value].rubricGeneration = {strictness:draftSettings.strictness,requirements:draftSettings.requirements,scoreAllocation:draftSettings.scoreAllocation};
    if ($('fillRecognizedText').checked) for (const field of ['question','answer']) if (!$(field).value.trim()) $(field).value = $(field === 'question' ? 'generatedQuestion' : 'generatedAnswer').value;
    markDirty('presets'); $('rubricGeneratorDialog').close();
  };
}

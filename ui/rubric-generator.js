export function setupRubricGenerator({getConfig, getImages, action, api, markDirty}) {
  const $ = id => document.getElementById(id);
  $('rubric').closest('label').insertAdjacentHTML('beforebegin', '<div class="wide"><button id="openRubricGenerator">AI生成评分标准</button><p class="hint">使用上方题目和参考答案的文字、图片生成草稿。请先填写总分，生成后检查并保存方案。</p></div>');
  document.body.insertAdjacentHTML('beforeend', `<dialog id="rubricGeneratorDialog" aria-labelledby="rubricGeneratorTitle"><div class="image-dialog-heading"><h2 id="rubricGeneratorTitle">AI生成评分标准</h2><button id="closeRubricGenerator">关闭</button></div><div class="form-grid"><label>AI接口<select id="rubricProvider"></select></label><label>模型<input id="rubricModel" list="rubricModels" placeholder="选择或输入支持图片的模型"></label><datalist id="rubricModels"></datalist></div><p class="hint">复用已保存的接口密钥；本次选择只用于生成标准。上传图片时请选择支持视觉的模型。</p><button id="generateRubric" class="primary">生成草稿</button><p id="rubricGenerationStatus" role="status"></p><div id="rubricDraft" hidden><h3>需要确认</h3><ul id="rubricWarnings"></ul><label>识别的题目<textarea id="generatedQuestion" rows="3" readonly></textarea></label><label>识别的参考答案<textarea id="generatedAnswer" rows="3" readonly></textarea></label><label>评分标准草稿（可编辑）<textarea id="generatedRubric" rows="12"></textarea></label><label class="check"><input id="fillRecognizedText" type="checkbox" checked>将识别文字补入空白的题目说明、参考答案</label><div class="footer-actions"><button id="applyGeneratedRubric" class="primary">使用此草稿</button></div><p class="hint">使用后仍需点击“保存方案”。已有文字和图片会保留；原评分标准文字将由草稿替换。</p></div></dialog>`);
  let generating = false;
  const catalog = () => {
    $('rubricModels').replaceChildren(...(getConfig().providers[$('rubricProvider').value]?.models || []).map(model => Object.assign(document.createElement('option'), {value:model})));
  };
  $('openRubricGenerator').onclick = () => {
    if (generating) return;
    const config = getConfig(), workflow = config.workflows[$('presetWorkflow').value];
    $('rubricProvider').replaceChildren(...Object.keys(config.providers).map(name => Object.assign(document.createElement('option'), {value:name,textContent:name})));
    if (config.providers[workflow?.model?.provider]) $('rubricProvider').value = workflow.model.provider;
    $('rubricModel').value = workflow?.model?.model || ''; catalog();
    $('rubricDraft').hidden = true; $('rubricGenerationStatus').textContent = '';
    $('rubricGeneratorDialog').showModal();
  };
  $('rubricProvider').onchange = () => { $('rubricModel').value = ''; catalog(); };
  $('closeRubricGenerator').onclick = () => { if (!generating) $('rubricGeneratorDialog').close(); };
  $('rubricGeneratorDialog').addEventListener('cancel', event => { if (generating) event.preventDefault(); });
  $('generateRubric').onclick = () => action(async () => {
    generating = true;
    for (const id of ['generateRubric','closeRubricGenerator','rubricProvider','rubricModel','applyGeneratedRubric']) $(id).disabled = true;
    $('rubricDraft').hidden = true;
    $('rubricGenerationStatus').textContent = '正在读取题目和参考答案并生成评分标准…';
    try {
      const config = getConfig(), workflow = config.workflows[$('presetWorkflow').value];
      const result = await api('/api/generate-rubric', {provider:$('rubricProvider').value, model:$('rubricModel').value, question:{text:$('question').value,images:getImages('question')}, answer:{text:$('answer').value,images:getImages('answer')}, maxScore:Number($('maxScore').value), rubric:$('rubric').value, questionType:workflow?.dualEval?.questionType});
      $('generatedQuestion').value = result.question; $('generatedAnswer').value = result.answer; $('generatedRubric').value = result.rubric;
      $('rubricWarnings').replaceChildren(...(result.warnings.length ? result.warnings : ['模型未报告疑点，请检查答案、分项和总分分配。']).map(text => Object.assign(document.createElement('li'), {textContent:text})));
      $('rubricDraft').hidden = false; $('rubricGenerationStatus').textContent = result.rubric ? '草稿已生成，请检查后使用。' : '资料不足，未生成标准；请补充下列内容后重试。';
    } catch (error) { $('rubricGenerationStatus').textContent = error.message; }
    finally { generating = false; for (const id of ['generateRubric','closeRubricGenerator','rubricProvider','rubricModel','applyGeneratedRubric']) $(id).disabled = false; }
  });
  $('applyGeneratedRubric').onclick = () => {
    if (!$('generatedRubric').value.trim()) return;
    $('rubric').value = $('generatedRubric').value;
    if ($('fillRecognizedText').checked) for (const field of ['question','answer']) if (!$(field).value.trim()) $(field).value = $(field === 'question' ? 'generatedQuestion' : 'generatedAnswer').value;
    markDirty('presets'); $('rubricGeneratorDialog').close();
  };
}

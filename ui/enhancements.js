import {setupRubricGenerator} from './rubric-generator.js';
// Additional controls share the existing settings and API; no separate draft store is persisted.
export function buildLayout() {
  const $ = id => document.getElementById(id);
  $('endpoint').closest('label').insertAdjacentHTML('afterend','<label class="wide">模型目录地址（可选）<input id="modelsEndpoint" type="url" placeholder="留空时根据模型接口地址自动推导"></label>');
  $('addProvider').insertAdjacentHTML('afterend','<button id="addProviderTemplate">从模板添加</button>');
  document.body.insertAdjacentHTML('beforeend','<dialog id="providerTemplateDialog"><h2>选择 AI 接口模板</h2><p>仅添加公开接口地址和模型名称，密钥需要自行填写。模板添加后可以编辑或删除。</p><div class="actions"><button data-provider-template="火山引擎">火山引擎</button><button data-provider-template="OpenAI兼容">OpenAI兼容</button></div><div class="footer-actions"><button id="closeProviderTemplate">取消</button></div></dialog>');
  $('eyebrow').hidden = true;
  document.querySelector('.workspace-controls').insertAdjacentHTML('afterbegin','<section class="task-overview" aria-label="任务概览"><div class="task-overview-heading"><h2>任务概览</h2><span>状态实时更新 · 点击切换</span></div><div id="workspaceCards" class="workspace-cards"></div></section>');
  const noticePopup=document.createElement('div');noticePopup.id='noticePopup';
  const closeNotice=document.createElement('button');closeNotice.id='closeNotice';closeNotice.textContent='×';closeNotice.setAttribute('aria-label','关闭提示');
  document.body.append(noticePopup);noticePopup.append($('notice'),closeNotice);
  closeNotice.onclick=()=>{$('notice').hidden=true;};
  const exportLinks=[...document.querySelectorAll('a[href*="/api/export"]')];
  const exportMenu=document.createElement('details');exportMenu.id='exportMenu';exportMenu.className='export-menu';
  const exportTitle=document.createElement('summary');exportTitle.textContent='导出';exportMenu.append(exportTitle);
  const exportOptions=document.createElement('div');exportOptions.className='export-options';
  exportLinks[0].before(exportMenu);exportLinks.forEach(link=>{exportOptions.append(link);link.addEventListener('click',()=>{exportMenu.open=false;});});exportMenu.append(exportOptions);
  document.addEventListener('click',event=>{if(!exportMenu.contains(event.target))exportMenu.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&exportMenu.open){exportMenu.open=false;exportTitle.focus();}});
  const workspaceNote = document.querySelector('.workspace-controls > .hint'); workspaceNote.remove();
  $('workspaceSelect').closest('label').firstChild.textContent = '当前任务';
  $('workspaceSelect').closest('label').hidden = true;
  $('addWorkspace').textContent = '＋ 新建任务';
  $('addWorkspace').insertAdjacentHTML('afterend','<button id="renameWorkspace">重命名</button><button id="deleteWorkspace" class="danger">删除任务</button>');
  document.body.insertAdjacentHTML('beforeend','<dialog id="workspaceDialog"><form method="dialog"><h2 id="workspaceDialogTitle">重命名任务</h2><p id="workspaceDialogHint" class="hint"></p><label id="workspaceNameLabel">任务名称<input id="workspaceNameInput" maxlength="80" required></label><div class="actions"><button value="cancel" formnovalidate>取消</button><button id="workspaceDialogSave" value="ok" class="primary">保存</button></div></form></dialog>');
  document.querySelector('header').insertAdjacentHTML('beforeend','<span id="dirtyBadge" class="dirty-badge" hidden>有未保存修改</span>');
  const toolbar = document.querySelector('.toolbar');
  toolbar.insertAdjacentHTML('afterbegin','<div id="readiness" class="readiness" aria-live="polite"></div>');
  const controls = toolbar.querySelector('.controls');
  const details = document.createElement('div'); details.className='runtime-settings';
  details.innerHTML='<div class="runtime-heading">运行设置 <span id="runtimeSummary" hidden></span></div>';
  controls.before(details); details.append(controls);
  details.append($('bind'));
  controls.insertAdjacentHTML('afterbegin','<label>本任务使用方案<select id="runPreset"></select></label>');
  controls.insertAdjacentHTML('beforeend','<label class="check"><input id="batchEnabled" type="checkbox">限制本次份数</label>');
  toolbar.querySelector('p.hint').remove();
  const comment=$('comment');const textarea=document.createElement('textarea');textarea.id='comment';textarea.rows=4;textarea.setAttribute('aria-label','评分依据');comment.replaceWith(textarea);textarea.insertAdjacentHTML('beforebegin','<div id="commentPreview" class="review-content"></div><details id="commentEditor"><summary>编辑评语</summary></details>');$('commentEditor').append(textarea);
  $('scores').insertAdjacentHTML('afterend','<div class="score-total"><span>分数合计</span><strong id="scoreTotal">—</strong></div><div id="dualSummary" class="hint" hidden></div>');
  $('rawResult').closest('details').before($('resultPanel').querySelector('.review-actions'));
  $('answerImages').closest('.card').classList.add('answer-card');$('resultPanel').closest('.card').classList.add('result-card');
  $('answerImages').insertAdjacentHTML('beforebegin','<p class="hint">点击图片可放大查看</p>');
  $('answerImages').innerHTML='<div class="empty">开始阅卷后，这里显示当前答卷图片</div>';
  document.querySelector('#grading > .card:last-child').classList.add('event-card');
  $('addPreset').insertAdjacentHTML('afterend','<button id="copyPreset">复制</button><button id="deletePreset" class="danger">删除</button>');
  for(const field of ['question','answer','rubric']) {
    $(field).closest('label').insertAdjacentHTML('afterend',`<div class="field-media wide"><div id="${field}ReferenceImages" class="field-thumbnails"></div><label class="file-button small">添加说明图片<input id="${field}Upload" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><button id="${field}Paste" class="small">粘贴图片</button><span class="hint">点击上方输入框后可按 Ctrl+V 粘贴图片；支持 PNG、JPG、WebP，图片随方案保存</span></div>`);
  }
  $('addUnit').insertAdjacentHTML('afterend','<button id="detectUnits">从当前网页带入评分框</button><span id="unitTotal" class="hint"></span>');
  $('savePreset').closest('.footer-actions').insertAdjacentHTML('beforebegin',`<details class="advanced-settings"><summary>加分与空白检测</summary><div class="form-grid"><label class="check wide"><input id="diligenceEnabled" type="checkbox">启用勤勉加分</label><label>加分上限<input id="diligenceBonus" type="number" min="0.5" step="0.5"></label><label>衰减强度<select id="diligenceDecay"><option value="1">缓慢</option><option value="2">标准</option><option value="3">快速</option></select></label><label class="wide">勤勉评估说明<textarea id="diligenceCriteria" rows="2"></textarea></label><label class="check wide"><input id="blankEnabled" type="checkbox">启用空白检测（结果仍须确认）</label><label>范本差异阈值<input id="blankThreshold" type="number" min="0" max="1" step="0.001"></label><div><p id="blankStatus" class="hint"></p><button id="clearBlank">清除范本</button></div></div><p class="hint">空白范本可在历史记录中选择已确认的空白答卷建立。</p></details>`);
  $('addProvider').insertAdjacentHTML('afterend','<button id="deleteProvider" class="danger">删除</button>');
  $('apiKey').insertAdjacentHTML('afterend','<button id="toggleKey" class="text-button" type="button">显示密钥</button>');
  $('modelCatalog').insertAdjacentHTML('afterend','<details><summary>手动管理模型目录</summary><div class="controls"><label>新增模型 ID<input id="newModelId"></label><button id="addModelId">添加</button></div><div id="manualModelList" class="model-list"></div></details>');
  $('addWorkflow').insertAdjacentHTML('afterend','<button id="deleteWorkflow" class="danger">删除</button>');
  $('primaryModel').closest('label').insertAdjacentHTML('afterend','<label class="wide">主评思考深度<select id="primaryEffort"><option value="">供应商默认</option><option value="none">none</option><option value="minimal">minimal</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select></label>');
  $('secondaryModel').closest('label').insertAdjacentHTML('afterend','<label class="wide dual-control">复评思考深度<select id="secondaryEffort"></select></label>');
  $('arbitrationModel').closest('label').insertAdjacentHTML('afterend','<label class="wide dual-control">仲裁思考深度<select id="arbitrationEffort"></select></label>');
  $('secondaryEffort').innerHTML=$('primaryEffort').innerHTML;$('arbitrationEffort').innerHTML=$('primaryEffort').innerHTML;
  for(const id of ['questionType','threshold','secondaryProvider','secondaryModel','arbitrationProvider','arbitrationModel'])$(id).closest('label').classList.add('dual-control');
  $('questionType').closest('label').insertAdjacentHTML('afterend','<p class="hint dual-control">客观题逐项比较小问得分；任意不一致或缺少明细均调用仲裁，总分相同也不能跳过。仲裁后汇总到网页评分框。主观分差阈值仅适用于主观题。</p>');
  $('saveWorkflow').closest('.footer-actions').insertAdjacentHTML('beforebegin','<details><summary>输出与请求设置</summary><div class="form-grid"><label class="check wide"><input id="outputLimit" type="checkbox">限制模型输出长度</label><label>最大输出 Token<input id="outputTokens" type="number" min="128" step="128"></label><label>单份请求预算<input id="requestBudget" type="number" min="1" max="100"></label></div><p class="hint">思考深度与输出长度需模型支持。请求预算包括双评、仲裁和重试。</p></details>');
  $('historyRows').closest('.table-wrap').insertAdjacentHTML('beforebegin','<div class="controls history-filter"><label>查找记录<input id="historySearch" placeholder="方案、识别内容或评分依据"></label><label>状态<select id="historyFilter"><option value="">全部状态</option><option value="review">待确认</option><option value="filled">已填分</option><option value="submitted">已提交</option><option value="paused">已暂停</option><option value="uncertain">提交待核对</option></select></label><span id="historyCount" class="hint"></span></div>');
  $('dualSummary').insertAdjacentHTML('afterend','<div id="resultDetails" class="history-readable"></div>');
  $('historyJson').insertAdjacentHTML('beforebegin','<div id="historyReadable" class="history-readable"></div>');
  const rawDetails=document.createElement('details');rawDetails.innerHTML='<summary>技术记录</summary>';$('historyJson').before(rawDetails);rawDetails.append($('historyJson'));
  const historyDialog=document.createElement('dialog');historyDialog.id='historyDialog';historyDialog.setAttribute('aria-labelledby','historyDialogTitle');
  historyDialog.innerHTML='<div class="history-dialog-heading"><h2 id="historyDialogTitle">评阅详情</h2><button id="closeHistory" aria-label="关闭评阅详情">×</button></div>';
  document.body.append(historyDialog);$('historyDetail').querySelector('h2').remove();historyDialog.append($('historyDetail'));
  $('historyImages').before($('historyReadable'));$('historyImages').before(Object.assign(document.createElement('h3'),{textContent:'题目 / 答卷图片',className:'review-images-title'}));
  $('closeHistory').onclick=()=>historyDialog.close();
  historyDialog.addEventListener('click',event=>{if(event.target===historyDialog){const rect=historyDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)historyDialog.close();}});
  $('historyFilter').closest('label').insertAdjacentHTML('afterend','<label>仲裁审查<select id="arbitrationFilter"><option value="">全部记录</option><option value="arbitration">只看仲裁记录</option></select></label>');
  document.body.insertAdjacentHTML('beforeend','<dialog id="imageDialog"><div class="image-dialog-heading"><h2>图片查看</h2><button id="closeImage">关闭</button></div><img id="largeImage" alt="放大图片"></dialog>');
  $('closeImage').onclick=()=>$('imageDialog').close();
  document.addEventListener('click',e=>{if(e.target.matches('.images img,.field-thumbnails img')){$('largeImage').src=e.target.src;$('imageDialog').showModal();}});
  const sidebar=document.querySelector('aside'), oldNav=sidebar.querySelector('nav');
  const topNav=document.createElement('nav');topNav.className='task-tabs';topNav.setAttribute('aria-label','当前任务页面');
  const workflowTab=document.createElement('button');workflowTab.dataset.tab='workflows';workflowTab.textContent='评分设置';
  topNav.append(oldNav.querySelector('[data-tab="presets"]'),workflowTab,oldNav.querySelector('[data-tab="grading"]'),oldNav.querySelector('[data-tab="history"]'));
  document.querySelector('header').after(topNav);
  const workspaceControls=document.querySelector('.workspace-controls');sidebar.insertBefore(workspaceControls,oldNav);
  const modelsButton=oldNav.querySelector('[data-tab="models"]');modelsButton.textContent='AI接口';
  const models=$('models'), grid=models.querySelector('.grid'), cards=[...grid.children];
  const workflowSection=document.createElement('section');workflowSection.id='workflows';workflowSection.className='tab';workflowSection.hidden=true;workflowSection.append(cards[1]);models.after(workflowSection);$('presets').append(models.lastElementChild);
  const sharedHint=document.createElement('p');sharedHint.className='hint';sharedHint.textContent='模型供应商、接口地址、密钥和模型目录适用于所有任务。修改后从下一轮阅卷生效。';cards[0].prepend(sharedHint);
  $('presetSelect').closest('.controls').hidden=true;
  $('workflowSelect').closest('.controls').hidden=true;
  $('presetWorkflow').closest('label').hidden=true;
  $('runPreset').closest('label').hidden=true;$('bind').hidden=true;
  
  $('presets').querySelector('h2').textContent='当前任务方案';
  $('workflows').querySelector('h2').textContent='当前任务评分设置';
  for(const prefix of ['primary','secondary','arbitration']){
    const input=$(prefix+'Model');input.removeAttribute('list');
    const button=document.createElement('button');button.id=prefix+'ChooseModel';button.type='button';button.className='small model-choose';button.textContent='选择模型';button.dataset.modelPrefix=prefix;input.after(button);
  }
  document.body.insertAdjacentHTML('beforeend','<dialog id="workflowModelDialog" aria-labelledby="workflowModelTitle"><div class="image-dialog-heading"><h2 id="workflowModelTitle">选择模型</h2><button id="closeWorkflowModels">关闭</button></div><label>搜索模型<input id="workflowModelSearch" placeholder="输入模型名称筛选"></label><p id="workflowModelHint" class="hint"></p><div id="workflowModelChoices" class="model-choice-list"></div></dialog>');
  const workflowForm=$('primaryProvider').closest('.form-grid');
  const workflowLayout=document.createElement('div');workflowLayout.className='workflow-layout';workflowForm.before(workflowLayout);
  const modelPanels={};
  for(const [prefix,title,description] of [['primary','主评','首次识别与评分'],['secondary','复评','独立评分，核对分歧'],['arbitration','仲裁','处理评分分歧或识别疑点']]){
    const panel=document.createElement('section');panel.className='workflow-panel';panel.id=prefix+'Panel';
    panel.innerHTML='<h3>'+title+'</h3><p class="hint">'+description+'</p><div class="form-grid"></div>';
    const grid=panel.querySelector('.form-grid');for(const suffix of ['Provider','Model'])grid.append($(prefix+suffix).closest('label'));
    const advanced=document.createElement('details');advanced.innerHTML='<summary>思考深度</summary>';const effort=$(prefix+'Effort').closest('label');effort.classList.remove('wide','dual-control');advanced.append(effort);panel.append(advanced);
    workflowLayout.append(panel);modelPanels[prefix]=panel;
  }
  const rules=document.createElement('section');rules.className='workflow-rules';rules.innerHTML='<h3>复评与存疑处理</h3><div class="form-grid"></div>';
  const rulesGrid=rules.querySelector('.form-grid');rulesGrid.append($('dual').closest('label'),$('questionType').closest('label'),$('threshold').closest('label'));
  rulesGrid.insertAdjacentHTML('beforeend','<label class="wide">模型无法确认书写时<select id="recognitionPolicy"><option value="manual">交由人工确认</option><option value="arbitration">调用仲裁，按仲裁分数继续</option></select></label><p class="hint wide">有疑点时调用第三模型；三评总分及逐项分数一致则直接采用一致分数。三评不一致时，人工确认：暂停自动提交；按仲裁给分：采用仲裁有效分数。仲裁仍存疑时也采用其有效分数，保留疑点供审查。提交仍遵循当前运行模式，仲裁失败或分数无效时暂停。</p>');
  const ruleHint=workflowForm.querySelector('p.hint');if(ruleHint){ruleHint.classList.add('wide');rulesGrid.append(ruleHint);}workflowLayout.after(rules);

  const backupMenu=document.createElement('details');backupMenu.className='export-menu';backupMenu.innerHTML='<summary>配置备份</summary>';
  const backupOptions=document.createElement('div');backupOptions.className='export-options';
  const importControl=$('importFile').closest('label');importControl.before(backupMenu);backupOptions.append(importControl,$('exportConfig'));backupMenu.append(backupOptions);
  $('presets').querySelector('p.hint').textContent='直接设置当前任务的参考答案和评分标准。配置备份用于迁移和恢复，旧方案与工作流数据继续保留。';
  const providerCard=$('providerSelect').closest('.card');
  providerCard.querySelector('h2').textContent='模型供应商';
  const providerForm=$('endpoint').closest('.form-grid');
  const providerDialog=document.createElement('section');providerDialog.id='providerDialog';providerDialog.hidden=true;providerDialog.setAttribute('aria-labelledby','providerDialogTitle');
  providerDialog.innerHTML='<div class="image-dialog-heading"><h2 id="providerDialogTitle">编辑接口</h2><button id="closeProvider">关闭</button></div>';
  providerCard.append(providerDialog);providerDialog.append(providerForm);
  const advancedProvider=document.createElement('details');advancedProvider.innerHTML='<summary>高级设置</summary>';
  advancedProvider.append($('apiKeyEnv').closest('label'),$('modelsEndpoint').closest('label'));providerDialog.append(advancedProvider);
  const saveActions=document.createElement('div');saveActions.className='actions';saveActions.append($('saveProvider'));providerDialog.append(saveActions);
  const providerSummary=document.createElement('div');providerSummary.id='providerSummary';providerSummary.className='provider-summary';
  providerCard.querySelector('.controls').after(providerSummary);
  providerSummary.insertAdjacentHTML('afterend','<div class="actions"><button id="editProvider" class="primary">编辑接口</button><button id="viewProviderModels">查看模型目录</button></div>');
  const modelDialog=document.createElement('dialog');modelDialog.id='providerModelsDialog';modelDialog.innerHTML='<div class="image-dialog-heading"><h2>模型目录</h2><button id="closeProviderModels">关闭</button></div>';
  document.body.append(modelDialog);modelDialog.append($('modelCatalog'),$('fetchModels'),$('manualModelList'));
  const modelAdd=document.createElement('div');modelAdd.className='controls';modelAdd.append($('newModelId').closest('label'),$('addModelId'));modelDialog.append(modelAdd);
  providerCard.querySelectorAll('details').forEach(d=>{if(!providerDialog.contains(d))d.remove();});
  providerCard.querySelectorAll('p.hint').forEach((p,i)=>{if(i>0)p.remove();});
  $('editProvider').onclick=()=>{ $('providerDialogTitle').textContent='编辑接口 · '+$('providerSelect').value;$('apiKey').type='password';providerDialog.hidden=false;$('editProvider').setAttribute('aria-expanded','true');$('endpoint').focus();providerDialog.scrollIntoView({block:'nearest',behavior:'smooth'});};
  $('editProvider').setAttribute('aria-controls','providerDialog');$('editProvider').setAttribute('aria-expanded','false');
  $('closeProvider').onclick=()=>{providerDialog.hidden=true;$('editProvider').setAttribute('aria-expanded','false');$('editProvider').focus();};
  providerDialog.addEventListener('keydown',event=>{if(event.key==='Escape'){$('closeProvider').click();event.stopPropagation();}});
  $('viewProviderModels').onclick=()=>modelDialog.showModal();$('closeProviderModels').onclick=()=>modelDialog.close();
}

export function createEnhancements({getConfig,save,action,markDirty,renderPreset,renderUnits,renderProvider,renderWorkflow,getSnapshot,api,refreshSettings,notice}) {
  const $=id=>document.getElementById(id);const images={};
  setupRubricGenerator({getConfig,getImages:field=>structuredClone(images[field]||[]),action,api,markDirty});
  const deleteDialog=document.createElement('dialog');deleteDialog.id='deleteProviderDialog';deleteDialog.setAttribute('aria-labelledby','deleteProviderTitle');
  deleteDialog.innerHTML='<h2 id="deleteProviderTitle">删除模型接口</h2><p id="deleteProviderMessage" class="hint"></p><form method="dialog" class="actions"><button value="cancel">取消</button><button id="confirmDeleteProvider" value="delete" class="danger">确认删除</button></form>';
  document.body.append(deleteDialog);
  $('deleteProvider').onclick=()=>{
    const name=$('providerSelect').value;if(!name)return;
    $('deleteProviderMessage').textContent='删除接口“'+name+'”？所有任务共用此接口，引用它的工作流需要重新选择。历史记录保留，接口配置会先在本机备份。';
    deleteDialog.returnValue='';deleteDialog.showModal();
    deleteDialog.addEventListener('close',()=>{if(deleteDialog.returnValue!=='delete')return;action(async()=>{const result=await api('/api/provider-delete',{name});getConfig().providers=result.providers;$('providerDialog').hidden=true;refreshSettings();notice('接口已删除',true);});},{once:true});
  };

  function media(field) {
    const target=$(field+'ReferenceImages');target.replaceChildren();
    (images[field]||[]).forEach((value,index)=>{if(typeof value!=='string')return;const wrap=document.createElement('div'),img=document.createElement('img'),button=document.createElement('button');img.src=value.startsWith('data:')?value:`data:image/png;base64,${value}`;img.alt='方案说明图片';button.textContent='移除';button.onclick=()=>{images[field].splice(index,1);markDirty('presets');media(field);};wrap.append(img,button);target.append(wrap);});
  }
  async function addFieldImages(field, files) {
    const added=[];
    for(const file of files){
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('说明图片须为 PNG/JPG/WebP，且每张不超过5MB');
      added.push(await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败，请重新添加'));reader.readAsDataURL(file);}));
    }
    if(!added.length)return;
    images[field].push(...added);markDirty('presets');media(field);
  }
  for(const field of ['question','answer','rubric']){
    $(field+'Paste').onclick=()=>action(async()=>{
      if(!navigator.clipboard?.read)throw Error('当前浏览器不支持读取剪贴板，请点击上方输入框后按 Ctrl+V');
      let entries;try{entries=await navigator.clipboard.read();}catch{throw Error('无法读取剪贴板，请允许访问，或点击上方输入框后按 Ctrl+V');}
      const files=[];
      for(const entry of entries){const type=entry.types.find(type=>['image/png','image/jpeg','image/webp'].includes(type));if(type)files.push(await entry.getType(type));}
      if(!files.length)throw Error('剪贴板里没有图片，请先复制图片或截图');
      await addFieldImages(field,files);
    });
    $(field+'Upload').onchange=()=>{const files=[...$(field+'Upload').files];action(async()=>{await addFieldImages(field,files);$(field+'Upload').value='';});};
    $(field).addEventListener('paste',event=>{
      const items=[...(event.clipboardData?.items||[])];
      const files=items.filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
      if(!files.length)return;
      event.preventDefault();action(()=>addFieldImages(field,files));
    });
  }
  function preset() {const p=getConfig().presets[$('presetSelect').value];for(const field of ['question','answer','rubric']){images[field]=structuredClone(p[field]?.images||[]);media(field);}const d=p.scoring?.diligence||{};$('diligenceEnabled').checked=!!d.enabled;$('diligenceBonus').value=d.maxBonus??3;$('diligenceDecay').value=d.decayPower??2;$('diligenceCriteria').value=d.criteria||'';$('blankEnabled').checked=!!p.blankDetection?.enabled;$('blankThreshold').value=p.blankDetection?.threshold??0.01;$('blankStatus').textContent=p.blankDetection?.reference?.length ? `已保存 ${p.blankDetection.reference.length} 个范本特征` : '尚未设置空白范本；启用后将交给模型评分并要求人工确认。';}
  function applyPreset(p) {for(const field of ['question','answer','rubric']){if(images[field]?.length || typeof p[field]==='object')p[field]={...(typeof p[field]==='object'?p[field]:{text:p[field]}),images:structuredClone(images[field]||[])};}p.scoring.diligence={...p.scoring.diligence,enabled:$('diligenceEnabled').checked,maxBonus:Number($('diligenceBonus').value),decayPower:Number($('diligenceDecay').value),criteria:$('diligenceCriteria').value};p.blankDetection={...p.blankDetection,enabled:$('blankEnabled').checked,threshold:Number($('blankThreshold').value)};}
  function provider() {const p=getConfig().providers[$('providerSelect').value] || {};const summary=$('providerSummary');summary.replaceChildren();const empty=!Object.keys(getConfig().providers).length;for(const id of ['editProvider','viewProviderModels','deleteProvider'])$(id).disabled=empty;if(empty){summary.textContent='尚未添加模型供应商，点击新建开始配置。';$('manualModelList').replaceChildren();return;}for(const [label,value] of [['接口状态',p.endpoint&&(p.apiKey||p.apiKeyEnv)?'已配置':'待配置'],['协议',{chat:'Chat Completions',responses:'Responses',gemini:'Gemini 原生'}[p.protocol||'chat']],['模型目录',`${(p.models||[]).length} 个模型`]]){const item=document.createElement('div'),title=document.createElement('span'),text=document.createElement('strong');title.textContent=label;text.textContent=value;item.append(title,text);summary.append(item);}$('manualModelList').replaceChildren(...(p.models||[]).map(id=>{const row=document.createElement('div'),name=document.createElement('span'),button=document.createElement('button');name.textContent=id;button.textContent='移除';button.onclick=()=>action(async()=>{p.models=p.models.filter(m=>m!==id);await save('模型目录已保存','models');provider();});row.append(name,button);return row;}));}
  function workflow() {const w=getConfig().workflows[$('workflowSelect').value];for(const [prefix,entry]of[['primary',w.model],['secondary',w.dualEval?.secondary],['arbitration',w.dualEval?.arbitration]])$(prefix+'Effort').value=entry?.reasoningEffort||'';$('outputLimit').checked=w.outputLimitEnabled!==false && !!w.maxOutputTokens;$('outputTokens').value=w.maxOutputTokens||4096;$('requestBudget').value=getConfig().requestBudget||6;$('recognitionPolicy').value=w.recognitionPolicy||'manual';dual();}
  function dual(){const enabled=$('dual').checked;const arbitration=enabled||$('recognitionPolicy').value==='arbitration';document.querySelectorAll('.dual-control').forEach(el=>el.hidden=!enabled);$('secondaryPanel').hidden=!enabled;$('arbitrationPanel').hidden=!arbitration;for(const id of ['arbitrationProvider','arbitrationModel','arbitrationEffort'])$(id).closest('label').hidden=!arbitration;$('threshold').closest('label').hidden=!enabled||$('questionType').value!=='subjective';$('outputTokens').disabled=!$('outputLimit').checked;}
  $('recognitionPolicy').addEventListener('change',dual);$('questionType').addEventListener('change',dual);$('dual').addEventListener('change',dual);$('outputLimit').addEventListener('change',dual);
  $('toggleKey').onclick=()=>{$('apiKey').type=$('apiKey').type==='password'?'text':'password';$('toggleKey').textContent=$('apiKey').type==='password'?'显示密钥':'隐藏密钥';};
  // Only redraw scoring rows: the other form fields may contain unsaved text and images.
  $('detectUnits').onclick=()=>action(async()=>{await api('/api/diagnose',{});const s=await api('/api/state');if(!s.snapshot?.units.length)throw Error('未检测到评分框');if(document.querySelectorAll('.unit-row').length && !confirm('用当前页面评分框替换现有分项？'))return;const p=getConfig().presets[$('presetSelect').value];p.scoring ||= {};p.scoring.units=s.snapshot.units.map(u=>({label:u.label,maxScore:u.maxScore,roundStep:Number($('roundStep').value)||1}));renderUnits(p.scoring.units);markDirty('presets');});
  $('clearBlank').onclick=()=>action(async()=>{const p=getConfig().presets[$('presetSelect').value];p.blankDetection={...p.blankDetection,reference:[],enabled:false};await save('空白范本已清除','presets');preset();});
  $('addModelId').onclick=()=>action(async()=>{const id=$('newModelId').value.trim();if(!id)throw Error('请填写模型 ID');const p=getConfig().providers[$('providerSelect').value];p.models=[...new Set([...(p.models||[]),id])];await save('模型目录已保存','models');$('newModelId').value='';renderProvider();});
  async function remove(group,select) {const cfg=getConfig(),name=$(select).value;if(group!=='providers'&&Object.keys(cfg[group]).length<=1)throw Error('至少保留一项');if(group==='workflows'&&Object.values(cfg.presets).some(p=>p.workflowId===name))throw Error('工作流仍被方案使用，请先替换方案工作流');if(!confirm(group==='providers'?`删除供应商“${name}”？所有任务共用此接口；引用它的工作流需要重新选择供应商。历史记录仍会保留。`:`删除“${name}”？历史记录仍会保留。`))return;delete cfg[group][name];if(group==='presets'){if(cfg.active===name)cfg.active=Object.keys(cfg.presets)[0];for(const [task,p]of Object.entries(cfg.bindings||{}))if(p===name)delete cfg.bindings[task];}await save('已删除',group==='presets'?'presets':group==='workflows'?'workflows':'models');refreshSettings();}
  for(const [id,group,select]of[['deletePreset','presets','presetSelect'],['deleteWorkflow','workflows','workflowSelect']])$(id).onclick=()=>action(()=>remove(group,select));
  $('copyPreset').onclick=()=>action(async()=>{const cfg=getConfig(),name=$('presetSelect').value;let copy=name+' 副本',i=2;while(cfg.presets[copy])copy=name+' 副本 '+i++;cfg.presets[copy]=structuredClone(cfg.presets[name]);await save('方案已复制','presets');refreshSettings();$('presetSelect').value=copy;renderPreset();});
  function applyWorkflow(w){w.recognitionPolicy=$('recognitionPolicy').value;for(const [prefix,entry]of[['primary',w.model],['secondary',w.dualEval.secondary],['arbitration',w.dualEval.arbitration]]){const effort=$(prefix+'Effort').value;if(effort)entry.reasoningEffort=effort;else delete entry.reasoningEffort;}w.outputLimitEnabled=$('outputLimit').checked;w.maxOutputTokens=Number($('outputTokens').value);getConfig().requestBudget=Number($('requestBudget').value);}
  return {preset,provider,workflow,applyPreset,applyWorkflow};
}

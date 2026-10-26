import {providerTemplates} from './provider-templates.js';
import {setupRubricGenerator} from './rubric-generator.js';
import {setupPresetPreviews} from './preset-preview.js';
// Additional controls share the existing settings and API; no separate draft store is persisted.
export function buildLayout() {
  const $ = id => document.getElementById(id);
  $('endpoint').closest('label').insertAdjacentHTML('afterend','<label class="wide">模型目录地址（可选）<input id="modelsEndpoint" type="url" placeholder="留空时根据模型接口地址自动推导"></label>');
  $('addProvider').insertAdjacentHTML('afterend','<button id="addProviderTemplate">从模板添加</button>');
  document.body.insertAdjacentHTML('beforeend','<dialog id="providerTemplateDialog"><h2>选择 AI 接口模板</h2><p>仅添加官方公开接口地址和模型示例，密钥需要自行填写。模板可编辑或删除；模型可用性以账号为准。</p><div class="provider-template-grid"></div><div class="footer-actions"><button id="closeProviderTemplate">取消</button></div></dialog>');
  const templateGrid=document.querySelector('.provider-template-grid');
  for(const [name,template]of Object.entries(providerTemplates)){
    const button=document.createElement('button');button.dataset.providerTemplate=name;
    const title=document.createElement('strong');title.textContent=name;button.append(title);
    if(template.note){const hint=document.createElement('span');hint.textContent=template.note;button.append(hint);}
    templateGrid.append(button);
  }
  $('eyebrow').hidden = true;
  document.querySelector('.workspace-controls').insertAdjacentHTML('afterbegin','<section class="task-overview" aria-label="任务概览"><button type="button" id="toggleTaskOverview" class="task-overview-toggle" aria-expanded="true" aria-controls="workspaceCards"><span class="task-overview-heading"><strong>任务概览</strong><small>状态实时更新 · 点击切换</small></span><span class="task-overview-chevron" aria-hidden="true">⌄</span></button><div id="workspaceCards" class="workspace-cards"></div></section>');
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
  const overviewToggle=$('toggleTaskOverview'),workspaceCards=$('workspaceCards'),overviewSection=workspaceCards.closest('.task-overview');
  const mobileOverview=()=>matchMedia('(max-width:800px)').matches;
  const setOverview=expanded=>{
    overviewToggle.setAttribute('aria-expanded',String(expanded));
    if(mobileOverview()){workspaceCards.hidden=false;overviewSection.classList.toggle('is-compact',!expanded);}
    else{workspaceCards.hidden=!expanded;overviewSection.classList.remove('is-compact');}
  };
  overviewToggle.onclick=()=>setOverview(overviewToggle.getAttribute('aria-expanded')!=='true');
  setOverview(!mobileOverview());
  addEventListener('resize',()=>setOverview(overviewToggle.getAttribute('aria-expanded')==='true'));
  document.querySelector('header').insertAdjacentHTML('beforeend','<span id="dirtyBadge" class="dirty-badge" hidden>有未保存修改</span>');
  document.querySelector('header>div').append($('dirtyBadge'));
  const header=document.querySelector('header');
  header.insertAdjacentHTML('afterend',`<section id="taskSummary" class="task-summary" aria-label="当前任务摘要">
    <div class="task-summary-item"><span>当前任务</span><strong id="summaryTaskName">当前任务</strong></div>
    <div class="task-summary-item"><span>任务状态</span><strong id="summaryTaskState" class="summary-state" data-tone="pending">待开始</strong></div>
    <div class="task-summary-item"><span>当前方案</span><strong id="summaryTaskPreset">未命名方案</strong></div>
    <div class="task-summary-item"><span>已提交</span><strong id="summaryTaskCount">0 份</strong></div>
    <div class="task-summary-item task-summary-next"><span>下一步</span><strong id="summaryTaskNext">先完善阅卷方案</strong></div>
  </section>`);
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
  $('savePreset').closest('.footer-actions').insertAdjacentHTML('beforebegin',`<details class="grading-enhancements"><summary><span class="grading-enhancements-title"><strong>可选评分规则</strong><span>勤勉加分、空白检测</span></span><span class="grading-enhancements-caption">按需启用，未启用的规则不影响评分</span></summary><div class="grading-enhancements-body"><section class="setting-panel setting-panel-diligence"><div class="setting-panel-heading"><span class="setting-panel-icon" aria-hidden="true">+</span><div><h3>勤勉加分</h3><p>根据作答完整度与认真程度，在基础分之上少量加分。</p></div><label class="setting-switch"><input id="diligenceEnabled" type="checkbox"><span>启用</span></label></div><div class="setting-panel-content"><div class="setting-fields"><label>加分上限<input id="diligenceBonus" type="number" min="0.5" step="0.5"></label><label>衰减强度<select id="diligenceDecay"><option value="1">缓慢</option><option value="2">标准</option><option value="3">快速</option></select></label><label class="setting-field-wide">勤勉评估说明<textarea id="diligenceCriteria" rows="3" placeholder="例如：步骤完整、订正认真可适当加分；空白或敷衍作答不加分"></textarea></label></div><p class="setting-panel-note">说明会作为模型判断依据，建议写清加分与不加分的边界。</p></div></section><section class="setting-panel setting-panel-blank"><div class="setting-panel-heading"><span class="setting-panel-icon" aria-hidden="true">□</span><div><h3>空白检测</h3><p>与已确认的空白范本比对，可疑答卷仍须人工确认。</p></div><label class="setting-switch"><input id="blankEnabled" type="checkbox"><span>启用</span></label></div><div class="setting-panel-content"><div class="setting-fields setting-fields-blank"><label>范本差异阈值<input id="blankThreshold" type="number" min="0" max="1" step="0.001"></label><label class="setting-field-wide">范本状态<div id="blankStatus" class="setting-status">尚未设置空白范本</div></label></div><div class="setting-panel-footer"><p id="blankStatusHint" class="setting-panel-note"></p><button id="clearBlank" class="setting-clear-button" type="button">清除范本</button></div></div></section><p class="grading-enhancements-footnote">空白范本可在历史记录中选择已确认的空白答卷建立。</p></div></details>`);
  $('addProvider').insertAdjacentHTML('afterend','<button id="deleteProvider" class="danger">删除</button>');
  $('apiKey').insertAdjacentHTML('afterend','<button id="toggleKey" class="text-button" type="button">显示密钥</button>');
  $('modelCatalog').insertAdjacentHTML('afterend','<details><summary>手动管理模型目录</summary><div class="controls"><label>新增模型 ID<input id="newModelId"></label><button id="addModelId">添加</button></div><div id="manualModelList" class="model-list"></div></details>');
  $('addWorkflow').insertAdjacentHTML('afterend','<button id="deleteWorkflow" class="danger">删除</button>');
  $('primaryModel').closest('label').insertAdjacentHTML('afterend','<label class="wide">主评思考深度<select id="primaryEffort"><option value="">供应商默认</option><option value="none">none</option><option value="minimal">minimal</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select></label>');
  $('secondaryModel').closest('label').insertAdjacentHTML('afterend','<label class="wide dual-control">复评思考深度<select id="secondaryEffort"></select></label>');
  $('arbitrationModel').closest('label').insertAdjacentHTML('afterend','<label class="wide dual-control">仲裁思考深度<select id="arbitrationEffort"></select></label>');
  $('secondaryEffort').innerHTML=$('primaryEffort').innerHTML;$('arbitrationEffort').innerHTML=$('primaryEffort').innerHTML;
  for(const id of ['secondaryProvider','secondaryModel','arbitrationProvider','arbitrationModel'])$(id).closest('label').classList.add('dual-control');
  $('questionType').closest('label').insertAdjacentHTML('afterend','<p class="hint dual-control">客观题逐项比较小问得分；任意不一致或缺少明细均调用仲裁，总分相同也不能跳过。仲裁后汇总到网页评分框。主观分差阈值仅适用于主观题。</p>');
  $('saveWorkflow').closest('.footer-actions').insertAdjacentHTML('beforebegin','<details><summary>输出与请求设置</summary><div class="form-grid"><label class="check wide"><input id="outputLimit" type="checkbox">限制模型输出长度</label><label>最大输出 Token<input id="outputTokens" type="number" min="128" step="128"></label><label>单份请求预算<input id="requestBudget" type="number" min="1" max="100"></label><label>单份评分超时（秒）<input id="gradingTimeoutSeconds" type="number" min="60" max="900" step="30"></label></div><p class="hint">主观题可适当提高超时。网络或模型输出偶发异常时程序最多自动重试一次；请求预算包括双评、仲裁和重试。</p></details>');
  $('history').querySelector('.card-heading h2').textContent='记录列表';
  $('historyRows').closest('.table-wrap').insertAdjacentHTML('beforebegin','<div class="controls history-filter"><label>查找记录<input id="historySearch" placeholder="方案、识别内容或评分依据"></label><label>状态<select id="historyFilter"><option value="">全部状态</option><option value="review">待确认</option><option value="filled">已填分</option><option value="submitted">已提交</option><option value="paused">已暂停</option><option value="uncertain">提交待核对</option></select></label><span id="historyCount" class="hint"></span></div>');
  $('historyRows').closest('.table-wrap').insertAdjacentHTML('afterend','<div class="controls history-pagination"><label>每页<select id="historyPageSize"><option value="25">25 条</option><option value="50" selected>50 条</option><option value="100">100 条</option></select></label><button id="historyPrev" type="button">上一页</button><span id="historyPage" class="hint"></span><button id="historyNext" type="button">下一页</button></div>');
  $('dualSummary').insertAdjacentHTML('afterend','<div id="resultDetails" class="history-readable"></div>');
  $('historyJson').insertAdjacentHTML('beforebegin','<div id="historyReadable" class="history-readable"></div>');
  const rawDetails=document.createElement('details');rawDetails.innerHTML='<summary>技术记录</summary>';$('historyJson').before(rawDetails);rawDetails.append($('historyJson'));
  const historyDialog=document.createElement('dialog');historyDialog.id='historyDialog';historyDialog.setAttribute('aria-labelledby','historyDialogTitle');
  historyDialog.innerHTML='<div class="history-dialog-heading"><h2 id="historyDialogTitle">评阅详情</h2><button id="closeHistory" aria-label="关闭评阅详情">×</button></div>';
  document.body.append(historyDialog);$('historyDetail').querySelector('h2').remove();historyDialog.append($('historyDetail'));
  $('historyImages').before($('historyReadable'));$('historyImages').before(Object.assign(document.createElement('h3'),{textContent:'题目 / 答卷图片',className:'review-images-title'}));
  $('historyReadable').insertAdjacentHTML('beforebegin','<section id="historySummary" class="history-summary" aria-label="记录摘要"><div><span>任务</span><strong id="historySummaryTask">—</strong></div><div><span>方案</span><strong id="historySummaryPreset">—</strong></div><div><span>最终得分</span><strong id="historySummaryScore" class="history-summary-score">—</strong></div><div><span>提交状态</span><strong id="historySummaryState">—</strong></div><div><span>时间</span><strong id="historySummaryTime">—</strong></div><div><span>模式</span><strong id="historySummaryMode">—</strong></div></section>');
  $('closeHistory').onclick=()=>historyDialog.close();
  historyDialog.addEventListener('click',event=>{if(event.target===historyDialog){const rect=historyDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)historyDialog.close();}});
  $('historyFilter').closest('label').insertAdjacentHTML('afterend','<label>仲裁审查<select id="arbitrationFilter"><option value="">全部记录</option><option value="arbitration">只看仲裁记录</option></select></label>');
  const historyRowsObserver=new MutationObserver(()=>{for(const row of $('historyRows').rows){const state=row.cells[2]?.textContent||'';row.classList.toggle('history-pending',/待确认|待核对/.test(state));row.classList.toggle('history-conflict',/仲裁|冲突/.test(state));row.classList.toggle('history-filled',state.includes('已填分'));row.classList.toggle('history-submitted',state.includes('已提交'));}});historyRowsObserver.observe($('historyRows'),{childList:true});
  document.body.insertAdjacentHTML('beforeend','<dialog id="imageDialog"><div class="image-dialog-heading"><h2>图片查看</h2><button id="closeImage">关闭</button></div><img id="largeImage" alt="放大图片"></dialog>');
  $('closeImage').onclick=()=>$('imageDialog').close();
  document.addEventListener('click',e=>{if(e.target.matches('.images img,.field-thumbnails img')){$('largeImage').src=e.target.src;$('imageDialog').showModal();}});
  const sidebar=document.querySelector('aside'), oldNav=sidebar.querySelector('nav');
  oldNav.setAttribute('aria-label','全局设置');oldNav.classList.add('global-nav');
  const topNav=document.createElement('nav');topNav.className='task-tabs';topNav.setAttribute('aria-label','当前任务页面');
  const workflowTab=document.createElement('button');workflowTab.dataset.tab='workflows';workflowTab.textContent='评分设置';
  topNav.append(oldNav.querySelector('[data-tab="presets"]'),workflowTab,oldNav.querySelector('[data-tab="grading"]'),oldNav.querySelector('[data-tab="history"]'));
  topNav.querySelector('[data-tab="presets"]').textContent='阅卷方案';
  topNav.querySelector('[data-tab="grading"]').textContent='开始阅卷';
  topNav.querySelector('[data-tab="history"]').textContent='历史记录';
  const workspaceControls=document.querySelector('.workspace-controls');sidebar.insertBefore(workspaceControls,oldNav);
  const modelsButton=oldNav.querySelector('[data-tab="models"]');modelsButton.textContent='AI 接口';
  const globalHeading=document.createElement('div');globalHeading.className='nav-group-label';globalHeading.textContent='全局设置';oldNav.before(globalHeading);
  const taskHeading=document.createElement('div');taskHeading.className='nav-group-label task-nav-label';taskHeading.textContent='当前任务';
  const asideNote=sidebar.querySelector('.aside-note');
  sidebar.insertBefore(taskHeading,asideNote);sidebar.insertBefore(topNav,asideNote);
  const models=$('models'), grid=models.querySelector('.grid'), cards=[...grid.children];
  const workflowSection=document.createElement('section');workflowSection.id='workflows';workflowSection.className='tab';workflowSection.hidden=true;workflowSection.append(cards[1]);models.after(workflowSection);$('grading').append(models.lastElementChild);
  const sharedHint=document.createElement('p');sharedHint.className='hint';sharedHint.textContent='模型供应商、接口地址、密钥和模型目录适用于所有任务。修改后从下一轮阅卷生效。';cards[0].prepend(sharedHint);
  $('presetSelect').closest('.controls').hidden=true;
  $('workflowSelect').closest('.controls').hidden=true;
  $('presetWorkflow').closest('label').hidden=true;
  $('runPreset').closest('label').hidden=true;$('bind').hidden=true;
  
  $('presets').classList.add('settings-page');$('presets').querySelector('.card').classList.add('preset-shell');
  $('presets').querySelector('h2').textContent='方案内容';
  $('presets').querySelector('h2').insertAdjacentHTML('afterend','<p class="page-context">先完善题目内容，再设置评分方式。右侧预览会随输入实时更新。</p>');
  const scoringBase=document.createElement('div');scoringBase.className='scoring-base';
  $('maxScore').closest('label').firstChild.textContent='题目总分';$('roundStep').closest('label').firstChild.textContent='得分步长';
  $('roundStep').step='0.1';
  scoringBase.append($('maxScore').closest('label'),$('roundStep').closest('label'));
  scoringBase.insertAdjacentHTML('beforeend','<p class="hint">总分和步长与 AI 生成标准共用。步长为 1 时按整分给分，为 0.5 时允许半分。</p>');
  $('rubric').closest('label').after(scoringBase);
  const scoringAdvanced=document.createElement('details');scoringAdvanced.id='scoringAdvanced';scoringAdvanced.className='advanced-settings';scoringAdvanced.open=false;scoringAdvanced.innerHTML='<summary>网页评分框与分数取整</summary><p class="hint">这里设置网页接收分数的输入框，不是评分标准中的小问。只有网页有多个评分框时才需要添加；单个总分框可留空。</p>';
  const unitHeading=$('unitRows').previousElementSibling.previousElementSibling;
  const unitHint=$('unitRows').previousElementSibling;
  scoringAdvanced.append($('roundMethod').closest('label'),unitHeading,unitHint,$('unitRows'),$('addUnit'),$('detectUnits'),$('unitTotal'));
  unitHeading.textContent='网页评分框';unitHint.hidden=true;
  scoringBase.after(scoringAdvanced);
  $('workflows').querySelector('h2').textContent='评分规则';
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

  rules.querySelector('h3').textContent='复评与疑点处理';
  rulesGrid.classList.add('review-policy-grid');
  const toggle=$('dual').closest('label');toggle.classList.add('review-toggle');
  const toggleText=document.createElement('span');toggleText.innerHTML='<strong>双模型复评</strong><small>两次独立评分，按题型规则判断是否需要仲裁</small>';
  for(const node of [...toggle.childNodes])if(node.nodeType===Node.TEXT_NODE)node.remove();toggle.append(toggleText);
  const comparison=document.createElement('div');comparison.className='policy-card dual-control';
  comparison.innerHTML='<div class="policy-card-heading"><span class="policy-number">01</span><h4>分数一致性</h4></div><p class="hint">选择客观逐项核对，或主观总分差阈值。</p>';
  comparison.append($('questionType').closest('label'),$('threshold').closest('label'));
  const comparisonNote=document.createElement('p');comparisonNote.id='comparisonPolicyNote';comparisonNote.className='policy-note';comparison.append(comparisonNote);
  const recognition=document.createElement('div');recognition.className='policy-card dual-control';
  recognition.innerHTML='<div class="policy-card-heading"><span class="policy-number">02</span><h4>书写识别疑点</h4></div><p class="hint">模型无法确认书写时，选择后续处理方式。</p>';
  const recognitionField=$('recognitionPolicy').closest('label');recognitionField.classList.remove('wide');recognition.append(recognitionField);
  const recognitionNote=document.createElement('p');recognitionNote.id='recognitionPolicyNote';recognitionNote.className='policy-note';recognition.append(recognitionNote);
  for(const hint of [...rulesGrid.querySelectorAll(':scope > p.hint')])hint.remove();
  rulesGrid.append(comparison,recognition);
  const safeguards=document.createElement('details');safeguards.className='policy-explanation';safeguards.innerHTML='<summary>查看完整处理规则</summary><ul><li>客观题逐项比较；任意分歧或缺少明细都调用仲裁，总分相同也不能跳过。</li><li>主观题总分差在设定阈值内时取平均，超出时调用仲裁。</li><li>识别有疑点时调用第三模型；三评总分及逐项一致时直接采用一致分数。</li><li>三评不一致时，按所选方式转人工或采用有效仲裁分数；疑点仍保留供审查。</li><li>提交遵循当前运行模式；仲裁失败或分数无效时暂停。</li></ul>';safeguards.classList.add('dual-control');rules.append(safeguards);
  $('saveWorkflow').textContent='保存评分设置';
  const workflowCard=$('workflows').querySelector('.card');
  const workflowHeading=workflowCard.querySelector('h2');
  workflowHeading.after(Object.assign(document.createElement('section'),{id:'workflowStatus',className:'workflow-status',innerHTML:'<div><span>主评模型</span><strong id="workflowStatusPrimary">待配置</strong></div><div><span>复评 / 仲裁</span><strong id="workflowStatusDual">未启用</strong></div><div><span>题型规则</span><strong id="workflowStatusType">主观题 · 分差 2 分</strong></div><div><span>请求预算</span><strong id="workflowStatusBudget">6 次</strong></div>'}));
  const dualSection=document.createElement('section');dualSection.className='workflow-section workflow-dual-section';
  dualSection.innerHTML='<div class="section-heading compact"><div><h2>双模型复评</h2><p>开启后由主评和复评独立评分；出现分歧或识别疑点时再调用仲裁。</p></div></div>';
  dualSection.append(toggle);
  workflowLayout.insertBefore(dualSection,modelPanels.secondary);
  const questionSection=document.createElement('section');questionSection.className='workflow-section workflow-rule-section';
  questionSection.innerHTML='<div class="section-heading compact"><div><h2>题型规则</h2><p>客观题逐项核对；主观题在阈值内取平均。双模型关闭时此规则不生效。</p></div></div>';
  const questionGrid=document.createElement('div');questionGrid.className='workflow-field-grid';
  questionGrid.append($('questionType').closest('label'),$('threshold').closest('label'));
  questionSection.append(questionGrid,comparisonNote);workflowLayout.append(questionSection);
  const conflictSection=document.createElement('section');conflictSection.className='workflow-section workflow-rule-section';
  conflictSection.innerHTML='<div class="section-heading compact"><div><h2>冲突处理规则</h2><p>出现评分分歧或书写识别疑点时，决定继续自动处理还是交由人工确认。</p></div></div>';
  const conflictGrid=document.createElement('div');conflictGrid.className='workflow-field-grid';
  conflictGrid.append(recognitionField,recognitionNote);conflictSection.append(conflictGrid,safeguards);workflowLayout.append(conflictSection);
  comparison.remove();recognition.remove();rules.remove();workflowForm.hidden=true;
  const requestSettings=$('outputLimit').closest('details');
  requestSettings.classList.add('workflow-advanced','advanced-settings');
  workflowLayout.append(requestSettings);
  toolbar.classList.add('launch-console');
  const browserStep=document.createElement('section');browserStep.className='launch-pane';browserStep.id='browserStep';
  browserStep.innerHTML=`<div class="launch-pane-heading"><h2>连接阅卷页面</h2><span id="browserStatus" class="connection-status">未连接</span></div>
    <p id="browserGuide" class="launch-helper">打开浏览器，登录网站并进入阅卷页面。</p><div class="actions browser-actions"></div>
    <div class="page-check-result" aria-live="polite"><div class="check-result-heading"><strong id="checkTitle">等待页面检查</strong></div>
    <div id="checkMetrics" class="check-metrics" hidden><div><strong id="checkImages">—</strong><span>答卷图片</span></div><div><strong id="checkUnits">—</strong><span>评分框</span></div><div><strong id="checkIdentity">—</strong><span>答卷 ID</span></div></div>
    <p id="checkError" class="check-error" hidden></p></div>`;
  browserStep.querySelector('.actions').append($('open'),$('diagnose'));
  browserStep.querySelector('.page-check-result').append($('diagnosis'));
  const runtime=document.querySelector('.runtime-settings');runtime.classList.add('launch-pane');
  runtime.querySelector('.runtime-heading').innerHTML='<div class="launch-pane-heading"><h2>本次运行设置</h2><span id="runtimeSaved" class="runtime-saved">已保存</span></div><span id="runtimeSummary" hidden></span>';
  const runtimeControls=runtime.querySelector('.controls');runtimeControls.className='runtime-controls';
  const modeLabel=$('mode').closest('label');modeLabel.hidden=true;
  const modeChoices=document.createElement('fieldset');modeChoices.className='mode-choices';modeChoices.innerHTML='<legend>提交方式</legend>';
  for(const [value,title,description] of [['trial','人工确认','查看每份结果，由你确认提交'],['normal','倒计时提交','5 秒后提交，可随时拦停'],['unattended','无人值守','连续评分和提交，异常时暂停']]){
    const label=document.createElement('label');label.className='mode-choice';
    const radio=document.createElement('input');radio.type='radio';radio.name='runMode';radio.value=value;
    const copy=document.createElement('span');const strong=document.createElement('strong');strong.textContent=title;
    const hint=document.createElement('small');hint.textContent=description;copy.append(strong,hint);label.append(radio,copy);modeChoices.append(label);
    radio.addEventListener('input',()=>{if(radio.checked){$('mode').value=value;$('mode').dispatchEvent(new Event('input',{bubbles:true}));}});
  }
  runtimeControls.prepend(modeChoices);
  const quantity=document.createElement('div');quantity.className='quantity-settings';
  const limitLabel=$('batchEnabled').closest('label');limitLabel.lastChild.textContent='限制阅卷份数';
  quantity.append(limitLabel);quantity.insertAdjacentHTML('beforeend','<p id="quantitySummary" class="launch-helper">不限份数，阅卷结束后自动停止。</p>');
  const batchField=$('batch').closest('label');batchField.id='batchField';batchField.firstChild.textContent='最多提交';
  const batchInput=document.createElement('div');batchInput.className='batch-input';batchInput.append($('batch'));batchInput.insertAdjacentHTML('beforeend','<span>份</span>');batchField.append(batchInput);quantity.append(batchField);
  runtimeControls.append(quantity);
  const runtimeFooter=document.createElement('div');runtimeFooter.className='runtime-footer';runtimeFooter.innerHTML='<span>开始时自动保存本次设置</span>';
  $('saveMode').textContent='保存设置';runtimeFooter.append($('saveMode'));runtime.append(runtimeFooter);
  const columns=document.createElement('div');columns.className='launch-columns';columns.append(browserStep,runtime);toolbar.prepend(columns);
  const checklist=document.createElement('section');checklist.id='launchChecklist';checklist.className='launch-checklist';checklist.setAttribute('aria-label','开始阅卷准备状态');checklist.setAttribute('aria-live','polite');
  checklist.innerHTML='<div class="section-heading compact"><div><h2>准备状态</h2><p>五项都完成后即可开始；点击未完成项可直接前往处理。</p></div></div><div class="checklist-grid"><button type="button" class="check-item" data-check="preset"><span class="check-index">1</span><span class="check-copy"><strong>阅卷方案</strong><small>题目、参考答案与评分标准</small></span><span class="check-state">待设置</span></button><button type="button" class="check-item" data-check="scoring"><span class="check-index">2</span><span class="check-copy"><strong>评分设置</strong><small>主评模型与复评规则</small></span><span class="check-state">待设置</span></button><button type="button" class="check-item" data-check="browser"><span class="check-index">3</span><span class="check-copy"><strong>浏览器</strong><small>打开并登录专用浏览器</small></span><span class="check-state">未连接</span></button><button type="button" class="check-item" data-check="page"><span class="check-index">4</span><span class="check-copy"><strong>页面检查</strong><small>识别答卷图片与评分框</small></span><span class="check-state">待检查</span></button><button type="button" class="check-item" data-check="mode"><span class="check-index">5</span><span class="check-copy"><strong>运行模式</strong><small>确认提交方式与份数</small></span><span class="check-state">人工确认</span></button></div>';
  toolbar.prepend(checklist);
  $('readiness').hidden=true;
  checklist.addEventListener('click',event=>{
    const item=event.target.closest('[data-check]');if(!item)return;
    const check=item.dataset.check;
    if(check==='preset'||check==='scoring')document.querySelector(`.task-tabs [data-tab="${check==='preset'?'presets':'workflows'}"]`)?.click();
    else if(check==='browser'&&!$('open').disabled)$('open').click();
    else if(check==='page'&&!$('diagnose').disabled)$('diagnose').click();
    else if(check==='mode')document.querySelector('[name="runMode"]:not(:disabled),#mode')?.focus();
  });
  const launch=document.createElement('footer');launch.className='launch-footer';launch.id='launchFinal';
  launch.innerHTML='<div class="launch-overview"><p id="launchStatus" aria-live="polite">完成方案、模型和页面检查后即可开始。</p></div><div class="launch-submit"><div class="actions"></div></div>';
  launch.querySelector('.launch-overview').prepend($('readiness'));launch.querySelector('.launch-overview').append($('reason'));
  launch.querySelector('.launch-submit').prepend($('count'));launch.querySelector('.actions').append($('start'),$('pause'));toolbar.append(launch);
  for(const empty of toolbar.querySelectorAll(':scope > .actions,:scope > .summary'))if(!empty.children.length)empty.remove();
  const nextSettings=document.createElement('button');nextSettings.id='nextScoringSettings';nextSettings.textContent='下一步：评分设置';nextSettings.onclick=()=>document.querySelector('[data-tab="workflows"]').click();$('savePreset').after(nextSettings);
  const nextGrading=document.createElement('button');nextGrading.id='nextStartGrading';nextGrading.textContent='下一步：开始阅卷';nextGrading.onclick=()=>document.querySelector('[data-tab="grading"]').click();$('saveWorkflow').after(nextGrading);
  document.querySelectorAll('.tab').forEach(el=>el.hidden=el.id!=='grading');document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab==='grading'));$('title').textContent='开始阅卷';
  const backupMenu=document.createElement('details');backupMenu.className='export-menu';backupMenu.innerHTML='<summary>配置备份</summary>';
  const backupOptions=document.createElement('div');backupOptions.className='export-options';
  const importControl=$('importFile').closest('label');importControl.before(backupMenu);backupOptions.append(importControl,$('exportConfig'));backupMenu.append(backupOptions);
  $('presets').querySelector('p.hint').textContent='直接设置当前任务的参考答案和评分标准。配置备份用于迁移和恢复，旧方案与工作流数据继续保留。';
  const providerCard=$('providerSelect').closest('.card');
  providerCard.querySelector('h2').textContent='模型供应商';
  const providerForm=$('endpoint').closest('.form-grid');
  $('endpoint').placeholder='https://你的接口域名/v1';
  $('endpoint').closest('label').insertAdjacentHTML('beforeend','<span class="hint">填写基础地址，软件按协议自动补充请求路径。OpenAI兼容接口通常以 /v1 结尾；其他供应商使用其提供的基础路径。完整接口地址也可使用。</span>');
  const providerDialog=document.createElement('section');providerDialog.id='providerDialog';providerDialog.hidden=true;providerDialog.setAttribute('aria-labelledby','providerDialogTitle');
  providerDialog.innerHTML='<div class="image-dialog-heading"><h2 id="providerDialogTitle">编辑接口</h2><button id="closeProvider">关闭</button></div>';
  providerCard.append(providerDialog);providerDialog.append(providerForm);
  const advancedProvider=document.createElement('details');advancedProvider.innerHTML='<summary>高级设置</summary>';
  advancedProvider.append($('apiKeyEnv').closest('label'),$('modelsEndpoint').closest('label'));providerDialog.append(advancedProvider);
  const saveActions=document.createElement('div');saveActions.className='actions';saveActions.append($('saveProvider'));providerDialog.append(saveActions);
  const providerSummary=document.createElement('div');providerSummary.id='providerSummary';providerSummary.className='provider-summary';
  providerCard.querySelector('.controls').after(providerSummary);
  providerSummary.insertAdjacentHTML('afterend','<div class="actions"><button id="editProvider" class="primary">编辑接口</button><button id="viewProviderModels">查看模型目录</button></div>');
  const globalOverview=document.createElement('section');globalOverview.id='globalOverview';globalOverview.className='global-overview';globalOverview.setAttribute('aria-label','全局设置概览');
  globalOverview.innerHTML='<div class="section-heading compact"><div><h2>全局设置</h2><p>接口、模型目录、请求参数与异常提醒适用于所有任务。</p></div></div><div class="global-overview-grid"><button type="button" data-global-target="provider"><span>AI 接口</span><strong id="globalProviderStatus">待配置</strong></button><button type="button" data-global-target="models"><span>模型目录</span><strong id="globalModelStatus">0 个模型</strong></button><button type="button" data-global-target="request"><span>通用请求设置</span><strong id="globalRequestStatus">6 次 · 10 分钟</strong></button><button type="button" data-global-target="alerts"><span>通用异常提醒</span><strong id="globalAlertStatus">弹窗与声音</strong></button></div>';
  $('models').prepend(globalOverview);
  globalOverview.addEventListener('click',event=>{
    const button=event.target.closest('[data-global-target]');if(!button)return;
    const target=button.dataset.globalTarget;
    if(target==='provider'){providerSummary.scrollIntoView({block:'center',behavior:'smooth'});}
    else if(target==='models'){if(!$('viewProviderModels').disabled)$('viewProviderModels').click();}
    else if(target==='request'){
      document.querySelector('.task-tabs [data-tab="workflows"]')?.click();
      setTimeout(()=>{const details=$('outputLimit')?.closest('details');if(details){details.open=true;details.scrollIntoView({block:'center',behavior:'smooth'});}},300);
    }else if(target==='alerts'){
      document.querySelector('.task-tabs [data-tab="grading"]')?.click();
      setTimeout(()=>{const details=document.querySelector('.alert-settings');if(details){details.open=true;details.scrollIntoView({block:'center',behavior:'smooth'});}},300);
    }
  });
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
  setupPresetPreviews();
  function layoutPresetWorkspace(){
    const form=$('presets')?.querySelector('.form-grid');if(!form)return;
    const editors=[...form.querySelectorAll('.preset-editor')];if(!editors.length)return;
    const stepLabels={question:'01',answer:'02',rubric:'03'};
    const workspace=document.createElement('div');workspace.className='preset-workspace';
    const editorColumn=document.createElement('div');editorColumn.className='preset-editors';
    const previewPanel=document.createElement('aside');previewPanel.className='preset-preview-panel';previewPanel.setAttribute('aria-label','实时预览');
    previewPanel.innerHTML='<div class="section-heading compact"><div><h2>实时预览</h2><p>排版效果随输入更新</p></div><span class="live-label">实时</span></div><div class="preview-tabs" role="tablist" aria-label="选择预览内容"><button type="button" role="tab" data-preview-tab="question" aria-selected="true">题目</button><button type="button" role="tab" data-preview-tab="answer" aria-selected="false">参考答案</button><button type="button" role="tab" data-preview-tab="rubric" aria-selected="false">评分标准</button></div><div class="preview-panes"></div>';
    const panes=previewPanel.querySelector('.preview-panes');
    const previews={};
    for(const editor of editors){
      const realField=['question','answer','rubric'].find(name=>editor.querySelector('#'+name));
      editor.dataset.step=stepLabels[realField]||'';
      const display=editor.querySelector('.preset-editor-display');
      const preview=display?.querySelector('.preset-text-preview');
      display?.remove();
      const pane=document.createElement('div');pane.className='preview-pane';pane.dataset.preview=realField;pane.hidden=realField!=='question';
      if(preview)pane.append(preview);previews[realField]=pane;panes.append(pane);editorColumn.append(editor);
    }
    const generator=form.querySelector('#openRubricGenerator')?.closest('.wide');
    const rubricEditor=editors.find(editor=>editor.querySelector('#rubric'));
    if(generator&&rubricEditor)editorColumn.insertBefore(generator,rubricEditor);
    const scoringBase=form.querySelector('.scoring-base');if(scoringBase)editorColumn.append(scoringBase);
    form.prepend(workspace);workspace.append(editorColumn,previewPanel);
    const scoringAdvanced=$('scoringAdvanced');if(scoringAdvanced)workspace.after(scoringAdvanced);
    previewPanel.querySelectorAll('[data-preview-tab]').forEach(button=>button.addEventListener('click',()=>{
      const field=button.dataset.previewTab;
      for(const tab of previewPanel.querySelectorAll('[data-preview-tab]'))tab.setAttribute('aria-selected',String(tab===button));
      for(const [name,pane] of Object.entries(previews))pane.hidden=name!==field;
    }));
  }
  layoutPresetWorkspace();
  function layoutResultPanel(){
    const panel=$('resultPanel');if(!panel||panel.dataset.layoutReady)return;panel.dataset.layoutReady='1';
    const total=panel.querySelector('.score-total'),scores=$('scores'),commentPreview=$('commentPreview'),commentEditor=$('commentEditor'),ocr=$('ocr'),dualSummary=$('dualSummary'),details=$('resultDetails'),correction=$('correction').closest('label'),submitHint=$('submitHint'),actions=panel.querySelector('.review-actions'),raw=panel.querySelector('details:last-child');
    const section=(title,...children)=>{const node=document.createElement('section');node.className='result-section';node.innerHTML=`<h3>${title}</h3>`;node.append(...children);return node;};
    const modelLine=document.createElement('p');modelLine.id='modelStatusText';modelLine.className='result-note';modelLine.textContent='主评模型结果已返回，可查看下方明细。';
    total.querySelector('span').textContent='总分';
    actions.replaceChildren($('submit'),$('fill'),$('stopReview'));
    $('fill').classList.remove('primary');$('fill').classList.add('secondary');
    $('submit').classList.add('primary');$('stopReview').classList.remove('danger');$('stopReview').classList.add('warning');
    raw.classList.add('result-raw');raw.querySelector('summary').textContent='模型原始结果与计算详情';
    panel.replaceChildren(total,section('分项得分',scores),section('评分依据',commentPreview,commentEditor),section('识别内容',ocr),section('模型状态',modelLine,dualSummary),section('异常提示与评分明细',details),section('提交操作',correction,submitHint,actions),raw);
  }
  layoutResultPanel();
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
  function preset() {const p=getConfig().presets[$('presetSelect').value];for(const field of ['question','answer','rubric']){images[field]=structuredClone(p[field]?.images||[]);media(field);}const d=p.scoring?.diligence||{};$('diligenceEnabled').checked=!!d.enabled;$('diligenceBonus').value=d.maxBonus??3;$('diligenceDecay').value=d.decayPower??2;$('diligenceCriteria').value=d.criteria||'';$('blankEnabled').checked=!!p.blankDetection?.enabled;$('blankThreshold').value=p.blankDetection?.threshold??0.01;const blankStatus=$('blankStatus'),blankHint=$('blankStatusHint');if(p.blankDetection?.reference?.length){blankStatus.textContent=`已保存 ${p.blankDetection.reference.length} 个范本特征`;blankStatus.classList.add('has-reference');blankHint.textContent='范本已就绪，可随时启用或清除。';}else{blankStatus.textContent='尚未设置空白范本';blankStatus.classList.remove('has-reference');blankHint.textContent='启用后将交给模型评分，并要求人工确认。';}syncSettingPanels();}
  function applyPreset(p) {for(const field of ['question','answer','rubric']){if(images[field]?.length || typeof p[field]==='object')p[field]={...(typeof p[field]==='object'?p[field]:{text:p[field]}),images:structuredClone(images[field]||[])};}p.scoring.diligence={...p.scoring.diligence,enabled:$('diligenceEnabled').checked,maxBonus:Number($('diligenceBonus').value),decayPower:Number($('diligenceDecay').value),criteria:$('diligenceCriteria').value};p.blankDetection={...p.blankDetection,enabled:$('blankEnabled').checked,threshold:Number($('blankThreshold').value)};}
  function provider() {const p=getConfig().providers[$('providerSelect').value] || {};const summary=$('providerSummary');summary.replaceChildren();const empty=!Object.keys(getConfig().providers).length;for(const id of ['editProvider','viewProviderModels','deleteProvider'])$(id).disabled=empty;if(empty){summary.textContent='尚未添加模型供应商，点击新建开始配置。';$('manualModelList').replaceChildren();return;}for(const [label,value] of [['接口状态',p.endpoint&&(p.apiKey||p.apiKeyEnv)?'已配置':'待配置'],['协议',{chat:'Chat Completions',responses:'Responses',gemini:'Gemini 原生'}[p.protocol||'chat']],['模型目录',`${(p.models||[]).length} 个模型`]]){const item=document.createElement('div'),title=document.createElement('span'),text=document.createElement('strong');title.textContent=label;text.textContent=value;item.append(title,text);summary.append(item);}$('manualModelList').replaceChildren(...(p.models||[]).map(id=>{const row=document.createElement('div'),name=document.createElement('span'),button=document.createElement('button');name.textContent=id;button.textContent='移除';button.onclick=()=>action(async()=>{p.models=p.models.filter(m=>m!==id);await save('模型目录已保存','models');provider();});row.append(name,button);return row;}));}
  function workflow() {const w=getConfig().workflows[$('workflowSelect').value];for(const [prefix,entry]of[['primary',w.model],['secondary',w.dualEval?.secondary],['arbitration',w.dualEval?.arbitration]])$(prefix+'Effort').value=entry?.reasoningEffort||'';$('outputLimit').checked=w.outputLimitEnabled!==false && !!w.maxOutputTokens;$('outputTokens').value=w.maxOutputTokens||4096;$('requestBudget').value=getConfig().requestBudget||6;$('gradingTimeoutSeconds').value=Math.round((getConfig().gradingTimeoutMs||600000)/1000);$('recognitionPolicy').value=w.recognitionPolicy||'manual';dual();updateWorkflowStatus();}
  function updateWorkflowStatus(){
    const primaryModel=$('primaryModel')?.value.trim(),primaryProvider=$('primaryProvider')?.value;
    const dualEnabled=$('dual')?.checked;
    if($('workflowStatusPrimary'))$('workflowStatusPrimary').textContent=primaryModel?`${primaryProvider} · ${primaryModel}`:'待配置';
    if($('workflowStatusDual'))$('workflowStatusDual').textContent=dualEnabled?`已启用 · 复评 ${$('secondaryModel').value.trim()||'待配置'} · 仲裁 ${$('arbitrationModel').value.trim()||'待配置'}`:'未启用';
    if($('workflowStatusType'))$('workflowStatusType').textContent=$('questionType').value==='objective'?'客观题 · 逐项一致':`主观题 · 分差 ≤ ${$('threshold').value||0} 分`;
    if($('workflowStatusBudget'))$('workflowStatusBudget').textContent=`${$('requestBudget').value||6} 次 · 超时 ${Math.round((Number($('gradingTimeoutSeconds').value)||600)/60)} 分钟`;
  }
  function dual(){
    $('comparisonPolicyNote').textContent=$('questionType').value==='objective'?'每个小问分数一致才通过；总分相同但分项不同仍仲裁。':'两次总分差在阈值内取平均，超出阈值交由仲裁。';
    $('recognitionPolicyNote').textContent=$('recognitionPolicy').value==='manual'?'三评一致直接给分；仍不一致则暂停自动提交，交由你确认。':'采用有效仲裁分数继续，保留识别疑点供后续审查。';
    const enabled=$('dual').checked;const arbitration=enabled;
    $('secondaryPanel').hidden=!enabled;$('arbitrationPanel').hidden=!arbitration;
    const subjective=$('questionType').value==='subjective';
    $('threshold').closest('label').hidden=!subjective;
    $('threshold').disabled=!enabled;
    document.querySelectorAll('.dual-control').forEach(el=>el.hidden=!enabled);
    $('recognitionPolicy').disabled=!enabled;
    document.querySelector('.workflow-dual-section')?.classList.toggle('is-enabled',enabled);
    document.querySelectorAll('.workflow-rule-section').forEach(el=>el.classList.toggle('is-inactive',!enabled));
    $('outputTokens').disabled=!$('outputLimit').checked;
    updateWorkflowStatus();
  }
  $('recognitionPolicy').addEventListener('change',dual);$('questionType').addEventListener('change',dual);$('dual').addEventListener('change',dual);$('outputLimit').addEventListener('change',dual);
  for(const id of ['primaryProvider','primaryModel','secondaryProvider','secondaryModel','arbitrationProvider','arbitrationModel','threshold','requestBudget','gradingTimeoutSeconds']){$(id).addEventListener('input',updateWorkflowStatus);$(id).addEventListener('change',updateWorkflowStatus);}
  $('toggleKey').onclick=()=>{$('apiKey').type=$('apiKey').type==='password'?'text':'password';$('toggleKey').textContent=$('apiKey').type==='password'?'显示密钥':'隐藏密钥';};
  // Only redraw scoring rows: the other form fields may contain unsaved text and images.
  $('detectUnits').onclick=()=>action(async()=>{await api('/api/diagnose',{});const s=await api('/api/state');if(!s.snapshot?.units.length)throw Error('未检测到评分框');if(document.querySelectorAll('.unit-row').length && !confirm('用当前页面评分框替换现有分项？'))return;const p=getConfig().presets[$('presetSelect').value];p.scoring ||= {};p.scoring.units=s.snapshot.units.map(u=>({label:u.label,maxScore:u.maxScore,roundStep:Number($('roundStep').value)||1}));renderUnits(p.scoring.units);markDirty('presets');});
  function syncSettingPanels(){for(const [id,panelSelector]of[['diligenceEnabled','.setting-panel-diligence'],['blankEnabled','.setting-panel-blank']]){const enabled=$(id).checked;$(id).closest('.setting-panel').classList.toggle('is-enabled',enabled);const panel=document.querySelector(panelSelector);for(const control of panel.querySelectorAll('.setting-panel-content input:not([type=checkbox]),.setting-panel-content select,.setting-panel-content textarea'))control.disabled=!enabled;}$('clearBlank').disabled=!getConfig().presets[$('presetSelect').value]?.blankDetection?.reference?.length;}
  $('diligenceEnabled').addEventListener('change',syncSettingPanels);$('blankEnabled').addEventListener('change',syncSettingPanels);
  $('clearBlank').onclick=()=>action(async()=>{const p=getConfig().presets[$('presetSelect').value];p.blankDetection={...p.blankDetection,reference:[],enabled:false};await save('空白范本已清除','presets');preset();});
  $('addModelId').onclick=()=>action(async()=>{const id=$('newModelId').value.trim();if(!id)throw Error('请填写模型 ID');const p=getConfig().providers[$('providerSelect').value];p.models=[...new Set([...(p.models||[]),id])];await save('模型目录已保存','models');$('newModelId').value='';renderProvider();});
  async function remove(group,select) {const cfg=getConfig(),name=$(select).value;if(group!=='providers'&&Object.keys(cfg[group]).length<=1)throw Error('至少保留一项');if(group==='workflows'&&Object.values(cfg.presets).some(p=>p.workflowId===name))throw Error('工作流仍被方案使用，请先替换方案工作流');if(!confirm(group==='providers'?`删除供应商“${name}”？所有任务共用此接口；引用它的工作流需要重新选择供应商。历史记录仍会保留。`:`删除“${name}”？历史记录仍会保留。`))return;delete cfg[group][name];if(group==='presets'){if(cfg.active===name)cfg.active=Object.keys(cfg.presets)[0];for(const [task,p]of Object.entries(cfg.bindings||{}))if(p===name)delete cfg.bindings[task];}await save('已删除',group==='presets'?'presets':group==='workflows'?'workflows':'models');refreshSettings();}
  for(const [id,group,select]of[['deletePreset','presets','presetSelect'],['deleteWorkflow','workflows','workflowSelect']])$(id).onclick=()=>action(()=>remove(group,select));
  $('copyPreset').onclick=()=>action(async()=>{const cfg=getConfig(),name=$('presetSelect').value;let copy=name+' 副本',i=2;while(cfg.presets[copy])copy=name+' 副本 '+i++;cfg.presets[copy]=structuredClone(cfg.presets[name]);await save('方案已复制','presets');refreshSettings();$('presetSelect').value=copy;renderPreset();});
  function applyWorkflow(w){w.recognitionPolicy=$('recognitionPolicy').value;for(const [prefix,entry]of[['primary',w.model],['secondary',w.dualEval.secondary],['arbitration',w.dualEval.arbitration]]){const effort=$(prefix+'Effort').value;if(effort)entry.reasoningEffort=effort;else delete entry.reasoningEffort;}w.outputLimitEnabled=$('outputLimit').checked;w.maxOutputTokens=Number($('outputTokens').value);getConfig().requestBudget=Number($('requestBudget').value);const timeoutSeconds=Math.min(900,Math.max(60,Number($('gradingTimeoutSeconds').value)||600));getConfig().gradingTimeoutMs=timeoutSeconds*1000;}
  function updateHistorySummary(){
    const source=$('historyJson')?.textContent||'';if(!source.trim())return;
    let record;try{record=JSON.parse(source);}catch{return;}
    const states={loading:'获取图片',grading:'模型评分',review:'待确认',filled:'已填分',submitted:'已提交',paused:'已暂停',uncertain:'提交待核对',submitting:'提交中','resolved-not-submitted':'已确认未提交'};
    const modes={trial:'人工确认',normal:'倒计时提交',unattended:'无人值守'};
    if($('historySummaryTask'))$('historySummaryTask').textContent=$('workspaceCards')?.querySelector('.workspace-card.active .workspace-card-name')?.textContent?.trim() || getConfig()?.workspaceName || $('workspaceSelect')?.selectedOptions?.[0]?.textContent?.split(' · ')[0] || '当前任务';
    if($('historySummaryPreset'))$('historySummaryPreset').textContent=record.presetName || '未记录';
    if($('historySummaryScore'))$('historySummaryScore').textContent=Number.isFinite(record.result?.score)?`${record.result.score} 分`:'—';
    if($('historySummaryState'))$('historySummaryState').textContent=(states[record.state] || record.state || '未记录')+(record.receipt?.confirmed?' · 回执已确认':'');
    if($('historySummaryTime'))$('historySummaryTime').textContent=record.time?new Date(record.time).toLocaleString('zh-CN'):'未记录';
    if($('historySummaryMode'))$('historySummaryMode').textContent=modes[record.mode] || '旧记录未保存模式';
  }
  updateHistorySummary();
  if($('historyJson'))new MutationObserver(updateHistorySummary).observe($('historyJson'),{childList:true,characterData:true,subtree:true});
  function updateLaunchChecklist(){
    const checklist=$('launchChecklist');if(!checklist)return;
    const steps=[...document.querySelectorAll('#readiness .ready-step')];
    const prepared=index=>!!steps[index]?.classList.contains('complete');
    const browser=$('browserStatus')?.classList.contains('connected')||false;
    const page=document.querySelector('.page-check-result')?.dataset.status==='success';
    const mode=$('mode')?.value||'trial';
    const modeLabel={trial:'人工确认',normal:'倒计时提交',unattended:'无人值守'}[mode]||mode;
    const values={
      preset:{complete:prepared(0),state:prepared(0)?'已完成':'待设置'},
      scoring:{complete:prepared(1),state:prepared(1)?'已完成':'待设置'},
      browser:{complete:browser,state:browser?'已连接':'未连接'},
      page:{complete:page,state:page?'已识别':'待检查'},
      mode:{complete:true,state:modeLabel}
    };
    for(const item of checklist.querySelectorAll('[data-check]')){
      const value=values[item.dataset.check];if(!value)continue;
      item.classList.toggle('is-complete',value.complete);item.classList.toggle('is-blocked',!value.complete);
      item.querySelector('.check-state').textContent=value.state;
      item.setAttribute('aria-label',`${item.querySelector('strong').textContent}：${value.state}`);
    }
  }
  function updateActionLabels(){
    const start=$('start'),pause=$('pause'),phase=$('phase')?.textContent||'';
    if(!start||!pause)return;
    if($('phase'))$('phase').dataset.tone=/已暂停|等待|待核对/.test(phase)?'warning':/阅卷|正在|提交中/.test(phase)?'active':/完成|已提交|通过/.test(phase)?'success':/失败|异常|断开/.test(phase)?'danger':'pending';
    const running=!pause.disabled;
    pause.textContent='暂停阅卷';
    if(running)start.textContent='阅卷中';
    else if(/已暂停/.test(phase))start.textContent='继续阅卷';
    else if(start.disabled)start.textContent='检查配置';
    else start.textContent='开始阅卷';
    if(!running&&start.disabled)start.title='请先完成准备状态中的未完成项';
    else start.removeAttribute('title');
  }
  function updateGlobalOverview(){
    const cfg=getConfig();if(!cfg||!$('globalOverview'))return;
    if($('models')&&!$('models').hidden&&$('title').textContent!=='AI 接口')$('title').textContent='AI 接口';
    const provider=cfg.providers?.[$('providerSelect')?.value] || {};
    if($('globalProviderStatus'))$('globalProviderStatus').textContent=provider.endpoint&&(provider.apiKey||provider.apiKeyEnv)?'已配置':'待配置';
    if($('globalModelStatus'))$('globalModelStatus').textContent=`${(provider.models||[]).length} 个模型`;
    if($('globalRequestStatus'))$('globalRequestStatus').textContent=`${$('requestBudget')?.value||6} 次 · ${Math.round((Number($('gradingTimeoutSeconds')?.value)||600)/60)} 分钟`;
    if($('globalAlertStatus'))$('globalAlertStatus').textContent=[$('alertPopup')?.checked?'弹窗':null,$('alertSound')?.checked?'声音':null].filter(Boolean).join(' + ')||'已关闭';
  }
  function updateTaskSummary(){
    const cfg=getConfig();if(!cfg)return;
    const overviewToggle=$('toggleTaskOverview'),overviewCards=$('workspaceCards');
    if(overviewToggle&&overviewCards&&!overviewCards.dataset.overviewInit&&overviewCards.children.length){
      overviewCards.dataset.overviewInit='1';
      if(matchMedia('(max-width:800px)').matches){overviewToggle.setAttribute('aria-expanded','false');overviewCards.hidden=false;overviewSection.classList.add('is-compact');}
    }
    const phase=$('phase')?.textContent?.trim() || '待开始';
    const cardName=$('workspaceCards')?.querySelector('.workspace-card.active .workspace-card-name')?.textContent?.trim();
    const taskName=cardName || cfg.workspaceName || '当前任务';
    const countText=$('count')?.textContent || '';
    const count=countText.match(/\d+/)?.[0] || '0';
    const steps=[...document.querySelectorAll('#readiness .ready-step')];
    const missing=steps.filter(step=>!step.classList.contains('complete')).map(step=>step.querySelector('span:nth-child(2)')?.textContent || step.textContent.trim());
    let next;
    if(/阅卷中|正在阅卷/.test(phase))next='可暂停阅卷，或在结果区确认提交';
    else if(/已暂停/.test(phase))next='可继续阅卷，或停止并保存';
    else if(/阅卷完成/.test(phase))next='切换题目后重新检查页面';
    else if(missing.length)next=`先完成${missing.join('、')}`;
    else if($('browserStatus') && !$('browserStatus').classList.contains('connected'))next='打开阅卷浏览器并登录';
    else if($('checkTitle') && !/页面已识别|阅卷已结束/.test($('checkTitle').textContent))next='检查阅卷页面';
    else next='准备就绪，可以开始阅卷';
    if($('summaryTaskName'))$('summaryTaskName').textContent=taskName;
    if($('summaryTaskState')){$('summaryTaskState').textContent=phase;$('summaryTaskState').dataset.tone=/已暂停|等待|待核对/.test(phase)?'warning':/阅卷|正在|提交中/.test(phase)?'active':/完成|已提交|通过/.test(phase)?'success':/失败|异常|断开/.test(phase)?'danger':'pending';}
    if($('summaryTaskPreset'))$('summaryTaskPreset').textContent=cfg.active || '未选择方案';
    if($('summaryTaskCount'))$('summaryTaskCount').textContent=`${count} 份`;
    if($('summaryTaskNext'))$('summaryTaskNext').textContent=next;
  }
  const refreshShell=()=>{
    updateTaskSummary();updateLaunchChecklist();updateActionLabels();updateGlobalOverview();
    for(const button of document.querySelectorAll('aside [data-tab]')){
      if(button.classList.contains('active'))button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
  };
  refreshShell();
  setInterval(refreshShell,700);
  const shellObserver=new MutationObserver(refreshShell);
  for(const id of ['phase','title','workspaceCards','workspaceStatus'])if($(id))shellObserver.observe($(id),{childList:true,characterData:true,subtree:true});
  return {preset,provider,workflow,applyPreset,applyWorkflow};
}

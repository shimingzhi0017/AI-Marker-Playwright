// Additional controls share the existing settings and API; no separate draft store is persisted.
export function buildLayout() {
  const $ = id => document.getElementById(id);
  $('eyebrow').hidden = true;
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
  $('addWorkspace').textContent = '＋ 新建任务';
  $('addWorkspace').insertAdjacentHTML('afterend','<button id="renameWorkspace">重命名</button><button id="deleteWorkspace" class="danger">删除任务</button>');
  document.body.insertAdjacentHTML('beforeend','<dialog id="workspaceDialog"><form method="dialog"><h2 id="workspaceDialogTitle">重命名任务</h2><p id="workspaceDialogHint" class="hint"></p><label id="workspaceNameLabel">任务名称<input id="workspaceNameInput" maxlength="80" required></label><div class="actions"><button value="cancel" formnovalidate>取消</button><button id="workspaceDialogSave" value="ok" class="primary">保存</button></div></form></dialog>');
  document.querySelector('header').insertAdjacentHTML('beforeend','<span id="dirtyBadge" class="dirty-badge" hidden>有未保存修改</span>');
  const toolbar = document.querySelector('.toolbar');
  toolbar.insertAdjacentHTML('afterbegin','<div id="readiness" class="readiness" aria-live="polite"></div>');
  const controls = toolbar.querySelector('.controls');
  const details = document.createElement('details'); details.className='runtime-settings';
  details.innerHTML='<summary>运行设置与方案绑定 <span id="runtimeSummary"></span></summary>';
  controls.before(details); details.append(controls);
  details.append($('bind'));
  controls.insertAdjacentHTML('afterbegin','<label>本任务使用方案<select id="runPreset"></select></label>');
  controls.insertAdjacentHTML('beforeend','<label class="check"><input id="batchEnabled" type="checkbox" checked>限制本次份数</label>');
  toolbar.querySelector('p.hint').remove();
  const comment=$('comment');const textarea=document.createElement('textarea');textarea.id='comment';textarea.rows=4;textarea.setAttribute('aria-label','评分依据');comment.replaceWith(textarea);
  $('scores').insertAdjacentHTML('afterend','<div class="score-total"><span>分数合计</span><strong id="scoreTotal">—</strong></div><div id="dualSummary" class="hint" hidden></div>');
  $('rawResult').closest('details').before($('resultPanel').querySelector('.review-actions'));
  $('answerImages').closest('.card').classList.add('answer-card');$('resultPanel').closest('.card').classList.add('result-card');
  $('answerImages').insertAdjacentHTML('beforebegin','<p class="hint">点击图片可放大查看</p>');
  $('answerImages').innerHTML='<div class="empty">开始阅卷后，这里显示当前答卷图片</div>';
  document.querySelector('#grading > .card:last-child').classList.add('event-card');
  $('addPreset').insertAdjacentHTML('afterend','<button id="copyPreset">复制</button><button id="deletePreset" class="danger">删除</button>');
  for(const field of ['question','answer','rubric']) {
    $(field).closest('label').insertAdjacentHTML('afterend',`<div class="field-media wide"><div id="${field}Images" class="field-thumbnails"></div><label class="file-button small">添加说明图片<input id="${field}Upload" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><span class="hint">图片随方案保存；支持 PNG、JPG、WebP</span></div>`);
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
  historyDialog.innerHTML='<div class="history-dialog-heading"><h2 id="historyDialogTitle">记录详情</h2><button id="closeHistory" aria-label="关闭记录详情">关闭</button></div>';
  document.body.append(historyDialog);$('historyDetail').querySelector('h2').remove();historyDialog.append($('historyDetail'));
  $('closeHistory').onclick=()=>historyDialog.close();
  historyDialog.addEventListener('click',event=>{if(event.target===historyDialog){const rect=historyDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)historyDialog.close();}});
  $('historyFilter').closest('label').insertAdjacentHTML('afterend','<label>仲裁审查<select id="arbitrationFilter"><option value="">全部记录</option><option value="arbitration">只看仲裁记录</option></select></label>');
  document.body.insertAdjacentHTML('beforeend','<dialog id="imageDialog"><div class="image-dialog-heading"><h2>图片查看</h2><button id="closeImage">关闭</button></div><img id="largeImage" alt="放大图片"></dialog>');
  $('closeImage').onclick=()=>$('imageDialog').close();
  document.addEventListener('click',e=>{if(e.target.matches('.images img,.field-thumbnails img')){$('largeImage').src=e.target.src;$('imageDialog').showModal();}});
  const sidebar=document.querySelector('aside'), oldNav=sidebar.querySelector('nav');
  const topNav=document.createElement('nav');topNav.className='task-tabs';topNav.setAttribute('aria-label','当前任务页面');
  const workflowTab=document.createElement('button');workflowTab.dataset.tab='workflows';workflowTab.textContent='评分工作流';
  topNav.append(oldNav.querySelector('[data-tab="grading"]'),oldNav.querySelector('[data-tab="presets"]'),workflowTab,oldNav.querySelector('[data-tab="history"]'));
  document.querySelector('header').after(topNav);
  const workspaceControls=document.querySelector('.workspace-controls');sidebar.insertBefore(workspaceControls,oldNav);
  const modelsButton=oldNav.querySelector('[data-tab="models"]');modelsButton.textContent='模型接口（全任务共享）';
  const models=$('models'), grid=models.querySelector('.grid'), cards=[...grid.children];
  const workflowSection=document.createElement('section');workflowSection.id='workflows';workflowSection.className='tab';workflowSection.hidden=true;workflowSection.append(cards[1]);models.after(workflowSection);$('presets').append(models.lastElementChild);
  const sharedHint=document.createElement('p');sharedHint.className='hint';sharedHint.textContent='模型供应商、接口地址、密钥和模型目录适用于所有任务。修改后从下一轮阅卷生效。';cards[0].prepend(sharedHint);
  $('presetSelect').closest('.controls').hidden=true;
  $('workflowSelect').closest('.controls').hidden=true;
  $('presetWorkflow').closest('label').hidden=true;
  $('runPreset').closest('label').hidden=true;$('bind').hidden=true;
  document.querySelector('.runtime-settings summary').firstChild.textContent='运行设置 ';
  $('presets').querySelector('h2').textContent='当前任务方案';
  $('workflows').querySelector('h2').textContent='当前任务评分工作流';
  const backupMenu=document.createElement('details');backupMenu.className='export-menu';backupMenu.innerHTML='<summary>配置备份</summary>';
  const backupOptions=document.createElement('div');backupOptions.className='export-options';
  const importControl=$('importFile').closest('label');importControl.before(backupMenu);backupOptions.append(importControl,$('exportConfig'));backupMenu.append(backupOptions);
  $('presets').querySelector('p.hint').textContent='直接设置当前任务的参考答案和评分标准。配置备份用于迁移和恢复，旧方案与工作流数据继续保留。';
}

export function createEnhancements({getConfig,save,action,markDirty,renderPreset,renderProvider,renderWorkflow,getSnapshot,api,refreshSettings}) {
  const $=id=>document.getElementById(id);const images={};
  function media(field) {
    const target=$(field+'Images');target.replaceChildren();
    (images[field]||[]).forEach((value,index)=>{if(typeof value!=='string')return;const wrap=document.createElement('div'),img=document.createElement('img'),button=document.createElement('button');img.src=value.startsWith('data:')?value:`data:image/png;base64,${value}`;img.alt='方案说明图片';button.textContent='移除';button.onclick=()=>{images[field].splice(index,1);markDirty('presets');media(field);};wrap.append(img,button);target.append(wrap);});
  }
  for(const field of ['question','answer','rubric'])$(field+'Upload').onchange=()=>action(async()=>{for(const file of $(field+'Upload').files){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('说明图片须为 PNG/JPG/WebP，且每张不超过5MB');images[field].push(await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);}));}markDirty('presets');media(field);$(field+'Upload').value='';});
  function preset() {const p=getConfig().presets[$('presetSelect').value];for(const field of ['question','answer','rubric']){images[field]=structuredClone(p[field]?.images||[]);media(field);}const d=p.scoring?.diligence||{};$('diligenceEnabled').checked=!!d.enabled;$('diligenceBonus').value=d.maxBonus??3;$('diligenceDecay').value=d.decayPower??2;$('diligenceCriteria').value=d.criteria||'';$('blankEnabled').checked=!!p.blankDetection?.enabled;$('blankThreshold').value=p.blankDetection?.threshold??0.01;$('blankStatus').textContent=p.blankDetection?.reference?.length ? `已保存 ${p.blankDetection.reference.length} 个范本特征` : '尚未设置空白范本；启用后将交给模型评分并要求人工确认。';}
  function applyPreset(p) {for(const field of ['question','answer','rubric']){if(images[field]?.length || typeof p[field]==='object')p[field]={...(typeof p[field]==='object'?p[field]:{text:p[field]}),images:structuredClone(images[field]||[])};}p.scoring.diligence={...p.scoring.diligence,enabled:$('diligenceEnabled').checked,maxBonus:Number($('diligenceBonus').value),decayPower:Number($('diligenceDecay').value),criteria:$('diligenceCriteria').value};p.blankDetection={...p.blankDetection,enabled:$('blankEnabled').checked,threshold:Number($('blankThreshold').value)};}
  function provider() {const p=getConfig().providers[$('providerSelect').value];$('manualModelList').replaceChildren(...(p.models||[]).map(id=>{const row=document.createElement('div'),name=document.createElement('span'),button=document.createElement('button');name.textContent=id;button.textContent='移除';button.onclick=()=>action(async()=>{p.models=p.models.filter(m=>m!==id);await save('模型目录已保存','models');provider();});row.append(name,button);return row;}));}
  function workflow() {const w=getConfig().workflows[$('workflowSelect').value];for(const [prefix,entry]of[['primary',w.model],['secondary',w.dualEval?.secondary],['arbitration',w.dualEval?.arbitration]])$(prefix+'Effort').value=entry?.reasoningEffort||'';$('outputLimit').checked=w.outputLimitEnabled!==false && !!w.maxOutputTokens;$('outputTokens').value=w.maxOutputTokens||4096;$('requestBudget').value=getConfig().requestBudget||6;dual();}
  function dual(){document.querySelectorAll('.dual-control').forEach(el=>el.hidden=!$('dual').checked);$('outputTokens').disabled=!$('outputLimit').checked;}
  $('dual').addEventListener('change',dual);$('outputLimit').addEventListener('change',dual);
  $('toggleKey').onclick=()=>{$('apiKey').type=$('apiKey').type==='password'?'text':'password';$('toggleKey').textContent=$('apiKey').type==='password'?'显示密钥':'隐藏密钥';};
  $('detectUnits').onclick=()=>action(async()=>{await api('/api/diagnose',{});const s=await api('/api/state');if(!s.snapshot?.units.length)throw Error('未检测到评分框');if(document.querySelectorAll('.unit-row').length && !confirm('用当前页面评分框替换现有分项？'))return;const p=getConfig().presets[$('presetSelect').value];p.scoring ||= {};p.scoring.units=s.snapshot.units.map(u=>({label:u.label,maxScore:u.maxScore,roundStep:p.scoring.roundStep||1}));renderPreset();markDirty('presets');});
  $('clearBlank').onclick=()=>action(async()=>{const p=getConfig().presets[$('presetSelect').value];p.blankDetection={...p.blankDetection,reference:[],enabled:false};await save('空白范本已清除','presets');preset();});
  $('addModelId').onclick=()=>action(async()=>{const id=$('newModelId').value.trim();if(!id)throw Error('请填写模型 ID');const p=getConfig().providers[$('providerSelect').value];p.models=[...new Set([...(p.models||[]),id])];await save('模型目录已保存','models');$('newModelId').value='';renderProvider();});
  async function remove(group,select) {const cfg=getConfig(),name=$(select).value;if(Object.keys(cfg[group]).length<=1)throw Error('至少保留一项');if(group==='workflows'&&Object.values(cfg.presets).some(p=>p.workflowId===name))throw Error('工作流仍被方案使用，请先替换方案工作流');if(group==='providers'&&Object.values(cfg.workflows).some(w=>[w.model,w.dualEval?.secondary,w.dualEval?.arbitration].some(e=>e?.provider===name)))throw Error('供应商仍被工作流引用，请先替换模型供应商');if(!confirm(`删除“${name}”？历史记录仍会保留。`))return;delete cfg[group][name];if(group==='presets'){if(cfg.active===name)cfg.active=Object.keys(cfg.presets)[0];for(const [task,p]of Object.entries(cfg.bindings||{}))if(p===name)delete cfg.bindings[task];}await save('已删除',group==='presets'?'presets':group==='workflows'?'workflows':'models');refreshSettings();}
  for(const [id,group,select]of[['deletePreset','presets','presetSelect'],['deleteProvider','providers','providerSelect'],['deleteWorkflow','workflows','workflowSelect']])$(id).onclick=()=>action(()=>remove(group,select));
  $('copyPreset').onclick=()=>action(async()=>{const cfg=getConfig(),name=$('presetSelect').value;let copy=name+' 副本',i=2;while(cfg.presets[copy])copy=name+' 副本 '+i++;cfg.presets[copy]=structuredClone(cfg.presets[name]);await save('方案已复制','presets');refreshSettings();$('presetSelect').value=copy;renderPreset();});
  function applyWorkflow(w){for(const [prefix,entry]of[['primary',w.model],['secondary',w.dualEval.secondary],['arbitration',w.dualEval.arbitration]]){const effort=$(prefix+'Effort').value;if(effort)entry.reasoningEffort=effort;else delete entry.reasoningEffort;}w.outputLimitEnabled=$('outputLimit').checked;w.maxOutputTokens=Number($('outputTokens').value);getConfig().requestBudget=Number($('requestBudget').value);}
  return {preset,provider,workflow,applyPreset,applyWorkflow};
}

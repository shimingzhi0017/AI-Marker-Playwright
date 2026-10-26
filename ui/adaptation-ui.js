export function buildAdaptationUI() {
  const fields=document.getElementById('platformFields'), details=fields.closest('details'), card=details.closest('.card');
  const advanced=document.createElement('details');advanced.innerHTML='<summary>高级规则：选择器与提交字段</summary>';
  const heading=document.createElement('h2');heading.textContent='选择阅卷网站';card.prepend(heading);
  const root=document.createElement('div');root.id='adaptationWizard';root.innerHTML=`
  <p class="hint">选择内置网站方案即可带入整套适配规则；也可添加自定义方案，按步骤自行调试。</p>
  <div class="controls"><label>网站方案<select id="adaptGroup"></select></label><button id="adaptTemplate">从内置方案添加</button><button id="adaptNew">新建自定义方案</button><button id="adaptDelete">删除方案</button></div>
  <div class="form-grid"><label>分组名称<input id="adaptName"></label><label>匹配网址<input id="adaptUrl" placeholder="https://网站/阅卷路径"></label></div>
  <p class="hint">相同域名按路径及#路由前缀匹配，优先使用更具体的分组。考试参数不参与匹配。</p>
  <div class="actions"><button id="adaptSave" class="primary">保存分组</button><button id="adaptInspect">1. 检查页面</button></div>
  <div class="adapt-status" id="adaptStatus">尚未检查页面</div>
  <details id="adaptCustomSteps"><summary>自行调试与修正规则</summary><h3>2. 点选修正</h3><div class="actions">
  <button data-adapt-pick="imageSelector">选答卷图片</button><button data-adapt-pick="scoreSelector">选评分框</button><button data-adapt-pick="submitSelector">选提交按钮</button><button data-adapt-pick="paperIdSelector">选答卷编号</button><button data-adapt-pick="taskIdSelector">选题号</button><button data-adapt-pick="completionSelector">选完成提示</button></div>
  <p class="hint">点选后切到阅卷网页点击对应位置。程序只选取元素，不触发网页按钮。相同评分框可在高级规则中扩大选择范围。</p>
  <h3>3. 填分测试</h3><label>测试分数（多个评分框用逗号分隔）<input id="adaptScores" placeholder="例如：2 或 2,3"></label><div class="actions"><button id="adaptFill">只填测试分数</button></div>
  <h3>4. 提交验证</h3><p class="hint">确认网页中答卷和测试分数正确，再开始记录并自行点击网站提交。换卷后核验实际提交接口。</p>
  <div class="actions"><button id="adaptRecord">开始记录手动提交</button><button id="adaptRefresh">刷新录制结果</button></div>
  <label>选择提交接口<select id="adaptCandidate"></select></label>
  <details><summary>查看接口记录（常见凭据已遮盖）</summary><pre id="adaptNetwork"></pre></details>
  <div class="actions"><button id="adaptVerify">核验提交并启用此分组</button></div>
  <details><summary>页面识别报告</summary><pre id="adaptReport"></pre></details></details>`;
  document.body.insertAdjacentHTML('beforeend','<dialog id="adaptTemplateDialog"><h2>添加网站适配方案</h2><label>网站<select id="adaptTemplateSelect"></select></label><p id="adaptTemplateStatus" class="hint"></p><label>实际阅卷网址<input id="adaptTemplateUrl" type="url" placeholder="填写网站或内网部署地址"></label><div class="footer-actions"><button id="adaptTemplateCancel">取消</button><button id="adaptTemplateAdd" class="primary">添加方案</button></div></dialog>');
  card.append(root);advanced.append(fields,document.getElementById('verified').closest('label'));card.append(advanced);
  const settings=document.createElement('details');settings.id='adaptAdvancedSettings';settings.innerHTML='<summary>高级设置与自定义网站</summary>';
  const websiteControls=document.createElement('div');websiteControls.className='controls';websiteControls.innerHTML='<label>选择阅卷网站<select id="adaptWebsite"><option value="">正在加载网站…</option></select></label><button id="adaptAddCustom">添加自定义网站</button>';
  const intro=root.querySelector('p.hint');intro.textContent='选择内置网站即可使用对应适配规则；未列出的网站可添加自定义方案。';
  websiteControls.append(document.getElementById('adaptDelete'));
  const websiteAddress=document.createElement('p');websiteAddress.id='websiteAddress';websiteAddress.className='website-address';websiteAddress.setAttribute('aria-live','polite');
  card.insertBefore(intro,root);card.insertBefore(websiteControls,root);card.insertBefore(document.getElementById('adaptStatus'),root);
  websiteControls.after(websiteAddress);
  card.append(settings);settings.append(root,advanced);
  document.getElementById('adaptTemplate').hidden=true;
  card.id='websiteCard';card.classList.add('website-picker');heading.hidden=true;intro.hidden=true;
  document.getElementById('browserStep').insertBefore(card,document.getElementById('browserGuide'));
  document.getElementById('verified').disabled=true;
  document.getElementById('savePlatform').hidden=true;advanced.append(document.getElementById('savePlatform'));details.remove();
}
export function createAdaptationUI({getConfig,api,action,notice,refresh,markDirty,onWebsiteChanged}) {
  const $=id=>document.getElementById(id);let selected,lastPick,inspection,recorded=false;
  const deleteDialog=document.createElement('dialog');deleteDialog.id='deleteWebsiteDialog';
  deleteDialog.innerHTML='<h2>删除自定义网站</h2><p id="deleteWebsiteMessage"></p><form method="dialog" class="actions"><button value="cancel">取消</button><button value="delete" class="danger">确认删除</button></form>';
  document.body.append(deleteDialog);
  let templates=[];
  function websiteOptions(){
    if(!getConfig())return;
    const select=$('adaptWebsite'), group=current();
    select.replaceChildren(
      Object.assign(document.createElement('option'),{value:'',textContent:'请选择阅卷网站'}),
      ...templates.map(t=>Object.assign(document.createElement('option'),{value:'template:'+t.id,textContent:t.id==='zhixue'?'智学网（内置方案）':t.name})),
      ...groups().filter(g=>!g.templateId).map(g=>{
        const isDefaultZhixue=/^(?:https?:\/\/)?(?:www\.)?zhixue\.com\//i.test(g.url)&&['默认页面配置','原有页面配置','智学网'].includes(g.name);
        return Object.assign(document.createElement('option'),{value:'group:'+g.id,textContent:isDefaultZhixue?'智学网（默认配置）':g.name+'（自定义）'});
      })
    );
    const preferred=getConfig()?.selectedAdaptationGroupId?(group?.templateId?'template:'+group.templateId:group?'group:'+group.id:''):'';
    select.value=[...select.options].some(option=>option.value===preferred)?preferred:'';
  }
  api('/api/adaptation',{action:'templates'}).then(result=>{templates=result.templates;websiteOptions();}).catch(error=>notice(error.message));
  async function selectWebsite(input){
    const result=await api('/api/adaptation',{action:'select',...input});
    const config=getConfig();config.adaptationGroups=result.groups;config.selectedAdaptationGroupId=result.selected;
    config.browser ||= {};config.browser.url=result.url;config.platform=result.platform;selected=result.selected;
    onWebsiteChanged?.();
    render();$('adaptAdvancedSettings').open=false;
    if(result.navigationError){$('adaptStatus').textContent=result.navigationError;notice(result.navigationError);}
    else $('adaptStatus').textContent+=' 网站网址已同步。';
  }
  $('adaptWebsite').onchange=()=>action(async()=>{
    const value=$('adaptWebsite').value;
    if(value.startsWith('group:')){await selectWebsite({id:value.slice(6)});return;}
    if(!value.startsWith('template:'))return;
    const id=value.slice(9),existing=groups().find(g=>g.templateId===id);
    if(existing){await selectWebsite({id:existing.id});return;}
    const template=templates.find(t=>t.id===id);
    if(!template.url){$('adaptTemplateSelect').replaceChildren(...templates.map(t=>Object.assign(document.createElement('option'),{value:t.id,textContent:t.name})));$('adaptTemplateSelect').value=id;templatePreview();$('adaptTemplateDialog').showModal();return;}
    await selectWebsite({templateId:id,url:template.url});
  });
  $('adaptAddCustom').onclick=()=>{$('adaptNew').click();$('adaptAdvancedSettings').open=true;$('adaptCustomSteps').open=true;$('adaptName').focus();};
  function templatePreview(){const template=templates.find(t=>t.id===$('adaptTemplateSelect').value);$('adaptTemplateStatus').textContent=template?.status || '';$('adaptTemplateUrl').value=template?.url || '';}
  $('adaptTemplate').onclick=()=>action(async()=>{templates=(await api('/api/adaptation',{action:'templates'})).templates;$('adaptTemplateSelect').replaceChildren(...templates.map(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.name;return o;}));templatePreview();$('adaptTemplateDialog').showModal();});
  $('adaptTemplateSelect').onchange=templatePreview;$('adaptTemplateCancel').onclick=()=>$('adaptTemplateDialog').close();
  $('adaptTemplateAdd').onclick=()=>action(async()=>{await selectWebsite({templateId:$('adaptTemplateSelect').value,url:$('adaptTemplateUrl').value});$('adaptTemplateDialog').close();});
  function groups(){return getConfig()?.adaptationGroups || [];}
  function current(){return groups().find(g=>g.id===selected);}
  function render() {
    const list=groups();if(!list.some(g=>g.id===selected))selected=list.find(g=>g.id===getConfig()?.selectedAdaptationGroupId)?.id || list.find(g=>g.url===getConfig()?.browser?.url)?.id || list[0]?.id;
    $('adaptGroup').replaceChildren(...list.map(g=>{const option=document.createElement('option');option.value=g.id;option.textContent=g.name;return option;}));$('adaptGroup').value=selected || '';
    websiteOptions();
    recorded=false;showRecording({candidates:[],message:'尚未录制提交接口；先检查页面并完成测试填分。'});
    const group=current();$('adaptDelete').hidden=!group || !!group.templateId;$('adaptDelete').textContent='删除自定义网站';$('adaptName').value=group?.name || '';$('adaptUrl').value=group?.url || '';
    $('websiteAddress').textContent=group?.url || '';$('websiteAddress').title=group?.url || '';
    for(const input of document.querySelectorAll('[data-platform]')){const key=input.dataset.platform;const value=key==='browser.url'?group?.url:group?.platform?.[key];input.value=key==='successValue'?JSON.stringify(value??true):value || '';}
    $('verified').checked=!!group?.platform?.verified;
    $('adaptStatus').textContent=group?.platform?.verified?'此方案已核验；修改规则后需要重新验证。':group?.templateId==='zhixue'?'智学网内置方案已调通，自动识别当前答卷和提交回执；无需按任务重复调试。':group?.templateId?'使用内置网站适配，自动提交尚需实测；可展开自行调试。':'自定义方案：可检查页面、点选修正和测试填分。';
  }
  $('adaptUrl').oninput=()=>{const input=document.querySelector('[data-platform="browser.url"]');if(input)input.value=$('adaptUrl').value;};
  document.querySelector('[data-platform="browser.url"]')?.addEventListener('input',event=>{$('adaptUrl').value=event.target.value;});
  function read(){const old=current();const platform={...(old?.platform || {})};for(const input of document.querySelectorAll('[data-platform]')){const key=input.dataset.platform;if(key!=='browser.url')platform[key]=key==='successValue'?JSON.parse(input.value):input.value;}return {id:selected || crypto.randomUUID(),name:$('adaptName').value.trim()||'新分组',url:$('adaptUrl').value.trim(),...(old?.templateId?{templateId:old.templateId}:{}),platform};}
  async function save(){const group=read();try{if(!['http:','https:'].includes(new URL(group.url).protocol))throw Error();}catch{throw Error('请先填写完整的阅卷网址，例如 https://网站域名/阅卷路径');}const result=await api('/api/adaptation',{action:'save',group});getConfig().adaptationGroups=result.groups;getConfig().platform=result.groups.find(g=>g.id===group.id).platform;getConfig().browser.url=group.url;getConfig().selectedAdaptationGroupId=group.id;selected=group.id;render();return group;}
  const run=fn=>action(async()=>{try{await fn();}catch(error){$('adaptStatus').textContent=error.message;throw error;}});
  $('adaptGroup').onchange=()=>action(()=>selectWebsite({id:$('adaptGroup').value}));
  $('adaptNew').onclick=()=>{selected=crypto.randomUUID();getConfig().adaptationGroups.push({id:selected,name:'新网址分组',url:'https://',platform:{verified:false}});render();$('adaptAdvancedSettings').open=true;markDirty('grading');};
  $('adaptDelete').onclick=()=>{
    const group=current();if(!group || group.templateId)return;
    const id=group.id;
    $('deleteWebsiteMessage').textContent=`删除“${group.name}”？仅删除网站适配配置，阅卷方案和历史保留。`;
    deleteDialog.showModal();
    deleteDialog.addEventListener('close',()=>{if(deleteDialog.returnValue!=='delete')return;run(async()=>{
      const result=await api('/api/adaptation',{action:'delete',id});
      getConfig().adaptationGroups=result.groups;selected=null;render();
      $('adaptAdvancedSettings').open=false;notice('自定义网站已删除',true);
    });},{once:true});
  };
  $('adaptSave').onclick=()=>run(async()=>{await save();notice('网址分组已保存',true);});
  $('adaptInspect').onclick=()=>run(async()=>{await save();inspection=await api('/api/adaptation',{action:'inspect',id:selected});$('adaptReport').textContent=JSON.stringify(inspection,null,2);const s=inspection.snapshot;const plausible=inspection.frames.filter(f=>f.inputs.length&&f.images.length);if(s.error&&plausible.length===1){const f=plausible[0];for(const [key,list]of [['imageSelector',f.images],['scoreSelector',f.inputs],['submitSelector',f.buttons]]){const values=[...new Set(list.map(i=>i.selector).filter(Boolean))];if(values.length===1){const field=[...document.querySelectorAll('[data-platform]')].find(i=>i.dataset.platform===key);if(field&&!field.value)field.value=values[0];}}markDirty('presets');}$('adaptStatus').textContent=s.error?'识别未完成：'+s.error+'。已列出候选元素，检查高级规则或使用点选修正后重试。':`找到${s.images.length}张图片、${s.units.length}个评分框；${s.strongIdentity?'答卷ID已识别':'答卷ID待设置'}。`;
    $('adaptScores').value=s.units?.map(()=>0).join(',') || '';
  });
  for(const button of document.querySelectorAll('[data-adapt-pick]'))button.onclick=()=>run(async()=>{await save();await api('/api/adaptation',{action:'pick',id:selected,key:button.dataset.adaptPick});notice('请切到阅卷网页点选对应元素',true);});
  $('adaptFill').onclick=()=>run(async()=>{await save();const scores=$('adaptScores').value.split(/[,，]/).map(v=>v.trim()===''?NaN:Number(v));const result=await api('/api/adaptation',{action:'fill',id:selected,scores});$('adaptStatus').textContent=result.message;notice(result.message,true);});
  $('adaptRecord').onclick=()=>run(async()=>{await save();const result=await api('/api/adaptation',{action:'record',id:selected});recorded=true;showRecording(result);$('adaptStatus').textContent=result.message;notice(result.message,true);});
  function showRecording(result){
    const candidates=result.candidates||[];
    $('adaptCandidate').replaceChildren(...(candidates.length?candidates.map(c=>Object.assign(document.createElement('option'),{value:String(c.index),textContent:`${c.status} · ${c.url}`})):[Object.assign(document.createElement('option'),{value:'',textContent:'暂无提交接口，请完成测试填分并录制手动提交'})]));
    $('adaptCandidate').disabled=!candidates.length;$('adaptVerify').disabled=!candidates.length;
    $('adaptNetwork').textContent=candidates.length?JSON.stringify(candidates,null,2):result.message || '尚未开始录制。';
    if(!$('adaptReport').textContent)$('adaptReport').textContent='尚未检查页面，点击“1. 检查页面”后显示识别报告。';
  }
  $('adaptRefresh').onclick=()=>run(async()=>{const result=await api('/api/adaptation',{action:'status',id:selected});showRecording(result);$('adaptStatus').textContent=result.message;});
  $('adaptVerify').onclick=()=>run(async()=>{const result=await api('/api/adaptation',{action:'verify',id:selected,index:Number($('adaptCandidate').value)});const index=groups().findIndex(g=>g.id===selected);getConfig().adaptationGroups[index]=result.group;getConfig().platform=result.group.platform;render();notice(result.message,true);});
  return {render,poll(state){if(recorded&&state.adaptationDebug)showRecording(state.adaptationDebug);const picked=state.adaptationPick;if(!picked||picked.token===lastPick)return;lastPick=picked.token;if(picked.cancelled){$('adaptStatus').textContent='点选已取消';return;}const input=[...document.querySelectorAll('[data-platform]')].find(i=>i.dataset.platform===picked.key);if(input)input.value=picked.selector;$('adaptStatus').textContent=`已选取：${picked.selector}。保存分组后检查匹配数量。`;markDirty('presets');}};
}

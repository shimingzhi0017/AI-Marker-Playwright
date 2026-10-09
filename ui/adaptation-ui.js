export function buildAdaptationUI() {
  const fields=document.getElementById('platformFields'), details=fields.closest('details'), card=details.closest('.card');
  const advanced=document.createElement('details');advanced.innerHTML='<summary>高级规则：选择器与提交字段</summary>';
  const heading=document.createElement('h2');heading.textContent='页面适配与调试';card.prepend(heading);
  const root=document.createElement('div');root.id='adaptationWizard';root.innerHTML=`
  <p class="hint">按网址分组保存适配规则。先识别和点选，再测试填分，最后记录一次手动提交完成验证。</p>
  <div class="controls"><label>网址分组<select id="adaptGroup"></select></label><button id="adaptNew">新建分组</button><button id="adaptDelete">删除分组</button></div>
  <div class="form-grid"><label>分组名称<input id="adaptName"></label><label>匹配网址<input id="adaptUrl" placeholder="https://网站/阅卷路径"></label></div>
  <p class="hint">相同域名按路径及#路由前缀匹配，优先使用更具体的分组。考试参数不参与匹配。</p>
  <div class="actions"><button id="adaptSave" class="primary">保存分组</button><button id="adaptInspect">1. 检查页面</button></div>
  <div class="adapt-status" id="adaptStatus">尚未检查页面</div>
  <h3>2. 点选修正</h3><div class="actions">
  <button data-adapt-pick="imageSelector">选答卷图片</button><button data-adapt-pick="scoreSelector">选评分框</button><button data-adapt-pick="submitSelector">选提交按钮</button><button data-adapt-pick="paperIdSelector">选答卷编号</button><button data-adapt-pick="taskIdSelector">选题号</button><button data-adapt-pick="completionSelector">选完成提示</button></div>
  <p class="hint">点选后切到阅卷网页点击对应位置。程序只选取元素，不触发网页按钮。相同评分框可在高级规则中扩大选择范围。</p>
  <h3>3. 填分测试</h3><label>测试分数（多个评分框用逗号分隔）<input id="adaptScores" placeholder="例如：2 或 2,3"></label><div class="actions"><button id="adaptFill">只填测试分数</button></div>
  <h3>4. 提交验证</h3><p class="hint">确认网页中答卷和测试分数正确，再开始记录并自行点击网站提交。换卷后核验实际提交接口。</p>
  <div class="actions"><button id="adaptRecord">开始记录手动提交</button><button id="adaptRefresh">刷新录制结果</button></div>
  <label>选择提交接口<select id="adaptCandidate"></select></label>
  <details><summary>查看接口记录（常见凭据已遮盖）</summary><pre id="adaptNetwork"></pre></details>
  <div class="actions"><button id="adaptVerify">核验提交并启用此分组</button></div>
  <details><summary>页面识别报告</summary><pre id="adaptReport"></pre></details>`;
  card.append(root);advanced.append(fields,document.getElementById('verified').closest('label'));card.append(advanced);
  document.getElementById('verified').disabled=true;
  document.getElementById('savePlatform').hidden=true;advanced.append(document.getElementById('savePlatform'));details.remove();
}
export function createAdaptationUI({getConfig,api,action,notice,refresh,markDirty}) {
  const $=id=>document.getElementById(id);let selected,lastPick,inspection;
  function groups(){return getConfig().adaptationGroups || [];}
  function current(){return groups().find(g=>g.id===selected);}
  function render() {
    const list=groups();if(!list.some(g=>g.id===selected))selected=list[0]?.id;
    $('adaptGroup').replaceChildren(...list.map(g=>{const option=document.createElement('option');option.value=g.id;option.textContent=g.name;return option;}));$('adaptGroup').value=selected || '';
    const group=current();$('adaptName').value=group?.name || '';$('adaptUrl').value=group?.url || '';
    for(const input of document.querySelectorAll('[data-platform]')){const key=input.dataset.platform;const value=key==='browser.url'?group?.url:group?.platform?.[key];input.value=key==='successValue'?JSON.stringify(value??true):value || '';}
    $('verified').checked=!!group?.platform?.verified;
    $('adaptStatus').textContent=group?.platform?.verified?'此分组已核验；修改规则后需要重新验证。':'未完成提交验证：可检查页面和只填分。';
  }
  function read(){const old=current();const platform={...(old?.platform || {})};for(const input of document.querySelectorAll('[data-platform]')){const key=input.dataset.platform;if(key!=='browser.url')platform[key]=key==='successValue'?JSON.parse(input.value):input.value;}return {id:selected || crypto.randomUUID(),name:$('adaptName').value.trim()||'新分组',url:$('adaptUrl').value.trim(),platform};}
  async function save(){const group=read();const result=await api('/api/adaptation',{action:'save',group});getConfig().adaptationGroups=result.groups;getConfig().platform=result.groups.find(g=>g.id===group.id).platform;selected=group.id;refresh();render();return group;}
  const run=fn=>action(async()=>{await fn();});
  $('adaptGroup').onchange=()=>{selected=$('adaptGroup').value;render();};
  $('adaptNew').onclick=()=>{selected=crypto.randomUUID();getConfig().adaptationGroups.push({id:selected,name:'新网址分组',url:'https://',platform:{verified:false}});render();markDirty('presets');};
  $('adaptDelete').onclick=()=>run(async()=>{if(!current()||!confirm('删除这个网址分组？阅卷历史保留。'))return;const result=await api('/api/adaptation',{action:'delete',id:selected});getConfig().adaptationGroups=result.groups;selected=null;refresh();render();notice('网址分组已删除',true);});
  $('adaptSave').onclick=()=>run(async()=>{await save();notice('网址分组已保存',true);});
  $('adaptInspect').onclick=()=>run(async()=>{await save();inspection=await api('/api/adaptation',{action:'inspect',id:selected});$('adaptReport').textContent=JSON.stringify(inspection,null,2);const s=inspection.snapshot;const plausible=inspection.frames.filter(f=>f.inputs.length&&f.images.length);if(s.error&&plausible.length===1){const f=plausible[0];for(const [key,list]of [['imageSelector',f.images],['scoreSelector',f.inputs],['submitSelector',f.buttons]]){const values=[...new Set(list.map(i=>i.selector).filter(Boolean))];if(values.length===1){const field=[...document.querySelectorAll('[data-platform]')].find(i=>i.dataset.platform===key);if(field&&!field.value)field.value=values[0];}}markDirty('presets');}$('adaptStatus').textContent=s.error?'识别未完成：'+s.error+'。已列出候选元素，检查高级规则或使用点选修正后重试。':`找到${s.images.length}张图片、${s.units.length}个评分框；${s.strongIdentity?'答卷ID已识别':'答卷ID待设置'}。`;
    $('adaptScores').value=s.units?.map(()=>0).join(',') || '';
  });
  for(const button of document.querySelectorAll('[data-adapt-pick]'))button.onclick=()=>run(async()=>{await save();await api('/api/adaptation',{action:'pick',id:selected,key:button.dataset.adaptPick});notice('请切到阅卷网页点选对应元素',true);});
  $('adaptFill').onclick=()=>run(async()=>{await save();const scores=$('adaptScores').value.split(/[,，]/).map(v=>v.trim()===''?NaN:Number(v));const result=await api('/api/adaptation',{action:'fill',id:selected,scores});$('adaptStatus').textContent=result.message;notice(result.message,true);});
  $('adaptRecord').onclick=()=>run(async()=>{const result=await api('/api/adaptation',{action:'record',id:selected});$('adaptStatus').textContent=result.message;notice(result.message,true);});
  $('adaptRefresh').onclick=()=>run(async()=>{const result=await api('/api/adaptation',{action:'status',id:selected});$('adaptStatus').textContent=result.message;$('adaptCandidate').replaceChildren(...(result.candidates||[]).map(c=>{const o=document.createElement('option');o.value=c.index;o.textContent=`${c.status} · ${c.url}`;return o;}));$('adaptNetwork').textContent=JSON.stringify(result.candidates||[],null,2);});
  $('adaptVerify').onclick=()=>run(async()=>{const result=await api('/api/adaptation',{action:'verify',id:selected,index:Number($('adaptCandidate').value)});const index=groups().findIndex(g=>g.id===selected);getConfig().adaptationGroups[index]=result.group;getConfig().platform=result.group.platform;render();notice(result.message,true);});
  return {render,poll(state){const picked=state.adaptationPick;if(!picked||picked.token===lastPick)return;lastPick=picked.token;if(picked.cancelled){$('adaptStatus').textContent='点选已取消';return;}const input=[...document.querySelectorAll('[data-platform]')].find(i=>i.dataset.platform===picked.key);if(input)input.value=picked.selector;$('adaptStatus').textContent=`已选取：${picked.selector}。保存分组后检查匹配数量。`;markDirty('presets');}};
}

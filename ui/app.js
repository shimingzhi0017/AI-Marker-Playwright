import {renderFeedback} from './feedback.js';
import {providerTemplates} from './provider-templates.js';
import {buildAdaptationUI,createAdaptationUI} from './adaptation-ui.js';
import {createHistoryUI} from './history.js';
import {renderResultDetails} from './result-details.js';
import {buildLayout,createEnhancements} from './enhancements.js';
buildLayout();buildAdaptationUI();
const $ = id => document.getElementById(id);
let config, state, selectedRecord, displayedRecord, currentTab = 'grading', busy = false;
let historyPage = 1;
let workspace = 'default', workspaces = [], switching = false, pendingWorkspace = null, pendingTab = null;
let attentionInitialized = false, seenAttention = new Set(), alertAudio;
const dirty=new Set();
let checkingPage=false, pageCheckError='';
function markDirty(section){dirty.add(section);$('dirtyBadge').hidden=false;if(section==='grading')updateRuntimeControls();}
document.querySelectorAll('#presets,#models,#workflows,#providerDialog,.runtime-settings').forEach(section=>section.addEventListener('input',e=>{if(!['presetSelect','providerSelect','workflowSelect','importFile'].includes(e.target.id))markDirty(section.id==='providerDialog'?'models':section.id||'grading');}));
window.addEventListener('beforeunload',e=>{if(dirty.size){e.preventDefault();e.returnValue='';}});
const scoped = (url, id = workspace) => id === 'default' ? url : url + (url.includes('?') ? '&' : '?') + 'workspace=' + encodeURIComponent(id);
const labels = { grading: '开始阅卷', presets: '阅卷方案', models: '模型接口', workflows: '评分设置', history: '历史记录' };
const states = { loading:'获取图片', grading:'模型评分', review:'待确认', filled:'已填分', submitted:'已提交', paused:'已暂停', uncertain:'待核对', submitting:'提交中', 'resolved-not-submitted':'已确认未提交' };
let noticeTimer;
function notice(message, success = false) {
  clearTimeout(noticeTimer);
  const element = $('notice');
  element.textContent = message;
  element.className = success ? 'success' : '';
  element.hidden = false;
  // 提示需要留给用户阅读，但不能永久遮挡工作台；导出路径提示继续保留到手动关闭。
  if (!message.includes('文件保存在')) {
    noticeTimer = setTimeout(() => { element.hidden = true; }, success ? 2500 : 8000);
  }
}
async function api(url, data, id = workspace) { const response = await fetch(url === '/api/workspaces' ? url : scoped(url,id), data === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) }); const value = await response.json(); if (!response.ok) throw Error(value.error || '请求失败'); return value; }
async function action(fn) { if (busy) return; busy = true; try { await fn(); } catch (e) { notice(e.message); } finally { busy = false; if(pendingWorkspace!==null){const next=pendingWorkspace;pendingWorkspace=null;if(next!==workspace || currentTab==='models'){await action(()=>switchWorkspace(next));return;}} if(pendingTab!==null){const next=pendingTab;pendingTab=null;await action(()=>showTab(next));return;} await poll(); } }
function options(element, values, selected) { const target=values.includes(selected)?selected:values.includes(element.value)?element.value:values[0];if(element.options.length===values.length && [...element.options].map(o=>o.value).join('\u0000')===values.join('\u0000')){if(element.value!==target&&document.activeElement!==element)element.value=target;return;} element.replaceChildren(...values.map(value => { const option = document.createElement('option'); option.value = value; option.textContent = value; return option; })); if(target!==undefined)element.value=target; }
function textField(value) { return typeof value === 'string' ? value : value?.text || ''; }
function updateField(value, text) { return value && typeof value === 'object' ? {...value,text} : text; }
function renderSettings() {
  options($('presetSelect'), Object.keys(config.presets), config.active); options($('providerSelect'), Object.keys(config.providers)); options($('workflowSelect'), Object.keys(config.workflows), config.presets[config.active]?.workflowId);
  $('mode').value = config.mode || 'trial'; $('batch').value = config.batchLimit || ''; $('batchEnabled').checked=(config.batchLimit || 0)>0; $('alertPopup').checked=config.notifications?.popup !== false; $('alertSound').checked=config.notifications?.sound !== false; $('alertVolume').value=String(config.notifications?.volume ?? 0.6); updateBatchLimit();updateRuntimeControls(); options($('runPreset'),Object.keys(config.presets),config.active);
  renderPreset(); renderProvider(); renderWorkflow();
  $('platformFields').replaceChildren();
  const fields = { 'browser.url':'阅卷网址',frameUrlPattern:'阅卷 Frame 地址匹配',paperIdSelector:'稳定答卷 ID 选择器',taskIdSelector:'任务 ID 选择器',completionSelector:'完成提示选择器',imageSelector:'答卷图片选择器',scoreSelector:'评分框选择器',submitSelector:'提交按钮选择器',submitResponseUrlPattern:'提交响应 URL 匹配',identityRequestField:'提交请求答卷ID字段（通用平台）',scoresRequestField:'提交请求分数字段（通用平台）',identityMode:'答卷标识模式（智学网填写zhixue-network）',successField:'业务成功字段',successValue:'业务成功值（JSON）' };
  for (const [key,labelText] of Object.entries(fields)) { const label = document.createElement('label'); label.textContent = labelText; const input = document.createElement('input'); input.dataset.platform = key; const value = key === 'browser.url' ? config.browser?.url : config.platform?.[key]; input.value = key === 'successValue' ? JSON.stringify(value ?? true) : value || ''; label.append(input); $('platformFields').append(label); }
  $('verified').checked = !!config.platform?.verified;adaptationUI.render();
}
function renderPreset() { const p = config.presets[$('presetSelect').value]; for (const name of ['question','answer','rubric']) $(name).value = textField(p[name]); options($('presetWorkflow'),Object.keys(config.workflows),p.workflowId);$('workflowSelect').value=p.workflowId; $('maxScore').value = p.scoring?.maxScore || 0; $('roundStep').value = p.scoring?.roundStep || 1; $('roundMethod').value = p.scoring?.roundMethod || 'round'; renderUnits(p.scoring?.units || []);enhancements.preset();document.dispatchEvent(new Event('preset-preview-refresh')); }
function renderUnits(units) { $('unitRows').replaceChildren(); for (const unit of units) addUnit(unit); }
function addUnit(unit = {label:'',maxScore:1}) { const row = document.createElement('div'); row.className = 'unit-row'; for (const [key,title] of [['label','分项名称'],['maxScore','分项满分'],['roundStep','步长']]) { const label = document.createElement('label'); label.textContent = title; const input = document.createElement('input'); input.dataset.unit = key; input.value = unit[key] ?? (key==='roundStep'?1:''); if (key !== 'label') { input.type = 'number'; input.min = '0.5'; input.step = '0.5'; } label.append(input); row.append(label); } const remove = document.createElement('button'); remove.textContent = '删除'; remove.onclick = () => {row.remove();markDirty('presets');}; row.append(remove); $('unitRows').append(row); }
function renderProvider() { const p = config.providers[$('providerSelect').value] || {}; for (const key of ['protocol','endpoint','apiKey','apiKeyEnv','modelsEndpoint']) $(key).value = p[key] || (key === 'protocol' ? 'chat' : ''); $('modelCatalog').textContent = (p.models || []).length ? `已获取 ${p.models.length} 个模型：${p.models.slice(0,8).join('、')}` : '尚未获取模型目录';enhancements.provider(); }
function renderWorkflow() {
  const w=config.workflows[$('workflowSelect').value] || {};
  for(const [prefix,entry]of [['primary',w.model],['secondary',w.dualEval?.secondary],['arbitration',w.dualEval?.arbitration]]){
    const names=Object.keys(config.providers),valid=!!config.providers[entry?.provider],select=$(prefix+'Provider');
    const unset=!entry?.provider;
    options(select,valid || unset && names.length ? names : ['',...names],valid?entry.provider:unset?names[0]:'');
    const placeholder=[...select.options].find(option=>option.value==='');
    if(placeholder){placeholder.textContent=names.length?'请选择 AI 接口':'请先添加 AI 接口';placeholder.disabled=true;}
    select.disabled=!names.length;
    $(prefix+'Model').value=valid?entry.model || '':'';
    $(prefix+'Model').disabled=!valid;$(prefix+'ChooseModel').disabled=!valid;
    renderCatalog(prefix);
  }
  $('dual').checked=!!w.dualEval?.enabled;$('questionType').value=w.dualEval?.questionType || 'subjective';$('threshold').value=w.dualEval?.threshold ?? 2;enhancements.workflow();
}
function renderCatalog(prefix) { const valid=!!config.providers[$(prefix+'Provider').value];$(prefix+'Model').disabled=!valid;$(prefix+'ChooseModel').disabled=!valid;options($(prefix+'Models'),config.providers[$(prefix+'Provider').value]?.models || []); }
async function save(message, section=currentTab) { config.taskScopedConfig=true; if(section==='models') await api('/api/providers',{providers:config.providers});else await api('/api/settings',config);dirty.delete(section);$('dirtyBadge').hidden=!dirty.size;updateRuntimeControls();notice(message,true); }
async function newName(title, group, create) { $('nameTitle').textContent = title; $('newName').value = ''; $('nameDialog').showModal(); const outcome = await new Promise(resolve => $('nameDialog').addEventListener('close',()=>resolve($('nameDialog').returnValue),{once:true})); if(outcome !== 'ok') return; const name = $('newName').value.trim(); if(!name || ['__proto__','constructor','prototype'].includes(name) || Object.hasOwn(config[group],name)) throw Error('名称不能为空或重复'); config[group][name] = create(); await save('已创建',group==='providers'?'models':group==='workflows'?'workflows':currentTab); renderSettings(); const select = {presets:'presetSelect',providers:'providerSelect',workflows:'workflowSelect'}[group]; $(select).value = name; ({presets:renderPreset,providers:renderProvider,workflows:renderWorkflow}[group])(); }
function renderImages(target, record) { target.replaceChildren(); if (!record?.imageFiles?.length) { const el = document.createElement('div'); el.className='empty'; el.textContent='暂无存档图片'; target.append(el); return; } record.imageFiles.forEach((_,index) => { const img=document.createElement('img'); img.src=scoped(`/api/image?id=${encodeURIComponent(record.id)}&index=${index}`); img.alt=`答卷图片 ${index+1}`; target.append(img); }); }
const historyUI = createHistoryUI({$: id => $(id), api, states, getPage: () => historyPage, setPage: value => { historyPage = value; }, setSelectedRecord: value => { selectedRecord = value; }, renderImages});
const {renderHistory, showRecord} = historyUI;
function playAttentionSound() {
  if ($('alertSound')?.checked === false) return;
  try {
    alertAudio ||= new (window.AudioContext || window.webkitAudioContext)();
    const now=alertAudio.currentTime, gain=alertAudio.createGain(), oscillator=alertAudio.createOscillator();
    gain.gain.setValueAtTime(0.0001,now);gain.gain.exponentialRampToValueAtTime(Math.max(0.02,Number($('alertVolume')?.value||0.6)*0.12),now+0.02);gain.gain.exponentialRampToValueAtTime(0.0001,now+0.55);
    oscillator.frequency.setValueAtTime(880,now);oscillator.frequency.setValueAtTime(660,now+0.18);oscillator.connect(gain);gain.connect(alertAudio.destination);oscillator.start(now);oscillator.stop(now+0.6);
  } catch {}
}
function handleAttention(events=[]) {
  const attention=events.filter(event=>event.level==='attention');
  if(!attentionInitialized){attention.forEach(event=>seenAttention.add(`${event.time}:${event.message}`));attentionInitialized=true;return;}
  const next=attention.find(event=>!seenAttention.has(`${event.time}:${event.message}`));
  attention.forEach(event=>seenAttention.add(`${event.time}:${event.message}`));
  if(!next)return;
  playAttentionSound();
  if($('alertPopup')?.checked !== false) notice(`需要处理\n${next.message}`);
}
function renderState() {
  handleAttention(state.events);
  $('phase').textContent=state.phase; $('reason').textContent=state.reason || ''; $('count').textContent=`本次已提交 ${state.count} 份`;
  const p=config.presets[config.taskScopedConfig?config.active:config.bindings?.[state.snapshot?.taskId]||config.active],w=config.workflows[p?.workflowId];
  const diagnosisError=pageCheckError||state.diagnosisError||'';
  const completed=state.phase==='阅卷完成';
  const pageReady=!!(state.browserOpen&&state.snapshot&&!diagnosisError&&!completed&&state.snapshot.images.length&&state.snapshot.units.length&&($('mode').value==='trial'||state.snapshot.strongIdentity));
  const modelReady=entry=>{const provider=config.providers[entry?.provider];return !!(entry?.model&&provider?.endpoint&&(provider.apiKey||provider.apiKeyEnv));};
  const unattendedReady=$('mode').value!=='unattended' || (w?.dualEval?.enabled && modelReady(w?.dualEval?.secondary) && modelReady(w?.dualEval?.arbitration));
  const ready=[['阅卷方案',!!(textField(p?.answer).trim()&&textField(p?.rubric).trim()&&(p?.scoring?.units?.length?p.scoring.units.every(u=>u.maxScore>0):p?.scoring?.maxScore>0)),'presets'],['评分设置',modelReady(w?.model)&&(!w.dualEval?.enabled || [w.dualEval.secondary,w.dualEval.arbitration].every(modelReady))&&unattendedReady,'workflows']];
  $('readiness').replaceChildren(...ready.map(([name,ok,tab],index)=>{const b=document.createElement('button');b.className=ok?'ready-step complete':'ready-step';b.setAttribute('aria-label',`${name}${ok?'已就绪':'待设置'}，点击打开${name}`);b.innerHTML=`<span class="ready-step-number">${index+1}</span><span>${name}</span><span class="ready-step-state">${ok?'已就绪':'待设置'}</span>`;b.onclick=()=>document.querySelector(`[data-tab="${tab}"]`).click();return b;}));
  $('runtimeSummary').textContent=`${config.active} · ${{trial:'人工确认',normal:'5秒确认',unattended:'无人值守'}[config.mode||'trial']}`;
  const snapshot=state.browserOpen&&!diagnosisError&&!completed?state.snapshot:null;
  $('browserStatus').textContent=state.browserOpen?'浏览器已连接':'未连接';$('browserStatus').classList.toggle('connected',!!state.browserOpen);
  $('browserGuide').textContent=state.browserOpen?'在浏览器中进入具体阅卷页面，然后检查识别结果。':'打开浏览器，登录网站并进入阅卷页面。';
  $('checkTitle').textContent=checkingPage?'正在检查页面…':diagnosisError?'页面检查失败':completed?'本题阅卷已结束':snapshot?'页面已识别':'等待页面检查';
  document.querySelector('.page-check-result').dataset.status=diagnosisError?'error':snapshot?'success':'pending';
  $('checkMetrics').hidden=!snapshot;$('checkImages').textContent=snapshot?.images.length??'—';$('checkUnits').textContent=snapshot?.units.length??'—';$('checkIdentity').textContent=snapshot?.strongIdentity?'已识别':'待适配';
  $('checkError').hidden=!diagnosisError;$('checkError').textContent=diagnosisError;
  $('diagnosis').hidden=!!diagnosisError;
  $('diagnosis').textContent=completed?'切换题目后，重新检查阅卷页面。':snapshot?(snapshot.strongIdentity?'图片、评分框和答卷 ID 已识别。':$('mode').value==='trial'?'答卷 ID 待适配，可先人工确认评分并只填分。':'自动提交需要稳定答卷 ID，请完善页面适配。'):state.browserOpen?'进入阅卷页面后，点击“检查页面”。':'连接浏览器后即可检查答卷图片和评分框。';
  $('launchStatus').textContent=state.running?'正在阅卷，可随时暂停。':state.phase==='阅卷完成'?'本题阅卷已结束。':!ready.every(([,ok])=>ok)?`请先完成${ready.filter(([,ok])=>!ok).map(([name])=>name).join('、')}。`:!state.browserOpen?'下一步：打开阅卷浏览器。':!pageReady?'下一步：检查阅卷页面并完成识别。':'准备就绪，可以开始阅卷。';
  $('start').disabled=state.running || state.starting || checkingPage || !pageReady || !ready.every(([,ok])=>ok); $('pause').disabled=!(state.running || state.starting); $('diagnose').disabled=state.running || state.starting || checkingPage || !state.browserOpen; $('open').disabled=state.running || state.starting;
  $('diagnose').textContent=checkingPage?'检查中…':'检查页面';updateRuntimeControls();
  for(const id of ['saveMode','savePreset','saveProvider','saveWorkflow','savePlatform','fetchModels','addPreset','addProvider','addProviderTemplate','addWorkflow','bind','deletePreset','deleteProvider','deleteWorkflow','copyPreset','detectUnits','clearBlank','addModelId']) $(id).disabled=state.running||state.starting;
  $('importFile').disabled=state.running||state.starting;
  $('deleteWorkspace').disabled=state.running||state.starting;
  $('deleteWorkspace').title=state.running||state.starting?'请先暂停此任务':'从任务列表移除，资料归档保留';
  for(const field of ['question','answer','rubric'])$(field+'Upload').disabled=state.running||state.starting;
  $('countdown').hidden=state.countdown === null; $('countdown').textContent=`${state.countdown} 秒后提交`;
  const r=state.record;
  if(r?.state==='grading' && r.modelProgress){const seconds=Math.max(0,Math.floor((Date.now()-new Date(r.time).getTime())/1000));$('reason').textContent=(state.reason || '等待模型评分')+` · 已等待${seconds}秒`; }
  $('reason').hidden=!state.reason||state.reason===diagnosisError||['待开始','页面已识别'].includes(state.phase);
  if(!r && !$('answerImages').children.length)$('answerImages').innerHTML='<div class="empty">开始阅卷后，这里显示当前答卷图片</div>';
  if(!r && displayedRecord) { displayedRecord=null; $('answerImages').replaceChildren(); $('resultEmpty').hidden=false; $('resultPanel').hidden=true; $('presetLabel').textContent=''; }
  if(r && displayedRecord !== `${r.id}:${!!r.result}:${r.imageFiles?.length}`) {
    displayedRecord=`${r.id}:${!!r.result}:${r.imageFiles?.length}`; renderImages($('answerImages'),r); $('presetLabel').textContent=r.presetName; $('resultEmpty').hidden=!!r.result; $('resultPanel').hidden=!r.result;
    if(r.result) { $('scores').replaceChildren(); const values=r.result.subScores?.length ? r.result.subScores : [{label:'总分',score:r.result.score}]; for(const [i,s] of values.entries()) { const label=document.createElement('label'); label.textContent=s.label; const input=document.createElement('input'); input.type='number'; input.step=p?.scoring?.units?.[i]?.roundStep||p?.scoring?.roundStep||0.5; input.min=0;input.max=p?.scoring?.units?.[i]?.maxScore||p?.scoring?.maxScore||''; input.value=s.score; input.dataset.score='true'; label.append(input); $('scores').append(label); } $('ocr').textContent=r.result.studentAnswer || '无识别文本'; $('comment').value=r.result.comment || '';renderFeedback($('commentPreview'),r.result.comment || '无评语'); $('correction').value=''; $('rawResult').textContent=JSON.stringify(r.result,null,2);renderResultDetails($('resultDetails'),r);$('dualSummary').hidden=!r.result.dualEval;$('dualSummary').textContent=r.result.dualEval?`双评：${{consensus:'一致',average:'阈值内平均',arbitration:'仲裁'}[r.result.dualEval.result]} · 主评 ${r.result.dualEval.a.score} / 复评 ${r.result.dualEval.b.score}`:''; }
  }
  const builtinSubmit=r?.snapshot?.builtinAdapter==='zhixue'&&r?.snapshot?.networkTopic?.apiOrigin;
  const canSubmit=!!((builtinSubmit || config?.platform?.verified || (config?.platform?.manualSubmissionTest && config.mode === 'trial' && Number.isInteger(config.batchLimit) && config.batchLimit >= 0 && r?.snapshot?.networkTopic)) && r?.snapshot?.strongIdentity && (builtinSubmit || config?.platform?.submitResponseUrlPattern));
  for(const id of ['fill','stopReview']) $(id).disabled=!state.review;
  const manualWebsiteFill=r?.snapshot?.submissionOnFill || r?.snapshot?.units?.some(u=>u.type==='click');
  if(manualWebsiteFill){$('fill').disabled=true;$('fill').title='此网站给分可能直接提交，请在网站人工确认';}
  $('submit').disabled=!state.review || !canSubmit;
  $('submitHint').textContent=canSubmit ? (config.platform.manualSubmissionTest && !config.platform.verified ? `人工确认提交测试：每份人工确认并核验服务器回执，${config.batchLimit ? `达到本次设定的${config.batchLimit}份后自动停止。` : `本次未设置份数上限，可随时暂停。`}` : '确认提交后会等待平台响应，再处理下一份。') : '提交适配尚未实测：可只填分，再在阅卷网站手动提交。';
  for(const input of document.querySelectorAll('[data-score]')) input.disabled=!state.review;
  $('comment').disabled=!state.review;$('correction').disabled=!state.review;updateScoreTotal();
  $('events').replaceChildren(...state.events.slice(0,20).map(e=>{const li=document.createElement('li'),time=document.createElement('time'),message=document.createElement('span');time.textContent=new Date(e.time).toLocaleTimeString();message.textContent=e.message;li.append(time,message);return li;}));
}
function requestWorkspace(id) {
  if(id===workspace && currentTab!=='models'){pendingWorkspace=null;return;}
  if(busy){pendingWorkspace=id;notice('当前操作完成后将自动切换到所选任务');renderWorkspaceCards();return;}
  action(()=>switchWorkspace(id));
}
function renderWorkspaceCards() {
  const target=$('workspaceCards'),ids=workspaces.map(w=>w.id);
  for(const card of [...target.children])if(!ids.includes(card.dataset.workspace))card.remove();
  for(const w of workspaces) {
    let card=[...target.children].find(el=>el.dataset.workspace===w.id);
    if(!card){card=document.createElement('button');card.type='button';card.dataset.workspace=w.id;card.className='workspace-card';
      for(const cls of ['workspace-card-name','workspace-card-status','workspace-card-count']){const text=document.createElement('span');text.className=cls;card.append(text);}
      card.onclick=()=>requestWorkspace(w.id);target.append(card);}
    const selected=w.id===workspace;card.classList.toggle('active',selected);card.classList.toggle('running',!!w.running);card.classList.toggle('review',!!w.review);card.classList.toggle('pending',w.id===pendingWorkspace);card.setAttribute('aria-pressed',String(selected));
    const values=[w.name,w.id===pendingWorkspace?'等待切换':w.review?'待人工确认':w.phase || '待开始',`已提交 ${w.count || 0} 份`];
    [...card.children].forEach((el,i)=>{if(el.textContent!==values[i])el.textContent=values[i];});
  }
}
async function refreshWorkspaces() { const requestedWorkspace=workspace;const values=await api('/api/workspaces');if(requestedWorkspace!==workspace || switching)return;workspaces=values;renderWorkspaceCards();if(pendingWorkspace!==null || document.activeElement===$('workspaceSelect')){$('workspaceStatus').textContent=`${values.filter(w=>w.running).length} 个任务正在运行 / 共 ${values.length} 个`;return;}if([...$('workspaceSelect').options].map(o=>o.value).join()!==values.map(w=>w.id).join())options($('workspaceSelect'),values.map(w=>w.id),workspace);if($('workspaceSelect').value!==workspace)$('workspaceSelect').value=workspace;for(const option of $('workspaceSelect').options){const w=values.find(w=>w.id===option.value);const label=`${w.name} · ${w.phase}${w.review?' · 待确认':''} · ${w.count}份`;if(option.textContent!==label)option.textContent=label;} $('workspaceStatus').textContent=`${values.filter(w=>w.running).length} 个任务正在运行 / 共 ${values.length} 个`; }
function showTaskPage() {
  if(currentTab!=='models')return;
  currentTab='grading';document.querySelector('.task-tabs').hidden=false;
  document.querySelectorAll('.tab').forEach(el=>el.hidden=el.id!==currentTab);
  document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===currentTab));
  $('title').textContent=labels[currentTab];$('eyebrow').textContent=`工作台 / ${labels[currentTab]}`;
}
async function switchWorkspace(id) {
  if(id===workspace){showTaskPage();return;}
  const taskDirty=[...dirty].some(section=>section!=='models');
  if(taskDirty&&!confirm('当前任务有未保存修改，切换将放弃这些任务修改。是否继续？')){$('workspaceSelect').value=workspace;return;}
  const providerDraft=dirty.has('models') ? {
    providers:structuredClone(config.providers),selected:$('providerSelect').value,
    fields:Object.fromEntries(['protocol','endpoint','apiKey','apiKeyEnv','modelsEndpoint'].map(key=>[key,$(key).value]))
  } : null;
  for(const section of [...dirty])if(section!=='models')dirty.delete(section);
  $('dirtyBadge').hidden=!dirty.size;switching=true;workspace=id;pageCheckError='';showTaskPage();
  displayedRecord=null;selectedRecord=null;$('historyDetail').hidden=true;$('historyDialog').close();
  $('resultPanel').hidden=true;$('resultEmpty').hidden=false;$('answerImages').replaceChildren();$('notice').hidden=true;
  try {
    config=await api('/api/settings');
    if(providerDraft)config.providers=providerDraft.providers;
    renderSettings();
    if(providerDraft){$('providerSelect').value=providerDraft.selected;renderProvider();for(const [key,value]of Object.entries(providerDraft.fields))$(key).value=value;}
    document.querySelectorAll('a[href*="/api/export"]').forEach(a=>a.href=scoped('/api/export?format='+new URL(a.href).searchParams.get('format')));
    if(currentTab==='history')await renderHistory();
  } finally {switching=false;}
  await poll();
}
async function poll() { if(switching)return;const id=workspace;try { const next=await api('/api/state');if(id!==workspace || switching)return;state=next;renderState();adaptationUI.poll(state);await refreshWorkspaces(); } catch(e) { $('phase').textContent='连接已断开'; notice('控制台连接已断开，请重新启动可视化程序。'); } }
$('addProviderTemplate').onclick=()=>{if(!busy)$('providerTemplateDialog').showModal();};
$('closeProviderTemplate').onclick=()=>$('providerTemplateDialog').close();
document.querySelectorAll('[data-provider-template]').forEach(button=>button.onclick=()=>action(async()=>{
  const base=button.dataset.providerTemplate;let name=base,index=2;while(Object.hasOwn(config.providers,name))name=base+' '+index++;
  config.providers[name]=structuredClone(providerTemplates[base]);await save('AI接口模板已添加，请填写密钥','models');
  $('providerTemplateDialog').close();renderSettings();$('providerSelect').value=name;renderProvider();$('editProvider').click();
}));
async function showTab(tab){currentTab=tab;document.querySelector('.task-tabs').hidden=currentTab==='models';document.querySelectorAll('.tab').forEach(el=>el.hidden=el.id!==currentTab);document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===currentTab));$('title').textContent=labels[currentTab];$('eyebrow').textContent=`工作台 / ${labels[currentTab]}`;if(currentTab==='history')await renderHistory();}
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{if(busy){pendingTab=button.dataset.tab;return;}action(()=>showTab(button.dataset.tab));});
const handlers={
  open:async()=>{await api('/api/open',{});pageCheckError='';},
  diagnose:async()=>{checkingPage=true;pageCheckError='';renderState();try{await api('/api/diagnose',{});}catch(error){pageCheckError=error.message;}finally{checkingPage=false;}},
  start:async()=>{if([...dirty].some(section=>section!=='grading'))throw Error('有未保存的配置，请先保存对应页面再开始阅卷');await saveRuntime(false);return api('/api/start',{});},pause:()=>api('/api/pause',{}),
  saveMode:()=>saveRuntime(true),
  bind:async()=>{if(!state.snapshot?.taskId)throw Error('请先检查阅卷页面');config.bindings ||= {};config.bindings[state.snapshot.taskId]=$('presetSelect').value;await save('当前页面已绑定方案');},
  savePreset:async()=>{const name=$('presetSelect').value,p=config.presets[name];const rubricChanged=textField(p.rubric)!==$('rubric').value;const maximumChanged=Number(p.scoring?.maxScore)!==Number($('maxScore').value);if(rubricChanged||maximumChanged)delete p.scoring?.items;for(const key of ['question','answer','rubric']) p[key]=updateField(p[key],$(key).value);p.workflowId=$('presetWorkflow').value;p.scoring={...p.scoring,maxScore:Number($('maxScore').value),roundStep:Number($('roundStep').value),roundMethod:$('roundMethod').value,units:[...document.querySelectorAll('.unit-row')].map(row=>({label:row.querySelector('[data-unit=label]').value.trim(),maxScore:Number(row.querySelector('[data-unit=maxScore]').value),roundStep:Number(row.querySelector('[data-unit=roundStep]').value)}))};enhancements.applyPreset(p);config.active=name;await save('当前任务方案已保存','presets');},
  saveProvider:async()=>{const p=config.providers[$('providerSelect').value];for(const key of ['protocol','endpoint','apiKey','apiKeyEnv','modelsEndpoint'])p[key]=$(key).value.trim();await save('供应商已保存','models');enhancements.provider();$('providerDialog').hidden=true;$('editProvider').setAttribute('aria-expanded','false');},
  saveWorkflow:async()=>{const w=config.workflows[$('workflowSelect').value],entry=prefix=>({provider:$(prefix+'Provider').value,model:$(prefix+'Model').value.trim()});w.model=entry('primary');w.dualEval={...w.dualEval,enabled:$('dual').checked,questionType:$('questionType').value,threshold:Number($('threshold').value),secondary:entry('secondary'),arbitration:entry('arbitration')};enhancements.applyWorkflow(w);await save('工作流已保存','workflows');},
  fetchModels:async()=>{await handlers.saveProvider();await api('/api/models',{name:$('providerSelect').value});const selected=$('providerSelect').value;config=await api('/api/settings');$('providerSelect').value=selected;renderProvider();for(const p of ['primary','secondary','arbitration'])renderCatalog(p);notice('模型目录已更新',true);},
  savePlatform:async()=>{config.platform ||= {};config.browser ||= {};for(const input of document.querySelectorAll('[data-platform]')){const key=input.dataset.platform;if(key==='browser.url')config.browser.url=input.value;else config.platform[key]=key==='successValue'?JSON.parse(input.value):input.value;}config.platform.verified=$('verified').checked;await save('页面适配已保存','presets');},
  addUnit:()=>{addUnit();markDirty('presets');}, addPreset:()=>newName('新建方案','presets',()=>({question:'',answer:'',rubric:'',workflowId:Object.keys(config.workflows)[0],scoring:{maxScore:0,units:[],roundStep:1,roundMethod:'round'}})),addProvider:()=>newName('新建供应商','providers',()=>({protocol:'chat',endpoint:'',apiKey:'',models:[]})),addWorkflow:()=>newName('新建工作流','workflows',()=>({model:{provider:Object.keys(config.providers)[0],model:''},dualEval:{enabled:false}})),
  refreshHistory:()=>{historyPage=1;return renderHistory();},
  exportConfig:()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='阅卷配置.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},
  blank:async()=>{
    if(!selectedRecord || !confirm('请先确认这份答卷确实为空白。将把图片特征作为空白检测范本，检测结果仍须人工确认。'))return;
    const button=$('blank'),label=button.textContent;button.disabled=true;button.textContent='正在分析答卷图片…';
    try {
      await api('/api/blank',{id:selectedRecord.id});
      config=await api('/api/settings');enhancements.preset();
      const count=config.presets[selectedRecord.presetName]?.blankDetection?.reference?.length || 0;
      button.textContent='已保存 '+count+' 页空白范本';
      notice(`空白范本已保存（${count}页），可在“阅卷方案 → 加分与空白检测”查看。`,true);
    } finally {button.disabled=false;if(!button.textContent.startsWith('已保存 '))button.textContent=label;}
  }
};
for(const [id,fn] of Object.entries(handlers)) $(id).onclick=()=>action(fn);
for(const [id,decision] of [['fill','fill'],['submit','submit'],['stopReview','stop']]) $(id).onclick=()=>action(async()=>{const scores=[...document.querySelectorAll('[data-score]')].map(input=>input.value.trim()===''?NaN:Number(input.value));if(decision!=='stop'&&scores.some(s=>!Number.isFinite(s)))throw Error('请填写有效分数，不能留空');await api('/api/review',{decision,...(decision!=='stop'?{scores,comment:$('comment').value}:{}),recordId:state.record?.id,reason:$('correction').value});});
for(const [id,outcome] of [['resolveYes','submitted'],['resolveNo','not-submitted']]) $(id).onclick=()=>action(async()=>{if(!confirm('请确认已在阅卷网站核对这份记录的实际提交状态。'))return;await api('/api/resolve',{id:selectedRecord.id,outcome});await renderHistory();$('historyDetail').hidden=true;});
$('presetSelect').onchange=()=>{if(dirty.has('presets')&&!confirm('放弃当前方案未保存修改？')){$('presetSelect').value=config.active;return;}dirty.delete('presets');$('dirtyBadge').hidden=!dirty.size;renderPreset();};$('providerSelect').onchange=renderProvider;$('workflowSelect').onchange=renderWorkflow;
for(const prefix of ['primary','secondary','arbitration']) $(prefix+'Provider').onchange=()=>renderCatalog(prefix);
let choosingModelPrefix;
function showModelChoices(){
  const prefix=choosingModelPrefix;if(!prefix)return;
  const provider=$(prefix+'Provider').value,models=config.providers[provider]?.models||[],query=$('workflowModelSearch').value.trim().toLowerCase();
  const matching=models.filter(model=>model.toLowerCase().includes(query));
  $('workflowModelTitle').textContent='选择模型 · '+provider;
  $('workflowModelHint').textContent=!models.length?'此供应商尚无模型目录。请在模型接口中获取目录，也可以关闭窗口后手动填写模型名称。':matching.length?`共 ${models.length} 个模型，显示 ${matching.length} 个`:'没有匹配的模型，请修改搜索词。';
  $('workflowModelChoices').replaceChildren(...matching.map(model=>{
    const button=document.createElement('button');button.type='button';button.textContent=model;button.setAttribute('aria-pressed',String($(prefix+'Model').value===model));
    button.onclick=()=>{$(prefix+'Model').value=model;markDirty('workflows');$('workflowModelDialog').close();$(prefix+'Model').focus();};return button;
  }));
}
for(const prefix of ['primary','secondary','arbitration']) $(prefix+'ChooseModel').onclick=()=>{choosingModelPrefix=prefix;$('workflowModelSearch').value='';showModelChoices();$('workflowModelDialog').showModal();};
$('workflowModelSearch').oninput=showModelChoices;
$('closeWorkflowModels').onclick=()=>$('workflowModelDialog').close();

$('importFile').onchange=()=>action(async()=>{const file=$('importFile').files[0];if(!file)return;if(!confirm('导入将替换当前配置，是否继续？'))return;await api('/api/import',JSON.parse(await file.text()));config=await api('/api/settings');renderSettings();notice('导入成功，请核对方案及模型后开始',true);$('importFile').value='';});
$('workspaceSelect').onchange=()=>requestWorkspace($('workspaceSelect').value);
$('addWorkspace').onclick=()=>action(async()=>{const result=await api('/api/workspaces',{});await refreshWorkspaces();await switchWorkspace(result.id);const name=await workspaceDialog();if(name!==null){if(!name)throw Error('任务名称不能为空');await api('/api/workspace-name',{name});config.workspaceName=name;await refreshWorkspaces();}notice('新任务已创建，已使用默认配置。请在自己的浏览器登录并选择阅卷页面。',true);});
$('pauseAll').onclick=()=>action(async()=>{await refreshWorkspaces();await Promise.all(workspaces.map(w=>api('/api/pause',{},w.id)));notice('已请求暂停全部任务',true);});
const enhancements=createEnhancements({getConfig:()=>config,save,action,markDirty,renderPreset,renderUnits,renderProvider,renderWorkflow,getSnapshot:()=>state.snapshot,api,refreshSettings:renderSettings,notice});
$('historySearch').oninput=()=>action(()=>{historyPage=1;return renderHistory();});$('historyFilter').onchange=()=>action(()=>{historyPage=1;return renderHistory();});$('arbitrationFilter').onchange=()=>action(()=>{historyPage=1;return renderHistory();});$('historyPageSize').onchange=()=>action(()=>{historyPage=1;return renderHistory();});$('historyPrev').onclick=()=>action(()=>{historyPage=Math.max(1,historyPage-1);return renderHistory();});$('historyNext').onclick=()=>action(()=>{historyPage++;return renderHistory();});
async function workspaceDialog(deleting=false) {
  const current=workspaces.find(w=>w.id===workspace),dialog=$('workspaceDialog');
  $('workspaceDialogTitle').textContent=deleting?'删除任务':'重命名任务';
  $('workspaceDialogHint').textContent=deleting?`将“${current?.name}”从列表移除，并关闭它的阅卷浏览器。配置、登录目录和历史会归档保留。${workspaces.length===1?'删除最后一个任务后会创建空白新任务。':''}`:'修改名称后，任务列表会立即更新。';
  $('workspaceNameLabel').hidden=deleting;$('workspaceNameInput').required=!deleting;$('workspaceNameInput').value=current?.name||'';
  $('workspaceDialogSave').textContent=deleting?'删除任务':'保存';dialog.returnValue='';dialog.showModal();if(!deleting){$('workspaceNameInput').focus();$('workspaceNameInput').select();}
  return await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='ok'?$('workspaceNameInput').value.trim():null),{once:true}));
}
$('renameWorkspace').onclick=()=>action(async()=>{const name=await workspaceDialog();if(name===null)return;if(!name)throw Error('任务名称不能为空');await api('/api/workspace-name',{name});config.workspaceName=name;await refreshWorkspaces();notice('任务已重命名',true);});
$('deleteWorkspace').onclick=()=>action(async()=>{if(await workspaceDialog(true)===null)return;const deleted=await api('/api/workspaces',{action:'delete',id:workspace});dirty.clear();await switchWorkspace(deleted.nextId);await refreshWorkspaces();notice('任务已删除，原资料已归档保留',true);});
function updateScoreTotal(){const inputs=[...document.querySelectorAll('[data-score]')];$('scoreTotal').textContent=inputs.length?inputs.reduce((sum,i)=>sum+(Number(i.value)||0),0)+' 分':'—';}
document.querySelector('#unitRows').addEventListener('input',()=>{$('unitTotal').textContent='分项总分 '+[...document.querySelectorAll('[data-unit=maxScore]')].reduce((sum,i)=>sum+(Number(i.value)||0),0)+' 分';});
document.querySelector('#resultPanel').addEventListener('input',e=>{updateScoreTotal();if(state.review&&state.countdown!==null)action(()=>api('/api/hold',{recordId:state.record.id}));});
const adaptationUI=createAdaptationUI({getConfig:()=>config,api,action,notice,refresh:renderSettings,markDirty,onWebsiteChanged:()=>{pageCheckError='';}});
try {const initialTasks=await api('/api/workspaces');workspace=initialTasks[0]?.id || 'default';config=await api('/api/settings');renderSettings();await poll();setInterval(poll,700);}catch(e){notice(e.message);}

for(const link of document.querySelectorAll('a[href*="/api/export"]')) link.onclick=event=>{event.preventDefault();action(async()=>{const format=new URL(link.href).searchParams.get('format');const result=await api('/api/export-file',{format,chooseDirectory:true,openFolder:true});if(result.cancelled)return;notice(`已导出任务“${result.taskName}”的 ${result.count} 条记录。文件保存在：${result.path}${result.folderOpened?'。已请求打开所在文件夹。':''}${result.folderError?'（文件夹未能自动打开）':''}`,true);});};

// Switch layouts only after selecting a task; changing layout on pointerdown can close the native menu.

async function saveRuntime(showNotice){
  const batchLimit=$('batchEnabled').checked?Number($('batch').value):0;
  if($('batchEnabled').checked&&(batchLimit<1 || !Number.isInteger(batchLimit)))throw Error('阅卷份数须为正整数');
  const notifications={sound:$('alertSound')?.checked !== false,popup:$('alertPopup')?.checked !== false,volume:Math.min(1,Math.max(0,Number($('alertVolume')?.value||0.6)))};
  if(dirty.has('grading') || config.mode!==$('mode').value || config.batchLimit!==batchLimit || JSON.stringify(config.notifications||{})!==JSON.stringify(notifications)){
    const next={...config,taskScopedConfig:true,mode:$('mode').value,active:$('runPreset').value,batchLimit,notifications};
    await api('/api/settings',next);config=next;dirty.delete('grading');$('dirtyBadge').hidden=!dirty.size;updateRuntimeControls();
  }
  if(showNotice)notice('运行设置已保存',true);
}
function updateRuntimeControls(){
  const locked=!!(state?.running||state?.starting);
  for(const radio of document.querySelectorAll('[name="runMode"]')){radio.checked=radio.value===$('mode').value;radio.disabled=locked;}
  $('batchEnabled').disabled=locked;$('mode').disabled=locked;$('batch').disabled=locked||!$('batchEnabled').checked;
  $('runtimeSaved').textContent=dirty.has('grading')?'开始时保存':'已保存';
}
function updateBatchLimit(){const enabled=$('batchEnabled').checked;$('batchField').hidden=!enabled;$('batch').disabled=!enabled;$('batch').placeholder='输入份数';$('quantitySummary').textContent=enabled?'达到设定份数后自动停止。':'不限份数，阅卷结束后自动停止。';if(!enabled)$('batch').value='';}
$('batchEnabled').addEventListener('change',updateBatchLimit);
$('mode').addEventListener('input',()=>{updateRuntimeControls();if(state)renderState();});
for(const id of ['alertPopup','alertSound','alertVolume'])$(id)?.addEventListener('input',()=>markDirty('grading'));

$('comment').addEventListener('input',()=>renderFeedback($('commentPreview'),$('comment').value));

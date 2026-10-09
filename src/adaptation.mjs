import crypto from 'node:crypto';
import { redact } from './submission-observer.mjs';
import { verifyCommit, matchesZhixueCommitUrl } from './zhixue-receipt.mjs';

export function urlScope(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('分组网址必须是http或https网页');
  return { origin: url.origin, path: url.pathname + (url.hash ? url.hash.split('?')[0] : '') };
}
export function matchingGroup(groups, value) {
  const target = urlScope(value);
  const matches = (groups || []).filter(g => {
    try { const scope = urlScope(g.url); return scope.origin === target.origin && target.path.startsWith(scope.path); } catch { return false; }
  }).sort((a,b) => urlScope(b.url).path.length - urlScope(a.url).path.length);
  if (matches.length > 1 && urlScope(matches[0].url).path.length === urlScope(matches[1].url).path.length) throw Error('多个网址分组同时匹配，请修改分组网址范围');
  return matches[0] || null;
}
export function fingerprint(options) {
  const { verified, manualSubmissionTest, acceptance, ...rules } = options;
  return crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(rules).sort()))).digest('hex');
}
export function migrateGroups(settings) {
  if (!settings.adaptationGroups) settings.adaptationGroups = [{ id: crypto.randomUUID(), name: '原有页面配置', url: new URL(settings.browser?.url || 'https://www.zhixue.com/').origin + '/', platform: structuredClone(settings.platform || {}) }];
  return settings.adaptationGroups;
}
export function applyGroup(settings, pageUrl) {
  const cfg=structuredClone(settings); const group=matchingGroup(migrateGroups(cfg),pageUrl);
  cfg.platform=group ? structuredClone(group.platform) : { verified:false };
  cfg.adaptationGroupId=group?.id || null;cfg.adaptationScope=group?.url || null;
  return cfg;
}
export function submissionReadinessError(settings, snapshot) {
  if (!settings.platform?.verified) return '当前网址匹配的页面适配尚未通过核验，请选择已验证的网址分组；同一适配无需按任务重复测试。';
  if (!settings.platform.submitResponseUrlPattern) return '已验证的页面适配缺少提交回执接口配置，请检查网址分组。';
  if (!snapshot.strongIdentity) return '页面适配已验证，但当前答卷尚未取得稳定编号。请在阅卷网站切换或刷新答卷后点击“检查页面”；无需重新做提交测试。仍未取得编号时，请使用人工确认并只填分。';
  return '';
}
export function parseBody(text) {
  try { return JSON.parse(text); } catch { return Object.fromEntries(new URLSearchParams(text || '')); }
}
function field(object, key) { return key?.split('.').reduce((o,k)=>o?.[k],object); }
function scores(value) {
  if(typeof value === 'string') {
    try { value=JSON.parse(value); } catch { if(!/^\d+(?:\.\d+)?$/.test(value)) throw Error('请求分数字段不是可核验的数字或JSON');value=Number(value); }
  }
  const values=Array.isArray(value)?value:typeof value==='object'&&value ? Object.values(value) : [value];
  if(values.some(v=>typeof v!=='number'||!Number.isFinite(v))) throw Error('请求分数字段含无效分数');
  return values;
}
export function verifyManualResponse(options, snapshot, expectedScores, candidate) {
  if(candidate.status<200 || candidate.status>=300) throw Error('服务器HTTP状态不是成功');
  if(snapshot.networkTopic) {
    if(!matchesZhixueCommitUrl(candidate.url,snapshot.networkTopic)) throw Error('不是当前智学网提交接口');
    return verifyCommit(candidate.requestBody,candidate.responseBody,snapshot.networkTopic,expectedScores);
  }
  if(!snapshot.strongIdentity || !options.identityRequestField || !options.scoresRequestField) throw Error('先设置稳定答卷ID、请求中的答卷ID字段及分数字段');
  if(String(field(candidate.requestBody,options.identityRequestField))!==String(snapshot.paperId)) throw Error('提交请求答卷ID与测试答卷不一致');
  if(JSON.stringify(scores(field(candidate.requestBody,options.scoresRequestField)))!==JSON.stringify(expectedScores)) throw Error('提交请求分数与测试分数不一致');
  if(field(candidate.responseBody,options.successField || 'success')!==(options.successValue ?? true)) throw Error('服务器业务结果未明确成功');
  return {confirmed:true,source:'manual-adaptation',scores:expectedScores,paperId:snapshot.paperId};
}

export class AdaptationDebugger {
  constructor(getPlatform) { this.getPlatform=getPlatform;this.status={phase:'idle',message:'先检查页面，再测试填分和记录手动提交。'}; }
  stop() { this.page?.off('response',this.handler);this.page=null; }
  reset() { this.stop();this.before=null;this.candidates=[];this.status={phase:'idle',message:'适配规则已变化，请重新检查和测试。'}; }
  async fill(values) {
    this.reset();const platform=this.getPlatform();const snapshot=await platform.ready();
    if(!snapshot || !snapshot.images.length) throw Error('未找到就绪答卷图片');
    if(!Array.isArray(values)||values.length!==snapshot.units.length||values.some((v,i)=>!Number.isFinite(v)||v<0||!snapshot.units[i].maxScore||v>snapshot.units[i].maxScore)) throw Error('测试分数数量或范围不正确，请先核对评分框满分');
    await platform.fill(snapshot,values);this.before=snapshot;this.values=values;this.rules=fingerprint(platform.options);
    this.status={phase:'filled',message:'测试分数已填入，请在网页核对；尚未提交。',units:snapshot.units};return this.status;
  }
  async record() {
    const platform=this.getPlatform();
    if(!this.before || this.rules!==fingerprint(platform.options)) throw Error('先使用当前规则完成填分测试');
    await platform.assertCurrent(this.before);this.stop();this.page=platform.page;this.candidates=[];
    this.status={phase:'recording',message:'现在请在阅卷网站手动点击提交；工具只记录，不替你提交。',candidates:[]};
    this.handler=response=>{
      if(response.request().method()!=='POST') return;
      const url=new URL(response.url());const site=new URL(platform.page.url());
      if(url.hostname!==site.hostname&&!(site.hostname.endsWith('zhixue.com')&&url.hostname.endsWith('.zhixue.com'))) return;
      if(/login|logout|oauth|password/i.test(url.pathname)) return;
      (async()=>{
        try {
          const text=await response.text();if(text.length>200000)return;
          const requestBody=parseBody(response.request().postData()),responseBody=JSON.parse(text);
          this.candidates.push({url:response.url(),status:response.status(),requestBody,responseBody});
          if(this.candidates.length>30)this.candidates.shift();
          this.status.candidates=this.candidates.map((c,i)=>({index:i,url: new URL(c.url).origin+new URL(c.url).pathname,status:c.status,request:redact(c.requestBody),response:redact(c.responseBody)}));
          this.status.message='已记录接口响应。提交换卷后，选择提交接口并点击“核验提交”。';
        } catch {}
      })();
    };
    this.page.on('response',this.handler);return this.status;
  }
  async verify(index) {
    const platform=this.getPlatform(),candidate=this.candidates[index];
    if(!candidate || !this.before || this.rules!==fingerprint(platform.options)) throw Error('测试记录或适配规则已变化，请重新测试');
    const receipt=verifyManualResponse(platform.options,this.before,this.values,candidate);
    const next=await platform.ready(this.before);
    if(!next?.strongIdentity || next.identity===this.before.identity || JSON.stringify(next.imageKeys)===JSON.stringify(this.before.imageKeys)) throw Error('尚未核验到下一份不同答卷，请检查稳定ID和换卷');
    this.stop();this.status={phase:'verified',message:'答卷ID、测试分数、服务器成功回执和换卷均已核验。',receipt};
    return {receipt,endpoint:'^'+(new URL(candidate.url).origin+new URL(candidate.url).pathname).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$'};
  }
}

export async function inspectPage(page) {
  const frames=[];
  for(const frame of page.frames()) {
    try {
      const info=await frame.evaluate(()=>{
        const visible=el=>!!(el.getBoundingClientRect().width&&el.getBoundingClientRect().height);
        const selector=el=>el.id ? '#'+CSS.escape(el.id) : el.getAttribute('name') ? el.tagName.toLowerCase()+'[name='+JSON.stringify(el.getAttribute('name'))+']' : null;
        return {images:[...document.querySelectorAll('img')].filter(el=>visible(el)&&el.naturalWidth>100).map(el=>({selector:selector(el),width:el.naturalWidth,height:el.naturalHeight})).slice(0,20),inputs:[...document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=checkbox])')].filter(visible).map(el=>({selector:selector(el),max:el.getAttribute('score')||el.getAttribute('max'),type:el.type})).slice(0,20),buttons:[...document.querySelectorAll('button,input[type=submit]')].filter(visible).filter(el=>/提交|保存/.test(el.textContent||el.value||'')).map(el=>({selector:selector(el),text:(el.textContent||el.value).trim().slice(0,40)})).slice(0,10)};
      });frames.push({url:frame.url(),...info});
    } catch {}
  }
  return {url:page.url(),frames};
}

export function installPicker({key,token}) {
  window.__markerPickerCancel?.();
  const banner=document.createElement('div');banner.textContent='适配点选：点击目标元素（不会触发原按钮），按Esc取消';banner.style.cssText='position:fixed;top:0;left:0;right:0;padding:12px;background:#176e52;color:white;z-index:2147483647;pointer-events:none';document.documentElement.append(banner);
  const selector=el=>{
    if(el.id && document.querySelectorAll('#'+CSS.escape(el.id)).length===1)return '#'+CSS.escape(el.id);
    if(['scoreSelector','imageSelector'].includes(key)){
      if(el.getAttribute('name'))return el.tagName.toLowerCase()+'[name='+JSON.stringify(el.getAttribute('name'))+']';
      const cls=[...el.classList].filter(c=>!/^active|hover|selected$/.test(c));if(cls.length)return el.tagName.toLowerCase()+'.'+cls.map(CSS.escape).join('.');
    }
    const parts=[];for(let node=el;node&&node!==document.documentElement;node=node.parentElement){const tag=node.tagName.toLowerCase();parts.unshift(tag+':nth-of-type('+([...node.parentElement.children].filter(c=>c.tagName===node.tagName).indexOf(node)+1)+')');}return 'html > '+parts.join(' > ');
  };
  const cancel=()=>{banner.remove();document.removeEventListener('click',click,true);document.removeEventListener('keydown',keyboard,true);};
  const click=event=>{
    event.preventDefault();event.stopImmediatePropagation();let el=event.target;
    if(key==='imageSelector')el=el.closest('img');
    if(key==='scoreSelector')el=el.closest('input');
    if(!el || key==='scoreSelector'&&['password','hidden'].includes(el.type))return;
    const picked=selector(el);cancel();window.__markerAdaptationPicked({token,key,selector:picked,url:location.href}).catch(()=>{});
  };
  const keyboard=event=>{if(event.key==='Escape'){cancel();window.__markerAdaptationPicked({token,cancelled:true}).catch(()=>{});}};
  document.addEventListener('click',click,true);document.addEventListener('keydown',keyboard,true);window.__markerPickerCancel=cancel;
}

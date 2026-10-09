import fs from 'node:fs';
const base=new URL('../vendor/adapters/',import.meta.url);
export const suiteAdapters=JSON.parse(fs.readFileSync(new URL('manifest.json',base),'utf8'));
export function patternMatches(pattern,value) {
  try {
    const url=new URL(value),match=pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/);
    if(!match || !['http:','https:'].includes(url.protocol) || url.username || url.password)return false;
    if(match[1]!=='*' && url.protocol!==match[1]+':')return false;
    const host=match[2],valid=host==='*' || host.startsWith('*.') ? host==='*' || url.hostname===host.slice(2) || url.hostname.endsWith('.'+host.slice(2)) : url.hostname===host;
    return valid && new RegExp('^'+match[3].split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(url.pathname+url.search);
  }catch{return false;}
}
export const suiteAdapterScript = `(()=>{
  if(window.__markerSuiteBridge)return;
  const candidates=[];
  const matches=${patternMatches.toString()};
  const waitForElement=(selector,timeout=8000)=>new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{const el=document.querySelector(selector);if(el)return resolve(el);if(Date.now()-start>=timeout)return reject(Error('元素未加载'));setTimeout(check,100);};check();});
  const fetchImageAsBase64=()=>Promise.reject(Error('图片下载由桌面工具处理'));
  window.aiGradingState ||= {isRegrading:false,currentImageUrls:[]};
  ${suiteAdapters.filter(a=>a.id!=='zhixue').map(a=>{
    const selectors=new URL(a.id+'/selectors.js',base);
    let source=fs.readFileSync(new URL(a.id+'/adapter.js',base),'utf8');
    source=source.replace(/\nif \(\w+Adapter\.shouldInitialize\(\)\) \{[\s\S]*$/,'');
    if(a.id==='jiukexing')source=source.split('// 注册适配器')[0];
    if(a.id==='guangda-2')source=source.split('// 注册适配器（等待DOM准备')[0].replace(/        if \(url\.includes\('firstUpdateUserInfo'\)\) \{[\s\S]*?\n        \}/,'');
    const compatibility=a.id==='c30'?`window.__C30_ADAPTER__=${a.variable};` : a.id==='huiyuejuan'?`${a.variable}._getFrameDoc=function(){const child=document.querySelector('frame[src*="17yuejuan"], frame[src*="oemimoms"]');try{if(child)return child.contentDocument || child.contentWindow?.document;}catch{}return document.querySelector('.ui-exam-teacher-correct-score-box')?document:null;};`:'';
    return `if(${JSON.stringify(a.patterns)}.some(p=>matches(p,location.href))){try{(()=>{${fs.existsSync(selectors)?fs.readFileSync(selectors,'utf8'):''}\n${source}\n${compatibility}\ncandidates.push(${a.variable});})();}catch(error){console.warn('适配器加载失败',${JSON.stringify(a.id)},error.message);}}`;
  }).join('\n')}
  window.__markerSuiteBridge={
    adapters:()=>candidates.map(a=>({id:a.id,name:a.name})),
    select(){
      const found=candidates.filter(a=>{try{return a.shouldInitialize() && (a.getScoreInputs?.() || []).length;}catch{return false;}});
      // More specific URL/DOM variants supersede the corresponding generic adapter.
      const chosen=found.filter(a=>!found.some(b=>b!==a && ((a.id==='qitian'&&b.id==='qitian-new')||(a.id==='xinkao'&&b.id==='xinkao-2')||(a.id==='yunyuejuan'&&b.id==='xinkao'))));
      if(chosen.length>1)throw Error('多个网站适配器同时匹配，请选择页面分组');
      return chosen[0] || null;
    },
    async snapshot(){
      const a=this.select();if(!a)return null;
      const inputs=a.getScoreInputs();
      let urls=await a.gatherAnswerImages();
      // C30's canvas can be tainted. The matching live API supplies its original image.
      if(a.id==='c30'&&!urls?.length && a._state.latestImageUrl)urls=[a._state.latestImageUrl];
      const images=[...new Set(urls || [])].filter(u=>typeof u==='string'&&u).map(u=>({url:new URL(u,location.href).href,ready:true}));
      const units=inputs.map((s,i)=>({index:i,label:s.label || '第'+(i+1)+'题',maxScore:Number(s.maxScore || s.element?.getAttribute?.('score') || s.element?.getAttribute?.('max') || s.element?.placeholder?.match(/满分\\s*(\\d+(?:\\.\\d+)?)/)?.[1] || 0),type:s.type || (s.element?.matches?.('input,textarea')?'input':'click')}));
      return {adapterId:a.id,adapterName:a.name,taskId:String(a.getTaskIdentifier?.() || location.pathname),images,units,url:location.href,submissionOnFill:['c30','keewing','guangda-2'].includes(a.id),regrade:!!a.isRegradeMode?.()};
    },
    readScores(){const a=this.select();return (a?.getScoreInputs() || []).map(s=>s.element?.value ?? null);},
    fill(scores){
      const a=this.select();if(!a)throw Error('未识别到适配器');
      const inputs=a.getScoreInputs();if(inputs.length!==scores.length)throw Error('评分框数量变化');
      if(['c30','keewing','guangda-2'].includes(a.id)||inputs.some(s=>s.type==='click'||!s.element?.matches?.('input,textarea')))throw Error('此网站通过给分按钮或输入自动提交，当前请在网站人工填分确认');
      if([...document.querySelectorAll('input[type=checkbox]')].some(el=>el.checked&&/自动提交/.test(el.closest('label')?.textContent || el.parentElement?.textContent || '')))throw Error('请先关闭阅卷网站的自动提交，再使用只填分');
      if(!a.fillScores(scores))throw Error('原网站适配器未完成填分');
      return this.readScores();
    },
    submit(){const a=this.select();if(!a)throw Error('未识别到适配器');return a.submitGrade();}
  };
})();`;
export async function installSuiteAdapters(context) {
  await context.addInitScript({content:suiteAdapterScript});
}

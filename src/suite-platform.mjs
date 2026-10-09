import {ZhixuePlatform,stableImageKey} from './platform.mjs';
import {verifyManualResponse} from './adaptation.mjs';
import {suiteAdapterScript} from './suite-adapters.mjs';

export class SuitePlatform extends ZhixuePlatform {
  async frame() {
    if(this.options.imageSelector || this.options.scoreSelector || this.options.submitSelector)return super.frame();
    const found=[];
    for(const frame of this.page.frames()) {
      if(this.options.frameUrlPattern && !new RegExp(this.options.frameUrlPattern).test(frame.url()))continue;
      try {
        if(!await frame.evaluate(()=>!!window.__markerSuiteBridge))await frame.evaluate(suiteAdapterScript);
        const adapter=await frame.evaluate(()=>window.__markerSuiteBridge?.select()?.id);
        if(adapter)found.push(frame);
      }catch(error){if(/多个网站/.test(error.message))throw error;}
    }
    if(found.length>1)throw Error('多个阅卷区域匹配，请指定页面分组');
    return found[0] || super.frame();
  }
  async snapshot() {
    const frame=await this.frame();
    if(this.options.imageSelector || this.options.scoreSelector || this.options.submitSelector)return super.snapshot();
    const data=await frame.evaluate(()=>window.__markerSuiteBridge?.snapshot());
    if(!data)return super.snapshot();
    if(data.regrade)throw Error('当前处于网站回评或复核模式，请人工确认');
    const imageKeys=data.images.map(i=>stableImageKey(i.url));
    let paperId='';
    if(this.options.paperIdSelector)paperId=await frame.locator(this.options.paperIdSelector).evaluate(el=>el.getAttribute('data-paper-id')||el.value||el.textContent?.trim()||'');
    // Upstream task identifiers often identify the question, not the student's paper.
    const strongIdentity=!!paperId;
    return {...data,paperId,imageKeys,strongIdentity,identitySource:strongIdentity?'configured-page-element':'adapter-image-resource',identity:`${data.adapterId}:${data.taskId}:${paperId || imageKeys.join('|')}`};
  }
  async fill(snapshot,scores) {
    if(!snapshot.adapterId)return super.fill(snapshot,scores);
    await this.assertCurrent(snapshot);
    const frame=await this.frame();const values=await frame.evaluate(scores=>window.__markerSuiteBridge.fill(scores),scores);
    if(values.length!==scores.length || values.some((v,i)=>v===null || String(v).trim()==='' || Number(v)!==scores[i]))throw Error('网站分数读回验证失败');
    await this.assertCurrent(snapshot);
  }
  async submit(snapshot,scores) {
    if(!snapshot.adapterId)return super.submit(snapshot,scores);
    if(!this.options.verified || !snapshot.strongIdentity || !this.options.submitResponseUrlPattern || !this.options.identityRequestField || !this.options.scoresRequestField)throw Error('此网站提交回执尚未核验，请先使用页面适配调试');
    await this.assertCurrent(snapshot);const frame=await this.frame();
    const values=await frame.evaluate(()=>window.__markerSuiteBridge.readScores());
    if(values.some((v,i)=>v===null || String(v).trim()==='' || Number(v)!==scores[i]))throw Error('提交前分数已变化');
    const pending=this.page.waitForResponse(r=>r.request().method()==='POST'&&new RegExp(this.options.submitResponseUrlPattern).test(r.url()),{timeout:this.options.submitTimeoutMs || 10000});
    try {
      if(!await frame.evaluate(()=>window.__markerSuiteBridge.submit()))throw Error('网站提交按钮未找到');
      const response=await pending,raw=response.request().postData() || '';let requestBody;
      try{requestBody=JSON.parse(raw);}catch{requestBody=Object.fromEntries(new URLSearchParams(raw));}
      return {status:response.status(),...verifyManualResponse(this.options,snapshot,scores,{url:response.url(),status:response.status(),requestBody,responseBody:await response.json()})};
    }catch(error){await pending.catch(()=>{});throw Error('提交状态不明，需人工核对：'+error.message);}
  }
}

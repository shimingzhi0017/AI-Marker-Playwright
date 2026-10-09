import fs from 'node:fs';
import {suiteAdapters,patternMatches} from './suite-adapters.mjs';

export const adaptationTemplates=suiteAdapters.map(adapter=>{
  const source=fs.readFileSync(new URL('../vendor/adapters/'+adapter.id+'/adapter.js',import.meta.url),'utf8');
  const name=source.match(/name:\s*['"]([^'"]+)/)?.[1] || adapter.id;
  const pattern=adapter.patterns[0];
  const url=pattern.includes('://*/')?'':pattern.replace(/^\*:/,'https:').replace('*.','').replace(/\*$/,'');
  return {id:adapter.id,name,patterns:adapter.patterns,url,status:adapter.id==='zhixue'?'已调通：答卷识别、填分、回执与结束处理':'内置适配：图片和评分控件，自动提交需实测'};
});
export function templateMatches(id,url){return adaptationTemplates.find(t=>t.id===id)?.patterns.some(p=>patternMatches(p,url)) || false;}
export function createTemplateGroup(id,url,groupId){
  const template=adaptationTemplates.find(t=>t.id===id);if(!template)throw Error('网站方案不存在');
  const target=url?.trim() || template.url;
  if(!target || !templateMatches(id,target))throw Error('请填写符合该网站方案的实际阅卷网址');
  return {id:groupId,name:template.name,url:target,templateId:id,platform:{verified:false}};
}

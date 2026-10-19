import { setTimeout as delay } from 'node:timers/promises';

export const DEFAULT_REQUEST_TIMEOUT_MS = 240000;

async function retryDelay(ms, signal) {
  try { await delay(ms, undefined, { signal }); } catch (error) { signal?.throwIfAborted(); throw error; }
}

export function endpoint(provider) {
  const url = provider.endpoint.trim().replace(/\/+$/, '');
  if (provider.protocol === 'gemini') return url.replace(/\/models(?:\/[^/]+:generateContent)?$/, '');
  const tail = provider.protocol === 'responses' ? 'responses' : 'chat/completions';
  if (/\/(chat\/completions|responses)$/.test(url)) return url.replace(/\/(chat\/completions|responses)$/, '/'+tail);
  return `${url}${new URL(url).pathname.replace(/\/$/,'') ? '' : '/v1'}/${tail}`;
}
export function modelListEndpoint(provider) {
  if(provider.modelsEndpoint?.trim())return provider.modelsEndpoint.trim();
  const url=endpoint(provider);
  return provider.protocol==='gemini' ? url+'/models' : url.replace(/\/(chat\/completions|responses)$/, '/models');
}
export async function listModels(provider,signal) {
  const key=provider.apiKey || process.env[provider.apiKeyEnv || ''];
  if(!key)throw Error('请先保存接口密钥');
  const address=new URL(modelListEndpoint(provider)),found=[],seenPages=new Set();
  const combined=AbortSignal.any([signal || new AbortController().signal,AbortSignal.timeout(30000)]);
  for(let page=0;page<20;page++){
    const response=await fetch(address,{headers:provider.protocol==='gemini'?{'x-goog-api-key':key}:{Authorization:`Bearer ${key}`},signal:combined});
    if(!response.ok)throw Error(`模型目录请求失败（${response.status}）`);
    let value;try{value=await response.json();}catch{throw Error('模型目录接口返回的不是JSON');}
    if(value.error)throw Error(value.error.message || '模型目录服务返回错误');
    const rows=provider.protocol==='gemini'?value.models:Array.isArray(value)?value:value.data;
    if(!Array.isArray(rows))throw Error('模型目录响应格式无法识别，已保留原目录；可手动添加模型');
    found.push(...rows.map(m=>typeof m==='string'?m:provider.protocol==='gemini'?m.name?.replace(/^models\//,''):m.id).filter(id=>typeof id==='string'&&id.trim()).map(id=>id.trim()));
    if(provider.protocol!=='gemini'||!value.nextPageToken)return [...new Set(found)];
    if(seenPages.has(value.nextPageToken))throw Error('模型目录分页重复，已保留原目录');
    seenPages.add(value.nextPageToken);address.searchParams.set('pageToken',value.nextPageToken);
  }
  throw Error('模型目录分页过多，已保留原目录');
}
function imageData(value) {
  if (value.startsWith('data:')) return value;
  return `data:image/png;base64,${value}`;
}
export function extractResponse(json, protocol) {
  if (json.error) throw Error(json.error.message || '模型服务返回错误');
  if (protocol === 'gemini') {
    const candidate = json.candidates?.[0];
    if(candidate?.finishReason==='MAX_TOKENS'){const error=Error('Gemini响应截断，结果不完整');error.code='OUTPUT_TRUNCATED';throw error;}
    if (candidate?.finishReason !== 'STOP') throw Error('Gemini结果未正常结束');
    return candidate.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('') || '';
  }
  if (protocol === 'responses') {
    if(json.incomplete_details?.reason==='max_output_tokens'){const error=Error('Responses响应截断，结果不完整');error.code='OUTPUT_TRUNCATED';throw error;}
    if (json.status !== 'completed' || json.incomplete_details) throw Error('Responses结果未完整结束');
    return json.output_text || (json.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
  }
  const choice = json.choices?.[0];
  if (choice?.finish_reason === 'length') {const error=Error('模型响应截断，结果不完整');error.code='OUTPUT_TRUNCATED';throw error;}
  if (choice?.finish_reason !== 'stop') throw Error('模型响应截断或未正常结束');
  const content = choice.message?.content;
  return typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => c.text || '').join('') : '';
}
export async function requestModel(provider, model, prompt, images, signal, budget = { remaining: 3 }) {
  const protocol = provider.protocol || 'chat';
  const apiKey = provider.apiKey || process.env[provider.apiKeyEnv || ''];
  if (!apiKey) throw Error('供应商接口密钥未配置');
  const urls = images.map(imageData);
  let url = endpoint(provider), body;
  const headers = { 'Content-Type': 'application/json' };
  if (protocol === 'gemini') {
    url = `${url}/models/${encodeURIComponent(model)}:generateContent`;
    headers['x-goog-api-key'] = apiKey;
    body = { contents: [{ role: 'user', parts: [{ text: prompt }, ...urls.map(u => { const m = u.match(/^data:([^;]+);base64,(.+)$/s); if (!m) throw Error('图片数据无效'); return { inlineData: { mimeType: m[1], data: m[2] } }; })] }], generationConfig: { responseMimeType: 'application/json',...(provider.maxOutputTokens?{maxOutputTokens:provider.maxOutputTokens}:{}) } };
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
    body = protocol === 'responses' ? { model, stream: false, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...urls.map(u => ({ type: 'input_image', image_url: u }))] }] } :
      { model, stream: false, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...urls.map(u => ({ type: 'image_url', image_url: { url: u } }))] }] };
    if (provider.maxOutputTokens) body[protocol === 'responses' ? 'max_output_tokens' : 'max_tokens'] = provider.maxOutputTokens;
    if (provider.reasoningEffort) {
      if (protocol === 'responses') body.reasoning = { effort: provider.reasoningEffort };
      else body.reasoning_effort = provider.reasoningEffort;
    }
  }
  let upgraded=false;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    if (budget.remaining-- <= 0) throw Error('本份答卷模型请求预算用尽');
    let response, text;
    budget.onProgress?.({status:attempt ? 'retrying':'requesting',model,attempt:attempt+1});
    try {
      response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(provider.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)]) });
      text = await response.text();
    } catch (cause) {
      signal?.throwIfAborted();
      const code = cause?.cause?.code || cause?.code || '';
      const temporary = cause?.name === 'TimeoutError' || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','UND_ERR_BODY_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(code);
      if (temporary && cause?.name !== 'TimeoutError' && attempt === 0 && budget.remaining > 0) {
        await retryDelay(700, signal); continue;
      }
      const reason = cause?.name === 'TimeoutError' || /TIMEOUT|TIMEDOUT/.test(code) ? '请求超时' : /CERT|TLS|SSL/.test(code) ? '证书或安全连接失败' : code === 'ENOTFOUND' ? '接口域名无法解析' : temporary ? '网络连接中断或接口暂时不可达' : '网络请求失败';
      const error = Error(`模型${model}：${reason}${temporary && attempt > 0 ? '，重试后仍失败' : ''}；已暂停，请检查网络或接口后重新开始。`);
      error.modelRequestFailure = { model, type: reason, code, attempts: attempt + 1 }; throw error;
    }
    if (!response.ok) {
      if (attempt === 0 && (response.status === 429 || response.status >= 500) && budget.remaining > 0) {
        await retryDelay(response.status === 429 ? 1000 : 300, signal);
        continue;
      }
      throw Error(`模型服务HTTP ${response.status}`);
    }
    let json; try { json = JSON.parse(text); } catch { throw Error('模型接口返回HTML或无效JSON'); }
    let result;
    try {result=extractResponse(json,protocol);}catch(error){
      if(error.code==='OUTPUT_TRUNCATED'&&!upgraded&&provider.maxOutputTokens&&attempt<2&&budget.remaining>0){
        upgraded=true;delete body.max_tokens;delete body.max_output_tokens;
        if(body.generationConfig)delete body.generationConfig.maxOutputTokens;
        budget.onProgress?.({status:'retrying',model,message:'回答达到输出上限，正在使用接口默认额度重新评分'});
        continue;
      }
      throw error;
    }
    if (!result.trim()) throw Error('模型返回空正文');
    return result;
  }
}

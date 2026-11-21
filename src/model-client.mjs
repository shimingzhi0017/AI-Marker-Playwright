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
const finiteNonNeg = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function extractUsage(json, protocol = 'chat') {
  if (!json || typeof json !== 'object') return null;
  let inputTokens = null;
  let outputTokens = null;
  let totalTokens = null;
  let cachedTokens = null;
  let reasoningTokens = null;

  if (protocol === 'gemini') {
    const meta = json.usageMetadata;
    if (!meta || typeof meta !== 'object') return null;
    inputTokens = finiteNonNeg(meta.promptTokenCount);
    outputTokens = finiteNonNeg(meta.candidatesTokenCount);
    totalTokens = finiteNonNeg(meta.totalTokenCount);
    cachedTokens = finiteNonNeg(meta.cachedContentTokenCount);
    reasoningTokens = finiteNonNeg(meta.thoughtsTokenCount);
  } else if (protocol === 'responses') {
    const u = json.usage;
    if (!u || typeof u !== 'object') return null;
    inputTokens = finiteNonNeg(u.input_tokens);
    outputTokens = finiteNonNeg(u.output_tokens);
    totalTokens = finiteNonNeg(u.total_tokens);
    cachedTokens = finiteNonNeg(u.input_tokens_details?.cached_tokens);
    reasoningTokens = finiteNonNeg(u.output_tokens_details?.reasoning_tokens);
  } else {
    const u = json.usage;
    if (!u || typeof u !== 'object') return null;
    inputTokens = finiteNonNeg(u.prompt_tokens);
    outputTokens = finiteNonNeg(u.completion_tokens);
    totalTokens = finiteNonNeg(u.total_tokens);
    cachedTokens = finiteNonNeg(u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens);
    reasoningTokens = finiteNonNeg(u.completion_tokens_details?.reasoning_tokens);
  }

  if ([inputTokens, outputTokens, totalTokens, cachedTokens, reasoningTokens].every(v => v === null)) return null;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: totalTokens ?? (input + output),
    cachedTokens: cachedTokens ?? 0,
    reasoningTokens: reasoningTokens ?? 0
  };
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

function buildRequestBody({ protocol, model, prompt, urls, maxOutputTokens, reasoningEffort, jsonMode, mergeSystemPrompt }) {
  const isStructured = Boolean(prompt && typeof prompt === 'object');
  const rawSystem = isStructured ? String(prompt.system || '') : '';
  const rawUser = isStructured ? String(prompt.user || '') : String(prompt ?? '');
  const useMerged = !isStructured || !rawSystem || mergeSystemPrompt;
  const userText = useMerged && rawSystem ? `${rawSystem}\n\n${rawUser}` : rawUser;
  const systemText = useMerged ? '' : rawSystem;

  if (protocol === 'gemini') {
    const imageParts = urls.map(u => {
      const m = u.match(/^data:([^;]+);base64,(.+)$/s);
      if (!m) throw Error('图片数据无效');
      return { inlineData: { mimeType: m[1], data: m[2] } };
    });
    const generationConfig = {
      ...(jsonMode === false ? {} : { responseMimeType: 'application/json' }),
      ...(maxOutputTokens ? { maxOutputTokens } : {})
    };
    return {
      ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: userText }, ...imageParts] }],
      ...(Object.keys(generationConfig).length ? { generationConfig } : {})
    };
  }

  let body;
  if (protocol === 'responses') {
    body = {
      model,
      stream: false,
      ...(systemText ? { instructions: systemText } : {}),
      input: [{ role: 'user', content: [{ type: 'input_text', text: userText }, ...urls.map(u => ({ type: 'input_image', image_url: u }))] }]
    };
    if (jsonMode === true) body.text = { format: { type: 'json_object' } };
  } else {
    const messages = [];
    if (systemText) messages.push({ role: 'system', content: systemText });
    messages.push({ role: 'user', content: [{ type: 'text', text: userText }, ...urls.map(u => ({ type: 'image_url', image_url: { url: u } }))] });
    body = { model, stream: false, messages };
    if (jsonMode === true) body.response_format = { type: 'json_object' };
  }
  if (maxOutputTokens) body[protocol === 'responses' ? 'max_output_tokens' : 'max_tokens'] = maxOutputTokens;
  if (reasoningEffort) {
    if (protocol === 'responses') body.reasoning = { effort: reasoningEffort };
    else body.reasoning_effort = reasoningEffort;
  }
  return body;
}

const MAX_CAPABILITY_CACHE_SIZE = 500;
const capabilityCache = new Map();

export function resetModelCapabilityCache() {
  capabilityCache.clear();
}

function capabilityKey(provider, model) {
  return `${provider.protocol || 'chat'}\0${endpoint(provider)}\0${model}`;
}

function updateCapabilityCache(key, patch) {
  const existing = capabilityCache.get(key) || {};
  capabilityCache.delete(key);
  if (capabilityCache.size >= MAX_CAPABILITY_CACHE_SIZE) {
    capabilityCache.delete(capabilityCache.keys().next().value);
  }
  capabilityCache.set(key, { ...existing, ...patch });
}

export function parseRetryAfterMs(header) {
  if (typeof header !== 'string' || !header.trim()) return null;
  const trimmed = header.trim();
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    const ms = Math.round(Number(trimmed) * 1000);
    return Number.isFinite(ms) ? Math.min(15000, Math.max(50, ms)) : null;
  }
  const ts = Date.parse(trimmed);
  if (!Number.isFinite(ts)) return null;
  const delta = ts - Date.now();
  return Math.min(15000, Math.max(50, delta));
}

export function extractHttpErrorSummary(text) {
  if (typeof text !== 'string' || !text.trim()) return '';
  const trimmed = text.trim();
  if (/^<!doctype\s+html|^<html\b/i.test(trimmed)) return '';
  let message = '';
  try {
    const parsed = JSON.parse(trimmed);
    const candidate = parsed?.error?.message || parsed?.error?.msg || parsed?.message || parsed?.msg || parsed?.detail || (typeof parsed?.error === 'string' ? parsed.error : '');
    if (typeof candidate === 'string') message = candidate;
  } catch {
    if (!trimmed.startsWith('<')) message = trimmed;
  }
  const sanitized = message
    .replace(/\s+/gu, ' ')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, 'sk-[redacted]')
    .replace(/([?&](?:api_?key|key|token|secret)=)[^&\s"']+/giu, '$1[redacted]')
    .trim();
  if (!sanitized) return '';
  return sanitized.length > 180 ? `${sanitized.slice(0, 180)}…` : sanitized;
}

export async function requestModel(provider, model, prompt, images, signal, budget = { remaining: 3 }) {
  const protocol = provider.protocol || 'chat';
  const apiKey = provider.apiKey || process.env[provider.apiKeyEnv || ''];
  if (!apiKey) throw Error('供应商接口密钥未配置');
  const urls = images.map(imageData);
  let url = endpoint(provider);
  const headers = { 'Content-Type': 'application/json' };
  if (protocol === 'gemini') {
    url = `${url}/models/${encodeURIComponent(model)}:generateContent`;
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const hasStructuredSystem = Boolean(prompt && typeof prompt === 'object' && prompt.system);
  const capKey = provider.disableCapabilityCache ? '' : capabilityKey(provider, model);
  const cached = capKey ? capabilityCache.get(capKey) : undefined;
  let useJsonMode = cached?.jsonModeUnsupported ? false : (protocol === 'gemini' ? provider.jsonMode !== false : provider.jsonMode === true);
  let mergeSystem = !!provider.mergeSystemPrompt || !!cached?.systemUnsupported;
  let upgraded = false;
  let downgradedJson = !!cached?.jsonModeUnsupported;
  let downgradedSystem = !!cached?.systemUnsupported;
  let rateLimitRetries = 0;
  let retriedTransient = false;

  for (let attempt = 0; attempt < 8; attempt++) {
    signal?.throwIfAborted();
    if (budget.remaining-- <= 0) throw Error('本份答卷模型请求预算用尽');
    const body = buildRequestBody({
      protocol,
      model,
      prompt,
      urls,
      maxOutputTokens: upgraded ? undefined : provider.maxOutputTokens,
      reasoningEffort: provider.reasoningEffort,
      jsonMode: useJsonMode,
      mergeSystemPrompt: mergeSystem
    });
    let response, text;
    budget.onProgress?.({status:attempt ? 'retrying':'requesting',model,attempt:attempt+1});
    try {
      response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(provider.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)]) });
      text = await response.text();
    } catch (cause) {
      signal?.throwIfAborted();
      const code = cause?.cause?.code || cause?.code || '';
      const temporary = cause?.name === 'TimeoutError' || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','UND_ERR_BODY_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(code);
      if (temporary && cause?.name !== 'TimeoutError' && !retriedTransient && budget.remaining > 0) {
        retriedTransient = true;
        await retryDelay(700, signal); continue;
      }
      const reason = cause?.name === 'TimeoutError' || /TIMEOUT|TIMEDOUT/.test(code) ? '请求超时' : /CERT|TLS|SSL/.test(code) ? '证书或安全连接失败' : code === 'ENOTFOUND' ? '接口域名无法解析' : temporary ? '网络连接中断或接口暂时不可达' : '网络请求失败';
      const error = Error(`模型${model}：${reason}${temporary && attempt > 0 ? '，重试后仍失败' : ''}；已暂停，请检查网络或接口后重新开始。`);
      error.modelRequestFailure = { model, type: reason, code, attempts: attempt + 1 }; throw error;
    }
    if (!response.ok) {
      if (response.status === 429 && rateLimitRetries < 2 && budget.remaining > 0) {
        rateLimitRetries++;
        const waitMs = parseRetryAfterMs(response.headers?.get?.('retry-after')) ?? (rateLimitRetries === 1 ? 1000 : 2000);
        budget.onProgress?.({ status: 'retrying', model, message: `接口限流(429)，${waitMs}ms后重试` });
        await retryDelay(waitMs, signal);
        continue;
      }
      if (!retriedTransient && response.status >= 500 && budget.remaining > 0) {
        retriedTransient = true;
        await retryDelay(300, signal);
        continue;
      }
      if ((response.status === 400 || response.status === 422) && budget.remaining > 0) {
        const jsonRejected = useJsonMode && !downgradedJson && /response_format|json_object|text\.format|responsemimetype|structured|json mode|unsupported.*format|invalid.*format/iu.test(text);
        const systemRejected = hasStructuredSystem && !mergeSystem && !downgradedSystem && /\bsystem\b|systeminstruction|instructions|role.*not.*support|developer.*role|first message.*user/iu.test(text);
        if (jsonRejected || systemRejected) {
          if (jsonRejected) { useJsonMode = false; downgradedJson = true; }
          if (systemRejected) { mergeSystem = true; downgradedSystem = true; }
          if (capKey) {
            updateCapabilityCache(capKey, {
              ...(jsonRejected ? { jsonModeUnsupported: true } : {}),
              ...(systemRejected ? { systemUnsupported: true } : {})
            });
          }
          const reasons = [jsonRejected ? '接口不支持原生JSON格式' : '', systemRejected ? '接口不支持独立system提示' : ''].filter(Boolean).join('、');
          budget.onProgress?.({ status: 'retrying', model, message: `${reasons}，正在自动兼容降级重试` });
          continue;
        }
      }
      const summary = extractHttpErrorSummary(text);
      throw Error(summary ? `模型服务HTTP ${response.status}：${summary}` : `模型服务HTTP ${response.status}`);
    }
    let json; try { json = JSON.parse(text); } catch { throw Error('模型接口返回HTML或无效JSON'); }
    let result;
    try {result=extractResponse(json,protocol);}catch(error){
      if(error.code==='OUTPUT_TRUNCATED'&&!upgraded&&provider.maxOutputTokens&&budget.remaining>0){
        upgraded=true;
        budget.onProgress?.({status:'retrying',model,message:'回答达到输出上限，正在使用接口默认额度重新评分'});
        continue;
      }
      throw error;
    }
    if (!result.trim()) throw Error('模型返回空正文');
    const usage = extractUsage(json, protocol);
    if (usage) budget.onUsage?.(usage);
    return result;
  }
  throw Error(`模型${model}：多次重试后仍未获得有效响应`);
}

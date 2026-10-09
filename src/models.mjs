import { promptFor, parseResult, validateResult, fieldImages } from './domain.mjs';

export function endpoint(provider) {
  const url = provider.endpoint.replace(/\/$/, '');
  if (provider.protocol === 'gemini') return url;
  const tail = provider.protocol === 'responses' ? 'responses' : 'chat/completions';
  return /\/(chat\/completions|responses)$/.test(url) ? url : `${url}${url.endsWith('/v1') ? '' : '/v1'}/${tail}`;
}
function imageData(value) {
  if (value.startsWith('data:')) return value;
  return `data:image/png;base64,${value}`;
}
export function extractResponse(json, protocol) {
  if (json.error) throw Error(json.error.message || '模型服务返回错误');
  if (protocol === 'gemini') {
    const candidate = json.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw Error('Gemini结果未正常结束');
    return candidate.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('') || '';
  }
  if (protocol === 'responses') {
    if (json.status !== 'completed' || json.incomplete_details) throw Error('Responses结果未完整结束');
    return json.output_text || (json.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
  }
  const choice = json.choices?.[0];
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
    body = { contents: [{ role: 'user', parts: [{ text: prompt }, ...urls.map(u => { const m = u.match(/^data:([^;]+);base64,(.+)$/s); if (!m) throw Error('图片数据无效'); return { inlineData: { mimeType: m[1], data: m[2] } }; })] }], generationConfig: { responseMimeType: 'application/json' } };
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
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    if (budget.remaining-- <= 0) throw Error('本份答卷模型请求预算用尽');
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(provider.timeoutMs || 120000)]) });
    const text = await response.text();
    if (!response.ok) {
      if (attempt === 0 && (response.status === 429 || response.status >= 500) && budget.remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, response.status === 429 ? 1000 : 300));
        continue;
      }
      throw Error(`模型服务HTTP ${response.status}`);
    }
    let json; try { json = JSON.parse(text); } catch { throw Error('模型接口返回HTML或无效JSON'); }
    const result = extractResponse(json, protocol);
    if (!result.trim()) throw Error('模型返回空正文');
    return result;
  }
}
export async function grade(config, settings, images, signal) {
  const workflow = settings.workflows[config.workflowId];
  if (!workflow?.model) throw Error('工作流主模型未配置');
  const budget = { remaining: settings.requestBudget || 6 };
  const call = async (entry, prompt) => {
    const provider = settings.providers[entry?.provider];
    if (!provider || !entry.model) throw Error('工作流模型或供应商无效');
    const text = await requestModel({ ...provider, reasoningEffort: entry.reasoningEffort, maxOutputTokens: workflow.outputLimitEnabled === false ? undefined : workflow.maxOutputTokens || provider.maxOutputTokens }, entry.model, prompt, [...fieldImages(config), ...images], signal, budget);
    try { return { ...parseResult(text, config), rawResponse: text }; }
    catch (error) { error.modelResponse = { model: entry.model, rawResponse: text }; throw error; }
  };
  const prompt = promptFor(config);
  if (!workflow.dualEval?.enabled) return call(workflow.model, prompt);
  const dual = workflow.dualEval;
  const settled = await Promise.allSettled([call(workflow.model, prompt), call(dual.secondary, prompt)]);
  const failed = settled.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
  const [a, b] = settled.map(r => r.value);
  const diff = Math.abs(a.score - b.score);
  const same = a.score === b.score && (a.subScores || []).every((s, i) => s.score === b.subScores?.[i]?.score);
  if (dual.questionType !== 'subjective' ? same : diff <= (dual.threshold ?? 2)) {
    if (dual.questionType !== 'subjective') return { ...a, formatWarning: a.formatWarning || b.formatWarning, dualEval: { result: 'consensus', a, b } };
    const subScores = (a.subScores || []).map((s, i) => ({ ...s, score: (s.score + b.subScores[i].score) / 2, comment: [s.comment, b.subScores[i].comment].filter(Boolean).join('\n') }));
    const result = { ...a, formatWarning: a.formatWarning || b.formatWarning, score: subScores.length ? subScores.reduce((s, u) => s + u.score, 0) : (a.score + b.score) / 2, subScores, comment: `${a.comment || ''}\n${b.comment || ''}`, dualEval: { result: 'average', a, b } };
    return validateResult(result, config);
  }
  const verdict = await call(dual.arbitration, `${prompt}\n请重新独立仲裁，不得平均。第一评：${JSON.stringify(a)}\n第二评：${JSON.stringify(b)}`);
  return { ...verdict, dualEval: { result: 'arbitration', a, b } };
}

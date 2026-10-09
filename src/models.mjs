import { promptFor, parseResult, validateResult, fieldImages, recognitionWarning } from './domain.mjs';
import { sameScoringItems } from '../ui/scoring-labels.js';

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
    try { const parsed = parseResult(text, config); return { ...parsed, recognitionWarning: recognitionWarning(parsed), model: entry.model, rawResponse: text }; }
    catch (error) { error.modelResponse = { model: entry.model, rawResponse: text }; throw error; }
  };
  const prompt = promptFor(config);
  const useArbitration = workflow.recognitionPolicy === 'arbitration';
  if (!workflow.dualEval?.enabled) {
    const primary = await call(workflow.model, prompt);
    if (!primary.recognitionWarning || !useArbitration) return primary;
    const verdict = await call(workflow.dualEval?.arbitration, `${prompt}\n首次识别存在疑点，请重新检查原图，忠实识别实际书写并独立评分，不得脑补。用户选择按仲裁有效分数继续，请保留全部无法确认内容及疑点。首次结果：${JSON.stringify(primary)}`);
    return { ...verdict, recognitionWarning: [primary.recognitionWarning, verdict.recognitionWarning].filter(Boolean).join(' '), recognitionDecision: 'arbitration', recognitionArbitration: { primary, verdict } };
  }
  const dual = workflow.dualEval;
  const objective = dual.questionType !== 'subjective';
  const needsDetails = objective && (config.scoring?.units?.length || 0) <= 1;
  const dualPrompt = (config.scoring?.units?.length || 0) <= 1 ? `${prompt}\n双阅额外要求：必须返回scoringDetails数组，按评分标准中的每个小问或独立评分点逐项列出{label,score,maxScore,studentAnswer,reason}；reason说明对应评分规则、作答是否符合及给分或扣分原因，不得只有“正确/错误”，包括零分项，不得合并为整题总分。label使用评分标准原文中的编号和名称，顺序与标准一致。scoringDetails各项之和必须等于score。subScores仍只对应网页总分框。` : prompt;
  const settled = await Promise.allSettled([call(workflow.model, dualPrompt), call(dual.secondary, dualPrompt)]);
  const failed = settled.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
  const [a, b] = settled.map(r => r.value);
  // Uncertain readings require a third review before claiming three-way agreement.
  const readingWarning = [a.recognitionWarning, b.recognitionWarning].filter(Boolean).join(' ');
  const diff = Math.abs(a.score - b.score);
  const items = result => result.scoringDetails?.length ? result.scoringDetails : needsDetails ? [] : result.subScores || [];
  const aItems = items(a), bItems = items(b);
  const match = sameScoringItems;
  const same = a.score === b.score && match(a.subScores || [], b.subScores || []) && aItems.length > 0 && match(aItems, bItems);
  if (!readingWarning && (dual.questionType !== 'subjective' ? same : diff <= (dual.threshold ?? 2))) {
    if (dual.questionType !== 'subjective') return { ...a, recognitionWarning: readingWarning, formatWarning: a.formatWarning || b.formatWarning, dualEval: { result: 'consensus', a, b } };
    const subScores = (a.subScores || []).map((s, i) => ({ ...s, score: (s.score + b.subScores[i].score) / 2, comment: [s.comment, b.subScores[i].comment].filter(Boolean).join('\n') }));
    const result = { ...a, recognitionWarning: readingWarning, formatWarning: a.formatWarning || b.formatWarning, score: subScores.length ? subScores.reduce((s, u) => s + u.score, 0) : (a.score + b.score) / 2, subScores, comment: `${a.comment || ''}\n${b.comment || ''}`, dualEval: { result: 'average', a, b } };
    return validateResult(result, config);
  }
  const verdict = await call(dual.arbitration, `${dualPrompt}\n两份评分存在识别疑点、逐项分歧或明细缺失，请重新独立仲裁，逐项评分后合计总分，不得平均。第一评：${JSON.stringify(a)}\n第二评：${JSON.stringify(b)}`);
  if (needsDetails && !verdict.scoringDetails?.length) {
    const error = Error('客观题仲裁模型未返回逐项评分明细，已停止；不能仅按总分继续');
    error.modelResponse = { model: dual.arbitration.model, rawResponse: verdict.rawResponse }; throw error;
  }
  const comparable = result => (config.scoring?.units?.length || 0) <= 1 ? result.scoringDetails || [] : items(result);
  const tripleSame = a.score === b.score && a.score === verdict.score &&
    match(a.subScores || [], b.subScores || []) && match(a.subScores || [], verdict.subScores || []) &&
    comparable(a).length > 0 && match(comparable(a), comparable(b)) && match(comparable(a), comparable(verdict));
  return { ...verdict, recognitionWarning: [readingWarning, verdict.recognitionWarning].filter(Boolean).join(' '), recognitionDecision: tripleSame ? 'three-way-consensus' : useArbitration && (readingWarning || verdict.recognitionWarning) ? 'arbitration' : undefined, dualEval: { result: 'arbitration', threeWayConsensus: tripleSame, a, b, verdict } };
}

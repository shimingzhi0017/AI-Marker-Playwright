import { promptFor, parseResult, validateResult, fieldImages, recognitionWarning } from './domain.mjs';
import { sameScoringItems } from '../ui/scoring-labels.js';
import { requestModel, DEFAULT_REQUEST_TIMEOUT_MS } from './model-client.mjs';
export { endpoint, modelListEndpoint, listModels, extractResponse, requestModel } from './model-client.mjs';

export const DEFAULT_GRADING_TIMEOUT_MS = 600000;

function retryableModelError(error) {
  const message = String(error?.message || '');
  return /模型.*请求超时|模型返回空正文|模型接口返回HTML或无效JSON|模型响应截断|模型结果未完整结束|模型没有返回完整JSON评分结果|模型总分(?:与.*合计不一致|无效|越界)|模型小问评分明细无效|模型评分项.*(?:不完整|无效|越界|缺失|重复|不对应)|模型评分单元不完整|模型得分不符合|模型两组评分明细不一致|评分单元名称、顺序或分数无效/u.test(message);
}

function isRepairedTotalWarning(warning) {
  return /^模型总分字段为\d+(?:\.\d+)?，与完整分项合计及网页总分\d+(?:\.\d+)?不一致；已按两者一致的合计修正，请人工确认。$/u.test(warning || '');
}

function sameRepairResult(a, b, config) {
  const comparable = config.scoring?.units?.length ? [a.subScores || [], b.subScores || []] : [a.scoringDetails || [], b.scoringDetails || []];
  return a.score === b.score && comparable[0].length > 0 && comparable[0].length === comparable[1].length && sameScoringItems(comparable[0], comparable[1]);
}

function correctedRetryPrompt(prompt,error) {
  const message=String(error?.message||'');
  if(/合计不一致|无法汇总/u.test(message)) return `${prompt}\n校验重试要求：上一版各项评分与总分的合计校验失败。请重新核对每项score，按scoringDetails各项score逐项相加，令score严格等于该和；subScores必须按网页评分框完整返回且其合计也严格等于score。保留原有逐项评分判断，只修正计算或格式错误；只返回完整、合法、可解析的JSON对象。`;
  if(/JSON|JSON评分结果/u.test(message)) return `${prompt}\n格式重试要求：上一版不是完整合法的JSON。请重新评分并确保字符串中的双引号、反斜杠和换行都正确转义，所有字段与数组、对象均完整闭合；不要在JSON前后添加说明或Markdown，只返回完整JSON对象。`;
  return `${prompt}\n校验重试要求：上一版未通过校验（${message}）。请重新检查输出字段、分数范围、各项满分和合计，并只返回完整合法的JSON对象。`;
}

export async function grade(config, settings, images, signal, onProgress) {
  const controller=new AbortController();
  const timeoutMs=settings.gradingTimeoutMs || DEFAULT_GRADING_TIMEOUT_MS;
  const timeoutError=Error(`本份答卷模型评分超过${Math.round(timeoutMs/1000)}秒，已暂停；请检查正在等待的模型或更换模型后重试。`);
  timeoutError.modelRequestFailure={type:'整份评分超时',timeoutMs};
  const combined=AbortSignal.any([signal || new AbortController().signal,controller.signal]);
  const timer=setTimeout(()=>controller.abort(timeoutError),timeoutMs);
  try {return await gradeInternal(config,settings,images,combined,onProgress,controller);}
  finally {clearTimeout(timer);}
}
async function gradeInternal(config, settings, images, signal, onProgress, controller) {
  const workflow = settings.workflows[config.workflowId];
  if (!workflow?.model) throw Error('工作流主模型未配置');
  const budget = { remaining: settings.requestBudget || 6 };
  const call = async (entry, prompt, role='主评') => {
    const provider = settings.providers[entry?.provider];
    if (!provider || !entry.model) throw Error('工作流模型或供应商无效');
    let text;
    const progress=event=>onProgress?.({...event,role,provider:entry.provider,model:entry.model,time:new Date().toISOString()});
    let activePrompt=prompt;
    for (let responseAttempt = 0; responseAttempt < 2; responseAttempt++) {
      progress({status:responseAttempt ? 'retrying' : 'requesting', attempt:responseAttempt + 1});
      try {
        text = await requestModel({ ...provider, timeoutMs: provider.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS, reasoningEffort: entry.reasoningEffort, maxOutputTokens: workflow.outputLimitEnabled === false ? undefined : workflow.maxOutputTokens || provider.maxOutputTokens }, entry.model, activePrompt, [...fieldImages(config), ...images], signal, {get remaining(){return budget.remaining;},set remaining(value){budget.remaining=value;},onProgress:progress});
      } catch (error) {
        if (!signal?.aborted && responseAttempt === 0 && budget.remaining > 0 && retryableModelError(error)) {
          activePrompt=responseAttempt===0?correctedRetryPrompt(prompt,error):prompt;
          progress({status:'retrying',message:'模型响应异常，正在进行一次有限重试',attempt:2});
          continue;
        }
        progress({status:signal?.aborted?'cancelled':'failed',message:error.message});
        if (!signal?.aborted) { error.modelRequestFailure ||= { model: entry.model, type: error.message }; error.modelRequestFailure.provider = entry.provider; }
        throw error;
      }
      try {
        const parsed = parseResult(text, config);progress({status:'completed',score:parsed.score}); return { ...parsed, recognitionWarning: recognitionWarning(parsed), model: entry.model, rawResponse: text };
      } catch (error) {
        error.modelResponse = { model: entry.model, rawResponse: text };
        if (!signal?.aborted && responseAttempt === 0 && budget.remaining > 0 && retryableModelError(error)) {
          activePrompt=responseAttempt===0?correctedRetryPrompt(prompt,error):prompt;
          progress({status:'retrying',message:'模型输出无法校验，正在进行一次有限重试',attempt:2});
          continue;
        }
        progress({status:'failed',message:error.message});
        throw error;
      }
    }
  };
  const prompt = promptFor(config);
  const useArbitration = workflow.recognitionPolicy === 'arbitration';
  if (!workflow.dualEval?.enabled) {
    const primary = await call(workflow.model, prompt);
    const arbitration = workflow.dualEval?.arbitration;
    // A repaired model total is still a scoring decision. When an arbitration
    // model is configured, independently re-score it before unattended flow
    // can accept the repair.
    if (primary.formatWarning && isRepairedTotalWarning(primary.formatWarning) && arbitration?.provider && arbitration.model) {
      const verdict = await call(arbitration, `${prompt}\n本次触发原因：模型返回的总分与完整评分明细合计不一致。请独立审阅原始答卷图片、题目和评分标准，逐项重新评分并核对合计；不要沿用主评总分，也不要只按主评结果改写。`, '仲裁');
      if (sameRepairResult(primary, verdict, config)) {
        return { ...primary, formatWarning: undefined, formatNote: '总分冲突已由仲裁模型独立复核，逐项分数与合计一致。', dualEval: { result: 'arbitration', a: primary, verdict } };
      }
      return { ...verdict, formatWarning: [primary.formatWarning, verdict.formatWarning].filter(Boolean).join(' ') || '主评与仲裁逐项评分不一致，请人工确认。', dualEval: { result: 'arbitration', a: primary, verdict } };
    }
    return primary;
  }

  const dual = workflow.dualEval;
  const objective = dual.questionType !== 'subjective';
  const needsDetails = objective && (config.scoring?.units?.length || 0) <= 1;
  const dualPrompt = (config.scoring?.units?.length || 0) <= 1 ? `${prompt}\n双阅额外要求：必须返回scoringDetails数组，按评分标准中的每个小问或独立评分点逐项列出{label,score,maxScore,studentAnswer,reason}；reason说明对应评分规则、作答是否符合及给分或扣分原因，不得只有“正确/错误”，包括零分项，不得合并为整题总分。若提示包含固定评分项清单，id、label、maxScore及顺序必须严格按该清单返回；否则label使用评分标准原文中的编号和名称，顺序与标准一致。scoringDetails各项之和必须等于score。subScores仍只对应网页总分框。` : prompt;
  let a,b;
  try {[a,b]=await Promise.all([call(workflow.model, dualPrompt,'主评'), call(dual.secondary, dualPrompt,'复评')]);}
  catch(error){controller.abort(error);throw error;}
  // Uncertain readings require a third review before claiming three-way agreement.
  const readingWarning = [a.recognitionWarning, b.recognitionWarning].filter(Boolean).join(' ');
  const diff = Math.abs(a.score - b.score);
  const items = result => result.scoringDetails?.length ? result.scoringDetails : needsDetails ? [] : result.subScores || [];
  const aItems = items(a), bItems = items(b);
  const match = sameScoringItems;
  const same = a.score === b.score && match(a.subScores || [], b.subScores || []) && aItems.length > 0 && match(aItems, bItems);
  if (!readingWarning && (dual.questionType !== 'subjective' ? same : diff <= (dual.threshold ?? 2))) {
    if (dual.questionType !== 'subjective') return { ...a, recognitionWarning: readingWarning, formatWarning: a.formatWarning || b.formatWarning, dualEval: { result: 'consensus', a, b } };
    const repairedTotalWarnings = [a.formatWarning, b.formatWarning].filter(isRepairedTotalWarning);
    const corroboratesRepair = a.score === b.score && aItems.length > 0 && sameScoringItems(aItems, bItems) && repairedTotalWarnings.length > 0;
    const remainingFormatWarnings = [a.formatWarning, b.formatWarning].filter(warning => warning && !(corroboratesRepair && isRepairedTotalWarning(warning)));
    const formatNote = corroboratesRepair
      ? repairedTotalWarnings.map(warning => warning.replace('；已按两者一致的合计修正，请人工确认。', '；主评、复评逐项核对一致，已交叉验证修正结果。')).join('\n')
      : undefined;
    const subScores = (a.subScores || []).map((s, i) => ({ ...s, score: (s.score + b.subScores[i].score) / 2, comment: [s.comment, b.subScores[i].comment].filter(Boolean).join('\n') }));
    const scoringDetails = a.scoringDetails?.length && b.scoringDetails?.length && a.scoringDetails.length === b.scoringDetails.length &&
      a.scoringDetails.every((item, i) => Number.isFinite(item.score) && Number.isFinite(b.scoringDetails[i]?.score))
      ? a.scoringDetails.map((item, i) => ({
          ...item,
          score: (item.score + b.scoringDetails[i].score) / 2,
          reason: [item.reason || item.comment, b.scoringDetails[i].reason || b.scoringDetails[i].comment].filter(Boolean).join('\n')
        }))
      : a.scoringDetails;
    const result = { ...a, recognitionWarning: readingWarning, formatWarning: remainingFormatWarnings.join('\n') || undefined, formatNote, score: subScores.length ? subScores.reduce((s, u) => s + u.score, 0) : (a.score + b.score) / 2, subScores, scoringDetails, comment: `${a.comment || ''}\n${b.comment || ''}`, dualEval: { result: 'average', a, b } };
    return validateResult(result, config);
  }
  const verdict = await call(dual.arbitration, `${dualPrompt}\n本次触发原因：${readingWarning ? '识别存疑' : '评分分歧或评分明细不完整'}。请仅依据原始答卷图片、题目及评分标准独立重新识别和逐项评分，合计你自己的总分，不得平均或推测其他模型评分。`,'仲裁');
  if (needsDetails && !verdict.scoringDetails?.length) {
    const error = Error('客观题仲裁模型未返回逐项评分明细，已停止；不能仅按总分继续');
    error.modelResponse = { model: dual.arbitration.model, rawResponse: verdict.rawResponse }; throw error;
  }
  const comparable = result => (config.scoring?.units?.length || 0) <= 1 ? result.scoringDetails || [] : items(result);
  const tripleSame = a.score === b.score && a.score === verdict.score &&
    match(a.subScores || [], b.subScores || []) && match(a.subScores || [], verdict.subScores || []) &&
    comparable(a).length > 0 && match(comparable(a), comparable(b)) && match(comparable(a), comparable(verdict));
  return { ...verdict, formatWarning:[a.formatWarning,b.formatWarning,verdict.formatWarning].filter(Boolean).join(' '), recognitionWarning: [readingWarning, verdict.recognitionWarning].filter(Boolean).join(' '), recognitionDecision: tripleSame ? 'three-way-consensus' : useArbitration && (readingWarning || verdict.recognitionWarning) ? 'arbitration' : undefined, dualEval: { result: 'arbitration', threeWayConsensus: tripleSame, a, b, verdict } };
}

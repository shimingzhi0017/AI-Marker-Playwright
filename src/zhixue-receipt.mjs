import { stableImageKey } from './platform.mjs';

// Both routing hosts are observed on the same Zhixue marking site.
export function isZhixueApiUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['pt-ali-bj.zhixue.com', 'pt-ali-bj-re.zhixue.com'].includes(url.hostname);
  } catch { return false; }
}

export function zhixueCommitUrl(topic) {
  if (!isZhixueApiUrl(topic?.apiOrigin)) throw Error('当前答卷缺少可信阅卷接口来源，请刷新阅卷页面重新识别');
  return new URL('/marking/marking/commitTopic/', topic.apiOrigin).href;
}

export function matchesZhixueCommitUrl(value, topic) {
  if (!isZhixueApiUrl(value)) return false;
  const url = new URL(value);
  return url.origin + url.pathname === zhixueCommitUrl(topic);
}

export function readTopic(json, field = 'topicInfo') {
  if (json?.code !== 200) return null;
  const topic = json.data?.[field];
  const detail = topic?.detail;
  let ids;
  try { ids = JSON.parse(topic?.item?.id); } catch { return null; }
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id)) return null;
  if (!detail?.scanRecordId || !detail.markingPaperId || !detail.topicImageIds?.length) return null;
  return { scanRecordId: detail.scanRecordId, markingPaperId: detail.markingPaperId, itemIds: ids,
    topicNumStr: topic.topicNumStr || json.data.topicNum,
    student: { userId: topic.item?.userId || detail.userId || '', userCode: detail.userCode || topic.item?.userCode || '', name: detail.userName || '', classId: detail.classId || topic.item?.classId || '', schoolId: detail.schoolId || topic.item?.schoolId || '' },
    imageKeys: detail.topicImageIds.map(stableImageKey) };
}

export function matchesTopic(topic, imageKeys, markingPaperId) {
  return !!topic && topic.markingPaperId === markingPaperId && imageKeys.length > 0 &&
    imageKeys.length === topic.imageKeys.length && imageKeys.every((key, i) => key === topic.imageKeys[i]);
}

export function verifyCommit(requestBody, json, topic, scores) {
  let ids, markingScores;
  try {
    ids = JSON.parse(requestBody.id);
    // Observed platform format is a simple numeric map with single-quoted keys.
    if (!/^\{\s*'\d+,-?\d+'\s*:\s*-?\d+(?:\.\d+)?\s*\}$/.test(requestBody.markingScores)) throw Error('unsupported score map');
    markingScores = JSON.parse(requestBody.markingScores.replace(/'/g, '"'));
  } catch { throw Error('提交请求格式未通过核验'); }
  if (!topic || requestBody.markingPaperId !== topic.markingPaperId || JSON.stringify(ids) !== JSON.stringify(topic.itemIds)) throw Error('提交请求答卷编号与当前评分答卷不一致');
  if (scores.length !== 1 || markingScores[topic.topicNumStr] !== scores[0]) throw Error('提交请求分数与已确认评分不一致');
  if (json?.result !== 'success') throw Error('服务器未明确返回提交成功');
  return { confirmed: true, source: 'zhixue-commitTopic', itemIds: ids, scanRecordId: topic.scanRecordId, scores, result: json.result };
}

export function trackZhixueTopics(page) {
  let current = null;
  const candidates = new Map();
  const pending = new Set();
  const origins = new WeakMap();
  const handler = response => {
    const url = new URL(response.url());
    const prefetch = url.pathname === '/marking/marking/personal/preLoadScanrecorddetail/';
    if (!isZhixueApiUrl(url) || (!prefetch && url.pathname !== '/marking/marking/personal/scanrecorddetail/') || response.request().method() !== 'POST') return;
    const promise = (async () => { try {
      const topic = readTopic(await response.json(), prefetch ? 'nextTopicInfo' : 'topicInfo');
      if (topic) {
        topic.apiOrigin = url.origin;
        try { origins.set(topic, response.request().frame().page()); } catch {}
        if (!prefetch) current = topic;
        const source = origins.get(topic);
        const sourceIndex = source ? page.pages?.().indexOf(source) ?? 0 : 0;
        candidates.set(`${sourceIndex}:${topic.markingPaperId}:${topic.scanRecordId}:${JSON.stringify(topic.itemIds)}`, topic);
        if (candidates.size > 20) candidates.delete(candidates.keys().next().value);
      }
    } catch {} })();
    pending.add(promise); promise.finally(() => pending.delete(promise));
  };
  page.on('response', handler);
  return {
    async current() { await Promise.allSettled([...pending]); return current; },
    async match(imageKeys, markingPaperId, targetPage) {
      await Promise.allSettled([...pending]);
      const matches = [...candidates.values()].filter(topic => (!targetPage || origins.get(topic) === targetPage) && matchesTopic(topic, imageKeys, markingPaperId));
      return matches.length === 1 ? matches[0] : null;
    },
    close() { page.off('response', handler); }
  };
}

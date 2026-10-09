import { stableImageKey } from './platform.mjs';

export function readTopic(json) {
  if (json?.code !== 200) return null;
  const topic = json.data?.topicInfo;
  const detail = topic?.detail;
  let ids;
  try { ids = JSON.parse(topic?.item?.id); } catch { return null; }
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id)) return null;
  if (!detail?.scanRecordId || !detail.markingPaperId || !detail.topicImageIds?.length) return null;
  return { scanRecordId: detail.scanRecordId, markingPaperId: detail.markingPaperId, itemIds: ids,
    topicNumStr: topic.topicNumStr || json.data.topicNum,
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
  const pending = new Set();
  const handler = response => {
    const url = new URL(response.url());
    if (url.hostname !== 'pt-ali-bj-re.zhixue.com' || url.pathname !== '/marking/marking/personal/scanrecorddetail/' || response.request().method() !== 'POST') return;
    const promise = (async () => { try { const topic = readTopic(await response.json()); if (topic) current = topic; } catch {} })();
    pending.add(promise); promise.finally(() => pending.delete(promise));
  };
  page.on('response', handler);
  return { async current() { await Promise.allSettled([...pending]); return current; }, close() { page.off('response', handler); } };
}

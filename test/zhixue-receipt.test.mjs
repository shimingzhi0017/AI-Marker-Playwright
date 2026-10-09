import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTopic, matchesTopic, verifyCommit } from '../src/zhixue-receipt.mjs';
import { stableImageKey } from '../src/platform.mjs';

test('真实接口结构：当前答卷图片匹配、预取排除、提交编号及分数验证', () => {
  const image = 'https://fixture.aliyuncs.com/scan.jpg?Signature=one&Expires=1&x-oss-process=crop';
  const info = { detail: { scanRecordId: 'scan1', markingPaperId: 'paper1', topicImageIds: [image] }, item: { id: '["item1"]' }, topicNumStr: '12,-1' };
  const topic = readTopic({ code: 200, data: { topicInfo: info } });
  assert.equal(readTopic({ code: 200, data: { nextTopicInfo: info } }), null);
  assert.equal(matchesTopic(topic, [stableImageKey(image.replace('Signature=one', 'Signature=two'))], 'paper1'), true);
  assert.equal(matchesTopic(topic, [stableImageKey(image.replace('scan.jpg', 'next.jpg'))], 'paper1'), false);
  const body = { markingPaperId: 'paper1', id: '["item1"]', markingScores: "{'12,-1':0}" };
  assert.equal(verifyCommit(body, { result: 'success' }, topic, [0]).confirmed, true);
  assert.throws(() => verifyCommit({ ...body, id: '["item2"]' }, { result: 'success' }, topic, [0]), /编号/);
  assert.throws(() => verifyCommit(body, { result: 'success' }, topic, [2]), /分数/);
  assert.throws(() => verifyCommit(body, { result: 'failed' }, topic, [0]), /成功/);
  assert.throws(() => verifyCommit({ ...body, markingScores: "{'12,-1':null}" }, { result: 'success' }, topic, [0]), /格式/);
});

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function scoreMatches(value, score) {
  return value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) === score;
}
export function stableImageKey(value) {
  try {
    const url = new URL(value);
    if (url.hostname.endsWith('.aliyuncs.com')) {
      for (const key of [...url.searchParams.keys()]) {
        if (['expires', 'ossaccesskeyid', 'signature', 'security-token'].includes(key.toLowerCase())) url.searchParams.delete(key);
      }
      url.searchParams.sort();
    }
    return url.href;
  } catch { return value; }
}
export function pageContext(value) {
  try {
    const url = new URL(value);
    const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '';
    const params = new URLSearchParams(hashQuery);
    return { examId: params.get('examId') || url.searchParams.get('examId') || '', markingPaperId: params.get('markingPaperId') || url.searchParams.get('markingPaperId') || '' };
  } catch { return { examId: '', markingPaperId: '' }; }
}
export class ZhixuePlatform {
  constructor(page, settings, diagnosticsDir) { this.page = page; this.options = settings.platform || {}; this.dir = diagnosticsDir; }
  async frame() {
    const matches = [];
    for (const frame of this.page.frames()) {
      if (this.options.frameUrlPattern && !new RegExp(this.options.frameUrlPattern).test(frame.url())) continue;
      try {
        if (await frame.locator(this.inputSelector()).count() && await frame.locator(this.submitSelector()).count()) matches.push(frame);
      } catch { /* detached */ }
    }
    if (matches.length !== 1) throw Error(matches.length ? '发现多个阅卷区域，需配置frameUrlPattern' : '未找到阅卷区域；检查登录状态或页面加载');
    return matches[0];
  }
  inputSelector() { return this.options.scoreSelector || 'input[name="topicTxt"]:visible, #txt_marking_all:visible'; }
  submitSelector() { return this.options.submitSelector || '#bnt_save, button:has-text("提交分数")'; }
  async snapshot() {
    const frame = await this.frame();
    const data = await frame.evaluate(options => {
      const images = [...document.querySelectorAll(options.imageSelector || 'div[name="topicImg"] img, img.enhance-definition-bright')].map(img => ({ url: img.currentSrc || img.src, ready: img.complete && img.naturalWidth > 0 }));
      const read = selector => selector ? document.querySelector(selector)?.getAttribute('data-paper-id') || document.querySelector(selector)?.textContent?.trim() || '' : '';
      return { images, paperId: read(options.paperIdSelector), taskId: read(options.taskIdSelector || '#currentTopicIndex'), url: location.href };
    }, this.options);
    const inputs = frame.locator(this.inputSelector());
    const units = await inputs.evaluateAll(elements => elements.map((el, i) => ({ index: i, label: el.getAttribute('data-label') || el.closest('li')?.querySelector('.label')?.textContent?.trim() || `第${i + 1}题`, maxScore: Number(el.getAttribute('score') || el.getAttribute('max') || 0) })));
    const context = pageContext(data.url);
    const legacyTaskId = data.taskId || data.url.replace(/([?&])_t=[^&]+/g, '');
    const taskId = context.examId || context.markingPaperId ? `${context.examId}:${context.markingPaperId}:${legacyTaskId}` : legacyTaskId;
    const imageKeys = data.images.map(i => stableImageKey(i.url));
    return { ...data, taskId, legacyTaskId, pageContext: context, units, imageKeys,
      identity: data.paperId ? `${taskId}:${data.paperId}` : `${taskId}:${imageKeys.join('|')}`,
      identitySource: data.paperId ? 'configured-page-element' : 'image-resource-fallback', strongIdentity: !!data.paperId };
  }
  async completed() {
    if (!this.options.completionSelector) return false;
    for (const frame of this.page.frames()) {
      try { if (await frame.locator(this.options.completionSelector).isVisible()) return true; } catch { /* detached */ }
    }
    return false;
  }
  async ready(previous, signal) {
    const deadline = Date.now() + (this.options.loadTimeoutMs || 20000);
    let lastError;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (await this.completed()) return null;
      try {
        const current = await this.snapshot();
        if (current.images.length && current.images.every(i => i.ready) && current.units.length && (!previous || current.identity !== previous.identity)) return current;
      } catch (e) { lastError = e; }
      await sleep(200);
    }
    throw Error(`页面或下一份答卷未就绪，已暂停：${lastError?.message || '图片未加载或答卷标识未变化'}`);
  }
  async images(snapshot, signal) {
    const images = [];
    for (const image of snapshot.images) {
      signal?.throwIfAborted();
      let buffer;
      if (image.url.startsWith('data:')) buffer = Buffer.from(image.url.split(',')[1], 'base64');
      else {
        let error;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await this.page.context().request.get(image.url, { timeout: 15000, headers: { Referer: snapshot.url } });
            if (!response.ok()) throw Error(`图片HTTP ${response.status()}`);
            buffer = await response.body(); break;
          } catch (e) { error = e; if (attempt === 0) await sleep(300); }
        }
        if (!buffer) throw error;
      }
      const meta = await sharp(buffer).metadata();
      if (!meta.width || !meta.height || meta.width * meta.height < 1000) throw Error('图片无法解码或尺寸过小');
      const png = await sharp(buffer).png().toBuffer();
      images.push({ buffer: png, hash: hash(png), data: `data:image/png;base64,${png.toString('base64')}` });
    }
    await this.assertCurrent(snapshot); return images;
  }
  async assertCurrent(snapshot) {
    const current = await this.snapshot();
    if (current.identity !== snapshot.identity || JSON.stringify(current.images.map(i => i.url)) !== JSON.stringify(snapshot.images.map(i => i.url)) || !current.images.every(i => i.ready)) throw Error('当前答卷已变化或图片未就绪，禁止写入旧评分');
  }
  async fill(snapshot, scores) {
    await this.assertCurrent(snapshot);
    const frame = await this.frame(), inputs = frame.locator(this.inputSelector());
    if (await inputs.count() !== scores.length) throw Error('评分控件数量与结果不一致');
    for (let i = 0; i < scores.length; i++) {
      await inputs.nth(i).fill(String(scores[i])); await inputs.nth(i).dispatchEvent('change'); await inputs.nth(i).blur();
      if (!scoreMatches(await inputs.nth(i).inputValue(), scores[i])) throw Error('分数读回验证失败');
    }
    await this.assertCurrent(snapshot);
  }
  async submit(snapshot, scores) {
    if (!this.options.verified || !this.options.paperIdSelector || !this.options.submitResponseUrlPattern) throw Error('平台尚未完成实测配置，禁止自动提交');
    await this.assertCurrent(snapshot);
    const frame = await this.frame();
    const inputs = frame.locator(this.inputSelector());
    if (await inputs.count() !== scores.length) throw Error('提交前评分控件数量变化');
    for (let i = 0; i < scores.length; i++) if (!scoreMatches(await inputs.nth(i).inputValue(), scores[i])) throw Error('提交前分数已变化');
    const responsePromise = this.page.waitForResponse(r => new RegExp(this.options.submitResponseUrlPattern).test(r.url()) && r.request().method() === 'POST', { timeout: this.options.submitTimeoutMs || 10000 });
    try {
      await frame.locator(this.submitSelector()).click();
      const response = await responsePromise;
      if (!response.ok()) throw Error(`平台提交HTTP ${response.status()}`);
      const json = await response.json();
      const value = (this.options.successField || 'success').split('.').reduce((o, key) => o?.[key], json);
      if (value !== (this.options.successValue ?? true)) throw Error('平台未明确确认保存成功');
      return { status: response.status(), confirmed: true };
    } catch (e) { await responsePromise.catch(() => {}); throw Error(`提交状态不明，需人工核对：${e.message}`); }
  }
  async diagnostic(reason) {
    fs.mkdirSync(this.dir, { recursive: true });
    const prefix = path.join(this.dir, `${Date.now()}`);
    await this.page.screenshot({ path: `${prefix}.png` }).catch(() => {});
    fs.writeFileSync(`${prefix}.json`, JSON.stringify({ reason, frames: this.page.frames().map(f => f.url()) }, null, 2));
    return prefix;
  }
}

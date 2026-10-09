import sharp from 'sharp';

export async function blackRatio(buffer, fixedThreshold) {
  const { data, info } = await sharp(buffer).flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  if (info.width * info.height < 1000) throw Error('图片尺寸过小，不能判定空白');
  const histogram = new Array(256).fill(0);
  for (const value of data) histogram[value]++;
  let sum = 0; histogram.forEach((n, i) => sum += n * i);
  let background = 0, partial = 0, variance = -1, threshold = 0;
  for (let i = 0; i < 256; i++) {
    background += histogram[i]; partial += histogram[i] * i;
    const foreground = data.length - background;
    if (!background || !foreground) continue;
    const value = background * foreground * (partial / background - (sum - partial) / foreground) ** 2;
    if (value > variance) { variance = value; threshold = i; }
  }
  threshold = fixedThreshold ?? threshold;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) throw Error('空白范本阈值无效');
  return { threshold, ratio: [...data].filter(v => v <= threshold).length / data.length };
}
export async function detectBlank(images, reference, difference = 0.01) {
  const warning = blankReferenceWarning(reference, images.length, difference);
  if (warning) throw Error(warning);
  const ratios = await Promise.all(images.map((image, i) => blackRatio(image.buffer, reference[i].threshold)));
  return { isBlank: ratios.every((r, i) => Math.abs(r.ratio - reference[i].ratio) <= difference), ratios };
}

export function blankReferenceWarning(reference, imageCount, difference = 0.01) {
  if (!Array.isArray(reference) || !reference.length) return '空白检测未设置范本：请在历史记录中确认一份真正的空白答卷并保存为空白范本，或关闭空白检测。';
  if (reference.length !== imageCount) return `空白范本有${reference.length}张，当前答卷有${imageCount}张：请重新设置与当前题目对应的空白范本，或关闭空白检测。`;
  if (!Number.isFinite(difference) || difference < 0 || difference > 1 || reference.some(r => !r || !Number.isFinite(r.threshold) || r.threshold < 0 || r.threshold > 255 || !Number.isFinite(r.ratio) || r.ratio < 0 || r.ratio > 1)) return '空白范本参数无效：请重新保存空白范本，或关闭空白检测。';
  return '';
}

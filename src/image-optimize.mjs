import sharp from 'sharp';

/**
 * Inspect image magic bytes and return the corresponding MIME type.
 */
export function detectImageMime(buffer) {
  const bytes = Buffer.isBuffer(buffer)
    ? buffer
    : buffer instanceof Uint8Array
      ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : null;
  if (!bytes || bytes.length < 4) return 'image/png';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return 'image/png';
}

/**
 * Downscale oversized scanned answer images and choose the smaller lossless PNG
 * or crisp 4:4:4 JPEG encoding without clipping dark ink on transparent regions.
 */
export async function optimizeAnswerImage(buffer, options = {}) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const maxEdge = options.maxEdge === undefined ? 2048 : Number(options.maxEdge);
  const jpegQuality = Math.min(100, Math.max(40, Number(options.jpegQuality ?? 88) || 88));
  const preferJpegMinBytes = options.preferJpegMinBytes === undefined ? 400 * 1024 : Number(options.preferJpegMinBytes);

  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height || meta.width * meta.height < 1000) {
    throw Error('图片无法解码或尺寸过小');
  }

  const maxDim = Math.max(meta.width, meta.height);
  const needsResize = Number.isFinite(maxEdge) && maxEdge > 0 && maxDim > maxEdge;
  const needsRotate = Number(meta.orientation) > 1;
  const shouldCompress = needsResize || needsRotate || input.length >= preferJpegMinBytes;

  if (!shouldCompress && (meta.format === 'png' || meta.format === 'jpeg')) {
    const mime = meta.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return {
      buffer: input,
      mime,
      width: meta.width,
      height: meta.height,
      originalBytes: input.length,
      optimizedBytes: input.length,
      resized: false
    };
  }

  let pipeline = sharp(input).rotate();
  if (needsResize) {
    pipeline = pipeline.resize({
      width: maxEdge,
      height: maxEdge,
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  const pngBuffer = await pipeline.clone().png({ compressionLevel: 6 }).toBuffer();
  const jpegBuffer = await pipeline
    .clone()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: jpegQuality, chromaSubsampling: '4:4:4' })
    .toBuffer();

  let outBuffer = pngBuffer;
  let outMime = 'image/png';
  if (jpegBuffer.length <= pngBuffer.length && (input.length >= preferJpegMinBytes || needsResize || meta.format === 'jpeg')) {
    outBuffer = jpegBuffer;
    outMime = 'image/jpeg';
  }
  if (!needsResize && !needsRotate && meta.format === 'jpeg' && input.length <= outBuffer.length) {
    outBuffer = input;
    outMime = 'image/jpeg';
  }

  const outMeta = await sharp(outBuffer).metadata();
  return {
    buffer: outBuffer,
    mime: outMime,
    width: outMeta.width || meta.width,
    height: outMeta.height || meta.height,
    originalBytes: input.length,
    optimizedBytes: outBuffer.length,
    resized: needsResize
  };
}

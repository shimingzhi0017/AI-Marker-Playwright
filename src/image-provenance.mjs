// Keep the exact source of locally enhanced answer images across canvas exports.
// Never infer a paper from the most recent network response alone.
export function installImageProvenance() {
  const sources = new WeakMap();
  const exports = new Map();
  const clearRect = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function(x, y, width, height) {
    const result = clearRect.call(this, x, y, width, height);
    const transform = this.getTransform();
    if (transform.isIdentity && x <= 0 && y <= 0 && x + width >= this.canvas.width && y + height >= this.canvas.height) sources.delete(this.canvas);
    return result;
  };
  for (const dimension of ['width', 'height']) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension);
    Object.defineProperty(HTMLCanvasElement.prototype, dimension, { ...descriptor, set(value) { descriptor.set.call(this, value); sources.delete(this); } });
  }
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
    const result = draw.call(this, image, ...args);
    const keys = image instanceof HTMLImageElement
      ? [exports.get(image.currentSrc || image.src) || image.currentSrc || image.src]
      : [...(sources.get(image) || ['unknown'])];
    const existing = sources.get(this.canvas) || new Set();
    keys.forEach(key => existing.add(key));
    sources.set(this.canvas, existing);
    return result;
  };
  const toDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    const value = toDataURL.apply(this, args);
    const keys = [...(sources.get(this) || [])];
    if (keys.length === 1 && /^https?:\/\//.test(keys[0])) {
      exports.set(value, keys[0]);
      if (exports.size > 100) exports.delete(exports.keys().next().value);
    } else exports.delete(value);
    return value;
  };
  window.__aiMarkerImageSources = exports;
}

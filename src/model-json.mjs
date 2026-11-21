function stripReasoningAndFences(raw) {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const stripped = (withoutThink.trim() ? withoutThink : raw).trim();
  return stripped.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

const LATEX_CONTROL_PREFIXES = {
  f: /^f(?:rac|orall)\b/,
  b: /^b(?:eta|ar|egin|inom|ig|oldsymbol|oxed)\b/,
  t: /^t(?:imes|ext|heta|an|o|riangle|au)\b/,
  r: /^r(?:ight|ho|m)\b/
};

/**
 * Repair invalid JSON escape sequences (such as unescaped LaTeX commands like
 * \sqrt, \cdot, \alpha) inside JSON string literals while preserving valid
 * escapes (\\, \", \/, \n, \uXXXX) and fixing single-escaped LaTeX commands
 * that collide with \b/\f/\r/\t.
 */
export function repairInvalidJsonEscapes(text) {
  if (typeof text !== 'string') return text;
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (!inString) {
      if (char === '"') inString = true;
      out += char;
      continue;
    }
    if (char === '"') {
      inString = false;
      out += char;
      continue;
    }
    if (char !== '\\') {
      out += char;
      continue;
    }
    if (i + 1 >= text.length) {
      out += '\\\\';
      continue;
    }
    const next = text[i + 1];
    if (next === '\\') {
      out += '\\\\';
      i += 1;
      continue;
    }
    if (next === '"' || next === '/' || next === 'n') {
      out += '\\' + next;
      i += 1;
      continue;
    }
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
      out += text.slice(i, i + 6);
      i += 5;
      continue;
    }
    if (Object.hasOwn(LATEX_CONTROL_PREFIXES, next)) {
      const isLatex = LATEX_CONTROL_PREFIXES[next].test(text.slice(i + 1));
      out += (isLatex ? '\\\\' : '\\') + next;
      i += 1;
      continue;
    }
    out += '\\\\' + next;
    i += 1;
  }
  return out;
}

function restoreLatexControlChars(str) {
  if (!/[\u0008\u0009\u000c\u000d]/.test(str)) return str;
  return str
    .replace(/\u000c(rac|orall)\b/g, '\\f$1')
    .replace(/\u0008(eta|ar|egin|inom|ig|oldsymbol|oxed)\b/g, '\\b$1')
    .replace(/\u0009(imes|ext|heta|an|o|riangle|au)\b/g, '\\t$1')
    .replace(/\u000d(ight|ho|m)\b/g, '\\r$1');
}

/**
 * Recursively restore LaTeX commands corrupted into JSON control characters
 * (\b, \t, \f, \r) when a model emits unescaped LaTeX inside valid JSON.
 */
export function recoverCorruptedLatexControls(value) {
  if (typeof value === 'string') return restoreLatexControlChars(value);
  if (Array.isArray(value)) return value.map(recoverCorruptedLatexControls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, recoverCorruptedLatexControls(item)])
    );
  }
  return value;
}

function tryParseObject(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = JSON.parse(repairInvalidJsonEscapes(text));
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return recoverCorruptedLatexControls(parsed);
}

/**
 * Extract and parse a JSON object from raw model output, tolerating
 * <think> blocks, surrounding prose/code fences, and unescaped LaTeX.
 */
export function parseModelJson(raw, { requiredKeys = [] } = {}) {
  if (typeof raw !== 'string') throw Error('模型返回内容不是文本');
  const text = stripReasoningAndFences(raw);
  const direct = tryParseObject(text);
  if (direct) return direct;

  // Some reasoning models include an example JSON object in their analysis and
  // then emit the actual object afterwards. Scan balanced objects while
  // respecting quotes inside JSON strings.
  const parsed = [];
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        const value = tryParseObject(text.slice(start, index + 1));
        if (value) {
          parsed.push(value);
          start = index;
        }
        break;
      }
    }
  }
  if (requiredKeys.length) {
    for (let index = parsed.length - 1; index >= 0; index--) {
      const value = parsed[index];
      if (requiredKeys.every(key => Object.hasOwn(value, key))) return value;
    }
  }
  if (parsed.length) return parsed.at(-1);
  throw Error('模型返回内容不是完整JSON对象');
}

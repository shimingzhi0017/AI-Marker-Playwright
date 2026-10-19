// Normalize explicit question numbering, retaining all meaningful suffix text.
export function scoringLabelKey(label) {
  const text = String(label ?? '').trim()
    .replace(/^[①-⑳]\s*(?=(?:第\s*)?[（(]\s*\d+\s*[）)]|第\s*\d+\s*问)/u, '')
    .normalize('NFKC').trim()
    .replace(/^\d+\s*(?=\(\s*\d+\s*\))/u, '')
    // Strip an outer list index only when an explicit inner question remains.
    .replace(/^\(\s*\d+\s*\)\s*(?=第\s*(?:\(\s*\d+\s*\)|\d+\s*问))/u, '');
  const question = text.match(/^(?:第\s*)?\(\s*(\d+)\s*\)\s*(?:问\s*)?(.*)$/u) || text.match(/^第\s*(\d+)\s*问\s*(.*)$/u);
  if (!question) return `literal:${text}`;
  const suffix = question[2].replace(/\s+/gu, '').replace(/^([AB])空箱质量$/u, '$1质量');
  // Models may describe the same numbered scoring point as either
  // "第(1)问-2" or "第（1）问第2项". The question/item number is the stable
  // identity; the remaining wording is only a display label.
  const item = suffix.match(/^[-–—:：](\d+)/u) || suffix.match(/^第\s*(\d+)\s*(?:项|小问|步)/u);
  return item ? `question:${question[1]}:item:${item[1]}` : `question:${question[1]}:${suffix}`;
}

const itemKey = item => typeof item.id === 'string' && item.id ? `id:${item.id}` : scoringLabelKey(item.label);
export function questionKey(label) {
  return scoringLabelKey(label).match(/^question:(\d+):/u)?.[1] || '';
}

export function matchScoringItem(detail, schema, details) {
  if(detail.id!==undefined)return schema.find(item=>item.id===detail.id);
  const exact=schema.find(item=>scoringLabelKey(item.label)===scoringLabelKey(detail.label));
  if(exact)return exact;
  const number=questionKey(detail.label);
  const targets=schema.filter(item=>questionKey(item.label)===number);
  const sources=details.filter(item=>questionKey(item.label)===number);
  if(number && targets.length===1 && sources.length===1 &&
    [targets[0].label,detail.label].some(label=>scoringLabelKey(label)===`question:${number}:`))return targets[0];
}

// A collision within any model makes the key unsafe to align.
export function alignScoringItems(...lists) {
  const aliases=new Map();
  // A bare question label can match its description only when each source has one item for that question.
  for(const list of lists)for(const item of list) {
    const number=questionKey(item.label);
    if(!number || item.id || scoringLabelKey(item.label)!==`question:${number}:`)continue;
    const grouped=lists.map(source=>source.filter(entry=>questionKey(entry.label)===number));
    if(grouped.every(source=>source.length<=1) && grouped.flat().every(entry=>!entry.id))
      for(const entry of grouped.flat())aliases.set(itemKey(entry),`question:${number}:`);
  }
  const alignedKey=item=>aliases.get(itemKey(item)) || itemKey(item);
  const counts = lists.map(list => {
    const map = new Map();
    for (const item of list) {
      const key = alignedKey(item);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  });
  const rows = new Map();
  lists.forEach((list, source) => list.forEach((item, index) => {
    const key = alignedKey(item);
    const ambiguous = counts.some(count => (count.get(key) || 0) > 1);
    const rowKey = ambiguous ? `${source}:${index}:${key}` : key;
    if (!rows.has(rowKey)) rows.set(rowKey, { label: item.label, items: Array(lists.length).fill(undefined), ambiguous });
    rows.get(rowKey).items[source] = item;
  }));
  return [...rows.values()];
}

export function sameScoringItems(first, second) {
  return first.length === second.length && alignScoringItems(first, second).every(row =>
    !row.ambiguous && row.items[0] && row.items[1] && row.items[0].score === row.items[1].score &&
    row.items[0].maxScore === row.items[1].maxScore);
}

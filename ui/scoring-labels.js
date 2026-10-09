// Normalize explicit question numbering, retaining all meaningful suffix text.
export function scoringLabelKey(label) {
  const text = String(label ?? '').trim()
    .replace(/^[①-⑳]\s*(?=(?:第\s*)?[（(]\s*\d+\s*[）)]|第\s*\d+\s*问)/u, '')
    .normalize('NFKC').trim()
    // Strip an outer list index only when an explicit inner question remains.
    .replace(/^\(\s*\d+\s*\)\s*(?=第\s*(?:\(\s*\d+\s*\)|\d+\s*问))/u, '');
  const question = text.match(/^(?:第\s*)?\(\s*(\d+)\s*\)\s*(?:问\s*)?(.*)$/u) || text.match(/^第\s*(\d+)\s*问\s*(.*)$/u);
  return question ? `question:${question[1]}:${question[2].replace(/\s+/gu, '')}` : `literal:${text}`;
}

// A collision within any model makes the key unsafe to align.
export function alignScoringItems(...lists) {
  const counts = lists.map(list => {
    const map = new Map();
    for (const item of list) {
      const key = scoringLabelKey(item.label);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  });
  const rows = new Map();
  lists.forEach((list, source) => list.forEach((item, index) => {
    const key = scoringLabelKey(item.label);
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

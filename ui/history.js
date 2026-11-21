import {renderResultDetails} from './result-details.js';

function wasArbitrated(record) {
  return record.result?.dualEval?.result === 'arbitration'
    || !!record.result?.recognitionArbitration
    || record.originalResult?.dualEval?.result === 'arbitration'
    || !!record.originalResult?.recognitionArbitration;
}

export function createHistoryUI({$, api, states, getPage, setPage, setSelectedRecord, renderImages}) {
  async function renderHistory() {
    const pageSize = Number($('historyPageSize').value) || 50;
    const params = new URLSearchParams({page: String(getPage()), pageSize: String(pageSize)});
    const stateFilter = $('historyFilter').value;
    const search = $('historySearch').value.trim();
    const arbitrated = $('arbitrationFilter').value === 'arbitration';
    if (stateFilter) params.set('state', stateFilter);
    if (search) params.set('search', search);
    if (arbitrated) params.set('arbitrated', '1');

    const [result, metrics] = await Promise.all([
      api('/api/history?' + params),
      api('/api/metrics').catch(() => null)
    ]);
    setPage(Math.min(result.page, result.totalPages));
    $('historyEmpty').hidden = !!result.total;
    $('historyEmpty').textContent = result.total ? '当前筛选没有匹配记录' : '还没有阅卷记录';
    $('historyCount').textContent = `共 ${result.total} 条`;
    const metricsEl = $('historyMetrics');
    if (metricsEl) {
      if (metrics && metrics.total > 0) {
        const parts = [`均分：${metrics.averageScore ?? '—'}`];
        if (metrics.submittedCount) parts.push(`已提交 ${metrics.submittedCount}/${metrics.total}`);
        if (metrics.dualEval?.total) parts.push(`仲裁 ${metrics.dualEval.arbitrated}/${metrics.dualEval.total}`);
        if (metrics.correctionCount) parts.push(`改分 ${metrics.correctionCount} 次`);
        if (metrics.usage?.totalTokens) parts.push(`Token ${metrics.usage.totalTokens}（缓存 ${(metrics.usage.cacheHitRate * 100).toFixed(0)}%）`);
        if (metrics.verification?.policyIssueCount || metrics.verification?.consistencyIssueCount) {
          parts.push(`核验告警 ${metrics.verification.policyIssueCount + metrics.verification.consistencyIssueCount}`);
        }
        metricsEl.textContent = parts.join(' · ');
        metricsEl.hidden = false;
      } else {
        metricsEl.textContent = '';
        metricsEl.hidden = true;
      }
    }
    $('historyPage').textContent = `第 ${result.page} / ${result.totalPages} 页`;
    $('historyPrev').disabled = result.page <= 1;
    $('historyNext').disabled = result.page >= result.totalPages;
    $('historyRows').replaceChildren(...result.items.map(renderRow));
  }

  function renderRow(record) {
    const row = document.createElement('tr');
    for (const value of [new Date(record.time).toLocaleString(), record.presetName, states[record.state] || record.state, record.result?.score ?? '—', record.submissionCode || '—']) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    if (wasArbitrated(record)) {
      row.classList.add('arbitration-row');
      const badge = document.createElement('span');
      badge.className = 'arbitration-badge';
      badge.textContent = '已仲裁';
      row.children[2].append(document.createTextNode(' '), badge);
    }
    const cell = document.createElement('td');
    const button = document.createElement('button');
    button.textContent = '查看';
    button.onclick = () => showRecord(record);
    cell.append(button);
    row.append(cell);
    return row;
  }

  function showRecord(record) {
    setSelectedRecord(record);
    $('historyDetail').hidden = false;
    renderImages($('historyImages'), record);
    $('historyJson').textContent = JSON.stringify(record, null, 2);
    renderResultDetails($('historyReadable'), record, true);
    for (const id of ['resolveYes', 'resolveNo']) $(id).hidden = !['uncertain', 'submitting'].includes(record.state);
    $('historyDialogTitle').textContent = wasArbitrated(record) ? '评阅详情 · 已仲裁' : '评阅详情';
    if(record.submissionCode) $('historyDialogTitle').textContent += ` · ${record.submissionCode}`;
    if (!$('historyDialog').open) $('historyDialog').showModal();
    $('historyDialog').scrollTop = 0;
  }

  return {renderHistory, showRecord};
}

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from '../src/store.mjs';
import { calculate } from '../src/domain.mjs';
import { auditGradingResult } from '../src/grading-policy-audit.mjs';
import { summarizeTaskMetrics } from '../src/task-metrics.mjs';
import { isMeaningfulCorrectionReason } from '../src/correction-feedback.mjs';
import { detectImageMime } from '../src/image-optimize.mjs';
import { grade } from '../src/models.mjs';
import { rubricGradingSettings, activeGradingMode, rubricSubjects, rubricPrompts } from '../ui/rubric-prompts.js';

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Normalize an exported history record or custom benchmark fixture into a unified evaluation entry.
 */
export function normalizeBenchmarkCase(item, index = 0) {
  const id = item?.id || `case-${index + 1}`;
  const presetName = item?.presetName || item?.preset || '默认方案';
  const result = item?.result || null;
  const originalResult = item?.originalResult || null;
  const corrected = Boolean(item?.correctionReason || item?.corrected || originalResult);

  const modelScore = finiteNumber(item?.modelScore)
    ?? finiteNumber(originalResult?.score)
    ?? finiteNumber(result?.rawScore)
    ?? finiteNumber(result?.score);

  const explicitHuman = finiteNumber(item?.expectedScore);
  const acceptedHuman = explicitHuman
    ?? (corrected ? finiteNumber(result?.score)
      : (item?.state === 'submitted' && item?.mode !== 'unattended' ? finiteNumber(result?.score) : undefined));

  return {
    id,
    presetName,
    config: item?.config || null,
    images: Array.isArray(item?.images) ? item.images : null,
    imageFiles: Array.isArray(item?.imageFiles) ? item.imageFiles : [],
    modelScore,
    humanScore: acceptedHuman,
    hasExplicitExpected: explicitHuman !== undefined,
    result,
    originalResult,
    correctionReason: item?.correctionReason || ''
  };
}

/**
 * Evaluate history records or benchmark cases for score agreement, policy compliance, and metrics.
 */
export function evaluateRecords(records = [], options = {}) {
  const rawList = Array.isArray(records) ? records : [];
  const filtered = options.preset
    ? rawList.filter(r => (r?.presetName || r?.preset) === options.preset)
    : rawList;

  const metrics = summarizeTaskMetrics(filtered);
  const cases = filtered.map((item, idx) => normalizeBenchmarkCase(item, idx));
  const hasExplicitDataset = cases.some(c => c.hasExplicitExpected);

  const paired = cases.filter(c => {
    if (hasExplicitDataset && !c.hasExplicitExpected) return false;
    return c.modelScore !== undefined && c.humanScore !== undefined;
  });

  let exactMatches = 0;
  let withinOneMatches = 0;
  let absErrorSum = 0;
  let signedErrorSum = 0;
  let maxAbsError = 0;
  const discrepancies = [];

  for (const c of paired) {
    const diff = Number((c.modelScore - c.humanScore).toFixed(4));
    const absDiff = Math.abs(diff);
    if (absDiff < 1e-8) exactMatches++;
    if (absDiff <= 1 + 1e-8) withinOneMatches++;
    absErrorSum += absDiff;
    signedErrorSum += diff;
    if (absDiff > maxAbsError) maxAbsError = absDiff;
    if (absDiff > 1e-8) {
      discrepancies.push({
        id: c.id,
        presetName: c.presetName,
        modelScore: c.modelScore,
        humanScore: c.humanScore,
        diff,
        correctionReason: c.correctionReason || undefined
      });
    }
  }

  discrepancies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || String(a.id).localeCompare(String(b.id)));

  let checkedCount = 0;
  let policyIssueRecords = 0;
  let consistencyIssueRecords = 0;
  const auditFindings = [];

  let retriedCount = 0;
  const byCase = new Map();
  const groupAcc = new Map();

  for (let i = 0; i < filtered.length; i++) {
    const item = filtered[i];
    const normalized = cases[i];
    const targetConfig = normalized.config || options.config || options.configsByPreset?.[normalized.presetName];
    const targetResult = item?.originalResult || item?.result;
    const retried = Boolean(
      targetResult?.policyVerification || targetResult?.totalVerification ||
      (targetResult?.usage?.calls || 0) > 1 ||
      (targetResult?.dualEval && (targetResult.dualEval.a?.usage?.calls > 1 || targetResult.dualEval.b?.usage?.calls > 1 || targetResult.dualEval.verdict?.usage?.calls > 1))
    );
    if (retried) retriedCount++;
    const caseId = item?.caseId || String(normalized.id).replace(/#\d+$/u, '');
    if (normalized.modelScore !== undefined) {
      const list = byCase.get(caseId) || [];
      list.push(normalized.modelScore);
      byCase.set(caseId, list);
    }
    const settings = targetConfig ? rubricGradingSettings(targetConfig.rubric, targetConfig.rubricGeneration, targetConfig.scoring?.strictness) : {};
    const subject = item?.subject || settings.subject || '';
    const mode = item?.gradingMode || (targetConfig ? activeGradingMode(targetConfig) : '');
    const key = `${subject}\0${mode}`;
    const g = groupAcc.get(key) || { subject, gradingMode: mode, count: 0, paired: 0, exact: 0, absErr: 0, retried: 0, arbitrated: 0 };
    g.count++;
    if (retried) g.retried++;
    if (targetResult?.dualEval?.result === 'arbitration') g.arbitrated++;
    if ((!hasExplicitDataset || normalized.hasExplicitExpected) && normalized.modelScore !== undefined && normalized.humanScore !== undefined) {
      g.paired++;
      const d = Math.abs(normalized.modelScore - normalized.humanScore);
      if (d < 1e-8) g.exact++;
      g.absErr += d;
    }
    groupAcc.set(key, g);
    if (!targetConfig || !targetResult) continue;
    checkedCount++;
    const audit = auditGradingResult(targetConfig, targetResult);
    if (audit.policyIssues.length) policyIssueRecords++;
    if (audit.consistencyIssues.length) consistencyIssueRecords++;
    if (audit.issues.length && auditFindings.length < 25) {
      auditFindings.push({
        id: normalized.id,
        presetName: normalized.presetName,
        policyIssues: audit.policyIssues,
        consistencyIssues: audit.consistencyIssues
      });
    }
  }

  const repeatedCases = [...byCase.values()].filter(scores => scores.length > 1);
  const stableCases = repeatedCases.filter(scores => scores.every(s => Math.abs(s - scores[0]) < 1e-8)).length;
  const groups = [...groupAcc.values()].map(g => ({
    subject: g.subject,
    subjectLabel: rubricSubjects[g.subject]?.label || '通用',
    gradingMode: g.gradingMode,
    modeLabel: rubricPrompts[g.gradingMode]?.label || g.gradingMode || '未标记',
    count: g.count,
    exactMatchRate: g.paired ? Number((g.exact / g.paired).toFixed(4)) : null,
    mae: g.paired ? Number((g.absErr / g.paired).toFixed(4)) : null,
    retryRate: g.count ? Number((g.retried / g.count).toFixed(4)) : null,
    arbitrationRate: g.count ? Number((g.arbitrated / g.count).toFixed(4)) : null
  }));

  return {
    preset: options.preset || null,
    totalRecords: filtered.length,
    comparisonSource: hasExplicitDataset ? 'explicit-expected' : 'reviewed-history',
    metrics,
    retries: {
      retriedCount,
      retryRate: filtered.length ? Number((retriedCount / filtered.length).toFixed(4)) : null
    },
    stability: repeatedCases.length ? {
      cases: repeatedCases.length,
      stableCases,
      identicalScoreRate: Number((stableCases / repeatedCases.length).toFixed(4))
    } : null,
    groups,
    accuracy: {
      count: paired.length,
      exactMatches,
      exactMatchRate: paired.length ? Number((exactMatches / paired.length).toFixed(4)) : null,
      withinOneMatches,
      withinOneRate: paired.length ? Number((withinOneMatches / paired.length).toFixed(4)) : null,
      mae: paired.length ? Number((absErrorSum / paired.length).toFixed(4)) : null,
      bias: paired.length ? Number((signedErrorSum / paired.length).toFixed(4)) : null,
      maxAbsError: paired.length ? Number(maxAbsError.toFixed(4)) : null
    },
    offlineAudit: {
      checkedCount,
      policyIssueRecords,
      consistencyIssueRecords,
      findings: auditFindings
    },
    topDiscrepancies: discrepancies.slice(0, 15)
  };
}

function loadImagesForReplay(item, baseDir = '') {
  if (Array.isArray(item?.images) && item.images.length) return item.images;
  const files = Array.isArray(item?.imageFiles) ? item.imageFiles : [];
  const loaded = [];
  for (const entry of files) {
    if (!entry) continue;
    const file = baseDir && !path.isAbsolute(entry) ? path.join(baseDir, entry) : entry;
    if (!fs.existsSync(file)) continue;
    const buffer = fs.readFileSync(file);
    loaded.push(`data:${detectImageMime(buffer)};base64,${buffer.toString('base64')}`);
  }
  return loaded;
}

/**
 * Re-run model grading offline over stored or fixture cases with a preset or custom config.
 * With repeat > 1 every case is graded several times to measure score stability.
 */
export async function replayBenchmark({
  records = [],
  settings = {},
  config = null,
  gradeFn = grade,
  limit = 10,
  repeat = 1,
  preset = '',
  baseDir = '',
  signal,
  onCase
} = {}) {
  const source = preset
    ? (Array.isArray(records) ? records : []).filter(r => (r?.presetName || r?.preset) === preset)
    : (Array.isArray(records) ? records : []);
  const selected = Number.isFinite(limit) && limit > 0 ? source.slice(0, limit) : source;
  const runs = Number.isInteger(repeat) && repeat > 0 ? repeat : 1;
  const replayed = [];

  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    const presetName = item?.presetName || item?.preset || preset || settings?.active || '默认方案';
    const targetConfig = config || item?.config || settings?.presets?.[presetName];
    if (!targetConfig) {
      throw Error(`回放用例 ${item?.id || i + 1} 缺少可用评分配置（preset=${presetName}）`);
    }
    const images = loadImagesForReplay(item, baseDir);
    if (!images.length) throw Error(`回放用例 ${item?.id || i + 1} 没有可读取的答卷图片`);
    const expectedScore = finiteNumber(item?.expectedScore)
      ?? (Boolean(item?.originalResult || item?.corrected || isMeaningfulCorrectionReason(item?.correctionReason) || item?.state === 'submitted')
        ? finiteNumber(item?.result?.score)
        : undefined);
    const baseId = item?.id || `replay-${i + 1}`;
    for (let run = 0; run < runs; run++) {
      const rawResult = await gradeFn(targetConfig, settings, images, signal);
      const computed = targetConfig.scoring ? calculate(rawResult, targetConfig) : rawResult;
      replayed.push({
        id: runs > 1 ? `${baseId}#${run + 1}` : baseId,
        caseId: baseId,
        presetName,
        state: 'submitted',
        config: targetConfig,
        result: computed,
        expectedScore,
        correctionReason: item?.correctionReason || ''
      });
      onCase?.({ index: i, run, id: baseId, score: computed?.score, expectedScore });
    }
  }

  return evaluateRecords(replayed, {
    preset: preset || undefined,
    config,
    configsByPreset: settings?.presets
  });
}

function pct(rate) {
  return rate === null || rate === undefined ? '—' : `${(rate * 100).toFixed(1)}%`;
}

/**
 * Render a human-readable Markdown benchmark report from evaluateRecords output.
 */
export function formatBenchmarkReport(report) {
  const { metrics, accuracy, offlineAudit, topDiscrepancies } = report;
  const lines = [
    `# 阅卷离线基准评估报告${report.preset ? `（${report.preset}）` : ''}`,
    '',
    `- 记录总数：${report.totalRecords}（已评分 ${metrics.scoredCount}，已提交 ${metrics.submittedCount}，待确认 ${metrics.pendingReviewCount}，已暂停 ${metrics.pausedCount}）`,
    `- 平均分：${metrics.averageScore ?? '—'} · 人工改分率：${pct(metrics.correctionRate)}（有效原因 ${metrics.meaningfulCorrectionCount}/${metrics.correctionCount}）`,
    `- 双评仲裁：${metrics.dualEval.arbitrated}/${metrics.dualEval.total}（仲裁率 ${pct(metrics.dualEval.arbitrationRate)}） · 识别存疑：${metrics.recognition.uncertainCount}`,
    `- Token 用量：共 ${metrics.usage.totalTokens}（缓存命中率 ${pct(metrics.usage.cacheHitRate)}，均份 ${metrics.usage.avgTokensPerRecord}，统计覆盖 ${metrics.usage.trackedRecords} 条）`,
    `- 在线核验统计：规则疑点 ${metrics.verification.gradingIssueCount}，口径冲突 ${metrics.verification.policyIssueCount}，文分一致性 ${metrics.verification.consistencyIssueCount}，警告 ${metrics.verification.formatWarningCount}`
  ];

  if (report.retries) {
    lines.push(`- 校验重试：${report.retries.retriedCount}/${report.totalRecords}（重试率 ${pct(report.retries.retryRate)}）` +
      (report.stability ? ` · 多次复评同分率：${pct(report.stability.identicalScoreRate)}（${report.stability.stableCases}/${report.stability.cases}）` : ''));
  }

  if (accuracy.count > 0) {
    lines.push(
      '',
      `## 分数一致性（对比样本 ${accuracy.count} 份，来源：${report.comparisonSource === 'explicit-expected' ? '标注基准分' : '人工复核与改分记录'}）`,
      `- 完全一致率：${pct(accuracy.exactMatchRate)}（${accuracy.exactMatches}/${accuracy.count}）`,
      `- 误差 <= 1 分：${pct(accuracy.withinOneRate)}（${accuracy.withinOneMatches}/${accuracy.count}）`,
      `- MAE：${accuracy.mae} · 偏差 Bias(模型-人工)：${accuracy.bias} · 最大绝对误差：${accuracy.maxAbsError}`
    );
  }

  if (report.groups?.length > 1) {
    lines.push('', '## 按学科 × 口径分项', '| 学科 | 口径 | 样本 | 完全一致率 | MAE | 重试率 | 仲裁率 |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |');
    for (const g of report.groups) {
      lines.push(`| ${g.subjectLabel} | ${g.modeLabel} | ${g.count} | ${pct(g.exactMatchRate)} | ${g.mae ?? '—'} | ${pct(g.retryRate)} | ${pct(g.arbitrationRate)} |`);
    }
  }

  if (report.comparison) {
    const c = report.comparison;
    const signed = n => n === null || n === undefined ? '—' : n > 0 ? `+${n}` : `${n}`;
    lines.push('', '## 与基线对比（当前 − 基线）',
      `- 完全一致率变化：${signed(c.exactMatchRateDelta)} · MAE 变化：${signed(c.maeDelta)}`,
      `- 重试率变化：${signed(c.retryRateDelta)} · 仲裁率变化：${signed(c.arbitrationRateDelta)} · 均份 Token 变化：${signed(c.avgTokensDelta)}`);
  }

  if (offlineAudit.checkedCount > 0) {
    lines.push(
      '',
      `## 离线口径/一致性审计（核查 ${offlineAudit.checkedCount} 份）`,
      `- 发现口径冲突：${offlineAudit.policyIssueRecords} 份`,
      `- 发现文分不一致：${offlineAudit.consistencyIssueRecords} 份`
    );
  }

  if (topDiscrepancies.length > 0) {
    lines.push('', '## 分差较大样本', '| 记录 ID | 方案 | 模型分 | 人工/期望分 | 差值 | 改分原因 |', '| --- | --- | ---: | ---: | ---: | --- |');
    for (const item of topDiscrepancies) {
      lines.push(`| ${item.id} | ${item.presetName} | ${item.modelScore} | ${item.humanScore} | ${item.diff > 0 ? `+${item.diff}` : item.diff} | ${(item.correctionReason || '—').replace(/\|/g, '\\|')} |`);
    }
  }
  return lines.join('\n') + '\n';
}

export function compareBenchmarkReports(baseline, current) {
  const delta = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? Number((b - a).toFixed(4)) : null;
  return {
    exactMatchRateDelta: delta(baseline?.accuracy?.exactMatchRate, current?.accuracy?.exactMatchRate),
    maeDelta: delta(baseline?.accuracy?.mae, current?.accuracy?.mae),
    retryRateDelta: delta(baseline?.retries?.retryRate, current?.retries?.retryRate),
    arbitrationRateDelta: delta(baseline?.metrics?.dualEval?.arbitrationRate, current?.metrics?.dualEval?.arbitrationRate),
    avgTokensDelta: delta(baseline?.metrics?.usage?.avgTokensPerRecord, current?.metrics?.usage?.avgTokensPerRecord)
  };
}

function parseCliArgs(argv) {
  const args = { json: false, replay: false, limit: 10, repeat: 1 };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') args.help = true;
    else if (token === '--json') args.json = true;
    else if (token === '--replay') args.replay = true;
    else if (token === '--input') args.input = argv[++i];
    else if (token === '--db') args.db = argv[++i];
    else if (token === '--preset') args.preset = argv[++i];
    else if (token === '--config') args.config = argv[++i];
    else if (token === '--out') args.out = argv[++i];
    else if (token === '--limit') args.limit = Number(argv[++i]);
    else if (token === '--repeat') args.repeat = Number(argv[++i]);
    else if (token === '--compare') args.compare = argv[++i];
    else throw Error(`未知参数: ${token}`);
  }
  return args;
}

function loadInputRecords(args) {
  if (args.input) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.records)) return raw.records;
    if (Array.isArray(raw?.cases)) return raw.cases;
    throw Error('输入 JSON 必须是记录数组，或包含 records / cases 数组');
  }
  if (args.db) {
    const target = path.resolve(args.db);
    const dir = fs.existsSync(target) && fs.statSync(target).isFile() ? path.dirname(target) : target;
    const store = new Store(dir);
    try { return store.records(); } finally { store.close(); }
  }
  throw Error('请指定 --input <records.json> 或 --db <data-dir|history.sqlite>');
}

function loadConfigFile(configPath) {
  if (!configPath) return { settings: {}, configsByPreset: {} };
  const parsed = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
  if (parsed?.presets) return { settings: parsed, configsByPreset: parsed.presets };
  if (parsed?.rubric || parsed?.scoring) return { settings: {}, config: parsed, configsByPreset: {} };
  return { settings: {}, configsByPreset: parsed || {} };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    console.log('用法: node scripts/eval-benchmark.mjs (--input <file.json> | --db <dir>) [--config <config.json>] [--preset <name>] [--replay] [--limit 10] [--repeat 1] [--compare <baseline.json>] [--json] [--out <file>]');
    return 0;
  }
  const records = loadInputRecords(args);
  const loadedCfg = loadConfigFile(args.config);
  const baseDir = args.input ? path.dirname(path.resolve(args.input)) : '';
  const report = args.replay
    ? await replayBenchmark({
        records,
        settings: loadedCfg.settings,
        config: loadedCfg.config,
        limit: args.limit,
        repeat: args.repeat,
        preset: args.preset,
        baseDir
      })
    : evaluateRecords(records, {
        preset: args.preset,
        config: loadedCfg.config,
        configsByPreset: loadedCfg.configsByPreset
      });
  if (args.compare) {
    const baseline = JSON.parse(fs.readFileSync(path.resolve(args.compare), 'utf8'));
    report.comparison = compareBenchmarkReports(baseline, report);
  }
  const output = args.json ? JSON.stringify(report, null, 2) + '\n' : formatBenchmarkReport(report);
  if (args.out) fs.writeFileSync(path.resolve(args.out), output, 'utf8');
  else process.stdout.write(output);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }).catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

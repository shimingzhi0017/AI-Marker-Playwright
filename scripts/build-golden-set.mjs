import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Store } from '../src/store.mjs';
import { isMeaningfulCorrectionReason } from '../src/correction-feedback.mjs';
import { rubricGradingSettings, activeGradingMode } from '../ui/rubric-prompts.js';

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Teacher-confirmed score for a history record, or undefined when the score
 * was never reviewed by a person (unattended submissions are not ground truth).
 */
export function confirmedScore(record) {
  const corrected = Boolean(record?.originalResult || isMeaningfulCorrectionReason(record?.correctionReason));
  if (corrected) return finiteNumber(record?.result?.score);
  if (record?.state === 'submitted' && record?.mode !== 'unattended') return finiteNumber(record?.result?.score);
  return undefined;
}

export function configHash(config) {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

/**
 * Select confirmed records and freeze them, together with the exact preset
 * config and answer images, into a portable golden set that does not change
 * when the live history or presets are edited later.
 */
export function buildGoldenSet({ records, presets, outDir, preset = '', limit = 0, allowConfigDrift = false }) {
  const stats = { scanned: 0, unconfirmed: 0, missingConfig: 0, configDrift: 0, missingImages: 0, exported: 0 };
  const cases = [];
  fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
  for (const record of records) {
    if (limit > 0 && cases.length >= limit) break;
    if (preset && record?.presetName !== preset) continue;
    stats.scanned++;
    const expectedScore = confirmedScore(record);
    if (expectedScore === undefined) { stats.unconfirmed++; continue; }
    const config = presets?.[record.presetName];
    if (!config) { stats.missingConfig++; continue; }
    if (record.configHash && record.configHash !== configHash(config) && !allowConfigDrift) { stats.configDrift++; continue; }
    const sources = (record.imageFiles || []).filter(file => file && fs.existsSync(file));
    if (!sources.length || sources.length !== (record.imageFiles || []).length) { stats.missingImages++; continue; }
    const imageFiles = sources.map((file, index) => {
      const relative = path.join('images', record.id, `${index}.bin`);
      fs.mkdirSync(path.join(outDir, 'images', record.id), { recursive: true });
      fs.copyFileSync(file, path.join(outDir, relative));
      return relative.split(path.sep).join('/');
    });
    const settings = rubricGradingSettings(config.rubric, config.rubricGeneration, config.scoring?.strictness);
    cases.push({
      id: record.id,
      presetName: record.presetName,
      subject: settings.subject || '',
      gradingMode: activeGradingMode(config),
      config,
      imageFiles,
      expectedScore,
      modelScore: finiteNumber(record.originalResult?.score) ?? finiteNumber(record.result?.rawScore) ?? finiteNumber(record.result?.score),
      correctionReason: record.correctionReason || ''
    });
    stats.exported++;
  }
  const golden = { version: 1, createdAt: new Date().toISOString(), cases };
  fs.writeFileSync(path.join(outDir, 'golden.json'), JSON.stringify(golden, null, 2));
  return { file: path.join(outDir, 'golden.json'), stats };
}

function parseArgs(argv) {
  const args = { limit: 0, allowConfigDrift: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') args.help = true;
    else if (token === '--db') args.db = argv[++i];
    else if (token === '--config') args.config = argv[++i];
    else if (token === '--out') args.out = argv[++i];
    else if (token === '--preset') args.preset = argv[++i];
    else if (token === '--limit') args.limit = Number(argv[++i]);
    else if (token === '--allow-config-drift') args.allowConfigDrift = true;
    else throw Error(`未知参数: ${token}`);
  }
  return args;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.db || !args.config || !args.out) {
    console.log('用法: node scripts/build-golden-set.mjs --db <data目录> --config <config.json> --out <输出目录> [--preset 方案名] [--limit N] [--allow-config-drift]\n仅导出教师确认过分数的记录（人工改分或人工提交），并冻结当时的评分方案与答卷图片。');
    return args.help ? 0 : 1;
  }
  const settings = JSON.parse(fs.readFileSync(path.resolve(args.config), 'utf8'));
  const target = path.resolve(args.db);
  const dir = fs.existsSync(target) && fs.statSync(target).isFile() ? path.dirname(target) : target;
  const store = new Store(dir);
  let records;
  try { records = store.records(); } finally { store.close(); }
  const { file, stats } = buildGoldenSet({ records, presets: settings.presets, outDir: path.resolve(args.out), preset: args.preset, limit: args.limit, allowConfigDrift: args.allowConfigDrift });
  console.log(`已导出 ${stats.exported} 份到 ${file}`);
  console.log(`扫描 ${stats.scanned}：未经教师确认 ${stats.unconfirmed}，方案缺失 ${stats.missingConfig}，方案已改动 ${stats.configDrift}，图片缺失 ${stats.missingImages}`);
  if (stats.configDrift) console.log('提示：方案改动后的记录默认跳过（当时阅卷所用标准已不同）；确需纳入可加 --allow-config-drift。');
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

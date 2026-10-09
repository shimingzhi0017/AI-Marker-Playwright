import crypto from 'node:crypto';
import { validateConfig, calculate } from './domain.mjs';
import { grade } from './models.mjs';
import { detectBlank, blankReferenceWarning } from './blank.mjs';

export class Runner {
  constructor(platform, store, settings, review, modelGrade = grade, coordinator) {
    Object.assign(this, { platform, store, settings, review, modelGrade, coordinator }); this.controller = new AbortController(); this.count = 0;
  }
  pause() { this.controller.abort(Error('用户暂停')); }
  async run() {
    const signal = this.controller.signal;
    let previous, record, release;
    try {
      if (this.store.records().some(r => r.state === 'submitting' || r.state === 'uncertain')) throw Error('存在提交状态不明的历史记录；先人工核对，不自动重交');
      while (!signal.aborted) {
        const snapshot = await this.platform.ready(previous, signal);
        if (!snapshot) { this.store.log('completed'); return { count: this.count, reason: '平台明确显示任务完成' }; }
        const presetName = this.settings.taskScopedConfig ? this.settings.active : this.settings.bindings?.[snapshot.taskId] || this.settings.active;
        if (previous && previous.taskId !== snapshot.taskId && (this.settings.taskScopedConfig || !this.settings.bindings?.[snapshot.taskId])) throw Error('任务已切换，尚未绑定适用方案，已暂停');
        const config = structuredClone(this.settings.presets[presetName]);
        if (!config) throw Error('当前任务没有适用方案');
        validateConfig(config);
        if (config.scoring?.units?.length && config.scoring.units.length !== snapshot.units.length) throw Error('方案评分单元与页面不一致');
        if (this.store.records().some(r => r.identity === snapshot.identity && r.state === 'submitted')) throw Error('当前答卷已提交过，禁止重复处理');
        release?.(); release = this.coordinator?.acquire(snapshot.identity, this.store);
        record = { id: crypto.randomUUID(), identity: snapshot.identity, taskId: snapshot.taskId, presetName, configHash: crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex'), snapshot, mode: this.settings.mode || 'trial', state: 'loading', time: new Date().toISOString() };
        this.store.save(record); this.store.log('loading', { id: record.id });
        const images = await this.platform.images(snapshot, signal);
        record.imageFiles = await this.store.images(record.id, images);
        record.imageHashes = images.map(i => i.hash); record.state = 'grading'; this.store.save(record);
        let result;
        if (config.blankDetection?.enabled) {
          const warning = blankReferenceWarning(config.blankDetection.reference, images.length, config.blankDetection.threshold);
          if (warning) {
            record.blankDetection = { isBlank: false, skipped: true, warning };
            this.store.log('blank-detection-skipped', { id: record.id, warning });
          } else record.blankDetection = await detectBlank(images, config.blankDetection.reference, config.blankDetection.threshold);
        }
        if (record.blankDetection?.isBlank) result = { score: 0, studentAnswer: '', comment: '范本空白检测：请确认', subScores: (config.scoring?.units || []).map(u => ({ label: u.label, score: 0 })) };
        else result = await this.modelGrade(config, this.settings, images.map(i => i.data), signal);
        signal.throwIfAborted();
        record.result = calculate(result, config); record.state = 'review'; this.store.save(record);
        const decision = await this.review(record, record.blankDetection?.isBlank || record.blankDetection?.skipped || record.result.formatWarning || record.result.recognitionWarning ? 'trial' : this.settings.mode || 'trial');
        signal.throwIfAborted();
        if (decision === 'stop') { record.state = 'paused'; this.store.save(record); return { count: this.count, reason: '用户停止，评分已保存' }; }
        const scores = record.result.subScores.length ? record.result.subScores.map(s => s.score) : [record.result.score];
        await this.platform.fill(snapshot, scores);
        signal.throwIfAborted();
        if (decision === 'fill') { record.state = 'filled'; this.store.save(record); return { count: this.count, reason: '已填分，等待用户在网站提交' }; }
        const manualTest = this.platform.options?.manualSubmissionTest && this.settings.mode === 'trial' && Number.isInteger(this.settings.batchLimit) && this.settings.batchLimit >= 0 && !!snapshot.networkTopic;
        if ((!this.platform.options?.verified && !manualTest) || !snapshot.strongIdentity || !this.platform.options.submitResponseUrlPattern) throw Error('尚未实测答卷标识和提交响应；已保存评分，请先使用只填分模式');
        record.state = 'submitting'; this.store.save(record);
        record.receipt = await this.platform.submit(snapshot, scores, { manualTest });
        record.state = 'submitted'; this.store.save(record);
        this.count++; this.store.log('submitted', { id: record.id, count: this.count });
        previous = snapshot;
        if (this.settings.batchLimit && this.count >= this.settings.batchLimit) return { count: this.count, reason: '达到本次批阅数量限制' };
      }
    } catch (error) {
      if (record && error.modelResponse) record.modelResponse = error.modelResponse;
      if (record) { record.state = record.state === 'submitting' ? 'uncertain' : record.state === 'submitted' ? 'submitted' : 'paused'; record.error = error.message; this.store.save(record); }
      this.store.log('paused', { reason: error.message });
      await this.platform.diagnostic(error.message);
      return { count: this.count, reason: error.message, paused: true };
    } finally { release?.(); }
  }
}

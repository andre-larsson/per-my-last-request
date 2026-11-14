// A first download can be 1.7 GB, so loading has no total time limit. It fails only after this long with no progress.
export const LOAD_SILENCE_MS = 5 * 60 * 1000;
const DECISION_LIMIT_MS = 3 * 60 * 1000;

export class LocalModel {
  constructor(onProgress) { this.onProgress = onProgress; this.pending = new Map(); this.sequence = 0; this.ready = false; }
  ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        // A download that is still reporting progress is not stuck, however slow the connection.
        for (const job of this.pending.values()) job.extend?.();
        this.onProgress(data.report);
        return;
      }
      const job = this.pending.get(data.id);
      if (!job) return;
      clearTimeout(job.timeout);
      this.pending.delete(data.id);
      if (data.type === 'error') job.reject(new Error(data.error)); else job.resolve(data.result);
    };
    this.worker.onerror = event => { event.preventDefault(); this.dispose(event.message || 'The model worker stopped.'); };
  }
  /** `timeoutMs` is a hard limit, unless `untilSilent` makes it a limit on time without a progress report. */
  request(type, payload, timeoutMs, { untilSilent = false, message = 'The model took too long. Reload it and retry.' } = {}) {
    this.ensureWorker();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const job = { resolve, reject };
      const arm = () => { clearTimeout(job.timeout); job.timeout = setTimeout(() => this.dispose(message), timeoutMs); };
      if (untilSilent) job.extend = arm;
      arm();
      this.pending.set(id, job);
      this.worker.postMessage({ id, type, payload });
    });
  }
  async load(model) {
    if (!model.startsWith('cpu:') && (!navigator.gpu || !(await navigator.gpu.requestAdapter()))) throw new Error('WebGPU is not available in this browser. Select the CPU model instead.');
    await this.request('load', { model }, LOAD_SILENCE_MS, { untilSilent: true, message: 'The model stopped making progress for 5 minutes. Check the connection, then load it again.' });
    this.ready = true;
    this.model = model;
  }
  decide(payload) { return this.request('decide', payload, DECISION_LIMIT_MS); }
  /** Tokens in `text` by the loaded model's tokenizer. Unlike other requests, a slow or failed count leaves the model loaded. */
  countTokens(text) {
    if (!this.ready || !this.worker) return Promise.reject(new Error('No model is loaded.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const job = { resolve: result => resolve(result.tokens), reject };
      job.timeout = setTimeout(() => { this.pending.delete(id); reject(new Error('Counting tokens took too long.')); }, 5000);
      this.pending.set(id, job);
      this.worker.postMessage({ id, type: 'count', payload: { text } });
    });
  }
  dispose(message = 'Model unloaded.') {
    this.ready = false;
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.pending.values()) { clearTimeout(job.timeout); job.reject(new Error(message)); }
    this.pending.clear();
  }
}

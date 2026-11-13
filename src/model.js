export class LocalModel {
  constructor(onProgress) { this.onProgress = onProgress; this.pending = new Map(); this.sequence = 0; this.ready = false; }
  ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { this.onProgress(data.report); return; }
      const job = this.pending.get(data.id);
      if (!job) return;
      clearTimeout(job.timeout);
      this.pending.delete(data.id);
      if (data.type === 'error') job.reject(new Error(data.error)); else job.resolve(data.result);
    };
    this.worker.onerror = event => { event.preventDefault(); this.dispose(event.message || 'The model worker stopped.'); };
  }
  request(type, payload, timeoutMs) {
    this.ensureWorker();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.dispose('The model took too long. Reload it and retry.'), timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ id, type, payload });
    });
  }
  async load(model) {
    if (!model.startsWith('cpu:') && (!navigator.gpu || !(await navigator.gpu.requestAdapter()))) throw new Error('WebGPU is not available in this browser. Select the CPU model, or inspect the game in Manual sandbox.');
    await this.request('load', { model }, 15 * 60 * 1000);
    this.ready = true;
    this.model = model;
  }
  decide(payload) { return this.request('decide', payload, 180000); }
  dispose(message = 'Model unloaded.') {
    this.ready = false;
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.pending.values()) { clearTimeout(job.timeout); job.reject(new Error(message)); }
    this.pending.clear();
  }
}

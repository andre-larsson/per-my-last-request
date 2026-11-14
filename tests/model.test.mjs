import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalModel, LOAD_SILENCE_MS } from '../src/model.js';

// A stand-in for the model worker: the test decides when it reports progress or finishes.
class FakeWorker {
  static last = null;
  constructor() { FakeWorker.last = this; this.posted = []; this.terminated = false; }
  postMessage(message) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  say(data) { this.onmessage({ data }); }
}

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.Worker = FakeWorker;
  t.after(() => { delete globalThis.Worker; });
  const reports = [];
  return { model: new LocalModel(report => reports.push(report)), reports };
}
const settled = promise => { const state = { done: false, error: null }; promise.then(() => { state.done = true; }, error => { state.done = true; state.error = error; }); return state; };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('a slow model download keeps loading for as long as it reports progress', async t => {
  const { model, reports } = setup(t);
  const load = settled(model.load('cpu:test'));
  await flush();
  const worker = FakeWorker.last;
  // Two hours of download, with a progress report every four minutes.
  for (let i = 1; i <= 30; i++) {
    t.mock.timers.tick(4 * 60 * 1000);
    worker.say({ type: 'progress', report: { progress: i / 30, text: 'Fetching' } });
  }
  await flush();
  assert.equal(load.done, false, 'still loading');
  assert.equal(worker.terminated, false);
  assert.equal(reports.length, 30);
  worker.say({ type: 'done', id: worker.posted[0].id, result: null });
  await flush();
  assert.equal(load.error, null);
  assert.equal(model.ready, true);
});

test('a model load that goes silent fails with a clear message and frees the worker', async t => {
  const { model } = setup(t);
  const load = settled(model.load('cpu:test'));
  await flush();
  const worker = FakeWorker.last;
  worker.say({ type: 'progress', report: { progress: 0.5, text: 'Fetching' } });
  t.mock.timers.tick(LOAD_SILENCE_MS - 1);
  await flush();
  assert.equal(load.done, false);
  t.mock.timers.tick(1);
  await flush();
  assert.match(load.error.message, /stopped making progress/);
  assert.equal(worker.terminated, true);
  assert.equal(model.ready, false);
});

test('a decision keeps a hard time limit: progress reports do not extend it', async t => {
  const { model } = setup(t);
  const decision = settled(model.decide({}));
  await flush();
  const worker = FakeWorker.last;
  t.mock.timers.tick(2 * 60 * 1000);
  worker.say({ type: 'progress', report: { progress: 1, text: 'Busy' } });
  t.mock.timers.tick(60 * 1000);
  await flush();
  assert.match(decision.error.message, /took too long/);
  assert.equal(worker.terminated, true);
});

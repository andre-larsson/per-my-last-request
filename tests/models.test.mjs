import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, DEFAULT_MODEL, checkDevice, recommendModel, selectedModelAdvice } from '../src/models.js';

const hardware = { gpu: true, cpu: true, software: false, reason: 'Adapter detected.', limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 30 } };
const cpuId = MODELS.find(model => model.backend === 'CPU').id;

test('unknown VRAM recommends the tested baseline without claiming it fits', () => {
  const result = recommendModel(hardware);
  assert.equal(result.model.id, DEFAULT_MODEL);
  assert.match(result.reason, /memory is unknown/);
  assert.match(result.reason, /fit is unverified/);
  assert.equal(recommendModel({ ...hardware, name: 'RTX 4090 24 GB' }).model.id, DEFAULT_MODEL);
  assert.equal(recommendModel(hardware, NaN).model.id, DEFAULT_MODEL);
});
test('player-supplied memory budgets reserve headroom and offer larger candidates', () => {
  for (const [memory, fragment] of [[2, '0.5B'], [4, '3B'], [6, '3B'], [8, '7B'], [12, 'Qwen3-8B'], [24, 'Qwen3-8B']]) {
    const result = recommendModel(hardware, memory);
    assert.ok(result.model.id.includes(fragment), `${memory} GB: ${result.model.id}`);
    assert.ok(result.model.memoryGB <= memory * 0.8);
  }
  assert.equal(recommendModel(hardware, 1).model.id, cpuId);
});
test('missing or software WebGPU never recommends a larger GPU model', () => {
  for (const device of [{ ...hardware, gpu: false }, { ...hardware, software: true }]) {
    assert.equal(recommendModel(device, 24).model.id, cpuId);
    assert.equal(recommendModel({ ...device, cpu: false }, 24).model, null);
  }
});
test('a fallback names the Manual sandbox only where the page offers it', () => {
  const noGpu = { ...hardware, gpu: false };
  assert.match(recommendModel(noGpu).reason, /Manual sandbox/);
  assert.match(recommendModel({ ...noGpu, cpu: false }).reason, /Manual sandbox/);
  // The published site: no sandbox to point to.
  for (const device of [noGpu, { ...noGpu, cpu: false }, { ...hardware, software: true }]) assert.doesNotMatch(recommendModel(device, null, { manual: false }).reason, /manual/i);
  assert.match(recommendModel(noGpu, null, { manual: false }).reason, /CPU model/);
  assert.match(recommendModel({ ...noGpu, cpu: false }, null, { manual: false }).reason, /cannot run a local model/);
  for (const model of MODELS) assert.doesNotMatch(model.note, /manual/i, 'Model notes show on the published site too');
});
test('per-buffer limits reduce candidates but are never treated as total VRAM', () => {
  const limited = { ...hardware, limits: { maxBufferSize: 256 * 2 ** 20, maxStorageBufferBindingSize: 128 * 2 ** 20 } };
  assert.match(recommendModel(limited, 24).model.id, /1.5B/);
  assert.match(recommendModel(limited).model.id, /1.5B/);
  assert.equal(recommendModel({ ...hardware, limits: { maxBufferSize: 128 * 2 ** 20, maxStorageBufferBindingSize: 128 * 2 ** 20 } }, 24).model.id, cpuId);
});
test('device check handles unavailable, refused, insecure, failed and stalled adapters', async () => {
  const options = { secure: true, cpu: true };
  assert.equal((await checkDevice({ ...options, gpu: null })).gpu, false);
  assert.match((await checkDevice({ ...options, gpu: {}, secure: false })).reason, /HTTPS or localhost/);
  assert.match((await checkDevice({ ...options, gpu: { requestAdapter: async () => null } })).reason, /could not provide/);
  assert.match((await checkDevice({ ...options, gpu: { requestAdapter: async () => { throw new Error('blocked'); } } })).reason, /blocked/);
  assert.match((await checkDevice({ ...options, gpu: { requestAdapter: () => new Promise(() => {}) }, timeoutMs: 5 })).reason, /timed out/);
});
test('device check reads adapter info and retains only serializable capability data', async () => {
  let requested;
  const result = await checkDevice({ secure: true, cpu: true, gpu: { requestAdapter: async options => {
    requested = options;
    return { info: { vendor: 'nvidia', architecture: 'lovelace', isFallbackAdapter: false }, limits: hardware.limits };
  } } });
  assert.equal(requested, undefined, 'Use the same adapter preference as the inference runtime');
  assert.equal(result.gpu, true);
  assert.equal(result.software, false);
  assert.equal(result.name, 'nvidia · lovelace');
  assert.deepEqual(structuredClone(result), result);
  const fallback = await checkDevice({ secure: true, cpu: true, gpu: { requestAdapter: async () => ({ info: { description: 'SwiftShader' }, limits: hardware.limits }) } });
  assert.equal(fallback.software, true);
});
test('a transient startup refusal is retried before recommending the CPU', async () => {
  let attempts = 0;
  const result = await checkDevice({ secure: true, cpu: true, gpu: { requestAdapter: async () => ++attempts === 1 ? null : { info: {}, limits: hardware.limits } } });
  assert.equal(result.gpu, true);
  assert.equal(attempts, 2);
  assert.equal(result.name, 'GPU name hidden by browser');
});
test('selection advice reports insufficient capacity without replacing the selected model', () => {
  const large = MODELS.find(model => model.id.startsWith('Qwen3-'));
  assert.match(selectedModelAdvice(large, hardware, 4), /exceeds the recommended memory budget/);
  assert.match(selectedModelAdvice(large, hardware, 24), /Experimental larger candidate/);
  assert.match(selectedModelAdvice(large, { ...hardware, gpu: false }, 24), /may not run/);
});

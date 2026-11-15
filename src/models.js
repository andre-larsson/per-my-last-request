// Estimates for the pinned WebLLM 0.2.88 catalogue, rounded up. They are not measurements of free VRAM.
// https://github.com/mlc-ai/web-llm/blob/v0.2.88/src/config.ts
export const MODELS = [
  { id: 'Qwen2.5-3B-Instruct-q4f32_1-MLC', name: 'Qwen 2.5 · 3B', backend: 'WebGPU', downloadGB: 1.7, memoryGB: 3, note: 'Verified on the introductory assignment. The best-tested starting point; complex orders can still fail.' },
  { id: 'Qwen3-8B-q4f32_1-MLC', name: 'Qwen 3 · 8B', backend: 'WebGPU', downloadGB: 5, memoryGB: 6.9, note: 'Experimental larger candidate. Verified on the introductory assignment; full-circuit behavior is unverified.' },
  { id: 'Qwen2.5-7B-Instruct-q4f32_1-MLC', name: 'Qwen 2.5 · 7B', backend: 'WebGPU', downloadGB: 4.1, memoryGB: 6, note: 'Verified to load and choose actions. It still made tactical mistakes on the full circuit.' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC', name: 'Qwen 2.5 · 1.5B', backend: 'WebGPU', downloadGB: 0.9, memoryGB: 1.9, note: 'Smaller GPU option. Following complicated instructions may be unreliable.' },
  { id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC', name: 'Qwen 2.5 · 0.5B', backend: 'WebGPU', downloadGB: 0.4, memoryGB: 1.1, note: 'Smallest GPU download. Instruction following is experimental.' },
  { id: 'cpu:onnx-community/Qwen2.5-0.5B-Instruct', name: 'Qwen 2.5 · 0.5B', backend: 'CPU', downloadGB: 0.52, memoryGB: null, note: 'Experimental CPU fallback. No GPU needed, but following orders is unreliable.' },
];
export const DEFAULT_MODEL = MODELS[0].id;
export const findModel = id => MODELS.find(model => model.id === id);
export const modelSize = gb => gb < 1 ? `${Math.round(gb * 1000)} MB` : `${gb} GB`;

// Do not infer VRAM from a GPU name, navigator.deviceMemory, or a per-buffer allocation limit.
export async function checkDevice({ gpu = globalThis.navigator?.gpu, secure = globalThis.isSecureContext, cpu = typeof WebAssembly === 'object' && typeof Worker === 'function', timeoutMs = 6000 } = {}) {
  const base = { cpu, gpu: false, software: false, name: '', limits: {}, reason: '' };
  if (secure === false) return { ...base, reason: 'WebGPU needs a secure page. Open the game at its https:// address.' };
  if (!gpu) return { ...base, reason: 'WebGPU is unavailable in this browser.' };
  let timer;
  try {
    const adapter = await Promise.race([
      (async () => {
        // Chrome may initially return null while its GPU process starts. Retry briefly, within the same timeout.
        for (let attempt = 0; attempt < 3; attempt++) {
          const candidate = await gpu.requestAdapter();
          if (candidate || attempt === 2) return candidate;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The GPU check timed out. You can check again.')), timeoutMs); }),
    ]);
    if (!adapter) return { ...base, reason: 'The browser could not provide a WebGPU adapter.' };
    const info = adapter.info || {};
    const name = info.description || [info.vendor, info.architecture].filter(Boolean).join(' · ') || 'GPU name hidden by browser';
    const software = Boolean(info.isFallbackAdapter ?? adapter.isFallbackAdapter) || /swiftshader|llvmpipe|software|lavapipe/i.test(name);
    return { ...base, gpu: true, software, name, limits: { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize }, reason: software ? 'Software graphics detected. GPU inference can be extremely slow.' : 'WebGPU adapter detected. Model loading will verify runtime compatibility.' };
  } catch (error) {
    return { ...base, reason: `GPU check failed: ${error.message || String(error)}` };
  } finally { clearTimeout(timer); }
}

/** `manual`: whether this page offers the Manual sandbox (local play only), so a fallback may point to it. */
export function recommendModel(device, memoryGB = null, { manual = true } = {}) {
  if (!device) return null;
  const cpu = MODELS.find(model => model.backend === 'CPU');
  const advice = device.cpu ? `Try the experimental CPU model${manual ? ', or play in Manual sandbox' : ''}.` : manual ? 'Use Manual sandbox in this browser.' : 'This browser cannot run a local model. Try a recent Chrome, Edge, Firefox or Safari.';
  const fallback = reason => ({ model: device.cpu ? cpu : null, reason: `${reason} ${advice}` });
  if (!device.gpu || device.software) return fallback(device.reason);
  if (device.limits.maxBufferSize < 256 * 2 ** 20 || device.limits.maxStorageBufferBindingSize < 128 * 2 ** 20) return fallback('The browser exposes GPU buffer limits below the runtime minimum.');
  const limited = device.limits.maxStorageBufferBindingSize < 256 * 2 ** 20;
  const supplied = typeof memoryGB === 'number' && Number.isFinite(memoryGB) && memoryGB > 0;
  const candidates = limited ? MODELS.filter(model => model.memoryGB && model.memoryGB <= 1.9) : MODELS.filter(model => model.memoryGB);
  if (supplied) {
    // Reserve 20% of the player's stated capacity. Actual free memory remains unknown.
    const model = [...candidates].sort((a, b) => b.memoryGB - a.memoryGB).find(model => model.memoryGB <= memoryGB * 0.8);
    if (!model) return fallback('The stated GPU memory leaves too little headroom for these GPU models.');
    return { model, reason: `Based on the ${memoryGB} GB you entered, with 20% left as headroom.${limited ? ' Browser buffer limits also favor a smaller model.' : ''} This is an estimated fit; free GPU memory and decision quality are unverified.` };
  }
  return { model: findModel(limited ? 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC' : DEFAULT_MODEL), reason: `${limited ? 'Browser buffer limits favor a smaller model.' : 'Start with the best-tested model.'} GPU memory is unknown, so fit is unverified. Enter your GPU memory below to consider larger models.` };
}

export function selectedModelAdvice(model, device, memoryGB = null) {
  if (model.backend === 'CPU' || !device) return model.note;
  if (!device.gpu || device.software) return `${device.reason} This GPU selection may not run. ${model.note}`;
  if (memoryGB && model.memoryGB > memoryGB * 0.8) return `This model exceeds the recommended memory budget for the ${memoryGB} GB you entered. Choose a smaller model if loading fails. ${model.note}`;
  return model.note;
}

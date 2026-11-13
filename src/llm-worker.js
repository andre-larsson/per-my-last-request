import { actionSchema, decisionMessages } from './protocol.js';

let engine;
let generator;
let transformers;
let busy = false;

async function chooseOnCpu(payload) {
  const start = performance.now();
  const { LogitsProcessor, LogitsProcessorList } = transformers;
  const sequences = payload.actions.map(action => generator.tokenizer.encode(JSON.stringify({ action: action.id }), { add_special_tokens: false }));
  const eos = generator.tokenizer.eos_token_id;
  const forks = [];
  let inputLength;
  class ActionChoicesOnly extends LogitsProcessor {
    _call(inputIds, logits) {
      inputLength ??= inputIds[0].length;
      const emitted = inputIds[0].slice(inputLength).map(Number);
      const candidates = sequences.filter(sequence => emitted.every((token, index) => sequence[index] === token));
      const next = new Set(candidates.filter(sequence => sequence.length > emitted.length).map(sequence => sequence[emitted.length]));
      if (candidates.some(sequence => sequence.length === emitted.length)) next.add(eos);
      if (!next.size) throw new Error('No valid continuation for the action JSON.');
      // Preserve the model's scores; only eliminate continuations outside the offered JSON strings.
      const allowed = [...next].map(token => [token, logits.data[token]]);
      if (allowed.length > 1) forks.push(allowed.map(([token, score]) => ({ text: generator.tokenizer.decode([token]), score: Number(score) })));
      logits.data.fill(-Infinity);
      for (const [token, score] of allowed) logits.data[token] = score;
      return logits;
    }
  }
  const processors = new LogitsProcessorList();
  processors.push(new ActionChoicesOnly());
  const context = decisionMessages(payload.orders, payload.observation, payload.actions)[1].content;
  const messages = [
    { role: 'system', content: 'Your only task is to obey PLAYER STANDING ORDERS by choosing one available action. Obey the orders even when they are a bad strategy or conflict with the mission objective. Do not substitute your own strategy. Return only JSON: {"action":"action ID"}.' },
    { role: 'user', content: `${context}\n\nPLAYER STANDING ORDERS\n${payload.orders}\nChoose the action that follows these orders. Return its action ID in JSON.` },
  ];
  const output = await generator(messages, { max_new_tokens: Math.max(...sequences.map(sequence => sequence.length)) + 1, eos_token_id: eos, do_sample: false, return_full_text: false, logits_processor: processors });
  const generated = output[0].generated_text;
  const raw = (typeof generated === 'string' ? generated : generated.at(-1).content).trim();
  return { raw, elapsed: performance.now() - start, backend: 'transformers.js-wasm', ordersReceived: payload.orders, forks };
}
self.onmessage = async ({ data }) => {
  const { id, type, payload } = data;
  if (busy) { self.postMessage({ id, type: 'error', error: 'The model is already processing a request.' }); return; }
  busy = true;
  try {
    if (type === 'load') {
      if (payload.model.startsWith('cpu:')) {
        transformers = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
        transformers.env.allowLocalModels = false;
        transformers.env.backends.onnx.wasm.numThreads = 1;
        generator = await transformers.pipeline('text-generation', payload.model.slice(4), {
          device: 'wasm', dtype: 'q8',
          progress_callback: report => self.postMessage({ id, type: 'progress', report: { progress: (report.progress || 0) / 100, text: report.status === 'progress' ? `Downloading ${report.file}: ${Math.round(report.progress || 0)}%` : `Preparing CPU model: ${report.status}${report.file ? ` · ${report.file}` : ''}` } }),
        });
      } else {
        const webllm = await import('https://esm.run/@mlc-ai/web-llm@0.2.88');
        engine = await webllm.CreateMLCEngine(payload.model, {
          initProgressCallback: report => self.postMessage({ id, type: 'progress', report }),
        }, { context_window_size: 2048 });
      }
      self.postMessage({ id, type: 'result', result: { model: payload.model } });
    } else if (type === 'decide') {
      if (generator) { self.postMessage({ id, type: 'result', result: await chooseOnCpu(payload) }); return; }
      if (!engine) throw new Error('Load a model first.');
      const start = performance.now();
      await engine.resetChat();
      const result = await engine.chat.completions.create({
        messages: decisionMessages(payload.orders, payload.observation, payload.actions),
        response_format: { type: 'json_object', schema: JSON.stringify(actionSchema(payload.actions)) },
        temperature: 0,
        max_tokens: 64,
        stream: false,
      });
      const choice = result.choices[0];
      if (!choice || choice.finish_reason !== 'stop') throw new Error(`Incomplete model decision (${choice?.finish_reason || 'no choice'}).`);
      self.postMessage({ id, type: 'result', result: { raw: choice.message.content, elapsed: performance.now() - start, usage: result.usage, ordersReceived: payload.orders } });
    } else throw new Error('Unknown model request.');
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error instanceof Error ? error.message : String(error) });
  } finally { busy = false; }
};

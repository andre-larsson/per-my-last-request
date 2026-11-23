// Shared by the idea experiments: the real local model, asked with free-form prompts.
// The game's worker builds its prompt from engine state, so it cannot carry the prose these experiments test.
// This asks WebLLM the same way the worker does (same version, context size, JSON schema of offered IDs,
// max_tokens, a reset chat per decision), with messages the experiment writes itself.
// It reuses the persistent test profile and port of tools/probe.mjs, so the model is downloaded once.
import { join } from 'node:path';
import { serve, ROOT } from '../serve.mjs';
import { launch, sleep } from '../chrome.mjs';

export const MODEL = process.env.QUEST_MODEL || 'Qwen2.5-3B-Instruct-q4f32_1-MLC';
export const TEMPERATURE = Number(process.env.PROBE_TEMPERATURE || 0);
// The game's system prompt, word for word (decisionMessages in src/protocol.js).
export const systemPrompt = orders => `You control one game hero. Follow these standing orders as your policy:\n\n${orders}\n\nChoose exactly one offered action at each turn, following the standing orders even when they are a bad strategy. Return only JSON: {"action":"ID"}. Use an available action ID. Do not explain your choice or invent actions.`;
export const userPrompt = (facts, actions) => `CURRENT SITUATION\n${facts}\n\nAVAILABLE ACTIONS\n${actions.map(a => `${a.id}: ${a.label}. ${a.detail}`).join('\n')}\n\nChoose the next action according to your standing orders.`;
export const messagesFor = (orders, facts, actions) => [{ role: 'system', content: systemPrompt(orders) }, { role: 'user', content: userPrompt(facts, actions) }];

// Variant 1, "think": the same prompt, but the reply carries one short sentence before the action.
export const thinkPrompt = (orders, facts, actions) => ({
  messages: [
    { role: 'system', content: `You control one game hero. Follow these standing orders as your policy:\n\n${orders}\n\nChoose exactly one offered action at each turn, following the standing orders even when they are a bad strategy. Return only JSON: {"thought":"...","action":"ID"}. In "thought", say in one short sentence what the situation means under your standing orders. Then give an available action ID. Do not invent actions.` },
    { role: 'user', content: userPrompt(facts, actions) },
  ],
  ids: actions.map(a => a.id),
  schema: { type: 'object', properties: { thought: { type: 'string' }, action: { type: 'string', enum: actions.map(a => a.id) } }, required: ['thought', 'action'], additionalProperties: false },
  maxTokens: 120,
});
// Variant 2, "read": a separate question about the scene, asked before the decision. Its answer becomes a checklist line.
export const readPrompt = (facts, question, options) => ({
  messages: [
    { role: 'system', content: 'You are the eyes of a game hero. Read the situation and answer the question about it. Return only JSON: {"answer":"..."} with one of the offered answers.' },
    { role: 'user', content: `SITUATION\n${facts}\n\nQUESTION\n${question}\nOffered answers: ${options.join(' | ')}` },
  ],
  ids: options,
  schema: { type: 'object', properties: { answer: { type: 'string', enum: options } }, required: ['answer'], additionalProperties: false },
  maxTokens: 32,
});

export async function openModel({ quiet = false } = {}) {
  const server = await serve(4174);
  const page = await launch({ hardwareGpu: true, profileDir: join(ROOT, 'artifacts', 'llm-test-profile') });
  const close = async () => { await page.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); };
  try {
    await page.goto('http://127.0.0.1:4174/');
    // Chrome may return null while its GPU process starts, so ask for a few seconds.
    let adapter = null;
    for (let attempt = 0; attempt < 12 && !adapter; attempt++) {
      adapter = await page.eval(`(async () => { const a = await navigator.gpu?.requestAdapter(); return a ? [a.info?.vendor, a.info?.architecture, a.info?.description].filter(Boolean).join(' ') + (a.info?.isFallbackAdapter ? ' (software)' : '') : null; })()`);
      if (!adapter) await sleep(700);
    }
    if (!adapter) throw new Error('No WebGPU adapter in headless Chrome.');
    if (/software|swiftshader/i.test(adapter)) throw new Error(`Only software graphics: ${adapter}`);
    if (!quiet) console.log(`WebGPU adapter: ${adapter}`);
    await page.eval(`(() => {
      window.__load = { done: false, error: null, text: '' };
      window.__jobs = {};
      (async () => {
        const webllm = await import('https://esm.run/@mlc-ai/web-llm@0.2.88');
        window.__engine = await webllm.CreateMLCEngine(${JSON.stringify(MODEL)}, { initProgressCallback: r => { window.__load.text = r.text; } }, { context_window_size: 2048 });
        window.__load.done = true;
      })().catch(e => { window.__load.error = String(e && e.message || e); });
      // One batch of decisions, run in order. Results are polled, since one CDP call may not outlast 20 s.
      window.__run = (id, prompts, temperature) => {
        const job = window.__jobs[id] = { results: [], error: null, done: false };
        (async () => {
          for (const p of prompts) {
            const start = performance.now();
            await window.__engine.resetChat();
            const r = await window.__engine.chat.completions.create({
              messages: p.messages,
              response_format: { type: 'json_object', schema: JSON.stringify(p.schema || { type: 'object', properties: { action: { type: 'string', enum: p.ids } }, required: ['action'], additionalProperties: false }) },
              temperature, max_tokens: p.maxTokens || 64, stream: false,
              // As the game's worker does: Qwen 3 thinks unless told not to.
              ...(${JSON.stringify(MODEL)}.startsWith('Qwen3') ? { extra_body: { enable_thinking: false } } : {}),
            });
            const c = r.choices[0];
            job.results.push({ raw: c.message.content, finish: c.finish_reason, ms: Math.round(performance.now() - start), promptTokens: r.usage?.prompt_tokens });
          }
          job.done = true;
        })().catch(e => { job.error = String(e && e.message || e); });
      };
    })()`);
    const started = Date.now();
    let last = '';
    for (;;) {
      const state = await page.eval('window.__load');
      if (state.error) throw new Error(`Model load failed: ${state.error}`);
      if (state.done) break;
      if (!quiet && state.text && state.text !== last && Date.now() - started > 3000) { last = state.text; if (/\[\d+\/\d+\]|Loading|Finish/.test(state.text)) process.stdout.write(`\r${state.text.slice(0, 110).padEnd(110)}`); }
      if (Date.now() - started > 60 * 60 * 1000) throw new Error('Model load took over an hour.');
      await sleep(1500);
    }
    if (!quiet) console.log(`\nLoaded ${MODEL} in ${((Date.now() - started) / 1000).toFixed(0)} s, temperature ${TEMPERATURE}`);
  } catch (error) { await close(); throw error; }
  let sequence = 0;
  /** Asks every prompt ({ messages, ids }) in order. Returns the chosen action IDs. */
  async function askAll(prompts) {
    if (!prompts.length) return [];
    const id = `job${++sequence}`;
    // Sent in slices: one CDP message carrying hundreds of prompts is needlessly large.
    const out = [];
    for (let at = 0; at < prompts.length; at += 40) {
      const slice = prompts.slice(at, at + 40);
      const key = `${id}_${at}`;
      await page.eval(`window.__run(${JSON.stringify(key)}, ${JSON.stringify(slice)}, ${TEMPERATURE})`);
      for (;;) {
        const job = await page.eval(`(() => { const j = window.__jobs[${JSON.stringify(key)}]; return { n: j.results.length, done: j.done, error: j.error }; })()`);
        if (job.error) throw new Error(`Decision failed: ${job.error}`);
        if (job.done) break;
        await sleep(200);
      }
      const results = await page.eval(`window.__jobs[${JSON.stringify(key)}].results`);
      await page.eval(`delete window.__jobs[${JSON.stringify(key)}]`);
      for (const [i, r] of results.entries()) {
        // A prompt with its own schema (a thought before the action, a reading question) may run out of tokens:
        // that is a model failure, reported as no answer. The game's own one-key reply must always complete.
        let json = null;
        // WebLLM returns Qwen 3's empty thinking block with the reply; the game removes exactly that prefix too.
        const text = r.raw.startsWith('<think>\n\n</think>\n\n') ? r.raw.slice('<think>\n\n</think>\n\n'.length) : r.raw;
        if (r.finish === 'stop') { try { json = JSON.parse(text); } catch { /* not JSON: no answer */ } }
        if (!slice[i].schema) {
          if (!json) throw new Error(`Incomplete model decision (${r.finish}).`);
          if (!slice[i].ids.includes(json.action)) throw new Error(`Model chose an action that was not offered: ${json.action}`);
        }
        out.push({ action: json?.action ?? null, json, raw: r.raw, ms: r.ms, promptTokens: r.promptTokens });
      }
    }
    return out;
  }
  return { askAll, ask: async prompt => (await askAll([prompt]))[0], close };
}

// `node tools/ideas/llm.mjs` downloads and loads the model, asks one question, and exits.
if (process.argv[1] && process.argv[1].endsWith('ideas/llm.mjs')) {
  const model = await openModel();
  try {
    const actions = [{ id: 'quick', label: 'Quick strike', detail: '6 damage.' }, { id: 'retreat', label: 'Retreat', detail: 'Leave the fight.' }];
    const answer = await model.ask({ messages: messagesFor('Always retreat.', 'Enemy: Practice rat.', actions), ids: actions.map(a => a.id) });
    console.log(`Smoke decision: ${answer.action} in ${answer.ms} ms (${answer.promptTokens} prompt tokens)`);
  } finally { await model.close(); }
}

// Prompt probe: asks the real local model for single decisions in fixed situations, without playing a whole trial.
// A fast way to check whether example orders and prompt wording are readable for a small model.
//
//   node tools/probe.mjs            (QUEST_MODEL=<id> picks another model; default Qwen 2.5 3B)
//   PROBE_TEMPERATURE=0.7 node tools/probe.mjs    (samples at that temperature; default 0, the tested setting)
//
// It reuses the persistent test profile (artifacts/llm-test-profile, port 4174), so a model downloaded by
// `QUEST_PROFILE=artifacts/llm-test-profile npm run test:llm` is not downloaded again.
// Situations come from the real engine and prompts from the real protocol and worker. Nothing here plays the game.
import { join } from 'node:path';
import { serve, ROOT } from './serve.mjs';
import { launch } from './chrome.mjs';
import { newGame, applyAction, availableActions, observation, PRESETS } from '../src/game.js';

const MODEL = process.env.QUEST_MODEL || 'Qwen2.5-3B-Instruct-q4f32_1-MLC';
const TEMPERATURE = Number(process.env.PROBE_TEMPERATURE || 0);
const play = (s, ...ids) => ids.reduce((state, id) => applyAction(state, id), s);
const meet = index => applyAction({ ...newGame('circuit'), status: 'active', position: index - 1 }, 'advance');

// Each situation names the action the example orders call for.
export const SITUATIONS = [
  ['rat, ordinary strike', play(newGame('circuit'), 'depart'), 'quick'],
  ['boar, about to smash', meet(3), 'guard'],
  ['boar, ordinary strike', play(meet(3), 'guard'), 'quick'],
  ['Quickfoot, ordinary strike', meet(7), 'quick'],
  ['Quickfoot, winded', play(meet(7), 'quick', 'quick'), 'quick'],
  ['champion, ordinary strike', meet(10), 'quick'],
  ['champion, bracing', play(meet(10), 'quick'), 'quick'],
  ['champion, about to smash', play(meet(10), 'quick', 'quick'), 'guard'],
  ['prize bruiser, ordinary strike', meet(5), 'retreat'],
  ['hurt, LOW, ordinary strike', { ...meet(7), hp: 15 }, 'potion'],
  ['tired (no heavy), ordinary strike', { ...meet(7), stamina: 1 }, 'quick'],
  ['walking, slightly hurt', play(newGame('circuit'), 'depart', 'quick', 'quick'), 'advance'],
  ['walking, LOW', { ...play(newGame('circuit'), 'depart', 'quick', 'quick'), hp: 16 }, 'potion'],
];
export const ORDERS = {
  example: PRESETS.careful,
  // PROBE_ORDERS adds variants, separated by ' || '.
  ...Object.fromEntries((process.env.PROBE_ORDERS || '').split(' || ').filter(Boolean).map((orders, i) => [`variant ${i + 1}`, orders.replace(/\\n/g, '\n')])),
};

const server = await serve(4174);
const page = await launch({ hardwareGpu: true, profileDir: join(ROOT, 'artifacts', 'llm-test-profile') });
try {
  await page.goto('http://127.0.0.1:4174/');
  await page.eval(`(() => {
    window.__probe = new Worker('./src/llm-worker.js', { type: 'module' });
    window.__call = (type, payload) => new Promise((resolve, reject) => {
      const id = Math.random();
      const listen = ({ data }) => {
        if (data.id !== id || data.type === 'progress') return;
        window.__probe.removeEventListener('message', listen);
        data.type === 'error' ? reject(new Error(data.error)) : resolve(data.result);
      };
      window.__probe.addEventListener('message', listen);
      window.__probe.postMessage({ id, type, payload });
    });
  })()`);
  const started = Date.now();
  await page.eval(`__call('load', { model: ${JSON.stringify(MODEL)} })`);
  console.log(`Loaded ${MODEL} in ${((Date.now() - started) / 1000).toFixed(0)} s, temperature ${TEMPERATURE}\n`);
  for (const [name, orders] of Object.entries(ORDERS)) {
    let right = 0;
    console.log(`ORDERS (${name}): ${orders}`);
    for (const [label, state, wanted] of SITUATIONS) {
      const actions = availableActions(state).map(({ id, label, detail }) => ({ id, label, detail }));
      const result = await page.eval(`__call('decide', ${JSON.stringify({ orders, observation: observation(state), actions, temperature: TEMPERATURE })})`);
      const chosen = JSON.parse(result.raw).action;
      if (chosen === wanted) right++;
      console.log(`  ${chosen === wanted ? '✓' : '✗'} ${label.padEnd(30)} chose ${chosen.padEnd(8)} wanted ${wanted}`);
    }
    console.log(`  ${right} of ${SITUATIONS.length} as the example orders intend\n`);
  }
} finally { await page.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }

// The game's own example orders played by the real model on the real engine, with the game's own drawn move order.
// For questions about the examples themselves: does a first draft lose, does a careful example win, and does that hold
// when the hero starts hurt or the model samples at a temperature above 0?
//
//   node tools/ideas/presets.mjs --levels=prize --presets=careful,reckless [--seeds=7] [--start-hp=40,32] [--repeat=1]
//                                [--arm=plain] [--challenge] [--custom='orders || orders'] [--tag=x]
//   (QUEST_MODEL and PROBE_TEMPERATURE as in probe.mjs)
//
// Each trial is the game as it is (no seed: fixed routines) plus engine seeds 1..N (G.newGame(level, seed)), each
// repeated --repeat times (useful only above temperature 0). --start-hp sets the hero's health after newGame, to try a
// starting health before the game has it. The "plan" a preset is scored against is its assignment's careful plan, so a
// first draft's departures are where it differs from the careful orders; only won or lost matters for a first draft.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../serve.mjs';
import * as G from '../../src/game.js';
import { ARMS, PLANS, intended, kinds, ok } from './rehearse.mjs';
import { openModel, MODEL, TEMPERATURE } from './llm.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const LEVELS = (arg('levels') || 'warning,prize').split(',');
const PRESETS = (arg('presets') || 'careful,reckless').split(',');
const SEEDS = Number(arg('seeds') ?? 3);
const REPEAT = Number(arg('repeat') ?? 1);
const START_HP = arg('start-hp') ? arg('start-hp').split(',').map(Number) : [null];
const ARM = arg('arm') || 'plain';
const FILE = join(ROOT, 'artifacts', `ideas-presets-${MODEL}${arg('tag') ? `-${arg('tag')}` : ''}.json`);
const CAREFUL = { warning: 'guard', prize: 'sword', circuit: 'careful' };
// --challenge: as in rehearse.mjs, which turns it on when imported with the same flag.
if (process.argv.includes('--challenge') && !G.LEVELS.prize.challenge) throw new Error('--challenge did not reach the engine.');

const over = s => s.status === 'won' || s.status === 'lost';
const forced = s => G.availableActions(s).length === 1;
const step = (s, id) => { const next = G.applyAction({ ...s, log: [] }, id, 'bot'); next.log = []; return next; };
function begin(level, seed, hp) {
  const s = G.newGame(level, seed);
  if (hp != null) s.hp = Math.min(hp, s.maxHp);
  return s;
}
async function playAll(model, jobs) {
  const trials = jobs.map(j => ({ ...j, s: begin(j.level, j.seed, j.startHp), decisions: [] }));
  for (;;) {
    const waiting = [];
    for (const t of trials) { while (!over(t.s) && forced(t.s)) t.s = step(t.s, G.availableActions(t.s)[0].id); if (!over(t.s)) waiting.push(t); }
    if (!waiting.length) break;
    const answers = await model.askAll(waiting.map(t => ({ messages: ARMS[ARM](t.orders, t.s), ids: G.availableActions(t.s).map(a => a.id) })));
    waiting.forEach((t, i) => {
      t.decisions.push({ turn: t.s.turn + 1, at: G.currentTile(t.s).name, hp: t.s.hp, move: G.nextMove(t.s.enemy)?.kind || null, ...kinds(t.s), action: answers[i].action, intended: intended(t.plan, t.s) });
      t.s = step(t.s, answers[i].action);
    });
    process.stdout.write(`\r  ${trials.filter(t => over(t.s)).length} of ${trials.length} trials finished`);
  }
  process.stdout.write('\n');
  return trials.map(t => ({ level: t.level, preset: t.preset, startHp: t.startHp, seed: t.seed, status: t.s.status, turns: t.s.turn, hp: t.s.hp,
    end: t.s.status === 'won' ? 'won' : t.s.hp === 0 ? `died at ${G.currentTile(t.s).name}` : `out of turns at ${G.currentTile(t.s).name}`, decisions: t.decisions }));
}
/** The same orders played by a script that follows the careful plan exactly, for comparison. */
function script(level, seed, hp) {
  let s = begin(level, seed, hp);
  while (!over(s)) s = step(s, forced(s) ? G.availableActions(s)[0].id : intended(PLANS[level][CAREFUL[level]], s)[0]);
  return s.status;
}

// --custom='orders || more orders': candidate example orders, played as presets named custom1, custom2, …
const CUSTOM = (arg('custom') || '').split(' || ').filter(Boolean).map(text => text.replace(/\\n/g, '\n'));
CUSTOM.forEach((_, i) => PRESETS.push(`custom${i + 1}`));
const ordersOf = (level, preset) => preset.startsWith('custom') ? CUSTOM[Number(preset.slice(6)) - 1] : G.LEVELS[level].presets[preset];
const jobs = LEVELS.flatMap(level => START_HP.flatMap(startHp => PRESETS.flatMap(preset =>
  [null, ...Array.from({ length: SEEDS }, (_, i) => i + 1)].flatMap(seed => Array.from({ length: REPEAT }, () =>
    ({ level, preset, startHp, seed, orders: ordersOf(level, preset), plan: PLANS[level][CAREFUL[level]] }))))));
const model = await openModel({ quiet: true });
let trials;
try { trials = await playAll(model, jobs); } finally { await model.close(); }
await mkdir(join(ROOT, 'artifacts'), { recursive: true });
await writeFile(FILE, JSON.stringify({ model: MODEL, temperature: TEMPERATURE, arm: ARM, seeds: SEEDS, repeat: REPEAT, trials }, null, 1));

console.log(`\n${MODEL}, temperature ${TEMPERATURE}, prompt ${ARM}`);
for (const level of LEVELS) for (const startHp of START_HP) for (const preset of PRESETS) {
  const mine = trials.filter(t => t.level === level && t.startHp === startHp && t.preset === preset);
  const scripts = [...new Set(mine.map(t => t.seed))].map(seed => script(level, seed, startHp));
  if (preset.startsWith('custom')) console.log(`  ${preset}: ${JSON.stringify(ordersOf(level, preset))}`);
  console.log(`  ${level} ${preset}${startHp != null ? `, start ${startHp} HP` : ''}: won ${mine.filter(t => t.status === 'won').length} of ${mine.length} (the careful script ${scripts.filter(x => x === 'won').length} of ${scripts.length})`);
  for (const t of mine) {
    const off = t.decisions.filter(d => !ok(d));
    console.log(`    ${String(t.seed ?? 'game').padEnd(5)} ${t.status === 'won' ? `won t${t.turns}` : t.end}, ${t.hp} HP; ${t.decisions.length - off.length}/${t.decisions.length} as the careful plan${off.length ? `; departures: ${[...Map.groupBy(off, d => `${d.coarse} → ${d.action}`)].map(([k, v]) => `${v.length}× ${k}`).join(', ')}` : ''}`);
  }
}
console.log(`\nEvery decision is in ${FILE.replace(`${ROOT}/`, '')}`);

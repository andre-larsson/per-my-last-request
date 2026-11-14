// Balance harness. Plays the real engine headlessly; no browser, no model.
//
//   node tools/balance.mjs [path/to/engine.js] [--json out.json]
//
// It reports four things for the full circuit:
//   1. Order styles: a grid of simple standing orders, played as scripted bots. How many win, and how differently.
//   2. Robustness: each winning style replayed with a share of random decisions, a stand-in for an imperfect LLM.
//   3. Battles: for each opponent, the distinct ways to win the fight and whether one of them dominates.
//   4. Solver: exhaustive search of the whole trial. How many winning lines exist, and the speed/safety frontier.
//
// The bots here are measurement tools. They are never used as a controller in the game.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const enginePath = resolve(args[0] || new URL('../src/game.js', import.meta.url).pathname);
const G = await import(pathToFileURL(enginePath).href);
const { newGame, availableActions, applyAction } = G;
const LOW = G.LOW_HP ?? 18;

// Keep the log short so cloning stays cheap during search.
const step = (s, id) => { const n = applyAction({ ...s, log: [] }, id, 'bot'); n.log = []; return n; };
const ids = s => availableActions(s).map(a => a.id);
const over = s => s.status === 'won' || s.status === 'lost';

// ---------- 1. Order styles ----------
// Each style is a short set of orders a player could plausibly write. Every dimension is one sentence of orders.
const DIMENSIONS = {
  attack: {
    quick: 'Always use quick strikes.',
    heavy: 'Use a heavy strike whenever you can.',
    smart: 'Heavy strikes, except quick strikes against agile enemies.',
  },
  heal: {
    never: 'Never drink potions.',
    low: 'Drink a potion when health is LOW.',
    any: 'Drink a potion whenever hurt.',
  },
  optional: { fight: 'Fight optional opponents.', skip: 'Retreat from optional fights.' },
  services: { use: 'Use every service you pass.', skip: 'Never stop for services.' },
};
// Extra dimensions an engine variant can declare (for example a guard action) are merged in.
Object.assign(DIMENSIONS, G.BALANCE_DIMENSIONS || {});

function stylePolicy(style) {
  return (s, offered) => {
    const has = id => offered.includes(id);
    if (G.balancePolicy) { const pick = G.balancePolicy(s, offered, style); if (pick) return pick; }
    const hurt = style.heal === 'any' ? s.hp < s.maxHp : style.heal === 'low' ? s.hp <= LOW : false;
    if (has('potion') && hurt) return 'potion';
    if (s.enemy) {
      if (s.enemy.optional && style.optional === 'skip' && has('retreat')) return 'retreat';
      if (style.attack === 'heavy' && has('heavy')) return 'heavy';
      if (style.attack === 'smart' && has('heavy') && !s.enemy.agile) return 'heavy';
      return 'quick';
    }
    if (style.services === 'use') for (const id of ['medic', 'upgrade', 'rest']) if (has(id)) return id;
    for (const id of ['finish', 'depart', 'advance']) if (has(id)) return id;
    return offered[0];
  };
}
function playPolicy(policy, { noise = 0, rng = null } = {}) {
  let s = newGame('circuit');
  let decisions = 0;
  const used = {};
  while (!over(s)) {
    const offered = ids(s);
    let pick = policy(s, offered);
    if (offered.length > 1) {
      decisions++;
      if (noise && rng() < noise) pick = offered[Math.floor(rng() * offered.length)];
    }
    used[pick] = (used[pick] || 0) + 1;
    s = step(s, pick);
  }
  return { state: s, decisions, used };
}
const combos = Object.entries(DIMENSIONS).reduce((acc, [dim, options]) => acc.flatMap(c => Object.keys(options).map(o => ({ ...c, [dim]: o }))), [{}]);
const styleName = style => Object.values(style).join('/');
const results = combos.map(style => ({ style, ...playPolicy(stylePolicy(style)) }));
const winners = results.filter(r => r.state.status === 'won');

// ---------- 2. Robustness ----------
function mulberry32(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const NOISE = [0.05, 0.1, 0.2];
const RUNS = 1000;
function robustness(style) {
  return NOISE.map(noise => {
    const rng = mulberry32(1234);
    let wins = 0;
    for (let i = 0; i < RUNS; i++) if (playPolicy(stylePolicy(style), { noise, rng }).state.status === 'won') wins++;
    return wins / RUNS;
  });
}

// ---------- 3. Battles ----------
// Enumerate every way to finish a fight from a fixed entry state. A line is a sequence of actions until the enemy falls.
// Lines are compared on HP lost, potions used, stamina left and turns spent. Dominated lines are dropped.
function fightLines(entry) {
  const lines = [];
  const walk = (s, path) => {
    if (!s.enemy || over(s)) { if (s.resolved && path.at(-1) !== 'retreat' && s.status !== 'lost') lines.push({ path, s }); return; }
    if (path.length > 9) return;
    for (const id of ids(s)) if (id !== 'retreat') walk(step(s, id), [...path, id]);
  };
  walk(entry, []);
  const cost = ({ path, s }) => ({ path: path.join(' '), hpLost: entry.hp - s.hp + 18 * (entry.potions - s.potions), staminaLeft: s.stamina, turns: path.length, coins: s.coins - entry.coins });
  const all = lines.map(cost);
  const dominated = (a, b) => b.hpLost <= a.hpLost && b.staminaLeft >= a.staminaLeft && b.turns <= a.turns && (b.hpLost < a.hpLost || b.staminaLeft > a.staminaLeft || b.turns < a.turns);
  const front = all.filter(a => !all.some(b => dominated(a, b)));
  const unique = [...new Map(front.map(l => [`${l.hpLost}:${l.staminaLeft}:${l.turns}`, l])).values()];
  return unique.sort((a, b) => a.hpLost - b.hpLost);
}
function battleEntries() {
  // Walk the circuit with a plain policy and capture the state on entering each fight, then vary stamina and sword.
  const out = [];
  let s = newGame('circuit');
  const seen = new Set();
  while (!over(s) && s.lap === 1) {
    if (s.enemy && !seen.has(s.enemy.name)) {
      seen.add(s.enemy.name);
      for (const sword of [0, 2]) for (const stamina of [4, 2]) out.push({ name: s.enemy.name, sword, stamina, state: { ...s, hp: 40, potions: 0, sword, stamina, log: [] } });
    }
    const offered = ids(s);
    s = step(s, s.enemy ? (offered.includes('heavy') && !s.enemy.agile ? 'heavy' : 'quick') : offered.includes('finish') ? 'finish' : offered.includes('depart') ? 'depart' : 'advance');
  }
  return out;
}

// ---------- 4. Solver ----------
function solve() {
  const memo = new Map();
  const keyOf = s => { const { log, revision, ...rest } = s; return JSON.stringify(rest); };
  // Returns { lines: number of winning decision sequences, front: Pareto set of [turns, effectiveHp] among wins }.
  const visit = s => {
    if (s.status === 'won') return { lines: 1, front: [[s.turn, s.hp + 18 * s.potions]] };
    if (s.status === 'lost') return { lines: 0, front: [] };
    const k = keyOf(s);
    if (memo.has(k)) return memo.get(k);
    let lines = 0;
    let front = [];
    for (const id of ids(s)) {
      const r = visit(step(s, id));
      lines += r.lines;
      front = front.concat(r.front);
    }
    front = front.filter(([t, h]) => !front.some(([t2, h2]) => t2 <= t && h2 >= h && (t2 < t || h2 > h)));
    front = [...new Map(front.map(p => [p.join(), p])).values()].sort((a, b) => a[0] - b[0]);
    const r = { lines, front };
    memo.set(k, r);
    return r;
  };
  const root = visit(newGame('circuit'));
  // Classify every decision on some winning line: how many offered actions keep the trial winnable?
  const decisions = { forced: 0, open: 0, combatForced: 0, combatOpen: 0 };
  const seen = new Set();
  const walk = s => {
    const k = keyOf(s);
    if (seen.has(k) || over(s)) return;
    seen.add(k);
    const offered = ids(s);
    const next = offered.map(id => [id, step(s, id)]).filter(([, n]) => visit(n).lines > 0);
    if (offered.length > 1) {
      const combat = Boolean(s.enemy);
      if (next.length === 1) { decisions.forced++; if (combat) decisions.combatForced++; } else { decisions.open++; if (combat) decisions.combatOpen++; }
    }
    for (const [, n] of next) walk(n);
  };
  walk(newGame('circuit'));
  return { states: memo.size, winningLines: root.lines, front: root.front, decisions };
}

// ---------- Report ----------
const pct = x => `${Math.round(x * 100)}%`;
const report = { engine: enginePath, styles: { total: results.length, winners: winners.length } };
console.log(`Engine: ${enginePath}\n`);
console.log(`1. ORDER STYLES (${Object.keys(DIMENSIONS).join(' / ')}): ${winners.length} of ${results.length} win`);
const byDim = {};
for (const [dim, options] of Object.entries(DIMENSIONS)) {
  byDim[dim] = {};
  for (const o of Object.keys(options)) {
    const n = results.filter(r => r.style[dim] === o).length;
    const w = winners.filter(r => r.style[dim] === o).length;
    byDim[dim][o] = `${w}/${n}`;
  }
  console.log(`   ${dim.padEnd(9)} ${Object.entries(byDim[dim]).map(([o, v]) => `${o} ${v}`).join('   ')}`);
}
report.styles.byDimension = byDim;
report.styles.winning = [];
for (const r of winners) {
  const rob = robustness(r.style);
  const s = r.state;
  report.styles.winning.push({ style: styleName(r.style), turns: s.turn, hp: s.hp, potions: s.potions, coins: s.coins, decisions: r.decisions, used: r.used, robustness: rob });
}
report.styles.winning.sort((a, b) => b.robustness[1] - a.robustness[1]);
console.log(`\n   Winning styles (turns, HP, potions left, coins, LLM decisions) and win rate with ${NOISE.map(pct).join(' / ')} random decisions:`);
for (const w of report.styles.winning) console.log(`   ${w.style.padEnd(28)} ${String(w.turns).padStart(2)}t ${String(w.hp).padStart(2)}hp ${w.potions}p ${String(w.coins).padStart(2)}c ${String(w.decisions).padStart(2)}d   ${w.robustness.map(pct).map(x => x.padStart(4)).join(' ')}`);
const deaths = {};
for (const r of results.filter(r => r.state.status === 'lost')) {
  const s = r.state;
  const why = s.hp === 0 ? `died at ${G.TILES[s.position].name}` : `out of turns, lap ${s.lap}`;
  deaths[why] = (deaths[why] || 0) + 1;
}
console.log(`\n   Losses: ${Object.entries(deaths).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
report.styles.losses = deaths;

console.log('\n3. BATTLES: undominated ways to win each fight from 40 HP, no potions (hp lost / stamina left / turns)');
report.battles = [];
for (const e of battleEntries()) {
  const lines = fightLines(e.state);
  report.battles.push({ enemy: e.name, sword: e.sword, stamina: e.stamina, lines });
  console.log(`   ${e.name.padEnd(15)} sword+${e.sword} stamina ${e.stamina}: ${lines.length} line${lines.length === 1 ? '' : 's'}  ${lines.map(l => `[${l.path}] ${l.hpLost}/${l.staminaLeft}/${l.turns}`).join('  ')}`);
}

console.log('\n4. SOLVER: exhaustive search of the full circuit');
const t0 = Date.now();
const solved = solve();
report.solver = solved;
console.log(`   ${solved.states} states in ${((Date.now() - t0) / 1000).toFixed(1)} s. Winning decision sequences: ${solved.winningLines}`);
console.log(`   Speed/safety frontier (turns → best HP+18×potions): ${solved.front.map(([t, h]) => `${t}→${h}`).join('  ')}`);
const d = solved.decisions;
console.log(`   Decisions on winning lines: ${d.open} open (2+ actions still win), ${d.forced} forced (one action wins). In combat: ${d.combatOpen} open, ${d.combatForced} forced.`);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(report, null, 2)); console.log(`\nWrote ${jsonOut}`); }

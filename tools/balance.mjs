// Balance harness. Plays the real engine headlessly; no browser, no model.
//
//   node tools/balance.mjs [path/to/engine.js] [--level circuit|warning|prize|tutorial] [--solve] [--json out.json]
//
// For the full circuit (or the assignment given with --level; battles always use circuit opponents) it reports:
//   1. Order styles: a grid of simple standing orders, played as scripted bots. How many win, and with which approach.
//   2. Robustness: winning styles replayed with a share of random decisions, a stand-in for an imperfect LLM.
//   3. Usage: which actions, stops, purchases and commendations winning styles actually use.
//   4. Battles: for each opponent, the undominated ways to win the fight.
//   5. Solver (--solve, slow): exhaustive search of the whole trial.
//
// The bots here are measurement tools. They are never used as a controller in the game.
// It also runs against an older engine (for example `git show balance-before:src/game.js > /tmp/old.js`);
// dimensions the old engine lacks simply never trigger.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const jsonOut = option('--json');
const level = option('--level') || 'circuit';
const runSolver = flag('--solve');
const enginePath = resolve(args[0] || new URL('../src/game.js', import.meta.url).pathname);
const G = await import(pathToFileURL(enginePath).href);
const { newGame, availableActions, applyAction } = G;
const LOW = G.LOW_HP ?? 18;
const moveOf = e => (G.nextMove ? G.nextMove(e) : null) || { kind: 'strike' };

// Keep the log short so cloning stays cheap during search.
const step = (s, id) => { const n = applyAction({ ...s, log: [] }, id, 'bot'); n.log = []; return n; };
const ids = s => availableActions(s).map(a => a.id);
const over = s => s.status === 'won' || s.status === 'lost';

// ---------- 1. Order styles ----------
// Each option is one sentence of orders a player could plausibly write.
const DIMENSIONS = {
  attack: { quick: 'Always use quick strikes.', heavy: 'Use a heavy strike whenever you can.', smart: 'Heavy strikes, except quick strikes against agile enemies.' },
  read: { none: '(Ignores what the enemy is about to do.)', guard: 'Guard when the enemy is about to smash.', full: 'Guard smashes, heavy strike when it is winded, quick strike when it braces, drink potions while it is not attacking.' },
  heal: { never: 'Never drink potions.', low: 'Drink a potion when health is LOW.', any: 'Drink a potion whenever hurt.' },
  optional: { fight: 'Fight optional opponents.', skip: 'Retreat from optional fights.' },
  services: { use: 'Visit the medic and rest on the bench.', skip: 'Never stop for the medic or bench.' },
  shop: { none: 'Buy nothing.', sword: 'Buy the sword.', buckler: 'Buy the buckler.', potion: 'Buy potions.', all: 'Buy everything you can afford.' },
};
const SHOP_ORDER = { none: [], sword: ['buy_sword'], buckler: ['buy_buckler'], potion: ['buy_potion'], all: ['buy_sword', 'buy_buckler', 'buy_potion'], upgrade: ['upgrade'] };

function stylePolicy(style) {
  return (s, offered) => {
    const has = id => offered.includes(id);
    const e = s.enemy;
    const hurt = style.heal === 'any' ? s.hp < s.maxHp : style.heal === 'low' ? s.hp <= LOW : false;
    if (e) {
      const m = moveOf(e);
      if (e.optional && style.optional === 'skip') return 'retreat';
      if (style.read === 'full' && has('potion') && style.heal !== 'never' && s.hp < s.maxHp - 10 && (m.kind === 'brace' || m.kind === 'winded')) return 'potion';
      if (has('potion') && hurt) return 'potion';
      if (style.read !== 'none' && m.kind === 'smash' && has('guard')) return 'guard';
      if (style.read === 'full' && m.kind === 'winded' && has('heavy')) return 'heavy';
      if (style.read === 'full' && m.kind === 'brace') return has('guard') && s.stamina < 4 ? 'guard' : 'quick';
      if (style.attack === 'heavy' && has('heavy')) return 'heavy';
      if (style.attack === 'smart' && has('heavy') && !(e.agile && m.kind !== 'winded')) return 'heavy';
      return 'quick';
    }
    if (has('potion') && hurt) return 'potion';
    if (style.services === 'use') for (const id of ['medic', 'rest']) if (has(id)) return id;
    for (const id of [...SHOP_ORDER[style.shop], ...(style.shop !== 'none' && has('upgrade') ? ['upgrade'] : [])]) if (has(id)) return id;
    for (const id of ['finish', 'depart', 'advance']) if (has(id)) return id;
    return offered[0];
  };
}
function playPolicy(policy, { noise = 0, rng = null } = {}) {
  let s = newGame(level);
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
function robustness(style, noise, runs) {
  const rng = mulberry32(1234);
  let wins = 0;
  for (let i = 0; i < runs; i++) if (playPolicy(stylePolicy(style), { noise, rng }).state.status === 'won') wins++;
  return wins / runs;
}

// ---------- 4. Battles ----------
// Every way to finish a fight from a fixed entry state, compared on HP lost, stamina left and turns spent.
function fightLines(entry, maxDepth = 8) {
  const lines = [];
  const walk = (s, path) => {
    if (!s.enemy || over(s)) { if (s.resolved && path.at(-1) !== 'retreat' && s.status !== 'lost') lines.push({ path, s }); return; }
    if (path.length >= maxDepth) return;
    for (const id of ids(s)) if (id !== 'retreat' && id !== 'potion') walk(step(s, id), [...path, id]);
  };
  walk(entry, []);
  const all = lines.map(({ path, s }) => ({ path: path.join(' '), hpLost: entry.hp - s.hp, staminaLeft: s.stamina, turns: path.length }));
  const dominated = (a, b) => b.hpLost <= a.hpLost && b.staminaLeft >= a.staminaLeft && b.turns <= a.turns && (b.hpLost < a.hpLost || b.staminaLeft > a.staminaLeft || b.turns < a.turns);
  const front = all.filter(a => !all.some(b => dominated(a, b)));
  return [...new Map(front.map(l => [`${l.hpLost}:${l.staminaLeft}:${l.turns}`, l])).values()].sort((a, b) => a.hpLost - b.hpLost || a.turns - b.turns);
}
function battleEntries() {
  const out = [];
  for (const [i, tile] of G.TILES.entries()) {
    if (tile.kind !== 'enemy') continue;
    let s = { ...newGame('circuit'), status: 'active', position: i - 1, hp: 40, potions: 0 };
    s = step(s, 'advance');
    if (!s.enemy) continue;
    for (const gear of [{}, { sword: 2 }, { buckler: 4 }]) out.push({ name: tile.name, gear: Object.keys(gear)[0] || 'plain', state: { ...s, stamina: 4, ...gear, log: [] } });
  }
  return out;
}

// ---------- 5. Solver ----------
function solve() {
  const memo = new Map();
  const keyOf = s => { const { log, revision, ...rest } = s; return JSON.stringify(rest); };
  const visit = s => {
    if (s.status === 'won') return { lines: 1, front: [[s.turn, s.hp + 18 * s.potions]] };
    if (s.status === 'lost') return { lines: 0, front: [] };
    const k = keyOf(s);
    if (memo.has(k)) return memo.get(k);
    let lines = 0;
    let front = [];
    for (const id of ids(s)) { const r = visit(step(s, id)); lines += r.lines; front = front.concat(r.front); }
    front = front.filter(([t, h]) => !front.some(([t2, h2]) => t2 <= t && h2 >= h && (t2 < t || h2 > h)));
    const r = { lines, front: [...new Map(front.map(p => [p.join(), p])).values()].sort((a, b) => a[0] - b[0]) };
    memo.set(k, r);
    return r;
  };
  const root = visit(newGame(level));
  return { states: memo.size, winningLines: root.lines, front: root.front };
}

// ---------- Report ----------
const pct = x => `${Math.round(x * 100)}%`;
const report = { engine: enginePath, level, styles: { total: results.length, winners: winners.length } };
console.log(`Engine: ${enginePath}\nAssignment: ${level}\n`);
console.log(`1. ORDER STYLES: ${winners.length} of ${results.length} win (${pct(winners.length / results.length)})`);
report.styles.byDimension = {};
for (const [dim, options] of Object.entries(DIMENSIONS)) {
  const row = {};
  for (const o of Object.keys(options)) row[o] = `${winners.filter(r => r.style[dim] === o).length}/${results.filter(r => r.style[dim] === o).length}`;
  report.styles.byDimension[dim] = row;
  console.log(`   ${dim.padEnd(9)} ${Object.entries(row).map(([o, v]) => `${o} ${v}`).join('   ')}`);
}
console.log('\n   Approach matrix: wins by attack style (rows) and enemy reading (columns)');
console.log(`   ${''.padEnd(7)}${Object.keys(DIMENSIONS.read).map(r => r.padStart(8)).join('')}`);
report.styles.matrix = {};
for (const a of Object.keys(DIMENSIONS.attack)) {
  const cells = Object.keys(DIMENSIONS.read).map(r => { const n = results.filter(x => x.style.attack === a && x.style.read === r).length; const w = winners.filter(x => x.style.attack === a && x.style.read === r).length; report.styles.matrix[`${a}/${r}`] = w / n; return `${w}/${n}`; });
  console.log(`   ${a.padEnd(7)}${cells.map(c => c.padStart(8)).join('')}`);
}
const deaths = {};
for (const r of results.filter(r => r.state.status === 'lost')) {
  const s = r.state;
  const why = s.hp === 0 ? `died at ${G.TILES[s.position].name}` : `out of turns at ${G.TILES[s.position].name}`;
  deaths[why] = (deaths[why] || 0) + 1;
}
report.styles.losses = deaths;
console.log(`\n   Losses: ${Object.entries(deaths).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ')}`);

console.log('\n2. ROBUSTNESS: win rate with 10% random decisions (300 runs each), best style per approach');
report.robustness = {};
for (const a of Object.keys(DIMENSIONS.attack)) for (const r of Object.keys(DIMENSIONS.read)) {
  const group = winners.filter(x => x.style.attack === a && x.style.read === r);
  if (!group.length) continue;
  // Score the 6 safest-looking winners of the group (most HP left), report the most robust.
  const scored = group.sort((x, y) => (y.state.hp + 18 * y.state.potions) - (x.state.hp + 18 * x.state.potions)).slice(0, 6).map(x => ({ x, rob: robustness(x.style, 0.1, 300) })).sort((p, q) => q.rob - p.rob);
  const best = scored[0];
  const s = best.x.state;
  report.robustness[`${a}/${r}`] = { style: styleName(best.x.style), robustness: best.rob, turns: s.turn, hp: s.hp, potions: s.potions, coins: s.coins };
  console.log(`   ${`${a}/${r}`.padEnd(12)} ${pct(best.rob).padStart(4)}   ${styleName(best.x.style).padEnd(34)} ${s.turn}t ${s.hp}hp ${s.potions}p ${s.coins}c`);
}

console.log('\n3. USAGE among winning styles');
const usage = {};
for (const r of winners) for (const id of Object.keys(r.used)) usage[id] = (usage[id] || 0) + 1;
const allIds = ['quick', 'heavy', 'guard', 'potion', 'retreat', 'medic', 'rest', 'buy_sword', 'buy_buckler', 'buy_potion', 'upgrade'];
report.usage = Object.fromEntries(allIds.map(id => [id, usage[id] || 0]));
console.log(`   Styles using each action: ${allIds.map(id => `${id} ${usage[id] || 0}`).join(', ')}`);
const turns = winners.map(r => r.state.turn).sort((a, b) => a - b);
if (turns.length) console.log(`   Turns used by winners: min ${turns[0]}, median ${turns[Math.floor(turns.length / 2)]}, max ${turns.at(-1)} of ${newGame(level).turnLimit}`);
const prize = winners.filter(r => r.state.prizeWon).length;
console.log(`   Winners who beat the optional bruiser: ${prize} of ${winners.length}`);
if (G.commendations) {
  const medals = {};
  const counts = [0, 0, 0, 0, 0];
  for (const r of winners) { const got = G.commendations(r.state).filter(c => c.earned); counts[got.length]++; for (const c of got) medals[c.label] = (medals[c.label] || 0) + 1; }
  report.commendations = { byMedal: medals, byCount: counts };
  console.log(`   Commendations earned by winners: ${Object.entries(medals).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`   Winners by number of commendations (0-4): ${counts.join(' / ')}`);
}

console.log('\n4. BATTLES: undominated ways to win each fight from 40 HP, 4 stamina, no potions (hp lost / stamina left / turns)');
report.battles = [];
for (const e of battleEntries()) {
  const lines = fightLines(e.state);
  report.battles.push({ enemy: e.name, gear: e.gear, lines });
  console.log(`   ${e.name.padEnd(15)} ${e.gear.padEnd(8)} ${String(lines.length).padStart(2)}: ${lines.slice(0, 5).map(l => `[${l.path}] ${l.hpLost}/${l.staminaLeft}/${l.turns}`).join('  ')}${lines.length > 5 ? ' …' : ''}`);
}

if (runSolver) {
  console.log(`\n5. SOLVER: exhaustive search of the ${level} assignment`);
  const t0 = Date.now();
  const solved = solve();
  report.solver = solved;
  console.log(`   ${solved.states} states in ${((Date.now() - t0) / 1000).toFixed(1)} s. Winning decision sequences: ${solved.winningLines}`);
  console.log(`   Speed/safety frontier (turns → best HP+18×potions): ${solved.front.map(([t, h]) => `${t}→${h}`).join('  ')}`);
}
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(report, null, 2)); console.log(`\nWrote ${jsonOut}`); }

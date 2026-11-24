// Idea trials: whole assignments on the real engine, with the opponent's move drawn at random and told in prose.
//
//   node tools/ideas/trial.mjs --bots [--level prize]            scripted heroes only: which level makes reading matter
//   node tools/ideas/trial.mjs --level prize --seeds 20          the real model too (QUEST_MODEL, PROBE_TEMPERATURE)
//   TRIAL_ORDERS='...' picks the orders for the prose arm; --arms prose,labelled picks which prompts the model plays.
//
// What changes from the game, and only here:
//   - Each opponent's move is drawn at random every turn from its own routine (the same moves, in the same
//     proportions), from a seed. A fixed cycle can be counted; a drawn one has to be read.
//   - `prose` arm: the prompt gives the move as a sentence from tells.mjs (no SMASH, BRACING or WINDED label, no
//     checklist line for them) and the options do not state what the opponent will do.
//   - `labelled` arm: today's prompt, from the real protocol, on the same drawn fights. A control.
// Heroes compared on the same seeds:
//   model      the real local model, following standing orders.
//   keywords   a scripted hero that decides "big attack?" with keyword-bot.mjs (rules written without seeing tells.mjs).
//   no-read    the best scripted hero that ignores the opponent's move.
//   oracle     a scripted hero told the true move: what perfect reading is worth.
//   random     uniform picks.
// The scripted heroes are measurement tools, never a controller in the game.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../serve.mjs';
import * as G from '../../src/game.js';
import { decisionMessages } from '../../src/protocol.js';
import { FEINT_SHARE } from './tells.mjs';
import { rngOf, over, drawFight, step } from './drawn.mjs';
import { choose } from './keyword-bot.mjs';
import { openModel, messagesFor, MODEL, TEMPERATURE } from './llm.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const botsOnly = process.argv.includes('--bots');
const LEVEL = arg('--level', null);
const SEEDS = Number(arg('--seeds', 20));
const ARMS = arg('--arms', 'prose,labelled').split(',');

// Extra assignments for this experiment, built from the circuit's own stops. Not in the game.
//   smashers: the three opponents with a big attack, then home. Nothing to buy, no medic, no bench.
G.LEVELS.smashers = { title: 'Heavy hitters (experiment)', course: [0, 3, 5, 10, 11], turnLimit: Number(arg('--limit', 30)), stamps: ['boar'], champion: true, announced: true, presets: G.PRIZE_PRESETS,
  objective: s => `Earn the boar stamp, defeat the champion, return to camp, and submit the assignment before ${s.turnLimit} turns.` };
if (arg('--limit', null) && LEVEL && LEVEL !== 'smashers') G.LEVELS[LEVEL].turnLimit = Number(arg('--limit'));

// ---------- prompts ----------
const yes = value => value ? 'yes' : 'no';
function proseActions(s) {
  const e = s.enemy;
  return G.availableActions(s).map(a => {
    if (!e) return a;
    const base = heavy => Math.max(1, (heavy ? 12 : 6) + s.sword - e.armor);
    const finish = style => G.strikeDamage(s, style) >= e.hp ? ` Defeats ${e.name}.` : '';
    if (a.id === 'quick') return { ...a, detail: `${base(false)} damage, recover 1 stamina.${finish('quick')}` };
    if (a.id === 'heavy') return { ...a, detail: `${e.agile ? `${base(true)} damage, but only 3 unless this enemy is out of breath.` : `${base(true)} damage.`} Costs 2 stamina.${finish('heavy')}` };
    if (a.id === 'guard') return { ...a, detail: `Deal no damage. Block up to ${G.guardBlock(s)} damage and recover 1 stamina. If you guard the enemy's big attack, you also counter for ${G.counterDamage(s)}.` };
    if (a.id === 'potion') return { ...a, detail: `${s.hp <= G.LOW_HP ? 'Your health is LOW. ' : ''}Restore up to ${G.POTION_HP} HP. ${s.potions} potions left. Takes one turn.` };
    return a;
  });
}
function proseFacts(s) {
  const o = G.observation(s);
  const e = s.enemy;
  const check = `CHECKLIST\n- Health LOW: ${yes(o.hero.healthStatus === 'LOW')}\n- Optional prize fight: ${yes(e?.optional)}`;
  return [
    `Location: ${o.location}. Turn ${o.progress.turn} of ${o.progress.turnLimit}.`,
    `Your health is ${o.hero.hp} out of ${o.hero.maxHp}. Health status: ${o.hero.healthStatus}. You have ${o.hero.potions} healing potions, ${o.hero.stamina} stamina, and ${o.hero.coins} coins.`,
    `Training stamps collected: ${o.progress.stamps.length} of ${o.progress.targetStamps}. ${o.progress.requiresChampion ? `Champion defeated: ${yes(o.progress.championDefeated)}.` : 'This assignment has no champion fight.'}`,
    !e ? `You are not currently in a fight.\n${check}`
      : `Enemy: ${e.name}, ${e.hp} of ${e.maxHp} health. ${e.armor ? `This enemy is armored: it blocks ${e.armor} of every strike.` : 'This enemy is not armored.'}${e.agile ? ' This enemy is agile and evades heavy attacks unless it is out of breath.' : ''} ${e.optional ? 'This is an optional prize fight.' : e.stamp ? 'This fight gives a required training stamp.' : 'This is the champion fight.'}\nEnemy's move this turn: ${G.nextMove(e).tell}\n${check}`,
  ].join('\n');
}
function promptFor(s, orders, arm) {
  if (arm === 'labelled') { const actions = G.availableActions(s); return { messages: decisionMessages(orders, G.observation(s), actions), ids: actions.map(a => a.id) }; }
  const actions = proseActions(s);
  return { messages: messagesFor(orders, proseFacts(s), actions), ids: actions.map(a => a.id), facts: proseFacts(s), actions };
}

// ---------- scripted heroes ----------
const DIMENSIONS = { attack: ['quick', 'heavy', 'smart'], heal: ['never', 'low', 'any'], optional: ['fight', 'skip'], services: ['use', 'skip'], shop: ['none', 'sword', 'buckler', 'potion', 'all'] };
const SHOP_ORDER = { none: [], sword: ['buy_sword'], buckler: ['buy_buckler'], potion: ['buy_potion'], all: ['buy_sword', 'buy_buckler', 'buy_potion'] };
const STYLES = Object.entries(DIMENSIONS).reduce((list, [dim, options]) => list.flatMap(style => options.map(o => ({ ...style, [dim]: o }))), [{}]);
const styleName = style => Object.values(style).join('/');
/** `reader`: 'none' ignores the move; 'oracle' is told it; 'keywords' reads the same prose prompt as the model. */
function scripted(style, reader) {
  return s => {
    const offered = G.availableActions(s).map(a => a.id);
    const has = id => offered.includes(id);
    const e = s.enemy;
    const hurt = style.heal === 'any' ? s.hp < s.maxHp : style.heal === 'low' ? s.hp <= G.LOW_HP : false;
    if (e) {
      if (e.optional && style.optional === 'skip') return 'retreat';
      if (has('potion') && hurt) return 'potion';
      const big = reader === 'oracle' ? G.nextMove(e).kind === 'smash' : reader === 'keywords' ? choose('tells', 'a', proseFacts(s), proseActions(s)) === 'guard' : false;
      if (big && has('guard')) return 'guard';
      if (style.attack === 'heavy' && has('heavy')) return 'heavy';
      if (style.attack === 'smart' && has('heavy') && !e.agile) return 'heavy';
      return 'quick';
    }
    if (has('potion') && hurt) return 'potion';
    if (style.services === 'use') for (const id of ['medic', 'rest']) if (has(id)) return id;
    for (const id of SHOP_ORDER[style.shop]) if (has(id)) return id;
    for (const id of ['finish', 'depart', 'advance']) if (has(id)) return id;
    return offered[0];
  };
}
const randomHero = rng => s => { const offered = G.availableActions(s); return offered[Math.floor(rng() * offered.length)].id; };
function play(level, seed, policy) {
  let s = G.newGame(level);
  while (!over(s)) s = step(s, policy(s), seed);
  return s;
}
const winRate = (level, seeds, policyOf) => seeds.filter(seed => play(level, seed, policyOf(seed)).status === 'won').length / seeds.length;
const range = (from, n) => Array.from({ length: n }, (_, i) => from + i);
const pct = x => `${Math.round(100 * x)}%`.padStart(4);

/** The best style for a reader, chosen on one set of seeds and scored on another. */
function bestStyle(level, reader, { train = range(10000, 150), test = range(20000, 600) } = {}) {
  const ranked = STYLES.map(style => ({ style, train: winRate(level, train, () => scripted(style, reader)) })).sort((a, b) => b.train - a.train);
  const best = ranked[0];
  return { style: best.style, name: styleName(best.style), train: best.train, test: winRate(level, test, () => scripted(best.style, reader)) };
}
function botReport(level) {
  const limit = G.LEVELS[level].turnLimit;
  const readers = Object.fromEntries(['none', 'keywords', 'oracle'].map(reader => [reader, bestStyle(level, reader)]));
  const random = winRate(level, range(20000, 600), seed => randomHero(rngOf(seed + 99)));
  console.log(`\n${G.LEVELS[level].title} (${level}), ${limit} turns, moves drawn at random, 600 seeds:`);
  console.log(`  oracle    ${pct(readers.oracle.test)}   best style ${readers.oracle.name}`);
  console.log(`  keywords  ${pct(readers.keywords.test)}   best style ${readers.keywords.name}`);
  console.log(`  no-read   ${pct(readers.none.test)}   best style ${readers.none.name}`);
  console.log(`  random    ${pct(random)}`);
  return readers;
}

// ---------- the model ----------
async function playModel(model, level, seeds, orders, arm) {
  const trials = seeds.map(seed => ({ seed, s: drawFight(G.newGame(level), seed), decisions: [] }));
  for (;;) {
    const waiting = [];
    for (const t of trials) {
      // A single offered action is a forced move in the game: the model is not asked.
      while (!over(t.s) && G.availableActions(t.s).length === 1) t.s = step(t.s, G.availableActions(t.s)[0].id, t.seed);
      if (!over(t.s)) waiting.push(t);
    }
    if (!waiting.length) break;
    const answers = await model.askAll(waiting.map(t => { const p = promptFor(t.s, orders, arm); return { messages: p.messages, ids: p.ids }; }));
    waiting.forEach((t, i) => {
      const m = G.nextMove(t.s.enemy);
      t.decisions.push({ turn: t.s.turn + 1, at: G.currentTile(t.s).name, hp: t.s.hp, move: m?.kind || null, feint: m?.feint || false, tell: m?.tell || null, action: answers[i].action });
      t.s = step(t.s, answers[i].action, t.seed);
    });
    process.stdout.write(`\r  ${arm}: ${trials.filter(t => over(t.s)).length} of ${trials.length} trials finished`);
  }
  process.stdout.write('\n');
  return trials.map(t => {
    const d = t.decisions;
    const fights = d.filter(x => x.move);
    const count = (list, action) => list.filter(x => x.action === action).length;
    const smashes = fights.filter(x => x.move === 'smash');
    const others = fights.filter(x => x.move !== 'smash');
    return {
      seed: t.seed, won: t.s.status === 'won', turns: t.s.turn, hp: t.s.hp, end: t.s.status === 'won' ? 'won' : t.s.hp === 0 ? `died at ${G.currentTile(t.s).name}` : `out of turns at ${G.currentTile(t.s).name}`,
      smashes: smashes.length, smashesGuarded: count(smashes, 'guard'), others: others.length, othersGuarded: count(others, 'guard'),
      feints: others.filter(x => x.feint).length, feintsGuarded: count(others.filter(x => x.feint), 'guard'),
      potions: count(d, 'potion'), retreats: count(d, 'retreat'), decisions: d,
    };
  });
}
function summarize(label, results) {
  const sum = key => results.reduce((n, r) => n + r[key], 0);
  const wins = results.filter(r => r.won).length;
  console.log(`  ${label.padEnd(18)} won ${wins} of ${results.length} (${pct(wins / results.length).trim()});  big attacks guarded ${sum('smashesGuarded')}/${sum('smashes')};  other moves guarded ${sum('othersGuarded')}/${sum('others')} (feints ${sum('feintsGuarded')}/${sum('feints')});  potions ${sum('potions')};  retreats ${sum('retreats')}`);
  const ends = Map.groupBy(results.filter(r => !r.won), r => r.end);
  if (ends.size) console.log(`  ${''.padEnd(18)} losses: ${[...ends].map(([end, list]) => `${list.length} ${end}`).join(', ')}`);
}

const ORDERS = {
  prose: process.env.TRIAL_ORDERS || 'Quick strike every turn, except: guard when the enemy is winding up for its big attack, and drink a potion when health is LOW.',
  labelled: process.env.TRIAL_ORDERS_LABELLED || 'Quick strike every turn, except: guard against a SMASH and drink a potion when health is LOW.',
};

if (botsOnly) {
  for (const level of LEVEL ? [LEVEL] : ['warning', 'prize', 'circuit', 'smashers']) botReport(level);
} else {
  const level = LEVEL || 'smashers';
  const seeds = range(1, SEEDS);
  const readers = botReport(level);
  console.log(`\nSame ${SEEDS} seeds as the model:`);
  const same = Object.fromEntries(Object.entries(readers).map(([reader, best]) => [reader, seeds.map(seed => play(level, seed, scripted(best.style, reader)).status === 'won')]));
  for (const [reader, wins] of Object.entries(same)) console.log(`  ${reader.padEnd(18)} won ${wins.filter(Boolean).length} of ${SEEDS}`);
  const model = await openModel();
  const record = { model: MODEL, temperature: TEMPERATURE, level, turnLimit: G.LEVELS[level].turnLimit, seeds: SEEDS, feintShare: FEINT_SHARE, bots: Object.fromEntries(Object.entries(readers).map(([reader, best]) => [reader, { style: best.name, winRate600: best.test, sameSeeds: same[reader] }])), arms: {} };
  try {
    for (const arm of ARMS) {
      console.log(`\nORDERS (${arm}): ${ORDERS[arm]}`);
      const results = await playModel(model, level, seeds, ORDERS[arm], arm);
      summarize(`model, ${arm}`, results);
      record.arms[arm] = { orders: ORDERS[arm], results };
    }
  } finally { await model.close(); }
  await mkdir(join(ROOT, 'artifacts'), { recursive: true });
  const file = `ideas-trial-${level}${arg('--tag', '') ? `-${arg('--tag')}` : ''}.json`;
  await writeFile(join(ROOT, 'artifacts', file), JSON.stringify(record, null, 1));
  console.log(`\nEvery decision is in artifacts/${file}`);
}

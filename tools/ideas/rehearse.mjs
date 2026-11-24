// Two things tried with the real model in the game's own labelled prompt (src/protocol.js), on the real engine:
//   rehearsal    before a trial, the model answers a fixed list of situations with the player's orders.
//                Does that list show what the hero will then do in the trial?
//   orders last  the standing orders repeated after the offered actions. Does the model follow them better?
//
//   node tools/ideas/rehearse.mjs --bots                          the plans played by a script, the situations (no model)
//   node tools/ideas/rehearse.mjs [--arms=plain,last] [--levels=warning,prize,circuit] [--seeds=3] [--tag=x]
//   node tools/ideas/rehearse.mjs --level=prize --plan=sword --orders='...' [--arm=plain]    one rehearsal, printed
//   node tools/ideas/rehearse.mjs --report [--tag=x]              tables from the record
//   (QUEST_MODEL and PROBE_TEMPERATURE as in probe.mjs)
//
// A plan is what the player means, as data. Each plan is written as four differently worded orders, fixed before
// any model run. A script that follows the plan exactly wins the assignment, so a lost trial is the model's
// following, and "what the orders mean" has an answer for every state: intended().
// The scripted heroes here are measurement tools, never a controller in the game.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../serve.mjs';
import * as G from '../../src/game.js';
import { decisionMessages, APPLYING_ORDERS, checklist } from '../../src/protocol.js';
import { drillFor } from '../../src/drill.js';
import { SITUATIONS as PROBE } from '../probe.mjs';
import { drawFight, step, over } from './drawn.mjs';
import { openModel, MODEL, TEMPERATURE } from './llm.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
// --set=fresh: the same nine plans worded by a second author (tools/ideas/orders-fresh.mjs), kept apart from tuning.
const SET = arg('set') || 'dev';
const FILE = join(ROOT, 'artifacts', `ideas-rehearse-${MODEL}${SET === 'dev' ? '' : `-${SET}`}${arg('tag') ? `-${arg('tag')}` : ''}.json`);

// ---------- plans and their wordings ----------
const QUICK = { attack: 'quick', guard: true };
const HEAL = { ...QUICK, low: 'potion' };
export const PLANS = {
  warning: { guard: QUICK, heal: HEAL, heavy: { attack: 'heavy', guard: true } },
  prize: { sword: { ...HEAL, optional: 'fight', shop: ['buy_sword'] }, frugal: HEAL, buckler: { ...HEAL, optional: 'fight', shop: ['buy_buckler'], medic: true } },
  circuit: { careful: HEAL, medic: { ...HEAL, medic: true }, sword: { ...HEAL, optional: 'fight', shop: ['buy_sword'] } },
};
// Four styles: the game's own example style, a numbered list, plain speech, and words the game's labels do not use.
const FIGHT = {
  list: 'If health is LOW: drink a potion.|If the enemy is about to SMASH: guard.|In every other fight turn: quick strike.',
  speech: 'In every fight keep hitting with quick strikes; guard only when the enemy is about to smash you, and drink a potion only when your health is low.',
  other: 'Fast, light attacks each turn; block whenever the opponent winds up for its big hit; heal yourself once you are badly hurt.',
};
const numbered = text => text.split('|').map((line, i) => `${i + 1}. ${line}`).join('\n');
export const ORDERS = {
  warning: {
    guard: {
      example: G.WARNING_PRESETS.careful,
      list: numbered('If the enemy is about to SMASH: guard.|In every other case: quick strike.'),
      speech: 'Keep hitting with quick strikes. The only time you stop is when an enemy is about to smash you: guard for that turn, then go back to quick strikes.',
      other: 'Use the fast, light attack each turn. Whenever the opponent winds up for its big hit, block instead of attacking.',
    },
    heal: {
      example: 'Quick strike every turn, except: guard against a SMASH and drink a potion when health is LOW.',
      list: numbered('If health is LOW: drink a potion.|If the enemy is about to SMASH: guard.|In every other case: quick strike.'),
      speech: 'Keep hitting with quick strikes. When an enemy is about to smash you, guard for that turn. If your health drops to low, drink a potion, but not before.',
      other: 'Use the fast, light attack each turn. Whenever the opponent winds up for its big hit, block instead. Heal yourself once you are badly hurt.',
    },
    heavy: {
      example: 'Heavy strike every turn, except: guard against a SMASH.',
      list: numbered('If the enemy is about to SMASH: guard.|In every other case: heavy strike.'),
      speech: 'Hit as hard as you can: use heavy strikes. The only time you stop is when an enemy is about to smash you: guard for that turn, then go back to heavy strikes.',
      other: 'Use the strong, slow attack each turn. Whenever the opponent winds up for its big hit, block instead of attacking.',
    },
  },
  prize: {
    sword: {
      example: G.PRIZE_PRESETS.careful,
      list: numbered(`${FIGHT.list}|Fight the prize bruiser.|At the armorer: buy the sharper sword and nothing else.|Do not rest on the bench.|At camp: submit the assignment at once.`),
      speech: `Take the prize fight against the bruiser, and spend the winnings on the sharper sword, nothing else. ${FIGHT.speech} Don't sit on the bench. Hand in the assignment as soon as you are back at camp.`,
      other: `Accept the side fight for money and use the money for the better blade, no other purchases. ${FIGHT.other} No resting on the way. Turn in the paperwork the moment you reach camp.`,
    },
    frugal: {
      example: 'Quick strike every turn, except: guard against a SMASH, drink a potion when health is LOW, and retreat from the optional prize fight. Buy nothing, skip the bench, and submit at camp as soon as you can.',
      list: numbered(`If this is the optional prize fight: retreat.|${FIGHT.list}|Buy nothing at the armorer.|Do not rest on the bench.|At camp: submit the assignment at once.`),
      speech: `Don't take the prize fight: walk away from the bruiser straight away. ${FIGHT.speech.replace('In every fight', 'In the other fights')} Keep your coins, don't sit on the bench, and hand in the assignment as soon as you are back at camp.`,
      other: `Turn down the side fight for money: leave it at once. ${FIGHT.other.replace('Fast, light attacks each turn', 'In the real fights use fast, light attacks each turn')} Spend nothing, no resting on the way, and turn in the paperwork the moment you reach camp.`,
    },
    buckler: {
      example: 'Quick strike every turn, except: guard against a SMASH and drink a potion when health is LOW. Fight the prize bruiser, visit the medic, buy only the buckler, skip the bench, and submit at camp as soon as you can.',
      list: numbered(`${FIGHT.list}|Fight the prize bruiser.|At the field medic: get treated.|At the armorer: buy the buckler and nothing else.|Do not rest on the bench.|At camp: submit the assignment at once.`),
      speech: `Take the prize fight against the bruiser, let the medic patch you up afterwards, and spend the winnings on the buckler, nothing else. ${FIGHT.speech} Don't sit on the bench. Hand in the assignment as soon as you are back at camp.`,
      other: `Accept the side fight for money, see the doctor after it, and use the money for the small shield, no other purchases. ${FIGHT.other} No resting on the way. Turn in the paperwork the moment you reach camp.`,
    },
  },
  circuit: {
    careful: {
      example: G.PRESETS.careful,
      list: numbered(`If this is the optional prize fight: retreat.|${FIGHT.list}`),
      speech: "Keep hitting with quick strikes in every fight. Guard only when the enemy is about to smash you, and drink a potion only when your health is low. Don't take the optional prize fight: walk away from the bruiser straight away.",
      other: 'Use fast, light attacks each turn. Block whenever the opponent winds up for its big hit, and heal yourself once you are badly hurt. Turn down the side fight for money: leave it at once.',
    },
    medic: {
      example: `${G.PRESETS.careful} Visit the medic.`,
      list: numbered(`If this is the optional prize fight: retreat.|${FIGHT.list}|At the field medic: get treated.`),
      speech: "Keep hitting with quick strikes in every fight. Guard only when the enemy is about to smash you, and drink a potion only when your health is low. Don't take the optional prize fight: walk away from the bruiser straight away. Do let the medic patch you up when you pass.",
      other: 'Use fast, light attacks each turn. Block whenever the opponent winds up for its big hit, and heal yourself once you are badly hurt. Turn down the side fight for money: leave it at once. See the doctor on the way.',
    },
    sword: {
      example: 'Quick strike every turn, except: guard against a SMASH and drink a potion when health is LOW. Fight the prize bruiser and buy only the sharper sword.',
      list: numbered(`${FIGHT.list}|Fight the prize bruiser.|At the armorer: buy the sharper sword and nothing else.`),
      speech: `Take the prize fight against the bruiser, and spend the winnings on the sharper sword, nothing else. ${FIGHT.speech}`,
      other: `Accept the side fight for money and use the money for the better blade, no other purchases. ${FIGHT.other}`,
    },
  },
};

// ---------- what a plan means in a state, and what kind of situation a state is ----------
/** The actions the plan allows here, the script's own choice first. Whatever the plan does not mention is not done. */
export function intended(plan, s) {
  const offered = G.availableActions(s).map(a => a.id);
  const has = id => offered.includes(id);
  const e = s.enemy;
  const potion = plan.low === 'potion' && s.hp <= G.LOW_HP && has('potion');
  if (e) {
    if (e.optional && plan.optional !== 'fight') return ['retreat'];
    const m = G.nextMove(e);
    const guard = plan.guard && m.kind === 'smash';
    // LOW and a SMASH at once: the orders give both exceptions, so either is following them.
    if (potion && guard) return s.hp <= m.damage - G.guardBlock(s) ? ['potion', 'guard'] : ['guard', 'potion'];
    if (potion) return ['potion'];
    if (guard) return ['guard'];
    return [plan.attack === 'heavy' && has('heavy') ? 'heavy' : 'quick'];
  }
  if (potion) return ['potion'];
  if (plan.medic && has('medic')) return ['medic'];
  for (const id of plan.shop || []) if (has(id)) return [id];
  return [offered.find(id => ['finish', 'depart', 'advance'].includes(id))];
}
/** Two names for a decision: `fine` tells opponents, stops and offers apart; `coarse` is what a short list would show. */
export function kinds(s) {
  const low = s.hp <= G.LOW_HP;
  const e = s.enemy;
  if (e) {
    const move = G.nextMove(e).kind;
    return { fine: `${e.name}, ${move}${low ? ', LOW' : ''}`, coarse: `${e.optional ? 'prize fight' : 'fight'}, ${move}${low ? ', LOW' : ''}` };
  }
  const tile = G.currentTile(s);
  const ids = G.availableActions(s).map(a => a.id);
  // Named by what is offered there, not by the stop: a beaten opponent's square or a used medic is just road.
  const buys = ids.filter(id => id.startsWith('buy_'));
  const place = ids.includes('medic') ? 'medic' : buys.length ? `shop (${buys.join('+')})` : ids.includes('rest') ? 'bench' : ids.includes('finish') ? 'camp, ready to submit' : 'road';
  return { fine: `${tile.name}, ${low ? 'LOW' : s.hp < s.maxHp ? 'hurt' : 'full health'}, offered ${ids.join('+')}`, coarse: `${place}, ${low ? 'LOW' : 'not LOW'}` };
}
const start = (level, seed) => seed == null ? G.newGame(level) : drawFight(G.newGame(level), seed);
const forced = s => G.availableActions(s).length === 1;
function playScript(level, seed, choose) {
  let s = start(level, seed);
  while (!over(s)) s = step(s, forced(s) ? G.availableActions(s)[0].id : choose(s), seed);
  return s;
}
/** The rehearsal list of an assignment: one state per fine kind that its plans meet when a script plays them, plus LOW health. */
export function situations(level) {
  const seen = new Map();
  const add = s => { if (!forced(s) && !seen.has(kinds(s).fine)) seen.set(kinds(s).fine, s); };
  for (const plan of Object.values(PLANS[level])) playScript(level, null, s => { add(s); return intended(plan, s)[0]; });
  const first = test => [...seen.values()].find(test);
  const fight = kind => first(s => s.enemy && !s.enemy.optional && G.nextMove(s.enemy).kind === kind);
  const road = first(s => !s.enemy && G.currentTile(s).kind === 'road');
  for (const s of [fight('strike'), fight('smash'), road].filter(Boolean)) add({ ...s, hp: 15 });
  return [...seen.values()].map(s => ({ ...kinds(s), s }));
}

// ---------- prompts ----------
const CLOSING = '\n\nChoose the next action according to your standing orders.';
const flatten = orders => orders.replace(/\s*\n+\s*/g, ' ').trim();
// Now shipped as APPLYING_ORDERS in src/protocol.js; kept here under its experiment name.
const APPLY = APPLYING_ORDERS;
const GLOSSARY = 'Players use their own words. In this game a light or fast attack is a Quick strike; a strong or slow attack is a Heavy strike; to block or defend is to Guard; to heal or drink is to Drink potion; a big hit, wind-up or charge is a SMASH; badly hurt or low on health is Health LOW; the side fight for money is the optional prize fight; the doctor is the medic; to hand in or turn in is to Submit the assignment.';
/** The system message with a paragraph added after the orders. */
function withSystem([system, user], orders, paragraph) {
  const head = `Follow these standing orders as your policy:\n\n${orders}\n\n`;
  if (!system.content.includes(head)) throw new Error('The game prompt no longer holds the orders as expected.');
  return [{ role: 'system', content: system.content.replace(head, `${head}${paragraph}\n\n`) }, user];
}
const WRONG_WINDED = 'It deals no damage, and your strikes deal double.';
function trueWinded([system, user]) {
  return [system, { ...user, content: user.content.replace(WRONG_WINDED, 'It deals no damage, and it cannot dodge this turn.') }];
}
const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The offered actions without the enemy's answer: what each would make the enemy deal, block or counter. */
function quietActions([system, user], s) {
  const e = s.enemy;
  if (!e || !G.LEVELS[s.level].announced) return [system, user];
  const m = G.nextMove(e), name = escapeRe(e.name), move = escapeRe(m.name);
  const answer = new RegExp(` ?(?:${name} answers with ${move}: you take \\d+\\.|${name}'s ${move} \\(\\d+\\) is blocked down to \\d+\\.(?: You counter for \\d+(?:, which defeats [^.]+)?\\.)?|${name} is not attacking this turn(?:, so there is nothing to block)?\\.)`, 'g');
  const full = G.availableActions(s).map(a => `${a.id}: ${a.label}. ${a.detail}`).join('\n');
  if (!user.content.includes(full)) throw new Error('The game prompt no longer lists the actions as expected.');
  const quiet = G.availableActions(s).map(a => `${a.id}: ${a.label}. ${a.detail.replace(answer, '').trim()}`).join('\n');
  return [system, { role: 'user', content: user.content.replace(full, quiet) }];
}
// ----- the plan: the hero's own reading of the orders, asked once per kind of situation before the trial -----
const GENERIC = {
  strike: 'An enemy makes an ordinary strike.', smash: 'An enemy is about to SMASH.', brace: 'An enemy is BRACING.', winded: 'An enemy is WINDED.',
  low: 'Your health is LOW in a fight.', prize: 'The optional prize fight.', medic: 'At the field medic, hurt.', shop: 'At the armorer, with coins to spend.',
  bench: 'At the bench, tired.', road: 'On the road, hurt but not LOW.', camp: 'Back at camp, ready to submit.',
};
const PLANS_READ = new Map();
const planKey = (orders, level) => `${level}\n${orders}`;
/** One question per drill kind: the situation in words, its checklist, and the actions it offers by name only. */
export function planQuestion(orders, item) {
  const actions = G.availableActions(item.state);
  return { ids: actions.map(a => a.id), messages: [
    { role: 'system', content: `You control one game hero. Follow these standing orders as your policy:\n\n${orders}\n\n${APPLYING_ORDERS}\n\nYou are planning before the trial. For the situation described, choose the action your standing orders call for. Return only JSON: {"action":"ID"}. Use an available action ID. Do not explain your choice or invent actions.` },
    { role: 'user', content: `SITUATION\n${GENERIC[item.id]}\n${checklist(G.observation(item.state))}\n\nAVAILABLE ACTIONS\n${actions.map(a => `${a.id}: ${a.label}.`).join('\n')}\n\nWhich action do your standing orders call for here?` },
  ] };
}
async function readPlans(model, list) {
  const asks = list.flatMap(o => drillFor(o.level).map(item => ({ o, item, ...planQuestion(o.orders, item) })));
  const answers = await model.askAll(asks.map(({ messages, ids }) => ({ messages, ids })));
  asks.forEach((a, i) => {
    const plan = PLANS[a.o.level][a.o.plan];
    (a.o.planRead ||= []).push({ id: a.item.id, action: answers[i].action, label: G.availableActions(a.item.state).find(x => x.id === answers[i].action).label, intended: plan ? intended(plan, a.item.state) : null });
  });
  for (const o of list) PLANS_READ.set(planKey(o.orders, o.level), o.planRead);
}
function withPlan([system, user], plan) {
  if (!plan) throw new Error('No plan has been read for these orders.');
  const anchor = '\n\nAVAILABLE ACTIONS';
  if (!user.content.includes(anchor)) throw new Error('The game prompt no longer lists the actions as expected.');
  const lines = plan.map(p => `- ${GENERIC[p.id]} ${p.label}.`).join('\n');
  return [system, { ...user, content: user.content.replace(anchor, `\n\nYOUR PLAN\nBefore the trial you read your orders like this. Follow the line that matches this turn:\n${lines}${anchor}`) }];
}

/** The offered actions as "id: label." only. */
function bareActions([system, user], s) {
  const full = G.availableActions(s).map(a => `${a.id}: ${a.label}. ${a.detail}`).join('\n');
  if (!user.content.includes(full)) throw new Error('The game prompt no longer lists the actions as expected.');
  return [system, { role: 'user', content: user.content.replace(full, G.availableActions(s).map(a => `${a.id}: ${a.label}.`).join('\n')) }];
}
export const ARMS = {
  // The game's prompt, as shipped. Since 2026-11-24 it holds the `apply` paragraph in the assignments with a checklist,
  // and leaves the enemy's answer out of the action lines except on a SMASH turn (`focus` below).
  plain: (orders, s) => decisionMessages(orders, G.observation(s), G.availableActions(s)),
  // The prompt shipped until 2026-11-23, which the records made before then call `plain`. The candidates below were
  // written and tested on it.
  before: (orders, s) => {
    const [system, user] = decisionMessages(orders, G.observation(s), G.availableActions(s), { allAnswers: true });
    return [{ ...system, content: system.content.replace(`${APPLYING_ORDERS}\n\n`, '') }, user];
  },
  // The same, with the orders repeated after the offered actions (the wording of the earlier `last` variants).
  last: (orders, s) => {
    const [system, user] = ARMS.before(orders, s);
    if (!user.content.endsWith(CLOSING)) throw new Error('The game prompt no longer ends as expected.');
    return [system, { role: 'user', content: `${user.content.slice(0, -CLOSING.length)}\n\nYOUR STANDING ORDERS\n${orders}${CLOSING}` }];
  },
  // ----- Candidate changes to the context, written 2026-11-24 before the second author's orders were read. -----
  // flat: the orders on one line. A numbered list made the 3B guard every ordinary strike; the same rules on one line did not.
  flat: (orders, s) => ARMS.before(flatten(orders), s),
  // apply: one paragraph on how orders are applied: exceptions only when their condition holds, nothing unasked.
  apply: (orders, s) => withSystem(ARMS.before(orders, s), orders, APPLY),
  // glossary: the game's names for what players call things in their own words.
  glossary: (orders, s) => withSystem(ARMS.before(orders, s), orders, GLOSSARY),
  // bare: the offered actions by name only, without the damage each would deal and take, which tempts a tactical choice.
  bare: (orders, s) => bareActions(ARMS.before(orders, s), s),
  // Combinations.
  'flat+apply': (orders, s) => ARMS.apply(flatten(orders), s),
  'flat+apply+glossary': (orders, s) => withSystem(ARMS.before(flatten(orders), s), flatten(orders), `${APPLY}\n\n${GLOSSARY}`),
  'flat+apply+bare': (orders, s) => bareActions(ARMS['flat+apply'](orders, s), s),
  'all': (orders, s) => bareActions(ARMS['flat+apply+glossary'](orders, s), s),
  // quiet (written after the first tuning round): the offered actions without the sentence saying what the enemy does in
  // answer ("…: you take 3", "…is blocked down to 0"). "bare" showed that side-by-side comparison tempts the 3B to
  // guard ordinary strikes, and that the guard line's "Against the SMASH:" is what makes it guard a SMASH; this keeps that.
  quiet: (orders, s) => quietActions(ARMS.before(orders, s), s),
  'apply+quiet': (orders, s) => quietActions(ARMS.apply(orders, s), s),
  // focus (2026-11-24, after the trial test, on the then shipped prompt, `apply`): `quiet` only when the enemy is not
  // about to SMASH. Shipped afterwards; `plain` now gives the same prompt.
  // The damage comparison is what made the 3B guard a SMASH (42 of 48), and what made it guard ordinary strikes (255
  // departures in the trial test); this keeps it on the one turn where guarding pays.
  focus: (orders, s) => s.enemy && G.nextMove(s.enemy).kind !== 'smash' ? quietActions(ARMS.apply(orders, s), s) : ARMS.apply(orders, s),
  // plan (2026-11-24, after the trial test): before the trial the hero answers each kind of situation in plain words,
  // without the numbers of a real turn (compilePlans); each turn's prompt then lists those answers as its plan.
  plan: (orders, s) => withPlan(ARMS.plain(orders, s), PLANS_READ.get(planKey(orders, s.level))),
  // winded: the known prompt error corrected. The move line says a WINDED opponent takes double damage; the engine never
  // doubled it (GAME_NOTES, "Known prompt error"). What is true: no damage, and it cannot dodge.
  winded: (orders, s) => trueWinded(ARMS.before(orders, s)),
  'all+winded': (orders, s) => trueWinded(ARMS.all(orders, s)),
};
export const hash = messages => createHash('sha1').update(JSON.stringify(messages)).digest('hex').slice(0, 12);
const promptOf = (arm, orders, s) => { const messages = ARMS[arm](orders, s); return { messages, ids: G.availableActions(s).map(a => a.id), h: hash(messages) }; };
const send = prompts => prompts.map(({ messages, ids }) => ({ messages, ids }));

export async function rehearse(model, arm, level, plan, orders) {
  const list = situations(level);
  const prompts = list.map(x => promptOf(arm, orders, x.s));
  const answers = await model.askAll(send(prompts));
  return list.map((x, i) => ({ fine: x.fine, coarse: x.coarse, h: prompts[i].h, action: answers[i].action, intended: plan ? intended(plan, x.s) : null }));
}
/** Whole trials, all advanced together so the model is asked in batches. A single offered action is a forced move, as in the game. */
export async function playAll(model, arm, jobs, label) {
  const trials = jobs.map(j => ({ ...j, s: start(j.level, j.seed), decisions: [] }));
  for (;;) {
    const waiting = [];
    for (const t of trials) {
      while (!over(t.s) && forced(t.s)) t.s = step(t.s, G.availableActions(t.s)[0].id, t.seed);
      if (!over(t.s)) waiting.push(t);
    }
    if (!waiting.length) break;
    const prompts = waiting.map(t => promptOf(arm, t.orders, t.s));
    const answers = await model.askAll(send(prompts));
    waiting.forEach((t, i) => {
      t.decisions.push({ turn: t.s.turn + 1, at: G.currentTile(t.s).name, hp: t.s.hp, move: G.nextMove(t.s.enemy)?.kind || null, ...kinds(t.s), h: prompts[i].h, action: answers[i].action, intended: intended(t.plan, t.s) });
      t.s = step(t.s, answers[i].action, t.seed);
    });
    process.stdout.write(`\r  ${label}: ${trials.filter(t => over(t.s)).length} of ${trials.length} trials finished`);
  }
  process.stdout.write('\n');
  return trials.map(t => ({ seed: t.seed, status: t.s.status, turns: t.s.turn, hp: t.s.hp, end: t.s.status === 'won' ? 'won' : t.s.hp === 0 ? `died at ${G.currentTile(t.s).name}` : `out of turns at ${G.currentTile(t.s).name}`, decisions: t.decisions }));
}
const scriptOf = (level, plan, seed) => { const s = playScript(level, seed, state => intended(plan, state)[0]); return { status: s.status, turns: s.turn, hp: s.hp }; };

// ---------- report ----------
export const ok = d => d.intended.includes(d.action);
export const share = (n, d) => d ? `${n}/${d} (${Math.round(100 * n / d)}%)` : '–';
/** Exact two-sided sign test on the discordant pairs. */
export function mcnemar(b, c) {
  const n = b + c; if (!n) return 1;
  let p = 0; const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  for (let k = 0; k <= Math.min(b, c); k++) p += choose(n, k);
  return Math.min(1, 2 * p / 2 ** n);
}
/** What the rehearsal answers predict: a hero that looks every decision up in the list, played on the engine. No model. */
function forecast(level, seed, rehearsal) {
  const fine = new Map(rehearsal.map(r => [r.fine, r.action]));
  const coarse = new Map(); for (const r of rehearsal) if (!coarse.has(r.coarse)) coarse.set(r.coarse, r.action);
  let unknown = 0;
  const s = playScript(level, seed, state => {
    const offered = G.availableActions(state).map(a => a.id);
    const k = kinds(state);
    const answer = fine.get(k.fine) ?? coarse.get(k.coarse);
    if (offered.includes(answer)) return answer;
    unknown++;
    return state.enemy ? 'quick' : offered.find(id => ['finish', 'depart', 'advance'].includes(id));
  });
  return { status: s.status, turns: s.turn, unknown };
}
/** Rehearsal answers as the plan intends, per prompt: overall, per wording style and per group of situations, each prompt paired with the first. */
function rehearsalTable(record, arms, rows, styles) {
  const group = r => {
    const c = r.coarse, low = c.includes(', LOW') ? ' LOW' : '';
    if (c.startsWith('prize fight')) return 'prize fight';
    if (c.startsWith('fight')) return `fight: ${c.split(', ')[1]}${low}`;
    return `${c.split(/[ ,]/)[0]}${low}`;
  };
  const groups = [...new Set(rows(arms[0]).flatMap(o => o.rehearsal.map(group)))].sort();
  const pct = (l) => l.length ? `${l.filter(ok).length}/${l.length}` : '–';
  console.log('\n=== Rehearsal answers as the plan intends, per prompt');
  const w = 22;
  console.log(`  ${''.padEnd(w)}${arms.map(a => a.padStart(Math.max(10, a.length + 2))).join('')}`);
  const line = (label, pick) => console.log(`  ${label.padEnd(w)}${arms.map(a => pct(rows(a).flatMap(pick)).padStart(Math.max(10, a.length + 2))).join('')}`);
  line('all', o => o.rehearsal);
  for (const st of styles) line(`wording ${st}`, o => o.style === st ? o.rehearsal : []);
  for (const level of [...new Set(rows(arms[0]).map(o => o.level))]) line(`assignment ${level}`, o => o.level === level ? o.rehearsal : []);
  for (const g of groups) line(g, o => o.rehearsal.filter(r => group(r) === g));
  if (arms.some(a => rows(a).some(o => o.planRead))) line('plan lines read', o => o.planRead || []);
  // Orders whose hero guards an ordinary strike in rehearsal: in the 3B run every such orders lost all its trials.
  const guards = o => o.rehearsal.some(r => r.coarse.startsWith('fight, strike') && r.action === 'guard' && !r.intended.includes('guard'));
  console.log(`  ${'orders guarding a strike'.padEnd(w)}${arms.map(a => String(rows(a).filter(guards).length).padStart(Math.max(10, a.length + 2))).join('')}`);
  for (const a of arms.slice(1)) {
    const x = rows(arms[0]).flatMap(o => o.rehearsal), y = rows(a).flatMap(o => o.rehearsal);
    let b = 0, c = 0; x.forEach((r, i) => { if (ok(r) && !ok(y[i])) b++; if (!ok(r) && ok(y[i])) c++; });
    console.log(`  ${a} against ${arms[0]}: better in ${c} situations, worse in ${b}; exact p = ${mcnemar(b, c).toFixed(3)}`);
  }
}
function report(record) {
  const arms = Object.keys(record.arms);
  const rows = arm => record.arms[arm].orders;
  const trialsOf = (arm, test = () => true) => rows(arm).flatMap(o => o.trials.map(t => ({ ...t, o }))).filter(test);
  const LEVELS = [...new Set(rows(arms[0]).map(o => o.level))], STYLES = [...new Set(rows(arms[0]).map(o => o.style))];
  console.log(`\n${record.model}, temperature ${record.temperature}; ${rows(arms[0]).length} orders (${record.set || 'dev'} set: ${LEVELS.join(', ')}; wordings ${STYLES.join(', ')}); trials: ${record.trials === false ? 'none (rehearsals only)' : `the game as it is, plus drawn moves on seeds ${record.seeds.join(', ')}`}`);
  rehearsalTable(record, arms, rows, STYLES);
  if (record.trials === false) return;

  console.log('\n=== The 13 probe situations (careful circuit orders; 11 of 13 recorded for the shipped prompt)');
  for (const arm of arms) console.log(`  ${arm.padEnd(6)} ${record.arms[arm].probe.filter(p => p.action === p.wanted).length} of 13   misses: ${record.arms[arm].probe.filter(p => p.action !== p.wanted).map(p => `${p.label} → ${p.action}`).join('; ') || 'none'}`);

  console.log('\n=== Following the orders, per prompt');
  for (const arm of arms) {
    console.log(`  ${arm}`);
    const reh = rows(arm).flatMap(o => o.rehearsal);
    const dec = trialsOf(arm).flatMap(t => t.decisions);
    console.log(`    rehearsal answers as the plan intends: ${share(reh.filter(ok).length, reh.length)};  trial decisions as intended: ${share(dec.filter(ok).length, dec.length)}`);
    for (const level of LEVELS) {
      const game = trialsOf(arm, t => t.o.level === level && t.seed == null), drawn = trialsOf(arm, t => t.o.level === level && t.seed != null);
      const d = [...game, ...drawn].flatMap(t => t.decisions);
      console.log(`    ${level.padEnd(8)} game as it is: won ${share(game.filter(t => t.status === 'won').length, game.length)};  drawn moves: won ${share(drawn.filter(t => t.status === 'won').length, drawn.length)} (script ${drawn.filter(t => record.script[`${level}/${t.o.plan}/${t.seed}`].status === 'won').length});  decisions as intended ${share(d.filter(ok).length, d.length)}`);
    }
    for (const style of STYLES) {
      const t = trialsOf(arm, x => x.o.style === style), d = t.flatMap(x => x.decisions);
      console.log(`    wording "${style}":`.padEnd(24) + `won ${share(t.filter(x => x.status === 'won').length, t.length)};  decisions as intended ${share(d.filter(ok).length, d.length)}`);
    }
    const wrong = Map.groupBy(dec.filter(d => !ok(d)), d => `${d.coarse} → ${d.action} (wanted ${d.intended[0]})`);
    console.log(`    commonest departures: ${[...wrong].sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([k, v]) => `${v.length}× ${k}`).join('; ')}`);
  }

  for (const other of arms.filter(a => a !== 'plain' && arms.includes('plain'))) {
    console.log(`\n=== plain against ${other}, paired`);
    const pair = (a, b, good) => { let both = 0, onlyA = 0, onlyB = 0, neither = 0; a.forEach((x, i) => { const p = good(x), q = good(b[i]); p && q ? both++ : p ? onlyA++ : q ? onlyB++ : neither++; }); return `both ${both}, plain only ${onlyA}, ${other} only ${onlyB}, neither ${neither}; exact p = ${mcnemar(onlyA, onlyB).toFixed(3)}`; };
    console.log(`  rehearsal situations (the same states), answered as intended: ${pair(rows('plain').flatMap(o => o.rehearsal), rows(other).flatMap(o => o.rehearsal), ok)}`);
    console.log(`  trials won (same orders, same seed): ${pair(trialsOf('plain'), trialsOf(other), t => t.status === 'won')}`);
    for (const level of LEVELS) console.log(`    ${level.padEnd(8)} ${pair(trialsOf('plain', t => t.o.level === level), trialsOf(other, t => t.o.level === level), t => t.status === 'won')}`);
    for (const style of STYLES) console.log(`    wording ${style.padEnd(8)} ${pair(trialsOf('plain', t => t.o.style === style), trialsOf(other, t => t.o.style === style), t => t.status === 'won')}`);
  }

  console.log('\n=== Does the rehearsal show what the hero then does?');
  for (const arm of arms) {
    console.log(`  ${arm}`);
    let same = 0, sameAgree = 0;
    const tally = { fine: [0, 0], coarse: [0, 0], none: 0, all: 0 };
    const cells = new Map();    // orders × coarse kind: was the rehearsal answer wrong, and how often did the trial depart
    for (const o of rows(arm)) {
      const byHash = new Map(o.rehearsal.map(r => [r.h, r])), fine = new Map(o.rehearsal.map(r => [r.fine, r]));
      const coarse = new Map(); for (const r of o.rehearsal) if (!coarse.has(r.coarse)) coarse.set(r.coarse, r);
      for (const t of o.trials) for (const d of t.decisions) {
        tally.all++;
        if (byHash.has(d.h)) { same++; if (byHash.get(d.h).action === d.action) sameAgree++; }
        const f = fine.get(d.fine), c = coarse.get(d.coarse);
        if (f) { tally.fine[1]++; if (f.action === d.action) tally.fine[0]++; }
        if (c) { tally.coarse[1]++; if (c.action === d.action) tally.coarse[0]++; } else tally.none++;
        if (c) { const key = `${o.level}/${o.plan}/${o.style}/${d.coarse}`; const cell = cells.get(key) || cells.set(key, { flagged: !ok(c), n: 0, bad: 0 }).get(key); cell.n++; if (!ok(d)) cell.bad++; }
      }
    }
    console.log(`    the very same prompt in rehearsal and trial: same answer ${share(sameAgree, same)}`);
    console.log(`    trial decisions that match the rehearsal answer for their kind: full list ${share(...tally.fine)} of those it covers; short list ${share(...tally.coarse)}; of ${tally.all} decisions, ${tally.none} are of a kind in neither list`);
    const list = [...cells.values()], flagged = list.filter(c => c.flagged), clean = list.filter(c => !c.flagged);
    const sum = (l, k) => l.reduce((n, c) => n + c[k], 0);
    console.log(`    kinds where the rehearsal answer was not what the plan intends (${flagged.length}): the trials departed from the plan in ${share(sum(flagged, 'bad'), sum(flagged, 'n'))} of those decisions`);
    console.log(`    kinds where the rehearsal answer was as intended (${clean.length}): departed in ${share(sum(clean, 'bad'), sum(clean, 'n'))}`);
    const departures = trialsOf(arm).flatMap(t => t.decisions).filter(d => !ok(d)).length;
    console.log(`    of all ${departures} departures in trials, ${sum(flagged, 'bad')} were in a kind the short list had flagged`);
    // Trial level: a rehearsal with nothing wrong, and the forecast a look-up hero gives.
    const won = l => l.filter(t => t.status === 'won').length;
    const wrongOf = o => o.rehearsal.filter(r => !ok(r)).length;
    // The orders in three equal groups, from the cleanest rehearsal to the worst.
    const ranked = [...rows(arm)].sort((x, y) => wrongOf(x) - wrongOf(y)), third = Math.ceil(ranked.length / 3);
    console.log(`    trials won, by rehearsal: ${[0, 1, 2].map(i => ranked.slice(i * third, (i + 1) * third)).filter(l => l.length).map(l => `${wrongOf(l[0])}–${wrongOf(l.at(-1))} answers not as intended: ${share(won(l.flatMap(o => o.trials)), l.flatMap(o => o.trials).length)}`).join(';  ')}`);
    // The rehearsal as a way to choose between the wordings of one plan, before any trial.
    const rate = o => won(o.trials) / o.trials.length, mean = l => l.reduce((n, x) => n + x, 0) / l.length;
    const plans = [...Map.groupBy(rows(arm), o => `${o.level}/${o.plan}`).values()];
    const picked = plans.map(l => { const top = Math.min(...l.map(wrongOf)); return mean(l.filter(o => wrongOf(o) === top).map(rate)); });
    const pc = x => `${Math.round(100 * x)}%`;
    console.log(`    choosing a wording per plan: a wording taken at random wins ${pc(mean(plans.map(l => mean(l.map(rate)))))} of its trials; the one with the cleanest rehearsal ${pc(mean(picked))}; the best one in hindsight ${pc(mean(plans.map(l => Math.max(...l.map(rate)))))}`);
    const all = trialsOf(arm).map(t => ({ t, f: forecast(t.o.level, t.seed, t.o.rehearsal) }));
    const agree = l => l.filter(x => x.f.status === x.t.status).length;
    const g = all.filter(x => x.t.seed == null), dr = all.filter(x => x.t.seed != null);
    console.log(`    forecast from the rehearsal alone (a look-up hero on the engine): right about won or lost in ${share(agree(g), g.length)} of games as they are, ${share(agree(dr), dr.length)} with drawn moves; same turn count in ${share(g.filter(x => x.f.turns === x.t.turns).length, g.length)} and ${share(dr.filter(x => x.f.turns === x.t.turns).length, dr.length)}`);
    console.log(`      forecast won, trial lost: ${all.filter(x => x.f.status === 'won' && x.t.status !== 'won').length};  forecast lost, trial won: ${all.filter(x => x.f.status !== 'won' && x.t.status === 'won').length};  look-ups with no usable answer: ${all.reduce((n, x) => n + x.f.unknown, 0)}`);
  }

  if (process.argv.includes('--orders-table')) for (const arm of arms) {
    console.log(`\n=== Every orders, ${arm}: rehearsal answers not as intended, and the trials`);
    for (const o of rows(arm)) {
      const bad = o.rehearsal.filter(r => !ok(r));
      console.log(`  ${o.level}/${o.plan}/${o.style}: rehearsal ${o.rehearsal.length - bad.length}/${o.rehearsal.length}; trials ${o.trials.map(t => `${t.seed ?? 'game'}:${t.status === 'won' ? `won t${t.turns}` : t.end}`).join(', ')}`);
      for (const r of bad) console.log(`      ✗ ${r.fine} → ${r.action} (plan: ${r.intended.join(' or ')})`);
    }
  }
}

// ---------- main ----------
// Only when run directly: imported, this file lends its plans and situations and asks no model.
if (process.argv[1]?.endsWith('ideas/rehearse.mjs')) {
  if (process.argv.includes('--report')) report(JSON.parse(await readFile(FILE, 'utf8')));
  else if (process.argv.includes('--bots')) {
    for (const [level, plans] of Object.entries(PLANS)) {
      const list = situations(level);
      console.log(`\n${G.LEVELS[level].title} (${level}): ${list.length} rehearsal situations, ${new Set(list.map(x => x.coarse)).size} in the short list`);
      for (const x of list) console.log(`    ${x.fine}   [${x.coarse}]`);
      for (const [name, plan] of Object.entries(plans)) {
        const game = scriptOf(level, plan, null), drawn = Array.from({ length: 200 }, (_, i) => scriptOf(level, plan, i + 1));
        console.log(`  plan ${name.padEnd(8)} script: ${game.status} on turn ${game.turns} of ${G.LEVELS[level].turnLimit}; drawn moves ${drawn.filter(r => r.status === 'won').length}/200`);
      }
    }
  } else if (arg('orders')) {
    const level = arg('level') || 'circuit', plan = PLANS[level][arg('plan')] || null, armName = arg('arm') || 'plain';
    const model = await openModel({ quiet: true });
    try {
      const table = await rehearse(model, armName, level, plan, arg('orders').replace(/\\n/g, '\n'));
      console.log(`\n${level}, ${armName} prompt. ORDERS: ${arg('orders')}`);
      for (const r of table) console.log(`  ${plan ? (ok(r) ? '✓' : '✗') : ' '} ${r.fine.padEnd(72)} → ${r.action}${plan && !ok(r) ? `   (plan: ${r.intended.join(' or ')})` : ''}`);
      if (plan) console.log(`  ${table.filter(ok).length} of ${table.length} as the plan intends`);
      if (process.argv.includes('--play')) {
        if (!plan) throw new Error('--play needs --plan, to say which decisions follow the orders.');
        const seeds = [null, ...Array.from({ length: Number(arg('seeds') ?? 3) }, (_, i) => i + 1)];
        const results = await playAll(model, armName, seeds.map(seed => ({ seed, level, plan, orders: arg('orders').replace(/\\n/g, '\n') })), 'trials');
        for (const t of results) console.log(`  ${String(t.seed ?? 'game').padEnd(5)} ${t.status === 'won' ? `won on turn ${t.turns}` : t.end}, ${t.hp} HP; ${t.decisions.filter(ok).length} of ${t.decisions.length} decisions as intended${t.decisions.some(d => !ok(d)) ? `; departures: ${[...Map.groupBy(t.decisions.filter(d => !ok(d)), d => `${d.coarse} → ${d.action}`)].map(([k, v]) => `${v.length}× ${k}`).join(', ')}` : ''}`);
      }
    } finally { await model.close(); }
  } else {
    const arms = (arg('arms') || 'plain,last').split(','), levels = (arg('levels') || 'warning,prize,circuit').split(',');
    const seeds = Array.from({ length: Number(arg('seeds') ?? 3) }, (_, i) => i + 1);
    const SOURCE = SET === 'fresh' ? (await import('./orders-fresh.mjs')).FRESH : ORDERS;
    const trialsToo = !process.argv.includes('--no-trials');
    const all = levels.flatMap(level => Object.entries(SOURCE[level]).flatMap(([plan, styles]) => Object.entries(styles).map(([style, orders]) => ({ level, plan, style, orders }))));
    const record = { model: MODEL, temperature: TEMPERATURE, set: SET, trials: trialsToo, seeds, script: {}, arms: {} };
    for (const level of levels) for (const [name, plan] of Object.entries(PLANS[level])) for (const seed of [null, ...seeds]) record.script[`${level}/${name}/${seed}`] = scriptOf(level, plan, seed);
    const save = async () => { await mkdir(join(ROOT, 'artifacts'), { recursive: true }); await writeFile(FILE, JSON.stringify(record, null, 1)); };
    const model = await openModel();
    try {
      for (const arm of arms) {
        const mine = record.arms[arm] = { probe: [], orders: all.map(o => ({ ...o, rehearsal: [], trials: [] })) };
        if (arm === 'plan') {
          await readPlans(model, mine.orders);
          const read = mine.orders.flatMap(o => o.planRead);
          console.log(`\n##### plan: ${read.filter(ok).length} of ${read.length} plan lines as the plan intends`);
          // The probe's careful circuit orders need a plan of their own.
          await readPlans(model, [{ level: 'circuit', plan: 'careful', orders: G.PRESETS.careful }]);
        }
        // --reuse-plain, rehearsals only: the shipped prompt's answers come from the full record of the same model and set.
        // At temperature 0 the very same prompt got the very same answer 317 times of 317, so asking again adds nothing.
        if (arm === 'plain' && !trialsToo && process.argv.includes('--reuse-plain')) {
          const fullFile = join(ROOT, 'artifacts', `ideas-rehearse-${MODEL}${SET === 'dev' ? '' : `-${SET}`}.json`);
          if (fullFile === FILE) throw new Error('--reuse-plain needs a --tag, so that the full record is not overwritten.');
          const full = JSON.parse(await readFile(fullFile, 'utf8')).arms.plain;
          const known = new Map(full.orders.map(o => [o.orders, o]));
          if (!mine.orders.every(o => known.has(o.orders))) throw new Error('--reuse-plain: the full record lacks some of these orders.');
          mine.probe = full.probe;
          for (const o of mine.orders) o.rehearsal = known.get(o.orders).rehearsal;
          console.log(`\n##### plain: reused from the full record (probe ${mine.probe.filter(p => p.action === p.wanted).length} of 13)`);
          continue;
        }
        const probe = await model.askAll(send(PROBE.map(([, state]) => promptOf(arm, G.PRESETS.careful, state))));
        mine.probe = PROBE.map(([label, , wanted], i) => ({ label, wanted, action: probe[i].action }));
        console.log(`\n##### ${arm}: probe ${mine.probe.filter(p => p.action === p.wanted).length} of 13`);
        for (const [i, o] of mine.orders.entries()) {
          o.rehearsal = await rehearse(model, arm, o.level, PLANS[o.level][o.plan], o.orders);
          process.stdout.write(`\r  ${arm}: rehearsals ${i + 1} of ${mine.orders.length}`);
        }
        process.stdout.write('\n');
        await save();
        if (!trialsToo) continue;
        const jobs = mine.orders.flatMap((o, index) => [null, ...seeds].map(seed => ({ index, seed, level: o.level, plan: PLANS[o.level][o.plan], orders: o.orders })));
        const results = await playAll(model, arm, jobs, `${arm} trials`);
        jobs.forEach((j, i) => mine.orders[j.index].trials.push(results[i]));
        await save();
      }
    } finally { await model.close(); }
    console.log(`\nEvery decision is in ${FILE.replace(`${ROOT}/`, '')}`);
    report(record);
  }
}

// Unforeseen incidents: an idea tested with the real model before anything is built (user feedback 2026-11-24:
// "random elements/surprise not knowable beforehand during loop, where a dynamic llm model might respond better than
// predefined rules").
//
//   node tools/ideas/incidents.mjs --bots            the incidents drawn, and what heroes that do not read them score
//   node tools/ideas/incidents.mjs --probe [--n=6]   single decisions by the model (QUEST_MODEL, PROBE_TEMPERATURE)
//   node tools/ideas/incidents.mjs --report          tables from the record
//
// An incident is an offer met on the road, drawn at random with random terms: a tinker who hones the blade, a cart,
// a toll, a satchel in a ditch. The player cannot name them in advance, so the orders can only state a general
// stance ("take it if it costs no turn, walk on if it does"). Each option's exact terms are in its action line, as at
// the armorer. Whether the hero follows the stance is decided by the terms, not by judgement: a stance accepts an
// option when it costs none of what the stance protects, and prefers an offer to walking on when both qualify.
// Rules written before the trial cannot know the incidents; the comparison is with heroes that do not read them.
// The records of 2026-11-24 were made with the prompt shipped until then. The game's prompt has since gained the
// APPLYING_ORDERS paragraph in these assignments, so a new run asks with it.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../serve.mjs';
import * as G from '../../src/game.js';
import { decisionMessages } from '../../src/protocol.js';
import { rngOf } from './drawn.mjs';
import { ORDERS, situations } from './rehearse.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

// ---------- the incidents ----------
const WALK = { id: 'walk_on', label: 'Walk on', detail: 'Takes no turn. Nothing gained, nothing lost.', effect: {} };
const coinsText = (cost, s) => cost > 0 ? `Costs ${cost} of ${s.coins} coins.` : cost < 0 ? `Pays you ${-cost} coins.` : 'Free.';
const turnText = t => t > 0 ? 'Takes one turn.' : t < 0 ? 'Saves one turn: you reach the next stop a turn early.' : 'Takes no turn.';
const hpText = hp => hp > 0 ? `Restores ${hp} HP.` : hp < 0 ? `You lose ${-hp} HP.` : '';
const detail = (gain, e, s) => [gain, hpText(e.hp || 0), e.coins !== undefined ? coinsText(-(e.coins || 0), s) : '', turnText(e.turns || 0)].filter(Boolean).join(' ');
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/** Each kind draws its terms and returns { kind, text, options }. Two tellings per kind, so the words vary too. */
export const KINDS = {
  tinker: (rng, s) => {
    const e = { coins: -pick(rng, [0, 3]), turns: pick(rng, [0, 1]), hp: -pick(rng, [0, 0, 2]), sword: 1 };
    return { text: pick(rng, [
      `A tinker has set up a grinding wheel beside the path and offers to put a proper edge on your sword${e.coins ? '' : ', free, to advertise'}${e.hp ? '. The wheel throws a lot of sparks' : ''}.`,
      `"Blade looks tired," says a woman with a whetstone and a folding stool. "I can fix that${e.coins ? ', for a price' : ', no charge, I need the practice'}."`]),
      options: [{ id: 'hone', label: 'Have the blade honed', detail: detail('Every strike deals 1 more damage for the rest of the trial.', e, s), effect: e }, WALK] };
  },
  herbalist: (rng, s) => {
    const e = { hp: 10, coins: -pick(rng, [0, 2, 4]), turns: pick(rng, [0, 1]) };
    return { text: pick(rng, [
      'An herbalist waves you over to a stall of jars and poultices and looks pointedly at your bruises.',
      `A guild first-aider on a bicycle stops beside you. "That looks sore. Want it seen to?"`]),
      options: [{ id: 'treat', label: 'Get patched up', detail: detail('', e, s), effect: e }, WALK] };
  },
  cart: (rng, s) => {
    // A fast cart saves a turn and may be rough; a slow one costs a turn and lets you rest.
    const fast = rng() < 0.5;
    const e = fast ? { turns: -1, coins: -pick(rng, [0, 2]), hp: -pick(rng, [0, 4]) } : { turns: 1, coins: -pick(rng, [0, 2]), hp: 6 };
    return { text: fast
      ? pick(rng, [`A courier's wagon slows beside you. "Hop on, I'm going your way${e.coins ? ', fare is fare' : ''}."`, `A hay cart rattles up behind you and the driver offers a lift${e.hp ? '. The cart has no sides and the road is rough' : ''}.`])
      : pick(rng, ['An ox cart creaks past at walking pace. The driver offers you a seat on the hay.', `A slow wagon with a cushioned bench pulls up. "${e.coins ? 'Small fare. ' : ''}Take the weight off."`]),
      options: [{ id: 'ride', label: 'Ride along', detail: detail('', e, s), effect: e }, WALK] };
  },
  petition: (rng, s) => {
    const e = { coins: pick(rng, [-1, 0, 2]), turns: pick(rng, [0, 1]) };
    return { text: pick(rng, [
      `A clerk with a clipboard blocks the path, collecting signatures for a petition about the canteen${e.coins > 0 ? ', and paying for them' : e.coins < 0 ? '. There is a filing fee' : ''}.`,
      `"Survey for the guild's quarterly report," says a man in a cardigan. "${e.turns ? 'It is quite long. ' : 'Two questions. '}${e.coins > 0 ? 'There is a small honorarium.' : e.coins < 0 ? 'There is a processing charge.' : 'There is no honorarium.'}"`]),
      options: [{ id: 'sign', label: 'Sign and answer', detail: detail('', e, s), effect: e }, WALK] };
  },
  bookmaker: (rng, s) => {
    const e = { coins: -pick(rng, [0, 3]), turns: pick(rng, [0, 1]), bet: 6 };
    return { text: pick(rng, [
      `A bookmaker leaning on a signpost offers odds on your next fight${e.coins ? '' : '. "First bet is on the house."'}`,
      `"Fancy a flutter on yourself?" A bookmaker taps a chalkboard. "Win your next fight and I pay out.${e.turns ? ' Slip needs filling in, mind.' : ''}"`]),
      options: [{ id: 'bet', label: 'Bet on your next fight', detail: detail('Win your next fight and collect 6 coins.', e, s), effect: e }, WALK] };
  },
  satchel: (rng, s) => {
    const e = { potions: 1, turns: pick(rng, [0, 1]), hp: -pick(rng, [0, 3]), coins: -pick(rng, [0, 0, 2]) };
    return { text: pick(rng, [
      `A satchel lies in the ditch, a potion bottle poking out of it${e.hp ? ', among the nettles' : ''}.${e.coins ? ' Its owner appears and offers to sell it.' : ''}`,
      `Someone has dropped a healing potion ${e.turns ? 'at the bottom of a steep bank' : 'right by the path'}${e.hp ? ', in a bramble patch' : ''}.${e.coins ? ' A finder\'s fee is expected.' : ''}`]),
      options: [{ id: 'grab', label: 'Fetch the potion', detail: detail('One more potion.', e, s), effect: e }, WALK] };
  },
  toll: (rng, s) => {
    const pay = { coins: -2, turns: pick(rng, [0, 1]) };
    const around = rng() < 0.5 ? { turns: 1, hp: 0, coins: 0 } : { turns: 0, hp: -3, coins: 0 };
    return { text: pick(rng, [
      `A guild assessor has put a rope across the path and demands a path fee${pay.turns ? ', payable at a window with a queue' : ''}.`,
      `"Toll," says a bored official, pointing at a hand-painted sign${pay.turns ? ' and a long form' : ''}.`]) + (around.turns ? ' The long way round avoids him.' : ' You could climb the barbed fence instead.'),
      options: [{ id: 'pay', label: 'Pay the fee', detail: detail('', pay, s), effect: pay }, { id: 'around', label: around.turns ? 'Take the long way round' : 'Climb the fence', detail: detail('', around, s), effect: around }] };
  },
  gap: (rng, s) => {
    // A shortcut saves a turn and may scratch; a scenic path costs a turn and is restful. A farmer may charge.
    const short = rng() < 0.5;
    const e = short ? { turns: -1, hp: -pick(rng, [0, 3, 6]), coins: -pick(rng, [0, 1]) } : { turns: 1, hp: 5, coins: -pick(rng, [0, 1]) };
    return { text: short
      ? pick(rng, [`There is a gap in the hedge that would cut the corner to the next stop${e.hp ? ', through thorns' : ''}.`, `A shortcut! A narrow path through the ${e.hp ? 'brambles' : 'orchard'} leads straight to the next stop.`])
      : pick(rng, ['A sign points down a quiet orchard path: "Scenic route. Longer. Restful."', 'A shady lane winds the long way round, past a well of cool water.']) + (e.coins ? ' A farmer at the gate asks for a coin.' : ''),
      options: [{ id: 'path', label: short ? 'Take the shortcut' : 'Take the scenic route', detail: detail('', e, s), effect: e }, WALK] };
  },
};

// ---------- what the orders say about them ----------
const STANCES = {
  time: ['Anything unexpected on the road: take it if it costs no turn, walk past it if it does.',
    'Unplanned offers: accept the ones that take no time at all. If one would cost a turn, walk on.'],
  coins: ['Anything unexpected on the road: take it if it costs no coins, walk past it if it does.',
    'Unplanned offers: accept the ones that are free of charge. Anything with a price, walk on.'],
  health: ['Anything unexpected on the road: take it if it costs no health, walk past it if it does.',
    'Unplanned offers: accept the ones that leave your health alone. If one would hurt you, walk on.'],
};
const fits = (stance, e) => stance === 'time' ? (e.turns || 0) <= 0 : stance === 'coins' ? (e.coins || 0) >= 0 : (e.hp || 0) >= 0;
/** The options the stance allows: an offer that costs nothing it protects is taken; otherwise the hero walks on. */
export function intended(stance, incident) {
  const ok = incident.options.filter(o => fits(stance, o.effect));
  const offers = ok.filter(o => o.id !== 'walk_on');
  // A toll has no walking on: when neither option fits, the orders do not settle it, and either is following them.
  return (offers.length ? offers : ok.length ? ok : incident.options).map(o => o.id);
}

// ---------- the cases ----------
/** Out-of-fight states from each assignment's rehearsal list, hurt and with a few coins, so every option is open. */
function places() {
  return ['warning', 'prize', 'circuit'].flatMap(level => situations(level).filter(x => !x.s.enemy && G.availableActions(x.s).some(a => a.id === 'advance'))
    .slice(0, 3).map(x => ({ level, s: { ...x.s, hp: 28, coins: Math.max(x.s.coins, 6), potions: Math.max(1, x.s.potions) } })));
}
export function cases(n = 6) {
  const rng = rngOf(20261124);
  const where = places();
  const list = [];
  for (const kind of Object.keys(KINDS)) for (let i = 0; i < n; i++) {
    const at = where[Math.floor(rng() * where.length)];
    const incident = { kind, ...KINDS[kind](rng, at.s) };
    const plans = Object.keys(ORDERS[at.level]);
    const base = ORDERS[at.level][plans[Math.floor(rng() * plans.length)]].example;
    list.push({ kind, level: at.level, s: at.s, incident, base });
  }
  return list;
}
/**
 * The game's own prompt for that state, with the incident told after "You are not currently in a fight."
 * arm 'labels': the game also states each option's terms as yes or no, the way the checklist states the enemy's move.
 */
const yn = v => v ? 'yes' : 'no';
export const termsOf = o => `takes a turn: ${yn((o.effect.turns || 0) > 0)}; costs coins: ${yn((o.effect.coins || 0) < 0)}; costs health: ${yn((o.effect.hp || 0) < 0)}`;
export function messagesFor(orders, s, incident, arm = 'plain') {
  const [system, user] = decisionMessages(orders, G.observation(s), incident.options);
  const anchor = 'You are not currently in a fight.';
  if (!user.content.includes(anchor)) throw new Error('The game prompt no longer says where the hero is as expected.');
  let content = user.content.replace(anchor, `${anchor}\nSOMETHING UNEXPECTED: ${incident.text}`);
  if (arm === 'labels') content = content.replace('\n\nAVAILABLE ACTIONS', `\n\nTERMS OF EACH OPTION\n${incident.options.map(o => `- ${o.id}: ${termsOf(o)}`).join('\n')}\n\nAVAILABLE ACTIONS`);
  return [system, { ...user, content }];
}
const asked = list => list.flatMap(c => [
  { c, stance: null, wording: null, orders: c.base },
  ...Object.entries(STANCES).flatMap(([stance, words]) => words.map((w, wording) => ({ c, stance, wording, orders: `${c.base} ${w}` }))),
]);

// ---------- heroes that do not read the incident ----------
function noReading(rows) {
  const scored = rows.filter(r => r.stance);
  const right = choose => scored.filter(r => r.want.includes(choose(r))).length;
  const rngR = rngOf(7);
  const firstOffer = r => r.incident.options.find(o => o.id !== 'walk_on').id;
  // The best a hero can do knowing the stance and the kind of incident, but not its terms: one answer per pair.
  const best = (() => { let n = 0; for (const group of Map.groupBy(scored, r => `${r.stance}/${r.kind}`).values()) n += Math.max(...group[0].incident.options.map(o => group.filter(r => r.want.includes(o.id)).length)); return n; })();
  return { total: scored.length, accept: right(firstOffer), walk: right(r => r.incident.options.at(-1).id), random: right(r => pick(rngR, r.incident.options).id), best };
}

// ---------- main ----------
const ARM = arg('arm') || 'plain';
const FILE = join(ROOT, 'artifacts', `ideas-incidents-${process.env.QUEST_MODEL || 'Qwen2.5-3B-Instruct-q4f32_1-MLC'}${ARM === 'plain' ? '' : `-${ARM}`}.json`);
function report(record) {
  const rows = record.rows;
  const scored = rows.filter(r => r.stance);
  const share = (n, d) => `${n}/${d} (${Math.round(100 * n / d)}%)`;
  console.log(`\n${record.model}, temperature ${record.temperature}, prompt ${record.arm || 'plain'}: ${rows.length / 7} incidents, each asked with no stance and with 3 stances × 2 wordings`);
  const nr = noReading(rows);
  console.log(`  model, following the stance: ${share(scored.filter(r => r.want.includes(r.action)).length, scored.length)}`);
  console.log(`  heroes that do not read the incident: always the offer ${share(nr.accept, nr.total)}; always walk on ${share(nr.walk, nr.total)}; random ${share(nr.random, nr.total)}; best fixed answer per stance and kind ${share(nr.best, nr.total)}`);
  for (const stance of Object.keys(STANCES)) {
    const l = scored.filter(r => r.stance === stance);
    console.log(`    stance ${stance.padEnd(7)} ${share(l.filter(r => r.want.includes(r.action)).length, l.length)};  wording 1 ${share(l.filter(r => r.wording === 0 && r.want.includes(r.action)).length, l.length / 2)}, wording 2 ${share(l.filter(r => r.wording === 1 && r.want.includes(r.action)).length, l.length / 2)}`);
  }
  for (const kind of Object.keys(KINDS)) {
    const l = scored.filter(r => r.kind === kind);
    console.log(`    ${kind.padEnd(10)} ${share(l.filter(r => r.want.includes(r.action)).length, l.length)}   wrong: ${[...Map.groupBy(l.filter(r => !r.want.includes(r.action)), r => `${r.stance}→${r.action}`)].map(([k, v]) => `${v.length}× ${k}`).join(', ') || 'none'}`);
  }
  const free = rows.filter(r => !r.stance);
  console.log(`  with no stance in the orders, the hero took the offer ${free.filter(r => r.action !== 'walk_on').length} times of ${free.length}`);
  const accepts = scored.filter(r => r.action !== 'walk_on').length;
  console.log(`  took an offer in ${accepts} of ${scored.length} stance decisions; the stances call for one in ${scored.filter(r => !r.want.includes('walk_on')).length}`);
}

if (process.argv[1]?.endsWith('ideas/incidents.mjs')) {
  const n = Number(arg('n') || 6);
  if (process.argv.includes('--report')) report(JSON.parse(await readFile(FILE, 'utf8')));
  else if (process.argv.includes('--bots')) {
    const list = cases(n);
    const rows = asked(list).map(q => ({ kind: q.c.kind, stance: q.stance, incident: q.c.incident, want: q.stance ? intended(q.stance, q.c.incident) : null }));
    for (const c of list.slice(0, 16)) console.log(`  ${c.kind.padEnd(10)} ${c.incident.text}\n${c.incident.options.map(o => `      ${o.id}: ${o.label}. ${o.detail}`).join('\n')}\n      wanted — time: ${intended('time', c.incident)}, coins: ${intended('coins', c.incident)}, health: ${intended('health', c.incident)}`);
    const nr = noReading(rows);
    console.log(`\n${list.length} incidents, ${nr.total} stance decisions. Not reading: always the offer ${nr.accept}, always walk on ${nr.walk}, random ${nr.random}, best fixed per stance and kind ${nr.best}`);
    console.log(`\nAn example prompt:\n${messagesFor(`${list[0].base} ${STANCES.time[0]}`, list[0].s, list[0].incident, ARM).map(m => `[${m.role}]\n${m.content}`).join('\n')}`);
  } else if (process.argv.includes('--probe')) {
    const { openModel, MODEL, TEMPERATURE } = await import('./llm.mjs');
    const list = cases(n), qs = asked(list);
    const model = await openModel();
    try {
      const answers = await model.askAll(qs.map(q => ({ messages: messagesFor(q.orders, q.c.s, q.c.incident, ARM), ids: q.c.incident.options.map(o => o.id) })));
      const rows = qs.map((q, i) => ({ kind: q.c.kind, level: q.c.level, stance: q.stance, wording: q.wording, orders: q.orders, incident: q.c.incident, want: q.stance ? intended(q.stance, q.c.incident) : null, action: answers[i].action }));
      const record = { model: MODEL, temperature: TEMPERATURE, arm: ARM, n, rows };
      await mkdir(join(ROOT, 'artifacts'), { recursive: true });
      await writeFile(FILE, JSON.stringify(record, null, 1));
      report(record);
    } finally { await model.close(); }
  }
}

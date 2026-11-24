// The read-back loop, simulated: does a one-line amendment, of the kind a player writes after seeing the hero's
// read-back, fix what the hero misread, and does the trial then go better?
//
//   node tools/ideas/amend.mjs [--rounds=2] [--no-shuffled]     run (QUEST_MODEL as in probe.mjs; default the 3B)
//   node tools/ideas/amend.mjs --report                         tables from the record
//
// Start: the 36 fresh orders (tools/ideas/orders-fresh.mjs) and their rehearsals and trials under the prompt shipped
// when this ran (`apply`), taken from the fresh record's `apply` arm (checked by hash before use). Each round, a scripted
// "player" looks at what the last round showed them: the rehearsal (standing in for the read-back) and the trial they
// watched (the game as it is, no drawn moves). It counts the decisions that are not what the plan intends, picks the
// lesson with the most, and adds that lesson's sentence, written before any run, to the end of the orders. The amended orders are
// then rehearsed and played in the same trials (the game as it is, and drawn moves on seeds 1-3) for a paired
// comparison. The sentences use the words the read-back shows (SMASH, LOW, guard): a player answers what they saw.
//
// Also, unless --no-shuffled: the unamended orders of Fair warning and Prize money played in the game's own drawn
// move order (src/game.js, `newGame(level, seed)`, seeds 1-3), which no model had played yet.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../serve.mjs';
import * as G from '../../src/game.js';
import { PLANS, ARMS, situations, rehearse, playAll, intended, kinds, ok, hash, share, mcnemar } from './rehearse.mjs';
import { openModel, MODEL, TEMPERATURE } from './llm.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SOURCE = join(ROOT, 'artifacts', `ideas-rehearse-${MODEL}-fresh.json`);
// AMEND_DRY=1: no model, every decision the first offered action, to check the plumbing.
const DRY = !!process.env.AMEND_DRY;
// The prompt: `apply`, the one shipped when this ran (2026-11-24) and the one its baseline record used. Since `focus`
// shipped, `plain` differs from the baseline, so it is refused below.
const ARM = arg('arm') || 'apply';
const FILE = join(ROOT, 'artifacts', `ideas-amend-${DRY ? 'dry' : MODEL}.json`);

// ---------- the player's lessons, fixed before any run ----------
const isFight = d => /^fight/.test(d.coarse);
const isPrize = d => /^prize fight/.test(d.coarse);
/** Which lesson a misread answer teaches, or null. `plan` is the plan the orders mean. */
export function lessonOf(d, plan) {
  if (ok(d)) return null;
  const want = d.intended;
  if (want.includes('potion') && d.action !== 'potion') return 'low';
  if (isPrize(d) && want.includes('retreat')) return 'prize-retreat';
  if (isPrize(d) && d.action === 'retreat') return 'prize-fight';
  if (want.includes('guard')) return 'smash';
  if ((isFight(d) || isPrize(d)) && ['guard', 'retreat'].includes(d.action)) return 'strike';
  if ((isFight(d) || isPrize(d)) && want.includes('heavy')) return 'heavy';
  if ((isFight(d) || isPrize(d)) && d.action === 'heavy') return 'quick';
  if (d.action === 'potion') return 'potion';
  if (/^shop/.test(d.coarse)) return plan.shop ? 'shop-only' : 'shop-none';
  if (d.action === 'rest') return 'bench';
  if (d.action === 'medic') return 'medic-skip';
  if (want.includes('medic')) return 'medic-visit';
  if (want.includes('finish')) return 'camp';
  return 'other';
}
const ITEM = { buy_sword: 'the sharper sword', buy_buckler: 'the buckler' };
export const LESSONS = {
  low: () => 'When your health is LOW, drink a potion first, even in the middle of a fight.',
  'prize-retreat': () => 'If the bruiser offers the optional prize fight, retreat at once.',
  'prize-fight': () => 'Take the prize fight and finish it: do not retreat from the bruiser.',
  smash: () => 'When the enemy is about to SMASH, guard that turn.',
  strike: () => 'Against an ordinary strike, attack: guard only against a SMASH, and never retreat from a fight.',
  heavy: () => 'Attack with heavy strikes, not quick ones.',
  quick: () => 'Attack with quick strikes, not heavy ones.',
  potion: () => 'Do not drink a potion unless your health is LOW.',
  'shop-only': plan => `At the armorer buy ${ITEM[plan.shop[0]]} and nothing else, not even potions.`,
  'shop-none': () => 'Buy nothing at the armorer, not even potions.',
  bench: () => 'Do not rest on the bench.',
  'medic-skip': () => 'Walk past the medic.',
  'medic-visit': () => 'Visit the medic.',
  camp: () => 'Submit the assignment as soon as you reach camp.',
  other: () => null,
};
// Ties go to the lesson that costs a trial most often (a missed potion or guard loses the hero; a wasted turn less so).
const PRIORITY = ['low', 'smash', 'strike', 'prize-retreat', 'prize-fight', 'heavy', 'quick', 'potion', 'shop-only', 'shop-none', 'bench', 'medic-skip', 'medic-visit', 'camp', 'other'];
/** The player's next amendment: the lesson with most misread decisions not already taught, or null. */
export function amendment(seen, plan, taught) {
  const count = {};
  for (const d of seen) { const l = lessonOf(d, plan); if (l && l !== 'other' && !taught.includes(l)) count[l] = (count[l] || 0) + 1; }
  const best = PRIORITY.filter(l => count[l]).sort((a, b) => count[b] - count[a] || PRIORITY.indexOf(a) - PRIORITY.indexOf(b))[0];
  return best ? { lesson: best, text: LESSONS[best](plan), misread: count[best] } : null;
}

// ---------- the game's own drawn move order ----------
const over = s => s.status === 'won' || s.status === 'lost';
const forced = s => G.availableActions(s).length === 1;
async function playShuffled(model, jobs, label) {
  const step = (s, id) => { const next = G.applyAction({ ...s, log: [] }, id, 'bot'); next.log = []; return next; };
  const trials = jobs.map(j => ({ ...j, s: G.newGame(j.level, j.seed), decisions: [] }));
  for (;;) {
    const waiting = [];
    for (const t of trials) { while (!over(t.s) && forced(t.s)) t.s = step(t.s, G.availableActions(t.s)[0].id); if (!over(t.s)) waiting.push(t); }
    if (!waiting.length) break;
    const prompts = waiting.map(t => ARMS[ARM](t.orders, t.s));
    const answers = await model.askAll(prompts.map((messages, i) => ({ messages, ids: G.availableActions(waiting[i].s).map(a => a.id) })));
    waiting.forEach((t, i) => {
      t.decisions.push({ turn: t.s.turn + 1, at: G.currentTile(t.s).name, hp: t.s.hp, move: G.nextMove(t.s.enemy)?.kind || null, ...kinds(t.s), action: answers[i].action, intended: intended(t.plan, t.s) });
      t.s = step(t.s, answers[i].action);
    });
    process.stdout.write(`\r  ${label}: ${trials.filter(t => over(t.s)).length} of ${trials.length} trials finished`);
  }
  process.stdout.write('\n');
  return trials.map(t => ({ seed: t.seed, status: t.s.status, turns: t.s.turn, hp: t.s.hp, end: t.s.status === 'won' ? 'won' : t.s.hp === 0 ? `died at ${G.currentTile(t.s).name}` : `out of turns at ${G.currentTile(t.s).name}`, decisions: t.decisions }));
}
function scriptShuffled(level, plan, seed) {
  let s = G.newGame(level, seed);
  while (!over(s)) s = G.applyAction(s, forced(s) ? G.availableActions(s)[0].id : intended(plan, s)[0], 'bot');
  return s.status;
}

// ---------- report ----------
function report(record) {
  const rounds = record.rounds;
  const levels = ['warning', 'prize', 'circuit'];
  const won = (round, pred = () => true) => round.orders.flatMap(o => o.trials.filter(t => pred(o, t))).filter(t => t.status === 'won').length;
  const total = (round, pred = () => true) => round.orders.flatMap(o => o.trials.filter(t => pred(o, t))).length;
  const reh = round => { const all = round.orders.flatMap(o => o.rehearsal); return share(all.filter(ok).length, all.length); };
  console.log(`\n${record.model}, temperature ${record.temperature}: the read-back loop on the 36 fresh orders (the apply prompt, shipped when this ran)`);
  console.log(`  ${'round'.padEnd(10)} ${'rehearsal'.padEnd(14)} ${levels.map(l => l.padEnd(14)).join(' ')} all trials`);
  rounds.forEach((round, i) => {
    if (!round.orders[0].trials.length) { console.log(`  ${(i ? `amended ${i}` : 'as written').padEnd(10)} ${reh(round).padEnd(14)} (no trials yet)`); return; }
    console.log(`  ${(i ? `amended ${i}` : 'as written').padEnd(10)} ${reh(round).padEnd(14)} ${levels.map(l => share(won(round, o => o.level === l), total(round, o => o.level === l)).padEnd(14)).join(' ')} ${share(won(round), total(round))}`);
  });
  for (let i = 1; i < rounds.length; i++) {
    const a = rounds[i - 1], b = rounds[i];
    if (!b.orders[0].trials.length) continue;
    let better = 0, worse = 0;
    b.orders.forEach((o, k) => o.trials.forEach((t, j) => { const before = a.orders[k].trials[j].status === 'won', after = t.status === 'won'; if (after && !before) better++; if (before && !after) worse++; }));
    console.log(`  round ${i} vs ${i - 1}, same orders and seeds: won after only ${better}, before only ${worse}, exact p = ${mcnemar(better, worse).toFixed(3)}`);
    // Did the taught lesson stop showing? Misread answers of that lesson, in the rehearsal and in the trials.
    const byLesson = {};
    b.orders.forEach((o, k) => {
      const l = o.amendments.length === i ? o.amendments.at(-1).lesson : null; if (!l) return;
      const plan = PLANS[o.level][o.plan];
      const count = list => list.filter(d => lessonOf(d, plan) === l).length;
      const x = byLesson[l] ||= { orders: 0, rehBefore: 0, rehAfter: 0, trialBefore: 0, trialAfter: 0, decBefore: 0, decAfter: 0, wonBefore: 0, wonAfter: 0, trials: 0 };
      x.orders++; x.rehBefore += count(a.orders[k].rehearsal); x.rehAfter += count(o.rehearsal);
      const db = a.orders[k].trials.flatMap(t => t.decisions), da = o.trials.flatMap(t => t.decisions);
      x.trialBefore += count(db); x.trialAfter += count(da); x.decBefore += db.length; x.decAfter += da.length;
      x.wonBefore += a.orders[k].trials.filter(t => t.status === 'won').length; x.wonAfter += o.trials.filter(t => t.status === 'won').length; x.trials += o.trials.length;
    });
    console.log(`  lesson taught in round ${i}: orders | misread in the rehearsal, before → after | misread in trials, before → after | trials won, before → after`);
    for (const [l, x] of Object.entries(byLesson).sort((p, q) => q[1].orders - p[1].orders)) console.log(`    ${l.padEnd(14)} ${String(x.orders).padStart(2)} | ${x.rehBefore} → ${x.rehAfter} | ${x.trialBefore}/${x.decBefore} → ${x.trialAfter}/${x.decAfter} | ${x.wonBefore} → ${x.wonAfter} of ${x.trials}`);
  }
  if (record.shuffled) {
    console.log(`\n  The game's own drawn move order (seeds ${record.shuffled.seeds.join(', ')}), orders as written:`);
    for (const level of ['warning', 'prize']) {
      const list = record.shuffled.trials.filter(t => t.level === level && !t.preset);
      const script = list.filter(t => t.script === 'won').length;
      const ends = {}; for (const t of list.filter(t => t.status !== 'won')) { const e = t.end.replace(/ at .*/, ''); ends[e] = (ends[e] || 0) + 1; }
      const fixed = rounds[0].orders.filter(o => o.level === level).flatMap(o => o.trials.filter(t => t.seed == null));
      console.log(`    ${level.padEnd(8)} model won ${share(list.filter(t => t.status === 'won').length, list.length)} (scripts ${script}/${list.length}); losses ${JSON.stringify(ends)}; fixed routines: ${share(fixed.filter(t => t.status === 'won').length, fixed.length)}`);
    }
    for (const t of record.shuffled.trials.filter(t => t.preset)) console.log(`    ${t.name.padEnd(30)} ${String(t.seed ?? 'fixed').padEnd(6)} ${t.status === 'won' ? `won on turn ${t.turns}` : t.end}`);
  }
  console.log('\n  Amendments, round by round:');
  rounds.at(-1).orders.forEach(o => { if (o.amendments.length) console.log(`    ${`${o.level}/${o.plan}/${o.style}`.padEnd(24)} ${o.amendments.map(a => `${a.lesson} (${a.misread})`).join(', ')}`); });
}

// ---------- main ----------
if (process.argv[1]?.endsWith('ideas/amend.mjs')) {
  if (process.argv.includes('--report')) report(JSON.parse(await readFile(FILE, 'utf8')));
  else {
    const source = JSON.parse(await readFile(SOURCE, 'utf8'));
    const start = source.arms.apply;
    // The `apply` arm of that record is the baseline, so the prompt asked here must be the same.
    for (const o of start.orders) situations(o.level).forEach((x, i) => {
      if (hash(ARMS[ARM](o.orders, x.s)) !== o.rehearsal[i].h) throw new Error(`The ${ARM} prompt differs from the record's apply arm (${o.level}/${o.plan}/${o.style}), so that record is no baseline for it.`);
    });
    const seeds = source.seeds;
    const record = { model: MODEL, temperature: TEMPERATURE, source: SOURCE.replace(`${ROOT}/`, ''), seeds, rounds: [{ orders: start.orders.map(o => ({ level: o.level, plan: o.plan, style: o.style, orders: o.orders, amendments: [], rehearsal: o.rehearsal, trials: o.trials })) }] };
    const save = () => writeFile(FILE, JSON.stringify(record, null, 1));
    const model = DRY ? { askAll: async prompts => prompts.map(p => ({ action: p.ids[0] })), close: async () => {} } : await openModel();
    try {
      const play = async round => {
        const jobs = round.orders.flatMap((o, index) => [null, ...seeds].map(seed => ({ index, seed, level: o.level, plan: PLANS[o.level][o.plan], orders: o.orders })));
        const results = await playAll(model, ARM, jobs, 'trials');
        jobs.forEach((j, i) => round.orders[j.index].trials.push(results[i]));
      };
      const amendRound = async () => {
        const prev = record.rounds.at(-1);
        const round = { orders: prev.orders.map(o => {
          const plan = PLANS[o.level][o.plan];
          const watched = o.trials.find(t => t.seed == null).decisions;
          const next = amendment([...o.rehearsal, ...watched], plan, o.amendments.map(a => a.lesson));
          return { ...o, orders: next ? `${o.orders}\n${next.text}` : o.orders, amendments: next ? [...o.amendments, next] : o.amendments, rehearsal: [], trials: [] };
        }) };
        record.rounds.push(round);
        console.log(`\n##### round ${record.rounds.length - 1}: ${round.orders.filter((o, i) => o.amendments.length > prev.orders[i].amendments.length).length} of ${round.orders.length} orders amended`);
        for (const [i, o] of round.orders.entries()) {
          o.rehearsal = await rehearse(model, ARM, o.level, PLANS[o.level][o.plan], o.orders);
          process.stdout.write(`\r  rehearsals ${i + 1} of ${round.orders.length}`);
        }
        process.stdout.write('\n');
        await save();
        await play(round);
        await save();
        report(record);
      };
      await amendRound();
      if (!process.argv.includes('--no-shuffled')) {
        const shuffledSeeds = [1, 2, 3];
        const orders = record.rounds[0].orders.filter(o => o.level !== 'circuit');
        // The game's two example orders as well: the careful one should win, the first draft should lose (its "plan" here
        // is the careful one, so its decisions count as departures where it differs; only won or lost matters for it).
        const presets = [['warning', 'guard', G.WARNING_PRESETS], ['prize', 'sword', G.PRIZE_PRESETS]].flatMap(([level, plan, p]) =>
          [['careful', p.careful], ['first draft', p.reckless]].map(([style, text]) => ({ level, plan, style: `example ${style}`, orders: text, preset: true })));
        const jobs = [...orders, ...presets].flatMap(o => [...(o.preset ? [null] : []), ...shuffledSeeds].map(seed => ({ seed, level: o.level, plan: PLANS[o.level][o.plan], orders: o.orders, name: `${o.level}/${o.plan}/${o.style}`, preset: !!o.preset })));
        const results = await playShuffled(model, jobs, 'shuffled trials');
        record.shuffled = { seeds: shuffledSeeds, trials: jobs.map((j, i) => ({ level: j.level, name: j.name, preset: j.preset, script: scriptShuffled(j.level, j.plan, j.seed), ...results[i] })) };
        await save();
        report(record);
      }
      for (let r = 2; r <= Number(arg('rounds') ?? 2); r++) await amendRound();
    } finally { await model.close(); }
    console.log(`\nEvery decision is in ${FILE.replace(`${ROOT}/`, '')}`);
  }
}

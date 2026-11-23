// Idea probe: can the real local model read prose that a rule-based hero cannot?
//
//   node tools/ideas/probe.mjs [--mode=plain|think|read] [--only=tells,notice] [--bots]
//   (QUEST_MODEL and PROBE_TEMPERATURE as in tools/probe.mjs)
//
// Modes, for the model only:
//   plain  the game's prompt and reply as they are: one action ID, nothing else.
//   think  the reply carries one short sentence before the action.
//   read   the model first answers the game's own questions about the scene; its answers become checklist lines
//          in the decision prompt. "labels" is the same decision with the true answers written in.
//
// Six unbuilt ideas, each as single decisions with one right answer under the standing orders. Three contestants:
//   model     the real local model, asked exactly as the game asks it (see llm.mjs).
//   keywords  keyword-bot.mjs: rules written by someone who saw only the dev wordings, never the held-out ones.
//   no-read   the best a hero can do without reading the prose: one fixed answer per kind of stop.
// Random is the chance of a uniform pick being right. `--bots` skips the model.
// A labelled control asks the same kind of decision with today's SMASH labels, from the real engine and protocol.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../serve.mjs';
import { IDEAS, READING, makeCases, isWanted } from './build.mjs';
import { DEV } from './cases-dev.mjs';
import { openModel, messagesFor, thinkPrompt, readPrompt, MODEL, TEMPERATURE } from './llm.mjs';
import { newGame, applyAction, availableActions, observation, WARNING_PRESETS } from '../../src/game.js';
import { decisionMessages } from '../../src/protocol.js';

// IDEAS_HELD points at the held-out cases while they are kept out of the rule writer's sight; the bot may not exist yet.
const { HELD } = await import(process.env.IDEAS_HELD || './cases-held.mjs');
const choose = await import('./keyword-bot.mjs').then(m => m.choose, () => null);
if (!choose) console.log('keyword-bot.mjs is missing: the keywords rows below are empty.');
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
const botsOnly = process.argv.includes('--bots');
const cases = [...makeCases(DEV, 'dev'), ...makeCases(HELD, 'held')].filter(c => !only || only.includes(c.idea));
const pct = (n, d) => d ? `${Math.round(100 * n / d)}%`.padStart(4) : '   –';
const frac = (n, d) => `${n}/${d}`.padStart(5);

// The labelled control: today's prompt, for the same decision (guard the smash, strike otherwise).
const play = (s, ...ids) => ids.reduce((state, id) => applyAction(state, id), s);
const meet = index => applyAction({ ...newGame('circuit'), status: 'active', position: index - 1 }, 'advance');
const CONTROL = [
  ['boar, SMASH', meet(3), 'guard'], ['boar, strike', play(meet(3), 'guard'), 'quick'],
  ['bruiser, strike', meet(5), 'quick'], ['bruiser, SMASH', play(meet(5), 'quick'), 'guard'], ['bruiser, WINDED', play(meet(5), 'quick', 'guard'), 'quick'],
  ['champion, strike', meet(10), 'quick'], ['champion, BRACING', play(meet(10), 'quick'), 'quick'], ['champion, SMASH', play(meet(10), 'quick', 'quick'), 'guard'], ['champion, WINDED', play(meet(10), 'quick', 'quick', 'guard'), 'quick'],
];

const MODE = process.argv.find(a => a.startsWith('--mode='))?.slice(7) || 'plain';
const model = botsOnly ? null : await openModel();
const record = { model: botsOnly ? null : MODEL, temperature: TEMPERATURE, mode: `${MODE}${process.env.IDEAS_NEUTRAL ? '-neutral' : ''}${process.env.IDEAS_NO_PAY ? '-nopay' : ''}`, ideas: {}, control: [] };
const ids = actions => actions.map(a => a.id);
try {
  for (const [id, idea] of Object.entries(IDEAS)) {
    const mine = cases.filter(c => c.idea === id);
    if (!mine.length) continue;
    console.log(`\n=== ${idea.title} (${mine.filter(c => c.set === 'dev').length} dev + ${mine.filter(c => c.set === 'held').length} held-out cases)`);
    record.ideas[id] = { title: idea.title, orders: {} };
    // Read first: the questions do not depend on the orders, so they are asked once per case.
    let readings = null;
    if (model && MODE === 'read') {
      const asked = mine.flatMap((c, at) => READING[id].questions(c.source).map(question => ({ at, ...question })));
      const answers = await model.askAll(asked.map(x => readPrompt(mine[x.at].facts, x.q, x.options)));
      readings = mine.map((c, at) => asked.map((x, i) => ({ ...x, answer: answers[i].json?.answer ?? null })).filter(x => x.at === at));
      const flat = readings.flat();
      const right = list => list.filter(x => x.answer === x.truth).length;
      const heldFlat = flat.filter(x => mine[x.at].set === 'held');
      console.log(`  reading questions answered correctly by the model: held-out ${frac(right(heldFlat), heldFlat.length)} ${pct(right(heldFlat), heldFlat.length)}   all ${frac(right(flat), flat.length)} ${pct(right(flat), flat.length)}`);
      for (const x of flat.filter(x => x.answer !== x.truth)) console.log(`    reading ✗ [${mine[x.at].set} ${mine[x.at].cls}] said "${x.answer}", true "${x.truth}": ${x.q.slice(0, 60)}… ${JSON.stringify(mine[x.at].source).slice(0, 130)}`);
    }
    for (const [key, orders] of Object.entries(idea.orders)) {
      let answers = mine.map(() => ({ action: null }));
      let labelled = null;
      if (model && MODE === 'plain') answers = await model.askAll(mine.map(c => ({ messages: messagesFor(orders, c.facts, c.actions), ids: ids(c.actions) })));
      if (model && MODE === 'think') answers = await model.askAll(mine.map(c => thinkPrompt(orders, c.facts, c.actions)));
      if (model && MODE === 'read') {
        const decide = async answersOf => model.askAll(mine.map((c, at) => { const built = READING[id].apply(c, answersOf(at), c.source); return { messages: messagesFor(orders, built.facts, built.actions), ids: ids(built.actions) }; }));
        answers = await decide(at => readings[at].map(x => x.answer ?? x.options.at(-1)));
        // The same decision with the true answers written in: what following the orders is worth once the reading is right.
        // Asked only where a reading was wrong; elsewhere the prompt is the one already answered.
        const wrong = mine.map((c, at) => readings[at].some(x => x.answer !== x.truth));
        const redo = await model.askAll(mine.flatMap((c, at) => { if (!wrong[at]) return []; const built = READING[id].apply(c, readings[at].map(x => x.truth), c.source); return [{ messages: messagesFor(orders, built.facts, built.actions), ids: ids(built.actions) }]; }));
        labelled = mine.map((c, at) => wrong[at] ? redo.shift() : answers[at]);
      }
      const rows = mine.map((c, i) => {
        const offered = c.actions.map(a => a.id);
        let bot;
        try { bot = choose ? choose(id, key, c.facts, c.actions) : null; } catch { bot = null; }
        return { set: c.set, cls: c.cls, source: c.source, offered, want: c.want[key], model: answers[i].action, thought: answers[i].json?.thought, labelled: labelled?.[i].action, reading: readings?.[i].map(x => ({ answer: x.answer, truth: x.truth })), ms: answers[i].ms, bot, chance: offered.filter(o => isWanted(c.want[key], o)).length / offered.length };
      });
      // No reading: one fixed answer for each set of offered actions (that is, each kind of stop), chosen with hindsight.
      const groups = Map.groupBy(rows, r => r.offered.join(','));
      let noRead = 0;
      for (const group of groups.values()) noRead += Math.max(...group[0].offered.map(o => group.filter(r => isWanted(r.want, o)).length));
      const score = (who, list) => list.filter(r => isWanted(r.want, r[who])).length;
      const held = rows.filter(r => r.set === 'held');
      const dev = rows.filter(r => r.set === 'dev');
      const line = (name, who) => console.log(`  ${name.padEnd(9)} dev ${frac(score(who, dev), dev.length)}   held-out ${frac(score(who, held), held.length)} ${pct(score(who, held), held.length)}   all ${pct(score(who, rows), rows.length)}`);
      console.log(`\nORDERS ${key}: ${orders}`);
      if (model) line(`model`, 'model');
      if (labelled) line('labels', 'labelled');
      if (choose) line('keywords', 'bot');
      console.log(`  no-read   best fixed answer per stop: ${pct(noRead, rows.length)} of all;   random: ${pct(rows.reduce((sum, r) => sum + r.chance, 0), rows.length)}`);
      const classes = [...new Set(rows.map(r => r.cls))];
      console.log(`  held-out by class: ${classes.map(cls => { const list = held.filter(r => r.cls === cls); return `${cls} ${model ? `model ${score('model', list)}/${list.length}` : ''}${choose ? ` keywords ${score('bot', list)}/${list.length}` : ''}`; }).join('; ')}`);
      if (model) for (const r of rows.filter(r => !isWanted(r.want, r.model))) console.log(`    model ✗ [${r.set} ${r.cls}] chose ${r.model}, wanted ${[r.want].flat().join('|')}: ${JSON.stringify(r.source).slice(0, 110)}${r.thought ? `  ← "${r.thought.slice(0, 110)}"` : ''}`);
      if (choose) for (const r of held.filter(r => !isWanted(r.want, r.bot))) console.log(`    keywords ✗ [${r.cls}] chose ${r.bot}, wanted ${[r.want].flat().join('|')}: ${JSON.stringify(r.source).slice(0, 110)}`);
      record.ideas[id].orders[key] = { orders, rows, noRead: noRead / rows.length };
    }
  }
  if (model && !only && MODE === 'plain') {
    const orders = WARNING_PRESETS.careful;
    const answers = await model.askAll(CONTROL.map(([, state]) => { const actions = availableActions(state); return { messages: decisionMessages(orders, observation(state), actions), ids: actions.map(a => a.id) }; }));
    console.log(`\n=== Control: today's labelled prompt, real engine and protocol\nORDERS: ${orders}`);
    for (const [i, [label, , want]] of CONTROL.entries()) { record.control.push({ label, want, model: answers[i].action }); console.log(`  ${answers[i].action === want ? '✓' : '✗'} ${label.padEnd(20)} chose ${answers[i].action.padEnd(8)} wanted ${want}`); }
  }
} finally { await model?.close(); }
if (model) {
  await mkdir(join(ROOT, 'artifacts'), { recursive: true });
  const file = `ideas-probe-${MODEL}-${record.mode}.json`;
  await writeFile(join(ROOT, 'artifacts', file), JSON.stringify(record, null, 1));
  console.log(`\nEvery decision is in artifacts/${file}`);
}

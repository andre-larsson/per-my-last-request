// Prompt tuning for the idea probe: the same decisions as probe.mjs, asked in other ways.
//
//   node tools/ideas/tune.mjs --variants=plain,steps [--set=dev|held] [--only=tells,notice] [--show]
//   (--only writes its own record, named after the ideas, so it never replaces a full run's record)
//   (QUEST_MODEL and PROBE_TEMPERATURE as in probe.mjs)
//
// The facts and the offered actions of every case stay exactly as probe.mjs builds them, so the keyword rules'
// answers do not change: only the wrapper around them (system prompt, reply shape, number of calls) does.
// Variants are tuned on the development wordings (the default set). A held-out run prints scores only, unless
// --show is given, so that looking at a result does not teach the next prompt the held-out wordings.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../serve.mjs';
import { IDEAS, makeCases, isWanted } from './build.mjs';
import { DEV } from './cases-dev.mjs';
import { HELD } from './cases-held.mjs';
import { choose } from './keyword-bot.mjs';
import { openModel, messagesFor, thinkPrompt, userPrompt, MODEL, TEMPERATURE } from './llm.mjs';
import { VARIANTS } from './variants.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const set = arg('set') || 'dev';
const only = arg('only')?.split(',');
const show = process.argv.includes('--show') || set === 'dev';
const names = (arg('variants') || 'plain').split(',');
for (const name of names) if (!VARIANTS[name]) throw new Error(`Unknown variant "${name}". Known: ${Object.keys(VARIANTS).join(', ')}`);
// One of the made-up examples in the "shots" questions matches a held-out scene.
for (const name of names) if (set === 'held' && name.includes('shots')) throw new Error(`"${name}" is for the development wordings only.`);
const cases = makeCases(set === 'held' ? HELD : DEV, set).filter(c => !only || only.includes(c.idea));
const ideas = Object.keys(IDEAS).filter(id => cases.some(c => c.idea === id));
const pct = (n, d) => `${Math.round(100 * n / d)}%`;

const model = await openModel();
const table = [];
try {
  for (const name of names) {
    const variant = VARIANTS[name];
    const record = { model: MODEL, temperature: TEMPERATURE, variant: name, set, ideas: {} };
    const per = {};
    let total = 0, right = 0, botRight = 0, ms = [];
    console.log(`\n##### ${name}: ${variant.about}`);
    for (const id of ideas) {
      const mine = cases.filter(c => c.idea === id);
      record.ideas[id] = { orders: {} };
      let ideaRight = 0;
      for (const [key, orders] of Object.entries(IDEAS[id].orders)) {
        const answers = await variant.run({ model, orders, cases: mine, idea: id, helpers: { messagesFor, thinkPrompt, userPrompt } });
        const rows = mine.map((c, i) => ({ set: c.set, cls: c.cls, source: c.source, want: c.want[key], model: answers[i].action, note: answers[i].note, reading: answers[i].reading, ms: answers[i].ms, bot: choose(id, key, c.facts, c.actions) }));
        const good = rows.filter(r => isWanted(r.want, r.model)).length;
        ideaRight += good; right += good; total += rows.length; botRight += rows.filter(r => isWanted(r.want, r.bot)).length;
        ms.push(...rows.map(r => r.ms));
        console.log(`  ${id.padEnd(10)} ${key}: ${good}/${rows.length}`);
        if (show) for (const r of rows.filter(r => !isWanted(r.want, r.model))) console.log(`      ✗ [${r.cls}] chose ${r.model}, wanted ${[r.want].flat().join('|')}: ${JSON.stringify(r.source).slice(0, 140)}${r.note ? `\n          ← ${r.note.slice(0, 260)}` : ''}`);
        record.ideas[id].orders[key] = { orders, rows };
      }
      per[id] = ideaRight / (2 * mine.length);
    }
    const read = Object.values(record.ideas).flatMap(v => v.orders.a.rows.flatMap(r => r.reading || []));
    if (read.length) console.log(`  reading questions answered correctly: ${read.filter(x => x.answer === x.truth).length}/${read.length}; per idea: ${ideas.map(id => { const list = record.ideas[id].orders.a.rows.flatMap(r => r.reading || []); return `${id} ${list.filter(x => x.answer === x.truth).length}/${list.length}`; }).join(', ')}`);
    ms.sort((a, b) => a - b);
    const mean = Object.values(per).reduce((a, b) => a + b, 0) / ideas.length;
    console.log(`  ${set} total ${right}/${total} (${pct(right, total)}), mean of ideas ${Math.round(100 * mean)}%, keyword rules ${botRight}/${total}; median ${ms[ms.length >> 1]} ms per decision`);
    table.push({ name, per, mean, right, total, botRight, ms: ms[ms.length >> 1] });
    await mkdir(join(ROOT, 'artifacts'), { recursive: true });
    await writeFile(join(ROOT, 'artifacts', `ideas-tune-${MODEL}-${name}${only ? `-only-${only.join('+')}` : ''}-${set}.json`), JSON.stringify(record, null, 1));
  }
} finally { await model.close(); }

console.log(`\n${MODEL}, ${set} wordings, both versions of the orders pooled\n`);
console.log(`${''.padEnd(22)}${ideas.map(i => i.padStart(10)).join('')}${'mean'.padStart(7)}${'right'.padStart(10)}${'ms'.padStart(7)}`);
for (const t of table) console.log(`${t.name.padEnd(22)}${ideas.map(i => `${Math.round(100 * t.per[i])}%`.padStart(10)).join('')}${`${Math.round(100 * t.mean)}%`.padStart(7)}${`${t.right}/${t.total}`.padStart(10)}${String(t.ms).padStart(7)}`);
if (table.length) console.log(`${'keyword rules'.padEnd(22)}${''.padStart(10 * ideas.length + 7)}${`${table[0].botRight}/${table[0].total}`.padStart(10)}`);

// One table from the probe records in artifacts/: held-out accuracy per idea, for each model run and the baselines.
//   node tools/ideas/summary.mjs [--all]      (--all scores dev and held-out wordings together)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../serve.mjs';
import { IDEAS, makeCases, isWanted } from './build.mjs';
import { DEV } from './cases-dev.mjs';
import { HELD } from './cases-held.mjs';
import { choose } from './keyword-bot.mjs';

const all = process.argv.includes('--all');
const cases = [...makeCases(DEV, 'dev'), ...makeCases(HELD, 'held')].filter(c => all || c.set === 'held');
const ideas = Object.keys(IDEAS);
const pct = x => (Number.isNaN(x) ? '–' : `${Math.round(100 * x)}%`).padStart(5);
const mean = list => { const known = list.filter(x => !Number.isNaN(x)); return known.length ? known.reduce((a, b) => a + b, 0) / known.length : NaN; };
// Both orders versions pooled: each case counts twice, once under each.
const rate = (idea, right) => mean(['a', 'b'].flatMap(key => cases.filter(c => c.idea === idea).map(c => right(c, key) ? 1 : 0)));
// The mean is shown only for a run that covers all six ideas.
const row = (name, per) => { const values = ideas.map(per); console.log(`${name.padEnd(40)}${values.map(v => pct(v).padStart(10)).join('')}${pct(values.some(Number.isNaN) ? NaN : mean(values)).padStart(9)}`); };

console.log(`${all ? 'All' : 'Held-out'} wordings, both versions of the orders pooled (${cases.length} cases, each asked under 2 orders)\n`);
console.log(`${''.padEnd(40)}${ideas.map(i => i.padStart(10)).join('')}${'mean'.padStart(9)}`);
const files = readdirSync(join(ROOT, 'artifacts')).filter(f => /^ideas-probe-.*\.json$/.test(f)).sort();
for (const file of files) {
  const record = JSON.parse(readFileSync(join(ROOT, 'artifacts', file), 'utf8'));
  const mode = record.mode || 'plain';
  const name = `${record.model.replace(/-q4f.*$/, '').replace('-Instruct', '').replace('-2512-BF16', '')}, ${mode}`;
  const rows = idea => record.ideas[idea] ? ['a', 'b'].flatMap(key => record.ideas[idea].orders[key].rows.filter(r => all || r.set === 'held')) : [];
  row(name, idea => mean(rows(idea).map(r => isWanted(r.want, r.model) ? 1 : 0)));
  if (mode.startsWith('read')) {
    row('  … its reading questions alone', idea => !record.ideas[idea] ? NaN : mean(record.ideas[idea].orders.a.rows.filter(r => all || r.set === 'held').flatMap(r => r.reading.map(x => x.answer === x.truth ? 1 : 0))));
    row('  … with the true labels given', idea => mean(rows(idea).map(r => isWanted(r.want, r.labelled) ? 1 : 0)));
  }
}
console.log('');
row('keyword rules (blind)', idea => rate(idea, (c, key) => isWanted(c.want[key], choose(idea, key, c.facts, c.actions))));
row('no reading (best fixed answer)', idea => mean(['a', 'b'].map(key => {
  const mine = cases.filter(c => c.idea === idea);
  const groups = Map.groupBy(mine, c => c.actions.map(a => a.id).join(','));
  let right = 0;
  for (const group of groups.values()) right += Math.max(...group[0].actions.map(a => group.filter(c => isWanted(c.want[key], a.id)).length));
  return right / mine.length;
})));
row('random pick', idea => rate(idea, () => false) + mean(['a', 'b'].flatMap(key => cases.filter(c => c.idea === idea).map(c => c.actions.filter(a => isWanted(c.want[key], a.id)).length / c.actions.length))));

// One table from the tuning records in artifacts/ (tune.mjs): share of decisions right per idea, for each model and variant.
//   node tools/ideas/tune-summary.mjs [--set=dev|held] [--misses=<variant>]   (--misses lists that variant's wrong decisions)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../serve.mjs';
import { IDEAS, isWanted } from './build.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const set = arg('set') || 'dev';
const misses = arg('misses');
const ideas = Object.keys(IDEAS);
const short = model => model.replace(/-q4f.*$/, '').replace('-Instruct', '');
const records = readdirSync(join(ROOT, 'artifacts')).filter(f => f.startsWith('ideas-tune-') && f.endsWith(`-${set}.json`)).sort().map(f => JSON.parse(readFileSync(join(ROOT, 'artifacts', f), 'utf8')));
console.log(`${set} wordings, both versions of the orders pooled\n`);
console.log(`${''.padEnd(34)}${ideas.map(i => i.padStart(10)).join('')}${'mean'.padStart(7)}${'right'.padStart(10)}${'rules'.padStart(10)}${'ms'.padStart(7)}`);
for (const r of records) {
  let right = 0, total = 0, bot = 0;
  const ms = [];
  const per = ideas.map(id => {
    const rows = ['a', 'b'].flatMap(key => r.ideas[id]?.orders[key]?.rows || []);
    const good = rows.filter(x => isWanted(x.want, x.model)).length;
    right += good; total += rows.length; bot += rows.filter(x => isWanted(x.want, x.bot)).length; ms.push(...rows.map(x => x.ms));
    return rows.length ? good / rows.length : NaN;
  });
  ms.sort((a, b) => a - b);
  const cell = x => (Number.isNaN(x) ? '–' : `${Math.round(100 * x)}%`);
  const mean = per.some(Number.isNaN) ? NaN : per.reduce((a, b) => a + b, 0) / per.length;
  console.log(`${`${short(r.model)} ${r.variant}`.padEnd(34)}${per.map(x => cell(x).padStart(10)).join('')}${cell(mean).padStart(7)}${`${right}/${total}`.padStart(10)}${`${bot}/${total}`.padStart(10)}${String(ms[ms.length >> 1]).padStart(7)}`);
}
if (misses) for (const r of records.filter(r => r.variant === misses)) {
  console.log(`\n${short(r.model)} ${r.variant}: wrong decisions`);
  for (const id of ideas) for (const key of ['a', 'b']) for (const x of r.ideas[id]?.orders[key]?.rows || []) {
    if (!isWanted(x.want, x.model)) console.log(`  ${id} ${key} [${x.cls}] chose ${x.model}, wanted ${[x.want].flat().join('|')}: ${JSON.stringify(x.source).slice(0, 130)}${x.note ? `\n      ← ${x.note.slice(0, 300)}` : ''}`);
  }
}

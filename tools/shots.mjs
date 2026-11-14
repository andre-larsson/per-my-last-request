// Review tool: screenshots of the main game states at several window sizes, plus a text-size audit.
// Usage: node tools/shots.mjs [output-dir]    (default: artifacts/shots)
// Drives the Manual sandbox only. No model is loaded and nothing here is evidence of LLM play.
// Turns are not played back (instant pace), except in `circuit-playback`, which is held on one beat.
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { serve, ROOT } from './serve.mjs';
import { launch, sleep } from './chrome.mjs';

const out = resolve(process.argv[2] || join(ROOT, 'artifacts', 'shots'));
const MIN_TEXT_PX = 12;
const SIZES = [['desktop', 1440, 900, false], ['laptop', 1180, 800, false], ['phone', 390, 844, true]];
await mkdir(out, { recursive: true });
const server = await serve(0);
const page = await launch({});
const act = async ids => { for (const id of ids) await page.click(`[data-action="${id}"]`); };
const has = id => page.eval(`Boolean(document.querySelector('[data-action="${id}"]'))`);
async function brawl(stopWhen) {
  for (let i = 0; i < 40; i++) {
    if (await page.eval(`(s => s.status === 'won' || s.status === 'lost' || (${stopWhen}))(QuestDemo.snapshot().game)`)) return;
    await act([await has('quick') ? 'quick' : await has('depart') ? 'depart' : 'advance']);
  }
}
// Reads the announced move: guard smashes, otherwise quick strikes. Skips the optional fight.
async function reader(stopWhen) {
  for (let i = 0; i < 40; i++) {
    if (await page.eval(`(s => s.status === 'won' || s.status === 'lost' || (${stopWhen}))(QuestDemo.snapshot().game)`)) return;
    const id = await page.eval(`(() => {
      const s = QuestDemo.snapshot().game;
      const has = id => Boolean(document.querySelector('[data-action="' + id + '"]'));
      if (has('potion') && s.hp <= 18) return 'potion';
      if (s.enemy) {
        if (s.enemy.optional) return 'retreat';
        return s.enemy.routine[s.enemy.step % s.enemy.routine.length].kind === 'smash' ? 'guard' : 'quick';
      }
      for (const id of ['medic', 'buy_buckler', 'rest', 'finish', 'depart']) if (has(id)) return id;
      return 'advance';
    })()`);
    await act([id]);
  }
}
const level = async name => { await page.click(`[data-level="${name}"]`); };
const restart = async () => { if (await page.eval('QuestDemo.snapshot().game.turn > 0')) await page.click('#reset'); };
// Each state starts from a fresh trial in Manual sandbox, then plays fixed actions.
const STATES = {
  'setup': async () => { await page.click('button[data-mode="llm"]'); await level('tutorial'); },
  'tutorial-fight': async () => { await page.click('button[data-mode="manual"]'); await level('tutorial'); await restart(); await act(['depart', 'quick']); },
  'tutorial-win': async () => { await restart(); await act(['depart', 'quick', 'quick', 'advance', 'advance', 'finish']); },
  'tutorial-loss': async () => { await restart(); await act(['depart', 'retreat', 'advance', 'advance', 'advance', 'retreat', 'advance', 'advance', 'advance', 'retreat', 'advance', 'advance']); },
  'warning-start': async () => { await level('warning'); await restart(); },
  'warning-boar': async () => { await act(['depart', 'quick', 'quick', 'advance']); },
  'warning-win': async () => { await reader('false'); },
  'prize-start': async () => { await level('prize'); await restart(); },
  'prize-win': async () => { await reader('false'); },
  'circuit-start': async () => { await level('circuit'); await restart(); },
  // The boar announces its charge; guarding it counters.
  'circuit-smash': async () => { await act(['depart', 'quick', 'quick', 'advance', 'advance']); },
  // Mid-turn: the guard is up and the charge has just landed; the counter is still to come.
  'circuit-playback': async () => { await page.eval(`QuestDemo.setPace('normal'); QuestDemo.hold(2)`); await act(['guard']); await page.waitFor('QuestDemo.snapshot().beat === 2'); },
  'circuit-countered': async () => { await page.eval(`QuestDemo.hold(null); QuestDemo.setPace('instant')`); await page.waitFor('!QuestDemo.snapshot().playing'); },
  'circuit-armorer': async () => { await reader("s.position === 8 && !s.enemy"); },
  'circuit-champion': async () => { await reader("s.enemy && s.enemy.boss && s.enemy.step === 2"); },
  'circuit-win': async () => { await reader('false'); },
  // A brawler who never heals: fights everything with quick strikes until health is flagged LOW mid-fight.
  'circuit-low-health': async () => { await restart(); await brawl('s.hp <= 18 && s.enemy'); },
  'circuit-death': async () => { await brawl('false'); },
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitFor('!QuestDemo.snapshot().checkingDevice');
  await page.eval(`QuestDemo.setPace('instant')`);
  const small = new Map();
  for (const [name, setup] of Object.entries(STATES)) {
    await page.viewport(1440, 900);
    await setup();
    console.log(`state: ${name}`);
    for (const [label, width, height, mobile] of SIZES) {
      await page.viewport(width, height, mobile);
      await sleep(1500); // Let entry animations and floating numbers finish.
      await page.screenshot(join(out, `${name}-${label}.png`));
      const overflow = await page.eval('document.documentElement.scrollWidth > innerWidth');
      if (overflow) console.log(`OVERFLOW  ${name} at ${width}px`);
      const found = await page.eval(`(() => { const out = []; for (const el of document.querySelectorAll('body *')) { if (!el.checkVisibility?.() || !el.getClientRects().length) continue; const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (!own) continue; const size = parseFloat(getComputedStyle(el).fontSize); const scale = el.ownerSVGElement ? el.ownerSVGElement.getBoundingClientRect().width / el.ownerSVGElement.viewBox.baseVal.width : 1; if (size * scale < ${MIN_TEXT_PX} - 0.01) out.push((size * scale).toFixed(1) + 'px  ' + (el.className?.baseVal ?? el.className ?? el.tagName) + '  "' + el.textContent.trim().slice(0, 40) + '"'); } return out; })()`);
      for (const line of found) small.set(`${label}: ${line}`, true);
    }
  }
  console.log(small.size ? `Text under ${MIN_TEXT_PX}px:\n  ${[...small.keys()].join('\n  ')}` : `No rendered text under ${MIN_TEXT_PX}px.`);
  if (page.errors.length) console.log('Browser errors:', page.errors);
  console.log(`Screenshots in ${out}`);
} finally { await page.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }

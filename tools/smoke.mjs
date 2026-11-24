import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { serve, ROOT } from './serve.mjs';
import { launch, sleep } from './chrome.mjs';
import { findModel } from '../src/models.js';
import { newGame, applyAction, nextMove, prizeOffered } from '../src/game.js';
import { BEAT_MS } from '../src/view.js';

const llm = process.argv.includes('--llm');
const gpuTest = llm && !process.argv.includes('--cpu');
const softwareGpu = process.argv.includes('--software-gpu');
const fullTrial = process.argv.includes('--full');
// --circuit: after the tutorial checks, the model plays the full circuit with the example orders. Evidence, not a pass/fail gate.
const circuitTrial = process.argv.includes('--circuit');
// --levels: the model plays the two middle assignments, each with its careful orders and its first draft. Evidence, not a gate.
// --levels=prize plays only the named ones.
const levelsArg = process.argv.find(arg => arg === '--levels' || arg.startsWith('--levels='));
// QUEST_ORDERS='orders A || orders B' plays those orders instead of the two example orders, to compare wordings.
const customOrders = process.env.QUEST_ORDERS ? process.env.QUEST_ORDERS.split('||').map(text => text.trim()).filter(Boolean) : null;
const levelTrials = levelsArg ? (levelsArg.includes('=') ? levelsArg.split('=')[1].split(',') : ['warning', 'prize']) : [];
const customModel = process.env.QUEST_MODEL;
if (customModel && !findModel(customModel)) throw new Error(`Unknown test model: ${customModel}`);
const artifacts = join(ROOT, 'artifacts', customModel ? customModel.replace(/[^a-z0-9-]/gi, '-') : '');
await mkdir(artifacts,{recursive:true});
// A stand-in for the model worker, injected by this test only. It answers the worker protocol with a fixed
// preference order so the LLM-mode interface can be exercised without a download. It is not inference,
// and nothing in the game can select it.
const STUB_WORKER = `window.__stub = { delay: 30, replies: [], seen: [], turns: [], temperatures: [], overlaps: 0 };
window.Worker = class {
  postMessage({ id, type, payload }) {
    const reply = (message, ms) => setTimeout(() => { if (!this.dead) this.onmessage?.({ data: message }); }, ms);
    if (type === 'load') { reply({ type: 'progress', report: { progress: 0.5, text: 'Stub worker: halfway.' } }, 20); reply({ id, type: 'result', result: { model: payload.model } }, 150); return; }
    // Like the real worker, token counts are answered at once, even during a decision. The stub counts characters.
    if (type === 'count') { window.__stub.counts = (window.__stub.counts || 0) + 1; reply({ id, type: 'result', result: { tokens: payload.text.length } }, 5); return; }
    // Like the real worker, one request at a time.
    if (this.busy) { window.__stub.overlaps++; reply({ id, type: 'error', error: 'The model is already processing a request.' }, 0); return; }
    this.busy = true;
    const offered = payload.actions.map(action => action.id);
    const choice = window.__stub.replies.shift() ?? ['finish', 'quick', 'advance', 'depart'].find(id => offered.includes(id));
    window.__stub.seen.push(payload.orders);
    window.__stub.turns.push(payload.observation.progress.turn);
    window.__stub.temperatures.push(payload.temperature);
    const ms = window.__stub.delay;
    setTimeout(() => { this.busy = false; }, ms);
    reply({ id, type: 'result', result: { raw: choice === 'garbage' ? 'not json' : JSON.stringify({ action: choice }), elapsed: ms, ordersReceived: payload.orders } }, ms);
  }
  terminate() { this.dead = true; }
};`;
async function stubbedLlmFlow(page, url) {
  const snap = expression => page.eval(`QuestDemo.snapshot().${expression}`);
  const stub = settings => page.eval(`Object.assign(window.__stub, ${JSON.stringify(settings)})`);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB_WORKER });
  await page.goto(url);
  await page.waitFor('!QuestDemo.snapshot().checkingDevice');
  await page.click('[data-level="tutorial"]').catch(() => {});
  await page.eval(`localStorage.clear();document.querySelector('#model').value='cpu:onnx-community/Qwen2.5-0.5B-Instruct';document.querySelector('#model').dispatchEvent(new Event('change',{bubbles:true}));`);
  await page.click('[data-preset="reckless"]');
  await page.click('#load-cta');
  await page.waitFor('QuestDemo.snapshot().modelReady');
  // These checks are about controls and timing of model replies, so turns are not played back. Playback is checked below.
  await page.eval(`QuestDemo.setPace('instant')`);
  assert.equal(await page.eval('!document.querySelector("#run").hidden && document.querySelector("#load-cta").hidden && document.querySelector("#manual-cta").hidden'), true, 'A ready model swaps the load actions for Run');
  assert.match(await page.eval('document.querySelector("#model-chip").textContent'), /Ready/);
  // A loaded model counts the tokens itself (the stub counts characters), so the size stops saying "about".
  const sizeShows = text => `document.querySelector("#orders-size").textContent === "${text.split(/\s+/).length} words · ${text.length} tokens"`;
  await page.waitFor(sizeShows(await page.eval('document.querySelector("#orders").value.trim()')));
  assert.match(await page.eval('document.querySelector("#orders-size").title'), /counted by Qwen 2\.5 · 0\.5B/);
  await page.screenshot(join(artifacts, 'flow-ready.png'));
  // The read-back asks only about situations a trial has met, so before the first trial there is nothing to ask.
  assert.equal(await page.eval('document.querySelector("#readback-ask").disabled'), true, 'No read-back before a trial');
  assert.match(await page.eval('document.querySelector("#readback-hint").textContent'), /Run a trial first/);
  await page.eval('QuestDemo.setReadAhead(0)');
  for (let i = 0; i < 12 && !['won', 'lost'].includes(await snap('game.status')); i++) { await page.click('#run'); await page.waitFor('!QuestDemo.snapshot().running && !QuestDemo.snapshot().modelBusy'); }
  assert.deepEqual([await snap('game.status'), (await snap('met')).sort()], ['won', ['camp', 'road', 'strike']], 'The trial met the rat, the hurt walk home and camp');
  // One decision per met situation, asked with the typed orders. No turn is spent.
  const metCount = 3;
  await page.eval('window.__stub.seen.length = 0');
  const turnBefore = await snap('game.turn');
  await page.click('#readback-ask');
  await page.waitFor('QuestDemo.snapshot().readback && !QuestDemo.snapshot().readback.pending');
  assert.equal(await snap('readback.actions.length'), metCount, 'The hero answers every situation met so far');
  assert.equal(await snap('readback.error'), null);
  assert.equal(await snap('game.turn'), turnBefore, 'A read-back spends no turn');
  assert.equal(await page.eval(`window.__stub.seen.length === ${metCount} && window.__stub.seen.every(orders => orders === document.querySelector('#orders').value.trim())`), true, 'The read-back asks with the typed orders');
  assert.equal(await page.eval('document.querySelectorAll("#readback .rb-list li").length'), metCount);
  assert.equal(await page.eval('document.querySelector("#readback-ask").disabled'), true, 'Up to date at temperature 0');
  // Edited orders make the memo stale; reading them back again marks the answers that changed.
  await stub({ replies: ['heavy'] });
  await page.eval(`document.querySelector('#orders').value += ' Use heavy strikes.'; document.querySelector('#orders').dispatchEvent(new Event('input', { bubbles: true }))`);
  assert.equal(await snap('readback.stale'), true, 'Edited orders make the read-back stale');
  assert.equal(await page.eval('document.querySelector("#readback-ask").disabled'), false);
  await page.click('#readback-ask');
  await page.waitFor('!QuestDemo.snapshot().readback.pending');
  assert.deepEqual([await snap('readback.changed'), await snap('readback.actions[0]')], [1, 'heavy'], 'The changed answer is marked');
  assert.equal(await page.eval('document.querySelectorAll("#readback li.changed").length'), 1);
  await page.screenshot(join(artifacts, 'flow-readback.png'));
  await page.click('[data-preset="reckless"]');
  // The default pace, "Turn by turn", makes Run play a single turn. Reading ahead is off while these checks look at slow replies.
  assert.deepEqual([await snap('pace'), await snap('stopEachTurn')], ['step', true], 'Turn by turn is the default pace');
  assert.match(await page.eval('document.querySelector("#pace").textContent'), /Pace: Turn by turn/);
  await page.eval('QuestDemo.setReadAhead(0)');
  // The forced departure is automatic.
  await page.click('#run');
  await page.waitFor('!QuestDemo.snapshot().running');
  assert.equal(await snap('game.log[0].source'), 'auto');
  assert.match(await page.eval('document.querySelector("#run").textContent'), /Next turn/, 'At a stop, Run offers the next turn');
  // The next turn is a real choice, answered slowly so the waiting state can be seen.
  await stub({ delay: 700, replies: ['retreat'] });
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().thinking');
  assert.equal(await page.eval('document.querySelector("#hero-card").classList.contains("thinking") && document.querySelector("#orders").disabled'), true, 'Thinking is visible and locks the orders');
  assert.match(await page.eval('document.querySelector("#run-status").textContent'), /^Turn 2: .*Thinking costs no turns/);
  assert.match(await page.eval('document.querySelector("#options-title").textContent'), /^Turn 2 · The hero weighs/, 'The options are numbered as the turn being decided');
  assert.equal(await snap('game.turn'), 1, 'Thinking spends no turn');
  await page.eval('scrollTo(0,0)');
  await page.screenshot(join(artifacts, 'flow-thinking.png'));
  await page.waitFor('!QuestDemo.snapshot().running');
  assert.deepEqual([await snap('game.turn'), await snap('game.log[1].source'), await snap('game.log[1].action')], [2, 'llm', 'retreat']);
  assert.equal(await page.eval('window.__stub.seen.at(-1) === QuestDemo.snapshot().orders'), true, 'The worker receives the orders in force');
  // A reply that arrives after a restart must not act on the new trial.
  await stub({ replies: ['potion'] });
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().thinking');
  await page.click('#reset');
  await sleep(1000);
  assert.deepEqual([await snap('game.turn'), await snap('game.log.length'), await snap('thinking')], [0, 0, false], 'A stale reply is discarded after Restart');
  // Unusable output is a model failure: reported, retried once, and free of charge. Retrying asks the model again.
  await stub({ delay: 30 });
  await page.click('#run');
  await page.waitFor('!QuestDemo.snapshot().running');
  await stub({ replies: ['garbage', 'garbage'] });
  await page.click('#run');
  await page.waitFor('!QuestDemo.snapshot().thinking && /No turn was spent/.test(QuestDemo.snapshot().status)');
  assert.equal(await snap('game.turn'), 1, 'A parsing failure spends no turn');
  assert.equal(await page.eval('document.querySelector("#run-status").classList.contains("error")'), true);
  await page.click('#run');
  await page.waitFor('!QuestDemo.snapshot().running');
  assert.deepEqual([await snap('game.turn'), await snap('game.log[1].source')], [2, 'llm'], 'A retry after a failure gets a fresh answer');
  // Orders edited mid-trial: the page says so, and the next run starts a fresh trial with the new text.
  const revised = 'Fight the practice rat with quick strikes, then return to camp and submit.';
  await page.eval(`document.querySelector('#orders').value=${JSON.stringify(revised)};document.querySelector('#orders').dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(await page.eval('document.querySelector("#orders-notice").hidden'), false, 'Edited orders are flagged before they apply');
  assert.match(await page.eval('document.querySelector("#run").textContent'), /Restart with new orders/, 'Run says that edited orders restart the trial');
  assert.match(await page.eval('document.querySelector("#orders-size").textContent'), /about/, 'Until the model has counted the new text, the tokens are an estimate');
  await page.waitFor(sizeShows(revised));
  // From here on the model reads ahead, and runs do not stop after each turn. The Pace button cycles to Normal.
  await page.eval('QuestDemo.setReadAhead(3)');
  await choosePace(page, 'normal');
  assert.equal(await snap('instant'), true, 'Choosing a pace leaves the test\'s instant playback alone');
  await page.eval('window.__stub.seen.length = 0');
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().game.status === "won"', 20000);
  const won = await page.eval('QuestDemo.snapshot()');
  assert.equal(won.game.turn, 6);
  assert.equal(won.orders, revised);
  assert.equal(won.game.log.some(entry => entry.source === 'manual'), false);
  assert.equal(await page.eval(`window.__stub.seen.every(orders => orders === ${JSON.stringify(revised)})`), true, 'Every request carried the revised orders');
  assert.match(await page.eval('document.querySelector("#verdict").textContent'), /Assignment accepted/);
  assert.match(await page.eval('document.querySelector("#run").textContent'), /Run again/);
  assert.equal(await page.eval('document.querySelector("#next-level").hidden'), false);
  await page.screenshot(join(artifacts, 'flow-won.png'));
  // Turn playback with the model: it reads ahead while turns play, so after the first decision the hero does not visibly wait.
  await page.click('#reset');
  await page.eval(`QuestDemo.setPace('fast')`);
  await stub({ delay: 250, replies: [] });
  await page.eval('window.__stub.turns.length = 0; window.__stub.overlaps = 0');
  await page.click('#run');
  const prepared = {};
  await page.waitFor('QuestDemo.snapshot().game.turn === 2 && QuestDemo.snapshot().playing');
  assert.equal(await page.eval('document.querySelector("#options .option.chosen")?.textContent.includes("Quick strike")'), true, 'The chosen option is stamped while its turn plays');
  assert.ok(await page.eval('document.querySelectorAll("#options .option.passed").length') >= 1, 'The options not taken are set aside');
  assert.match(await page.eval('document.querySelector("#turn-feed").textContent'), /The hero chose/);
  assert.equal(await page.eval('document.querySelector("#hero-says").hidden'), false, 'The hero says what was chosen');
  for (let i = 0; i < 200; i++) {
    const s = await page.eval('QuestDemo.snapshot()');
    if (s.lastDecision) prepared[s.game.turn] = s.lastDecision.preparedAhead;
    if (!s.running) break;
    await sleep(60);
  }
  const ran = await page.eval('QuestDemo.snapshot()');
  assert.equal(ran.game.status, 'won', 'The tutorial is won with playback on');
  assert.equal(await page.eval('window.__stub.overlaps'), 0, 'Requests never overlap in the worker');
  // Even the first real choice is prepared: it follows the automatic departure, which plays back first.
  const seen = Object.entries(prepared);
  assert.ok(seen.length >= 4, `Saw ${seen.length} decisions`);
  assert.deepEqual(seen.filter(([, ahead]) => !ahead), [], 'Every decision was prepared during the previous turn');
  // Pause freezes the turn on screen at once. The model keeps reading ahead, and Continue uses what it prepared.
  await page.eval(`QuestDemo.setPace('normal'); window.__stub.turns.length = 0`);
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().game.turn === 2 && QuestDemo.snapshot().playing && QuestDemo.snapshot().beat === 1');
  await page.click('#run');
  const frozen = await page.eval('QuestDemo.snapshot()');
  assert.deepEqual([frozen.running, frozen.paused, frozen.playing], [true, true, true], 'Pause keeps the run and the turn on screen');
  await sleep(2500); // Longer than any beat.
  assert.deepEqual([await snap('beat'), await snap('game.turn'), await snap('playing')], [frozen.beat, 2, true], 'The beat on screen holds while paused');
  assert.equal(await page.eval('document.querySelector("#paused-badge").hidden'), false, 'The stage says it is paused');
  assert.match(await page.eval('document.querySelector("#run-status").textContent'), /^Paused during turn 2\./);
  assert.match(await page.eval('document.querySelector("#run").textContent'), /Continue/);
  assert.equal(await page.eval('document.querySelector("#run").disabled || document.querySelector("#orders").disabled'), false, 'Continue and the orders are available at once');
  const pausedVolume = await snap('music.volume');
  await page.waitFor('QuestDemo.snapshot().prepared >= 1');
  await page.eval('scrollTo(0,0)');
  await page.screenshot(join(artifacts, 'flow-paused.png'));
  await page.click('#run');
  assert.equal(await snap('paused'), false);
  assert.ok(pausedVolume < await snap('music.volume'), 'Pause lowers the music, and Continue restores it');
  await page.waitFor('QuestDemo.snapshot().game.turn === 3', 15000);
  assert.equal(await snap('lastDecision.preparedAhead'), true, 'The decision prepared during the pause is used');
  assert.equal(await page.eval('window.__stub.turns.filter(turn => turn === 2).length'), 1, 'Turn 3 was asked for once, before Continue');
  // Pause while the hero waits for a slow reply: the reply arrives during the pause and waits for Continue.
  await page.click('#reset');
  await page.eval(`QuestDemo.setPace('instant'); QuestDemo.setReadAhead(0); window.__stub.turns.length = 0`);
  await stub({ delay: 600 });
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().thinking');
  await page.click('#run');
  assert.match(await page.eval('document.querySelector("#run-status").textContent'), /^Paused while the hero weighs turn 2\./);
  await sleep(900);
  assert.deepEqual([await snap('game.turn'), await snap('thinking'), await snap('prepared')], [1, true, 1], 'The reply arrived and is held');
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().game.turn === 2', 2000);
  assert.equal(await page.eval('window.__stub.turns.filter(turn => turn === 1).length'), 1, 'Continue uses the held reply');
  // Turn by turn: each Run plays one turn at normal speed and keeps it on the stage, while the model reads ahead.
  await page.click('#run'); // Pause the continuous run started above.
  await page.click('#reset');
  await page.eval(`QuestDemo.setPace('step'); QuestDemo.setReadAhead(3)`);
  await stub({ delay: 250 });
  await page.click('#run');
  await page.waitFor('!QuestDemo.snapshot().running');
  await page.click('#run');
  await page.waitFor('!QuestDemo.snapshot().running');
  const stop = await page.eval('QuestDemo.snapshot()');
  assert.deepEqual([stop.game.turn, stop.reviewing, stop.playing], [2, 2, false], 'The run stops after one turn and keeps it for review');
  assert.equal(await page.eval('document.querySelector("#stage-foot").classList.contains("reviewing") && document.querySelector("#skip").hidden'), true);
  assert.match(await page.eval('document.querySelector("#turn-feed").textContent'), /Turn 2 · The hero chose/, 'The play-by-play of that turn stays up');
  assert.equal(await page.eval('Boolean(document.querySelector("#options .option.chosen"))'), true);
  assert.match(await page.eval('document.querySelector("#run").textContent'), /Next turn/);
  await page.waitFor('/^Stopped after turn 2\\. The next move is ready\\./.test(document.querySelector("#run-status").textContent)');
  await page.eval('scrollTo(0,0)');
  await page.screenshot(join(artifacts, 'flow-review.png'));
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().game.turn === 3 && !QuestDemo.snapshot().running');
  assert.deepEqual([await snap('lastDecision.preparedAhead'), await snap('lastDecision.waitedMs')], [true, 0], 'The next turn was ready');
  await page.eval(`QuestDemo.setPace('fast')`);
  // Skip ends a turn's playback at once.
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().playing');
  await page.click('#skip');
  await sleep(50);
  assert.equal(await snap('playing'), false, 'Skip ends the playback');
  await page.click('#run');
  await page.eval(`QuestDemo.setPace('instant')`);
  // Temperature: 0 unless the player changes it, sent with every decision, and fixed for a trial like the orders.
  await page.click('#reset'); // Also ends the run paused just above.
  assert.equal(await snap('temperature'), 0, 'The default temperature is 0, as tested');
  assert.equal(await page.eval('window.__stub.temperatures.every(t => t === 0)'), true, 'Every decision so far was asked at 0');
  const setTemperature = value => page.eval(`(() => { const t = document.querySelector('#temperature'); t.value = '${value}'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const lastTemperature = () => page.eval('window.__stub.temperatures.at(-1)');
  await setTemperature(0.7);
  assert.deepEqual([await page.eval('document.querySelector("#temperature-value").textContent'), await snap('temperature')], ['0.7', 0.7]);
  assert.match(await page.eval('document.querySelector("#model-details").textContent'), /temperature 0\.7/, 'A temperature above 0 shows outside the settings too');
  await page.eval(`QuestDemo.setPace('step'); QuestDemo.setPace('instant')`);
  await page.click('#run');
  await page.waitFor('!QuestDemo.snapshot().running');
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().game.turn === 2 && !QuestDemo.snapshot().running');
  assert.equal(await lastTemperature(), 0.7, 'The worker is asked at the chosen temperature');
  await setTemperature(0.3);
  assert.match(await page.eval('document.querySelector("#temperature-note").textContent'), /keeps temperature 0\.7/);
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().game.turn === 3 && !QuestDemo.snapshot().running');
  assert.deepEqual([await lastTemperature(), await snap('runTemperature')], [0.7, 0.7], 'A change mid-trial waits for the next trial');
  await page.click('#reset');
  await page.click('#run');
  await page.waitFor('!QuestDemo.snapshot().running');
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().game.turn === 2 && !QuestDemo.snapshot().running');
  assert.equal(await lastTemperature(), 0.3, 'The next trial uses the new value');
  await setTemperature(0);
  await page.click('#reset');
  await page.viewport(390, 844, true);
  assert.equal(await page.eval('document.documentElement.scrollWidth > innerWidth'), false, 'LLM controls fit at 390px');
  await page.screenshot(join(artifacts, 'flow-phone.png'));
  await page.viewport(1440, 1100);
}
/** The published site (built as the deploy builds it) offers no Manual sandbox, and no text points to one. */
async function publishedSiteHasNoSandbox(page) {
  const out = join(artifacts, 'site-check');
  execFileSync(process.execPath, [join(ROOT, 'tools', 'build.mjs'), out], { stdio: 'pipe' });
  const site = await serve(0, out);
  try {
    await page.goto(`http://127.0.0.1:${site.address().port}/`);
    await page.waitFor('!QuestDemo.snapshot().checkingDevice');
    assert.equal(await page.eval('document.documentElement.hasAttribute("data-manual-sandbox")'), false, 'The build removes the sandbox flag');
    assert.equal(await page.eval('[...document.querySelectorAll(".manual-only")].length'), 4);
    assert.equal(await page.eval('[...document.querySelectorAll(".manual-only")].every(el => getComputedStyle(el).display === "none")'), true, 'No sandbox control or note is shown');
    // With no WebGPU, the fallback advice and the blocked status are where the sandbox used to be suggested.
    await page.eval(`Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined});`);
    await page.click('#model-settings > summary');
    await page.click('#check-device');
    await page.waitFor('QuestDemo.snapshot().device?.gpu === false');
    assert.match(await page.eval('document.querySelector("#run-status").textContent'), /Get WebGPU/);
    assert.match(await page.eval('document.querySelector("#recommendation").textContent'), /No GPU needed|CPU/);
    await page.screenshot(join(artifacts, 'published-no-sandbox.png'));
    await page.click('#help-toggle');
    assert.doesNotMatch(await page.eval('document.body.innerText'), /manual/i, 'No visible text mentions manual play');
    assert.equal(await page.eval('QuestDemo.snapshot().mode'), 'llm');
    // The Random hero is offered online: two choices under "Who plays the hero?", and a run needs no model.
    await page.eval('document.querySelector("#help").close()');
    assert.deepEqual(await page.eval('[...document.querySelectorAll(".segmented button")].filter(b => b.checkVisibility()).map(b => b.dataset.mode)'), ['llm', 'random']);
    await page.click('button[data-mode="random"]');
    assert.equal(await page.eval('QuestDemo.snapshot().mode'), 'random');
    assert.equal(await page.eval('!document.querySelector("#run").hidden && QuestDemo.snapshot().modelReady === false'), true, 'Random runs without a model on the published site');
    assert.doesNotMatch(await page.eval('document.body.innerText'), /manual/i, 'The Random note does not mention manual play');
    await page.screenshot(join(artifacts, 'published-random.png'));
  } finally { await new Promise(resolve => site.close(resolve)); }
}
/**
 * The Random hero: no model is loaded or asked, the orders are not read, and it uses the same run controls as the
 * model hero (Run, Pause, Continue, turn-by-turn stops). Every pick is labelled as random.
 */
async function randomHeroFlow(page) {
  const snap = expression => page.eval(`QuestDemo.snapshot().${expression}`);
  await page.click('button[data-mode="random"]');
  await page.click('[data-level="tutorial"]');
  if (await snap('game.turn') > 0) await page.click('#reset');
  assert.deepEqual([await snap('mode'), await snap('modelReady'), await page.eval('document.body.dataset.mode')], ['random', false, 'random']);
  assert.equal(await page.eval('!document.querySelector("#run").hidden && document.querySelector("#load-cta").hidden && document.querySelector("#manual-cta").hidden'), true, 'Random runs without a model');
  assert.equal(await page.eval('document.querySelector("#model-options").hidden && !document.querySelector("#random-note").hidden'), true, 'The model panel gives way to the Random note');
  assert.match(await page.eval('document.querySelector("#run").textContent'), /Run at random/);
  // Turn by turn: the first Run walks to the rat (no choice), the next one picks at random among the rat fight's options.
  await page.eval(`QuestDemo.setPace('step')`); // Also ends the instant pace the manual checks used.
  await page.click('#run');
  await page.waitFor('!QuestDemo.snapshot().running && !QuestDemo.snapshot().playing');
  assert.deepEqual([await snap('game.turn'), await snap('game.log[0].source'), await snap('reviewing')], [1, 'auto', 1]);
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().phase === "consider"');
  assert.match(await page.eval('document.querySelector("#options-title").textContent'), /Turn 2 · The hero picks one of \d at random/);
  assert.match(await page.eval('document.querySelector("#run-status").textContent'), /picking at random\. Your orders are not read/);
  // Pause holds the pick: the options stay up past the time they normally show, and no turn is spent.
  await page.click('#run');
  assert.equal(await snap('paused'), true);
  await sleep(BEAT_MS.consider + 400);
  assert.deepEqual([await snap('game.turn'), await snap('phase')], [1, 'consider'], 'A paused Random hero picks nothing');
  await page.click('#run');
  await page.waitFor('!QuestDemo.snapshot().running && !QuestDemo.snapshot().playing');
  assert.deepEqual([await snap('game.turn'), await snap('game.log[1].source'), await snap('reviewing')], [2, 'random', 2]);
  assert.match(await page.eval('document.querySelector("#turn-feed").textContent'), /Turn 2 · Picked at random/);
  assert.match(await page.eval('document.querySelector("#journal .log-entry .log-source").textContent'), /Random pick/);
  // The orders are not read, so the letter and its examples are locked, with a note saying why.
  const lockedLetter = () => page.eval('[document.querySelector("#orders").disabled, [...document.querySelectorAll("[data-preset]")].every(b => b.disabled), !document.querySelector("#orders-off").hidden]');
  assert.deepEqual(await lockedLetter(), [true, true, true], 'Random locks the orders and the example orders');
  assert.equal(await page.eval('document.querySelector("#orders-notice").hidden'), true);
  // The rest of the trial, unattended, to its end.
  await page.eval(`QuestDemo.setPace('normal'); QuestDemo.setPace('instant')`); // Not the Pace button: it would store the pace.
  await page.click('#run');
  await page.waitFor('["won", "lost"].includes(QuestDemo.snapshot().game.status) && !QuestDemo.snapshot().running', 20000);
  const log = await snap('game.log');
  assert.equal(log.every(entry => entry.source === 'random' || entry.source === 'auto'), true, 'Only random picks and forced moves');
  assert.equal(await snap('modelReady'), false, 'No model was loaded');
  assert.match(await page.eval('document.querySelector("#verdict").textContent'), /picked at random/, 'The verdict does not credit the orders');
  // The running checklist is now the summary: the rat, submitting, and the two limits; a lost trial names exactly one cause.
  const checks = await page.eval('[...document.querySelectorAll("#checklist .check")].map(li => ({ cls: li.className, text: li.textContent }))');
  assert.equal(checks.length, 4);
  assert.equal(checks.filter(c => /\bcause\b/.test(c.cls)).length, (await snap('game.status')) === 'lost' ? 1 : 0);
  assert.equal(checks.some(c => /\bopen\b|\bnext\b/.test(c.cls)), false, 'After the trial every row is met or not');
  assert.equal(await page.eval('document.querySelectorAll("#verdict .check").length'), 0, 'The verdict does not repeat the checklist');
  assert.match(await page.eval('document.querySelector("#run").textContent'), /Run again/);
  await page.click('#reset');
  await page.click('button[data-mode="manual"]');
  assert.deepEqual(await lockedLetter(), [false, false, false], 'Leaving Random unlocks the letter');
}
/** Chooses a pace with the real Pace button, which cycles Turn by turn → Normal → Fast. */
async function choosePace(page, name) {
  for (let i = 0; i < 3 && await page.eval('QuestDemo.snapshot().pace') !== name; i++) await page.click('#pace');
  assert.equal(await page.eval('QuestDemo.snapshot().pace'), name);
}
// Browser storage is kept per address, so a kept profile needs the same port on every run.
const server = await serve(process.env.QUEST_PROFILE ? Number(process.env.QUEST_PORT || 4174) : 0);
let page;
try {
  // QUEST_PROFILE names a folder for the test browser profile, so an interrupted model download is not lost.
  page = await launch({softwareGpu,hardwareGpu:!softwareGpu,profileDir:process.env.QUEST_PROFILE||null});
  await page.viewport(1440,1100);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitFor('!QuestDemo.snapshot().checkingDevice');
  const gpu = await page.eval(`(async()=>{if(!navigator.gpu)return null;const a=await navigator.gpu.requestAdapter();return a?{info:{vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description,isFallbackAdapter:a.info.isFallbackAdapter},maxBufferSize:a.limits.maxBufferSize,maxStorageBufferBindingSize:a.limits.maxStorageBufferBindingSize}:null})()`);
  console.log('WebGPU:',JSON.stringify(gpu));
  await page.screenshot(join(artifacts,'desktop.png'));
  assert.equal(await page.eval('document.documentElement.scrollWidth > innerWidth'),false);
  for (const width of [390,360]) {
    await page.viewport(width,844,true);
    assert.equal(await page.eval('document.documentElement.scrollWidth > innerWidth'),false,`Overflow at ${width}px`);
    await page.screenshot(join(artifacts,`phone-${width}.png`));
  }
  await page.viewport(1440,1100);
  if (!llm) {
    if (!(await page.eval('QuestDemo.snapshot().device.gpu && !QuestDemo.snapshot().device.software'))) {
      // UI checks can exercise recommendations even on hosts without a hardware adapter. No inference is claimed.
      await page.eval(`Object.defineProperty(navigator,'gpu',{configurable:true,value:{requestAdapter:async()=>({info:{description:'UI test adapter'},limits:{maxBufferSize:2**30,maxStorageBufferBindingSize:2**30}})}});`);
      await page.click('#check-device');
      await page.waitFor('!QuestDemo.snapshot().checkingDevice');
    }
    const baseline = await page.eval('document.querySelector("#model").value');
    assert.match(await page.eval('document.querySelector("#recommendation").textContent'), /Suggested:/);
    assert.equal(await page.eval('document.querySelector("#load-cta").hidden'),false,'The trial offers the model load as its primary action');
    assert.equal(await page.eval('document.querySelector("#run").hidden'),true,'Run stays hidden until a model is ready');
    await page.click('#model-settings > summary');
    await page.click('.memory-settings summary');
    await page.eval(`document.querySelector('#gpu-memory').value='24';document.querySelector('#gpu-memory').dispatchEvent(new Event('change'));`);
    assert.equal(await page.eval('document.querySelector("#model").value'),baseline,'Recommendations never silently switch a model');
    assert.equal(await page.eval('QuestDemo.snapshot().recommendation'),'Qwen3-8B-q4f32_1-MLC');
    await page.click('#use-recommendation');
    assert.equal(await page.eval('document.querySelector("#model").value'),'Qwen3-8B-q4f32_1-MLC');
    assert.match(await page.eval('document.querySelector("#model-details").textContent'),/6.9 GB/);
    await page.eval(`document.querySelector('#gpu-memory').value='2';document.querySelector('#gpu-memory').dispatchEvent(new Event('change'));`);
    assert.match(await page.eval('document.querySelector("#model-advice").textContent'),/exceeds/);
    await page.click('#check-device');
    await page.waitFor('!QuestDemo.snapshot().checkingDevice');
    assert.equal(await page.eval('document.querySelector("#model").value'),'Qwen3-8B-q4f32_1-MLC');
    await page.screenshot(join(artifacts,'model-check-desktop.png'));
    await page.viewport(360,844,true);
    assert.equal(await page.eval('document.documentElement.scrollWidth > innerWidth'),false,'Model advice fits at 360px');
    await page.screenshot(join(artifacts,'model-check-phone.png'));
    await page.viewport(1440,1100);
    // Exercise unavailable WebGPU through the real check control, without downloading any model.
    await page.eval(`Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined});`);
    await page.click('#check-device');
    await page.waitFor('!QuestDemo.snapshot().checkingDevice');
    assert.equal(await page.eval('QuestDemo.snapshot().device.gpu'),false);
    assert.match(await page.eval('document.querySelector("#recommendation").textContent'),/CPU/);
    assert.equal(await page.eval('document.querySelector("#webgpu-help").open'),true,'Missing WebGPU opens the browser setup guide');
    assert.match(await page.eval('document.querySelector("#webgpu-help").textContent'),/Windows[\s\S]*Mac[\s\S]*Linux[\s\S]*--enable-unsafe-webgpu --use-angle=vulkan --enable-features=Vulkan/);
    assert.doesNotMatch(await page.eval('document.body.textContent'),/npm |localhost/,'The page gives no local-run instructions; the game is played online');
    assert.match(await page.eval('document.querySelector("#run-status").textContent'),/Get WebGPU/,'The blocked status points to the guide');
    await page.viewport(360,844,true);
    assert.equal(await page.eval('document.documentElement.scrollWidth > innerWidth'),false,'The WebGPU guide fits at 360px');
    await page.eval('document.querySelector("#webgpu-help").scrollIntoView()');
    await page.screenshot(join(artifacts,'webgpu-help-phone.png'));
    await page.viewport(1440,1100);
    await page.click('#use-recommendation');
    assert.match(await page.eval('document.querySelector("#model").value'),/^cpu:/);
    assert.equal(await page.eval('QuestDemo.snapshot().game.turn'),0,'Checks and selections do not consume turns');
    assert.equal(await page.eval('QuestDemo.snapshot().modelReady'),false,'Checking never downloads a model');
    await page.click('[data-level="circuit"]');
    await page.click('#manual-cta');
    // Quick manual clicks; turn playback is checked on the guarded charge below.
    await page.eval(`QuestDemo.setPace('instant')`);
    assert.equal(await page.eval('QuestDemo.snapshot().mode'),'manual');
    assert.equal(await page.eval('document.body.dataset.mode'),'manual','Manual sandbox is labelled on the page');
    assert.equal(await page.eval('document.querySelector("#load-cta").hidden && document.querySelector("#run").hidden'),true,'Manual sandbox offers no model controls in the trial');
    await page.click('[data-action="depart"]');
    assert.equal(await page.eval('QuestDemo.snapshot().game.position'),1);
    await page.click('[data-action="quick"]');
    await page.click('[data-action="potion"]');
    assert.equal(await page.eval('QuestDemo.snapshot().game.potions'),1);
    assert.equal(await page.eval('QuestDemo.snapshot().game.hp'),37);
    assert.equal(await page.eval('document.querySelector("#hp-value").textContent'),'37');
    assert.equal(await page.eval('document.querySelector("#hp-flag").hidden'),true,'37 HP is not flagged LOW');
    assert.match(await page.eval('document.querySelector("#journal .log-entry").textContent'),/Drink potion/);
    assert.equal(await page.eval('document.querySelectorAll("#journal .log-entry").length'),3);
    await page.click('#reset');
    assert.equal(await page.eval('QuestDemo.snapshot().game.turn'),0);
    // Full-circuit opponents announce their moves; guarding a smash counters it.
    for(const id of ['depart','quick','quick','advance','advance'])await page.click(`[data-action="${id}"]`);
    assert.equal(await page.eval('QuestDemo.snapshot().game.enemy.name'),'Tin boar');
    assert.equal(await page.eval('document.querySelector("#foe-intent").hidden'),false,'The announced move is shown');
    assert.match(await page.eval('document.querySelector("#foe-intent").textContent'),/Smash.*12 dmg.*Charge/);
    assert.match(await page.eval('document.querySelector("#foe-intent").className'),/kind-smash/);
    assert.match(await page.eval('document.querySelector("#seen-text").textContent'),/about to SMASH/,'The hero is told the same move');
    // The engine resolves the turn at once; the stage then plays it back: the choice, the guard, the blocked charge, the counter.
    await page.eval(`QuestDemo.setPace('fast')`);
    await page.click('[data-action="guard"]');
    assert.equal(await page.eval('QuestDemo.snapshot().game.hp'),33,'Guard blocked 8 of the 12-damage charge after the rat\'s nibble');
    assert.equal(await page.eval('QuestDemo.snapshot().game.enemy.hp'),8,'The guarded charge was countered for 10');
    assert.deepEqual(await page.eval('QuestDemo.snapshot().beatKinds'),['choice','guard','foe-blocked','counter']);
    assert.equal(await page.eval('document.querySelector("#hp-value").textContent'),'37','The stage shows the hero as they were until the charge lands');
    assert.equal(await page.eval('document.querySelector("#hero-says").textContent'),'Guard!');
    assert.equal(await page.eval('document.querySelectorAll("#options .option.passed").length'),4,'The four options not taken are set aside');
    assert.equal(await page.eval('document.querySelectorAll("#options button").length'),0,'No new action can be chosen while a turn plays');
    await page.waitFor('QuestDemo.snapshot().beat === 2');
    assert.equal(await page.eval('document.querySelector("#hp-value").textContent'),'33');
    assert.match(await page.eval('document.querySelector("#foe-intent").className'),/acting/,'The opponent\'s move box marks its turn');
    assert.equal(await page.eval('document.querySelector("#foe-hp-value").textContent'),'18','The counter has not landed yet');
    await page.waitFor('!QuestDemo.snapshot().playing');
    assert.equal(await page.eval('document.querySelector("#foe-hp-value").textContent'),'8');
    assert.match(await page.eval('document.querySelector("#journal .log-entry").textContent'),/Countered for 10/);
    // When the opponent acts on a turn's last beat, its box names the move it is making, not the one announced next.
    await page.eval('QuestDemo.hold(2)');
    await page.click('[data-action="quick"]');
    await page.waitFor('QuestDemo.snapshot().beat === 2');
    assert.deepEqual(await page.eval('QuestDemo.snapshot().beatKinds'),['choice','strike','foe-hit']);
    assert.match(await page.eval('document.querySelector("#foe-intent").textContent'),/^Now.*Gore/);
    await page.eval('QuestDemo.hold(null)');
    await page.waitFor('!QuestDemo.snapshot().playing');
    assert.match(await page.eval('document.querySelector("#foe-intent").textContent'),/^Next move.*Charge/);
    await page.eval(`QuestDemo.setPace('instant')`);
    // Without a model the orders show their size with estimated tokens. Long orders are never blocked.
    const typed = await page.eval('document.querySelector("#orders").value');
    await page.eval(`(() => { const o = document.querySelector('#orders'); o.value = ${JSON.stringify('Collect all three stamps, defeat the champion, and submit at camp. When your health is LOW, drink a potion if one is available. Otherwise save potions. In every fight, use a heavy strike whenever it is available. Use a quick strike when heavy is unavailable. Guard when the enemy is about to smash, unless it is nearly dead. Outside fights, visit the medic, buy the buckler, or rest when offered. Otherwise continue.')}; o.dispatchEvent(new Event('input')); })()`);
    assert.match(await page.eval('document.querySelector("#orders-size").textContent'),/^72 words · about 91 tokens$/);
    await page.eval(`(() => { const o = document.querySelector('#orders'); o.value = ${JSON.stringify(typed)}; o.dispatchEvent(new Event('input')); })()`);
    assert.match(await page.eval('document.querySelector("#orders-size").textContent'),/^\d+ words · about \d+ tokens$/);
    // This policy only drives deterministic engine/UI verification. It is not an LLM substitute.
    // The checklist's notes change every turn, but its height does not, so it never pushes the stage and controls around.
    const checklistHeights = new Set();
    for (let i=0;i<40;i++) {
      const s = await page.eval('QuestDemo.snapshot().game');
      if (s.status==='won' || s.status==='lost') break;
      checklistHeights.add(await page.eval('document.querySelector("#checklist").offsetHeight'));
      const action = await page.eval(`(() => {
        const s=QuestDemo.snapshot().game;
        const has=id=>Boolean(document.querySelector('[data-action="'+id+'"]'));
        if(has('potion')&&s.hp<=18)return 'potion';
        if(s.enemy){
          if(s.enemy.optional)return 'retreat';
          const move=s.enemy.routine[s.enemy.step%s.enemy.routine.length];
          return move.kind==='smash'?'guard':'quick';
        }
        for(const id of ['medic','buy_buckler','rest'])if(has(id))return id;
        return has('finish')?'finish':has('depart')?'depart':'advance';
      })()`);
      await page.click(`[data-action="${action}"]`);
    }
    const result = await page.eval('QuestDemo.snapshot()');
    assert.equal(result.game.status,'won');
    assert.equal(checklistHeights.size,1,`The checklist keeps one height through the trial (${[...checklistHeights]})`);
    assert.equal(result.game.log.every(entry=>entry.source==='manual'),true);
    assert.match(await page.eval('document.querySelector("#verdict").textContent'),/Assignment accepted/);
    assert.equal(await page.eval('document.querySelectorAll("#checklist ol .check.done").length'),5,'All five goals are ticked');
    assert.match(await page.eval('document.querySelector("#verdict").textContent'),/Commendations \d of 4/,'The verdict lists commendations');
    assert.deepEqual(await page.eval('[...document.querySelectorAll("#checklist .check")].map(li => li.className.replace(/ fresh$/, ""))'),['check done stamp','check done stamp','check done stamp','check done champion','check done submit','check done health','check done turns'],'The checklist after the win: four opponents, submit, and both limits, all met');
    assert.match(await page.eval('document.querySelector("#sword-value").textContent'),/buckler/i);
    assert.equal(await page.eval('document.querySelector("#next-level").hidden'),true,'The full circuit is the last assignment');
    await page.screenshot(join(artifacts,'victory.png'));
    await page.viewport(390,844,true);
    assert.equal(await page.eval('document.documentElement.scrollWidth > innerWidth'),false);
    await page.screenshot(join(artifacts,'phone-victory.png'));
    await page.viewport(1440,1100);
    await page.click('[data-level="tutorial"]');
    for(const id of ['depart','quick','quick','advance','advance','finish'])await page.click(`[data-action="${id}"]`);
    assert.equal(await page.eval('QuestDemo.snapshot().game.status'),'won');
    // Music (no audio is checked, only what the player is asked to play): the win stinger once the win shows, the desk after
    // a restart, the trial from its first turn, and a separate switch that stops and restarts it.
    const music = () => page.eval('QuestDemo.snapshot().music');
    assert.equal((await music()).started, true, 'Music starts on the first click');
    await page.waitFor('QuestDemo.snapshot().music.cue === "won"', 5000);
    await page.click('#reset');
    assert.equal((await music()).asked, 'desk');
    await page.click('[data-action="depart"]');
    await page.waitFor('QuestDemo.snapshot().music.cue === "trial"', 5000);
    await page.click('#music');
    assert.deepEqual([(await music()).started, await page.eval('document.querySelector("#music").getAttribute("aria-pressed")'), await page.eval('QuestDemo.snapshot().sound')], [false, 'false', true], 'The music switch leaves the sound effects alone');
    await page.click('#music');
    assert.equal((await music()).cue === 'trial' || (await music()).asked === 'trial', true, 'Switched back on, it resumes the trial music');
    await page.click('#reset');
    for(const id of ['depart','quick','quick','advance','advance','finish'])await page.click(`[data-action="${id}"]`);
    // Fair warning and Prize money deal each opponent's routine in a new order every trial. These clicks follow the fixed
    // routines, so the draw is switched off for them; it is checked after the walk.
    await page.eval('QuestDemo.setSeed(null)');
    // Next assignment walks through the two middle assignments to the full circuit. Each is won through the real controls.
    const middle = {
      warning: { stops: 5, goals: 4, win: ['depart','quick','quick','advance','guard','quick','guard','advance','quick','quick','quick','advance','advance','finish'] },
      prize: { stops: 9, goals: 3, win: ['depart','advance','quick','guard','quick','advance','medic','advance','quick','quick','quick','advance','buy_sword','advance','advance','quick','quick','guard','potion','quick','advance','advance','finish'] },
    };
    for (const [name, { stops, goals, win }] of Object.entries(middle)) {
      await page.click('#next-level');
      assert.equal(await page.eval('QuestDemo.snapshot().game.level'),name);
      assert.equal(await page.eval(`document.querySelector('[data-level="${name}"]').getAttribute('aria-pressed')`),'true');
      assert.equal(await page.eval('document.querySelectorAll("#map .node").length'),stops,`${name} draws only its own stops`);
      // The running checklist: open before the first move, with this assignment's goals and turn limit, ticked off during
      // the trial (the first win ticks one goal and moves the next marker on), and all met at the end.
      const rows = () => page.eval('[...document.querySelectorAll("#checklist .check")].filter(li => li.checkVisibility()).map(li => li.className.replace(/ fresh$/, "") + " | " + li.querySelector(".check-label").firstChild.textContent + " | " + li.querySelector(".check-note").textContent)');
      const limit = await page.eval('QuestDemo.snapshot().game.turnLimit');
      const before = await rows();
      assert.equal(before.length, goals + 2);
      assert.equal(before.filter(r => /^check open/.test(r)).length, goals + 2, `${name}: everything is open before the first move`);
      assert.match(before[0], / next \| Beat /);
      assert.equal(before.at(-1), `check open turns | Stay within ${limit} turns | 0 of ${limit} used`);
      let ticked = false;
      for (const id of win) {
        await page.click(`[data-action="${id}"]`);
        const now = await rows();
        if (!ticked && now.some(r => /^check done stamp/.test(r))) {
          ticked = true;
          assert.match(now.find(r => / next /.test(r)) || '', /^check open/, `${name}: the next marker moves on after the first win`);
          assert.match(now.at(-1), new RegExp(`\\| \\d+ of ${limit} used$`));
        }
      }
      assert.equal(ticked, true, `${name}: a goal was ticked during the trial`);
      assert.equal(await page.eval('QuestDemo.snapshot().game.status'),'won',`${name} is won through the controls`);
      assert.equal((await rows()).filter(r => /^check done/.test(r)).length, goals + 2, `${name}: every row met at the end`);
      assert.equal(await page.eval('document.querySelector("#next-level").hidden'),false);
    }
    await page.click('#next-level');
    assert.equal(await page.eval('QuestDemo.snapshot().game.level'),'circuit');
    // With the draw on, every Fair warning trial has its own seed; the circuit has none.
    await page.eval('QuestDemo.setSeed(undefined)');
    assert.equal(await page.eval('QuestDemo.snapshot().game.seed'), null, 'The circuit keeps its fixed routines');
    await page.click('[data-level="warning"]');
    const firstSeed = await page.eval('QuestDemo.snapshot().game.seed');
    await page.click('[data-level="prize"]');
    assert.ok(Number.isInteger(await page.eval('QuestDemo.snapshot().game.seed')), 'A Prize money trial draws a seed');
    await page.click('[data-level="warning"]');
    const secondSeed = await page.eval('QuestDemo.snapshot().game.seed');
    assert.ok(Number.isInteger(firstSeed) && Number.isInteger(secondSeed) && firstSeed !== secondSeed, 'Each Fair warning trial draws a new seed');
    await page.click('[data-level="circuit"]');
    await page.viewport(390,844,true);
    assert.equal(await page.eval('[...document.querySelectorAll(".tabs button")].every(tab => tab.getBoundingClientRect().right <= innerWidth)'),true,'All four assignment tabs fit on a phone');
    await page.viewport(1440,1100);
    await randomHeroFlow(page);
    await stubbedLlmFlow(page, `http://127.0.0.1:${server.address().port}/`);
    await publishedSiteHasNoSandbox(page);
    await writeFile(join(artifacts,'browser-report.json'),JSON.stringify({kind:'manual UI verification plus LLM-mode interface flow with a stub worker; no model inference',result,errors:page.errors},null,2));
    console.log(`Browser UI passed: desktop, 390px, 360px, potion costs, restart, complete victory in ${result.game.turn} turns, music cues and switch.`);
    console.log('Random hero checked without a model: turn by turn, pause holds the pick, orders locked, a whole trial, labels, verdict and checklist.');
    console.log('Published build checked: no Manual sandbox controls or text; Random offered.');
    console.log('LLM-mode interface flow passed with a stub worker (no inference): load, thinking, stale reply, parse failure and retry, edited orders, turn playback with prepared decisions, pause during playback and during thinking, turn-by-turn pace, skip, temperature.');
  } else {
    // The test profile can be persistent (QUEST_PROFILE), so orders saved by an earlier run must not leak into this one.
    const tutorialOrders = 'Fight the practice rat using quick strikes. After earning its training stamp, return to camp and submit the assignment.';
    // A click straight after the viewport change can land before the layout settles, so retry until the preset applies.
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.click('[data-preset="careful"]');
      if (await page.eval(`document.querySelector("#orders").value === ${JSON.stringify(tutorialOrders)}`)) break;
      await new Promise(done => setTimeout(done, 300));
    }
    assert.equal(await page.eval('QuestDemo.snapshot().game.level'),'tutorial','The model checks start on the introductory assignment');
    assert.equal(await page.eval('document.querySelector("#orders").value'),tutorialOrders,'The careful example orders are in place');
    // QUEST_TEMPERATURE runs the model at that sampling temperature. The default, 0, is how every recorded result was made.
    await page.eval(`(() => { const t = document.querySelector('#temperature'); t.value = '${Number(process.env.QUEST_TEMPERATURE || 0)}'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.equal(await page.eval('QuestDemo.snapshot().temperature'),Number(process.env.QUEST_TEMPERATURE || 0),'QUEST_TEMPERATURE is between 0 and 1.5, in steps of 0.1');
    if(gpuTest) {
      if(!gpu)throw Error('WebGPU did not expose an adapter for the inference test.');
      await page.eval(`document.querySelector('#model').value=${JSON.stringify(customModel || (softwareGpu?'Qwen2.5-0.5B-Instruct-q4f32_1-MLC':'Qwen2.5-3B-Instruct-q4f32_1-MLC'))};document.querySelector('#model').dispatchEvent(new Event('change',{bubbles:true}));`);
    } else await page.eval(`document.querySelector('#model').value='cpu:onnx-community/Qwen2.5-0.5B-Instruct';document.querySelector('#model').dispatchEvent(new Event('change',{bubbles:true}));`);
    await page.click('#load-model');
    const start=Date.now();
    let prior='';
    // A first download of the default model is about 1.7 GB. QUEST_LOAD_MINUTES extends the wait on a slow connection.
    while(Date.now()-start<Number(process.env.QUEST_LOAD_MINUTES||12)*60*1000){
      const snapshot=await page.eval(`({ready:QuestDemo.snapshot().modelReady,text:document.querySelector('#model-status').textContent,loading:document.querySelector('#load-model').disabled})`);
      if(snapshot.text!==prior){console.log(snapshot.text);prior=snapshot.text;}
      if(snapshot.ready)break;
      if(!snapshot.loading)throw Error(snapshot.text);
      await sleep(2000);
    }
    assert.equal(await page.eval('QuestDemo.snapshot().modelReady'),true,'Model did not become ready');
    const loadedSelection = await page.eval('document.querySelector("#model").value');
    assert.equal(await page.eval('!document.querySelector("#run").hidden && document.querySelector("#load-cta").hidden'),true,'A ready model swaps the load action for Run');
    await page.click('#model-settings > summary');
    await page.click('#check-device');
    await page.waitFor('!QuestDemo.snapshot().checkingDevice');
    assert.equal(await page.eval('QuestDemo.snapshot().modelReady'),true,'Rechecking must not unload a ready model');
    assert.equal(await page.eval('document.querySelector("#model").value'),loadedSelection);
    assert.equal(await page.eval('document.querySelector("#orders").value'),tutorialOrders,'Loading and checking the model must not change the orders');
    // One turn per Run. A forced departure is automatic; inference is reserved for real decisions.
    await choosePace(page, 'step');
    await page.click('#run');
    await page.waitFor('!QuestDemo.snapshot().running',190000);
    const first=await page.eval('QuestDemo.snapshot()');
    assert.equal(first.game.turn,1,first.status);
    assert.equal(first.game.log[0].source,'auto');
    // Then let the model make a real combat choice from multiple options.
    await page.click('#run');
    await page.waitFor('!QuestDemo.snapshot().running',190000);
    const combat=await page.eval('QuestDemo.snapshot()');
    assert.equal(combat.game.turn,2,combat.status);
    assert.equal(combat.lastDecision.ordersReceived,combat.orders);
    assert.equal(combat.game.log[1].source,'llm');
    assert.ok(['quick','heavy','retreat'].includes(combat.game.log[1].action));
    await page.screenshot(join(artifacts,'llm-combat.png'));
    console.log('Real LLM combat action:',JSON.stringify(combat.lastDecision));
    await page.eval(`document.querySelector('#orders').value='Always retreat from every enemy. Leave every fight immediately. Never attack.';document.querySelector('#orders').dispatchEvent(new Event('input',{bubbles:true}));`);
    await page.click('#reset');
    await page.click('#run');
    await page.waitFor('!QuestDemo.snapshot().running',190000);
    await page.click('#run');
    await page.waitFor('!QuestDemo.snapshot().running',190000);
    const reversed = await page.eval('QuestDemo.snapshot()');
    assert.equal(reversed.game.turn,2,reversed.status);
    assert.equal(reversed.lastDecision.ordersReceived,reversed.orders);
    console.log('Retreat-order response:',JSON.stringify(reversed.lastDecision));
    await choosePace(page, 'normal');
    let fullResult;
    if(fullTrial) {
      await page.click('[data-preset="careful"]');
      await page.click('#run');
      const trialStart=Date.now();
      let lastTurn=-1;
      while(Date.now()-trialStart<600000) {
        fullResult=await page.eval('QuestDemo.snapshot()');
        if(fullResult.lastDecision)assert.equal(fullResult.lastDecision.ordersReceived,fullResult.orders,'Worker must receive the current player orders');
        if(fullResult.game.turn!==lastTurn){console.log(`Full LLM trial: turn ${fullResult.game.turn}, ${fullResult.game.hp} HP, ${fullResult.game.stamps.length} stamps, ${fullResult.game.log.at(-1)?.label||'starting'}`);lastTurn=fullResult.game.turn;}
        if(!fullResult.running&&!fullResult.thinking)break;
        await sleep(500);
      }
      await writeFile(join(artifacts,'llm-full-trial.json'),JSON.stringify(fullResult,null,2));
      await page.screenshot(join(artifacts,'llm-full-trial.png'));
      assert.equal(fullResult.game.status,'won',`Full model-controlled trial: ${fullResult.game.status}. ${fullResult.status}`);
      assert.ok(fullResult.game.log.some(entry=>entry.source==='llm'));
      assert.equal(fullResult.game.log.some(entry=>entry.source==='manual'),false);
    }
    // Each requested trial: the model plays a whole assignment with one set of example orders. Evidence, not a gate.
    const trials=[...levelTrials.flatMap(level=>customOrders?customOrders.map((text,i)=>[level,`custom${i+1}`,text]):[[level,'careful'],[level,'reckless']]),...(circuitTrial?[['circuit','careful']]:[])];
    const played=[];
    let circuit;
    // The fixed routines, so these trials compare with the earlier recorded runs. QUEST_SEED=n plays one drawn order instead.
    await page.eval(`QuestDemo.setSeed(${process.env.QUEST_SEED ? Number(process.env.QUEST_SEED) : null})`);
    for(const [level,preset,text] of trials) {
      const label=`${level} (${preset === 'careful' ? 'careful' : preset === 'reckless' ? 'first draft' : preset})`;
      const file=level==='circuit'&&preset==='careful'?'llm-circuit-trial':`llm-${level}-${preset}-trial`;
      await page.click(`[data-level="${level}"]`);
      if(text){
        await page.eval(`document.querySelector('#orders').value=${JSON.stringify(text)};document.querySelector('#orders').dispatchEvent(new Event('input',{bubbles:true}))`);
        if(await page.eval('QuestDemo.snapshot().game.turn>0'))await page.click('#reset');
      }
      else await page.click(`[data-preset="${preset}"]`);
      await page.click('#run');
      const trialStart=Date.now();
      let lastTurn=-1;
      let snapshot;
      // Per model decision: model time, whether it was ready before its options went up, and how long the player saw the hero wait.
      const timings={};
      while(Date.now()-trialStart<900000) {
        snapshot=await page.eval('QuestDemo.snapshot()');
        if(snapshot.game.log.at(-1)?.source==='llm'&&snapshot.lastDecision)timings[snapshot.game.turn]={modelMs:Math.round(snapshot.lastDecision.elapsed),preparedAhead:snapshot.lastDecision.preparedAhead,waitedMs:snapshot.lastDecision.waitedMs};
        if(snapshot.lastDecision&&snapshot.game.level===level)assert.equal(snapshot.lastDecision.ordersReceived,snapshot.orders,'Worker must receive the current player orders');
        if(snapshot.game.turn!==lastTurn){const e=snapshot.game.log.at(-1);console.log(`${label} LLM trial: turn ${snapshot.game.turn}, ${snapshot.game.hp} HP, ${snapshot.game.stamps.length} stamps, ${e?`${e.label} at ${e.at} (${e.source})`:'starting'}`);lastTurn=snapshot.game.turn;}
        if(!snapshot.running&&!snapshot.thinking)break;
        await sleep(500);
      }
      // Replay the log through the engine to recover what the hero was told before each model decision.
      let replay=newGame(level);
      const decisions=[];
      for(const entry of snapshot.game.log){
        const move=replay.enemy?nextMove(replay.enemy):null;
        if(entry.source==='llm')decisions.push({turn:entry.turn,at:entry.at,move:move?.kind||null,hp:replay.hp,action:entry.action,offer:prizeOffered(replay)});
        replay=applyAction(replay,entry.action,entry.source);
      }
      const count=(filter,action)=>`${decisions.filter(d=>filter(d)&&(!action||action(d))).length}`;
      const summary={status:snapshot.game.status,turns:snapshot.game.turn,hp:snapshot.game.hp,potions:snapshot.game.potions,stamps:snapshot.game.stamps.length,champion:snapshot.game.champion,
        smashGuarded:`${count(d=>d.move==='smash',d=>d.action==='guard')} of ${count(d=>d.move==='smash')}`,
        guardedOrdinaryHits:`${count(d=>d.move==='strike',d=>d.action==='guard')} of ${count(d=>d.move==='strike')}`,
        potionsAtLow:`${count(d=>d.hp<=18,d=>d.action==='potion')} of ${count(d=>d.hp<=18)}`,
        optionalRetreated:`${count(d=>d.at==='Prize bruiser',d=>d.action==='retreat')} of ${count(d=>d.at==='Prize bruiser')}`,
        // In the full circuit the bruiser waits: walking on (advance) or taking the fight (challenge) is decided first.
        optionalWalkedPast:`${count(d=>d.offer,d=>d.action==='advance')} of ${count(d=>d.offer)}`,
        llmDecisions:decisions.length, autoMoves:snapshot.game.log.filter(e=>e.source==='auto').length, manual:snapshot.game.log.filter(e=>e.source==='manual').length,
        playback:{pace:snapshot.pace,seconds:Math.round((Date.now()-trialStart)/1000),timed:Object.keys(timings).length,preparedAhead:Object.values(timings).filter(t=>t.preparedAhead).length,visibleWaitMs:Object.values(timings).reduce((sum,t)=>sum+(t.waitedMs||0),0),modelMs:Object.values(timings).reduce((sum,t)=>sum+t.modelMs,0)}};
      const record={level,preset,summary,decisions,timings,orders:snapshot.orders,status:snapshot.status,model:loadedSelection,temperature:snapshot.runTemperature};
      await writeFile(join(artifacts,`${file}.json`),JSON.stringify({...record,snapshot},null,2));
      await page.screenshot(join(artifacts,`${file}.png`));
      console.log(`${label} LLM trial summary:`,JSON.stringify(summary));
      for(const d of decisions)console.log(`  turn ${String(d.turn).padStart(2)} ${d.at.padEnd(15)} ${(d.move||'-').padEnd(7)} ${String(d.hp).padStart(2)} HP -> ${d.action}`);
      assert.equal(summary.manual,0,'No manual actions in a model-controlled trial');
      played.push(record);
      if(level==='circuit')circuit=record;
    }
    await writeFile(join(artifacts,'llm-report.json'),JSON.stringify({kind:gpuTest?`real local WebLLM inference with ${softwareGpu?'software':'hardware'} WebGPU`:'real local Transformers.js inference with CPU WebAssembly',gpu,first,combat,reversed,fullResult,circuit,trials:played.map(({level,preset,summary})=>({level,preset,summary})),errors:page.errors,logs:page.logs},null,2));
    assert.equal(reversed.game.log[1].action,'retreat','Changed standing orders should change the combat choice');
    assert.notEqual(reversed.game.log[1].action,combat.game.log[1].action);
  }
  assert.deepEqual(page.errors,[],'Browser console or runtime errors');
} catch(error) {
  if(page){await writeFile(join(artifacts,llm?'llm-failure.json':'browser-failure.json'),JSON.stringify({error:error.message,errors:page.errors,logs:page.logs,snapshot:await page.eval('QuestDemo.snapshot()').catch(()=>null),modelStatus:await page.eval('document.querySelector("#model-status").textContent').catch(()=>null)},null,2));await page.screenshot(join(artifacts,'failure.png')).catch(()=>{});}
  console.error(error);
  process.exitCode=1;
} finally { await page?.close(); await new Promise(resolve=>server.close(resolve)); }

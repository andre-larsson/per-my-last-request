import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve, ROOT } from './serve.mjs';
import { launch, sleep } from './chrome.mjs';
import { findModel } from '../src/models.js';
import { newGame, applyAction, nextMove } from '../src/game.js';

const llm = process.argv.includes('--llm');
const gpuTest = llm && !process.argv.includes('--cpu');
const softwareGpu = process.argv.includes('--software-gpu');
const fullTrial = process.argv.includes('--full');
// --circuit: after the tutorial checks, the model plays the full circuit with the example orders. Evidence, not a pass/fail gate.
const circuitTrial = process.argv.includes('--circuit');
const customModel = process.env.QUEST_MODEL;
if (customModel && !findModel(customModel)) throw new Error(`Unknown test model: ${customModel}`);
const artifacts = join(ROOT, 'artifacts', customModel ? customModel.replace(/[^a-z0-9-]/gi, '-') : '');
await mkdir(artifacts,{recursive:true});
// A stand-in for the model worker, injected by this test only. It answers the worker protocol with a fixed
// preference order so the LLM-mode interface can be exercised without a download. It is not inference,
// and nothing in the game can select it.
const STUB_WORKER = `window.__stub = { delay: 30, replies: [], seen: [], turns: [], overlaps: 0 };
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
  // The forced departure is automatic. The next turn is a real choice, answered slowly so the waiting state can be seen.
  await page.click('#step');
  assert.equal(await snap('game.log[0].source'), 'auto');
  await stub({ delay: 700, replies: ['retreat'] });
  await page.click('#step');
  await page.waitFor('QuestDemo.snapshot().thinking');
  assert.equal(await page.eval('document.querySelector("#hero-card").classList.contains("thinking") && document.querySelector("#orders").disabled'), true, 'Thinking is visible and locks the orders');
  assert.match(await page.eval('document.querySelector("#run-status").textContent'), /Game time is paused/);
  assert.equal(await snap('game.turn'), 1, 'Thinking spends no turn');
  await page.eval('scrollTo(0,0)');
  await page.screenshot(join(artifacts, 'flow-thinking.png'));
  await page.waitFor('!QuestDemo.snapshot().thinking');
  assert.deepEqual([await snap('game.turn'), await snap('game.log[1].source'), await snap('game.log[1].action')], [2, 'llm', 'retreat']);
  assert.equal(await page.eval('window.__stub.seen.at(-1) === QuestDemo.snapshot().orders'), true, 'The worker receives the orders in force');
  // A reply that arrives after a restart must not act on the new trial.
  await stub({ replies: ['potion'] });
  await page.click('#step');
  await page.waitFor('QuestDemo.snapshot().thinking');
  await page.click('#reset');
  await sleep(1000);
  assert.deepEqual([await snap('game.turn'), await snap('game.log.length'), await snap('thinking')], [0, 0, false], 'A stale reply is discarded after Restart');
  // Unusable output is a model failure: reported, retried once, and free of charge.
  await stub({ delay: 30 });
  await page.click('#step');
  await stub({ replies: ['garbage', 'garbage'] });
  await page.click('#step');
  await page.waitFor('!QuestDemo.snapshot().thinking && /No turn was spent/.test(QuestDemo.snapshot().status)');
  assert.equal(await snap('game.turn'), 1, 'A parsing failure spends no turn');
  assert.equal(await page.eval('document.querySelector("#run-status").classList.contains("error")'), true);
  // Orders edited mid-trial: the page says so, and the next run starts a fresh trial with the new text.
  const revised = 'Fight the practice rat with quick strikes, then return to camp and submit.';
  await page.eval(`document.querySelector('#orders').value=${JSON.stringify(revised)};document.querySelector('#orders').dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(await page.eval('document.querySelector("#orders-notice").hidden'), false, 'Edited orders are flagged before they apply');
  assert.match(await page.eval('document.querySelector("#orders-size").textContent'), /about/, 'Until the model has counted the new text, the tokens are an estimate');
  await page.waitFor(sizeShows(revised));
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
  // Run again restarts at once; Pause stops the run and drops the reply in flight.
  await stub({ delay: 600 });
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().thinking');
  const pausedAt = await snap('game.turn');
  await page.click('#run');
  assert.equal(await snap('running'), false);
  await sleep(900);
  assert.equal(await snap('game.turn'), pausedAt, 'The reply in flight at Pause is discarded');
  assert.match(await snap('status'), /Paused/);
  // Turn playback with the model: the next decision is asked for while the current turn plays,
  // so after the first decision the hero does not visibly wait for the model.
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
  // Pause during playback: the turn on screen finishes, nothing further is committed, and the prepared reply is dropped.
  await stub({ delay: 250 });
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().game.turn === 2 && QuestDemo.snapshot().playing');
  await page.click('#run');
  assert.deepEqual([await snap('running'), await snap('playing')], [false, true], 'Pause lets the turn on screen finish');
  await page.waitFor('!QuestDemo.snapshot().playing');
  await sleep(500);
  assert.equal(await snap('game.turn'), 2, 'A decision prepared before Pause is not used');
  // Continue asks again, from the same state; Skip ends a turn's playback at once.
  const asked = await page.eval('window.__stub.turns.length');
  await page.click('#run');
  await page.waitFor('QuestDemo.snapshot().game.turn === 3 && QuestDemo.snapshot().playing');
  assert.equal(await page.eval(`window.__stub.turns[${asked}]`), 2, 'Continue asks the model about the state on screen');
  await page.click('#skip');
  await sleep(50);
  assert.equal(await snap('playing'), false, 'Skip ends the playback');
  await page.click('#run');
  await page.eval(`QuestDemo.setPace('instant')`);
  await page.viewport(390, 844, true);
  assert.equal(await page.eval('document.documentElement.scrollWidth > innerWidth'), false, 'LLM controls fit at 390px');
  await page.screenshot(join(artifacts, 'flow-phone.png'));
  await page.viewport(1440, 1100);
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
    assert.match(await page.eval('document.querySelector("#webgpu-help").textContent'),/Windows[\s\S]*Mac[\s\S]*Linux[\s\S]*npm run play/);
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
    assert.match(await page.eval('document.querySelector("#last-move").textContent'),/Drink potion/);
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
    assert.match(await page.eval('document.querySelector("#last-move").textContent'),/Countered for 10/);
    await page.eval(`QuestDemo.setPace('instant')`);
    // Without a model the orders show their size with estimated tokens. Long orders are never blocked.
    const typed = await page.eval('document.querySelector("#orders").value');
    await page.eval(`(() => { const o = document.querySelector('#orders'); o.value = ${JSON.stringify('Collect all three stamps, defeat the champion, and submit at camp. When your health is LOW, drink a potion if one is available. Otherwise save potions. In every fight, use a heavy strike whenever it is available. Use a quick strike when heavy is unavailable. Guard when the enemy is about to smash, unless it is nearly dead. Outside fights, visit the medic, buy the buckler, or rest when offered. Otherwise continue.')}; o.dispatchEvent(new Event('input')); })()`);
    assert.match(await page.eval('document.querySelector("#orders-size").textContent'),/^72 words · about 91 tokens$/);
    await page.eval(`(() => { const o = document.querySelector('#orders'); o.value = ${JSON.stringify(typed)}; o.dispatchEvent(new Event('input')); })()`);
    assert.match(await page.eval('document.querySelector("#orders-size").textContent'),/^\d+ words · about \d+ tokens$/);
    // This policy only drives deterministic engine/UI verification. It is not an LLM substitute.
    for (let i=0;i<40;i++) {
      const s = await page.eval('QuestDemo.snapshot().game');
      if (s.status==='won' || s.status==='lost') break;
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
    assert.equal(result.game.log.every(entry=>entry.source==='manual'),true);
    assert.match(await page.eval('document.querySelector("#verdict").textContent'),/Assignment accepted/);
    assert.equal(await page.eval('document.querySelectorAll("#objective .goal.done").length'),5,'All five checklist steps are ticked');
    assert.match(await page.eval('document.querySelector("#verdict").textContent'),/Commendations \d of 4/,'The verdict lists commendations');
    assert.match(await page.eval('document.querySelector("#sword-value").textContent'),/buckler/i);
    await page.screenshot(join(artifacts,'victory.png'));
    await page.viewport(390,844,true);
    assert.equal(await page.eval('document.documentElement.scrollWidth > innerWidth'),false);
    await page.screenshot(join(artifacts,'phone-victory.png'));
    await page.viewport(1440,1100);
    await page.click('[data-level="tutorial"]');
    for(const id of ['depart','quick','quick','advance','advance','finish'])await page.click(`[data-action="${id}"]`);
    assert.equal(await page.eval('QuestDemo.snapshot().game.status'),'won');
    await page.click('#next-level');
    assert.equal(await page.eval('QuestDemo.snapshot().game.level'),'circuit');
    await stubbedLlmFlow(page, `http://127.0.0.1:${server.address().port}/`);
    await writeFile(join(artifacts,'browser-report.json'),JSON.stringify({kind:'manual UI verification plus LLM-mode interface flow with a stub worker; no model inference',result,errors:page.errors},null,2));
    console.log(`Browser UI passed: desktop, 390px, 360px, potion costs, restart, complete victory in ${result.game.turn} turns.`);
    console.log('LLM-mode interface flow passed with a stub worker (no inference): load, thinking, stale reply, parse failure, edited orders, pause, turn playback with prepared decisions, skip.');
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
    // A forced departure is automatic; inference is reserved for real decisions.
    await page.click('#step');
    await page.waitFor('!QuestDemo.snapshot().thinking',190000);
    const first=await page.eval('QuestDemo.snapshot()');
    assert.equal(first.game.turn,1,first.status);
    assert.equal(first.game.log[0].source,'auto');
    // Then let the model make a real combat choice from multiple options.
    await page.click('#step');
    await page.waitFor('!QuestDemo.snapshot().thinking',190000);
    const combat=await page.eval('QuestDemo.snapshot()');
    assert.equal(combat.game.turn,2,combat.status);
    assert.equal(combat.lastDecision.ordersReceived,combat.orders);
    assert.equal(combat.game.log[1].source,'llm');
    assert.ok(['quick','heavy','retreat'].includes(combat.game.log[1].action));
    await page.screenshot(join(artifacts,'llm-combat.png'));
    console.log('Real LLM combat action:',JSON.stringify(combat.lastDecision));
    await page.eval(`document.querySelector('#orders').value='Always retreat from every enemy. Leave every fight immediately. Never attack.';document.querySelector('#orders').dispatchEvent(new Event('input',{bubbles:true}));`);
    await page.click('#reset');
    await page.click('#step');
    await page.click('#step');
    await page.waitFor('!QuestDemo.snapshot().thinking',190000);
    const reversed = await page.eval('QuestDemo.snapshot()');
    assert.equal(reversed.game.turn,2,reversed.status);
    assert.equal(reversed.lastDecision.ordersReceived,reversed.orders);
    console.log('Retreat-order response:',JSON.stringify(reversed.lastDecision));
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
    let circuit;
    if(circuitTrial) {
      await page.click('[data-level="circuit"]');
      await page.click('[data-preset="careful"]');
      await page.click('#run');
      const trialStart=Date.now();
      let lastTurn=-1;
      let snapshot;
      // Per model decision: model time, whether it was ready before its options went up, and how long the player saw the hero wait.
      const timings={};
      while(Date.now()-trialStart<900000) {
        snapshot=await page.eval('QuestDemo.snapshot()');
        if(snapshot.game.log.at(-1)?.source==='llm'&&snapshot.lastDecision)timings[snapshot.game.turn]={modelMs:Math.round(snapshot.lastDecision.elapsed),preparedAhead:snapshot.lastDecision.preparedAhead,waitedMs:snapshot.lastDecision.waitedMs};
        if(snapshot.lastDecision&&snapshot.game.level==='circuit')assert.equal(snapshot.lastDecision.ordersReceived,snapshot.orders,'Worker must receive the current player orders');
        if(snapshot.game.turn!==lastTurn){const e=snapshot.game.log.at(-1);console.log(`Circuit LLM trial: turn ${snapshot.game.turn}, ${snapshot.game.hp} HP, ${snapshot.game.stamps.length} stamps, ${e?`${e.label} at ${e.at} (${e.source})`:'starting'}`);lastTurn=snapshot.game.turn;}
        if(!snapshot.running&&!snapshot.thinking)break;
        await sleep(500);
      }
      // Replay the log through the engine to recover what the hero was told before each model decision.
      let replay=newGame('circuit');
      const decisions=[];
      for(const entry of snapshot.game.log){
        const move=replay.enemy?nextMove(replay.enemy):null;
        if(entry.source==='llm')decisions.push({turn:entry.turn,at:entry.at,move:move?.kind||null,hp:replay.hp,action:entry.action});
        replay=applyAction(replay,entry.action,entry.source);
      }
      const count=(filter,action)=>`${decisions.filter(d=>filter(d)&&(!action||action(d))).length}`;
      const summary={status:snapshot.game.status,turns:snapshot.game.turn,hp:snapshot.game.hp,potions:snapshot.game.potions,stamps:snapshot.game.stamps.length,champion:snapshot.game.champion,
        smashGuarded:`${count(d=>d.move==='smash',d=>d.action==='guard')} of ${count(d=>d.move==='smash')}`,
        guardedOrdinaryHits:`${count(d=>d.move==='strike',d=>d.action==='guard')} of ${count(d=>d.move==='strike')}`,
        potionsAtLow:`${count(d=>d.hp<=18,d=>d.action==='potion')} of ${count(d=>d.hp<=18)}`,
        optionalRetreated:`${count(d=>d.at==='Prize bruiser',d=>d.action==='retreat')} of ${count(d=>d.at==='Prize bruiser')}`,
        llmDecisions:decisions.length, autoMoves:snapshot.game.log.filter(e=>e.source==='auto').length, manual:snapshot.game.log.filter(e=>e.source==='manual').length,
        playback:{pace:snapshot.pace,seconds:Math.round((Date.now()-trialStart)/1000),timed:Object.keys(timings).length,preparedAhead:Object.values(timings).filter(t=>t.preparedAhead).length,visibleWaitMs:Object.values(timings).reduce((sum,t)=>sum+(t.waitedMs||0),0),modelMs:Object.values(timings).reduce((sum,t)=>sum+t.modelMs,0)}};
      circuit={summary,decisions,timings,orders:snapshot.orders,status:snapshot.status,model:loadedSelection};
      await writeFile(join(artifacts,'llm-circuit-trial.json'),JSON.stringify({...circuit,snapshot},null,2));
      await page.screenshot(join(artifacts,'llm-circuit-trial.png'));
      console.log('Circuit LLM trial summary:',JSON.stringify(summary));
      for(const d of decisions)console.log(`  turn ${String(d.turn).padStart(2)} ${d.at.padEnd(15)} ${(d.move||'-').padEnd(7)} ${String(d.hp).padStart(2)} HP -> ${d.action}`);
      assert.equal(summary.manual,0,'No manual actions in a model-controlled trial');
    }
    await writeFile(join(artifacts,'llm-report.json'),JSON.stringify({kind:gpuTest?`real local WebLLM inference with ${softwareGpu?'software':'hardware'} WebGPU`:'real local Transformers.js inference with CPU WebAssembly',gpu,first,combat,reversed,fullResult,circuit,errors:page.errors,logs:page.logs},null,2));
    assert.equal(reversed.game.log[1].action,'retreat','Changed standing orders should change the combat choice');
    assert.notEqual(reversed.game.log[1].action,combat.game.log[1].action);
  }
  assert.deepEqual(page.errors,[],'Browser console or runtime errors');
} catch(error) {
  if(page){await writeFile(join(artifacts,llm?'llm-failure.json':'browser-failure.json'),JSON.stringify({error:error.message,errors:page.errors,logs:page.logs,snapshot:await page.eval('QuestDemo.snapshot()').catch(()=>null),modelStatus:await page.eval('document.querySelector("#model-status").textContent').catch(()=>null)},null,2));await page.screenshot(join(artifacts,'failure.png')).catch(()=>{});}
  console.error(error);
  process.exitCode=1;
} finally { await page?.close(); await new Promise(resolve=>server.close(resolve)); }

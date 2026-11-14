import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve, ROOT } from './serve.mjs';
import { launch, sleep } from './chrome.mjs';
import { findModel } from '../src/models.js';

const llm = process.argv.includes('--llm');
const gpuTest = llm && !process.argv.includes('--cpu');
const softwareGpu = process.argv.includes('--software-gpu');
const fullTrial = process.argv.includes('--full');
const customModel = process.env.QUEST_MODEL;
if (customModel && !findModel(customModel)) throw new Error(`Unknown test model: ${customModel}`);
const artifacts = join(ROOT, 'artifacts', customModel ? customModel.replace(/[^a-z0-9-]/gi, '-') : '');
await mkdir(artifacts,{recursive:true});
// A stand-in for the model worker, injected by this test only. It answers the worker protocol with a fixed
// preference order so the LLM-mode interface can be exercised without a download. It is not inference,
// and nothing in the game can select it.
const STUB_WORKER = `window.__stub = { delay: 30, replies: [], seen: [] };
window.Worker = class {
  postMessage({ id, type, payload }) {
    const reply = (message, ms) => setTimeout(() => { if (!this.dead) this.onmessage?.({ data: message }); }, ms);
    if (type === 'load') { reply({ type: 'progress', report: { progress: 0.5, text: 'Stub worker: halfway.' } }, 20); reply({ id, type: 'result', result: { model: payload.model } }, 150); return; }
    const offered = payload.actions.map(action => action.id);
    const choice = window.__stub.replies.shift() ?? ['finish', 'quick', 'advance', 'depart'].find(id => offered.includes(id));
    window.__stub.seen.push(payload.orders);
    reply({ id, type: 'result', result: { raw: choice === 'garbage' ? 'not json' : JSON.stringify({ action: choice }), elapsed: window.__stub.delay, ordersReceived: payload.orders } }, window.__stub.delay);
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
  assert.equal(await page.eval('!document.querySelector("#run").hidden && document.querySelector("#load-cta").hidden && document.querySelector("#manual-cta").hidden'), true, 'A ready model swaps the load actions for Run');
  assert.match(await page.eval('document.querySelector("#model-chip").textContent'), /Ready/);
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
    await page.click('#use-recommendation');
    assert.match(await page.eval('document.querySelector("#model").value'),/^cpu:/);
    assert.equal(await page.eval('QuestDemo.snapshot().game.turn'),0,'Checks and selections do not consume turns');
    assert.equal(await page.eval('QuestDemo.snapshot().modelReady'),false,'Checking never downloads a model');
    await page.click('[data-level="circuit"]');
    await page.click('#manual-cta');
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
    // This policy only drives deterministic engine/UI verification. It is not an LLM substitute.
    for (let i=0;i<38;i++) {
      const s = await page.eval('QuestDemo.snapshot().game');
      if (s.status==='won' || s.status==='lost') break;
      const action = await page.eval(`(() => {
        const s=QuestDemo.snapshot().game;
        const has=id=>Boolean(document.querySelector('[data-action="'+id+'"]'));
        if(has('potion')&&s.hp<=18)return 'potion';
        if(has('medic'))return 'medic';
        if(has('upgrade'))return 'upgrade';
        if(s.enemy?.optional)return 'retreat';
        if(s.enemy)return !s.enemy.agile&&has('heavy')?'heavy':'quick';
        if(has('rest'))return 'rest';
        return has('finish')?'finish':has('depart')?'depart':'advance';
      })()`);
      await page.click(`[data-action="${action}"]`);
    }
    const result = await page.eval('QuestDemo.snapshot()');
    assert.equal(result.game.status,'won');
    assert.equal(result.game.log.every(entry=>entry.source==='manual'),true);
    assert.match(await page.eval('document.querySelector("#verdict").textContent'),/Assignment accepted/);
    assert.equal(await page.eval('document.querySelectorAll("#objective .goal.done").length'),5,'All five checklist steps are ticked');
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
    console.log('LLM-mode interface flow passed with a stub worker (no inference): load, thinking, stale reply, parse failure, edited orders, pause.');
  } else {
    await page.click('[data-preset="careful"]');
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
    await writeFile(join(artifacts,'llm-report.json'),JSON.stringify({kind:gpuTest?`real local WebLLM inference with ${softwareGpu?'software':'hardware'} WebGPU`:'real local Transformers.js inference with CPU WebAssembly',gpu,first,combat,reversed,fullResult,errors:page.errors,logs:page.logs},null,2));
    assert.equal(reversed.game.log[1].action,'retreat','Changed standing orders should change the combat choice');
    assert.notEqual(reversed.game.log[1].action,combat.game.log[1].action);
  }
  assert.deepEqual(page.errors,[],'Browser console or runtime errors');
} catch(error) {
  if(page){await writeFile(join(artifacts,llm?'llm-failure.json':'browser-failure.json'),JSON.stringify({error:error.message,errors:page.errors,logs:page.logs,snapshot:await page.eval('QuestDemo.snapshot()').catch(()=>null),modelStatus:await page.eval('document.querySelector("#model-status").textContent').catch(()=>null)},null,2));await page.screenshot(join(artifacts,'failure.png')).catch(()=>{});}
  console.error(error);
  process.exitCode=1;
} finally { await page?.close(); await new Promise(resolve=>server.close(resolve)); }

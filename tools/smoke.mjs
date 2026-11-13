import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve, ROOT } from './serve.mjs';
import { launch, sleep } from './chrome.mjs';

const llm = process.argv.includes('--llm');
const gpuTest = llm && !process.argv.includes('--cpu');
const softwareGpu = process.argv.includes('--software-gpu');
const fullTrial = process.argv.includes('--full');
const artifacts = join(ROOT, 'artifacts');
await mkdir(artifacts,{recursive:true});
const server = await serve(0);
let page;
try {
  page = await launch({softwareGpu:gpuTest&&softwareGpu,hardwareGpu:gpuTest&&!softwareGpu});
  await page.viewport(1440,1100);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
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
    await page.eval(`document.querySelector('#level').value='circuit';document.querySelector('#level').dispatchEvent(new Event('change',{bubbles:true}));`);
    await page.eval(`document.querySelector('#mode').value='manual';document.querySelector('#mode').dispatchEvent(new Event('change',{bubbles:true}));`);
    await page.click('[data-action="depart"]');
    assert.equal(await page.eval('QuestDemo.snapshot().game.position'),1);
    await page.click('[data-action="quick"]');
    await page.click('[data-action="potion"]');
    assert.equal(await page.eval('QuestDemo.snapshot().game.potions'),1);
    assert.equal(await page.eval('QuestDemo.snapshot().game.hp'),37);
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
    await page.screenshot(join(artifacts,'victory.png'));
    await page.viewport(390,844,true);
    assert.equal(await page.eval('document.documentElement.scrollWidth > innerWidth'),false);
    await page.screenshot(join(artifacts,'phone-victory.png'));
    await page.eval(`document.querySelector('#level').value='tutorial';document.querySelector('#level').dispatchEvent(new Event('change',{bubbles:true}));`);
    for(const id of ['depart','quick','quick','advance','advance','finish'])await page.click(`[data-action="${id}"]`);
    assert.equal(await page.eval('QuestDemo.snapshot().game.status'),'won');
    await page.click('#next-level');
    assert.equal(await page.eval('QuestDemo.snapshot().game.level'),'circuit');
    await writeFile(join(artifacts,'browser-report.json'),JSON.stringify({kind:'manual UI verification, no model inference',result,errors:page.errors},null,2));
    console.log(`Browser UI passed: desktop, 390px, 360px, potion costs, restart, complete victory in ${result.game.turn} turns.`);
  } else {
    await page.click('[data-preset="careful"]');
    if(gpuTest) {
      if(!gpu)throw Error('Software WebGPU did not expose an adapter.');
      await page.eval(`document.querySelector('#model').value='${softwareGpu?'Qwen2.5-0.5B-Instruct-q4f32_1-MLC':'Qwen2.5-3B-Instruct-q4f32_1-MLC'}';document.querySelector('#model').dispatchEvent(new Event('change',{bubbles:true}));`);
    } else await page.eval(`document.querySelector('#model').value='cpu:onnx-community/Qwen2.5-0.5B-Instruct';document.querySelector('#model').dispatchEvent(new Event('change',{bubbles:true}));`);
    await page.click('#load-model');
    const start=Date.now();
    let prior='';
    while(Date.now()-start<12*60*1000){
      const snapshot=await page.eval(`({ready:QuestDemo.snapshot().modelReady,text:document.querySelector('#model-status').textContent,loading:document.querySelector('#load-model').disabled})`);
      if(snapshot.text!==prior){console.log(snapshot.text);prior=snapshot.text;}
      if(snapshot.ready)break;
      if(!snapshot.loading)throw Error(snapshot.text);
      await sleep(2000);
    }
    assert.equal(await page.eval('QuestDemo.snapshot().modelReady'),true,'Model did not become ready');
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
    assert.equal(combat.lastDecision.ordersReceived,combat.orders);
    assert.equal(combat.game.turn,2,combat.status);
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
    assert.equal(reversed.lastDecision.ordersReceived,reversed.orders);
    assert.equal(reversed.game.turn,2,reversed.status);
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

import { newGame, availableActions, applyAction, observation, currentTile, PRESETS, TUTORIAL_PRESETS, assignmentReady } from './game.js';
import { parseDecision } from './protocol.js';
import { LocalModel } from './model.js';
import { renderMap } from './map.js';
import { MODELS, findModel, modelSize, checkDevice, recommendModel, selectedModelAdvice } from './models.js';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let game = newGame();
let epoch = 0;
let running = false;
let thinking = false;
let loading = false;
let mode = 'llm';
let runOrders = '';
let promptVersion = 1;
let status = 'Your hero is waiting for instructions.';
let hasError = false;
let lastDecision = null;
let device = null;
let checkingDevice = false;
let recommendation = null;
$('model').replaceChildren(...MODELS.map(entry => new Option(`${entry.name} · ${entry.backend}${entry.id.startsWith('Qwen3-') || entry.backend === 'CPU' ? ', experimental' : ''}`, entry.id)));
const model = new LocalModel(report => {
  $('load-progress').value = Math.max(0, Math.min(1, report.progress || 0));
  $('model-status').textContent = report.text;
});
const presets = () => $('level').value === 'tutorial' ? TUTORIAL_PRESETS : PRESETS;
try { $('orders').value = localStorage.getItem('pmlq.orders.tutorial') || TUTORIAL_PRESETS.reckless; } catch { $('orders').value = TUTORIAL_PRESETS.reckless; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const gpuMemory = () => $('gpu-memory').value ? Number($('gpu-memory').value) : null;
function renderModelAdvice() {
  const selected = findModel($('model').value);
  recommendation = recommendModel(device, gpuMemory());
  $('check-device').disabled = checkingDevice || loading || running || thinking;
  $('check-device').textContent = checkingDevice ? 'Checking…' : 'Check again';
  $('load-model').disabled = checkingDevice || loading || thinking || running || model.ready;
  $('gpu-memory').disabled = checkingDevice || loading || running || thinking;
  $('device-status').textContent = checkingDevice ? 'Checking browser graphics… No model download.' : device ? `${device.name ? `${device.name}. ` : ''}${device.reason}` : 'Device has not been checked.';
  $('recommendation').innerHTML = recommendation ? `<strong>${recommendation.model ? `Suggested: ${escape(recommendation.model.name)} · ${recommendation.model.backend}` : 'Manual sandbox recommended'}</strong><span>${escape(recommendation.reason)}</span>` : '';
  $('use-recommendation').disabled = checkingDevice || loading || running || thinking || !recommendation?.model || selected.id === recommendation.model.id;
  $('use-recommendation').textContent = recommendation?.model?.id === selected.id ? 'Suggested model selected ✓' : 'Use recommendation';
  $('model-details').textContent = `About ${modelSize(selected.downloadGB)} download${selected.memoryGB ? ` · ~${selected.memoryGB} GB GPU memory` : ' · no GPU needed'}`;
  $('model-advice').textContent = selectedModelAdvice(selected, device, gpuMemory());
}
async function checkHardware() {
  if (checkingDevice || loading || running || thinking) return;
  checkingDevice = true;
  renderModelAdvice();
  try { device = await checkDevice(); }
  finally { checkingDevice = false; renderModelAdvice(); }
}

function saveOrders() {
  try { localStorage.setItem(`pmlq.orders.${$('level').value}`, $('orders').value); } catch { /* Storage may be unavailable in private browser contexts. */ }
  $('word-count').textContent = `${$('orders').value.trim().split(/\s+/).filter(Boolean).length} words`;
}
function reset() {
  epoch++;
  running = false;
  game = newGame($('level').value);
  runOrders = $('orders').value.trim();
  promptVersion++;
  lastDecision = null;
  status = 'Fresh trial. Same course. Revised instructions.';
  hasError = false;
  render();
}
function paintEncounter(actions) {
  const tile = currentTile(game);
  const terminal = game.status === 'won' || game.status === 'lost';
  let title = tile.name;
  let description = '';
  if (game.status === 'won') { title = 'Assignment accepted.'; description = `Home in ${game.turn} turns with ${game.hp} HP and ${game.potions} potions. The guild is reluctantly impressed. Try a shorter prompt or compare with your first attempt.`; }
  else if (game.status === 'lost') { title = game.hp === 0 ? 'A preventable workplace incident.' : 'The guild has closed for the day.'; description = 'Inspect the report below. Revise one instruction, restart the trial, and see what changes.'; }
  else if (game.enemy) { const e = game.enemy; description = `${e.optional ? 'Optional fight. ' : e.stamp ? 'Defeat this opponent for a required stamp. ' : 'Defeat the champion, then return to camp. '}${e.agile ? 'Agile: heavy strikes only deal 3 damage. ' : e.armor ? `Armor blocks ${e.armor} damage from each strike. ` : ''}Surviving enemies retaliate after your attacks and potion use.`; }
  else if (tile.kind === 'camp') description = assignmentReady(game) ? 'All requirements complete. Time to submit your assignment.' : game.level === 'tutorial' ? 'Your first assignment: defeat the practice rat, collect one stamp, and return here within 12 turns. A policy of retreating from every fight may need a small revision.' : 'Three stamps, one champion, and a safe return. You have two potions and 38 turns. The instructions are entirely your department.';
  else if (tile.kind === 'medic') description = game.medicUsed ? 'The field medic has already treated you this trial.' : 'One free treatment restores 12 HP. Walking on saves a turn.';
  else if (tile.kind === 'shop') description = game.sword ? 'Your sword is sharpened. All normal hits deal 2 extra damage.' : 'A sharper sword costs 6 coins and adds 2 damage. Buying it takes one turn.';
  else if (tile.kind === 'bench') description = 'A moment to catch your breath before the champion. Restoring stamina takes a turn.';
  else if (game.resolved) description = 'Encounter resolved. Continue toward the next checkpoint.';
  else description = 'The path continues. Walking restores 1 stamina and takes one turn.';
  const enemyStats = game.enemy ? `<span class="enemy-stats">${game.enemy.hp} HP · ${game.enemy.damage} ATK${game.enemy.armor ? ` · ${game.enemy.armor} ARMOR` : ''}</span>` : '';
  const actionMarkup = terminal ? '' : `<div class="available-actions" aria-label="Available actions">${actions.map(a => mode === 'manual' ? `<button data-action="${a.id}" title="${escape(a.detail)}" ${thinking ? 'disabled' : ''}>${escape(a.label)}</button>` : `<span class="action-tag" title="${escape(a.detail)}">${escape(a.label)}</span>`).join('')}</div>`;
  $('encounter').innerHTML = `<div class="encounter-head"><h3 class="${terminal ? game.status === 'won' ? 'result-won' : 'result-lost' : ''}">${escape(title)}</h3>${enemyStats}</div><p>${escape(description)}</p>${actionMarkup}`;
}
function render() {
  const actions = availableActions(game);
  $('hp-value').textContent = `${game.hp} / ${game.maxHp}${game.hp <= 18 ? ' · LOW' : ''}`;
  $('hp-bar').style.width = `${game.hp / game.maxHp * 100}%`;
  $('hp-bar').style.background = game.hp <= 18 ? 'var(--orange)' : 'var(--green)';
  $('stamina-value').textContent = `${game.stamina} / 4`;
  $('potion-value').textContent = game.potions;
  $('coin-value').textContent = game.coins;
  $('turn-value').textContent = `${game.turn} / ${game.turnLimit}`;
  $('lap-badge').textContent = `LAP ${game.lap}`;
  $('map').innerHTML = renderMap(game);
  $('map').setAttribute('aria-label', `Training circuit. Hero at ${currentTile(game).name}. ${game.stamps.length} of ${game.level === 'tutorial' ? 1 : 3} stamps collected.`);
  const target = game.level === 'tutorial' ? 1 : 3;
  $('stamps').innerHTML = Array.from({length:target},(_,i) => `<span class="stamp ${i < game.stamps.length ? 'filled' : ''}">${i < game.stamps.length ? '✓' : i+1}</span>`).join('');
  $('stamps').setAttribute('aria-label', `${game.stamps.length} of ${target} stamps`);
  $('objective-progress').textContent = `${game.stamps.length}/${target} stamps${game.level === 'circuit' ? ` · Champion ${game.champion ? 'defeated' : 'waiting'}` : ''} · ${game.status === 'won' ? 'Home safe' : 'Return to camp'}`;
  $('next-level').hidden = game.status !== 'won' || game.level !== 'tutorial';
  $('level').disabled = running || thinking;
  paintEncounter(actions);
  const terminal = !actions.length;
  $('run').disabled = mode === 'manual' || loading || (!model.ready && !running) || (thinking && !running) || terminal;
  $('run').innerHTML = running ? 'Pause expedition <span aria-hidden="true">Ⅱ</span>' : model.ready ? 'Run these orders <span aria-hidden="true">→</span>' : 'Load the model to begin <span aria-hidden="true">→</span>';
  $('step').disabled = mode === 'manual' || !model.ready || running || thinking || terminal;
  $('orders').disabled = running || thinking;
  document.querySelectorAll('[data-preset]').forEach(b => b.disabled = running || thinking);
  $('model').disabled = loading || running || thinking;
  $('mode').disabled = loading;
  $('load-model').disabled = loading || thinking || running || model.ready;
  $('load-model').textContent = loading ? 'Loading model…' : model.ready ? 'Model ready ✓' : 'Load local model ↓';
  $('model-options').hidden = mode === 'manual';
  $('manual-note').hidden = mode !== 'manual';
  renderModelAdvice();
  $('run-status').textContent = thinking ? 'The hero is considering your orders… Game time is paused.' : status;
  $('run-status').className = `run-status${hasError ? ' error' : ''}`;
  $('journal').innerHTML = game.log.length ? game.log.slice().reverse().map(e => `<div class="log-entry"><span class="log-turn">TURN ${e.turn}</span><div><span class="log-title">${escape(e.label)} <span style="font-weight:400;color:var(--muted)">/ ${escape(e.at)}</span></span><p class="log-detail">${escape(e.detail)} <strong>${e.after.hp} HP · ${e.after.potions} potions</strong></p></div><span class="log-source">${escape(e.source.toUpperCase())}</span></div>`).join('') : '<p class="empty-log">Nothing to report. An unusually promising start.</p>';
  saveOrders();
}
function commit(actionId, source) {
  game = applyAction(game, actionId, source);
  if (game.status === 'won' || game.status === 'lost') running = false;
  status = game.status === 'won' ? 'Success. Your orders got the hero home.' : game.status === 'lost' ? 'Trial over. The report has some suggestions for your next draft.' : mode === 'manual' ? 'Manual sandbox: you are choosing the actions.' : `Decision recorded${lastDecision ? ` · ${(lastDecision.elapsed/1000).toFixed(1)} seconds thinking` : ''}.`;
}
async function decide() {
  if (thinking || !model.ready || mode !== 'llm') return false;
  if (!runOrders || game.turn === 0) runOrders = $('orders').value.trim();
  if (!runOrders) { status = 'Write some standing orders first.'; hasError = true; render(); return false; }
  const actions = availableActions(game);
  if (!actions.length) return false;
  // Forced movement needs no inference. The model is called whenever a real choice exists.
  if (actions.length === 1) { commit(actions[0].id, 'auto'); render(); return true; }
  const requestEpoch = epoch;
  const revision = game.revision;
  thinking = true;
  hasError = false;
  render();
  try {
    let decision;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await model.decide({ orders: runOrders, observation: observation(game), actions });
        decision = { ...result, action: parseDecision(result.raw, actions) };
        break;
      } catch (error) { if (requestEpoch !== epoch || !model.ready || attempt === 1) throw error; }
    }
    if (requestEpoch !== epoch || revision !== game.revision) return false;
    lastDecision = decision;
    commit(decision.action, 'llm');
    return true;
  } catch (error) {
    if (requestEpoch === epoch) { running = false; hasError = true; status = `${error.message} No turn was spent. You can retry or use Manual sandbox.`; }
    return false;
  } finally { thinking = false; render(); }
}
async function run() {
  if (running) { running = false; epoch++; status = 'Paused. Inspect the report, or continue the expedition.'; render(); return; }
  if (thinking || !model.ready || mode !== 'llm') return;
  if (game.turn > 0 && $('orders').value.trim() !== runOrders) reset();
  running = true;
  hasError = false;
  render();
  const loopEpoch = epoch;
  while (running && loopEpoch === epoch && availableActions(game).length) {
    if (!(await decide())) break;
    await delay(350);
  }
  if (loopEpoch === epoch) running = false;
  render();
}
async function loadModel() {
  if (loading || checkingDevice || model.ready) return;
  loading = true;
  $('model-status').className = '';
  $('load-progress').hidden = false;
  $('load-progress').value = 0;
  $('model-status').textContent = $('model').value.startsWith('cpu:') ? 'Loading the CPU runtime, then downloading the model. The first load may take a few minutes.' : 'Checking WebGPU, then downloading the model. The first load may take a few minutes.';
  render();
  try {
    await model.load($('model').value);
    $('model-status').textContent = 'Ready. Inference runs in a browser worker. Try your first draft, then change the orders and restart.';
    status = 'Model ready. The hero is awaiting your orders.';
  } catch (error) {
    model.dispose();
    $('model-status').textContent = error.message;
    $('model-status').className = 'error';
    status = 'Model could not load. See the model status, or try Manual sandbox.';
  } finally { loading = false; $('load-progress').hidden = true; render(); }
}
$('load-model').addEventListener('click', loadModel);
$('check-device').addEventListener('click', checkHardware);
$('gpu-memory').addEventListener('change', renderModelAdvice);
$('use-recommendation').addEventListener('click', () => {
  if (!recommendation?.model || $('use-recommendation').disabled) return;
  $('model').value = recommendation.model.id;
  $('model').dispatchEvent(new Event('change'));
});
$('run').addEventListener('click', run);
$('step').addEventListener('click', decide);
$('reset').addEventListener('click', reset);
$('orders').addEventListener('input', saveOrders);
$('mode').addEventListener('change', () => { epoch++; running = false; mode = $('mode').value; status = mode === 'manual' ? 'Manual sandbox: choose actions below. Your prompt is not interpreted.' : 'Local LLM selected. Load the model, then run your orders.'; render(); });
$('model').addEventListener('change', () => { epoch++; running = false; model.dispose(); $('model-status').textContent = 'Selected a new model. Load it to continue.'; render(); });
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { $('orders').value = presets()[button.dataset.preset]; reset(); }));
$('level').addEventListener('change', () => { $('orders').value = presets().reckless; reset(); });
$('next-level').addEventListener('click', () => { $('level').value = 'circuit'; $('level').dispatchEvent(new Event('change')); });
$('encounter').addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button && mode === 'manual' && !thinking) { commit(button.dataset.action, 'manual'); render(); } });
$('help-toggle').addEventListener('click', () => { $('help').hidden = !$('help').hidden; $('help-toggle').setAttribute('aria-expanded', String(!$('help').hidden)); });
$('export').addEventListener('click', () => { const report = { title: 'Per My Last ReQuest', controller: mode, model: model.model || null, promptVersion, orders: runOrders || $('orders').value, result: game.status, state: game, lastDecision }; const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'per-my-last-request-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
window.addEventListener('beforeunload', () => model.dispose());
// Small debugging surface for browser smoke tests and reproducible reports.
window.QuestDemo = { snapshot: () => structuredClone({ game, mode, running, thinking, modelReady: model.ready, status, lastDecision, orders: runOrders, device, checkingDevice, recommendation: recommendation?.model?.id || null }), loadModel, decide };
render();
checkHardware();

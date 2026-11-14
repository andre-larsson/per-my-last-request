import { newGame, availableActions, applyAction, observation, PRESETS, TUTORIAL_PRESETS, LOW_HP } from './game.js';
import { parseDecision, decisionMessages } from './protocol.js';
import { LocalModel } from './model.js';
import { renderMap } from './map.js';
import { MODELS, findModel, modelSize, checkDevice, recommendModel, selectedModelAdvice } from './models.js';
import { escapeHtml, artUrl, objectiveSteps, sceneFor, lastMoveHtml, journalHtml, verdictFor, verdictHtml } from './view.js';

const $ = id => document.getElementById(id);
const DECISION_PAUSE_MS = 700; // Breathing room between turns, so a person can follow a run.

let level = 'tutorial';
let game = newGame(level);
let epoch = 0;
let running = false;
let thinking = false;
let loading = false;
let loadProgress = 0;
let mode = 'llm';
let runOrders = '';
let promptVersion = 1;
let status = 'Load a model and the hero will follow the orders exactly as written.';
let hasError = false;
let lastDecision = null;
let device = null;
let checkingDevice = false;
let recommendation = null;
let lastFrom = null; // The stop the hero just left, so the map marker can walk instead of jump.
let pendingFx = [];
const painted = {}; // Keys of the last paint per region. Unchanged regions keep their DOM, and so their animations.

$('model').replaceChildren(...MODELS.map(entry => new Option(`${entry.name} · ${entry.backend}${entry.id.startsWith('Qwen3-') || entry.backend === 'CPU' ? ', experimental' : ''}`, entry.id)));
const model = new LocalModel(report => {
  loadProgress = Math.max(0, Math.min(1, report.progress || 0));
  $('load-progress').value = loadProgress;
  $('cta-progress').value = loadProgress;
  $('model-status').textContent = report.text;
  if (loading) $('load-cta').firstChild.textContent = `Loading model… ${Math.round(loadProgress * 100)}% `;
});
const presets = () => level === 'tutorial' ? TUTORIAL_PRESETS : PRESETS;
const storedOrders = () => { try { return localStorage.getItem(`pmlq.orders.${level}`); } catch { return null; } };
const typedOrders = () => $('orders').value.trim();
const compactMap = matchMedia('(max-width: 560px)');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
$('orders').value = storedOrders() || TUTORIAL_PRESETS.reckless;

/** Repaints a region only when its inputs changed. Returns true when it painted. */
function paint(region, key, draw) {
  if (painted[region] === key) return false;
  painted[region] = key;
  draw();
  return true;
}

const gpuMemory = () => $('gpu-memory').value ? Number($('gpu-memory').value) : null;
function renderModelAdvice() {
  const selected = findModel($('model').value);
  const busy = checkingDevice || loading || running || thinking;
  recommendation = recommendModel(device, gpuMemory());
  const suggested = recommendation?.model?.id === selected.id;
  $('check-device').disabled = busy;
  $('check-device').textContent = checkingDevice ? 'Checking…' : 'Check again';
  $('load-model').disabled = checkingDevice || loading || thinking || running || model.ready;
  $('gpu-memory').disabled = busy;
  $('device-status').textContent = checkingDevice ? 'Checking browser graphics… No model download.' : device ? `${device.name ? `${device.name}. ` : ''}${device.reason}` : 'Device has not been checked.';
  $('recommendation').innerHTML = recommendation ? `<strong>${recommendation.model ? `Suggested: ${escapeHtml(recommendation.model.name)} · ${recommendation.model.backend}` : 'Manual sandbox recommended'}</strong><span>${escapeHtml(recommendation.reason)}</span>` : '';
  // The suggestion only asks for attention when it differs from the current selection.
  $('recommendation-box').hidden = !recommendation || suggested;
  $('use-recommendation').disabled = busy || !recommendation?.model || suggested;
  $('use-recommendation').textContent = suggested ? 'Suggested model selected ✓' : 'Use recommendation';
  $('model-name').textContent = `${selected.name} · ${selected.backend}`;
  $('model-details').textContent = `${modelSize(selected.downloadGB)} download${selected.memoryGB ? ` · ~${selected.memoryGB} GB GPU memory` : ' · no GPU needed'}${suggested ? ' · suggested for this device' : ''}`;
  $('model-advice').textContent = selectedModelAdvice(selected, device, gpuMemory());
  $('model-chip').textContent = loading ? 'Loading…' : model.ready ? 'Ready ✓' : 'Not loaded';
  $('model-chip').className = `chip ${model.ready ? 'gain' : 'quiet'}`;
}
async function checkHardware() {
  if (checkingDevice || loading || running || thinking) return;
  checkingDevice = true;
  render();
  try { device = await checkDevice(); }
  finally { checkingDevice = false; render(); }
}

function saveOrders() {
  try { localStorage.setItem(`pmlq.orders.${level}`, $('orders').value); } catch { /* Storage may be unavailable in private browser contexts. */ }
  renderOrders();
}
function reset() {
  epoch++;
  running = false;
  game = newGame(level);
  runOrders = typedOrders();
  promptVersion++;
  lastDecision = null;
  lastFrom = null;
  pendingFx = [];
  status = mode === 'manual' ? 'Fresh trial. Choose the first action under the stage.' : 'Fresh trial. Same course. Revised instructions.';
  hasError = false;
  render();
}
function setLevel(next) {
  if (running || thinking || next === level) return;
  level = next;
  $('orders').value = storedOrders() || presets().reckless;
  reset();
}

function renderHero() {
  const low = game.hp <= LOW_HP;
  $('hp-value').textContent = game.hp;
  $('hp-max').textContent = `/ ${game.maxHp} HP`;
  $('hp-flag').hidden = !low;
  $('hp-flag').textContent = game.hp === 0 ? 'Down' : 'Low health';
  $('hp-bar').style.width = `${game.hp / game.maxHp * 100}%`;
  $('hero-card').className = `fighter hero${low ? ' low' : ''}${game.hp === 0 ? ' down' : ''}${thinking ? ' thinking' : ''}`;
  $('stamina-value').innerHTML = `<span class="pips" aria-hidden="true">${Array.from({ length: 4 }, (_, i) => `<i class="${i < game.stamina ? 'on' : ''}"></i>`).join('')}</span><span>${game.stamina}<span class="sr-only"> of 4</span></span>`;
  $('potion-value').textContent = game.potions;
  $('coin-value').textContent = game.coins;
  $('sword-value').textContent = game.sword ? `+${game.sword} damage` : 'Plain';
  $('lap-badge').hidden = game.level !== 'circuit';
  $('lap-badge').textContent = `Lap ${game.lap}`;
}
function renderFoe() {
  const scene = sceneFor(game);
  const art = $('foe-art');
  if (art.dataset.name !== scene.art) { art.dataset.name = scene.art; art.src = artUrl(scene.art); }
  $('foe-fallback').textContent = scene.name[0];
  $('foe-kicker').textContent = scene.kicker;
  $('foe-name').textContent = scene.name;
  $('foe-hp').hidden = !scene.enemy;
  if (scene.enemy) {
    $('foe-hp-value').textContent = scene.enemy.hp;
    $('foe-hp-max').textContent = `/ ${scene.enemy.maxHp} HP`;
    $('foe-bar').style.width = `${scene.enemy.hp / scene.enemy.maxHp * 100}%`;
  }
  $('foe-traits').innerHTML = scene.traits.map(trait => `<li>${escapeHtml(trait.label)}</li>`).join('');
  $('foe-stamp').hidden = !scene.mark;
  $('foe-stamp').textContent = scene.mark;
  $('foe-card').className = `fighter foe${scene.enemy ? ' is-enemy' : ''}${scene.mark ? ' is-over' : ''}`;
  // The card carries the short facts; the line under it explains what each one means.
  $('situation').innerHTML = `${escapeHtml(scene.text)}${scene.traits.length ? `<span class="trait-notes">${scene.traits.map(trait => `<span><b>${escapeHtml(trait.label)}</b> ${escapeHtml(trait.note)}</span>`).join('')}</span>` : ''}`;
}
function renderBrief() {
  document.querySelectorAll('[data-level]').forEach(tab => {
    tab.setAttribute('aria-pressed', String(tab.dataset.level === level));
    tab.disabled = running || thinking;
  });
  const steps = objectiveSteps(game);
  const done = new Set(steps.filter(step => step.done).map(step => step.label));
  const earlier = painted.objectiveEpoch === epoch ? painted.objectiveDone : done;
  paint('objective', `${epoch}:${level}:${steps.map(step => `${+step.done}${+step.next}`).join('')}`, () => {
    $('objective').innerHTML = steps.map(step => {
      const fresh = step.done && !earlier.has(step.label); // Newly earned: gets the stamping animation once.
      return `<li class="goal ${step.kind}${step.done ? ' done' : ''}${step.next ? ' next' : ''}${fresh ? ' fresh' : ''}"><span class="goal-mark" aria-hidden="true">${step.done ? '✓' : `<img src="${artUrl(step.art)}" alt="" onerror="this.remove()">`}</span><span class="goal-text"><span class="sr-only">${step.kind === 'stamp' ? 'Stamp: ' : step.kind === 'champion' ? 'Defeat: ' : ''}</span>${escapeHtml(step.label)}<span class="sr-only">${step.done ? ' (done)' : ''}</span></span></li>`;
    }).join('');
  });
  painted.objectiveEpoch = epoch;
  painted.objectiveDone = done;
  const left = game.turnLimit - game.turn;
  $('turn-value').textContent = `${game.turn} / ${game.turnLimit}`;
  $('turn-bar').style.width = `${game.turn / game.turnLimit * 100}%`;
  $('turn-left').textContent = left === 0 ? 'none left' : `${left} left`;
  $('deadline').className = `deadline${left <= Math.ceil(game.turnLimit / 4) ? ' urgent' : ''}`;
}
function renderMoves(actions) {
  const terminal = !actions.length;
  const verdict = verdictFor(game);
  $('stage').className = `stage${verdict ? ` ended ${verdict.tone}` : ''}`;
  $('verdict').hidden = !verdict;
  paint('verdict', `${epoch}:${game.status}:${game.turn}`, () => { $('verdict').innerHTML = verdictHtml(verdict); });
  const seconds = lastDecision && game.log.at(-1)?.source === 'llm' ? lastDecision.elapsed / 1000 : null;
  paint('lastMove', `${epoch}:${game.log.length}`, () => { $('last-move').innerHTML = lastMoveHtml(game, seconds); });
  $('options-wrap').hidden = terminal;
  if (terminal) return;
  const forced = actions.length === 1;
  $('options-wrap').className = `options-wrap${thinking ? ' thinking' : ''}`;
  $('options-title').textContent = mode === 'manual' ? 'Your move. Choose an action'
    : thinking ? 'The hero is reading your orders…'
    : forced ? 'Only one way forward, so no decision is needed' : `The hero must choose one of ${actions.length}`;
  $('options').dataset.count = actions.length;
  $('options').innerHTML = actions.map(action => {
    const detail = action.detail === action.label ? '' : `<span>${escapeHtml(action.detail)}</span>`;
    return mode === 'manual'
      ? `<button class="option" data-action="${action.id}" ${thinking ? 'disabled' : ''}><strong>${escapeHtml(action.label)}</strong>${detail}</button>`
      : `<div class="option"><strong>${escapeHtml(action.label)}</strong>${detail}</div>`;
  }).join('');
  const orders = runOrders || typedOrders() || '(no orders written)';
  const [system, user] = decisionMessages(orders, observation(game), actions);
  $('seen').hidden = forced && mode === 'llm';
  $('seen').querySelector('summary').textContent = mode === 'manual' ? 'What an LLM hero would be told this turn' : 'What the hero is told this turn';
  $('seen-text').textContent = `${system.content}\n\n${user.content}`;
}
function renderControls(actions) {
  const terminal = !actions.length;
  const llm = mode === 'llm';
  const selected = findModel($('model').value);
  const won = game.status === 'won';
  $('load-cta').hidden = !llm || model.ready;
  $('load-cta').disabled = loading || checkingDevice;
  $('load-cta').innerHTML = loading ? `Loading model… ${Math.round(loadProgress * 100)}% ` : `<span>Load <span class="wide-only">${escapeHtml(selected.name)}</span><span class="narrow-only">model</span></span> <small>${modelSize(selected.downloadGB)}<span class="wide-only"> download</span></small><span aria-hidden="true">↓</span>`;
  $('cta-progress').hidden = !loading;
  $('manual-cta').hidden = !llm || model.ready || loading;
  // A GPU model on a device without usable WebGPU would only fail to load. Say so before the click.
  const blocked = llm && !model.ready && !loading && !hasError && device && (!device.gpu || device.software) && selected.backend !== 'CPU';
  $('run').hidden = !llm || !model.ready;
  $('run').disabled = thinking && !running;
  $('run').innerHTML = running ? 'Pause <span aria-hidden="true">Ⅱ</span>'
    : terminal ? 'Run again <span aria-hidden="true">↻</span>'
    : game.turn > 0 ? 'Continue <span aria-hidden="true">→</span>' : 'Run these orders <span aria-hidden="true">→</span>';
  $('next-level').hidden = !(won && game.level === 'tutorial');
  $('run').className = $('next-level').hidden ? 'primary' : 'secondary';
  $('step').hidden = !llm || !model.ready;
  $('step').disabled = running || thinking || terminal;
  $('reset').hidden = game.turn === 0; // Nothing to restart yet.
  $('reset').textContent = terminal && !llm ? 'Try again ↻' : 'Restart';
  $('reset').className = terminal && !llm && $('next-level').hidden ? 'primary' : 'ghost';
  $('run-status').textContent = thinking ? 'The hero is reading your orders… Game time is paused.'
    : blocked ? 'This browser cannot run the selected GPU model. Use the suggestion under “Who plays the hero?”, or play manually.' : status;
  $('run-status').className = `run-status${hasError ? ' error' : ''}${thinking ? ' busy' : ''}`;
  // With nothing but Restart to offer, the bar shrinks to one line so it covers less of a small screen.
  $('controls').className = `controls${!llm && !terminal ? ' compact' : ''}`;
}
function renderOrders() {
  const changed = mode === 'llm' && game.turn > 0 && typedOrders() !== runOrders;
  $('orders').disabled = running || thinking;
  $('orders-notice').hidden = !changed;
  $('word-count').textContent = `${typedOrders().split(/\s+/).filter(Boolean).length} words`;
  $('peek-text').textContent = (game.turn > 0 && runOrders) || typedOrders() || 'No orders written.';
  document.querySelectorAll('[data-preset]').forEach(button => { button.disabled = running || thinking; });
}
function renderController() {
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    button.disabled = loading;
  });
  $('model').disabled = loading || running || thinking;
  $('load-model').textContent = loading ? 'Loading model…' : model.ready ? 'Model ready ✓' : 'Load local model ↓';
  $('model-options').hidden = mode === 'manual';
  $('manual-note').hidden = mode !== 'manual';
  renderModelAdvice();
}
function renderMapRegion() {
  const compact = compactMap.matches;
  const retreats = game.log.filter(entry => entry.action === 'retreat').length;
  paint('map', [epoch, level, compact, game.position, game.lap, game.stamps.length, game.champion, retreats].join(':'), () => {
    const { body, viewBox } = renderMap(game, { compact, from: lastFrom });
    $('map').setAttribute('viewBox', viewBox);
    $('map').innerHTML = body;
    lastFrom = null;
    $('map').setAttribute('aria-label', `Training circuit. Hero at ${sceneFor(game).name}. ${game.stamps.length} of ${game.level === 'tutorial' ? 1 : 3} stamps collected.`);
  });
}
/** Short-lived feedback on the stage cards: a floating number, and a shake when something is hurt. */
function playFx() {
  for (const fx of pendingFx.splice(0)) {
    const card = $(fx.card);
    const note = document.createElement('span');
    note.className = `float ${fx.tone}`;
    note.textContent = fx.text;
    note.setAttribute('aria-hidden', 'true');
    card.append(note);
    setTimeout(() => note.remove(), 1400);
    if (fx.tone === 'loss') {
      card.classList.remove('hit');
      void card.offsetWidth; // Restart the shake when two hits land back to back.
      card.classList.add('hit');
    }
  }
}
function render() {
  const actions = availableActions(game);
  document.body.dataset.mode = mode;
  renderBrief();
  renderHero();
  renderFoe();
  renderMoves(actions);
  renderControls(actions);
  renderOrders();
  renderController();
  renderMapRegion();
  paint('journal', `${epoch}:${game.log.length}`, () => { $('journal').innerHTML = journalHtml(game.log); });
  playFx();
}

function commit(actionId, source) {
  const before = game;
  game = applyAction(game, actionId, source);
  lastFrom = before.position;
  if (before.enemy && (actionId === 'quick' || actionId === 'heavy')) pendingFx.push({ card: 'foe-card', tone: 'loss', text: `−${before.enemy.hp - (game.enemy?.hp ?? 0)}` });
  if (game.hp !== before.hp) pendingFx.push({ card: 'hero-card', tone: game.hp < before.hp ? 'loss' : 'gain', text: `${game.hp < before.hp ? '−' : '+'}${Math.abs(game.hp - before.hp)}` });
  if (game.status === 'won' || game.status === 'lost') running = false;
  status = game.status === 'won' ? 'Success. Your orders got the hero home.'
    : game.status === 'lost' ? 'Trial over. Read the report, change the orders, and run again.'
    : mode === 'manual' ? 'Manual sandbox: you are choosing the actions.'
    : source === 'auto' ? 'Only one action was possible, so the hero took it.'
    : `Decision made in ${lastDecision ? (lastDecision.elapsed / 1000).toFixed(1) : '?'} seconds.`;
}
async function decide() {
  if (thinking || !model.ready || mode !== 'llm') return false;
  if (!runOrders || game.turn === 0) runOrders = typedOrders();
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
/** A finished trial, or orders edited mid-trial, both mean the next decision starts a fresh trial. */
function restartIfStale() {
  if (!availableActions(game).length || (game.turn > 0 && typedOrders() !== runOrders)) reset();
}
async function run() {
  if (running) { running = false; epoch++; status = 'Paused. Read the report, or continue the expedition.'; render(); return; }
  if (thinking || !model.ready || mode !== 'llm') return;
  restartIfStale();
  running = true;
  hasError = false;
  render();
  const loopEpoch = epoch;
  while (running && loopEpoch === epoch && availableActions(game).length) {
    if (!(await decide())) break;
    await delay(DECISION_PAUSE_MS);
  }
  if (loopEpoch === epoch) running = false;
  render();
}
async function step() {
  if (running || thinking || !model.ready || mode !== 'llm') return;
  restartIfStale();
  await decide();
}
async function loadModel() {
  if (loading || checkingDevice || model.ready) return;
  loading = true;
  loadProgress = 0;
  $('model-status').className = '';
  $('load-progress').hidden = false;
  $('load-progress').value = 0;
  $('cta-progress').value = 0;
  $('model-status').textContent = $('model').value.startsWith('cpu:') ? 'Loading the CPU runtime, then downloading the model. The first load may take a few minutes.' : 'Checking WebGPU, then downloading the model. The first load may take a few minutes.';
  status = 'Fetching the model. The first load can take a few minutes; later loads use the browser cache.';
  hasError = false;
  render();
  try {
    await model.load($('model').value);
    $('model-status').textContent = 'Ready. Inference runs in a browser worker. Try your first draft, then change the orders and restart.';
    status = 'Model ready. Run the orders and watch what the hero makes of them.';
  } catch (error) {
    model.dispose();
    $('model-status').textContent = error.message;
    $('model-status').className = 'error';
    // The raw runtime message stays in the model panel; the status line says what to do about it.
    status = /network|fetch|cache/i.test(error.message) ? 'The model download was interrupted by a network error. Check the connection and load it again, or play manually.' : `Model could not load: ${error.message}`;
    hasError = true;
    $('model-settings').open = true;
  } finally { loading = false; $('load-progress').hidden = true; render(); }
}
function setMode(next) {
  if (loading || next === mode) return;
  epoch++;
  running = false;
  mode = next;
  hasError = false;
  status = mode === 'manual' ? 'Manual sandbox: choose actions under the stage. Your orders are not read.' : model.ready ? 'Local LLM selected. Run your orders.' : 'Local LLM selected. Load the model, then run your orders.';
  render();
}

$('load-model').addEventListener('click', loadModel);
$('load-cta').addEventListener('click', loadModel);
$('manual-cta').addEventListener('click', () => setMode('manual'));
$('check-device').addEventListener('click', checkHardware);
$('gpu-memory').addEventListener('change', render);
$('use-recommendation').addEventListener('click', () => {
  if (!recommendation?.model || $('use-recommendation').disabled) return;
  $('model').value = recommendation.model.id;
  $('model').dispatchEvent(new Event('change'));
});
$('run').addEventListener('click', run);
$('step').addEventListener('click', step);
$('reset').addEventListener('click', reset);
$('orders').addEventListener('input', saveOrders);
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
document.querySelectorAll('[data-level]').forEach(tab => tab.addEventListener('click', () => setLevel(tab.dataset.level)));
$('model').addEventListener('change', () => { epoch++; running = false; model.dispose(); $('model-status').textContent = 'Selected a new model. Load it to continue.'; status = 'Model changed. Load it to continue.'; hasError = false; render(); });
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { $('orders').value = presets()[button.dataset.preset]; saveOrders(); reset(); }));
$('next-level').addEventListener('click', () => setLevel('circuit'));
$('options').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button && mode === 'manual' && !thinking) { commit(button.dataset.action, 'manual'); render(); }
});
$('peek').addEventListener('click', event => { event.preventDefault(); $('orders-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('orders').focus({ preventScroll: true }); });
$('help-toggle').addEventListener('click', () => $('help').showModal());
$('help-close').addEventListener('click', () => $('help').close());
$('help').addEventListener('click', event => { if (event.target === $('help')) $('help').close(); });
$('export').addEventListener('click', () => {
  const report = { title: 'Per My Last ReQuest', controller: mode, model: model.model || null, promptVersion, orders: runOrders || $('orders').value, result: game.status, state: game, lastDecision };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'per-my-last-request-report.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
compactMap.addEventListener('change', render);
window.addEventListener('beforeunload', () => model.dispose());
// Small debugging surface for browser smoke tests and reproducible reports.
window.QuestDemo = { snapshot: () => structuredClone({ game, mode, level, running, thinking, modelReady: model.ready, status, lastDecision, orders: runOrders, device, checkingDevice, recommendation: recommendation?.model?.id || null }), loadModel, decide };
render();
checkHardware();

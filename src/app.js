import { newGame, availableActions, applyAction, observation, LEVELS, nextLevel, LOW_HP } from './game.js';
import { parseDecision, decisionMessages } from './protocol.js';
import { LocalModel } from './model.js';
import { renderMap } from './map.js';
import { MODELS, findModel, modelSize, checkDevice, recommendModel, selectedModelAdvice } from './models.js';
import { escapeHtml, artUrl, goalLine, objectiveSteps, sceneFor, journalHtml, verdictFor, verdictHtml, stampTarget, ordersSize, turnBeats, displayAt, turnFeedHtml, shoutFor, PACES, PACE_ORDER, BEAT_MS, clockUrgent, musicFor } from './view.js';
import { unlockSound, setSoundEnabled, playSound } from './sound.js';
import { unlockMusic, setMusicEnabled, setMusic, musicPlaying, musicState } from './music.js';

const $ = id => document.getElementById(id);
// The Manual sandbox is offered only when the game runs locally. tools/build.mjs removes this attribute from the published site.
const MANUAL_SANDBOX = document.documentElement.hasAttribute('data-manual-sandbox');

let level = 'tutorial';
let game = newGame(level);
let epoch = 0;
let running = false; // A run is in progress, paused or not.
let paused = false; // Pause froze the run: playback, the hero's thinking, and any reply that arrives all wait for Continue.
let loading = false;
let loadProgress = 0;
// Who plays the hero. 'llm': the model reads the orders. 'random': the hero ignores them and picks any offered action,
// with no model; an explicit choice, never a stand-in for a model. 'manual': the local sandbox, where the player clicks.
let mode = 'llm';
let runOrders = '';
let promptVersion = 1;
let status = 'Load a model and the hero will follow the orders exactly as written.';
let hasError = false;
let lastDecision = null;
let device = null;
let checkingDevice = false;
let tokenCount = null; // { text, model, tokens } counted by the loaded model's tokenizer.
let countKey = null;
let countTimer = null;
let setupShownFor = null; // The device check result that last opened the WebGPU guide.
let recommendation = null;
let mapShownAt = null; // The stop the map last showed, so the marker can walk instead of jump.
const painted = {}; // Keys of the last paint per region. Unchanged regions keep their DOM, and so their animations.
// Turn flow. The engine resolves a turn at once (`game`); the stage then plays it back beat by beat (`playback`).
// Meanwhile the model already reads ahead (`prepared`), so its thinking time hides behind the playback and any stop.
let phase = 'idle'; // 'consider': the options are up and the hero is visibly weighing them.
let playback = null;
let reviewing = null; // A played turn kept on the stage while the run waits: after "Stop after each turn", or a skip during a pause.
const prepared = new Map(); // Decisions asked for ahead of time: key → { revision, promise }.
let readAheadDepth = 3; // How many decisions beyond the state on screen the model may prepare.
let readAheadRun = 0; // Each committed turn starts a new read-ahead; older ones stop.
let workerQueue = Promise.resolve(); // The worker answers one request at a time, so requests queue here.
let modelBusy = 0;
let awaitingModel = false; // The options have been up long enough, and the model still has not answered.
let holdAt = null; // Debug and screenshot aid: playback stops advancing once it reaches this beat.
let decisionSeconds = new Map(); // Turn number → model seconds, for this trial.
let warnedAt = '';
const stored = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Storage may be unavailable in private browser contexts. */ } };
// A new key since "Turn by turn" joined the paces and became the default; earlier choices meant something else.
let pace = PACES[stored('pmlq.runPace', 'step')] ? stored('pmlq.runPace', 'step') : 'step';
let instant = false; // Tools only: turns resolve with no playback at all.
let soundOn = stored('pmlq.sound', 'on') !== 'off';
if (!soundOn) setSoundEnabled(false); // Otherwise audio starts on the first click or key press, as browsers require.
let musicOn = stored('pmlq.music', 'on') !== 'off';
if (!musicOn) setMusicEnabled(false);
const TEMPERATURE_MAX = 1.5;
const readTemperature = value => { const t = Math.round(Number(value) * 10) / 10; return Number.isFinite(t) ? Math.min(TEMPERATURE_MAX, Math.max(0, t)) : 0; };
// The model's sampling temperature. At 0, how the game was tested, the same situation always gets the same choice.
let temperature = readTemperature(stored('pmlq.temperature', '0'));
// The temperature this trial runs at. Like the orders, it is fixed when a trial starts; a change applies from the next one.
let runTemperature = temperature;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let epochSignal = deferred();
/** Invalidates every pending and prepared model reply, and wakes anything waiting on one. */
function bumpEpoch() {
  epoch++;
  prepared.clear();
  readAheadRun++;
  const signal = epochSignal;
  epochSignal = deferred();
  signal.resolve();
}
const paceFactor = () => instant ? 0 : PACES[pace].speed;
/** "Turn by turn": a run plays one turn, then stops with that turn on the stage. */
const stopEachTurn = () => PACES[pace].stops;
/** What the stage shows: the turn being played back, or the engine's state once nothing is playing. */
const shown = () => playback?.display ?? game;
const deciding = () => phase === 'consider';
/** The hero decides (by model or at random) and runs play turn after turn; in the Manual sandbox the player clicks. */
const heroDecides = () => mode !== 'manual';
/** A run can start: the Random hero needs nothing, the model hero a loaded model. */
const canRun = () => mode === 'random' || (mode === 'llm' && model.ready);
/** Orders edited mid-trial restart it, but only for a hero that reads them. */
const ordersEdited = () => mode === 'llm' && game.turn > 0 && typedOrders() !== runOrders;
/** A run is moving. Orders, assignments and model settings unlock when it is paused or stopped. */
const locked = () => running && !paused;
let pausedTotal = 0; // Milliseconds spent paused, so a measured wait for the model can leave pauses out.
let pausedSince = null;
const pausedMs = () => pausedTotal + (pausedSince === null ? 0 : performance.now() - pausedSince);
function setPaused(on) {
  if (paused === on) return;
  paused = on;
  if (on) pausedSince = performance.now();
  else { pausedTotal += performance.now() - pausedSince; pausedSince = null; }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Resolves once the run is no longer paused, or as soon as `cancelled()`. */
async function untilResumed(cancelled) {
  while (paused && !cancelled()) await Promise.race([delay(50), epochSignal.promise]);
}
/** Waits `ms` of game time. The clock stops while the run is paused; `cancelled()` ends the wait early. */
async function gameTime(ms, cancelled) {
  let left = ms;
  while (left > 0 && !cancelled()) {
    const from = performance.now();
    await Promise.race([delay(Math.min(left, 50)), epochSignal.promise]);
    if (!paused) left -= performance.now() - from;
  }
  await untilResumed(cancelled);
}

$('model').replaceChildren(...MODELS.map(entry => new Option(`${entry.name} · ${entry.backend}${entry.id.startsWith('Qwen3-') || entry.backend === 'CPU' ? ', experimental' : ''}`, entry.id)));
const model = new LocalModel(report => {
  loadProgress = Math.max(0, Math.min(1, report.progress || 0));
  $('load-progress').value = loadProgress;
  $('cta-progress').value = loadProgress;
  $('model-status').textContent = report.text;
  if (loading) $('load-cta').firstChild.textContent = `Loading model… ${Math.round(loadProgress * 100)}% `;
});
const presets = () => LEVELS[level].presets;
const storedOrders = () => { try { return localStorage.getItem(`pmlq.orders.${level}`); } catch { return null; } };
const typedOrders = () => $('orders').value.trim();
const compactMap = matchMedia('(max-width: 560px)');
class Stale extends Error {}
$('orders').value = storedOrders() || presets().reckless;

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
  const busy = checkingDevice || loading || locked();
  recommendation = recommendModel(device, gpuMemory(), { manual: MANUAL_SANDBOX });
  const suggested = recommendation?.model?.id === selected.id;
  $('check-device').disabled = busy;
  $('check-device').textContent = checkingDevice ? 'Checking…' : 'Check again';
  $('load-model').disabled = busy || model.ready;
  $('gpu-memory').disabled = busy;
  $('device-status').textContent = checkingDevice ? 'Checking browser graphics… No model download.' : device ? `${device.name ? `${device.name}. ` : ''}${device.reason}` : 'Device has not been checked.';
  $('recommendation').innerHTML = recommendation ? `<strong>${recommendation.model ? `Suggested: ${escapeHtml(recommendation.model.name)} · ${recommendation.model.backend}` : MANUAL_SANDBOX ? 'Manual sandbox recommended' : 'No local model can run here'}</strong><span>${escapeHtml(recommendation.reason)}</span>` : '';
  // The suggestion only asks for attention when it differs from the current selection.
  $('recommendation-box').hidden = !recommendation || suggested;
  $('use-recommendation').disabled = busy || !recommendation?.model || suggested;
  $('use-recommendation').textContent = suggested ? 'Suggested model selected ✓' : 'Use recommendation';
  $('model-name').textContent = `${selected.name} · ${selected.backend}`;
  $('model-details').textContent = `${modelSize(selected.downloadGB)} download${selected.memoryGB ? ` · ~${selected.memoryGB} GB GPU memory` : ' · no GPU needed'}${suggested ? ' · suggested for this device' : ''}${temperature > 0 ? ` · temperature ${temperature.toFixed(1)}` : ''}`;
  $('model-advice').textContent = selectedModelAdvice(selected, device, gpuMemory());
  $('model-chip').textContent = loading ? 'Loading…' : model.ready ? 'Ready ✓' : 'Not loaded';
  $('model-chip').className = `chip ${model.ready ? 'gain' : 'quiet'}`;
  // Without usable WebGPU, open the browser setup guide once for that check result. The player can close it again.
  if (device && (!device.gpu || device.software) && setupShownFor !== device) {
    setupShownFor = device;
    $('webgpu-help').open = true;
  }
}
async function checkHardware() {
  if (checkingDevice || loading || locked()) return;
  checkingDevice = true;
  render();
  try { device = await checkDevice(); }
  finally { checkingDevice = false; render(); }
}

function saveOrders() {
  try { localStorage.setItem(`pmlq.orders.${level}`, $('orders').value); } catch { /* Storage may be unavailable in private browser contexts. */ }
  render(); // The Run button says when edited orders will restart the trial.
}
/** Ends any run: drops replies in flight or prepared, stops playback, and clears a pause or a stop. */
function stopRun() {
  bumpEpoch();
  stopPlayback();
  running = false;
  setPaused(false);
  phase = 'idle';
  awaitingModel = false;
  reviewing = null;
}
function reset() {
  stopRun();
  game = newGame(level);
  runOrders = typedOrders();
  runTemperature = temperature;
  promptVersion++;
  lastDecision = null;
  decisionSeconds = new Map();
  mapShownAt = null;
  status = mode === 'manual' ? 'Fresh trial. Choose the first action under the stage.' : mode === 'random' ? 'Fresh trial. The hero will pick at random again.' : 'Fresh trial. Same course. Revised instructions.';
  hasError = false;
  render();
}
function setLevel(next) {
  if (locked() || next === level) return;
  level = next;
  $('orders').value = storedOrders() || presets().reckless;
  reset();
}

function renderHero(s) {
  const low = s.hp <= LOW_HP;
  const beat = playback?.beats[playback.index];
  // From the moment the hero raises a guard until the turn ends, the card shows it.
  const guarding = playback?.entry.action === 'guard' && playback.index >= 1;
  $('hp-value').textContent = s.hp;
  $('hp-max').textContent = `/ ${s.maxHp} HP`;
  $('hp-flag').hidden = !low;
  $('hp-flag').textContent = s.hp === 0 ? 'Down' : 'Low health';
  $('hp-bar').style.width = `${s.hp / s.maxHp * 100}%`;
  $('hero-card').className = `fighter hero${low ? ' low' : ''}${s.hp === 0 ? ' down' : ''}${deciding() ? ' thinking' : ''}${beat?.actor === 'hero' ? ' acting' : ''}${guarding ? ' guarding' : ''}`;
  // While a turn plays, the hero says what they chose.
  $('hero-says').hidden = !playback;
  if (playback) $('hero-says').textContent = shoutFor(playback.entry.action);
  $('stamina-value').innerHTML = `<span class="pips" aria-hidden="true">${Array.from({ length: 4 }, (_, i) => `<i class="${i < s.stamina ? 'on' : ''}"></i>`).join('')}</span><span>${s.stamina}<span class="sr-only"> of 4</span></span>`;
  $('potion-value').textContent = s.potions;
  $('coin-value').textContent = s.coins;
  $('sword-value').textContent = s.sword && s.buckler ? `Sword +${s.sword}, buckler` : s.sword ? `Sword +${s.sword}` : s.buckler ? 'Buckler' : 'Basic';
  $('lap-badge').hidden = s.level === 'tutorial';
  $('lap-badge').textContent = `Lap ${s.lap}`;
}
function renderFoe(s) {
  const scene = sceneFor(s);
  const acting = playback?.beats[playback.index]?.actor === 'foe';
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
  // The announced move is the one thing to read before each decision in the full circuit.
  // When the opponent acts during playback, the same box says "Now" and flashes.
  // While the opponent acts, its box names the move it is making. On a turn's last beat the stage already shows the
  // state after the turn, whose announced move is the next one, so the move comes from the state the turn began in.
  const intent = acting ? sceneFor(playback.before).intent : scene.intent;
  $('foe-intent').hidden = !intent;
  if (intent) {
    $('foe-intent').className = `intent kind-${intent.kind}${acting ? ' acting' : ''}`;
    $('foe-intent').innerHTML = `<span class="intent-label">${acting ? 'Now' : 'Next move'}</span><span class="intent-tag">${escapeHtml(intent.tag)}</span>${intent.damage ? `<b class="intent-dmg">${intent.damage} dmg</b>` : ''}<span class="intent-name">${escapeHtml(intent.name)}</span>`;
    // A newly announced smash gets a low warning cue, once.
    const key = `${epoch}:${s.revision}`;
    if (!acting && intent.kind === 'smash' && warnedAt !== key) { warnedAt = key; playSound('warn', 0.35); }
  }
  $('foe-stamp').hidden = !scene.mark;
  $('foe-stamp').textContent = scene.mark;
  $('foe-card').className = `fighter foe${scene.enemy ? ' is-enemy' : ''}${scene.mark ? ' is-over' : ''}${acting ? ' acting' : ''}`;
  // The card carries the short facts; the line under it explains what each one means.
  const notes = [...(intent ? [{ label: `${intent.tag}:`, note: intent.note }] : []), ...scene.traits];
  $('situation').innerHTML = `${escapeHtml(scene.text)}${notes.length ? `<span class="trait-notes">${notes.map(trait => `<span><b>${escapeHtml(trait.label)}</b> ${escapeHtml(trait.note)}</span>`).join('')}</span>` : ''}`;
}
function renderBrief(s) {
  document.querySelectorAll('[data-level]').forEach(tab => {
    tab.setAttribute('aria-pressed', String(tab.dataset.level === level));
    tab.disabled = locked();
  });
  $('goal-text').textContent = goalLine(s);
  const steps = objectiveSteps(s);
  const done = new Set(steps.filter(step => step.done).map(step => step.label));
  const earlier = painted.objectiveEpoch === epoch ? painted.objectiveDone : done;
  paint('objective', `${epoch}:${level}:${steps.map(step => `${+step.done}${+step.next}${+step.failed}${step.note}`).join('')}`, () => {
    $('objective').innerHTML = steps.map(step => {
      const fresh = step.done && !earlier.has(step.label); // Newly earned: gets the stamping animation once.
      // The evidence ("Beaten on turn 3", "Retreated on turn 2") shows on hover; the report's checklist shows it at the end.
      return `<li class="goal ${step.kind}${step.done ? ' done' : ''}${step.failed ? ' failed' : ''}${step.next ? ' next' : ''}${fresh ? ' fresh' : ''}" title="${escapeHtml(step.note)}"><span class="goal-mark" aria-hidden="true">${step.done ? '✓' : step.failed ? '✗' : `<img src="${artUrl(step.art)}" alt="" onerror="this.remove()">`}</span><span class="goal-text"><span class="sr-only">${step.kind === 'stamp' ? 'Stamp: ' : step.kind === 'champion' ? 'Defeat: ' : ''}</span>${escapeHtml(step.label)}<span class="sr-only">${step.done ? ' (done)' : step.failed ? ` (not done: ${escapeHtml(step.note)})` : ''}</span></span></li>`;
    }).join('');
  });
  painted.objectiveEpoch = epoch;
  painted.objectiveDone = done;
  const left = s.turnLimit - s.turn;
  $('turn-value').textContent = `${s.turn} / ${s.turnLimit}`;
  $('turn-bar').style.width = `${s.turn / s.turnLimit * 100}%`;
  $('turn-left').textContent = left === 0 ? 'none left' : `${left} left`;
  $('deadline').className = `deadline${clockUrgent(s) ? ' urgent' : ''}`;
}
/** The exact prompt behind a decision: the one being made now, or, during playback, the one just made. */
function renderPrompt(state, actions) {
  const orders = runOrders || typedOrders() || '(no orders written)';
  const [system, user] = decisionMessages(orders, observation(state), actions);
  $('seen').hidden = actions.length === 1 && heroDecides();
  $('seen').querySelector('summary').textContent = mode !== 'llm' ? (playback ? 'What an LLM hero would have been told' : 'What an LLM hero would be told this turn') : playback ? 'What the hero was told this turn' : 'What the hero is told this turn';
  $('seen-text').textContent = `${system.content}\n\n${user.content}`;
}
const CHOSE = { llm: 'The hero chose', random: 'Picked at random', manual: 'You chose', auto: 'No choice' };
function renderMoves(s) {
  const verdict = verdictFor(s);
  $('stage').className = `stage${verdict ? ` ended ${verdict.tone}` : ''}${paused ? ' paused' : ''}`;
  $('paused-badge').hidden = !paused;
  $('verdict').hidden = !verdict;
  paint('verdict', `${epoch}:${s.status}:${s.turn}`, () => { $('verdict').innerHTML = verdictHtml(verdict); });
  // The stage shows one thing under the fighters: the turn being played (or kept for review), or else the situation
  // the next decision is made in. Both stay laid out in one cell, so the box keeps its height and the controls do not jump.
  const turn = playback || reviewing;
  $('stage-foot').classList.toggle('playing', Boolean(turn));
  $('stage-foot').classList.toggle('reviewing', !playback && Boolean(reviewing));
  $('skip').hidden = !playback;
  if (turn) {
    const { entry, offered } = turn;
    const index = playback ? playback.index : Infinity; // Kept for review: every line shown.
    const seconds = entry.source === 'llm' ? decisionSeconds.get(entry.turn) ?? null : null;
    paint('feed', `${epoch}:${entry.turn}:${index}`, () => { $('turn-feed').innerHTML = turnFeedHtml({ ...turn, index }, seconds); });
    // The options stay on the table, with the one taken stamped and the rest set aside.
    $('options-wrap').hidden = false;
    $('options-wrap').className = `options-wrap played${paused ? ' paused' : ''}`;
    $('options-title').textContent = `Turn ${entry.turn} · ${CHOSE[entry.source]}: ${entry.label}`;
    $('options').dataset.count = offered.length;
    paint('options', `played:${epoch}:${entry.turn}`, () => {
      $('options').innerHTML = offered.map(action => {
        const detail = action.detail === action.label ? '' : `<span>${escapeHtml(action.detail)}</span>`;
        const chosen = action.id === entry.action;
        return `<div class="option ${chosen ? 'chosen' : 'passed'}">${chosen ? '<em class="chosen-mark">Chosen</em>' : ''}<strong>${escapeHtml(action.label)}</strong>${detail}</div>`;
      }).join('');
    });
    renderPrompt(turn.before, offered);
    return;
  }
  const actions = availableActions(s);
  $('options-wrap').hidden = !actions.length;
  if (!actions.length) return;
  const forced = actions.length === 1;
  $('options-wrap').className = `options-wrap${deciding() ? ' thinking' : ''}${paused ? ' paused' : ''}`;
  // Numbered as the turn being decided, one past the turns used.
  const random = mode === 'random';
  $('options-title').textContent = `Turn ${s.turn + 1} · ${mode === 'manual' ? 'Your move. Choose an action'
    : deciding() ? (random ? `The hero picks one of ${actions.length} at random…` : `The hero weighs ${actions.length} options…`)
    : forced ? 'Only one way forward, so no decision is needed' : random ? `The hero will pick one of ${actions.length} at random` : `The hero will choose one of ${actions.length}`}`;
  $('options').dataset.count = actions.length;
  paint('options', `open:${epoch}:${s.revision}:${mode}:${level}`, () => {
    $('options').innerHTML = actions.map(action => {
      const detail = action.detail === action.label ? '' : `<span>${escapeHtml(action.detail)}</span>`;
      return mode === 'manual'
        ? `<button class="option" data-action="${action.id}"><strong>${escapeHtml(action.label)}</strong>${detail}</button>`
        : `<div class="option"><strong>${escapeHtml(action.label)}</strong>${detail}</div>`;
    }).join('');
  });
  renderPrompt(s, actions);
}
/** What the run is doing, in one line under the stage. Null when the run is idle. */
function runLine() {
  const shownTurn = (playback || reviewing)?.entry.turn;
  const upcoming = game.turn + 1;
  // Kept short enough for one line beside the pace and sound settings; the button below says Continue.
  if (paused) return `Paused${deciding() ? ` while the hero weighs turn ${upcoming}` : shownTurn ? ` ${playback ? 'during' : 'after'} turn ${shownTurn}` : ''}.`;
  if (deciding()) return mode === 'random' ? `Turn ${upcoming}: the hero is picking at random. Your orders are not read.` : `Turn ${upcoming}: ${awaitingModel ? 'the model needs a moment longer.' : 'the hero is reading your orders.'} Thinking costs no turns.`;
  if (playback && running) return stopEachTurn() ? `Playing turn ${shownTurn}. The trial stops when it ends.` : 'Running. Pause stops everything at once.';
  if (reviewing) return `Stopped after turn ${shownTurn}.${nextMoveNote()}`;
  return null;
}
/** At a stop: whether the model has already prepared the hero's next decision. */
function nextMoveNote() {
  if (ordersEdited()) return ' New orders restart the trial.';
  const actions = availableActions(game);
  if (actions.length === 1) return ' The next move is automatic.';
  if (mode !== 'llm') return '';
  const ahead = prepared.get(decisionKey(game, actions))?.promise;
  return !ahead ? '' : ahead.settled ? ' The next move is ready.' : ' Preparing the next move…';
}
function renderControls(s) {
  const terminal = !availableActions(s).length;
  const over = !availableActions(game).length;
  const ordersChanged = ordersEdited();
  const llm = mode === 'llm';
  const manual = mode === 'manual';
  const selected = findModel($('model').value);
  const won = s.status === 'won';
  const luck = s.log.some(entry => entry.source === 'random'); // The orders did not decide this trial.
  $('load-cta').hidden = !llm || model.ready;
  $('load-cta').disabled = loading || checkingDevice;
  $('load-cta').innerHTML = loading ? `Loading model… ${Math.round(loadProgress * 100)}% ` : `<span>Load <span class="wide-only">${escapeHtml(selected.name)}</span><span class="narrow-only">model</span></span> <small>${modelSize(selected.downloadGB)}<span class="wide-only"> download</span></small><span aria-hidden="true">↓</span>`;
  $('cta-progress').hidden = !loading;
  $('manual-cta').hidden = !MANUAL_SANDBOX || !llm || model.ready || loading;
  // A GPU model on a device without usable WebGPU would only fail to load. Say so before the click.
  const blocked = llm && !model.ready && !loading && !hasError && device && (!device.gpu || device.software) && selected.backend !== 'CPU';
  $('run').hidden = !canRun();
  // Outside a run, a turn still playing finishes (or is skipped) before the next one can start.
  $('run').disabled = !running && (deciding() || Boolean(playback));
  const arrow = '<span aria-hidden="true">→</span>';
  const again = '<span aria-hidden="true">↻</span>';
  $('run').innerHTML = running && !paused ? 'Pause <span aria-hidden="true">Ⅱ</span>'
    : ordersChanged && !over ? `Restart with new orders ${again}`
    : running ? `Continue ${arrow}`
    : over ? `Run again ${again}`
    : game.turn > 0 ? (stopEachTurn() ? `Next turn ${arrow}` : `Continue ${arrow}`) : mode === 'random' ? `Run at random ${arrow}` : `Run these orders ${arrow}`;
  $('next-level').hidden = !(won && nextLevel(s.level));
  $('run').className = $('next-level').hidden ? 'primary' : 'secondary';
  $('reset').hidden = game.turn === 0; // Nothing to restart yet.
  $('reset').textContent = terminal && manual ? 'Try again ↻' : 'Restart';
  $('reset').className = terminal && manual && $('next-level').hidden ? 'primary' : 'ghost';
  $('run-status').textContent = (!hasError && heroDecides() && runLine())
    || (blocked ? 'This browser cannot run the selected GPU model. See “Get WebGPU” under “Who plays the hero?”' + (MANUAL_SANDBOX ? ', use the CPU suggestion there, or play manually.' : ' or use the CPU suggestion there.')
    : !hasError && s.status === 'won' ? (luck ? 'Success, by luck. The hero ignored your orders.' : 'Success. Your orders got the hero home.')
    : !hasError && s.status === 'lost' ? (luck ? 'Trial over. The hero picked at random. See whether your orders do better.' : 'Trial over. Read the report, change the orders, and run again.')
    : status);
  $('run-status').className = `run-status${hasError ? ' error' : ''}${deciding() && !paused ? ' busy' : ''}${paused ? ' paused' : ''}`;
  // With nothing but Restart to offer, the bar shrinks to one line so it covers less of a small screen.
  $('controls').className = `controls${manual && !terminal ? ' compact' : ''}`;
  const next = PACES[PACE_ORDER[(PACE_ORDER.indexOf(pace) + 1) % PACE_ORDER.length]];
  $('pace').innerHTML = `<span class="wide-only">Pace: </span>${PACES[pace].label}`;
  $('pace').title = `${PACES[pace].label}: ${PACES[pace].note} Click for ${next.label}.`;
  $('pace').setAttribute('aria-label', `Pace: ${PACES[pace].label}. ${PACES[pace].note} Change to ${next.label}`);
  $('sound').setAttribute('aria-pressed', String(soundOn));
  $('sound').innerHTML = `<span aria-hidden="true">♪</span> <span class="wide-only">Sound: </span>${soundOn ? 'On' : 'Off'}`;
  $('sound').setAttribute('aria-label', `Sound effects ${soundOn ? 'on' : 'off'}`);
  $('music').setAttribute('aria-pressed', String(musicOn));
  $('music').innerHTML = `<span aria-hidden="true">♫</span> <span class="wide-only">Music: </span>${musicOn ? 'On' : 'Off'}`;
  $('music').setAttribute('aria-label', `Music ${musicOn ? 'on' : 'off'}`);
}
// The loaded model counts the tokens of the orders with its own tokenizer, shortly after typing stops.
// Counting never waits for or delays a decision; if it fails, the estimate stays.
function countOrderTokens() {
  if (!model.ready) return;
  const text = typedOrders();
  const id = model.model;
  const key = `${id}\n${text}`;
  if (countKey === key) return; // Already counted, or being counted.
  countKey = key;
  clearTimeout(countTimer);
  countTimer = setTimeout(async () => {
    try {
      const tokens = await model.countTokens(text);
      if (model.ready && model.model === id && typedOrders() === text) { tokenCount = { text, model: id, tokens }; renderOrders(); }
    } catch { /* The estimate stays. */ }
  }, 250);
}
function renderOrders() {
  const changed = ordersEdited();
  $('orders').disabled = locked();
  $('orders-notice').hidden = !changed;
  // Size only. Tokens are exact once the loaded model has counted this text, and an estimate before that.
  const counted = model.ready && tokenCount?.model === model.model ? { ...tokenCount, by: findModel(tokenCount.model).name } : null;
  const size = ordersSize(typedOrders(), counted);
  // Words over tokens, two lines like the signature beside them. The hidden separator keeps the text readable as one line.
  $('orders-size').innerHTML = size.label.split(' · ').map(escapeHtml).join('<span class="sr-only"> · </span><br>');
  $('orders-size').title = size.note;
  countOrderTokens();
  $('peek-text').textContent = (game.turn > 0 && runOrders) || typedOrders() || 'No orders written.';
  document.querySelectorAll('[data-preset]').forEach(button => { button.disabled = locked(); });
}
function renderController() {
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    button.disabled = loading;
  });
  $('model').disabled = loading || locked();
  $('temperature').disabled = loading || locked();
  if (Number($('temperature').value) !== temperature) $('temperature').value = temperature;
  $('temperature-value').textContent = temperature.toFixed(1);
  const later = game.turn > 0 && availableActions(game).length > 0 && temperature !== runTemperature;
  $('temperature-note').textContent = later ? `This trial keeps temperature ${runTemperature.toFixed(1)}. The new value applies from the next trial.`
    : temperature === 0 ? 'At 0 the hero makes the same choice in the same situation every run. The game was tested at 0.'
    : 'Above 0 the hero’s choices can vary from run to run, and may follow the orders less closely. The game was tested at 0.';
  $('load-model').textContent = loading ? 'Loading model…' : model.ready ? 'Model ready ✓' : 'Load local model ↓';
  $('model-options').hidden = mode !== 'llm';
  $('manual-note').hidden = mode !== 'manual';
  $('random-note').hidden = mode !== 'random';
  renderModelAdvice();
}
function renderMapRegion(s) {
  const compact = compactMap.matches;
  const retreats = s.log.filter(entry => entry.action === 'retreat').length;
  paint('map', [epoch, level, compact, s.position, s.lap, s.stamps.length, s.champion, retreats].join(':'), () => {
    const from = mapShownAt !== null && mapShownAt !== s.position ? mapShownAt : null;
    const { body, viewBox } = renderMap(s, { compact, from });
    $('map').setAttribute('viewBox', viewBox);
    $('map').innerHTML = body;
    mapShownAt = s.position;
    $('map').setAttribute('aria-label', `Training circuit. Hero at ${sceneFor(s).name}. ${s.stamps.length} of ${stampTarget(s)} stamps collected.`);
  });
}
function render() {
  const s = shown();
  document.body.dataset.mode = mode;
  renderBrief(s);
  renderHero(s);
  renderFoe(s);
  renderMoves(s);
  renderControls(s);
  renderOrders();
  renderController();
  renderMapRegion(s);
  paint('journal', `${epoch}:${s.log.length}`, () => { $('journal').innerHTML = journalHtml(s.log); });
  renderMusic(s);
}
/** The music follows the stage, not the engine, so the win and loss stingers wait for the turn's last beat. Pause lowers it. */
function renderMusic(s) {
  setMusic({ ...musicFor(s, running), paused });
}

/** One beat's sounds, floating numbers and screen-reader line. The stage itself is drawn by render(). */
function showBeat(beat, entry) {
  // With music on, the win and loss stingers take the place of the chimes.
  beat.sounds.filter(name => !(musicPlaying() && (name === 'won' || name === 'lost'))).forEach((name, i) => playSound(name, i * 0.16));
  const stacked = { hero: 0, foe: 0 };
  for (const fx of beat.fx) {
    const card = $(fx.card === 'hero' ? 'hero-card' : 'foe-card');
    const note = document.createElement('span');
    note.className = `float ${fx.tone}`;
    note.style.setProperty('--stack', stacked[fx.card]++);
    note.textContent = fx.text;
    note.setAttribute('aria-hidden', 'true');
    card.append(note);
    setTimeout(() => note.remove(), 1500);
    if (fx.tone === 'loss') {
      card.classList.remove('hit');
      void card.offsetWidth; // Restart the shake when two hits land back to back.
      card.classList.add('hit');
    }
  }
  $('beat-live').textContent = beat.kind === 'choice' ? `Turn ${entry.turn}. ${CHOSE[entry.source]}: ${beat.text}.` : beat.text;
}
/**
 * Shows a resolved turn beat by beat. The engine state (`game`) is already final; only the display steps through it.
 * Pause freezes it on the current beat. Restart, a level or mode change, or Skip ends it early.
 */
function startPlayback(before, after) {
  stopPlayback();
  const entry = after.log.at(-1);
  const beats = turnBeats(before, entry);
  const pb = { before, after, entry, beats, offered: availableActions(before), index: 0, display: before, skip: false, done: deferred() };
  const factor = paceFactor();
  if (!factor) { endPlayback(pb); return; } // Instant pace, for tools: no playback at all.
  playback = pb;
  (async () => {
    const over = () => playback !== pb || pb.skip;
    for (let i = 0; i < beats.length && !over(); i++) {
      pb.index = i;
      pb.display = displayAt(before, after, beats, i);
      render();
      showBeat(beats[i], entry);
      await gameTime(beats[i].ms * factor, over);
      while (holdAt !== null && i >= holdAt && !over()) await delay(50);
    }
    if (playback === pb) endPlayback(pb);
    pb.done.resolve();
  })();
}
/** A turn has finished playing. If the run is stopping (or paused), the stage keeps the turn in view for review. */
function endPlayback(pb) {
  if (playback === pb) playback = null;
  if (heroDecides() && (paused || stopEachTurn()) && availableActions(pb.after).length) reviewing = pb;
  render();
}
function stopPlayback() {
  const pb = playback;
  if (!pb) return;
  playback = null;
  pb.skip = true;
}
function skipPlayback() {
  const pb = playback;
  if (!pb) return;
  pb.skip = true;
  endPlayback(pb);
}
const playbackDone = () => playback ? playback.done.promise : Promise.resolve();

function commit(actionId, source) {
  const before = game;
  game = applyAction(game, actionId, source);
  for (const [key, entry] of prepared) if (entry.revision < game.revision) prepared.delete(key);
  if (source === 'llm' && lastDecision) decisionSeconds.set(game.turn, lastDecision.elapsed / 1000);
  // Win and loss messages come from the state on screen, so the status line never gives away the end of a turn early.
  if (mode === 'manual') status = 'Manual sandbox: you are choosing the actions.';
  startPlayback(before, game);
  // While this turn plays out, and while the run waits after it, the model reads ahead.
  if (mode === 'llm') readAhead(game);
}
/**
 * The model prepares up to `readAheadDepth` decisions from `from`, each in the state the previous prepared decision
 * leads to. A prepared decision is always the one used, so these are the states the hero will reach; a restart, an
 * error or a changed mode drops them all. Forced moves need no model and are stepped over.
 */
function readAhead(from) {
  const run = ++readAheadRun;
  const startEpoch = epoch;
  (async () => {
    let s = from;
    for (let depth = 0; depth < readAheadDepth;) {
      if (run !== readAheadRun || startEpoch !== epoch || mode !== 'llm' || !model.ready) return;
      const actions = availableActions(s);
      if (!actions.length) return;
      if (actions.length === 1) { s = applyAction(s, actions[0].id, 'auto'); continue; }
      depth++;
      let decision;
      try { decision = await decisionFor(s, actions); } catch { return; }
      s = applyAction(s, decision.action, 'llm');
    }
  })();
}
const decisionPayload = (state, actions) => ({ orders: runOrders, observation: observation(state), actions, temperature: runTemperature });
/** A prepared decision belongs to one trial (epoch), one state (revision) and the exact prompt it answered. */
const decisionKey = (state, actions) => `${epoch}:${state.revision}:${JSON.stringify(decisionPayload(state, actions))}`;
/**
 * The model's decision for `state`: one already prepared for this trial, state and prompt, or a fresh request.
 * Requests queue, because the worker answers one at a time.
 */
function decisionFor(state, actions) {
  const key = decisionKey(state, actions);
  const known = prepared.get(key);
  if (known) return known.promise;
  const requestEpoch = epoch;
  const payload = decisionPayload(state, actions);
  const promise = workerQueue.catch(() => {}).then(async () => {
    if (requestEpoch !== epoch) throw new Stale('Superseded before it was sent.');
    modelBusy++;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await model.decide(payload);
          return { ...result, action: parseDecision(result.raw, actions) };
        } catch (error) { if (requestEpoch !== epoch || !model.ready || attempt === 1) throw error; }
      }
    } finally { modelBusy--; }
  });
  promise.settled = false;
  // Settling also keeps an unused rejection quiet. A stop says whether the next move is ready, so it repaints.
  promise.then(() => { promise.settled = true; if (reviewing) render(); }, () => { promise.settled = true; });
  workerQueue = promise;
  prepared.set(key, { revision: state.revision, promise });
  return promise;
}
function prepareOrders() {
  if (!runOrders || game.turn === 0) runOrders = typedOrders();
  if (game.turn === 0) runTemperature = temperature;
  if (runOrders) return true;
  status = 'Write some standing orders first.';
  hasError = true;
  render();
  return false;
}
/**
 * One turn in LLM mode. The options stay up for a moment while the hero weighs them, then the choice is revealed and
 * played back. A model or parsing failure ends the run and spends no turn; a stale reply is dropped. While the run is
 * paused, the options stay up and a reply that arrives is held until Continue.
 */
async function takeTurn() {
  if (mode === 'llm' && !prepareOrders()) return false;
  const actions = availableActions(game);
  if (!actions.length) return false;
  reviewing = null;
  // Forced movement needs no inference. The model is called whenever a real choice exists.
  if (actions.length === 1) { commit(actions[0].id, 'auto'); return true; }
  if (mode === 'random') return pickAtRandom(actions);
  const requestEpoch = epoch;
  const stale = () => requestEpoch !== epoch;
  const revision = game.revision;
  const pending = decisionFor(game, actions);
  const preparedAhead = pending.settled;
  const interrupted = epochSignal.promise.then(() => null);
  phase = 'consider';
  hasError = false;
  render();
  let decision = null;
  try {
    await gameTime(BEAT_MS.consider * paceFactor(), stale);
    if (stale()) return false;
    const waitFrom = performance.now();
    const pausedFrom = pausedMs();
    if (!pending.settled) { awaitingModel = true; render(); }
    decision = await Promise.race([pending, interrupted]);
    // How long the player actually watched the model think, beyond the time the options are always shown. Pauses don't count.
    const waitedMs = Math.max(0, Math.round(performance.now() - waitFrom - (pausedMs() - pausedFrom)));
    if (decision) decision = { ...decision, preparedAhead, waitedMs };
    awaitingModel = false;
    await untilResumed(stale);
  } catch (error) {
    if (!stale() && !(error instanceof Stale)) {
      // A retry asks the model again, and nothing prepared after the failed decision can be trusted.
      prepared.clear();
      readAheadRun++;
      running = false;
      setPaused(false);
      hasError = true;
      status = `${error.message} No turn was spent. You can retry${MANUAL_SANDBOX ? ' or use Manual sandbox' : ''}.`;
    }
    return false;
  } finally {
    // A restart may already have started the next trial; its phase is not ours to reset.
    if (!stale()) { phase = 'idle'; awaitingModel = false; }
    render();
  }
  if (!decision || stale() || revision !== game.revision) return false;
  lastDecision = decision;
  commit(decision.action, 'llm');
  return true;
}
/**
 * One turn with the Random hero. The options stay up as long as they would for a model, then one is picked uniformly
 * at random. No model is asked and the orders are not read. Pause holds the pick; a restart or mode change drops it.
 */
async function pickAtRandom(actions) {
  const requestEpoch = epoch;
  const stale = () => requestEpoch !== epoch;
  const revision = game.revision;
  phase = 'consider';
  hasError = false;
  render();
  try { await gameTime(BEAT_MS.consider * paceFactor(), stale); }
  finally { if (!stale()) phase = 'idle'; render(); }
  if (stale() || revision !== game.revision) return false;
  commit(actions[Math.floor(Math.random() * actions.length)].id, 'random');
  return true;
}
/** A finished trial, or orders edited mid-trial, both mean the next decision starts a fresh trial. */
function restartIfStale() {
  if (!availableActions(game).length || ordersEdited()) reset();
}
/**
 * The primary trial button: start a run, pause it, or continue it. Pause freezes everything at once and keeps the
 * decisions the model has prepared, since they answer the very states the run will continue from.
 * With "Stop after each turn", a run plays one turn and stops with that turn still on the stage.
 */
async function run() {
  if (running && !paused) { setPaused(true); render(); return; }
  if (running) {
    // Orders edited during a pause apply from a fresh trial, as the notice under the letter says.
    if (ordersEdited()) reset();
    else { setPaused(false); render(); return; }
  }
  if (deciding() || playback || !canRun()) return;
  restartIfStale();
  running = true;
  hasError = false;
  render();
  const loopEpoch = epoch;
  const live = () => running && loopEpoch === epoch;
  while (live() && availableActions(game).length) {
    await untilResumed(() => !live()); // A turn skipped during a pause stays on the stage until Continue.
    if (!live() || !(await takeTurn())) break;
    await playbackDone();
    if (stopEachTurn()) break;
  }
  if (loopEpoch === epoch) { running = false; setPaused(false); }
  render();
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
    status = /network|fetch|cache/i.test(error.message) ? `The model download was interrupted by a network error. Check the connection and load it again${MANUAL_SANDBOX ? ', or play manually' : ''}.` : `Model could not load: ${error.message}`;
    hasError = true;
    $('model-settings').open = true;
  } finally { loading = false; $('load-progress').hidden = true; render(); }
}
function setMode(next) {
  if (loading || next === mode || (next === 'manual' && !MANUAL_SANDBOX)) return;
  stopRun();
  mode = next;
  hasError = false;
  status = mode === 'manual' ? 'Manual sandbox: choose actions under the stage. Your orders are not read.'
    : mode === 'random' ? 'Random hero selected. No model needed: press Run at random.'
    : model.ready ? 'Local LLM selected. Run your orders.' : 'Local LLM selected. Load the model, then run your orders.';
  render();
}

$('load-model').addEventListener('click', loadModel);
$('load-cta').addEventListener('click', loadModel);
$('manual-cta').addEventListener('click', () => setMode('manual'));
$('check-device').addEventListener('click', checkHardware);
$('gpu-memory').addEventListener('change', render);
$('temperature').addEventListener('input', () => {
  temperature = readTemperature($('temperature').value);
  store('pmlq.temperature', String(temperature));
  render();
});
$('use-recommendation').addEventListener('click', () => {
  if (!recommendation?.model || $('use-recommendation').disabled) return;
  $('model').value = recommendation.model.id;
  $('model').dispatchEvent(new Event('change'));
});
$('run').addEventListener('click', run);
$('reset').addEventListener('click', reset);
$('skip').addEventListener('click', skipPlayback);
$('pace').addEventListener('click', () => {
  pace = PACE_ORDER[(PACE_ORDER.indexOf(pace) + 1) % PACE_ORDER.length];
  store('pmlq.runPace', pace);
  render();
});
$('sound').addEventListener('click', () => {
  soundOn = !soundOn;
  store('pmlq.sound', soundOn ? 'on' : 'off');
  setSoundEnabled(soundOn);
  if (soundOn) setTimeout(() => playSound('choose'), 120); // A sample, so the player hears what was switched on.
  render();
});
$('music').addEventListener('click', () => {
  musicOn = !musicOn;
  store('pmlq.music', musicOn ? 'on' : 'off');
  setMusicEnabled(musicOn);
  render();
});
// The music starts on the first gesture, except a press of its own switch: switching it off should not first start it.
for (const type of ['pointerdown', 'keydown']) $('music').addEventListener(type, event => event.stopPropagation());
// Browsers allow audio only after a gesture.
document.addEventListener('pointerdown', unlockSound);
document.addEventListener('keydown', unlockSound);
document.addEventListener('pointerdown', unlockMusic);
document.addEventListener('keydown', unlockMusic);
$('orders').addEventListener('input', saveOrders);
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
document.querySelectorAll('[data-level]').forEach(tab => tab.addEventListener('click', () => setLevel(tab.dataset.level)));
$('model').addEventListener('change', () => { stopRun(); model.dispose(); $('model-status').textContent = 'Selected a new model. Load it to continue.'; status = 'Model changed. Load it to continue.'; hasError = false; render(); });
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { $('orders').value = presets()[button.dataset.preset]; saveOrders(); reset(); }));
$('next-level').addEventListener('click', () => { if (nextLevel(level)) setLevel(nextLevel(level)); });
$('options').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button && mode === 'manual' && !deciding() && !playback) { commit(button.dataset.action, 'manual'); render(); }
});
$('peek').addEventListener('click', event => { event.preventDefault(); $('orders-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('orders').focus({ preventScroll: true }); });
$('help-toggle').addEventListener('click', () => $('help').showModal());
$('help-close').addEventListener('click', () => $('help').close());
$('help').addEventListener('click', event => { if (event.target === $('help')) $('help').close(); });
$('export').addEventListener('click', () => {
  const report = { title: 'Per My Last ReQuest', controller: mode, model: model.model || null, temperature: runTemperature, promptVersion, orders: runOrders || $('orders').value, result: game.status, state: game, lastDecision };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'per-my-last-request-report.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
compactMap.addEventListener('change', render);
window.addEventListener('beforeunload', () => model.dispose());
// Small debugging surface for browser smoke tests, screenshots and reproducible reports.
// `setPace('instant')` turns playback off for tools and keeps the pace's stopping rule (any other pace turns it back on); `hold(n)` stops playback on beat n, `hold(null)` releases it;
// `setReadAhead(n)` limits how many decisions the model prepares ahead (0: none, as a test of plain waiting).
window.QuestDemo = {
  countTokens: text => model.countTokens(text),
  snapshot: () => structuredClone({ game, mode, level, running, paused, stopEachTurn: stopEachTurn(), reviewing: reviewing ? reviewing.entry.turn : null, prepared: [...prepared.values()].filter(entry => entry.promise.settled).length, thinking: deciding(), phase, playing: Boolean(playback), beat: playback ? playback.index : null, beatKinds: playback ? playback.beats.map(beat => beat.kind) : null, awaitingModel, modelBusy: modelBusy > 0, pace, instant, sound: soundOn, music: musicState(), modelReady: model.ready, temperature, runTemperature, status, lastDecision, orders: runOrders, device, checkingDevice, recommendation: recommendation?.model?.id || null }),
  loadModel,
  setPace: name => { if (name === 'instant') instant = true; else if (PACES[name]) { pace = name; instant = false; } render(); },
  hold: beat => { holdAt = Number.isInteger(beat) ? beat : null; },
  skip: skipPlayback,
  setReadAhead: depth => { readAheadDepth = Math.max(0, Math.floor(Number(depth)) || 0); },
};
render();
checkHardware();

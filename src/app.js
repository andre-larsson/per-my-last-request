import { newGame, availableActions, applyAction, observation, PRESETS, TUTORIAL_PRESETS, LOW_HP } from './game.js';
import { parseDecision, decisionMessages } from './protocol.js';
import { LocalModel } from './model.js';
import { renderMap } from './map.js';
import { MODELS, findModel, modelSize, checkDevice, recommendModel, selectedModelAdvice } from './models.js';
import { escapeHtml, artUrl, objectiveSteps, sceneFor, lastMoveHtml, journalHtml, verdictFor, verdictHtml, ordersSize, turnBeats, displayAt, turnFeedHtml, shoutFor, PACES, PACE_ORDER, BEAT_MS } from './view.js';
import { unlockSound, setSoundEnabled, playSound } from './sound.js';

const $ = id => document.getElementById(id);

let level = 'tutorial';
let game = newGame(level);
let epoch = 0;
let running = false;
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
let tokenCount = null; // { text, model, tokens } counted by the loaded model's tokenizer.
let countKey = null;
let countTimer = null;
let setupShownFor = null; // The device check result that last opened the WebGPU guide.
let recommendation = null;
let mapShownAt = null; // The stop the map last showed, so the marker can walk instead of jump.
const painted = {}; // Keys of the last paint per region. Unchanged regions keep their DOM, and so their animations.
// Turn flow. The engine resolves a turn at once (`game`); the stage then plays it back beat by beat (`playback`).
// While a run is going, the model already reads the next turn during that playback (`lookahead`).
let phase = 'idle'; // 'consider': the options are up and the hero is visibly weighing them.
let playback = null;
let lookahead = null; // { key, promise } for the decision being prepared.
let workerQueue = Promise.resolve(); // The worker answers one request at a time, so requests queue here.
let modelBusy = 0;
let awaitingModel = false; // The options have been up long enough, and the model still has not answered.
let holdAt = null; // Debug and screenshot aid: playback stops advancing once it reaches this beat.
let decisionSeconds = new Map(); // Turn number → model seconds, for this trial.
let warnedAt = '';
const stored = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Storage may be unavailable in private browser contexts. */ } };
let pace = PACES[stored('pmlq.pace', 'normal')] ? stored('pmlq.pace', 'normal') : 'normal';
let soundOn = stored('pmlq.sound', 'on') !== 'off';
if (!soundOn) setSoundEnabled(false); // Otherwise audio starts on the first click or key press, as browsers require.
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let epochSignal = deferred();
/** Invalidates every pending model reply and wakes anything waiting on one. */
function bumpEpoch() {
  epoch++;
  const signal = epochSignal;
  epochSignal = deferred();
  signal.resolve();
}
const paceFactor = () => pace === 'instant' ? 0 : PACES[pace] ?? 1;
/** What the stage shows: the turn being played back, or the engine's state once nothing is playing. */
const shown = () => playback?.display ?? game;
const deciding = () => phase === 'consider';

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
class Stale extends Error {}
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
  const busy = checkingDevice || loading || running || deciding();
  recommendation = recommendModel(device, gpuMemory());
  const suggested = recommendation?.model?.id === selected.id;
  $('check-device').disabled = busy;
  $('check-device').textContent = checkingDevice ? 'Checking…' : 'Check again';
  $('load-model').disabled = checkingDevice || loading || deciding() || running || model.ready;
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
  // Without usable WebGPU, open the browser setup guide once for that check result. The player can close it again.
  if (device && (!device.gpu || device.software) && setupShownFor !== device) {
    setupShownFor = device;
    $('webgpu-help').open = true;
  }
}
async function checkHardware() {
  if (checkingDevice || loading || running || deciding()) return;
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
  bumpEpoch();
  stopPlayback();
  running = false;
  phase = 'idle';
  awaitingModel = false;
  lookahead = null;
  game = newGame(level);
  runOrders = typedOrders();
  promptVersion++;
  lastDecision = null;
  decisionSeconds = new Map();
  mapShownAt = null;
  status = mode === 'manual' ? 'Fresh trial. Choose the first action under the stage.' : 'Fresh trial. Same course. Revised instructions.';
  hasError = false;
  render();
}
function setLevel(next) {
  if (running || phase === 'consider' || next === level) return;
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
  $('lap-badge').hidden = s.level !== 'circuit';
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
  const intent = scene.intent;
  $('foe-intent').hidden = !intent;
  if (intent) {
    $('foe-intent').className = `intent kind-${intent.kind}${acting ? ' acting' : ''}`;
    $('foe-intent').innerHTML = `<span class="intent-label">${acting ? 'Now' : 'Next move'}</span><span class="intent-tag">${escapeHtml(intent.tag)}</span>${intent.damage ? `<b class="intent-dmg">${intent.damage} dmg</b>` : ''}<span class="intent-name">${escapeHtml(intent.name)}</span>`;
    // A newly announced smash gets a low warning cue, once.
    const key = `${epoch}:${s.revision}`;
    if (intent.kind === 'smash' && warnedAt !== key) { warnedAt = key; playSound('warn', 0.35); }
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
    tab.disabled = running || deciding();
  });
  const steps = objectiveSteps(s);
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
  const left = s.turnLimit - s.turn;
  $('turn-value').textContent = `${s.turn} / ${s.turnLimit}`;
  $('turn-bar').style.width = `${s.turn / s.turnLimit * 100}%`;
  $('turn-left').textContent = left === 0 ? 'none left' : `${left} left`;
  $('deadline').className = `deadline${left <= Math.ceil(s.turnLimit / 4) ? ' urgent' : ''}`;
}
/** The exact prompt behind a decision: the one being made now, or, during playback, the one just made. */
function renderPrompt(state, actions) {
  const orders = runOrders || typedOrders() || '(no orders written)';
  const [system, user] = decisionMessages(orders, observation(state), actions);
  $('seen').hidden = actions.length === 1 && mode === 'llm';
  $('seen').querySelector('summary').textContent = mode === 'manual' ? (playback ? 'What an LLM hero would have been told' : 'What an LLM hero would be told this turn') : playback ? 'What the hero was told this turn' : 'What the hero is told this turn';
  $('seen-text').textContent = `${system.content}\n\n${user.content}`;
}
const CHOSE = { llm: 'The hero chose', manual: 'You chose', auto: 'No choice' };
function renderMoves(s) {
  const verdict = verdictFor(s);
  $('stage').className = `stage${verdict ? ` ended ${verdict.tone}` : ''}`;
  $('verdict').hidden = !verdict;
  paint('verdict', `${epoch}:${s.status}:${s.turn}`, () => { $('verdict').innerHTML = verdictHtml(verdict); });
  // The latest turn under the controls: the one playing, filling in beat by beat, or the last one finished.
  const moveState = playback ? playback.after : s;
  const last = moveState.log.at(-1);
  const upto = playback ? playback.index : Infinity;
  paint('lastMove', `${epoch}:${moveState.log.length}:${upto}`, () => {
    const fresh = painted.lastMoveTurn !== `${epoch}:${moveState.log.length}`;
    painted.lastMoveTurn = `${epoch}:${moveState.log.length}`;
    $('last-move').innerHTML = lastMoveHtml(moveState, last?.source === 'llm' ? decisionSeconds.get(last.turn) ?? null : null, { upto, fresh });
  });
  // The play-by-play takes the place of the situation text while a turn plays. The last one stays laid out,
  // invisible, so the box keeps its height and the controls under the stage do not jump from turn to turn.
  $('stage-foot').classList.toggle('playing', Boolean(playback));
  if (playback) {
    const { entry, offered, index } = playback;
    const seconds = entry.source === 'llm' ? decisionSeconds.get(entry.turn) ?? null : null;
    paint('feed', `${epoch}:${entry.turn}:${index}`, () => { $('turn-feed').innerHTML = turnFeedHtml(playback, seconds); });
    // The options stay on the table, with the one taken stamped and the rest set aside.
    $('options-wrap').hidden = false;
    $('options-wrap').className = 'options-wrap played';
    $('options-title').textContent = `${CHOSE[entry.source]}: ${entry.label}`;
    $('options').dataset.count = offered.length;
    paint('options', `played:${epoch}:${entry.turn}`, () => {
      $('options').innerHTML = offered.map(action => {
        const detail = action.detail === action.label ? '' : `<span>${escapeHtml(action.detail)}</span>`;
        const chosen = action.id === entry.action;
        return `<div class="option ${chosen ? 'chosen' : 'passed'}">${chosen ? '<em class="chosen-mark">Chosen</em>' : ''}<strong>${escapeHtml(action.label)}</strong>${detail}</div>`;
      }).join('');
    });
    renderPrompt(playback.before, offered);
    return;
  }
  const actions = availableActions(s);
  $('options-wrap').hidden = !actions.length;
  if (!actions.length) return;
  const forced = actions.length === 1;
  $('options-wrap').className = `options-wrap${deciding() ? ' thinking' : ''}`;
  $('options-title').textContent = mode === 'manual' ? 'Your move. Choose an action'
    : deciding() ? `The hero weighs ${actions.length} options…`
    : forced ? 'Only one way forward, so no decision is needed' : `The hero must choose one of ${actions.length}`;
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
function renderControls(s) {
  const terminal = !availableActions(s).length;
  const llm = mode === 'llm';
  const selected = findModel($('model').value);
  const won = s.status === 'won';
  $('load-cta').hidden = !llm || model.ready;
  $('load-cta').disabled = loading || checkingDevice;
  $('load-cta').innerHTML = loading ? `Loading model… ${Math.round(loadProgress * 100)}% ` : `<span>Load <span class="wide-only">${escapeHtml(selected.name)}</span><span class="narrow-only">model</span></span> <small>${modelSize(selected.downloadGB)}<span class="wide-only"> download</span></small><span aria-hidden="true">↓</span>`;
  $('cta-progress').hidden = !loading;
  $('manual-cta').hidden = !llm || model.ready || loading;
  // A GPU model on a device without usable WebGPU would only fail to load. Say so before the click.
  const blocked = llm && !model.ready && !loading && !hasError && device && (!device.gpu || device.software) && selected.backend !== 'CPU';
  $('run').hidden = !llm || !model.ready;
  // Outside a run, a turn still playing finishes (or is skipped) before the next one can start.
  $('run').disabled = !running && (deciding() || Boolean(playback));
  $('run').innerHTML = running ? 'Pause <span aria-hidden="true">Ⅱ</span>'
    : terminal ? 'Run again <span aria-hidden="true">↻</span>'
    : s.turn > 0 ? 'Continue <span aria-hidden="true">→</span>' : 'Run these orders <span aria-hidden="true">→</span>';
  $('next-level').hidden = !(won && s.level === 'tutorial');
  $('run').className = $('next-level').hidden ? 'primary' : 'secondary';
  $('step').hidden = !llm || !model.ready;
  $('step').disabled = running || deciding() || Boolean(playback) || terminal;
  $('reset').hidden = game.turn === 0; // Nothing to restart yet.
  $('reset').textContent = terminal && !llm ? 'Try again ↻' : 'Restart';
  $('reset').className = terminal && !llm && $('next-level').hidden ? 'primary' : 'ghost';
  $('run-status').textContent = deciding() ? (awaitingModel ? 'The hero is still reading your orders… The model is thinking. Game time is paused.' : 'The hero is reading your orders… Game time is paused.')
    : blocked ? 'This browser cannot run the selected GPU model. See “Get WebGPU” under “Who plays the hero?”, use the CPU suggestion there, or play manually.'
    : s.status === 'won' ? 'Success. Your orders got the hero home.'
    : s.status === 'lost' ? 'Trial over. Read the report, change the orders, and run again.'
    : status;
  $('run-status').className = `run-status${hasError ? ' error' : ''}${deciding() ? ' busy' : ''}`;
  // With nothing but Restart to offer, the bar shrinks to one line so it covers less of a small screen.
  $('controls').className = `controls${!llm && !terminal ? ' compact' : ''}`;
  $('pace').innerHTML = `<span class="wide-only">Pace: </span>${pace[0].toUpperCase()}${pace.slice(1)}`;
  $('pace').setAttribute('aria-label', `Playback pace: ${pace}. Change`);
  $('sound').setAttribute('aria-pressed', String(soundOn));
  $('sound').innerHTML = `<span aria-hidden="true">♪</span> ${soundOn ? 'On' : 'Off'}`;
  $('sound').setAttribute('aria-label', `Sound effects ${soundOn ? 'on' : 'off'}`);
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
  const changed = mode === 'llm' && game.turn > 0 && typedOrders() !== runOrders;
  $('orders').disabled = running || deciding();
  $('orders-notice').hidden = !changed;
  // Size only. Tokens are exact once the loaded model has counted this text, and an estimate before that.
  const counted = model.ready && tokenCount?.model === model.model ? { ...tokenCount, by: findModel(tokenCount.model).name } : null;
  const size = ordersSize(typedOrders(), counted);
  // Words over tokens, two lines like the signature beside them. The hidden separator keeps the text readable as one line.
  $('orders-size').innerHTML = size.label.split(' · ').map(escapeHtml).join('<span class="sr-only"> · </span><br>');
  $('orders-size').title = size.note;
  countOrderTokens();
  $('peek-text').textContent = (game.turn > 0 && runOrders) || typedOrders() || 'No orders written.';
  document.querySelectorAll('[data-preset]').forEach(button => { button.disabled = running || deciding(); });
}
function renderController() {
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    button.disabled = loading;
  });
  $('model').disabled = loading || running || deciding();
  $('load-model').textContent = loading ? 'Loading model…' : model.ready ? 'Model ready ✓' : 'Load local model ↓';
  $('model-options').hidden = mode === 'manual';
  $('manual-note').hidden = mode !== 'manual';
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
    $('map').setAttribute('aria-label', `Training circuit. Hero at ${sceneFor(s).name}. ${s.stamps.length} of ${s.level === 'tutorial' ? 1 : 3} stamps collected.`);
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
}

/** One beat's sounds, floating numbers and screen-reader line. The stage itself is drawn by render(). */
function showBeat(beat, entry) {
  beat.sounds.forEach((name, i) => playSound(name, i * 0.16));
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
 * Restart, a level or mode change, or Skip ends it early. Pause lets it finish.
 */
function startPlayback(before, after) {
  stopPlayback();
  const factor = paceFactor();
  if (!factor) { render(); return; } // Instant pace, for tools: no playback at all.
  const entry = after.log.at(-1);
  const beats = turnBeats(before, entry);
  const pb = { before, after, entry, beats, offered: availableActions(before), index: 0, display: before, skip: false, wake: deferred(), done: deferred() };
  playback = pb;
  (async () => {
    for (let i = 0; i < beats.length && playback === pb && !pb.skip; i++) {
      pb.index = i;
      pb.display = displayAt(before, after, beats, i);
      render();
      showBeat(beats[i], entry);
      await Promise.race([delay(beats[i].ms * factor), pb.wake.promise]);
      while (holdAt !== null && i >= holdAt && playback === pb && !pb.skip) await delay(50);
    }
    if (playback === pb) { playback = null; render(); }
    pb.done.resolve();
  })();
}
function stopPlayback() {
  const pb = playback;
  if (!pb) return;
  playback = null;
  pb.skip = true;
  pb.wake.resolve();
}
function skipPlayback() {
  if (!playback) return;
  playback.skip = true;
  playback.wake.resolve();
}
const playbackDone = () => playback ? playback.done.promise : Promise.resolve();

function commit(actionId, source) {
  const before = game;
  game = applyAction(game, actionId, source);
  if (source === 'llm' && lastDecision) decisionSeconds.set(game.turn, lastDecision.elapsed / 1000);
  // Win and loss messages come from the state on screen, so the status line never gives away the end of a turn early.
  status = mode === 'manual' ? 'Manual sandbox: you are choosing the actions.'
    : source === 'auto' ? 'Only one action was possible, so the hero took it.'
    : `Decision made in ${lastDecision ? (lastDecision.elapsed / 1000).toFixed(1) : '?'} seconds.`;
  startPlayback(before, game);
  // While this turn plays out, the model can already read the next one.
  if (running && mode === 'llm') {
    const next = availableActions(game);
    if (next.length > 1) decisionFor(game, next);
  }
}
/**
 * The model's decision for `state`. A decision prepared during the previous turn's playback is reused if it was
 * asked for the same trial (epoch) and the same state (revision); anything else is a fresh request.
 * Requests queue, because the worker answers one at a time.
 */
function decisionFor(state, actions) {
  const key = `${epoch}:${state.revision}`;
  if (lookahead?.key === key) return lookahead.promise;
  const requestEpoch = epoch;
  const payload = { orders: runOrders, observation: observation(state), actions };
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
  promise.then(() => { promise.settled = true; }, () => { promise.settled = true; }); // Also keeps an unused rejection quiet.
  workerQueue = promise;
  lookahead = { key, promise };
  return promise;
}
function prepareOrders() {
  if (!runOrders || game.turn === 0) runOrders = typedOrders();
  if (runOrders) return true;
  status = 'Write some standing orders first.';
  hasError = true;
  render();
  return false;
}
/**
 * One turn in LLM mode. The options stay up for a moment while the hero weighs them, then the choice is revealed and
 * played back. A model or parsing failure ends the run and spends no turn; a stale reply is dropped.
 */
async function takeTurn() {
  if (!prepareOrders()) return false;
  const actions = availableActions(game);
  if (!actions.length) return false;
  // Forced movement needs no inference. The model is called whenever a real choice exists.
  if (actions.length === 1) { commit(actions[0].id, 'auto'); return true; }
  const requestEpoch = epoch;
  const revision = game.revision;
  const pending = decisionFor(game, actions);
  const preparedAhead = pending.settled;
  const interrupted = epochSignal.promise.then(() => null);
  phase = 'consider';
  hasError = false;
  render();
  let decision = null;
  try {
    await Promise.race([delay(BEAT_MS.consider * paceFactor()), interrupted]);
    if (requestEpoch !== epoch) return false;
    const waitFrom = performance.now();
    if (!pending.settled) { awaitingModel = true; render(); }
    decision = await Promise.race([pending, interrupted]);
    // How long the player actually watched the model think, beyond the time the options are always shown.
    if (decision) decision = { ...decision, preparedAhead, waitedMs: Math.round(performance.now() - waitFrom) };
  } catch (error) {
    if (requestEpoch === epoch && !(error instanceof Stale)) { running = false; hasError = true; status = `${error.message} No turn was spent. You can retry or use Manual sandbox.`; }
    return false;
  } finally {
    phase = 'idle';
    awaitingModel = false;
    render();
  }
  if (!decision || requestEpoch !== epoch || revision !== game.revision) return false;
  lastDecision = decision;
  commit(decision.action, 'llm');
  return true;
}
/** A finished trial, or orders edited mid-trial, both mean the next decision starts a fresh trial. */
function restartIfStale() {
  if (!availableActions(game).length || (game.turn > 0 && typedOrders() !== runOrders)) reset();
}
async function run() {
  // Pause drops any decision in flight or prepared, and lets the turn on screen finish.
  if (running) { running = false; bumpEpoch(); status = 'Paused. Read the report, or continue the expedition.'; render(); return; }
  if (deciding() || playback || !model.ready || mode !== 'llm') return;
  restartIfStale();
  running = true;
  hasError = false;
  render();
  const loopEpoch = epoch;
  while (running && loopEpoch === epoch) {
    await playbackDone();
    if (!running || loopEpoch !== epoch || !availableActions(game).length) break;
    if (!(await takeTurn())) break;
  }
  if (loopEpoch === epoch) running = false;
  render();
}
async function step() {
  if (running || deciding() || playback || !model.ready || mode !== 'llm') return;
  restartIfStale();
  await takeTurn();
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
    status = /network|fetch|cache/i.test(error.message) ? 'The model download was interrupted by a network error. Check the connection and load it again, or play manually.' : `Model could not load: ${error.message}`;
    hasError = true;
    $('model-settings').open = true;
  } finally { loading = false; $('load-progress').hidden = true; render(); }
}
function setMode(next) {
  if (loading || next === mode) return;
  bumpEpoch();
  stopPlayback();
  running = false;
  phase = 'idle';
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
$('skip').addEventListener('click', skipPlayback);
$('pace').addEventListener('click', () => {
  pace = PACE_ORDER[(PACE_ORDER.indexOf(pace) + 1) % PACE_ORDER.length];
  store('pmlq.pace', pace);
  render();
});
$('sound').addEventListener('click', () => {
  soundOn = !soundOn;
  store('pmlq.sound', soundOn ? 'on' : 'off');
  setSoundEnabled(soundOn);
  if (soundOn) setTimeout(() => playSound('choose'), 120); // A sample, so the player hears what was switched on.
  render();
});
// Browsers allow audio only after a gesture.
document.addEventListener('pointerdown', unlockSound);
document.addEventListener('keydown', unlockSound);
$('orders').addEventListener('input', saveOrders);
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
document.querySelectorAll('[data-level]').forEach(tab => tab.addEventListener('click', () => setLevel(tab.dataset.level)));
$('model').addEventListener('change', () => { bumpEpoch(); running = false; lookahead = null; model.dispose(); $('model-status').textContent = 'Selected a new model. Load it to continue.'; status = 'Model changed. Load it to continue.'; hasError = false; render(); });
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { $('orders').value = presets()[button.dataset.preset]; saveOrders(); reset(); }));
$('next-level').addEventListener('click', () => setLevel('circuit'));
$('options').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button && mode === 'manual' && !deciding() && !playback) { commit(button.dataset.action, 'manual'); render(); }
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
// Small debugging surface for browser smoke tests, screenshots and reproducible reports.
// `setPace('instant')` turns playback off for tools; `hold(n)` stops playback on beat n, `hold(null)` releases it.
window.QuestDemo = {
  countTokens: text => model.countTokens(text),
  snapshot: () => structuredClone({ game, mode, level, running, thinking: deciding(), phase, playing: Boolean(playback), beat: playback ? playback.index : null, beatKinds: playback ? playback.beats.map(beat => beat.kind) : null, awaitingModel, modelBusy: modelBusy > 0, pace, sound: soundOn, modelReady: model.ready, status, lastDecision, orders: runOrders, device, checkingDevice, recommendation: recommendation?.model?.id || null }),
  loadModel, step,
  setPace: name => { if (name === 'instant' || PACES[name]) { pace = name; render(); } },
  hold: beat => { holdAt = Number.isInteger(beat) ? beat : null; },
  skip: skipPlayback,
};
render();
checkHardware();

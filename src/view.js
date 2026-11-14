// Pure presentation helpers. They read game state and return plain data or HTML strings.
// Rules and outcomes stay in game.js; nothing here changes a game.
import { TILES, LEVELS, levelOf, nextLevel, currentTile, assignmentReady, nextMove, guardBlock, counterDamage, commendations, PRICES, SWORD_BONUS, BUCKLER_BLOCK, BENCH_HP, MEDIC_HP, LOW_HP } from './game.js';

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One portrait per stop, in circuit order. Files live in assets/art/<name>.webp.
export const TILE_ART = ['camp', 'rat', 'noticeboard', 'boar', 'purse', 'bruiser', 'medic', 'quickfoot', 'armorer', 'bench', 'champion', 'road'];
export const artUrl = name => `./assets/art/${name}.webp`;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const stampTarget = game => levelOf(game).stamps.length;

/** The assignment as an ordered checklist. Exactly one unfinished step is marked `next`. */
export function objectiveSteps(game) {
  const rules = levelOf(game);
  const steps = TILES.filter(tile => tile.stamp && rules.stamps.includes(tile.stamp))
    .map(tile => ({ kind: 'stamp', label: tile.name, art: TILE_ART[TILES.indexOf(tile)], done: game.stamps.includes(tile.stamp) }));
  if (rules.champion) steps.push({ kind: 'champion', label: 'Champion', art: 'champion', done: game.champion });
  steps.push({ kind: 'home', label: 'Submit at camp', art: 'camp', done: game.status === 'won' });
  // Stamps can be earned in any order, so only the final steps wait for the earlier ones.
  const next = steps.find(step => !step.done);
  return steps.map(step => ({ ...step, next: step === next }));
}

/** The opponent's announced move this turn, in the words the hero is told. */
export function intentFor(game) {
  const e = game.enemy;
  const m = nextMove(e);
  if (!m) return null;
  const block = guardBlock(game);
  if (m.kind === 'smash') return { kind: m.kind, tag: 'Smash', name: m.name, damage: m.damage, note: `Guard blocks ${Math.min(block, m.damage)} of it and counters for ${counterDamage(game)}.` };
  if (m.kind === 'brace') return { kind: m.kind, tag: 'Bracing', name: m.name, damage: 0, note: 'No damage this turn. Strikes deal half.' };
  if (m.kind === 'winded') return { kind: m.kind, tag: 'Winded', name: m.name, damage: 0, note: e.agile ? 'No damage this turn, and it cannot dodge a heavy strike.' : 'No damage this turn. A free swing, or a safe moment for a potion.' };
  return { kind: m.kind, tag: 'Strike', name: m.name, damage: m.damage, note: `An ordinary hit. Guard would block ${Math.min(block, m.damage)}.` };
}

// What camp says before each assignment starts: the goal, and what is new.
const BRIEFS = {
  tutorial: () => 'First assignment: defeat the practice rat for its stamp, then return here and submit, all within 12 turns.',
  warning: game => `Three stamps and a safe return within ${game.turnLimit} turns. New: every opponent announces its next move, and the hero can guard.`,
  prize: game => `The circuit's second half: Quickfoot's stamp, the champion and a safe return within ${game.turnLimit} turns. New: coins, an optional prize fight, the medic, the armorer and a bench.`,
  circuit: game => `Three stamps, one champion and a safe return within ${game.turnLimit} turns. Every opponent announces its next move. The hero carries two potions and no enthusiasm.`,
};
// What the verdict suggests after winning each assignment.
const NEXT_HINTS = {
  tutorial: 'Next: Fair warning, where opponents announce their moves and the hero can guard.',
  warning: 'Next: Prize money, the circuit’s second half, with coins to earn and spend, and the champion.',
  prize: `Next: the full circuit, both halves in one trial against a ${LEVELS.circuit.turnLimit}-turn clock, with commendations to earn.`,
};

/** What the right-hand stage card shows: an opponent, or the place the hero is standing. */
export function sceneFor(game) {
  const tile = currentTile(game);
  const art = TILE_ART[game.position];
  const base = { art, name: tile.name, enemy: null, traits: [], mark: '' };
  if (game.enemy) {
    const e = game.enemy;
    // The introductory assignment has no announced moves: its rat simply hits back.
    const announced = levelOf(game).announced;
    const traits = announced ? [] : [{ label: `Hits for ${e.damage}`, note: 'after each strike or potion' }];
    if (e.armor) traits.push({ label: `Armor ${e.armor}`, note: `blocks ${e.armor} from every strike` });
    if (e.agile) traits.push({ label: 'Agile', note: announced ? 'a heavy strike deals only 3, unless it is winded' : 'a heavy strike deals only 3' });
    return {
      ...base,
      name: e.name,
      kicker: e.boss ? 'The champion' : e.optional ? 'Optional prize fight' : 'Stamp fight',
      enemy: { hp: e.hp, maxHp: e.maxHp ?? e.hp },
      traits,
      intent: announced ? intentFor(game) : null,
      text: e.boss ? 'Defeat the champion, then get back to camp. Retreating costs 2 HP and leaves the champion standing.'
        : e.optional ? `Not required. Winning pays ${e.prize ?? 2} coins; retreating costs 2 HP.`
        : 'Defeat it to earn a required stamp. Retreating costs 2 HP and earns nothing.',
    };
  }
  if (game.resolved && tile.kind === 'enemy') {
    const left = game.log.at(-1)?.action === 'retreat';
    return { ...base, kicker: 'Fight over', mark: left ? 'Left behind' : 'Defeated', text: left ? `The hero walked away from ${tile.name}. No reward was earned here.` : `${tile.name} is beaten. The path onward is clear.` };
  }
  if (tile.kind === 'camp') {
    const text = assignmentReady(game) ? 'Every requirement is met. All that remains is to submit the assignment.'
      : game.turn > 0 ? 'Back at camp with the assignment unfinished. Another lap is possible, but every opponent grows stronger.'
      : BRIEFS[game.level]?.(game) ?? BRIEFS.circuit(game);
    return { ...base, kicker: 'Start and finish', text };
  }
  if (tile.kind === 'medic') return { ...base, kicker: 'Service', traits: game.medicUsed ? [] : [{ label: `+${MEDIC_HP} HP`, note: 'free, once per trial, takes a turn' }], text: game.medicUsed ? 'The medic has already treated the hero this trial.' : 'One free treatment. Walking past saves a turn.' };
  if (tile.kind === 'shop') {
    const stock = [];
    if (!game.sword) stock.push({ label: `Sword · ${PRICES.sword} coins`, note: `+${SWORD_BONUS} damage on every strike` });
    if (!game.buckler) stock.push({ label: `Buckler · ${PRICES.buckler} coins`, note: `guard blocks ${BUCKLER_BLOCK} more` });
    stock.push({ label: `Potion · ${PRICES.potion} coins`, note: 'one more potion' });
    const cheapest = Math.min(...stock.map(item => Number(item.label.match(/\d+/)[0])));
    return { ...base, kicker: 'Service', traits: stock, text: `${game.coins >= cheapest ? `The hero has ${game.coins} coins to spend.` : `The hero has ${game.coins} coins, not enough for anything here.`} Each purchase takes a turn.` };
  }
  if (tile.kind === 'bench') return { ...base, kicker: 'Rest stop', traits: game.benchUsed ? [] : [{ label: `Full stamina, +${BENCH_HP} HP`, note: 'once per lap, takes a turn' }], text: game.benchUsed ? 'The hero has already rested here this lap.' : 'A place to catch a breath before the champion.' };
  if (tile.kind === 'purse') return { ...base, kicker: 'Payday', text: `Six guild coins, collected on arrival. The armorer further along sells a sword or a buckler for ${PRICES.sword}, and potions for ${PRICES.potion}. The prize bruiser next door pays well.` };
  if (tile.kind === 'enemy') return { ...base, kicker: 'Empty arena', text: 'The champion is already beaten. Nothing left to fight here.' };
  return { ...base, kicker: 'On the road', text: 'The path continues. Walking takes a turn and restores 1 stamina.' };
}

/** Signed changes to the hero caused by one logged action. */
export function deltas(entry) {
  const out = [];
  const add = (key, unit) => {
    const change = (entry.after[key] ?? 0) - (entry.before[key] ?? 0);
    if (change) out.push({ key, change, text: `${change > 0 ? '+' : '−'}${Math.abs(change)} ${Math.abs(change) === 1 ? unit.replace(/s$/, '') : unit}`, good: change > 0 });
  };
  add('hp', 'HP');
  add('stamina', 'stamina');
  add('potions', 'potions');
  add('coins', 'coins');
  add('stamps', 'stamps');
  return out;
}
const chips = entry => deltas(entry).map(d => `<span class="chip ${d.good ? 'gain' : 'loss'}">${escapeHtml(d.text)}</span>`).join('');

export const SOURCE_LABEL = { llm: 'LLM chose', auto: 'No choice', manual: 'You chose' };
const sourceLabel = source => SOURCE_LABEL[source] || source;

// ---------------------------------------------------------------------------
// Turn playback. The engine resolves a turn at once; the interface then shows it as a few beats:
// the decision first, then each event in the order the engine resolved it. The model can already
// work on the next turn while these play, so its thinking time is mostly hidden behind them.

/**
 * Paces, in the order the Pace button cycles through them. `speed` multiplies the beat durations below.
 * "Turn by turn" plays each turn at normal speed and then stops until the player asks for the next one.
 */
export const PACES = {
  step: { label: 'Turn by turn', speed: 1, stops: true, note: 'Plays one turn, then waits for Next turn.' },
  normal: { label: 'Normal', speed: 1, stops: false, note: 'Plays turn after turn until you pause.' },
  fast: { label: 'Fast', speed: 0.5, stops: false, note: 'Plays turn after turn at double speed.' },
};
export const PACE_ORDER = ['step', 'normal', 'fast'];
/** Beat durations at normal pace, in milliseconds. `consider` is the least time the options stay up before a model's choice is revealed. */
export const BEAT_MS = { consider: 1400, choice: 1100, own: 600, event: 750, perWord: 45, big: 1300 };

// The events after which the stage shows the new situation (a new stop, a beaten or abandoned opponent, an ended trial).
const SCENE_CHANGES = new Set(['enter', 'coins', 'camp', 'defeat', 'retreat', 'lost', 'timeout', 'finish']);
const BIG_MOMENTS = new Set(['defeat', 'stamp', 'champion', 'lost', 'timeout', 'finish']);
const WALKS = new Set(['advance', 'depart']);
// What the hero says while a turn plays out. Short, so it fits a speech bubble on the portrait.
const SHOUTS = { quick: 'Quick strike!', heavy: 'Heavy strike!', guard: 'Guard!', potion: 'Potion.', retreat: 'Retreat!', advance: 'Onward.', depart: 'Onward.', medic: 'Medic!', buy_sword: 'Sword, please.', buy_buckler: 'Buckler, please.', buy_potion: 'Potion, please.', rest: 'Sitting down.', finish: 'Done. Pay me.' };
export const shoutFor = action => SHOUTS[action] || 'Right.';

function soundsFor(event) {
  switch (event.kind) {
    case 'strike': return [event.style === 'heavy' ? 'heavy' : 'strike'];
    case 'foe-hit': return ['hurt'];
    case 'foe-blocked': return ['block'];
    case 'foe-idle': return ['idle'];
    case 'champion': return ['stamp'];
    case 'buy': return ['coins'];
    case 'rest': return ['heal'];
    case 'timeout': return ['lost'];
    case 'finish': return ['won'];
    default: return [event.kind];
  }
}
const snapshot = s => ({ hp: s.hp, stamina: s.stamina, potions: s.potions, coins: s.coins, stamps: [...s.stamps], champion: s.champion, foeHp: s.enemy ? s.enemy.hp : null });
/** Floating numbers for one beat: what changed on each card since the beat before. */
function effects(prev, at, kind) {
  const fx = [];
  const hp = at.hp - prev.hp;
  if (hp) fx.push({ card: 'hero', tone: hp < 0 ? 'loss' : 'gain', text: `${hp < 0 ? '−' : '+'}${Math.abs(hp)}` });
  if (prev.foeHp !== null && at.foeHp !== null && at.foeHp < prev.foeHp) fx.push({ card: 'foe', tone: 'loss', text: `${kind === 'counter' ? 'Counter ' : ''}−${prev.foeHp - at.foeHp}` });
  const coins = at.coins - prev.coins;
  if (coins) fx.push({ card: 'hero', tone: 'coin', text: `${coins > 0 ? '+' : '−'}${Math.abs(coins)} coins` });
  return fx;
}

/**
 * One resolved turn as beats. `before` is the state the decision was made in; `entry` is the log entry it produced.
 * Each beat says who acts, what to print, which cue to play, what floats up from the cards, and how long it holds.
 */
export function turnBeats(before, entry) {
  const start = snapshot(before);
  const own = entry.source === 'manual' || entry.source === 'auto';
  const walking = WALKS.has(entry.action);
  const beats = [{
    kind: 'choice', actor: 'hero', text: entry.label, source: entry.source, action: entry.action,
    sounds: entry.source === 'auto' ? [walking ? 'walk' : 'choose'] : walking ? ['choose', 'walk'] : ['choose'],
    ms: own ? BEAT_MS.own : BEAT_MS.choice, scene: false, at: start, fx: [],
  }];
  let prev = start;
  let foeArt = before.enemy ? TILE_ART[before.position] : null;
  for (const event of entry.events || []) {
    const words = event.text.split(/\s+/).length;
    if (event.kind === 'enter') foeArt = TILE_ART[event.position];
    beats.push({
      kind: event.kind, actor: event.actor, text: event.text, sounds: soundsFor(event),
      ms: BIG_MOMENTS.has(event.kind) ? BEAT_MS.big : BEAT_MS.event + BEAT_MS.perWord * words,
      scene: SCENE_CHANGES.has(event.kind), at: event.at, fx: effects(prev, event.at, event.kind),
      art: event.actor === 'hero' ? 'hero' : event.actor === 'foe' || event.kind === 'enter' || event.kind === 'defeat' ? foeArt : null,
    });
    prev = event.at;
  }
  return beats;
}

/**
 * The state the stage shows at beat `index`: the old situation with the numbers as they stood at that beat,
 * or the new situation once the scene has changed. The last beat always shows the engine's final state.
 */
export function displayAt(before, after, beats, index) {
  if (index >= beats.length - 1) return after;
  const base = beats.slice(1, index + 1).some(beat => beat.scene) ? after : before;
  const at = beats[index].at;
  return { ...base, turn: after.turn, hp: at.hp, stamina: at.stamina, potions: at.potions, coins: at.coins, stamps: at.stamps, champion: at.champion, enemy: base.enemy && { ...base.enemy, hp: at.foeHp ?? base.enemy.hp } };
}

const CHOSE = { llm: 'The hero chose', manual: 'You chose', auto: 'No choice' };
/**
 * The play-by-play under the fighters. Every line is laid out from the start, so the box keeps its height while lines
 * appear. `index` is the beat on screen; `Infinity` shows the whole turn at rest, as kept for review at a stop.
 */
export function turnFeedHtml({ entry, beats, offered, index }, seconds = null) {
  const passed = offered.filter(action => action.id !== entry.action);
  const timing = entry.source === 'llm' && seconds !== null ? ` · ${seconds.toFixed(1)} s` : '';
  const head = `<p class="feed-head"><span>Turn ${entry.turn} · ${CHOSE[entry.source] || entry.source}${timing}</span></p>`;
  const choice = `<p class="feed-choice${index === 0 ? ' now' : ''}"><strong>${escapeHtml(entry.label)}</strong>${passed.length ? `<span class="feed-passed"><span>instead of</span>${passed.map(action => `<s>${escapeHtml(action.label)}</s>`).join('')}</span>` : ''}</p>`;
  const lines = beats.slice(1).map((beat, i) => {
    const state = i + 1 < index ? ' shown' : i + 1 === index ? ' shown now' : '';
    const face = beat.art ? `<img src="${artUrl(beat.art)}" alt="" onerror="this.remove()">` : beat.actor === 'world' ? '<b aria-hidden="true">★</b>' : '';
    return `<li class="beat actor-${beat.actor}${state}"><span class="face" aria-hidden="true">${face}</span><span>${escapeHtml(beat.text)}</span></li>`;
  }).join('');
  return `${head}${choice}${lines ? `<ol class="feed-beats">${lines}</ol>` : ''}`;
}

export function journalHtml(log) {
  if (!log.length) return '<li class="empty-log">Nothing to report yet. An unusually promising start.</li>';
  return log.slice().reverse().map(entry => {
    const tone = entry.after.hp < entry.before.hp ? 'bad' : entry.after.stamps > entry.before.stamps ? 'good' : 'plain';
    return `<li class="log-entry tone-${tone}"><span class="log-turn">${entry.turn}</span><div class="log-body"><p class="log-title">${escapeHtml(entry.label)} <span class="log-at">at ${escapeHtml(entry.at)}</span></p><p class="log-detail">${escapeHtml(entry.detail)}</p><p class="chips">${chips(entry)}<span class="chip quiet">${entry.after.hp} HP</span><span class="log-source src-${escapeHtml(entry.source)}">${escapeHtml(sourceLabel(entry.source))}</span></p></div></li>`;
  }).join('');
}

/** How often each action was taken, most frequent first. A reading aid for the post-mortem. */
export function actionTally(log) {
  const counts = new Map();
  for (const entry of log) counts.set(entry.label, (counts.get(entry.label) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

/** The end-of-trial summary, or null while the trial is still open. */
export function verdictFor(game) {
  if (game.status !== 'won' && game.status !== 'lost') return null;
  const tally = actionTally(game.log);
  if (game.status === 'won') {
    const medals = commendations(game);
    const missed = medals.filter(m => !m.earned);
    const hint = nextLevel(game.level) ? NEXT_HINTS[game.level]
      : !missed.length ? 'Every commendation in one trial. The guild suspects paperwork fraud.'
      : `Different orders earn different commendations. Still unclaimed: ${missed.map(m => `${m.label} (${m.rule.replace(/\.$/, '').toLowerCase()})`).join('; ')}.`;
    return { tone: 'won', stamp: 'Accepted', title: 'Assignment accepted.', text: `Home in ${plural(game.turn, 'turn')} with ${game.hp} HP and ${plural(game.potions, 'potion')} to spare. The hero would like to discuss the fee.`, hint, tally, commendations: medals };
  }
  const missing = [];
  const target = stampTarget(game);
  if (game.stamps.length < target) missing.push(`${game.stamps.length} of ${plural(target, 'stamp')} earned`);
  if (levelOf(game).champion && !game.champion) missing.push('champion undefeated');
  if (!missing.length) missing.push('assignment never submitted at camp');
  const dead = game.hp === 0;
  return {
    tone: 'lost',
    stamp: dead ? 'Incident' : 'Overdue',
    title: dead ? 'A preventable workplace incident.' : 'The guild has closed for the day.',
    text: dead ? `The hero ran out of health on turn ${game.turn}, at ${currentTile(game).name}. ${missing.join(', ')}.` : `All ${game.turnLimit} turns used: ${missing.join(', ')}.`,
    hint: 'The hero did exactly what the orders said, and would like that noted. Change one instruction and run again.',
    tally,
    commendations: [],
  };
}
export function verdictHtml(verdict) {
  if (!verdict) return '';
  const tally = verdict.tally.slice(0, 4).map(t => `<span class="chip quiet">${escapeHtml(t.label)} ×${t.count}</span>`).join('');
  const medals = verdict.commendations?.length
    ? `<p class="commendations"><span class="section-label">Commendations ${verdict.commendations.filter(m => m.earned).length} of ${verdict.commendations.length}</span>${verdict.commendations.map(m => `<span class="medal${m.earned ? ' earned' : ''}"><span aria-hidden="true">${m.earned ? '★' : '☆'}</span> ${escapeHtml(m.label)}<span class="sr-only">${m.earned ? ' (earned)' : ' (not earned)'}</span></span>`).join('')}</p>` : '';
  return `<span class="rubber ${verdict.tone}" aria-hidden="true">${escapeHtml(verdict.stamp)}</span><div class="verdict-body"><h3>${escapeHtml(verdict.title)}</h3><p>${escapeHtml(verdict.text)}</p>${medals}<p class="chips">${tally}</p><p class="verdict-hint">${escapeHtml(verdict.hint)}</p></div>`;
}

/**
 * A rough token count, used until a loaded model counts the tokens itself. Fitted to the Qwen 2.5 tokenizer on ten
 * sample orders (2026-11-14): within 15% for plain sentences, up to 25% low for terse lists in capitals.
 */
export const estimateTokens = text => {
  const clean = String(text || '').trim();
  return clean ? Math.round(clean.split(/\s+/).length * 1.25 + 1) : 0;
};
/**
 * The size of the orders: words, and tokens (the pieces of text a model reads). Only facts: it makes no claim about
 * how well a model will follow the orders. `counted` is `{ text, tokens, by }` from a loaded model's tokenizer; it is
 * used only while it matches the text, and otherwise the tokens are an estimate and say so.
 */
export function ordersSize(text, counted = null) {
  const clean = String(text || '').trim();
  const words = clean ? clean.split(/\s+/).length : 0;
  const exact = Boolean(counted) && counted.text === clean && Number.isInteger(counted.tokens);
  const tokens = exact ? counted.tokens : estimateTokens(clean);
  if (!clean) return { words, tokens: 0, exact: true, label: '0 words', note: '' };
  return {
    words, tokens, exact,
    label: `${plural(words, 'word')} · ${exact ? '' : 'about '}${plural(tokens, 'token')}`,
    note: exact ? `Tokens counted by ${counted.by}.` : 'Tokens estimated from the length. A loaded model counts them exactly.',
  };
}

/** The clock turns red with a quarter of the turns left. */
export const clockUrgent = s => s.turnLimit - s.turn <= Math.ceil(s.turnLimit / 4);
/**
 * Which music cue fits what the stage shows: the desk while writing and between runs, the trial from the first Run until it ends,
 * then a win or loss stinger. During a trial, health at LOW and the red clock each add a layer (intensity 0–2).
 */
export function musicFor(s, running = false) {
  const cue = s.status === 'won' ? 'won' : s.status === 'lost' ? 'lost' : running || s.turn > 0 ? 'trial' : 'desk';
  return { cue, intensity: cue === 'trial' ? (s.hp <= LOW_HP ? 1 : 0) + (clockUrgent(s) ? 1 : 0) : 0 };
}

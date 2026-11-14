// Pure presentation helpers. They read game state and return plain data or HTML strings.
// Rules and outcomes stay in game.js; nothing here changes a game.
import { TILES, currentTile, assignmentReady, nextMove, guardBlock, counterDamage, commendations, PRICES, SWORD_BONUS, BUCKLER_BLOCK, BENCH_HP, MEDIC_HP } from './game.js';

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One portrait per stop, in circuit order. Files live in assets/art/<name>.webp.
export const TILE_ART = ['camp', 'rat', 'noticeboard', 'boar', 'purse', 'bruiser', 'medic', 'quickfoot', 'armorer', 'bench', 'champion', 'road'];
export const artUrl = name => `./assets/art/${name}.webp`;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const stampTarget = game => game.level === 'tutorial' ? 1 : 3;

/** The assignment as an ordered checklist. Exactly one unfinished step is marked `next`. */
export function objectiveSteps(game) {
  const tutorial = game.level === 'tutorial';
  const steps = TILES.filter(tile => tile.stamp && (!tutorial || tile.stamp === 'rat'))
    .map(tile => ({ kind: 'stamp', label: tile.name, art: TILE_ART[TILES.indexOf(tile)], done: game.stamps.includes(tile.stamp) }));
  if (!tutorial) steps.push({ kind: 'champion', label: 'Champion', art: 'champion', done: game.champion });
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

/** What the right-hand stage card shows: an opponent, or the place the hero is standing. */
export function sceneFor(game) {
  const tile = currentTile(game);
  const art = TILE_ART[game.position];
  const base = { art, name: tile.name, enemy: null, traits: [], mark: '' };
  if (game.enemy) {
    const e = game.enemy;
    // The introductory assignment has no announced moves: its rat simply hits back.
    const announced = game.level !== 'tutorial';
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
      : game.level === 'tutorial' ? 'First assignment: defeat the practice rat for its stamp, then return here and submit, all within 12 turns.'
      : `Three stamps, one champion and a safe return within ${game.turnLimit} turns. Every opponent announces its next move. The hero carries two potions and no enthusiasm.`;
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

export function lastMoveHtml(game, seconds = null) {
  const entry = game.log.at(-1);
  if (!entry) return '';
  const tone = entry.after.hp < entry.before.hp ? 'bad' : entry.after.stamps > entry.before.stamps ? 'good' : 'plain';
  const timing = entry.source === 'llm' && seconds !== null ? ` · ${seconds.toFixed(1)} s` : '';
  return `<div class="move tone-${tone}"><p class="move-head"><span class="section-label">Turn ${entry.turn} · ${escapeHtml(sourceLabel(entry.source))}${timing}</span></p><p class="move-action">${escapeHtml(entry.label)}</p><p class="move-detail">${escapeHtml(entry.detail)}</p><p class="chips">${chips(entry)}</p></div>`;
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
    const hint = game.level === 'tutorial' ? 'Next: the full circuit, where opponents announce their moves and the orders need to cover a lot more.'
      : !missed.length ? 'Every commendation in one trial. The guild suspects paperwork fraud.'
      : `Different orders earn different commendations. Still unclaimed: ${missed.map(m => `${m.label} (${m.rule.replace(/\.$/, '').toLowerCase()})`).join('; ')}.`;
    return { tone: 'won', stamp: 'Accepted', title: 'Assignment accepted.', text: `Home in ${plural(game.turn, 'turn')} with ${game.hp} HP and ${plural(game.potions, 'potion')} to spare. The hero would like to discuss the fee.`, hint, tally, commendations: medals };
  }
  const missing = [];
  const target = stampTarget(game);
  if (game.stamps.length < target) missing.push(`${game.stamps.length} of ${plural(target, 'stamp')} earned`);
  if (game.level !== 'tutorial' && !game.champion) missing.push('champion undefeated');
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

// Words that turn an instruction into a condition or a branch. Each one is another thing a small model must track.
const CONDITION_WORDS = /\b(if|when|whenever|unless|until|while|after|before|otherwise|except|instead|only|preferably|but)\b/gi;
/**
 * How demanding the orders are for a small local model. A reading aid only: it never changes how a trial is played.
 * Instructions are sentences or lines; conditions are branching words such as "when" or "otherwise".
 */
export function ordersComplexity(text) {
  const clean = String(text || '').trim();
  const words = clean ? clean.split(/\s+/).length : 0;
  const instructions = clean.split(/[.!?;\n]+/).filter(part => part.trim().split(/\s+/).filter(Boolean).length >= 2).length;
  const conditions = (clean.match(CONDITION_WORDS) || []).length;
  const score = instructions + conditions + Math.floor(words / 40);
  const level = score <= 7 ? 'simple' : score <= 11 ? 'moderate' : 'complex';
  const advice = {
    simple: 'Short and plain. Small models follow orders like these best.',
    moderate: 'Manageable. Small models sometimes drop a rule or two at this length.',
    complex: 'Small local models may lose track of this many rules and conditions. There is no penalty; expect the hero to miss some of them.',
  }[level];
  return { words, instructions, conditions, score, level, label: level[0].toUpperCase() + level.slice(1), segments: Math.min(5, Math.max(words ? 1 : 0, Math.ceil(score / 3))), advice };
}

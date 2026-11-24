// All rules, resources, observations and legal actions. Deterministic: no randomness, a fixed course.
// The introductory assignment uses the original, simpler rules: no guard, no visible enemy routines.
export const MAX_TURNS = 32;
// At or below this health the hero is told its status is LOW. The interface flags the same threshold.
export const LOW_HP = 18;
export const POTION_HP = 18;
export const MEDIC_HP = 12;
export const BENCH_HP = 6;
export const GUARD_BLOCK = 8;
export const BUCKLER_BLOCK = 6;
export const SWORD_BONUS = 2;
export const PRICES = { sword: 8, buckler: 8, potion: 6 };

export const PRESETS = {
  reckless: 'Fight every opponent. Use heavy strikes. Drink a potion whenever any health is missing. Buy whatever the armorer sells. Keep going until the champion is defeated, then return to camp.',
  careful: 'Quick strike every turn, except: guard against a SMASH, drink a potion when health is LOW, and retreat from the optional prize fight.',
};
export const TUTORIAL_PRESETS = {
  reckless: 'Always retreat from every enemy. Leave every fight immediately. Never attack.',
  careful: 'Fight the practice rat using quick strikes. After earning its training stamp, return to camp and submit the assignment.',
};
// In the two middle assignments the first draft is the previous assignment's winning orders, carried over. Each loses
// to the one new thing that assignment adds: the announced SMASH, then a fight long enough to need potions.
export const WARNING_PRESETS = {
  reckless: 'Fight every opponent using quick strikes. After earning all three training stamps, return to camp and submit the assignment.',
  careful: 'Quick strike every turn, except: guard against a SMASH.',
};
export const PRIZE_PRESETS = {
  reckless: WARNING_PRESETS.careful,
  careful: 'Quick strike every turn, except: guard against a SMASH and drink a potion when health is LOW. Fight the prize bruiser, buy only the sharper sword, skip the bench, and submit at camp as soon as you can.',
};

// What an opponent does on its turn. Each circuit opponent repeats a fixed routine, and its move is announced before the hero acts.
//   strike: an ordinary hit.  smash: a big hit; guarding it blocks part of it and counters for heavy-strike damage.
//   brace: no damage; the hero's strikes deal half.  winded: no damage, and an agile opponent cannot dodge.
export const MOVE_KINDS = {
  strike: { hits: true, summary: 'an ordinary hit' },
  smash: { hits: true, summary: 'a big hit; guarding it counters' },
  brace: { hits: false, summary: 'no damage; your strikes deal half' },
  winded: { hits: false, summary: 'no damage; it cannot dodge' },
};
const move = (kind, name, damage = 0) => ({ kind, name, damage });

export const TILES = [
  { name: 'Guild camp', kind: 'camp', short: 'CAMP' },
  { name: 'Practice rat', kind: 'enemy', stamp: 'rat', hp: 10, damage: 3, armor: 0, short: 'PRACTICE', routine: [move('strike', 'Nibble', 3)] },
  { name: 'The noticeboard', kind: 'road', short: 'NOTICES' },
  { name: 'Tin boar', kind: 'enemy', stamp: 'boar', hp: 18, damage: 4, armor: 2, short: 'ARMOR', routine: [move('smash', 'Charge', 12), move('strike', 'Gore', 4)] },
  { name: 'Prize purse', kind: 'purse', short: 'PAYDAY' },
  { name: 'Prize bruiser', kind: 'enemy', optional: true, prize: 6, hp: 20, damage: 5, armor: 0, short: 'SIDE BET', routine: [move('strike', 'Jab', 5), move('smash', 'Haymaker', 14), move('winded', 'Showboat')] },
  { name: 'Field medic', kind: 'medic', short: 'MEDIC' },
  { name: 'Quickfoot', kind: 'enemy', stamp: 'quickfoot', hp: 16, damage: 5, armor: 0, agile: true, short: 'AGILITY', routine: [move('strike', 'Dart', 5), move('strike', 'Dart', 5), move('winded', 'Out of breath')] },
  { name: 'Guild armorer', kind: 'shop', short: 'ARMORER' },
  { name: 'A place to sit', kind: 'bench', short: 'REST' },
  { name: 'Arena champion', kind: 'enemy', boss: true, prize: 8, hp: 30, damage: 7, armor: 1, short: 'CHAMPION', routine: [move('strike', 'Jab', 7), move('brace', 'Raise shield'), move('smash', 'Overhead smash', 18), move('winded', 'Catch breath')] },
  { name: 'Home stretch', kind: 'road', short: 'HOME' },
];

// The assignments, easiest first. Each walks a course through some of the stops above, always in circuit order, with the
// same opponents and prices everywhere. Each step adds a few things:
//   tutorial  one fight, no announced moves, no guard.
//   warning   announced moves, guard and its counter, armor, an agile opponent: the three stamp fights.
//   prize     the circuit's second half: coins, the optional prize fight, medic, armorer, bench and the champion.
//   circuit   both halves in one trial, against a tighter clock, with commendations.
export const LEVELS = {
  tutorial: { title: 'First instructions', course: [0, 1, 11], turnLimit: 12, stamps: ['rat'], champion: false, announced: false, presets: TUTORIAL_PRESETS,
    objective: () => 'Defeat the practice rat, earn one training stamp, return to camp, and submit the assignment before 12 turns.' },
  warning: { title: 'Fair warning', course: [0, 1, 3, 7, 11], turnLimit: 16, stamps: ['rat', 'boar', 'quickfoot'], champion: false, announced: true, drawn: true, presets: WARNING_PRESETS,
    objective: s => `Earn the rat, boar, and Quickfoot stamps, return to camp, and submit the assignment before ${s.turnLimit} turns.` },
  prize: { title: 'Prize money', course: [0, 4, 5, 6, 7, 8, 9, 10, 11], turnLimit: 30, stamps: ['quickfoot'], champion: true, announced: true, drawn: true, presets: PRIZE_PRESETS,
    objective: s => `Earn the Quickfoot stamp, defeat the champion, return to camp, and submit the assignment before ${s.turnLimit} turns.` },
  circuit: { title: 'The full circuit', course: TILES.map((tile, i) => i), turnLimit: MAX_TURNS, stamps: ['rat', 'boar', 'quickfoot'], champion: true, announced: true, commendations: true, presets: PRESETS,
    objective: s => `Earn the rat, boar, and Quickfoot stamps, defeat the champion, return to camp, and submit the assignment before ${s.turnLimit} turns.` },
};
export const LEVEL_ORDER = Object.keys(LEVELS);
/** The rules of a game's assignment. An unknown level plays as the full circuit, as before levels had a table. */
export const levelOf = s => LEVELS[s.level] || LEVELS.circuit;
/** The assignment after this one, or null after the last. */
export const nextLevel = level => LEVEL_ORDER[LEVEL_ORDER.indexOf(level) + 1] || null;

/**
 * A fresh trial. In an assignment marked `drawn`, a numeric `seed` deals each opponent's routine (the champion's
 * excepted) in a shuffled order every round, so each trial meets the moves in a different order; the same seed gives
 * the same order. Without a seed (tests, tools, the read-back drill) every opponent keeps its fixed routine.
 */
export function newGame(level = 'tutorial', seed = null) {
  const drawn = (LEVELS[level] || LEVELS.circuit).drawn && Number.isFinite(seed);
  return { level, seed: drawn ? seed >>> 0 : null, turnLimit: (LEVELS[level] || LEVELS.circuit).turnLimit, revision: 0, turn: 0, position: 0, lap: 1, hp: 40, maxHp: 40, stamina: 4, potions: 2, coins: 0, sword: 0, buckler: 0, stamps: [], champion: false, prizeWon: false, drank: 0, bigHitsTaken: 0, medicUsed: false, purseTaken: false, benchUsed: false, enemy: null, resolved: false, status: 'ready', log: [] };
}
export function assignmentReady(s) {
  const rules = levelOf(s);
  return rules.stamps.every(stamp => s.stamps.includes(stamp)) && (!rules.champion || s.champion);
}
export function currentTile(s) { return TILES[s.position]; }

/** The opponent's move this turn, or null outside a fight. The tutorial rat has a plain, unannounced routine. */
export function nextMove(enemy) {
  if (!enemy) return null;
  // An opponent built without a routine (an older saved state, a hand-made test) simply strikes.
  if (!enemy.routine?.length) return { kind: 'strike', name: 'Strike', damage: enemy.damage };
  return enemy.routine[(enemy.step || 0) % enemy.routine.length];
}
const announced = s => levelOf(s).announced;

/** Damage a strike would deal this turn, given the opponent's armor, agility and current move. */
export function strikeDamage(s, style) {
  const e = s.enemy;
  const m = nextMove(e);
  const heavy = style === 'heavy';
  let damage = heavy && e.agile && m.kind !== 'winded' ? 3 : Math.max(1, (heavy ? 12 : 6) + s.sword - e.armor);
  if (m.kind === 'brace') damage = Math.max(1, Math.floor(damage / 2));
  return damage;
}
/** Damage the opponent deals at the end of this turn, before any guard. */
const incoming = e => { const m = nextMove(e); return MOVE_KINDS[m.kind].hits ? m.damage : 0; };
export const guardBlock = s => GUARD_BLOCK + s.buckler;
/** Damage of the automatic counter after a guarded smash: what a heavy strike would deal, ignoring agility. */
export const counterDamage = s => Math.max(1, 12 + s.sword - s.enemy.armor);

function answerText(s, guarding = false) {
  const e = s.enemy;
  const m = nextMove(e);
  if (!announced(s)) return 'Enemy retaliates if still alive.';
  if (!MOVE_KINDS[m.kind].hits) return guarding ? `${e.name} is not attacking this turn, so there is nothing to block.` : `${e.name} is not attacking this turn.`;
  const taken = guarding ? Math.max(0, m.damage - guardBlock(s)) : m.damage;
  if (!guarding) return `${e.name} answers with ${m.name}: you take ${m.damage}.`;
  return `${e.name}'s ${m.name} (${m.damage}) is blocked down to ${taken}.${m.kind === 'smash' ? ` You counter for ${counterDamage(s)}${counterDamage(s) >= e.hp ? `, which defeats ${e.name}` : ''}.` : ''}`;
}

// The introductory assignment keeps its original wording, which is what the verified model run saw.
const TUTORIAL_POTION = s => `Restore up to ${POTION_HP} HP. ${s.potions} potions left. Takes one turn; an active enemy retaliates.`;

export function availableActions(s) {
  if (s.status === 'won' || s.status === 'lost') return [];
  const actions = [];
  // `answer`: the sentence at the end of `detail` saying what the enemy's announced move does in reply, kept apart so
  // the model's prompt can leave it out (src/protocol.js).
  const add = (id, label, command, detail, answer) => actions.push({ id, label, command, detail: detail || label, ...(answer ? { answer } : {}) });
  if (s.enemy) {
    const e = s.enemy;
    const m = nextMove(e);
    const answer = announced(s) ? answerText(s) : null;
    if (s.potions > 0 && s.hp < s.maxHp) add('potion', 'Drink potion', { type: 'heal' }, announced(s) ? `${s.hp <= LOW_HP ? 'Your health is LOW. ' : ''}Restore up to ${POTION_HP} HP. ${s.potions} potions left. Takes one turn. ${answerText(s)}` : TUTORIAL_POTION(s), answer);
    const quick = strikeDamage(s, 'quick');
    const defeats = damage => announced(s) && damage >= e.hp;
    const finish = (damage) => defeats(damage) ? `Defeats ${e.name}.` : answerText(s);
    add('quick', 'Quick strike', { type: 'attack', style: 'quick' }, `${quick} damage, recover 1 stamina. ${finish(quick)}`, defeats(quick) ? null : answer);
    if (s.stamina >= 2) {
      const heavy = strikeDamage(s, 'heavy');
      const dodge = e.agile && m.kind !== 'winded' ? ' This enemy evades most of a heavy strike.' : '';
      add('heavy', 'Heavy strike', { type: 'attack', style: 'heavy' }, `${heavy} damage, costs 2 stamina.${dodge} ${finish(heavy)}`, defeats(heavy) ? null : answer);
    }
    if (announced(s)) add('guard', 'Guard', { type: 'guard' }, `${m.kind === 'smash' ? 'Against the SMASH: ' : ''}Deal no damage. Block up to ${guardBlock(s)} damage and recover 1 stamina. ${answerText(s, true)}`, answerText(s, true));
    add('retreat', 'Retreat', { type: 'retreat' }, `Take 2 damage and leave this fight. ${e.stamp ? 'No training stamp earned.' : e.boss ? 'Champion remains undefeated.' : 'No prize earned.'}`);
    return actions;
  }
  if (s.potions > 0 && s.hp < s.maxHp) add('potion', 'Drink potion', { type: 'heal' }, announced(s) ? `${s.hp <= LOW_HP ? 'Your health is LOW. ' : ''}Restore up to ${POTION_HP} HP. ${s.potions} potions left. Takes one turn.` : TUTORIAL_POTION(s));
  const tile = currentTile(s);
  if (tile.kind === 'camp' && s.status === 'ready') {
    add('depart', 'Start the circuit', { type: 'advance' });
  } else {
    if (tile.kind === 'medic' && !s.medicUsed && s.hp < s.maxHp) add('medic', 'Visit the medic', { type: 'medic' }, `Restore ${MEDIC_HP} HP for free. Once per trial. Takes one turn.`);
    if (tile.kind === 'shop') {
      if (!s.sword && s.coins >= PRICES.sword) add('buy_sword', 'Buy a sharper sword', { type: 'buy', item: 'sword' }, `Spend ${PRICES.sword} of ${s.coins} coins. Every strike deals ${SWORD_BONUS} more damage. Takes one turn.`);
      if (!s.buckler && s.coins >= PRICES.buckler) add('buy_buckler', 'Buy a buckler', { type: 'buy', item: 'buckler' }, `Spend ${PRICES.buckler} of ${s.coins} coins. Guard blocks ${BUCKLER_BLOCK} more damage (${GUARD_BLOCK + BUCKLER_BLOCK} in total). Takes one turn.`);
      if (s.coins >= PRICES.potion) add('buy_potion', 'Buy a potion', { type: 'buy', item: 'potion' }, `Spend ${PRICES.potion} of ${s.coins} coins for one more potion (you carry ${s.potions}). Takes one turn.`);
    }
    if (tile.kind === 'bench' && !s.benchUsed && (s.stamina < 4 || s.hp < s.maxHp)) add('rest', 'Catch your breath', { type: 'rest' }, `Restore stamina to 4 and up to ${BENCH_HP} HP. Once per lap. Takes one turn.`);
    if (tile.kind === 'camp' && assignmentReady(s)) add('finish', 'Submit the assignment', { type: 'finish' });
    else add('advance', tile.kind === 'camp' ? 'Try another lap' : 'Continue along the circuit', { type: 'advance' }, 'Walk to the next stop. Recover 1 stamina. Takes one turn.');
  }
  return actions;
}

/** A small seeded random generator (mulberry32): the same seed, the same numbers. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function enterTile(s, say) {
  const tile = currentTile(s);
  s.resolved = false;
  if (tile.kind === 'enemy' && !(tile.boss && s.champion)) {
    const bonus = s.lap - 1;
    const base = tile.routine.map(m => ({ ...m, damage: m.damage ? m.damage + bonus : 0 }));
    // Drawn: the routine repeated in a shuffled order each time round, so every move still comes once per round (the boar
    // charges once in every two moves) but not in a known order. One stream per seed, stop and lap, so the fight is the
    // same whatever the hero did before it.
    // The champion keeps its fixed routine: the finale is a pattern to learn, and a shuffled one let Prize money's first
    // draft (no potions) win half its trials.
    const rng = s.seed == null || tile.boss ? null : seeded(s.seed * 7919 + s.position * 104729 + s.lap * 1299709);
    const routine = rng ? Array.from({ length: 16 }, () => shuffle(base, rng)).flat().map(m => ({ ...m })) : base;
    s.enemy = { name: tile.name, hp: tile.hp + bonus * 3, maxHp: tile.hp + bonus * 3, damage: tile.damage + bonus, armor: tile.armor, agile: !!tile.agile, stamp: tile.stamp || null, optional: !!tile.optional, boss: !!tile.boss, prize: tile.prize || 2, routine, step: 0 };
    say('world', 'enter', `${tile.name} steps onto the course.`, { position: s.position });
  }
  if (tile.kind === 'purse' && !s.purseTaken) { s.coins += 6; s.purseTaken = true; say('world', 'coins', 'Collected 6 guild coins.'); }
  if (tile.kind === 'camp' && s.turn > 0) {
    if (assignmentReady(s)) say('world', 'camp', 'All requirements met. Submit the assignment to finish.');
    else { s.lap++; s.benchUsed = false; say('world', 'camp', 'Back at camp. Another lap is possible, but opponents grow stronger.'); }
  }
}

function defeat(s, say) {
  const e = s.enemy;
  const prize = e.prize ?? (e.boss ? 8 : 2);
  s.coins += prize;
  if (e.optional) s.prizeWon = true;
  say('world', 'defeat', `${e.name} defeated.${e.optional ? ` Prize: ${prize} coins.` : ''}`);
  if (e.stamp && !s.stamps.includes(e.stamp)) { s.stamps.push(e.stamp); say('world', 'stamp', `Earned a training stamp (${s.stamps.length}/${levelOf(s).stamps.length}).`); }
  if (e.boss) { s.champion = true; say('world', 'champion', levelOf(s).stamps.length === 3 ? 'Champion defeated. Return to camp with all three stamps.' : 'Champion defeated. Return to camp with the training stamp.'); }
  s.enemy = null;
  s.resolved = true;
}

export function applyAction(state, actionId, source = 'manual') {
  const choice = availableActions(state).find(a => a.id === actionId);
  if (!choice) throw new Error(`Action is not available: ${actionId}`);
  const s = structuredClone(state);
  const at = currentTile(s).name;
  const messages = [];
  // The same turn as structured events, in the order they happened, each with the numbers at that moment.
  // The interface plays a turn back from these; `detail` keeps the plain sentence for the log and reports.
  const events = [];
  const say = (actor, kind, text, extra = {}) => {
    messages.push(text);
    events.push({ actor, kind, text, ...extra, at: { hp: s.hp, stamina: s.stamina, potions: s.potions, coins: s.coins, stamps: [...s.stamps], champion: s.champion, foeHp: s.enemy ? s.enemy.hp : null } });
  };
  const before = { hp: s.hp, stamina: s.stamina, potions: s.potions, coins: s.coins, stamps: s.stamps.length };
  s.turn++;
  s.revision++;
  s.status = 'active';
  const command = choice.command;
  let guarding = false;
  if (command.type === 'advance') {
    s.enemy = null;
    const course = levelOf(s).course;
    s.position = course[(course.indexOf(s.position) + 1) % course.length];
    s.stamina = Math.min(4, s.stamina + 1);
    enterTile(s, say);
  } else if (command.type === 'attack') {
    const e = s.enemy;
    const heavy = command.style === 'heavy';
    const kind = nextMove(e).kind;
    const damage = strikeDamage(s, command.style);
    s.stamina = heavy ? s.stamina - 2 : Math.min(4, s.stamina + 1);
    e.hp = Math.max(0, e.hp - damage);
    const note = [heavy && e.agile && kind !== 'winded' ? `${e.name} dodged most of the blow` : '', kind === 'brace' ? `${e.name}'s shield took half` : ''].filter(Boolean).map(n => `; ${n}`).join('');
    say('hero', 'strike', `Dealt ${damage} damage${note}.`, { style: command.style, damage });
    if (e.hp === 0) defeat(s, say);
  } else if (command.type === 'guard') {
    guarding = true;
    s.stamina = Math.min(4, s.stamina + 1);
    say('hero', 'guard', 'Raised a guard.');
  } else if (command.type === 'heal') {
    const healed = Math.min(POTION_HP, s.maxHp - s.hp);
    s.hp += healed;
    s.potions--;
    s.drank++;
    say('hero', 'heal', `Used a potion for ${healed} HP.`, { source: 'potion' });
  } else if (command.type === 'retreat') {
    s.hp = Math.max(0, s.hp - 2);
    say('hero', 'retreat', `Left ${s.enemy.name} behind. Lost 2 HP.`);
    s.enemy = null;
    s.resolved = true;
  } else if (command.type === 'medic') {
    const healed = Math.min(MEDIC_HP, s.maxHp - s.hp);
    s.hp += healed;
    s.medicUsed = true;
    say('hero', 'heal', `The medic restored ${healed} HP.`, { source: 'medic' });
  } else if (command.type === 'buy') {
    s.coins -= PRICES[command.item];
    if (command.item === 'sword') { s.sword = SWORD_BONUS; say('hero', 'buy', `Sword sharpened: +${SWORD_BONUS} damage on every strike.`, { item: 'sword' }); }
    if (command.item === 'buckler') { s.buckler = BUCKLER_BLOCK; say('hero', 'buy', `Bought a buckler: guard now blocks ${guardBlock(s)}.`, { item: 'buckler' }); }
    if (command.item === 'potion') { s.potions++; say('hero', 'buy', `Bought a potion (${s.potions} carried).`, { item: 'potion' }); }
  } else if (command.type === 'rest') {
    const healed = Math.min(BENCH_HP, s.maxHp - s.hp);
    s.stamina = 4;
    s.hp += healed;
    s.benchUsed = true;
    say('hero', 'rest', `Recovered all stamina${healed ? ` and ${healed} HP` : ''}.`);
  } else if (command.type === 'finish') {
    s.status = 'won';
    say('world', 'finish', 'Assignment accepted. The guild is reluctantly impressed.');
  }
  if (s.enemy && command.type !== 'advance' && command.type !== 'retreat') {
    const e = s.enemy;
    const m = nextMove(e);
    const raw = incoming(e);
    const taken = guarding ? Math.max(0, raw - guardBlock(s)) : raw;
    s.hp = Math.max(0, s.hp - taken);
    if (m.kind === 'smash' && !guarding) s.bigHitsTaken++;
    const blow = { move: m.kind, taken };
    if (!announced(s)) say('foe', 'foe-hit', `${e.name} retaliated for ${taken} damage.`, blow);
    else if (!raw) say('foe', 'foe-idle', m.kind === 'brace' ? `${e.name} hid behind its guard.` : `${e.name} stopped to catch its breath.`, blow);
    else if (guarding) say('foe', 'foe-blocked', `${e.name}'s ${m.name} hit the guard: ${taken} damage got through.`, blow);
    else say('foe', 'foe-hit', `${e.name}'s ${m.name} hit for ${taken} damage.`, blow);
    e.step++;
    // A guarded smash leaves the opponent open: the hero counters at once, for the damage of a heavy strike.
    if (guarding && m.kind === 'smash' && s.hp > 0) {
      const counter = counterDamage(s);
      e.hp = Math.max(0, e.hp - counter);
      say('hero', 'counter', `Countered for ${counter} damage.`, { damage: counter });
      if (e.hp === 0) defeat(s, say);
    }
  }
  if (s.hp === 0) { s.status = 'lost'; say('world', 'lost', 'Trial failed: the hero ran out of health. Revise the orders and retry.'); }
  if (s.status !== 'won' && s.turn >= s.turnLimit) { s.status = 'lost'; say('world', 'timeout', `Trial failed: the guild closed after ${s.turnLimit} turns. Revise the orders and retry.`); }
  s.log.push({ turn: s.turn, at, action: choice.id, label: choice.label, detail: messages.join(' ') || 'Moved along the course.', events, source, before, after: { hp: s.hp, stamina: s.stamina, potions: s.potions, coins: s.coins, stamps: s.stamps.length } });
  return s;
}

// Optional goals for the full circuit. Each rewards a different way of winning, and no one plan earns them all.
export const COMMENDATIONS = [
  { id: 'punctual', label: 'Ahead of schedule', rule: 'Submit by turn 26.', earned: s => s.turn <= 26 },
  { id: 'frugal', label: 'No expense claims', rule: 'Win without drinking a potion.', earned: s => s.drank === 0 },
  { id: 'overtime', label: 'Overtime', rule: 'Beat the optional prize bruiser too.', earned: s => s.prizeWon },
  { id: 'textbook', label: 'By the book', rule: 'Never take a smash without guarding.', earned: s => s.bigHitsTaken === 0 },
];
/** Commendations for a finished circuit. Empty for the other assignments or an unfinished trial. */
export function commendations(s) {
  if (!levelOf(s).commendations || s.status !== 'won') return [];
  return COMMENDATIONS.map(c => ({ id: c.id, label: c.label, rule: c.rule, earned: c.earned(s) }));
}

export function observation(s) {
  const e = s.enemy;
  const m = nextMove(e);
  const enemy = e ? { ...e } : null;
  if (enemy) delete enemy.routine;
  if (enemy && announced(s)) enemy.nextMove = { name: m.name, kind: m.kind, damage: MOVE_KINDS[m.kind].hits ? m.damage : 0, effect: MOVE_KINDS[m.kind].summary };
  return {
    objective: levelOf(s).objective(s),
    hero: { hp: s.hp, maxHp: s.maxHp, healthStatus: s.hp <= LOW_HP ? 'LOW' : 'OK', stamina: s.stamina, potions: s.potions, coins: s.coins, swordBonus: s.sword, ...(announced(s) ? { guardBlock: guardBlock(s) } : {}) },
    location: currentTile(s).name,
    enemy,
    ...(announced(s) ? { announcedMoves: true } : {}),
    progress: { stamps: s.stamps, targetStamps: levelOf(s).stamps.length, requiresChampion: levelOf(s).champion, championDefeated: s.champion, turn: s.turn, turnLimit: s.turnLimit, lap: s.lap },
    rules: 'Quick attacks restore 1 stamina. Heavy attacks cost 2 stamina. Healing restores up to 18 HP and consumes a turn. An active enemy retaliates after healing or a nonlethal attack. The field medic heals 12 HP once. Walking restores 1 stamina. Retreat loses 2 HP and forfeits that enemy reward. Agile enemies evade heavy strikes. Model thinking does not consume game turns.',
    recentEvents: s.log.slice(-2).map(e => e.detail),
  };
}

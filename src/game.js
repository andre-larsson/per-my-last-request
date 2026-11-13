export const MAX_TURNS = 38;
export const PRESETS = {
  reckless: 'Fight every opponent. Use quick attacks. Drink a potion whenever any health is missing. Buy upgrades when possible. Keep going until the champion is defeated, then return to camp.',
  careful: 'Collect all three stamps, defeat the champion, and submit the assignment at camp.\nYour highest priority: when your health status is LOW, drink a potion if one is available. Otherwise save potions.\nIn every fight, use a heavy strike whenever it is available. Use a quick strike when heavy is unavailable. Never retreat.\nOutside fights, visit the medic, buy the sword upgrade, or rest when offered. Otherwise continue along the circuit.',
};
export const TUTORIAL_PRESETS = {
  reckless: 'Always retreat from every enemy. Leave every fight immediately. Never attack.',
  careful: 'Fight the practice rat using quick strikes. After earning its training stamp, return to camp and submit the assignment.',
};
export const TILES = [
  { name: 'Guild camp', kind: 'camp', short: 'CAMP' },
  { name: 'Practice rat', kind: 'enemy', stamp: 'rat', hp: 10, damage: 3, armor: 0, short: 'PRACTICE' },
  { name: 'The noticeboard', kind: 'road', short: 'NOTICES' },
  { name: 'Tin boar', kind: 'enemy', stamp: 'boar', hp: 18, damage: 5, armor: 2, short: 'ARMOR' },
  { name: 'Prize purse', kind: 'purse', short: 'PAYDAY' },
  { name: 'Prize bruiser', kind: 'enemy', optional: true, hp: 14, damage: 5, armor: 0, short: 'SIDE BET' },
  { name: 'Field medic', kind: 'medic', short: 'MEDIC' },
  { name: 'Quickfoot', kind: 'enemy', stamp: 'quickfoot', hp: 16, damage: 5, armor: 0, agile: true, short: 'AGILITY' },
  { name: 'Guild armorer', kind: 'shop', short: 'ARMORER' },
  { name: 'A place to sit', kind: 'bench', short: 'REST' },
  { name: 'Arena champion', kind: 'enemy', boss: true, hp: 32, damage: 9, armor: 1, short: 'CHAMPION' },
  { name: 'Home stretch', kind: 'road', short: 'HOME' },
];

export function newGame(level = 'tutorial') {
  return { level, turnLimit: level === 'tutorial' ? 12 : MAX_TURNS, revision: 0, turn: 0, position: 0, lap: 1, hp: 40, maxHp: 40, stamina: 4, potions: 2, coins: 0, sword: 0, stamps: [], champion: false, medicUsed: false, purseTaken: false, benchUsed: false, enemy: null, resolved: false, status: 'ready', log: [] };
}
export function assignmentReady(s) { return s.level === 'tutorial' ? s.stamps.includes('rat') : s.champion && s.stamps.length === 3; }

export function currentTile(s) { return TILES[s.position]; }
export function availableActions(s) {
  if (s.status === 'won' || s.status === 'lost') return [];
  const actions = [];
  const add = (id, label, command, detail) => actions.push({ id, label, command, detail: detail || label });
  if (s.potions > 0 && s.hp < s.maxHp) add('potion', 'Drink potion', { type: 'heal' }, `Restore up to 18 HP. ${s.potions} potions left. Takes one turn; an active enemy retaliates.`);
  if (s.enemy) {
    const e = s.enemy;
    const quick = Math.max(1, 6 + s.sword - e.armor);
    const heavy = e.agile ? 3 : Math.max(1, 12 + s.sword - e.armor);
    add('quick', 'Quick strike', { type: 'attack', style: 'quick' }, `${quick} damage, recover 1 stamina. Enemy retaliates if still alive.`);
    if (s.stamina >= 2) add('heavy', 'Heavy strike', { type: 'attack', style: 'heavy' }, `${heavy} damage, costs 2 stamina.${e.agile ? ' This enemy evades most of a heavy strike.' : ''} Enemy retaliates if still alive.`);
    add('retreat', 'Retreat', { type: 'retreat' }, `Take 2 damage and leave this fight. ${e.stamp ? 'No training stamp earned.' : e.boss ? 'Champion remains undefeated.' : 'No prize earned.'}`);
    return actions;
  }
  const tile = currentTile(s);
  if (tile.kind === 'camp' && s.status === 'ready') {
    add('depart', 'Start the circuit', { type: 'advance' });
  } else {
    if (tile.kind === 'medic' && !s.medicUsed && s.hp < s.maxHp) add('medic', 'Visit the medic', { type: 'medic' }, 'Restore 12 HP for free. Once per trial. Takes one turn.');
    if (tile.kind === 'shop' && s.coins >= 6 && s.sword === 0) add('upgrade', 'Sharpen the sword', { type: 'upgrade' }, 'Spend 6 coins. All strikes do 2 more damage. Takes one turn.');
    if (tile.kind === 'bench' && !s.benchUsed && s.stamina < 4) add('rest', 'Catch your breath', { type: 'rest' }, 'Restore stamina to 4. Once per lap. Takes one turn.');
    if (tile.kind === 'camp' && assignmentReady(s)) add('finish', 'Submit the assignment', { type: 'finish' });
    else add('advance', tile.kind === 'camp' ? 'Try another lap' : 'Continue along the circuit', { type: 'advance' }, 'Walk to the next stop. Recover 1 stamina. Takes one turn.');
  }
  return actions;
}

function enterTile(s, messages) {
  const tile = currentTile(s);
  s.resolved = false;
  if (tile.kind === 'enemy' && !(tile.boss && s.champion)) {
    const bonus = s.lap - 1;
    s.enemy = { name: tile.name, hp: tile.hp + bonus * 3, maxHp: tile.hp + bonus * 3, damage: tile.damage + bonus, armor: tile.armor, agile: !!tile.agile, stamp: tile.stamp || null, optional: !!tile.optional, boss: !!tile.boss };
    messages.push(`${tile.name} steps onto the course.`);
  }
  if (tile.kind === 'purse' && !s.purseTaken) { s.coins += 6; s.purseTaken = true; messages.push('Collected 6 guild coins.'); }
  if (tile.kind === 'camp' && s.turn > 0) {
    if (assignmentReady(s)) messages.push('All requirements met. Submit the assignment to finish.');
    else { s.lap++; s.benchUsed = false; messages.push('Back at camp. Another lap is possible, but opponents grow stronger.'); }
  }
}

export function applyAction(state, actionId, source = 'manual') {
  const choice = availableActions(state).find(a => a.id === actionId);
  if (!choice) throw new Error(`Action is not available: ${actionId}`);
  const s = structuredClone(state);
  const at = currentTile(s).name;
  const messages = [];
  const before = { hp: s.hp, stamina: s.stamina, potions: s.potions };
  s.turn++;
  s.revision++;
  s.status = 'active';
  const command = choice.command;
  if (command.type === 'advance') {
    s.enemy = null;
    s.position = s.level === 'tutorial' && s.position === 1 ? 11 : (s.position + 1) % TILES.length;
    s.stamina = Math.min(4, s.stamina + 1);
    enterTile(s, messages);
  } else if (command.type === 'attack') {
    const e = s.enemy;
    const heavy = command.style === 'heavy';
    const damage = heavy && e.agile ? 3 : Math.max(1, (heavy ? 12 : 6) + s.sword - e.armor);
    s.stamina = heavy ? s.stamina - 2 : Math.min(4, s.stamina + 1);
    e.hp = Math.max(0, e.hp - damage);
    messages.push(`Dealt ${damage} damage${heavy && e.agile ? '; Quickfoot dodged most of the blow' : ''}.`);
    if (e.hp === 0) {
      s.coins += e.boss ? 8 : 2;
      if (e.stamp && !s.stamps.includes(e.stamp)) { s.stamps.push(e.stamp); messages.push(`Earned a training stamp (${s.stamps.length}/${s.level === 'tutorial' ? 1 : 3}).`); }
      if (e.boss) { s.champion = true; messages.push('Champion defeated. Return to camp with all three stamps.'); }
      messages.push(`${e.name} defeated.`);
      s.enemy = null;
      s.resolved = true;
    }
  } else if (command.type === 'heal') {
    const healed = Math.min(18, s.maxHp - s.hp);
    s.hp += healed;
    s.potions--;
    messages.push(`Used a potion for ${healed} HP.`);
  } else if (command.type === 'retreat') {
    s.hp = Math.max(0, s.hp - 2);
    messages.push(`Left ${s.enemy.name} behind. Lost 2 HP.`);
    s.enemy = null;
    s.resolved = true;
  } else if (command.type === 'medic') {
    const healed = Math.min(12, s.maxHp - s.hp);
    s.hp += healed;
    s.medicUsed = true;
    messages.push(`The medic restored ${healed} HP.`);
  } else if (command.type === 'upgrade') {
    s.coins -= 6;
    s.sword = 2;
    messages.push('Sword sharpened: +2 damage on normal hits.');
  } else if (command.type === 'rest') {
    s.stamina = 4;
    s.benchUsed = true;
    messages.push('Recovered all stamina.');
  } else if (command.type === 'finish') {
    s.status = 'won';
    messages.push('Assignment accepted. The guild is reluctantly impressed.');
  }
  if (s.enemy && command.type !== 'advance') {
    s.hp = Math.max(0, s.hp - s.enemy.damage);
    messages.push(`${s.enemy.name} retaliated for ${s.enemy.damage} damage.`);
  }
  if (s.hp === 0) { s.status = 'lost'; messages.push('Trial failed: the hero ran out of health. Revise the orders and retry.'); }
  if (s.status !== 'won' && s.turn >= s.turnLimit) { s.status = 'lost'; messages.push(`Trial failed: the guild closed after ${s.turnLimit} turns. Revise the orders and retry.`); }
  s.log.push({ turn: s.turn, at, action: choice.id, label: choice.label, detail: messages.join(' ') || 'Moved along the course.', source, before, after: { hp: s.hp, stamina: s.stamina, potions: s.potions } });
  return s;
}

export function observation(s) {
  return {
    objective: s.level === 'tutorial' ? 'Defeat the practice rat, earn one training stamp, return to camp, and submit the assignment before 12 turns.' : 'Earn the rat, boar, and Quickfoot stamps, defeat the champion, return to camp, and submit the assignment before 38 turns.',
    hero: { hp: s.hp, maxHp: s.maxHp, healthStatus: s.hp <= 18 ? 'LOW' : 'OK', stamina: s.stamina, potions: s.potions, coins: s.coins, swordBonus: s.sword },
    location: currentTile(s).name,
    enemy: s.enemy ? { ...s.enemy } : null,
    progress: { stamps: s.stamps, targetStamps: s.level === 'tutorial' ? 1 : 3, requiresChampion: s.level !== 'tutorial', championDefeated: s.champion, turn: s.turn, turnLimit: s.turnLimit, lap: s.lap },
    rules: 'Quick attacks restore 1 stamina. Heavy attacks cost 2 stamina. Healing restores up to 18 HP and consumes a turn. An active enemy retaliates after healing or a nonlethal attack. The field medic heals 12 HP once. Walking restores 1 stamina. Retreat loses 2 HP and forfeits that enemy reward. Agile enemies evade heavy strikes. Model thinking does not consume game turns.',
    recentEvents: s.log.slice(-2).map(e => e.detail),
  };
}

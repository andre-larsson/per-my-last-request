import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyAction, availableActions, TILES, LOW_HP, observation, nextMove, strikeDamage, commendations, PRESETS, TUTORIAL_PRESETS } from '../src/game.js';
import { objectiveSteps, sceneFor, deltas, lastMoveHtml, journalHtml, verdictFor, verdictHtml, actionTally, ordersComplexity, TILE_ART } from '../src/view.js';
import { renderMap, mapLayout } from '../src/map.js';

const play = (state, ...ids) => ids.reduce((s, id) => applyAction(s, id), state);
/** Walks onto stop `index` of the circuit from the stop before it, so the opponent there steps out with its real routine. */
const meet = (index, extra = {}) => applyAction({ ...newGame('circuit'), status: 'active', position: index - 1, ...extra }, 'advance');
const tutorialWin = () => play(newGame('tutorial'), 'depart', 'quick', 'quick', 'advance', 'advance', 'finish');
function tutorialRetreats() {
  let s = newGame('tutorial');
  while (availableActions(s).length) s = applyAction(s, s.enemy ? 'retreat' : s.status === 'ready' ? 'depart' : 'advance');
  return s;
}

test('the checklist ticks steps as they are earned and marks exactly one next step', () => {
  const start = objectiveSteps(newGame('circuit'));
  assert.deepEqual(start.map(step => step.label), ['Practice rat', 'Tin boar', 'Quickfoot', 'Champion', 'Submit at camp']);
  assert.equal(start.filter(step => step.next).length, 1);
  assert.equal(start[0].next, true);
  const afterRat = objectiveSteps(play(newGame('circuit'), 'depart', 'quick', 'quick'));
  assert.equal(afterRat[0].done, true);
  assert.equal(afterRat[1].next, true);
  const won = objectiveSteps(tutorialWin());
  assert.deepEqual(won.map(step => step.done), [true, true]);
  assert.equal(won.some(step => step.next), false);
});
test('every stop on the circuit has a portrait', () => {
  assert.equal(TILE_ART.length, TILES.length);
  for (const step of objectiveSteps(newGame('circuit'))) assert.ok(step.art);
});
test('the stage card reports the opponent exactly as the engine holds it', () => {
  let s = play(newGame('circuit'), 'depart');
  let scene = sceneFor(s);
  assert.equal(scene.name, 'Practice rat');
  assert.deepEqual(scene.enemy, { hp: 10, maxHp: 10 });
  assert.deepEqual([scene.intent.tag, scene.intent.name, scene.intent.damage], ['Strike', 'Nibble', 3]);
  assert.equal(sceneFor(play(newGame('tutorial'), 'depart')).traits[0].label, 'Hits for 3', 'the tutorial rat announces nothing');
  assert.equal(sceneFor(play(newGame('tutorial'), 'depart')).intent, null);
  s = play(s, 'quick');
  assert.deepEqual(sceneFor(s).enemy, { hp: 4, maxHp: 10 });
  s = play(s, 'quick');
  assert.equal(sceneFor(s).mark, 'Defeated');
  s = play(s, 'advance', 'advance');
  scene = sceneFor(s);
  assert.equal(scene.name, 'Tin boar');
  assert.ok(scene.traits.some(trait => trait.label === 'Armor 2'));
  assert.deepEqual([scene.intent.tag, scene.intent.damage], ['Smash', 12]);
  assert.match(scene.intent.note, /blocks 8 of it and counters for 10/);
  assert.equal(sceneFor(play(s, 'retreat')).mark, 'Left behind');
});
test('agile opponents and services describe their real effect', () => {
  const s = newGame('circuit');
  s.status = 'active';
  s.position = 7;
  s.enemy = { name: 'Quickfoot', hp: 16, maxHp: 16, damage: 5, armor: 0, agile: true, stamp: 'quickfoot' };
  assert.ok(sceneFor(s).traits.some(trait => trait.label === 'Agile' && /only 3/.test(trait.note)));
  s.enemy = null;
  s.position = 6;
  assert.equal(sceneFor(s).traits[0].label, '+12 HP');
  s.medicUsed = true;
  assert.deepEqual(sceneFor(s).traits, []);
});
test('log entries show signed changes to the hero', () => {
  const s = play(newGame('circuit'), 'depart', 'quick', 'quick');
  assert.deepEqual(deltas(s.log[1]).map(d => d.text), ['−3 HP']);
  assert.deepEqual(deltas(s.log[2]).map(d => d.text), ['+2 coins', '+1 stamp']);
  const healed = play(play(newGame('circuit'), 'depart', 'quick'), 'potion');
  assert.deepEqual(deltas(healed.log[2]).map(d => d.text), ['−1 potion']); // +3 HP healed, then 3 HP lost to retaliation.
  assert.match(journalHtml(s.log), /tone-good/);
  assert.match(journalHtml(s.log), /tone-bad/);
  assert.match(journalHtml([]), /Nothing to report/);
  assert.match(lastMoveHtml(s), /Quick strike/);
  assert.equal(lastMoveHtml(newGame()), '');
});
test('player text is escaped in rendered markup', () => {
  const s = play(newGame('tutorial'), 'depart');
  s.log[0].label = '<img src=x onerror=alert(1)>';
  assert.equal(journalHtml(s.log).includes('<img'), false);
  assert.equal(lastMoveHtml(s).includes('<img'), false);
});
test('the verdict names what went wrong and what the hero mostly did', () => {
  assert.equal(verdictFor(newGame()), null);
  const won = verdictFor(tutorialWin());
  assert.equal(won.tone, 'won');
  assert.match(won.text, /6 turns with 37 HP and 2 potions/);
  const overdue = tutorialRetreats();
  const lost = verdictFor(overdue);
  assert.equal(lost.stamp, 'Overdue');
  assert.match(lost.text, /0 of 1 stamp earned/);
  assert.equal(actionTally(overdue.log).find(t => t.label === 'Retreat').count, 3);
  let dead = newGame('circuit');
  while (availableActions(dead).length) dead = applyAction(dead, dead.enemy ? 'quick' : dead.status === 'ready' ? 'depart' : 'advance');
  assert.equal(dead.hp, 0);
  assert.equal(verdictFor(dead).stamp, 'Incident');
  assert.match(verdictFor(dead).text, /ran out of health/);
});
test('both map layouts place every stop inside the drawing, and the tutorial shows only its three', () => {
  for (const compact of [false, true]) {
    const layout = mapLayout('circuit', compact);
    assert.equal(layout.pos.length, TILES.length);
    for (const [x, y] of layout.pos) assert.ok(x >= 30 && x <= layout.w - 30 && y >= 71 && y <= layout.h - 30, `${x},${y}`);
    const tutorial = renderMap(newGame('tutorial'), { compact });
    assert.equal(tutorial.body.match(/class="node /g).length, 3);
    assert.equal(renderMap(newGame('circuit'), { compact }).body.match(/class="node /g).length, 12);
  }
  const moved = play(newGame('circuit'), 'depart');
  assert.match(renderMap(moved, { from: 0 }).body, /hero-pin moving/);
  assert.doesNotMatch(renderMap(moved).body, /hero-pin moving/);
});

// The rulebook dialog in index.html states these rules. Each one is checked against the engine here.
test('rulebook: strikes, stamina, armor and retaliation', () => {
  let s = play(newGame('circuit'), 'depart');
  const quick = play(s, 'quick');
  assert.equal(quick.enemy.hp, 4, 'quick strike deals 6');
  assert.equal(quick.hp, 37, 'a surviving enemy hits back');
  s.stamina = 2;
  assert.equal(play(s, 'quick').stamina, 3, 'quick strike restores 1 stamina');
  const heavy = play(newGame('circuit'), 'depart', 'heavy');
  assert.equal(heavy.stamina, 2, 'heavy strike costs 2 stamina');
  assert.equal(heavy.enemy, null, 'heavy strike deals 12, enough for the 10 HP rat');
  s.stamina = 1;
  assert.equal(availableActions(s).some(a => a.id === 'heavy'), false, 'heavy needs 2 stamina');
  const boar = play(heavy, 'advance', 'advance');
  assert.equal(play(boar, 'quick').enemy.hp, 18 - 4, 'armor 2 blocks 2 of a quick strike');
  const retreat = play(boar, 'retreat');
  assert.equal(retreat.hp, boar.hp - 2, 'retreat costs 2 HP');
});
test('rulebook: starting kit, potions, the LOW flag, medic, bench, purse and armorer', () => {
  const fresh = newGame('circuit');
  assert.deepEqual([fresh.hp, fresh.stamina, fresh.potions, fresh.turnLimit], [40, 4, 2, 32]);
  assert.equal(newGame('tutorial').turnLimit, 12);
  assert.equal(LOW_HP, 18);
  const hurt = { ...newGame('circuit'), status: 'active', position: 2, hp: 18 };
  assert.equal(observation(hurt).hero.healthStatus, 'LOW');
  assert.equal(observation({ ...hurt, hp: 19 }).hero.healthStatus, 'OK');
  assert.equal(play(hurt, 'potion').hp, 36, 'a potion restores 18');
  const atMedic = { ...hurt, position: 6 };
  const treated = play(atMedic, 'medic');
  assert.equal(treated.hp, 30, 'the medic restores 12');
  assert.equal(availableActions(treated).some(a => a.id === 'medic'), false, 'once per trial');
  const walking = { ...newGame('circuit'), status: 'active', position: 2, stamina: 1 };
  assert.equal(play(walking, 'advance').stamina, 2, 'walking restores 1 stamina');
  const atBench = { ...walking, position: 9, hp: 30 };
  const rested = play(atBench, 'rest');
  assert.deepEqual([rested.stamina, rested.hp], [4, 36], 'the bench restores full stamina and 6 HP');
  assert.equal(availableActions({ ...rested, stamina: 1 }).some(a => a.id === 'rest'), false, 'once per lap');
  const beforePurse = { ...newGame('circuit'), status: 'active', position: 3 };
  const paid = play(beforePurse, 'advance');
  assert.equal(paid.coins, 6, 'the purse holds 6 coins');
  const atShop = { ...paid, position: 8, coins: 16 };
  const sharp = play(atShop, 'buy_sword');
  assert.deepEqual([sharp.coins, sharp.sword, sharp.turn], [8, 2, atShop.turn + 1], 'a sword costs 8 and takes a turn');
  const armed = play({ ...newGame('circuit'), sword: 2 }, 'depart', 'quick');
  assert.equal(armed.enemy.hp, 10 - 8, 'a sharpened sword adds 2 damage');
  const shielded = play(sharp, 'buy_buckler');
  assert.deepEqual([shielded.coins, shielded.buckler], [0, 6], 'a buckler costs 8');
  assert.equal(play(meet(3, { buckler: 6 }), 'guard').hp, 40, 'with a buckler, guard blocks 14: the whole 12-damage charge');
  const stocked = play({ ...paid, position: 8, coins: 6 }, 'buy_potion');
  assert.deepEqual([stocked.coins, stocked.potions], [0, 3], 'a potion costs 6');
  const broke = { ...atShop, coins: 7 };
  assert.deepEqual(availableActions(broke).map(a => a.id).filter(id => id.startsWith('buy_')), ['buy_potion'], 'sword and buckler cost 8');
});
test('rulebook: prize money, the champion, and stronger opponents on later laps', () => {
  const rat = play(newGame('circuit'), 'depart', 'heavy');
  assert.equal(rat.coins, 2, 'a win pays 2 coins');
  const bruiser = meet(5, { stamina: 3 });
  const pocketed = play({ ...bruiser, enemy: { ...bruiser.enemy, hp: 1 } }, 'quick');
  assert.equal(pocketed.coins, 6, 'the optional prize bruiser pays 6');
  const champion = meet(10);
  const beaten = play({ ...champion, enemy: { ...champion.enemy, hp: 1 } }, 'quick');
  assert.equal(beaten.coins, 8, 'the champion pays 8');
  assert.equal(beaten.champion, true);
  const secondLap = play({ ...newGame('circuit'), status: 'active', position: 11, turn: 5 }, 'advance', 'advance');
  assert.equal(secondLap.lap, 2);
  assert.deepEqual([secondLap.enemy.hp, nextMove(secondLap.enemy).damage], [13, 4], 'lap 2 adds 3 HP and 1 damage');
});
test('rulebook: reading the opponent in the full circuit', () => {
  // Every circuit opponent announces its move before the hero acts, and repeats its routine.
  for (const index of [1, 3, 5, 7, 10]) {
    const s = meet(index);
    assert.ok(observation(s).enemy.nextMove, TILES[index].name);
    assert.ok(availableActions(s).some(a => a.id === 'guard'), 'guard is offered in circuit fights');
  }
  // Strike: an ordinary hit. Smash: a big hit.
  assert.equal(play(meet(1), 'quick').hp, 37, 'a strike hits for its damage');
  assert.equal(play(meet(3), 'quick').hp, 28, 'a smash hits for its damage');
  // Bracing: no hit, strikes deal half.
  const bracing = play(meet(10), 'guard');
  assert.equal(nextMove(bracing.enemy).kind, 'brace');
  assert.equal(play(bracing, 'heavy').hp, bracing.hp, 'no hit while bracing');
  assert.equal(strikeDamage(bracing, 'heavy'), Math.floor((12 - 1) / 2), 'bracing halves a strike');
  // Winded: no hit, and an agile enemy cannot dodge.
  const winded = play(meet(7), 'guard', 'guard');
  assert.equal(nextMove(winded.enemy).kind, 'winded');
  assert.equal(play(winded, 'quick').hp, winded.hp, 'no hit while winded');
  assert.equal(strikeDamage(winded, 'heavy'), 12);
  assert.equal(strikeDamage(play(meet(7), 'guard'), 'heavy'), 3, 'otherwise the agile Quickfoot dodges');
  // Guard: deals nothing, blocks up to 8, restores 1 stamina.
  const blocked = play(meet(7, { stamina: 1 }), 'guard');
  assert.deepEqual([blocked.enemy.hp, blocked.hp, blocked.stamina], [16, 40, 3]);
  // Guarding a smash counters it: the enemy takes a heavy strike's damage at once.
  const countered = play(meet(3), 'guard');
  assert.deepEqual([countered.hp, countered.enemy.hp], [40 - 4, 18 - (12 - 2)]);
  // The introductory assignment has neither.
  const tutorial = play(newGame('tutorial'), 'depart');
  assert.equal(availableActions(tutorial).some(a => a.id === 'guard'), false);
});
test('rulebook: commendations', () => {
  const won = { ...newGame('circuit'), status: 'won', turn: 26, drank: 0, prizeWon: true, bigHitsTaken: 0 };
  assert.ok(commendations(won).every(c => c.earned));
  const late = commendations({ ...won, turn: 27, drank: 1, prizeWon: false, bigHitsTaken: 1 });
  assert.ok(late.every(c => !c.earned), 'turn 26, no potion drunk, the bruiser beaten, no unguarded smash');
  assert.equal(play(meet(3), 'quick').bigHitsTaken, 1);
  assert.equal(play(meet(3), 'guard').bigHitsTaken, 0);
  const html = verdictHtml(verdictFor(won));
  assert.match(html, /Commendations 4 of 4/);
});
test('the complexity meter rates orders without changing them, and the examples stay simple', () => {
  for (const orders of [...Object.values(PRESETS), ...Object.values(TUTORIAL_PRESETS)]) assert.equal(ordersComplexity(orders).level, 'simple', orders);
  const empty = ordersComplexity('   ');
  assert.deepEqual([empty.words, empty.instructions, empty.segments, empty.level], [0, 0, 0, 'simple']);
  const tangled = 'Collect all three stamps, defeat the champion, and submit the assignment at camp.\nYour highest priority: when your health status is LOW, drink a potion if one is available. Otherwise save potions.\nIn every fight, use a heavy strike whenever it is available. Use a quick strike when heavy is unavailable. Never retreat.\nOutside fights, visit the medic, buy the sword, or rest when offered. Otherwise continue along the circuit.';
  const rated = ordersComplexity(tangled);
  assert.equal(rated.level, 'complex');
  assert.equal(rated.segments, 5);
  assert.match(rated.advice, /no penalty/i);
  assert.ok(rated.conditions >= 6);
  assert.equal(ordersComplexity('Guard smashes. Otherwise strike. Drink when LOW. Skip the bruiser. Buy a buckler. Rest at the bench when tired.').level, 'moderate');
});

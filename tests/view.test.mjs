import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyAction, availableActions, TILES, LOW_HP, observation } from '../src/game.js';
import { objectiveSteps, sceneFor, deltas, lastMoveHtml, journalHtml, verdictFor, actionTally, TILE_ART } from '../src/view.js';
import { renderMap, mapLayout } from '../src/map.js';

const play = (state, ...ids) => ids.reduce((s, id) => applyAction(s, id), state);
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
  assert.equal(scene.traits[0].label, 'Hits for 3');
  s = play(s, 'quick');
  assert.deepEqual(sceneFor(s).enemy, { hp: 4, maxHp: 10 });
  s = play(s, 'quick');
  assert.equal(sceneFor(s).mark, 'Defeated');
  s = play(s, 'advance', 'advance');
  scene = sceneFor(s);
  assert.equal(scene.name, 'Tin boar');
  assert.ok(scene.traits.some(trait => trait.label === 'Armor 2'));
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
  assert.deepEqual([fresh.hp, fresh.stamina, fresh.potions, fresh.turnLimit], [40, 4, 2, 38]);
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
  const atBench = { ...walking, position: 9 };
  const rested = play(atBench, 'rest');
  assert.equal(rested.stamina, 4);
  assert.equal(availableActions({ ...rested, stamina: 1 }).some(a => a.id === 'rest'), false, 'once per lap');
  const beforePurse = { ...newGame('circuit'), status: 'active', position: 3 };
  const paid = play(beforePurse, 'advance');
  assert.equal(paid.coins, 6, 'the purse holds 6 coins');
  const atShop = { ...paid, position: 8 };
  const sharp = play(atShop, 'upgrade');
  assert.deepEqual([sharp.coins, sharp.sword], [0, 2]);
  const armed = play({ ...newGame('circuit'), sword: 2 }, 'depart', 'quick');
  assert.equal(armed.enemy.hp, 10 - 8, 'a sharpened sword adds 2 damage');
  assert.equal(availableActions({ ...atShop, coins: 5 }).some(a => a.id === 'upgrade'), false, 'the sword costs 6 coins');
});
test('rulebook: prize money, the champion, and stronger opponents on later laps', () => {
  const rat = play(newGame('circuit'), 'depart', 'heavy');
  assert.equal(rat.coins, 2, 'a win pays 2 coins');
  const champion = { ...newGame('circuit'), status: 'active', position: 10, enemy: { name: 'Arena champion', hp: 1, maxHp: 32, damage: 9, armor: 1, agile: false, stamp: null, optional: false, boss: true } };
  const beaten = play(champion, 'quick');
  assert.equal(beaten.coins, 8, 'the champion pays 8');
  assert.equal(beaten.champion, true);
  const secondLap = play({ ...newGame('circuit'), status: 'active', position: 11, turn: 5 }, 'advance', 'advance');
  assert.equal(secondLap.lap, 2);
  assert.deepEqual([secondLap.enemy.hp, secondLap.enemy.damage], [13, 4], 'lap 2 adds 3 HP and 1 damage');
});

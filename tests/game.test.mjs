import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyAction, availableActions, observation, MAX_TURNS } from '../src/game.js';
import { actionSchema, parseDecision, decisionMessages } from '../src/protocol.js';

function policy(s, reckless = false) {
  const ids = availableActions(s).map(a => a.id);
  const has = id => ids.includes(id);
  if (has('potion') && (reckless || s.hp <= 18)) return 'potion';
  if (has('medic')) return 'medic';
  if (has('upgrade')) return 'upgrade';
  if (s.enemy?.optional && !reckless) return 'retreat';
  if (s.enemy) return !reckless && !s.enemy.agile && has('heavy') ? 'heavy' : 'quick';
  if (has('rest')) return 'rest';
  return has('finish') ? 'finish' : has('depart') ? 'depart' : 'advance';
}
function simulate(reckless = false) {
  let state = newGame('circuit');
  for (let i = 0; i < MAX_TURNS && availableActions(state).length; i++) state = applyAction(state, policy(state, reckless), 'rules-test');
  return state;
}
test('a resource-aware policy completes the actual circuit', () => {
  const s = simulate();
  assert.equal(s.status, 'won');
  assert.equal(s.stamps.length, 3);
  assert.equal(s.champion, true);
  assert.equal(s.position, 0);
  assert.ok(s.hp > 0);
  assert.ok(s.turn < MAX_TURNS);
});
test('the introductory assignment completes with one stamp and a safe return', () => {
  let s = newGame('tutorial');
  for(const id of ['depart','quick','quick','advance','advance','finish'])s=applyAction(s,id);
  assert.equal(s.status,'won');
  assert.equal(s.turn,6);
  assert.equal(s.champion,false);
  assert.deepEqual(s.stamps,['rat']);
  assert.match(s.log[2].detail,/stamp \(1\/1\)/);
});
test('retreating around the introductory loop cannot complete its assignment', () => {
  let s = newGame('tutorial');
  while(availableActions(s).length)s=applyAction(s,s.enemy?'retreat':s.status==='ready'?'depart':'advance');
  assert.equal(s.status,'lost');
  assert.equal(s.turn,12);
  assert.deepEqual(s.stamps,[]);
});
test('wasting healing and taking every fight loses on the same course', () => {
  const s = simulate(true);
  assert.equal(s.status, 'lost');
  assert.equal(s.hp, 0);
  assert.equal(s.potions, 0);
});
test('illegal commands cannot grant rewards or spend a turn', () => {
  const s = newGame();
  for (const action of ['finish', 'potion', 'upgrade', 'heavy', '__proto__']) assert.throws(() => applyAction(s, action));
  assert.equal(s.turn, 0);
  assert.equal(s.coins, 0);
  assert.equal(s.status, 'ready');
});
test('potions heal by the actual deficit and provoke retaliation in combat', () => {
  let s = applyAction(newGame(), 'depart');
  s = applyAction(s, 'quick');
  assert.equal(s.hp, 37);
  s = applyAction(s, 'potion');
  assert.equal(s.hp, 37);
  assert.equal(s.potions, 1);
  assert.match(s.log.at(-1).detail, /potion for 3 HP/);
});
test('agile opponents evade heavy attacks and retreat forfeits their stamp', () => {
  const s = newGame();
  s.position = 7;
  s.status = 'active';
  s.enemy = { name: 'Quickfoot', hp: 16, damage: 5, armor: 0, agile: true, stamp: 'quickfoot' };
  const hit = applyAction(s, 'heavy');
  assert.equal(hit.enemy.hp, 13);
  assert.equal(hit.stamina, 2);
  const retreat = applyAction(s, 'retreat');
  assert.deepEqual(retreat.stamps, []);
  assert.equal(retreat.hp, 38);
});
test('running out of game turns ends the trial; inference time is outside the engine', () => {
  const s = newGame();
  s.turn = s.turnLimit - 1;
  const next = applyAction(s, 'depart');
  assert.equal(next.status, 'lost');
  assert.deepEqual(availableActions(next), []);
});
test('resolving an action does not mutate the prior state', () => {
  const s = newGame();
  const next = applyAction(s, 'depart');
  assert.equal(s.position, 0);
  assert.equal(s.log.length, 0);
  assert.equal(next.position, 1);
  assert.equal(next.log.length, 1);
});
test('protocol accepts exactly an offered action ID', () => {
  const actions = availableActions(newGame());
  assert.equal(parseDecision('{"action":"depart"}', actions), 'depart');
  for (const raw of [null, 'null', '[]', '{}', 'not JSON', '{"action":2}', '{"action":"win"}', '{"action":"depart","hp":999}', '```json\n{"action":"depart"}\n```']) assert.throws(() => parseDecision(raw, actions));
  assert.throws(() => actionSchema([]));
  assert.deepEqual(actionSchema(actions).properties.action.enum, ['depart']);
});
test('observations expose actual resource counts and keep commands out of model output', () => {
  const s = applyAction(newGame(), 'depart');
  const actions = availableActions(s);
  const messages = decisionMessages('Use quick attacks.', observation(s), actions);
  assert.match(messages[0].content, /Use quick attacks\./);
  assert.match(messages[1].content, /2 healing potions/);
  assert.match(messages[1].content, /quick: Quick strike/);
  assert.equal(messages[1].content.includes('"command"'), false);
});

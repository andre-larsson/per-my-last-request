import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyAction, availableActions, observation, nextMove, LOW_HP, LEVEL_ORDER } from '../src/game.js';
import { decisionMessages } from '../src/protocol.js';
import { drillFor, kindOf } from '../src/drill.js';
import { readbackHtml } from '../src/view.js';

test('every assignment has a read-back drill of real choices, each asked as a trial would ask it', () => {
  const sizes = Object.fromEntries(LEVEL_ORDER.map(level => [level, drillFor(level).length]));
  assert.deepEqual(sizes, { tutorial: 4, warning: 6, prize: 11, circuit: 11 });
  for (const level of LEVEL_ORDER) for (const item of drillFor(level)) {
    assert.equal(item.state.level, level);
    assert.ok(availableActions(item.state).length > 1, `${level}/${item.id} offers a choice`);
    // The prompt is the game's own, built from the engine state: nothing is written for the drill.
    const [system, user] = decisionMessages('Quick strike every turn.', observation(item.state), availableActions(item.state));
    assert.match(system.content, /Quick strike every turn\./);
    assert.match(user.content, /AVAILABLE ACTIONS/);
  }
});

test('the drill asks each kind of decision once, with LOW health only where it says so', () => {
  const circuit = drillFor('circuit');
  assert.deepEqual(circuit.map(item => item.id), ['strike', 'smash', 'brace', 'winded', 'low', 'prize', 'medic', 'shop', 'bench', 'road', 'camp']);
  for (const item of circuit) {
    const s = item.state;
    if (item.id === 'low') assert.ok(s.hp <= LOW_HP); else assert.ok(s.hp > LOW_HP, `${item.id} is not LOW`);
    if (['strike', 'smash', 'brace', 'winded'].includes(item.id)) assert.equal(nextMove(s.enemy).kind, item.id);
  }
  const ids = id => availableActions(circuit.find(item => item.id === id).state).map(a => a.id);
  assert.ok(ids('prize').includes('retreat'));
  assert.ok(ids('medic').includes('medic') && ids('medic').includes('potion'), 'The medic and a potion are both on offer');
  assert.ok(['buy_sword', 'buy_buckler', 'buy_potion'].every(id => ids('shop').includes(id)), 'The armorer offers all three');
  assert.ok(ids('camp').includes('finish') && ids('camp').includes('potion'), 'At camp, submitting competes with a potion');
  assert.match(circuit[1].ask, /Tin boar is about to SMASH/);
  // The same list every time: a read-back of the same orders at temperature 0 asks the very same prompts.
  assert.equal(drillFor('circuit'), circuit);
});

test('the read-back memo shows each answer as it arrives, and marks what changed', () => {
  const items = [{ id: 'strike', ask: 'Practice rat makes an ordinary strike.' }, { id: 'smash', ask: 'Tin boar is about to SMASH.' }];
  const pending = readbackHtml({ items, answers: [{ action: 'guard', label: 'Guard', changed: false }], pending: true, temperature: 0 });
  assert.match(pending, /Per your last request/);
  assert.match(pending, /Practice rat makes an ordinary strike\.<\/span><strong class="rb-act">Guard<\/strong>/);
  assert.match(pending, /thinking…/);
  const done = readbackHtml({ items, answers: [{ action: 'quick', label: 'Quick strike', changed: true }, { action: 'guard', label: 'Guard', changed: false }], pending: false, temperature: 0 });
  assert.match(done, /class="changed"/);
  assert.match(done, /1 answer changed since the last read-back/);
  assert.doesNotMatch(done, /thinking/);
  assert.match(readbackHtml({ items, answers: [], pending: false, temperature: 0 }, { stale: true }), /changed the orders/);
  assert.match(readbackHtml({ items, answers: [], pending: false, error: 'The model took too long. No turn was spent.', temperature: 0 }), /role="alert">The model took too long/);
  assert.doesNotMatch(readbackHtml({ items: [{ id: 'x', ask: '<b>' }], answers: [], pending: false, temperature: 0 }), /<b>/, 'Text is escaped');
});

test('a trial records the drill kinds it meets, by the same names the drill uses', () => {
  for (const level of LEVEL_ORDER) for (const item of drillFor(level)) assert.equal(kindOf(item.state), item.id, `${level}/${item.id}`);
  // Forced moves are not decisions, so they are not met.
  assert.equal(kindOf(newGame('circuit')), null);
  const atRat = applyAction(newGame('circuit'), 'depart');
  assert.equal(kindOf(atRat), 'strike');
  assert.equal(kindOf({ ...atRat, hp: LOW_HP }), 'low');
});

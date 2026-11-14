import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyAction, availableActions, observation, nextMove, strikeDamage, commendations, MAX_TURNS, PRESETS, TUTORIAL_PRESETS, WARNING_PRESETS, PRIZE_PRESETS, LEVELS, LEVEL_ORDER, nextLevel } from '../src/game.js';
import { actionSchema, parseDecision, decisionMessages, normalizeDecisionOutput } from '../src/protocol.js';

// Scripted stand-ins for example orders. Test code only; never used as a controller in the game.
// "Quick strike every turn, except: guard against a SMASH, drink a potion when health is LOW,
//  and retreat from the optional prize fight."
function parry(s) {
  const ids = availableActions(s).map(a => a.id);
  const has = id => ids.includes(id);
  if (s.enemy) {
    if (s.enemy.optional) return 'retreat';
    if (has('potion') && s.hp <= 18) return 'potion';
    return nextMove(s.enemy).kind === 'smash' ? 'guard' : 'quick';
  }
  if (has('potion') && s.hp <= 18) return 'potion';
  return has('finish') ? 'finish' : has('depart') ? 'depart' : 'advance';
}
// "Always pick the strongest attack. Drink a potion when health is LOW. Skip the optional fight. Use the medic, the armorer's sword and the bench."
function brute(s) {
  const actions = availableActions(s);
  const has = id => actions.some(a => a.id === id);
  if (has('potion') && s.hp <= 18) return 'potion';
  if (s.enemy) {
    if (s.enemy.optional) return 'retreat';
    return strikeDamage(s, 'heavy') > strikeDamage(s, 'quick') && has('heavy') ? 'heavy' : 'quick';
  }
  for (const id of ['medic', 'buy_sword', 'rest', 'finish', 'depart']) if (has(id)) return id;
  return 'advance';
}
// "Fight every opponent. Use heavy strikes. Drink a potion whenever any health is missing. Buy whatever the armorer sells."
function reckless(s) {
  const ids = availableActions(s).map(a => a.id);
  const has = id => ids.includes(id);
  if (has('potion')) return 'potion';
  if (s.enemy) return has('heavy') ? 'heavy' : 'quick';
  for (const id of ['medic', 'buy_sword', 'buy_buckler', 'buy_potion', 'rest', 'finish', 'depart']) if (has(id)) return id;
  return 'advance';
}
// Stand-ins for the middle assignments' example orders.
// "Fight every opponent using quick strikes…" (the tutorial's orders, carried over)
const quickOnly = s => s.enemy ? 'quick' : availableActions(s).some(a => a.id === 'finish') ? 'finish' : s.status === 'ready' ? 'depart' : 'advance';
// "Quick strike every turn, except: guard against a SMASH." (Fair warning's orders, carried over to Prize money)
const guardSmash = s => s.enemy ? (nextMove(s.enemy).kind === 'smash' ? 'guard' : 'quick') : quickOnly(s);
// "Quick strike every turn, except: guard against a SMASH and drink a potion when health is LOW. Fight the prize bruiser,
//  buy only the sharper sword, skip the bench, and submit at camp as soon as you can."
function prizeCareful(s) {
  const ids = availableActions(s).map(a => a.id);
  if (ids.includes('potion') && s.hp <= 18) return 'potion';
  if (ids.includes('buy_sword')) return 'buy_sword';
  return guardSmash(s);
}
function simulate(policy, level = 'circuit') {
  let state = newGame(level);
  while (availableActions(state).length) state = applyAction(state, policy(state), 'rules-test');
  return state;
}
const play = (state, ...ids) => ids.reduce((s, id) => applyAction(s, id), state);
/** Walks onto stop `index` of the circuit from the stop before it, so the opponent there steps out with its real routine. */
const meet = (index, extra = {}) => applyAction({ ...newGame('circuit'), status: 'active', position: index - 1, ...extra }, 'advance');

test('reading the opponent wins the circuit with short orders', () => {
  const s = simulate(parry);
  assert.equal(s.status, 'won');
  assert.equal(s.stamps.length, 3);
  assert.equal(s.champion, true);
  assert.equal(s.position, 0);
  assert.equal(s.bigHitsTaken, 0, 'every smash was guarded');
  assert.ok(s.turn <= MAX_TURNS);
});
test('brute force with potions and a sword is a different way to win', () => {
  const s = simulate(brute);
  assert.equal(s.status, 'won');
  assert.ok(s.bigHitsTaken > 0, 'the brute takes smashes instead of guarding');
  assert.ok(s.sword > 0);
  assert.notDeepEqual(s.log.map(e => e.action), simulate(parry).log.map(e => e.action));
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
test('the assignments come in order, each walking its own course through the circuit', () => {
  assert.deepEqual(LEVEL_ORDER, ['tutorial', 'warning', 'prize', 'circuit']);
  assert.deepEqual(LEVEL_ORDER.map(nextLevel), ['warning', 'prize', 'circuit', null]);
  assert.deepEqual(LEVEL_ORDER.map(level => newGame(level).turnLimit), [12, 16, 30, MAX_TURNS]);
  for (const level of LEVEL_ORDER) {
    const visited = [];
    let s = newGame(level);
    do { s = applyAction({ ...s, enemy: null }, s.status === 'ready' ? 'depart' : 'advance'); visited.push(s.position); } while (s.position !== 0);
    assert.deepEqual([0, ...visited], [...LEVELS[level].course, 0], level);
    const sorted = [...LEVELS[level].course].sort((a, b) => a - b);
    assert.deepEqual(LEVELS[level].course, sorted, `${level} keeps circuit order`);
  }
});
test('each middle assignment loses its first draft to the one new thing, and wins with its careful orders', () => {
  // Fair warning: the tutorial's orders ignore the boar's announced SMASH, and the hero falls to Quickfoot.
  const charged = simulate(quickOnly, 'warning');
  assert.deepEqual([charged.status, charged.hp, charged.position], ['lost', 0, 7]);
  const warned = simulate(guardSmash, 'warning');
  assert.equal(warned.status, 'won');
  assert.deepEqual(warned.stamps, ['rat', 'boar', 'quickfoot']);
  assert.equal(warned.bigHitsTaken, 0);
  // Prize money: Fair warning's orders never drink a potion and fall to the champion with both unused.
  const thirsty = simulate(guardSmash, 'prize');
  assert.deepEqual([thirsty.status, thirsty.hp, thirsty.potions, thirsty.position], ['lost', 0, 2, 10]);
  const paid = simulate(prizeCareful, 'prize');
  assert.equal(paid.status, 'won');
  assert.deepEqual([paid.prizeWon, paid.sword > 0, paid.champion, paid.stamps], [true, true, true, ['quickfoot']]);
  assert.ok(paid.turn <= 24, `scripted, it leaves the model room for wasted turns (${paid.turn} of 30)`);
  // Each first draft is the previous assignment's careful orders, carried over.
  assert.equal(PRIZE_PRESETS.reckless, WARNING_PRESETS.careful);
  assert.match(WARNING_PRESETS.reckless, /quick strikes/);
  assert.deepEqual(LEVEL_ORDER.map(level => LEVELS[level].presets), [TUTORIAL_PRESETS, WARNING_PRESETS, PRIZE_PRESETS, PRESETS]);
});
test('the middle assignments announce moves and offer guard, and tell the hero what they require', () => {
  const boar = play(newGame('warning'), 'depart', 'quick', 'quick', 'advance');
  assert.equal(boar.enemy.name, 'Tin boar');
  assert.ok(availableActions(boar).some(a => a.id === 'guard'));
  const prompt = decisionMessages(WARNING_PRESETS.careful, observation(boar), availableActions(boar))[1].content;
  assert.match(prompt, /Turn 4 of 16\./);
  assert.match(prompt, /Training stamps collected: 1 of 3\. This assignment has no champion fight\./);
  assert.match(prompt, /about to SMASH \(Charge, 12 damage\)/);
  assert.match(observation(boar).objective, /^Earn the rat, boar, and Quickfoot stamps, return to camp/);
  const prize = observation(newGame('prize'));
  assert.match(prize.objective, /^Earn the Quickfoot stamp, defeat the champion, return to camp, and submit the assignment before 30 turns\.$/);
  assert.deepEqual([prize.progress.targetStamps, prize.progress.requiresChampion], [1, true]);
  const paid = simulate(prizeCareful, 'prize');
  assert.ok(paid.log.some(entry => /Champion defeated\. Return to camp with the training stamp\./.test(entry.detail)));
  assert.ok(paid.log.some(entry => /Earned a training stamp \(1\/1\)/.test(entry.detail)));
  assert.deepEqual(commendations(paid), [], 'commendations belong to the full circuit');
});
test('retreating around the introductory loop cannot complete its assignment', () => {
  let s = newGame('tutorial');
  while(availableActions(s).length)s=applyAction(s,s.enemy?'retreat':s.status==='ready'?'depart':'advance');
  assert.equal(s.status,'lost');
  assert.equal(s.turn,12);
  assert.deepEqual(s.stamps,[]);
});
test('wasting healing and taking every fight loses on the same course', () => {
  const s = simulate(reckless);
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
  const s = meet(7);
  assert.equal(s.enemy.name, 'Quickfoot');
  const hit = applyAction(s, 'heavy');
  assert.equal(hit.enemy.hp, 13);
  assert.equal(hit.stamina, 2);
  const retreat = applyAction(s, 'retreat');
  assert.deepEqual(retreat.stamps, []);
  assert.equal(retreat.hp, 38);
});
test('circuit opponents announce each move and repeat a fixed routine', () => {
  let s = meet(3);
  assert.deepEqual(nextMove(s.enemy), { kind: 'smash', name: 'Charge', damage: 12 });
  assert.equal(observation(s).enemy.nextMove.kind, 'smash');
  s = play(s, 'quick');
  assert.equal(s.hp, 40 - 12, 'an unguarded charge lands in full');
  assert.equal(nextMove(s.enemy).name, 'Gore');
  s = play(s, 'quick');
  assert.equal(nextMove(s.enemy).name, 'Charge', 'the routine starts over');
  assert.match(decisionMessages('x', observation(s), availableActions(s))[1].content, /about to SMASH \(Charge, 12 damage\)/);
});
test('guarding blocks part of a hit, and a guarded smash is countered at once', () => {
  const boar = meet(3, { stamina: 1 }); // Walking on restores 1, so the fight starts at 2.
  const guarded = play(boar, 'guard');
  assert.equal(guarded.hp, 40 - (12 - 8), 'guard blocks 8 of the 12-damage charge');
  assert.equal(guarded.stamina, 3, 'guard restores 1 stamina');
  assert.equal(guarded.enemy.hp, 18 - (12 - 2), 'the counter deals a heavy strike: 12 minus 2 armor');
  assert.match(guarded.log.at(-1).detail, /Countered for 10 damage/);
  assert.match(availableActions(boar).find(a => a.id === 'guard').detail, /^Against the SMASH: .*counter for 10/);
  const ordinary = play(meet(7), 'guard');
  assert.equal(ordinary.hp, 40, 'an ordinary 5-damage dart is fully blocked');
  assert.equal(ordinary.enemy.hp, 16, 'only a smash is countered');
  const finished = play({ ...boar, enemy: { ...boar.enemy, hp: 5 } }, 'guard');
  assert.equal(finished.enemy, null, 'a counter can win the fight');
  assert.deepEqual(finished.stamps, ['boar']);
});
test('the hero is told each condition plainly, as yes or no', () => {
  const text = decisionMessages('x', observation(meet(3)), availableActions(meet(3)))[1].content;
  assert.match(text, /- Enemy about to SMASH: yes/);
  assert.match(text, /- Health LOW: no/);
  assert.match(decisionMessages('x', observation(meet(5)), availableActions(meet(5)))[1].content, /- Optional prize fight: yes/);
});
test('bracing halves strikes, and openings let a potion go unanswered', () => {
  let champion = meet(10, { hp: 30 });
  champion = play(champion, 'quick');
  assert.equal(nextMove(champion.enemy).kind, 'brace');
  const before = champion.enemy.hp;
  assert.equal(before - play(champion, 'quick').enemy.hp, Math.floor((6 - 1) / 2), 'a braced quick strike deals half');
  const sipped = play(champion, 'potion');
  assert.equal(sipped.hp, Math.min(40, champion.hp + 18), 'no retaliation while it braces');
  let quickfoot = play(meet(7), 'guard', 'guard');
  assert.equal(nextMove(quickfoot.enemy).kind, 'winded');
  assert.equal(strikeDamage(quickfoot, 'heavy'), 12, 'a winded agile opponent cannot dodge');
});
test('the introductory assignment keeps its original rules and wording', () => {
  const s = play(newGame('tutorial'), 'depart');
  assert.deepEqual(availableActions(s).map(a => a.id), ['quick', 'heavy', 'retreat'], 'no guard');
  assert.equal(observation(s).enemy.nextMove, undefined, 'no announced moves');
  // The exact situation text the verified model run received.
  assert.equal(decisionMessages(TUTORIAL_PRESETS.careful, observation(s), availableActions(s))[1].content,
    'CURRENT SITUATION\nLocation: Practice rat. Turn 1 of 12.\nYour health is 40 out of 40. Health status: OK. You have 2 healing potions, 4 stamina, and 0 coins.\nTraining stamps collected: 0 of 1. This assignment has no champion fight.\nEnemy: Practice rat, 10 health, 3 damage. This enemy is not armored.  This fight gives a required training stamp.\n\nAVAILABLE ACTIONS\nquick: Quick strike. 6 damage, recover 1 stamina. Enemy retaliates if still alive.\nheavy: Heavy strike. 12 damage, costs 2 stamina. Enemy retaliates if still alive.\nretreat: Retreat. Take 2 damage and leave this fight. No training stamp earned.\n\nChoose the next action according to your standing orders.');
});
test('commendations reward different ways of winning, and none of the example plans earns all four', () => {
  const careful = commendations(simulate(parry));
  const forceful = commendations(simulate(brute));
  assert.deepEqual(careful.map(c => c.id), ['punctual', 'frugal', 'overtime', 'textbook']);
  assert.equal(careful.find(c => c.id === 'textbook').earned, true);
  assert.equal(forceful.find(c => c.id === 'textbook').earned, false);
  for (const list of [careful, forceful]) assert.ok(list.some(c => !c.earned));
  assert.deepEqual(commendations(play(newGame('tutorial'), 'depart', 'quick', 'quick', 'advance', 'advance', 'finish')), [], 'none in the tutorial');
  assert.deepEqual(commendations(newGame('circuit')), [], 'none before the trial is won');
});
test('the example orders stay short', () => {
  for (const orders of [...Object.values(PRESETS), ...Object.values(TUTORIAL_PRESETS)]) assert.ok(orders.split(/\s+/).length <= 40, orders);
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
test('Qwen3 adapter removes only WebLLM\'s exact empty thinking prefill', () => {
  const actions = availableActions(newGame());
  const valid = '{"action":"depart"}';
  const prefixed = `<think>\n\n</think>\n\n${valid}`;
  const qwen3 = 'Qwen3-8B-q4f32_1-MLC';
  assert.equal(parseDecision(normalizeDecisionOutput(prefixed, qwen3), actions), 'depart');
  assert.equal(normalizeDecisionOutput(valid, qwen3), valid);
  for (const raw of [`<think>Some reasoning</think>\n${valid}`, `Here is my answer: ${valid}`, `<think>\n\n</think>\n\n{"action":"win"}`]) {
    assert.throws(() => parseDecision(normalizeDecisionOutput(raw, qwen3), actions));
  }
  assert.throws(() => parseDecision(normalizeDecisionOutput(prefixed, 'Qwen2.5-3B-Instruct-q4f32_1-MLC'), actions));
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
test('each turn records its events in order, with the numbers as they stood at each one', () => {
  const boar = play(newGame('circuit'), 'depart', 'quick', 'quick', 'advance', 'advance');
  const guarded = applyAction(boar, 'guard').log.at(-1);
  assert.deepEqual(guarded.events.map(e => [e.actor, e.kind]), [['hero', 'guard'], ['foe', 'foe-blocked'], ['hero', 'counter']]);
  assert.deepEqual(guarded.events.map(e => [e.at.hp, e.at.foeHp]), [[37, 18], [33, 18], [33, 8]], 'the charge lands before the counter');
  const rat = play(newGame('circuit'), 'depart', 'quick', 'quick').log.at(-1);
  assert.deepEqual(rat.events.map(e => e.kind), ['strike', 'defeat', 'stamp'], 'the opponent falls, then the stamp is earned');
  assert.deepEqual(rat.events.map(e => e.at.stamps.length), [0, 0, 1]);
  assert.equal(play(newGame('circuit'), 'depart').log[0].events[0].kind, 'enter');
});
test('every logged turn ends on the numbers the state holds, and its events rebuild the log sentence', () => {
  for (const policy of [parry, brute, reckless]) {
    let s = newGame('circuit');
    while (availableActions(s).length) {
      s = applyAction(s, policy(s), 'rules-test');
      const entry = s.log.at(-1);
      assert.equal(entry.detail, entry.events.map(e => e.text).join(' ') || 'Moved along the course.');
      const last = entry.events.at(-1)?.at;
      if (last) assert.deepEqual([last.hp, last.stamina, last.potions, last.coins, last.stamps.length, last.champion], [s.hp, s.stamina, s.potions, s.coins, s.stamps.length, s.champion], `turn ${s.turn}`);
    }
  }
});

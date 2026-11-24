import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyAction, availableActions, TILES, LOW_HP, observation, nextMove, strikeDamage, commendations, PRESETS, TUTORIAL_PRESETS, LEVELS, LEVEL_ORDER } from '../src/game.js';
import { goalChecks, checklistHtml, isLimit, sceneFor, deltas, journalHtml, verdictFor, verdictHtml, actionTally, ordersSize, estimateTokens, TILE_ART, turnBeats, displayAt, turnFeedHtml, shoutFor, BEAT_MS, musicFor, clockUrgent } from '../src/view.js';
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

test('the checklist names what the engine checks: these opponents, submitting at camp, HP above 0 and the turn limit', () => {
  const labels = level => goalChecks(newGame(level)).map(check => check.label);
  assert.deepEqual(labels('tutorial'), ['Beat the practice rat', 'Submit at camp', 'Keep HP above 0', 'Stay within 12 turns']);
  assert.deepEqual(labels('warning'), ['Beat the practice rat', 'Beat the Tin boar', 'Beat Quickfoot', 'Submit at camp', 'Keep HP above 0', 'Stay within 16 turns']);
  assert.deepEqual(labels('prize'), ['Beat Quickfoot', 'Beat the champion', 'Submit at camp', 'Keep HP above 0', 'Stay within 30 turns']);
  assert.deepEqual(labels('circuit'), ['Beat the practice rat', 'Beat the Tin boar', 'Beat Quickfoot', 'Beat the champion', 'Submit at camp', 'Keep HP above 0', 'Stay within 32 turns']);
  const names = { rat: 'practice rat', boar: 'Tin boar', quickfoot: 'Quickfoot' };
  for (const level of LEVEL_ORDER) {
    const rules = LEVELS[level];
    const line = labels(level).join(' / ');
    // Exactly the opponents the engine requires: submitting is offered at camp with all of them beaten, and not with one missing.
    for (const [stamp, name] of Object.entries(names)) assert.equal(line.includes(name), rules.stamps.includes(stamp), `${level}: ${name}`);
    assert.equal(line.includes('champion'), rules.champion, `${level}: champion`);
    const ready = { ...newGame(level), status: 'active', position: 0, stamps: [...rules.stamps], champion: rules.champion };
    assert.ok(availableActions(ready).some(a => a.id === 'finish'), `${level}: everything named lets the hero submit`);
    for (const missing of [...rules.stamps, ...(rules.champion ? ['champion'] : [])]) {
      const short = missing === 'champion' ? { ...ready, champion: false } : { ...ready, stamps: rules.stamps.filter(st => st !== missing) };
      assert.equal(availableActions(short).some(a => a.id === 'finish'), false, `${level}: cannot submit without ${missing}`);
    }
    // "Within N turns": submitting as the last allowed turn still wins; the turn after the limit is never reached.
    const late = applyAction({ ...ready, turn: rules.turnLimit - 1 }, 'finish');
    assert.deepEqual([late.turn, late.status], [rules.turnLimit, 'won'], `${level}: submitting on turn ${rules.turnLimit} counts`);
    const timedOut = applyAction({ ...ready, stamps: [], champion: false, turn: rules.turnLimit - 1 }, 'advance');
    assert.equal(timedOut.status, 'lost', `${level}: the turns run out`);
  }
});
const row = check => `${check.state}${check.cause ? ' (cause)' : ''}: ${check.label}: ${check.note}`;
test('the goal checklist says, with evidence from the log, why a trial passed or failed', () => {
  assert.deepEqual(goalChecks(tutorialWin()).map(row), [
    'done: Beat the practice rat: Beaten on turn 3',
    'done: Submit at camp: Submitted on turn 6',
    'done: Keep HP above 0: Ended with 37 of 40 HP',
    'done: Stay within 12 turns: 6 of 12 used',
  ]);
  // Out of turns after retreating from every fight: the retreats are the evidence, the clock is the cause.
  assert.deepEqual(goalChecks(tutorialRetreats()).map(row), [
    'failed: Beat the practice rat: Retreated on turns 2, 6 and 10',
    'failed: Submit at camp: Needed the practice rat first',
    'done: Keep HP above 0: Ended with 34 of 40 HP',
    'failed (cause): Stay within 12 turns: All 12 used before submitting',
  ]);
  // Quick strikes at everything: two stamps, then health runs out at the optional prize fight.
  let brawl = newGame('circuit');
  while (availableActions(brawl).length) brawl = applyAction(brawl, brawl.enemy ? 'quick' : brawl.status === 'ready' ? 'depart' : 'advance');
  assert.deepEqual(goalChecks(brawl).map(row), [
    'done: Beat the practice rat: Beaten on turn 3',
    'done: Beat the Tin boar: Beaten on turn 10',
    'failed: Beat Quickfoot: Never reached',
    'failed: Beat the champion: Never reached',
    'failed: Submit at camp: Needed Quickfoot and the champion first',
    'failed (cause): Keep HP above 0: Ran out on turn 13, at Prize bruiser',
    'done: Stay within 32 turns: 13 of 32 used',
  ]);
  // Dying in a required fight names it; so does running out of turns mid-fight.
  const boar = play(newGame('circuit'), 'depart', 'quick', 'quick', 'advance', 'advance');
  assert.equal(goalChecks({ ...boar, hp: 0, status: 'lost' })[1].note, 'The hero went down fighting it, on turn 5');
  assert.equal(goalChecks({ ...boar, status: 'lost' })[1].note, 'Still fighting it when the turns ran out');
  // Everything beaten but never submitted.
  const ready = { ...newGame('tutorial'), status: 'lost', turn: 12, stamps: ['rat'] };
  assert.equal(goalChecks(ready)[1].note, 'Ready, but the turns ran out before submitting');
  // While the trial runs, nothing has failed yet.
  const running = goalChecks(boar);
  assert.deepEqual(running.map(check => check.state), ['done', 'open', 'open', 'open', 'open', 'open', 'open']);
  assert.equal(running[1].note, 'Fighting it now');
  // Short while the trial runs (one line beside the stage); the summary at the end lists the turns.
  let twice = newGame('tutorial');
  while (twice.log.filter(entry => entry.action === 'retreat').length < 2) twice = applyAction(twice, twice.enemy ? 'retreat' : twice.status === 'ready' ? 'depart' : 'advance');
  assert.deepEqual([twice.status, goalChecks(twice)[0].note], ['active', 'Retreated 2 times']);
  assert.equal(running[4].note, 'After the 3 opponents above');
  // Every assignment: one row per opponent to beat, then submit and the two limits; exactly one cause when lost.
  for (const level of LEVEL_ORDER) {
    const rules = LEVELS[level];
    assert.equal(goalChecks(newGame(level)).length, rules.stamps.length + (rules.champion ? 1 : 0) + 3);
  }
  for (const lost of [tutorialRetreats(), brawl]) assert.equal(goalChecks(lost).filter(check => check.cause).length, 1);
  assert.equal(goalChecks(tutorialWin()).some(check => check.cause), false);
});
test('before the first turn every condition is open, with the first opponent next', () => {
  assert.deepEqual(goalChecks(newGame('tutorial')).map(row), [
    'open: Beat the practice rat: Not reached yet',
    'open: Submit at camp: After the practice rat',
    'open: Keep HP above 0: Now 40 of 40 HP',
    'open: Stay within 12 turns: 0 of 12 used',
  ]);
  const start = goalChecks(newGame('circuit'));
  assert.deepEqual(start.map(check => Boolean(check.next)), [true, false, false, false, false, false, false]);
  assert.equal(start.some(check => check.warn), false);
});
test('during the trial the checklist ticks goals off and moves the next marker; after it, nothing is next', () => {
  const afterRat = goalChecks(play(newGame('circuit'), 'depart', 'quick', 'quick'));
  assert.deepEqual(afterRat.slice(0, 2).map(check => [check.state, Boolean(check.next)]), [['done', false], ['open', true]]);
  // Submitting is next once every opponent is beaten.
  const ready = goalChecks({ ...newGame('tutorial'), status: 'active', position: 2, stamps: ['rat'] });
  assert.deepEqual(ready.map(check => Boolean(check.next)), [false, true, false, false]);
  assert.equal(ready[1].note, 'Ready: head back to camp');
  for (const over of [tutorialWin(), tutorialRetreats()]) assert.equal(goalChecks(over).some(check => check.next), false);
});
test('a limit close to running out is flagged: health at LOW, and the clock when it turns red', () => {
  const s = { ...newGame('circuit'), status: 'active', turn: 1 };
  const warned = state => goalChecks(state).filter(check => check.warn).map(check => check.kind);
  assert.deepEqual(warned(s), []);
  assert.deepEqual(warned({ ...s, hp: LOW_HP }), ['health']);
  assert.deepEqual(warned({ ...s, hp: LOW_HP + 1 }), []);
  assert.deepEqual(warned({ ...s, turn: 24 }), ['turns']);
  assert.equal(clockUrgent({ ...s, turn: 24 }), true);
  assert.equal(clockUrgent({ ...s, turn: 23 }), false);
  // Once the trial is over, the limits are met or not; nothing is a warning any more.
  assert.deepEqual(warned({ ...s, hp: 5, turn: 30, status: 'won' }), []);
});
test('the checklist markup: goals with a count, then limits; marks, the cause, and newly met goals', () => {
  const lost = checklistHtml(goalChecks(tutorialRetreats()));
  assert.match(lost, /Goal <span class="checklist-count">0 of 2 done<\/span>/);
  assert.match(lost, /<ol class="checklist" aria-label="Goal">.*<\/ol>.*<ul class="checklist" aria-label="Limits">/);
  assert.equal((lost.match(/<li class="check /g) || []).length, 4);
  assert.match(lost, /class="check failed turns cause".*✗.*All 12 used before submitting <b class="check-cause">Ended the trial<\/b>/);
  assert.match(lost, /<span class="sr-only">: not met\.<\/span>/);
  const won = checklistHtml(goalChecks(tutorialWin()), new Set(['Submit at camp']));
  assert.match(won, /2 of 2 done/);
  assert.equal((won.match(/class="check done/g) || []).length, 4);
  assert.equal((won.match(/ fresh"/g) || []).length, 1, 'Only the goal met this turn is stamped');
  // An open goal shows its opponent; an open limit has no picture. The turn limit carries its gauge.
  const start = checklistHtml(goalChecks(newGame('tutorial')));
  assert.match(start, /class="check open stamp next"><span class="check-mark" aria-hidden="true"><img src="\.\/assets\/art\/rat\.webp"/);
  assert.match(start, /class="check open health"><span class="check-mark" aria-hidden="true"><\/span>/);
  assert.match(start, /<span class="check-track" aria-hidden="true"><span style="width: 0%"><\/span><\/span>/);
  assert.match(checklistHtml(goalChecks({ ...newGame('tutorial'), turn: 3 })), /style="width: 25%"/);
  // The verdict leaves the list to the checklist above the stage, and names what ended the trial.
  assert.doesNotMatch(verdictHtml(verdictFor(tutorialRetreats())), /class="check/);
  assert.match(verdictHtml(verdictFor(tutorialRetreats())), /All 12 turns used before the assignment was submitted\./);
  assert.equal(isLimit(goalChecks(newGame('tutorial'))[2]), true);
});
test('every stop on the circuit has a portrait, and so does every goal', () => {
  assert.equal(TILE_ART.length, TILES.length);
  for (const check of goalChecks(newGame('circuit')).filter(check => !isLimit(check))) assert.ok(check.art);
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
});
test('player text is escaped in rendered markup', () => {
  const s = play(newGame('tutorial'), 'depart');
  s.log[0].label = '<img src=x onerror=alert(1)>';
  assert.equal(journalHtml(s.log).includes('<img'), false);
});
test('the verdict names what went wrong and what the hero mostly did', () => {
  assert.equal(verdictFor(newGame()), null);
  const won = verdictFor(tutorialWin());
  assert.equal(won.tone, 'won');
  assert.match(won.hint, /^Next: Fair warning/);
  assert.match(won.text, /6 turns with 37 HP and 2 potions/);
  const overdue = tutorialRetreats();
  const lost = verdictFor(overdue);
  assert.equal(lost.stamp, 'Overdue');
  assert.equal(lost.text, 'All 12 turns used before the assignment was submitted.');
  assert.match(checklistHtml(goalChecks(overdue)), /Needed the practice rat first/, 'the checklist says what was missing');
  assert.equal(actionTally(overdue.log).find(t => t.label === 'Retreat').count, 3);
  let dead = newGame('circuit');
  while (availableActions(dead).length) dead = applyAction(dead, dead.enemy ? 'quick' : dead.status === 'ready' ? 'depart' : 'advance');
  assert.equal(dead.hp, 0);
  assert.equal(verdictFor(dead).stamp, 'Incident');
  assert.match(verdictFor(dead).text, /ran out of health/);
});
test('every assignment\'s map, wide and narrow, places exactly its own stops inside the drawing, apart from each other', () => {
  for (const compact of [false, true]) for (const level of LEVEL_ORDER) {
    const layout = mapLayout(level, compact);
    const stops = LEVELS[level].course.map(i => layout.pos[i]);
    for (const [x, y] of stops) assert.ok(x >= 30 && x <= layout.w - 30 && y >= 71 && y <= layout.h - 30, `${level} ${x},${y}`);
    for (const [i, [x, y]] of stops.entries()) for (const [x2, y2] of stops.slice(i + 1)) assert.ok(Math.hypot(x - x2, y - y2) >= 80, `${level} stops overlap`);
    assert.equal(renderMap(newGame(level), { compact }).body.match(/class="node /g).length, LEVELS[level].course.length, level);
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
test('rulebook: the four assignments, their stamps, champions and turn limits', () => {
  const rules = level => [LEVELS[level].stamps, LEVELS[level].champion, newGame(level).turnLimit];
  assert.deepEqual(rules('tutorial'), [['rat'], false, 12]);
  assert.deepEqual(rules('warning'), [['rat', 'boar', 'quickfoot'], false, 16]);
  assert.deepEqual(rules('prize'), [['quickfoot'], true, 30]);
  assert.deepEqual(rules('circuit'), [['rat', 'boar', 'quickfoot'], true, 32]);
  // Prize money is the circuit's second half: every stop from the purse on.
  assert.deepEqual(LEVELS.prize.course, [0, 4, 5, 6, 7, 8, 9, 10, 11]);
  // Opponents announce their moves from assignment 02 on.
  assert.deepEqual(LEVEL_ORDER.map(level => LEVELS[level].announced), [false, true, true, true]);
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
test('rulebook: in 02 and 03 the order of moves is new every trial, each move once per round; the champion never changes', () => {
  const movesOf = (level, seed, name) => {
    let s = newGame(level, seed);
    while (!s.enemy || s.enemy.name !== name) {
      const ids = availableActions(s).map(a => a.id);
      s = applyAction(s, ids.includes('quick') ? 'quick' : ids.includes('advance') ? 'advance' : ids[0]);
    }
    return s.enemy.routine.map(m => m.kind);
  };
  const orders = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const boar = movesOf('warning', seed, 'Tin boar');
    for (let round = 0; round < 8; round++) assert.deepEqual(boar.slice(round * 2, round * 2 + 2).sort(), ['smash', 'strike'], 'each round holds the routine once');
    orders.add(boar.slice(0, 6).join(' '));
    assert.deepEqual(movesOf('prize', seed, 'Arena champion'), ['strike', 'brace', 'smash', 'winded'], 'the champion keeps its routine');
  }
  assert.ok(orders.size > 3, 'trials meet the boar in different orders');
  assert.deepEqual(movesOf('warning', 7, 'Quickfoot'), movesOf('warning', 7, 'Quickfoot'), 'the same trial seed, the same order');
  assert.ok(new Set([1, 2, 3, 4, 5, 6].map(seed => movesOf('prize', seed, 'Quickfoot').slice(0, 6).join())).size > 1, 'Quickfoot varies in 03');
  // The full circuit and the introductory assignment ignore the seed; without one, routines are fixed everywhere.
  assert.deepEqual(movesOf('circuit', 7, 'Tin boar'), ['smash', 'strike']);
  assert.deepEqual(movesOf('warning', null, 'Tin boar'), ['smash', 'strike']);
  assert.equal(newGame('tutorial', 7).seed, null);
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
test('the orders size states words and tokens, and marks estimated tokens', () => {
  assert.deepEqual(ordersSize('   '), { words: 0, tokens: 0, exact: true, label: '0 words', note: '' });
  const text = 'Quick strike every turn, except: guard against a SMASH.';
  const estimate = ordersSize(`  ${text}\n`);
  assert.equal(estimate.words, 9);
  assert.equal(estimate.tokens, estimateTokens(text));
  assert.equal(estimate.exact, false);
  assert.equal(estimate.label, `9 words · about ${estimate.tokens} tokens`);
  assert.match(estimate.note, /estimated/i);
  // A model's count is used only for the text it counted.
  const counted = ordersSize(text, { text, tokens: 13, by: 'Qwen 2.5 · 3B' });
  assert.deepEqual([counted.tokens, counted.exact, counted.label, counted.note], [13, true, '9 words · 13 tokens', 'Tokens counted by Qwen 2.5 · 3B.']);
  assert.equal(ordersSize(`${text} Rest.`, { text, tokens: 13, by: 'Qwen 2.5 · 3B' }).exact, false, 'A count for older text is not shown as exact');
  assert.equal(ordersSize('Retreat!', { text: 'Retreat!', tokens: 1, by: 'x' }).label, '1 word · 1 token');
  // The size never rates or rewrites the orders.
  for (const orders of [...Object.values(PRESETS), ...Object.values(TUTORIAL_PRESETS)]) assert.deepEqual(Object.keys(ordersSize(orders)), ['words', 'tokens', 'exact', 'label', 'note']);
});

test('a turn plays back as the decision, then each event in order, with matching cues and floating numbers', () => {
  const boar = play(newGame('circuit'), 'depart', 'quick', 'quick', 'advance', 'advance');
  const after = applyAction(boar, 'guard', 'llm');
  const beats = turnBeats(boar, after.log.at(-1));
  assert.deepEqual(beats.map(b => b.kind), ['choice', 'guard', 'foe-blocked', 'counter']);
  assert.deepEqual(beats.map(b => b.actor), ['hero', 'hero', 'foe', 'hero']);
  assert.deepEqual(beats.map(b => b.sounds[0]), ['choose', 'guard', 'block', 'counter']);
  assert.deepEqual(beats[2].fx, [{ card: 'hero', tone: 'loss', text: '−4' }]);
  assert.deepEqual(beats[3].fx, [{ card: 'foe', tone: 'loss', text: 'Counter −10' }]);
  assert.equal(beats[0].ms, BEAT_MS.choice, 'a model\'s choice holds longer than one the player made');
  assert.equal(turnBeats(boar, applyAction(boar, 'guard', 'manual').log.at(-1))[0].ms, BEAT_MS.own);
  assert.equal(shoutFor('guard'), 'Guard!');
});
test('during playback the stage shows each beat\'s numbers, and the final state on the last beat', () => {
  const boar = play(newGame('circuit'), 'depart', 'quick', 'quick', 'advance', 'advance');
  const after = applyAction(boar, 'guard', 'llm');
  const beats = turnBeats(boar, after.log.at(-1));
  const at = i => displayAt(boar, after, beats, i);
  assert.deepEqual([at(0).hp, at(0).enemy.hp, at(0).turn, at(0).log.length], [37, 18, 6, 5], 'the choice: nothing has happened yet, but the turn is spent');
  assert.equal(sceneFor(at(2)).intent.name, 'Charge', 'the opponent\'s move stays on its card while it resolves');
  assert.deepEqual([at(2).hp, at(2).enemy.hp], [33, 18]);
  assert.equal(at(3), after);
  // A defeat changes the scene: from then on the stage shows the beaten opponent, and the stamp arrives on its own beat.
  const nearly = play(newGame('circuit'), 'depart', 'quick');
  const won = applyAction(nearly, 'quick', 'manual');
  const ratBeats = turnBeats(nearly, won.log.at(-1));
  assert.deepEqual(ratBeats.map(b => [b.kind, b.scene]), [['choice', false], ['strike', false], ['defeat', true], ['stamp', false]]);
  assert.equal(sceneFor(displayAt(nearly, won, ratBeats, 2)).mark, 'Defeated');
  assert.deepEqual(displayAt(nearly, won, ratBeats, 2).stamps, []);
  assert.deepEqual(displayAt(nearly, won, ratBeats, 3).stamps, ['rat']);
});
test('the play-by-play names the choice, strikes through the rest, and reveals lines one beat at a time', () => {
  const boar = play(newGame('circuit'), 'depart', 'quick', 'quick', 'advance', 'advance');
  const after = applyAction(boar, 'guard', 'llm');
  const entry = after.log.at(-1);
  const feed = index => turnFeedHtml({ entry, beats: turnBeats(boar, entry), offered: availableActions(boar), index }, 0.8);
  assert.match(feed(0), /Turn 6 · The hero chose · 0\.8 s/);
  assert.match(feed(0), /<strong>Guard<\/strong>/);
  assert.equal((feed(0).match(/<s>/g) || []).length, 4, 'the four options not taken');
  assert.equal((feed(0).match(/beat [^"]*shown/g) || []).length, 0);
  assert.equal((feed(2).match(/beat [^"]*shown/g) || []).length, 2);
  assert.match(feed(2), /actor-foe shown now/);
  // Kept for review at a stop: the whole turn at rest, every line shown and none of it animating as new.
  const kept = feed(Infinity);
  assert.equal((kept.match(/beat [^"]*shown/g) || []).length, 3);
  assert.equal(/\bnow\b/.test(kept), false);
});
test('a random pick is labelled as one everywhere, plays back like a model\'s choice, and the verdict credits luck', () => {
  const boar = play(newGame('circuit'), 'depart', 'quick', 'quick', 'advance', 'advance');
  const entry = applyAction(boar, 'guard', 'random').log.at(-1);
  const beats = turnBeats(boar, entry);
  assert.equal(beats[0].ms, BEAT_MS.choice, 'the reveal holds as long as a model\'s choice');
  assert.match(turnFeedHtml({ entry, beats, offered: availableActions(boar), index: 0 }, 0.8), /Turn 6 · Picked at random<\/span>/, 'no model time is shown');
  assert.match(journalHtml([entry]), /class="log-source src-random">Random pick</);
  // The verdict never says the hero followed orders it ignored.
  const randomWin = ['depart', 'quick', 'quick', 'advance', 'advance', 'finish'].reduce((s, id) => applyAction(s, id, id === 'quick' ? 'random' : 'auto'), newGame('tutorial'));
  assert.match(verdictFor(randomWin).hint, /^Luck, not orders: the hero picked at random\. Next: Fair warning/);
  let randomLoss = newGame('tutorial');
  while (availableActions(randomLoss).length) randomLoss = applyAction(randomLoss, randomLoss.enemy ? 'retreat' : randomLoss.status === 'ready' ? 'depart' : 'advance', randomLoss.enemy ? 'random' : 'auto');
  assert.match(verdictFor(randomLoss).hint, /ignored the orders and picked at random/);
  assert.doesNotMatch(verdictFor(randomLoss).hint, /did exactly what the orders said/);
  assert.match(verdictFor(tutorialRetreats()).hint, /did exactly what the orders said/);
});

test('the music follows the trial: desk, trial, stingers, and one layer each for LOW health and the red clock', () => {
  const fresh = newGame('circuit');
  assert.deepEqual(musicFor(fresh), { cue: 'desk', intensity: 0 });
  assert.deepEqual(musicFor(fresh, true), { cue: 'trial', intensity: 0 }, 'A run starts the trial music before its first turn shows');
  const urgentFrom = fresh.turnLimit - Math.ceil(fresh.turnLimit / 4);
  const at = (turn, hp) => musicFor({ ...fresh, status: 'active', turn, hp });
  assert.deepEqual(at(1, fresh.hp), { cue: 'trial', intensity: 0 });
  assert.equal(at(urgentFrom - 1, LOW_HP + 1).intensity, 0);
  assert.equal(clockUrgent({ ...fresh, turn: urgentFrom }), true, 'The music and the red turn counter share one rule');
  assert.equal(at(urgentFrom, LOW_HP + 1).intensity, 1, 'The red clock adds a layer');
  assert.equal(at(5, LOW_HP).intensity, 1, 'Health at LOW adds a layer');
  assert.equal(at(urgentFrom, LOW_HP).intensity, 2, 'Both add two');
  assert.deepEqual(musicFor({ ...fresh, status: 'won', turn: 30, hp: 3 }), { cue: 'won', intensity: 0 });
  assert.deepEqual(musicFor({ ...fresh, status: 'lost', turn: 13, hp: 0 }), { cue: 'lost', intensity: 0 });
});

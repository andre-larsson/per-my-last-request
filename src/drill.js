// The read-back drill: a short list of situations from the current assignment that the hero answers with the
// player's orders before a trial, so the player sees how the orders were understood.
//
// The situations are real engine states, reached by walking the assignment's course with a fixed route (fight with
// quick strikes, guard a SMASH, drink at LOW, take the prize fight where it steps out, walk past it where it waits to be
// challenged, pass every other stop). The route only finds the states; it never plays the hero. The hero's answers come from the model, asked exactly as in a trial.
import { newGame, availableActions, applyAction, currentTile, nextMove, LOW_HP, LEVELS } from './game.js';

const ids = s => availableActions(s).map(a => a.id);
const over = s => s.status === 'won' || s.status === 'lost';
const fightOf = s => s.enemy && !s.enemy.optional ? nextMove(s.enemy).kind : null;

function route(s) {
  const offered = ids(s);
  if (offered.includes('potion') && s.hp <= LOW_HP) return 'potion';
  if (s.enemy) return nextMove(s.enemy).kind === 'smash' && offered.includes('guard') ? 'guard' : 'quick';
  if (offered.includes('medic')) return 'medic';
  if (offered.includes('buy_sword')) return 'buy_sword';
  return offered.find(id => ['finish', 'depart', 'advance'].includes(id));
}
const HURT = 28; // Hurt, not LOW: the medic and a potion are both offered, and neither is needed.
const notLow = s => ({ ...s, hp: Math.max(s.hp, LOW_HP + 6) }); // LOW health is a situation of its own.

// What each situation is, in the order the memo lists them. `find` picks the first state of that kind on the route;
// `adjust` makes the variant the drill needs: LOW health only in the LOW situation, and elsewhere hurt, with a potion,
// so that the medic and a potion are offered where a hero might take them unasked.
const KINDS = [
  { id: 'strike', find: s => fightOf(s) === 'strike', adjust: notLow,
    ask: s => LEVELS[s.level].announced ? `${s.enemy.name} makes an ordinary strike.` : `In a fight with the ${s.enemy.name.toLowerCase()}.` },
  { id: 'smash', find: s => fightOf(s) === 'smash', adjust: notLow, ask: s => `${s.enemy.name} is about to SMASH.` },
  { id: 'brace', find: s => fightOf(s) === 'brace', adjust: notLow, ask: s => `${s.enemy.name} is BRACING.` },
  { id: 'winded', find: s => fightOf(s) === 'winded', adjust: notLow, ask: s => `${s.enemy.name} is WINDED.` },
  { id: 'low', find: s => fightOf(s) === 'strike', adjust: s => ({ ...s, hp: Math.min(s.hp, LOW_HP - 3) }), ask: () => 'Your health is LOW in a fight.' },
  // In the full circuit the prize fighter waits to be challenged (`challenge`): the decision is taken before the fight.
  { id: 'prize', find: s => s.enemy?.optional || ids(s).includes('challenge'), adjust: notLow, ask: s => `The optional prize fight: the ${(s.enemy?.name ?? currentTile(s).name).toLowerCase()}.` },
  { id: 'medic', find: s => !s.enemy && currentTile(s).kind === 'medic', adjust: s => ({ ...s, hp: HURT }), ask: () => 'At the field medic, hurt.' },
  { id: 'shop', find: s => ids(s).some(id => id.startsWith('buy_')), ask: s => `At the armorer, with ${s.coins} coins.` },
  { id: 'bench', find: s => ids(s).includes('rest'), ask: () => 'At the bench, tired.' },
  { id: 'road', find: s => !s.enemy && currentTile(s).kind === 'road' && s.turn > 0, adjust: s => ({ ...s, hp: HURT }), ask: () => 'On the road, hurt but not LOW.' },
  { id: 'camp', find: s => ids(s).includes('finish'), adjust: s => ({ ...s, hp: Math.min(s.hp, HURT), potions: Math.max(s.potions, 1) }), ask: () => 'Back at camp, ready to submit.' },
];

/**
 * The drill line a decision belongs to, or null: a forced move, or a stop the drill does not ask about. The game
 * records the kinds a trial meets, and a read-back asks only about those, so a first trial stays a surprise.
 */
export function kindOf(s) {
  const offered = ids(s);
  if (offered.length < 2) return null;
  if (s.enemy) return s.enemy.optional ? 'prize' : s.hp <= LOW_HP ? 'low' : nextMove(s.enemy).kind;
  if (offered.includes('challenge')) return 'prize';
  if (offered.includes('finish')) return 'camp';
  if (offered.includes('medic')) return 'medic';
  if (offered.some(id => id.startsWith('buy_'))) return 'shop';
  if (offered.includes('rest')) return 'bench';
  return currentTile(s).kind === 'road' ? 'road' : null;
}

const cache = new Map();
/**
 * The drill for an assignment: [{ id, ask, state }], one state per kind of decision that the assignment has, each with
 * more than one offered action. Pure and deterministic; computed once per assignment.
 */
export function drillFor(level) {
  if (cache.has(level)) return cache.get(level);
  const found = new Map();
  let s = newGame(level);
  for (let guard = 0; !over(s) && guard < 200; guard++) {
    for (const kind of KINDS) if (!found.has(kind.id) && kind.find(s)) found.set(kind.id, s);
    const offered = ids(s);
    s = applyAction(s, offered.length === 1 ? offered[0] : route(s), 'auto');
    s.log = [];
  }
  const list = KINDS.filter(kind => found.has(kind.id)).map(kind => {
    const state = kind.adjust ? kind.adjust(found.get(kind.id)) : found.get(kind.id);
    return { id: kind.id, ask: kind.ask(state), state: { ...state, log: [] } };
  }).filter(item => availableActions(item.state).length > 1);
  cache.set(level, list);
  return list;
}

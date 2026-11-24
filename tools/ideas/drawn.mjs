// Drawn moves, shared by the idea experiments: each opponent's move is drawn at random every turn from its own
// routine (the same moves, in the same proportions), from a seed. Not in the game, whose routines are fixed cycles.
import * as G from '../../src/game.js';
import { TELLS, FEINT_SHARE } from './tells.mjs';

export const rngOf = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const FOE_KEY = { 'Practice rat': 'rat', 'Tin boar': 'boar', 'Prize bruiser': 'bruiser', Quickfoot: 'quickfoot', 'Arena champion': 'champion' };
export const over = s => s.status === 'won' || s.status === 'lost';

/** A newly met opponent gets its moves for the whole fight: drawn from its routine, each with a sentence. */
export function drawFight(s, seed) {
  const e = s.enemy;
  if (!e || e.drawn) return s;
  // One stream per seed, stop and lap, so every hero meets the same fight whatever it did before.
  const rng = rngOf(seed * 7919 + s.position * 104729 + s.lap * 1299709);
  const pools = TELLS[FOE_KEY[e.name]];
  const base = e.routine;
  e.routine = Array.from({ length: 64 }, () => {
    const m = base[Math.floor(rng() * base.length)];
    const feint = m.kind !== 'smash' && pools.feint && rng() < FEINT_SHARE;
    const pool = feint ? pools.feint : pools[m.kind];
    return { ...m, feint: Boolean(feint), tell: pool[Math.floor(rng() * pool.length)] };
  });
  e.drawn = true;
  return s;
}
/** One action on the real engine. With a seed, a newly met opponent's moves are drawn; without, its routine stays fixed. */
export const step = (s, id, seed) => { const next = G.applyAction({ ...s, log: [] }, id, 'bot'); next.log = []; return seed == null ? next : drawFight(next, seed); };

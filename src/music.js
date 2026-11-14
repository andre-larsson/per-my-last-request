// Background music: one musicbox score (assets/music/after-hours.scrim), played by a Web Audio synthesizer. No audio files.
// The player is vendored from github.com/andre-larsson/musicbox at commit e371a2c (Apache 2.0; see vendor/musicbox/NOTICE).
// It runs on its own AudioContext, so the music and sound-effect switches stay independent.
import { MusicPlayer } from '../vendor/musicbox/player.js';

const SCORE_URL = new URL('../assets/music/after-hours.scrim', import.meta.url);
const VOLUME = 0.25; // Under the sound effects. See GAME_NOTES.md for the measured levels.
const PAUSED_VOLUME = 0.1; // Pause lowers the music by 8 dB instead of stopping it.
const STINGERS = new Set(['won', 'lost']);

let player = null;
let enabled = true;
let started = false;
let failed = false;
let want = { cue: 'desk', intensity: 0, paused: false };
let asked = null; // The cue last asked of the player, so a switch happens once per change in the game.
let volume = VOLUME;

// Fetched at once, so the first click can start the music inside its own gesture, as Safari requires.
const ready = fetch(SCORE_URL)
  .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.text(); })
  .then(text => { player = new MusicPlayer({ volume: VOLUME, intensity: 0 }); player.load(text); })
  .catch(error => { failed = true; console.warn('Music unavailable:', error.message); });

/** Call from any click or key press. Starts the music the first time, if it is switched on. */
export function unlockMusic() {
  if (!enabled || failed || !player) return;
  try {
    player.unlock();
    if (!started) {
      started = true;
      asked = want.cue;
      player.play(want.cue, { intensity: want.intensity });
      applyVolume();
    }
  } catch (error) { failed = true; console.warn('Music unavailable:', error.message); }
}

export function setMusicEnabled(on) {
  enabled = on;
  if (!player) return;
  if (on) unlockMusic();
  else if (started) { player.stop(1); started = false; asked = null; }
}
export const musicEnabled = () => enabled;
/** True while music is audible, so the win and loss chimes can leave the moment to the music. */
export const musicPlaying = () => Boolean(enabled && started && player?.state.playing);

/**
 * Follows the game: `cue` is desk, trial, won or lost; `intensity` adds layers (0–2); `paused` lowers the volume.
 * Safe to call on every render: nothing happens unless something changed.
 */
export function setMusic(next) {
  want = next;
  if (!started || !player) return;
  try {
    if (next.cue !== asked) {
      asked = next.cue;
      if (STINGERS.has(next.cue)) player.goto(next.cue, { restart: true });
      else if (!alreadyThere(next.cue)) player.goto(next.cue);
    }
    player.setIntensity(next.cue === 'trial' ? next.intensity : 0);
    applyVolume();
  } catch (error) { console.warn('Music switch failed:', error.message); }
}
// A stinger hands back to the desk by itself (its `then` line). The player still names the stinger as its target then,
// so asking for the desk again would restart it from the top.
function alreadyThere(cue) {
  const { cue: audible, target } = player.state;
  return audible === cue && (target === cue || player.song.cues[target]?.then === cue);
}
function applyVolume() {
  const next = want.paused ? PAUSED_VOLUME : VOLUME;
  if (next === volume) return;
  volume = next;
  player.setVolume(next);
}

/** For tests and reports. */
export const musicState = () => ({ enabled, started, failed, cue: started ? player?.state.cue ?? null : null, asked, intensity: player?.intensity ?? 0, volume });
export { ready as musicReady };

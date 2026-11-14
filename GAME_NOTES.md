# Game notes

For the next session. Keep it short.

## Interface (redesigned 2026-11-14, provisional until playtested)

The previous interface is tagged `ui-before-redesign` for side-by-side comparison.

Decisions made without a playtester. Overrule freely.

- **Three numbered columns**: 1 Write the orders, 2 Watch the trial, 3 Read the report. They become two columns under 1360 px and one under 900 px (trial, report, orders).
- **The stage is the only dark surface**, so the eye lands on it first. It holds two cards: the hero (HP, stamina, potions, coins, sword) and the current opponent or place. HP numbers are the largest text in the game.
- **Controls sit directly under the stage** and do not move during a run. Under 900 px they are a fixed bar at the bottom of the screen.
- **One primary button at a time**: load the model, then run, pause, continue, run again, or next assignment. "Play manually" is offered beside the load button.
- **Teaching happens in place**: the checklist shows the assignment as steps; each option shows its consequence text from the engine; trait chips are explained on the line under the cards; "What the hero is told this turn" shows the exact prompt. The Rulebook dialog is reference only.
- **The map moved below the fold** on laptop screens. It is context, and the stage carries the action.
- **Editing orders mid-trial** now restarts the trial on the next Run or One decision (before, One decision silently kept the old orders). A notice under the letter says so.
- **Switching assignment** restores the orders last written for it, instead of overwriting them with the first example.
- **Pause between decisions** in a run is 700 ms (was 350 ms), so a person can follow. `DECISION_PAUSE_MS` in `src/app.js`.
- **Restart is hidden at turn 0.** There is nothing to restart.
- **Model loading has no total time limit.** It fails after five minutes without a progress report (`LOAD_SILENCE_MS` in `src/model.js`). The old 15-minute cap cut off a 1.7 GB download at 84% on a slow connection.

## Art

Style preamble, used at the start of every request (full requests in `assets-src/wanted-images.tsv`):

> Illustration for a comic fantasy browser game about an adventurers' guild that runs on paperwork. Hand-inked storybook illustration with confident dark green-black ink outlines and flat gouache colour, a limited palette of forest green, rust red, ochre yellow, warm grey-brown and cream, gentle paper grain, a soft shadow under the subject, no gradients, no photorealism. Square. A single subject, centred, on a plain flat warm cream background (#f4ecd8). No text, borders or frames.

- 13 portraits in use: hero, 5 opponents, 7 places. Originals (1254 px) are in `assets-src/raw/`; `python3 tools/art.py` cuts them to 384 px WebP in `assets/art/`.
- Two variants exist for the hero and the champion. `PICKS` in `tools/art.py` selects `hero-a` and `champion-a`.
- The art's paper colour is about `#f4e6cc` (`--art` in `style.css`). Portrait frames and map discs use it so the square edges do not show.
- No images are queued. A missing portrait falls back to a letter placeholder.

## Tools

- `node tools/shots.mjs [dir]`: screenshots of setup, fight, win, loss, low health and death at 1440, 1180 and 390 px, using the Manual sandbox. Also lists rendered text under 12 px and any horizontal overflow.
- `python3 tools/art.py`: rebuilds `assets/art/` from `assets-src/raw/`.
- `npm run test:browser`: manual play through the real controls, then the LLM-mode controls against a stub worker the test injects (no inference). `npm run test:llm -- --full`: real inference; `QUEST_LOAD_MINUTES=60` allows a slow first download, and `QUEST_PROFILE=artifacts/llm-test-profile` keeps the downloaded model between test runs. Results are in `VERIFICATION.md`.

## Determinism

The engine is deterministic: no randomness, fixed course. Model output is not guaranteed to repeat across devices or model builds.

## Open playtest questions

- What did you look at first on the setup screen?
- Could you finish the first assignment without opening the Rulebook?
- Is 700 ms between decisions too slow once you know the game?
- On a laptop, do you miss the map while watching a run?
- Does "Run again" after a loss feel right, given that it restarts immediately?

# Game notes

For the next session. Keep it short.

## Battle balance (reworked 2026-11-14)

The previous balance is tagged `balance-before`. The user chose all four changes: enemy intents with Guard, an armorer choice with a paying side bet, commendations, and a tighter clock, keeping overall difficulty about the same. **The full circuit only.** The introductory assignment is unchanged; `tests/game.test.mjs` pins its exact prompt text, because it is the verified model demo.

- **Announced moves.** Each circuit opponent repeats a fixed routine and announces its move before the hero acts: *strike* (ordinary hit), *smash* (big hit), *brace* (no hit, strikes deal half), *winded* (no hit, agile cannot dodge). The prompt uses the same capitalised words (SMASH, BRACING, WINDED, LOW) so orders can match them directly.
- **Guard** (circuit only): deal nothing, block 8 (14 with buckler), +1 stamina. **Guarding a smash counters automatically** for a heavy strike's damage. The first design (guarding a smash staggers; the *next* strike deals double) worked for bots, but Qwen 3B could not follow a two-step rule like "after a stagger, use heavy". The counter keeps the payoff in one decision.
- **Checklist.** Circuit prompts end with yes/no lines (Enemy about to SMASH, Enemy BRACING, Enemy WINDED, Health LOW, Optional prize fight), in and out of fights. The probe went from 6 to 8 of 10 with it at the time; it also stopped the model drinking potions on the road at high health.
- Routines: rat Nibble 3; boar Charge 12 → Gore 4; bruiser (20 HP, pays 6) Jab 5 → Haymaker 14 → Showboat; Quickfoot Dart 5 → Dart 5 → Out of breath; champion (**30 HP**) Jab 7 → Raise shield → Overhead smash 18 → Catch breath. Laps add 1 damage per move.
- **Armorer**: sword (+2) or buckler for 8 coins, potion for 6, each a turn. Without the bruiser you can afford one item, and with it two.
- **Bench** now also heals 6 (was stamina only; only 17 of 254 winners used it). **Turn limit 38 → 32.**
- **Old values, for reverting:** limit 38, sword 6 coins, bruiser 14 HP and 2 coins, bench stamina only, champion 32 HP hitting 9 every turn. During this rework the champion was 32 HP with the routine; it went to 30 because two real-model runs died to it about 2 HP short (bots: 54% → 56% of styles win).
- **Commendations** (optional, shown in the verdict): Ahead of schedule (by turn 26), No expense claims (no potion drunk), Overtime (beat the bruiser), By the book (no unguarded smash). They pull in different directions; 3 of 301 winning styles earn all four.
- **Example orders** are one sentence: careful "Quick strike every turn, except: guard against a SMASH, drink a potion when health is LOW, and retreat from the optional prize fight." A heavy-based example ("Use heavy strikes, but guard…") was tried and dropped: the 3B then skipped guards and retreated from stamp fights. The reckless example loses to the champion's smash.
- **Complexity meter** under the orders (`ordersComplexity` in `src/view.js`): instructions + condition words (+1 per 40 words). Simple ≤ 7, moderate ≤ 11, complex above. A warning only, at the user's request; no penalty.

Proxies (`node tools/balance.mjs`, 540 scripted order styles; before → after). The user's targets: at least 3 fight approaches win; reading clearly beats a fixed recipe; a good plan wins ≥ 70% with 10% random decisions; every stop and action is used by some winner; about half of simple orders win.

| Proxy | Before | After |
|---|---|---|
| Styles that win | 53% | 56% |
| Wins, ignoring the enemy / guarding smashes / full reading | 53 / 53 / 53% (no difference possible) | 31 / 66 / 70% |
| Quick-strike orders that win | 7% (only with no reading possible) | 43% when they read the enemy, 0% otherwise |
| Best plan per approach, 10% random decisions | 77% | 74–80% across all 8 viable approaches |
| Undominated ways to win: boar / Quickfoot / champion (plain gear) | 2 / 1 / 1 | 2 / 5 / 4 |
| Winners using guard / bench / buckler / bruiser | – / 39 / – / 0 of 288 | 245 / 170 / 93 / 115 of 301 |

Every action is used by some winner (`upgrade` in the usage list is the old engine's sword action, kept so the harness can still measure `balance-before`). Median winning trial: 29 of 32 turns.

Known soft spots: brute force ("always the strongest attack, potion when LOW") still wins about as reliably as reading under random slips, but ends with fewer potions and fewer commendations. That is intended as a second viable style. Quick-only orders without reading never win (armor). Bots see outcomes perfectly; a person or model may find reading harder than these numbers suggest.

**Real model (Qwen 2.5 3B, hardware WebGPU), careful example orders:**

- `node tools/probe.mjs`: 11 of 13 fixed decisions as intended. It misses retreating from the prize bruiser and drinking a potion at LOW health mid-fight (it strikes instead). It gets every SMASH guard, every BRACING and WINDED turn, and drinks at LOW on the road.
- `npm run test:llm -- --circuit`, champion 30 HP: **won**, with 1 HP and 3 stamps; the champion fell on turn 29 and the hero submitted on turn 32, the last allowed. Narrow and untidy: it guarded 2 of 4 smashes (it struck into the boar's first two charges at high health), never guarded an ordinary hit, retreated from the bruiser on its first decision, and drank both potions on the road (at 1 and 17 HP) rather than mid-fight. One run, not a reliability claim.
- Earlier runs during the rework: an older example ("Guard when…smash, then heavy… Otherwise quick") guarded the rat for 31 turns. With the checklist and current example at champion 32 HP, two runs reached the champion and died about 2 HP short.

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
- **Pause between decisions**: replaced by turn playback (below). The old fixed 700 ms pause is gone.
- **Restart is hidden at turn 0.** There is nothing to restart.
- **Model loading has no total time limit.** It fails after five minutes without a progress report (`LOAD_SILENCE_MS` in `src/model.js`). The old 15-minute cap cut off a 1.7 GB download at 84% on a slow connection.

## Turn playback (added 2026-11-14, provisional until playtested)

User request: make each decision and its consequences easy to follow, with sound, and hide the model's thinking time behind the time spent reading. The previous flow is tagged `before-turn-playback`.

- **The engine resolves a turn at once; the stage replays it.** `applyAction` now logs `events` per turn (actor hero/foe/world, kind, text, and the numbers at that moment). `detail` is still the joined sentence; one wording change: a defeat now reads "X defeated." before "Earned a training stamp". The prompt is unchanged (it never included the log).
- **Beats** (`turnBeats`, `displayAt`, `turnFeedHtml` in `src/view.js`): the choice, then each event in engine order. The stage shows the old situation with each beat's numbers until something changes the scene (new stop, defeat, retreat, end), then the new one. Turn counter advances on the choice.
- **What shows a beat:** the hero's speech bubble with the action ("Guard!"); a yellow glow on whoever acts; the opponent's move box switches to "Now" and flashes when it acts; floating numbers (HP, counter, coins); a play-by-play under the fighters with small portraits per line and the passed-over options struck through; the options panel stamps "Chosen" and strikes the rest; the turn card under the controls fills in line by line.
- **Durations at normal pace** (`BEAT_MS`): options stay up at least 1.4 s before a model's choice is revealed; the choice holds 1.1 s (0.6 s for the player's own or a forced move); an event 0.75 s + 45 ms per word; defeat, stamp, champion, win and loss 1.3 s. **Pace** cycles Normal → Fast (×0.5) → Slow (×1.6), stored per browser. A fight turn takes about 3.5–5 s at normal pace. **Skip** ends a turn's playback.
- **The model reads ahead.** During a run, the next decision is requested as soon as a turn resolves. It is used only for the same trial (epoch) and state (revision); Pause, Restart, mode or model change drop it. Requests queue (the worker takes one at a time). Pause lets the turn on screen finish. "One decision" never reads ahead. Each decision records `preparedAhead` and `waitedMs` (visible wait beyond the 1.4 s minimum).
- **Measured with the real model** (Qwen 2.5 3B, RTX 4090, careful orders, normal pace): 24 of 26 circuit decisions were ready before their options went up; the hero visibly waited 0 ms in total; the circuit took 122 s on screen (the old flow took roughly 26 × (0.7 s model + 0.7 s pause) plus forced moves, about 40 s). Slower GPUs are unmeasured; `waitedMs` in the exported report shows it.
- **Manual sandbox** plays turns back too, with a shorter choice beat; no new action can be clicked until the turn finishes or is skipped.
- **Sound** (`src/sound.js`): synthesized WebAudio, no files, on by default with a ♪ toggle stored per browser. A rubber-stamp thunk for every decision (the guild runs on paperwork), whoosh-and-thwack strikes, a wooden knock for raising a guard, a muted clang when a hit lands on the guard, a low thud when the hero is hurt, a soft huff when the opponent idles, low "heartbeat" pulses when a SMASH is announced, chimes for healing, coins, stamps, win and loss. Kept low and short; no loops. Offline levels: −25 to −37 dB RMS for most cues, footsteps and the idle huff quieter, peaks ≤ 0.42.
- **Height:** the play-by-play and the situation text share one grid cell, so the stage is as tall as the taller of the two. This leaves some blank stage under the situation text after a busy turn, but the Run/Pause button does not jump between turns.

## Browser setup guide (added 2026-11-14)

- **Get WebGPU on Windows, Mac or Linux** sits under the model status in **Who plays the hero?**. It is a collapsed four-line guide: Windows, Mac, Linux, and "still not working?". It opens by itself when the device check finds no WebGPU or only software graphics, and the blocked status line points to it. The README has the full table and the Linux command line.
- Browser versions come from the gpuweb implementation-status wiki (last edited 2026-10-02). Only Chrome on Linux with NVIDIA (X11, `npm run play` flags) is tested. Update both the guide and the README table when browsers ship (Firefox on Linux is expected in 2026).
- `npm run play` now finds Chrome (falling back to Edge) in the standard macOS and Windows install folders. That path is untested on those systems; `CHROME=` still overrides it.

## Art

Style preamble, used at the start of every request (full requests in `assets-src/wanted-images.tsv`):

> Illustration for a comic fantasy browser game about an adventurers' guild that runs on paperwork. Hand-inked storybook illustration with confident dark green-black ink outlines and flat gouache colour, a limited palette of forest green, rust red, ochre yellow, warm grey-brown and cream, gentle paper grain, a soft shadow under the subject, no gradients, no photorealism. Square. A single subject, centred, on a plain flat warm cream background (#f4ecd8). No text, borders or frames.

- 13 portraits in use: hero, 5 opponents, 7 places. Originals (1254 px) are in `assets-src/raw/`; `python3 tools/art.py` cuts them to 384 px WebP in `assets/art/`.
- **The hero is now a rugged anti-hero** (user request, 2026-11-14): a scarred sellsword who joined for the pay and follows orders to the letter, with commentary. Portrait `hero-e` (chewing grass, holding the orders at arm's length) is a provisional pick; `hero-c` (sword on shoulder) and `hero-d` (arms crossed) are alternatives. The original hapless applicant is `hero-a`. Copy follows the character: card kicker "Your sellsword", "would like to discuss the fee", "did exactly what the orders said, and would like that noted". The model's system prompt is unchanged.
- `PICKS` in `tools/art.py` selects `hero-e` and `champion-a`.
- The art's paper colour is about `#f4e6cc` (`--art` in `style.css`). Portrait frames and map discs use it so the square edges do not show.
- No images are queued. A missing portrait falls back to a letter placeholder.

## Tools

- `node tools/balance.mjs [engine.js] [--solve] [--json out.json]`: balance proxies for the full circuit. Order-style grid, approach matrix, robustness with random slips, usage counts, commendations, undominated fight lines; `--solve` adds an exhaustive search (slow). Runs against an old engine too: `git show balance-before:src/game.js > /tmp/old.js`.
- `npm run test:llm -- --circuit`: after the tutorial checks, the real model plays the full circuit with the careful example orders; the per-decision record goes to `artifacts/llm-circuit-trial.json`. Evidence, not a gate.
- `node tools/probe.mjs`: the real model answers 13 fixed circuit situations (built by the engine, prompted by the real protocol and worker) without playing a trial. About a minute with the model cached. `PROBE_ORDERS='orders A || orders B'` compares variants. Use it before changing prompt wording or example orders.

- `node tools/shots.mjs [dir]`: screenshots of setup, tutorial fight, win and loss, and circuit start, smash, mid-turn playback (held on the blocked charge), counter, armorer, champion, win, low health and death at 1440, 1180 and 390 px, using the Manual sandbox. Also lists rendered text under 12 px and any horizontal overflow. It selects mode buttons as `button[data-mode=…]`: `<body>` carries `data-mode` too.
- `QuestDemo.setPace('instant')` turns playback off (tools use it for fast clicking); `QuestDemo.hold(n)` stops playback on beat n, `hold(null)` releases it; `QuestDemo.skip()`. The snapshot reports `phase`, `playing`, `beat`, `beatKinds`, `awaitingModel`, `modelBusy`.
- `python3 tools/art.py`: rebuilds `assets/art/` from `assets-src/raw/`.
- `npm run test:browser`: manual play through the real controls, then the LLM-mode controls against a stub worker the test injects (no inference). `npm run test:llm -- --full`: real inference; `QUEST_LOAD_MINUTES=60` allows a slow first download, and `QUEST_PROFILE=artifacts/llm-test-profile` keeps the downloaded model between test runs. Results are in `VERIFICATION.md`.

## Determinism

The engine is deterministic: no randomness, fixed course. Model output is not guaranteed to repeat across devices or model builds.

## Open playtest questions

- Battles: in a circuit fight, do you look at the red "Next move" box before anything else? Is the counter ("Countered for 10") satisfying to watch?
- Can you write orders that beat the circuit with the local model in fewer than three tries? Which orders did the model misread?
- Is 32 turns tight in a fun way, or does it punish taking the medic and bench?
- Does the complexity meter nudge you toward shorter orders, or just get ignored?
- Does the anti-hero portrait and tone fit, and is "Your sellsword" the right label?

- What did you look at first on the setup screen?
- Could you finish the first assignment without opening the Rulebook?
- Turn playback: can you tell, without reading the report, what the hero chose, what the opponent did, and whether the guard paid off? Which cue told you most: the speech bubble, the struck-through options, the play-by-play, or the sounds?
- Is normal pace readable without feeling slow? Which pace did you settle on, and did you use Skip?
- Do any sounds grate after a full circuit (the stamp thunk plays every decision)? Is the SMASH warning noticeable?
- On your machine, does the hero ever visibly wait for the model mid-run ("still reading your orders")?
- Does the blank stage space under the situation text after a busy turn bother you more than a jumping Pause button would?
- On a laptop, do you miss the map while watching a run?
- On Windows or Mac: does `npm run play` open a browser, and does the model load? If WebGPU was missing, did the setup guide get you going?
- Does "Run again" after a loss feel right, given that it restarts immediately?

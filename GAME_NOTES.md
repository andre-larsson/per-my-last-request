# Game notes

For the next session. Keep it short.

## Four assignments (added 2026-11-14, provisional until playtested)

User request: "add some more levels … the jump from tutorial level to final one is too much added at once." The previous two-assignment version is commit `5be3f6d` plus the uncommitted pace work.

- **01 First instructions → 02 Fair warning → 03 Prize money → 04 The full circuit.** The two new ones split what the circuit used to add all at once. Each is a course through some of the circuit's own stops, in circuit order, with the same opponents, prices and rules, so nothing learned is unlearned later.
  - **Fair warning** (`warning`): camp, rat, boar, Quickfoot, home; 3 stamps; 16 turns. New: announced moves, guard and its counter, armor, agility, winded.
  - **Prize money** (`prize`): the circuit's second half, from the purse to the home stretch (purse, prize bruiser, medic, Quickfoot, armorer, bench, champion); Quickfoot's stamp and the champion; 30 turns (first set at 24, then 28; see the model runs below). New: coins, the optional prize fight, medic, armorer, bench, bracing, the champion, and a clock that starts to matter.
  - **The full circuit** then adds only the combination: both halves in one trial, 32 turns for 12 stops, commendations.
- **First drafts teach the new rule.** In both middle assignments, "An unfortunate first draft" is the previous assignment's careful orders, unchanged. The tutorial's orders ("fight … using quick strikes") die at Quickfoot after taking the boar's charges. Fair warning's orders ("Quick strike every turn, except: guard against a SMASH.") die at the champion with both potions unused. The careful orders for Prize money fight the bruiser, buy the sword, guard smashes and drink at LOW, and say to skip the bench and submit as soon as possible (scripted: won on turn 22 of 30).
- **Rules live in one table**, `LEVELS` in `src/game.js`: course, turn limit, stamps, champion, announced moves, commendations, example orders, objective text. The tutorial and the circuit are unchanged: every prompt, action list and resulting state over 16,367 states of tutorial and circuit play hashes the same as before.
- **Maps**: the tutorial and the circuit keep their hand-placed layouts. The middle assignments space their stops evenly along the same loop (`spreadLayout` in `src/map.js`). On a phone, Prize money's loop is taller and camp sits a little above the middle so the first labels do not collide.
- **Tabs**: four in one row when the trial column is wide enough, otherwise two by two (a container query on the tab row).
- **Commendations** stay in the full circuit only.

Proxies (`node tools/balance.mjs --level …`, the same 540 scripted order styles):

| | Fair warning | Prize money | Full circuit |
|---|---|---|---|
| Styles that win | 89% | 92% | 56% |
| Quick strikes that ignore the enemy | 0 of 60 | 29 of 60 | see above |
| Median winning trial | 14 of 16 turns | 22 of 30 | 29 of 32 |
| Turns per stop | 3.2 | 3.3 | 2.7 |

The style grid does not rank the two middle assignments: both are forgiving for scripted bots, which waste no turns. What makes Prize money harder is what the orders must cover (potions, the side bet, shopping, the champion's routine) and the champion: 42 of its 44 losing styles die there. The clock binds the real model, which wastes turns the bots do not (see the model runs).

Known soft spot: Fair warning is also won by heavy strikes that ignore the announcements (the boar dies in two heavy strikes). Only quick strikes that ignore the SMASH lose. It is a gentle step by design.

**Real model (Qwen 2.5 3B, RTX 4090, normal pace), `npm run test:llm -- --levels`:**

- **Fair warning, 16 turns.** Careful orders: **won on turn 15** with 33 HP, both charges guarded, every ordinary hit struck. It drank a potion after Quickfoot at 15 HP, which the orders never mention; that used the one spare turn. First draft: **lost**. It took all three charges unguarded and drank both potions to survive, then ran out of turns on the home stretch (scripted, it dies at Quickfoot instead).
- **Prize money, how the limit and the careful orders were chosen.** At 24 turns, the first careful orders ("Fight the prize bruiser and buy a sharper sword with the winnings. Quick strike every turn, except: guard against a SMASH and drink a potion when health is LOW.") beat the champion on turn 24 and lost on time. Unordered extras each cost a turn: a potion at 29 HP, a second purchase (a potion), a rest on the bench. At 28 turns, the same orders reached camp and then drank a potion at 34 HP instead of submitting. Three wordings at 28 turns: adding "Do not rest or buy anything else" made the model guard 8 of 9 ordinary hits and lose on time. The circuit-style "retreat from the optional prize fight" made it retreat from the champion as well. "…Fight the prize bruiser, buy only the sharper sword, skip the bench, and submit at camp as soon as you can." won on turn 27. That is the careful example now, and the limit is 30.
- **Prize money, 30 turns.** Careful orders: **won on turn 27** with 20 HP, all 3 smashes guarded, but 2 of 5 ordinary hits guarded, a potion drunk at 30 HP and an extra potion bought. First draft: **lost on time**. It guarded 7 of 9 ordinary hits and was on the home stretch at turn 30, with the champion beaten (scripted, it dies at the champion instead).
- What this model does: it guards ordinary hits, drinks and shops unasked, and changes behaviour with small changes of wording. The middle assignments' clocks leave room for that. Both first drafts still fail with the model, but by the clock, not the way the scripted check predicts. Each result is one greedy run on one GPU.

**Known prompt error, not fixed:** the move line for a WINDED opponent says "your strikes deal double" (`moveFact` in `src/protocol.js`), but the engine has never doubled them; the action lines show the true damage. It is left from the stagger design. Fixing it changes the circuit prompt that the probe and the circuit run were measured with, so it needs those re-run.

## Battle balance (reworked 2026-11-14)

The previous balance is tagged `balance-before`. The user chose all four changes: enemy intents with Guard, an armorer choice with a paying side bet, commendations, and a tighter clock, keeping overall difficulty about the same. **The full circuit only.** The introductory assignment is unchanged; `tests/game.test.mjs` pins its exact prompt text, because it is the verified model demo.

- **Announced moves.** Each circuit opponent repeats a fixed routine and announces its move before the hero acts: *strike* (ordinary hit), *smash* (big hit), *brace* (no hit, strikes deal half), *winded* (no hit, agile cannot dodge). The prompt uses the same capitalised words (SMASH, BRACING, WINDED, LOW) so orders can match them directly.
- **Guard** (from Fair warning on; the circuit originally): deal nothing, block 8 (14 with buckler), +1 stamina. **Guarding a smash counters automatically** for a heavy strike's damage. The first design (guarding a smash staggers; the *next* strike deals double) worked for bots, but Qwen 3B could not follow a two-step rule like "after a stagger, use heavy". The counter keeps the payoff in one decision.
- **Checklist.** Circuit prompts end with yes/no lines (Enemy about to SMASH, Enemy BRACING, Enemy WINDED, Health LOW, Optional prize fight), in and out of fights. The probe went from 6 to 8 of 10 with it at the time; it also stopped the model drinking potions on the road at high health.
- Routines: rat Nibble 3; boar Charge 12 → Gore 4; bruiser (20 HP, pays 6) Jab 5 → Haymaker 14 → Showboat; Quickfoot Dart 5 → Dart 5 → Out of breath; champion (**30 HP**) Jab 7 → Raise shield → Overhead smash 18 → Catch breath. Laps add 1 damage per move.
- **Armorer**: sword (+2) or buckler for 8 coins, potion for 6, each a turn. Without the bruiser you can afford one item, and with it two.
- **Bench** now also heals 6 (was stamina only; only 17 of 254 winners used it). **Turn limit 38 → 32.**
- **Old values, for reverting:** limit 38, sword 6 coins, bruiser 14 HP and 2 coins, bench stamina only, champion 32 HP hitting 9 every turn. During this rework the champion was 32 HP with the routine; it went to 30 because two real-model runs died to it about 2 HP short (bots: 54% → 56% of styles win).
- **Commendations** (optional, shown in the verdict): Ahead of schedule (by turn 26), No expense claims (no potion drunk), Overtime (beat the bruiser), By the book (no unguarded smash). They pull in different directions; 3 of 301 winning styles earn all four.
- **Example orders** are one sentence: careful "Quick strike every turn, except: guard against a SMASH, drink a potion when health is LOW, and retreat from the optional prize fight." A heavy-based example ("Use heavy strikes, but guard…") was tried and dropped: the 3B then skipped guards and retreated from stamp fights. The reckless example loses to the champion's smash.
- **Orders size** under the orders (`ordersSize` in `src/view.js`): words and tokens, nothing else. It replaced the complexity meter on 2026-11-14 at the user's request. That meter's levels (instructions plus condition words; simple ≤ 7, moderate ≤ 11) rested on no evidence, and it miscounted real orders: the careful example has four rules but counted as 1 instruction and 2 conditions. With a model loaded, the worker counts tokens with that model's own tokenizer; WebLLM 0.2.88 has no public call for this, so it reads the loaded pipeline's tokenizer, and a failure falls back to the estimate. Before that, `words × 1.25 + 1`, shown as "about". On ten sample orders against the Qwen 2.5 tokenizer, that estimate was within 15% for plain sentences and up to 25% low for terse lists in capitals (`chars / 4` was off by up to 39%). Each turn's full prompt is about 220–370 tokens with the example orders; the context window is 2,048 tokens and the textarea stops at 1,800 characters, so the orders cannot overflow it.
- **Open idea, not built (user, 2026-11-14):** have the loaded model describe the orders itself. See the playtest questions.

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
- **The stage is the lit pit in a dark room** (it was the only dark surface before the dark palette below), so the eye lands on it first. It holds two cards: the hero (HP, stamina, potions, coins, sword) and the current opponent or place. HP numbers are the largest text in the game.
- **Controls sit directly under the stage** and do not move during a run. Under 900 px they are a fixed bar at the bottom of the screen.
- **One primary button at a time**: load the model, then run, pause, continue, run again, or next assignment. "Play manually" is offered beside the load button, locally only.
- **The Manual sandbox is local only** (the user's call, 2026-11-14): the published site offers model-controlled play alone. `index.html` marks `<html data-manual-sandbox>`; `tools/build.mjs` removes it (and fails if it is missing). Without it, CSS hides every `.manual-only` element (the controller toggle, "Play manually", the sandbox note, the Rulebook footnote), `setMode` refuses the mode, and status lines and the no-WebGPU advice stop pointing to it. The sandbox stays in the repository for local play, `tools/shots.mjs` and the browser tests.
- **Goal line** (2026-11-15; user: "I can't find the win conditions/goal in the game"): a line labelled "Goal" above the checklist states how to win and how a trial is lost, for the whole trial ("Beat the practice rat, then submit at camp within 12 turns. The trial fails if HP reaches 0 or the turns run out."). Before, the goal was only in the camp text before the first move, the Rulebook and the hero's prompt, and the checklist of portraits had no heading. `goalLine` in `src/view.js` builds it from `LEVELS`, and a test checks it against the engine (who must be beaten, submitting on the last turn counts). On a phone it takes up to four lines above the stage.
- **Goal checklist** (2026-11-15; user: "add a goal tracker/checklist so we can very easily see why/why not hero succeeded"): `goalChecks` in `src/view.js` lists every condition of the goal line, met or not, with evidence from the log: each opponent ("Beaten on turn 3", "Retreated on turns 2, 6 and 10", "The hero went down fighting it", "Never reached"), submitting at camp ("Needed Quickfoot and the champion first"), and the two limits, HP above 0 and the turn limit. The limit that ended a lost trial is tagged "Ended the trial". It shows in the verdict on the stage, where the old prose list of missing stamps was; the verdict text now names only what ended the trial. During the trial the portrait strip stays the tracker; when a trial is lost, its unfinished steps turn red with ✗, and each step's evidence shows on hover.
- **Teaching happens in place**: the checklist shows the assignment as steps; each option shows its consequence text from the engine; trait chips are explained on the line under the cards; "What the hero is told this turn" shows the exact prompt. The Rulebook dialog is reference only.
- **The map moved below the fold** on laptop screens. It is context, and the stage carries the action.
- **Editing orders mid-trial** restarts the trial on the next Run. A notice under the letter says so, and the run button reads "Restart with new orders".
- **Switching assignment** restores the orders last written for it, instead of overwriting them with the first example.
- **Pause between decisions**: replaced by turn playback (below). The old fixed 700 ms pause is gone.
- **Restart is hidden at turn 0.** There is nothing to restart.
- **Model loading has no total time limit.** It fails after five minutes without a progress report (`LOAD_SILENCE_MS` in `src/model.js`). The old 15-minute cap cut off a 1.7 GB download at 84% on a slow connection.

## Dark palette (2026-11-14, provisional until playtested)

User request: "darker/more edgy, similar to Loop Hero, but without being Loop Hero". The previous cream-paper look is the stylesheet at commit `5be3f6d` plus the uncommitted work before this change. Only colours, borders, corners and shadows changed; layout, sizes and type are the same.

- **The guild office after hours**: soot-black panels, bone text, dried-blood red, tarnished brass. What it borrows from that style: near-black ground, bright art in dark frames, hard 1 px black outlines and hard offset shadows instead of soft blurs, corners cut from 12 px to 3–4 px. What it does not: no pixel art, pixel font or loop-and-cards fiction. The ink-and-gouache portraits and the paperwork jokes stay.
- **Colour roles**, one job each: **brass** (`--ochre`) is something to press or the current step (primary button, selected tab and mode, links, step numbers); **lichen green** (`--green`) is the hero, gains, done and chosen; **ember red** (`--rust` for text, `--blood` for fills under white text) is the enemy, damage and danger. Before, green meant both "press this" and "good"; now those are separate.
- **One filled brass element at a time**: the primary button. The selected mode in "Who plays the hero?" is a brass outline, not a fill, so it does not compete with it.
- **The seal** is a blood-red wax seal. The favicon and browser theme colour follow.
- **The stage** keeps its focal role with an ember glow from the top, darker than the panels around it. Fighter cards are raised soot with a black outline.
- **Portraits** are dimmed slightly (`--art-filter`) in cards, the checklist, the play-by-play and the map; defeated ones go grey and darker.
- **Contrast**: every visible text element was checked against its background in the setup, circuit smash, after-guard and Rulebook states (one-off audit, not a tool in the repo): all at least 4.5:1, or 3:1 for large text. The tab numbers and the "Next move" label lost their opacity to get there.
- `color-scheme: dark` makes scrollbars, the model select and the progress bar dark too.
- Full-page screenshots from `tools/shots.mjs` show a faint horizontal band about half-way down the page. It is the fixed page background in a capture taller than the window; in a real window the glow fades smoothly (checked by sampling a window-sized capture).

## Turn playback (added 2026-11-14, provisional until playtested)

User request: make each decision and its consequences easy to follow, with sound, and hide the model's thinking time behind the time spent reading. The previous flow is tagged `before-turn-playback`.

- **The engine resolves a turn at once; the stage replays it.** `applyAction` now logs `events` per turn (actor hero/foe/world, kind, text, and the numbers at that moment). `detail` is still the joined sentence; one wording change: a defeat now reads "X defeated." before "Earned a training stamp". The prompt is unchanged (it never included the log).
- **Beats** (`turnBeats`, `displayAt`, `turnFeedHtml` in `src/view.js`): the choice, then each event in engine order. The stage shows the old situation with each beat's numbers until something changes the scene (new stop, defeat, retreat, end), then the new one. Turn counter advances on the choice.
- **What shows a beat:** the hero's speech bubble with the action ("Guard!"); a yellow glow on whoever acts; the opponent's move box switches to "Now" and flashes when it acts; floating numbers (HP, counter, coins); a play-by-play under the fighters with small portraits per line and the passed-over options struck through; the options panel stamps "Chosen" and strikes the rest; the turn card under the controls fills in line by line.
- **Durations at normal pace** (`BEAT_MS`): options stay up at least 1.4 s before a model's choice is revealed; the choice holds 1.1 s (0.6 s for the player's own or a forced move); an event 0.75 s + 45 ms per word; defeat, stamp, champion, win and loss 1.3 s. **Pace** cycles Turn by turn → Normal → Fast (×0.5), stored per browser (`pmlq.runPace`). Slow (×1.6) was dropped on 2026-11-14 when Turn by turn joined (see below). A fight turn takes about 3.5–5 s at normal pace. **Skip** ends a turn's playback.
- **The model reads ahead** (since 2026-11-14 evening, up to 3 decisions; see the next section). Each decision records `preparedAhead` and `waitedMs` (visible wait beyond the 1.4 s minimum, pauses left out).
- **Measured with the real model** (Qwen 2.5 3B, RTX 4090, careful orders, normal pace): 24 of 26 circuit decisions were ready before their options went up; the hero visibly waited 0 ms in total; the circuit took 122 s on screen (the old flow took roughly 26 × (0.7 s model + 0.7 s pause) plus forced moves, about 40 s). Slower GPUs are unmeasured; `waitedMs` in the exported report shows it.
- **Manual sandbox** plays turns back too, with a shorter choice beat; no new action can be clicked until the turn finishes or is skipped.
- **Sound** (`src/sound.js`): synthesized WebAudio, no files, on by default with a ♪ toggle stored per browser (`pmlq.sound`; music has its own, `pmlq.music`, see Music). A rubber-stamp thunk for every decision (the guild runs on paperwork), whoosh-and-thwack strikes, a wooden knock for raising a guard, a muted clang when a hit lands on the guard, a low thud when the hero is hurt, a soft huff when the opponent idles, low "heartbeat" pulses when a SMASH is announced, chimes for healing, coins, stamps, win and loss. Kept low and short; no loops. Offline levels: −25 to −37 dB RMS for most cues, footsteps and the idle huff quieter, peaks ≤ 0.42.
- **Height:** the play-by-play and the situation text share one grid cell, so the stage is as tall as the taller of the two. This leaves some blank stage under the situation text after a busy turn, but the Run/Pause button does not jump between turns.

## Pause, stop after each turn, less repetition (2026-11-14, provisional until playtested)

User report: the information during play was confusing; Pause seemed not to pause; wanted a mode that stops after each hero action for review, with the model still working ahead. The previous flow is commit `5be3f6d`.

- **Pause freezes at once.** Before, Pause dropped the model's prepared reply but let the turn on screen play to its end (3–5 s, with sound), and greyed out Continue meanwhile; the status line even said "Game time is paused" during normal running. Now the beat clock stops (`gameTime` in `src/app.js`), the thinking phase holds, and a reply that arrives is held until Continue. Continue resumes from the same moment. A "Paused" tag sits on the stage's top edge; looping animations (smash pulse, thinking dots, weighing options, low-health flag) hold, but entrances finish so the frozen beat stays legible. Orders, assignment tabs and model settings unlock while paused; edited orders restart the trial on Continue.
- **Pause keeps prepared decisions.** They answer the exact states the run continues from, so nothing stale can act. Restart, a level, mode or model change, and a model error still drop them all.
- **Pace: Turn by turn** (the default, user request) replaced "One decision". A run plays one turn at normal speed, then stops with that turn's full play-by-play still on the stage and its options still stamped; the button reads "Next turn". It stops after forced moves too (they are rare: the start, and walking at full health). The status line says whether the next move is ready. It began as a separate "Stop after each turn" checkbox; the user asked for it as a pace instead ("Pause / Normal / Fast"). It is called "Turn by turn", not "Pause", because the Pause button already means "freeze now". The pace has a new storage key, so earlier saved paces (and the checkbox) do not carry over.
- **Options not taken** show as red, crossed-out pills with a ✕ in the play-by-play ("Guard instead of ✕ Drink potion ✕ Quick strike"), user request; before they were small grey struck-through words. The options panel strikes their titles in rust.
- **Read-ahead depth 3.** After each turn the model prepares up to three decisions ahead, each in the state the previous prepared decision leads to (a prepared decision is always the one used, so these are the states the hero will reach). Forced moves are stepped over. Prepared decisions are keyed by trial, state revision and the exact prompt. `QuestDemo.setReadAhead(n)` changes the depth for tests. Measured on the RTX 4090 circuit run: all 26 decisions ready before their options appeared (24 of 26 with the old one-ahead read), same choices as before.
- **One place per kind of information.** The turn card under the controls is gone: it repeated the stage's play-by-play while a turn played and the report after. The stage shows the turn being played (or kept at a stop); otherwise the situation for the next decision. The status line now says what the run is doing (running, paused, thinking, stopped) instead of "Decision made in 0.4 seconds". The counter reads "Turns used", and the options are numbered as the turn being decided ("Turn 7 · The hero weighs 5 options…"), so "Turn 6" no longer means two things at once.
- **Fixed on the way:** when the opponent acted on a turn's last beat, its box said "Now" over the *next* announced move (e.g. "Now: Smash, Charge" while the line said "Gore hit for 4"), because the last beat shows the state after the turn. Pause made this easy to see. Also, after a model error, a retry returned the same failed reply instead of asking again.
- In the Manual sandbox and in continuous runs, the previous turn is visible only while it plays and in the report. If that proves too little, the stop-each-turn mode is the intended answer, not a second copy of the turn.

## Music (added 2026-11-14, rewritten the same day as cartoon comedy; provisional until the user has listened again)

User choices: own cues for the desk, the trial and the win and loss stingers (fights share the trial cue); the trial builds on LOW health and the red clock; a separate Music switch, on by default. The first score was "sparse dread". After listening, the user asked for "more comedic/silly music, like the simpsons or south park". They liked the ambience and called the win stinger cinematic. So the second score keeps the beds and the win stinger note for note and turns everything else into cartoon comedy. The melodies are original: no theme or motif from either show.

- **Score**: `assets/music/after-hours.scrim`, a musicbox text score. D major. No sea, bells or celesta, to stay clear of Brinelight. The beds are the first score's: a low D hum and a cold wind ("the guild after hours"), quieter than before under the desk and the trial.
  - **desk**: writing orders, loading, reading the report. A swung office shuffle at 92 bpm. A walking upright bass, pizzicato chords on two and four, and a soft shaker. A bassoon tiptoes up a chromatic stair and a clarinet answers, and in one variant they swap. The xylophone plinks now and then. Five patterns, picked at random. One of them (desk_D, also the intro) is nearly empty: the hum, a soft chord and a bassoon yawn, which keeps some of the old ambience and gives the ear a rest.
  - **trial**: from Run (or the first manual move) until the trial ends. A galumphing march at 116 bpm: tuba oom on one and three, banjo pah on two and four, a clarinet tune that ends with an octave plop. A slide whistle whoops it in. Variants: the tune in the minor with a chromatic climb back, the xylophone taking the tune, and a tiptoe section where the band drops out. **Layer 1** (health at LOW, or the clock in the red, each counts one): a woodblock gallop, a trumpet doubling the tune, and frantic xylophone arpeggios. **Layer 2** (both): brass stabs on the offbeats, a tambourine, a crash. There is still no heartbeat rhythm, since the SMASH warning sound already is one.
  - **won**: unchanged from the first score: the minor key lifts to one held D major chord, then hands back to the desk. The score keeps that score's reverb (0.45) and hum level so that it sounds the same. **lost**: a sad-brass "wah, wah, wah-a-a-a" with a slide whistle falling first. The tuba sits down with a bonk, the bassoon shrugs twice, then the desk returns. With music on, they replace the win and loss chimes.
- **Rule**: `musicFor(state, running)` in `src/view.js` (tested in `tests/view.test.mjs`). It reads what the stage shows, so stingers wait for the turn's last beat. `clockUrgent` is shared with the red turn counter.
- **Player**: `src/music.js` wraps musicbox's `MusicPlayer`, vendored unmodified in `vendor/musicbox/` from github.com/andre-larsson/musicbox commit `e371a2c` (with `LICENSE` and `NOTICE`, Apache 2.0). It has its own AudioContext, so the two switches are independent. Pause lowers the music by 8 dB. A score that fails to load or compile leaves the game silent of music and logs a warning. `tools/build.mjs` ships `assets/music/` and `vendor/` and checks the `../` imports, so a deploy cannot drop them.
- **Levels** (offline render at music volume 0.25; the sound effects measure −25 to −37 dB RMS). The comedy score was balanced to the first score's levels. Plain RMS overweights bass, so it was matched on K-weighted loudness (LUFS-style, ungated):

  | Cue | First score (RMS / K-weighted) | Comedy score (RMS / K-weighted) |
  |---|---|---|
  | desk | −36.5 / −33.4 | −36.0 / −32.8 |
  | trial, intensity 0 / 1 / 2 | −35.0 / −31.6, −31.3 / −28.0, −29.9 / −26.8 | −34.7 / −31.1, −31.0 / −27.6, −30.1 / −26.8 |
  | won | −31.8 / −29.3 | −32.5 / −29.9 |
  | lost | −33.0 / −30.0 | −33.2 / −30.3 |

  Peaks −14.6 dBFS or lower. At first the comedy desk and trial came out 5 to 6 dB louder. The walking bass and the tuba carried most of that, so they were cut most. The banjo, pizzicato and shaker, which measured 15 to 30 dB under the bass, were raised.
- **Editing**: `npx -y github:andre-larsson/musicbox check assets/music/after-hours.scrim` checks a change; `… link FILE` gives an editor link to listen; `… link --decode 'LINK'` reads back a score the user edited there. The first ("sparse dread") score is kept, unused, in `assets-src/music/after-hours-dread.scrim`.

## Random hero (added 2026-11-15, provisional until playtested)

User request: "add play option to let hero choose random action as alternative to follow prompt". The user chose to offer it on the published site as well as locally.

- **A third controller** under **Who plays the hero?**: Local LLM / Random / Manual sandbox. The published site shows two (the sandbox is `.manual-only`). The buttons sit in one row, one column per visible mode (`grid-auto-flow: column`), so the hidden sandbox takes no space. Locally, "Local LLM" wraps to two lines at 1440 px.
- **What it does** (`pickAtRandom` in `src/app.js`): at a real choice the options stay up for the usual 1.4 s ("The hero picks one of 3 at random…"), then one is picked uniformly with `Math.random` and played back like a model's choice, with the full 1.1 s reveal. Forced moves stay "No choice". No model is loaded or asked. The orders are not read: editing them mid-trial restarts nothing, the letter dims as in the sandbox, and the phone's "Orders in force" strip hides.
- **Same run controls** as the model hero: "Run at random", Pause (holds the pick), Continue, Turn by turn, Restart, the paces, Skip. A restart, level or mode change drops a pending pick by the same epoch check as model replies.
- **Labelled everywhere**: source `random` in the log and the export; "Random pick" in the report; "Picked at random" on the stage and the options. A trial with any random pick gets a verdict hint and a status line that credit luck ("Luck, not orders…"), since "The hero did exactly what the orders said" would be false.
- **Not a fallback.** Nothing switches to Random by itself, and model errors do not suggest it.
- **Unseeded**, so a random run cannot be replayed exactly; the log records every pick.
- **Baseline** (100,000 simulated trials each, uniform picks among the offered actions; scratch script, not in the repo):

  | | First instructions | Fair warning | Prize money | Full circuit |
  |---|---|---|---|---|
  | Won | 67% | 2.0% | 3.4% | 0.2% |
  | Died | 0% | 0.6% | 13% | 16% |
  | Out of turns | 33% | 97% | 84% | 84% |

  On the first assignment, random play beats the unfortunate first draft ("Always retreat…"), which always loses. Most random losses after that are the clock, not death.

## Temperature (added 2026-11-15, provisional until playtested)

User question: "can we set temperature in game?", after the Random baseline.

- **A slider** under **Change model or check this device**: 0 to 1.5 in steps of 0.1, default 0, stored per browser (`pmlq.temperature`). Above 0 it also shows in the model line ("· temperature 0.7"). It locks while a run moves, like the model select.
- **Fixed per trial**, like the orders: `runTemperature` is set when a trial starts, and a change mid-trial applies from the next trial (the note under the slider says so). Prepared decisions are keyed by it, so read-ahead never mixes two temperatures in one trial. The export records `temperature`, and each decision returns the value it was made at.
- **Both backends.** WebLLM gets it as `temperature`. The CPU model samples (`do_sample`) among the offered JSON strings only. The worker clamps it to 0–2.
- **Every recorded model result in these notes is at 0.** Above 0 a run does not repeat, so one run says little.
- **Measured** (Qwen 2.5 3B, careful circuit orders, 20 asks per temperature): at the boar's first charge, where the orders say to guard, the model chose quick strike 20 of 20 times at 0, guard 6 of 20 at 0.7, and guard 12 of 20 at 1.5. On the road it advanced 20 of 20 at every temperature. So temperature can also help: there the greedy choice is the wrong one.
- Tools: `QUEST_TEMPERATURE` for `npm run test:llm`, `PROBE_TEMPERATURE` for `tools/probe.mjs`. The trial records include the temperature.
- Not checked: the CPU model above 0.

## Parallel model runs (measured 2026-11-15)

Question: can trials run in parallel, to make 1000+ model runs practical? Scratch benchmark, not in the repo: the real worker, Qwen 2.5 3B, 31 circuit decision states with the careful orders, temperature 0, 30 decisions per model copy, RTX 4090 with nothing else running.

| Model copies | In one browser | In separate browsers |
|---|---|---|
| 1 | 1.90 decisions/s (522 ms each) | – |
| 2 | 2.22 (895 ms) | 2.19 (907 ms) |
| 3 | 2.29 (1296 ms) | 2.28 (1310 ms) |
| 4 | 2.30 (1735 ms) | the 4th browser got no WebGPU adapter |

- Extra copies add at most about 20%. The GPU reports 100% busy at about 230 W of its 450 W: the copies take turns on the GPU instead of running together, whether they share a browser or not. Each copy uses about 2.1 GB.
- Where one decision's time goes (WebLLM's usage report, tutorial, warm): 0.52 s reading the ~260-token prompt (about 500 tokens/s) and 0.15 s writing ~7 tokens. Reading the prompt is about 80%.
- At 1.9–2.3 decisions/s, 1000 full-circuit trials (~26 decisions each) take about 3.2–3.8 hours, and 1000 Fair warning trials (~15) about 2 hours, with playback off. At temperature 0, repeating the same orders only repeats the same trial.
- Untested ways to go faster: keep the unchanging start of the prompt (system prompt and orders) cached between decisions instead of `resetChat` each time; or a native runtime with batching, whose results would need checking against the browser model's.

## Browser setup guide (added 2026-11-14)

- **Get WebGPU on Windows, Mac or Linux** sits under the model status in **Who plays the hero?**. It is a collapsed four-line guide: Windows, Mac, Linux, and "still not working?". It opens by itself when the device check finds no WebGPU or only software graphics, and the blocked status line points to it. The README has the full table and the Linux command line.
- **The page gives no local-run instructions** (the user's call, 2026-11-15: the game is played online). No `npm`, localhost or repository steps in page text; the browser test checks for `npm ` and `localhost`. Those belong in the README.
- **The Linux line gives a Chrome start-up command, not `chrome://flags`.** On Chrome 156, the flags page has no ANGLE backend entry, and without `--use-angle=vulkan` the RTX 4090 host offered only SwiftShader (measured 2026-11-15; see `VERIFICATION.md`). The command is the tested `npm run play` set.
- **"Still not working?" warns about `chrome://gpu`.** The user's Chrome 156 (X11, NVIDIA, no flags) said "WebGPU: Hardware accelerated" while `requestAdapter()` returned null. The guide sends players to the game's own device check instead.
- Browser versions come from the gpuweb implementation-status wiki (last edited 2026-10-02). Only Chrome on Linux with NVIDIA (X11, `npm run play` flags) is tested. Update both the guide and the README table when browsers ship (Firefox on Linux is expected in 2026).
- `npm run play` now finds Chrome (falling back to Edge) in the standard macOS and Windows install folders. That path is untested on those systems; `CHROME=` still overrides it.

## Art

Style preamble, used at the start of every request (full requests in `assets-src/wanted-images.tsv`):

> Illustration for a comic fantasy browser game about an adventurers' guild that runs on paperwork. Hand-inked storybook illustration with confident dark green-black ink outlines and flat gouache colour, a limited palette of forest green, rust red, ochre yellow, warm grey-brown and cream, gentle paper grain, a soft shadow under the subject, no gradients, no photorealism. Square. A single subject, centred, on a plain flat warm cream background (#f4ecd8). No text, borders or frames.

- 13 portraits in use: hero, 5 opponents, 7 places. Originals (1254 px) are in `assets-src/raw/`; `python3 tools/art.py` cuts them to 384 px WebP in `assets/art/`.
- **The hero is now a rugged anti-hero** (user request, 2026-11-14): a scarred sellsword who joined for the pay and follows orders to the letter, with commentary. Portrait `hero-e` (chewing grass, holding the orders at arm's length) is a provisional pick; `hero-c` (sword on shoulder) and `hero-d` (arms crossed) are alternatives. The original hapless applicant is `hero-a`. Copy follows the character: card kicker "Your sellsword", "would like to discuss the fee", "did exactly what the orders said, and would like that noted". The model's system prompt is unchanged.
- `PICKS` in `tools/art.py` selects `hero-e` and `champion-a`.
- The art's paper colour is about `#f4e6cc`. On screen every portrait is dimmed by `--art-filter` (candlelight, so cream does not glare against the dark page), which turns that paper into about `#ddcca9`: that is `--art` in `style.css`. Portrait frames and map discs use it so the square edges do not show. Change the two together; sample a portrait corner in a screenshot to get the new `--art`.
- No images are queued. A missing portrait falls back to a letter placeholder.

## Tools

- `node tools/balance.mjs [engine.js] [--level warning|prize] [--solve] [--json out.json]`: balance proxies for the full circuit, or another assignment with `--level` (battles always use circuit opponents). Order-style grid, approach matrix, robustness with random slips, usage counts, commendations, undominated fight lines; `--solve` adds an exhaustive search (slow). Runs against an old engine too: `git show balance-before:src/game.js > /tmp/old.js`.
- `npm run test:llm -- --circuit`: after the tutorial checks, the real model plays the full circuit with the careful example orders; the per-decision record goes to `artifacts/llm-circuit-trial.json`. Evidence, not a gate.
- `npm run test:llm -- --levels`: the real model plays Fair warning and Prize money, each with its careful orders and its first draft; records go to `artifacts/llm-<level>-<careful|reckless>-trial.json`. Evidence, not a gate. `--levels=prize` plays one assignment; `QUEST_ORDERS='orders A || orders B'` plays those orders instead of the examples, to compare wordings in whole trials.
- `node tools/probe.mjs`: the real model answers 13 fixed circuit situations (built by the engine, prompted by the real protocol and worker) without playing a trial. About a minute with the model cached. `PROBE_ORDERS='orders A || orders B'` compares variants. Use it before changing prompt wording or example orders.

- `node tools/shots.mjs [dir]`: screenshots of setup, tutorial fight, win and loss, Fair warning start, boar and win, Prize money start and win, and circuit start, smash, mid-turn playback (held on the blocked charge), counter, armorer, champion, win, low health and death at 1440, 1180 and 390 px, using the Manual sandbox. Also lists rendered text under 12 px and any horizontal overflow. It selects mode buttons as `button[data-mode=…]`: `<body>` carries `data-mode` too.
- `QuestDemo.setPace('instant')` turns playback off (tools use it for fast clicking); `QuestDemo.hold(n)` stops playback on beat n, `hold(null)` releases it; `QuestDemo.skip()`. The snapshot reports `phase`, `playing`, `beat`, `beatKinds`, `awaitingModel`, `modelBusy`. `QuestDemo.countTokens(text)` counts tokens with the loaded model's tokenizer.
- `python3 tools/art.py`: rebuilds `assets/art/` from `assets-src/raw/`.
- `npm run test:browser`: manual play through the real controls, then the LLM-mode controls against a stub worker the test injects (no inference). `npm run test:llm -- --full`: real inference; `QUEST_LOAD_MINUTES=60` allows a slow first download, and `QUEST_PROFILE=artifacts/llm-test-profile` keeps the downloaded model between test runs. Results are in `VERIFICATION.md`.

## Determinism

The engine is deterministic: no randomness, fixed course. The music rolls its own dice (random patterns and notes) and never reads or changes game state. Model output is not guaranteed to repeat across devices or model builds, and above temperature 0 it does not repeat at all.

## Open playtest questions

- Battles: in a circuit fight, do you look at the red "Next move" box before anything else? Is the counter ("Countered for 10") satisfying to watch?
- Can you write orders that beat the circuit with the local model in fewer than three tries? Which orders did the model misread?
- Is 32 turns tight in a fun way, or does it punish taking the medic and bench?
- Do you look at the words and tokens under the orders at all? Would you rather have the loaded model read the orders back in its own words before a run (not built)?
- Does the anti-hero portrait and tone fit, and is "Your sellsword" the right label?

- Four assignments: does each step feel like one new idea, or is Prize money (seven new stops) still too much at once? Is Fair warning too easy, given that heavy strikes win it without reading?
- Did the first drafts in the middle assignments (the previous assignment's orders, failing) make the new rule obvious, or just feel unfair?
- Fair warning gives 16 turns, and the model's careful run used 15. Does the clock feel fair there, or should it be 17–18 (the first draft would then win with this model)?
- Dark palette: does it feel grim enough, or still too polite? Too close to Loop Hero? Is anything hard to read, especially the red damage numbers and the muted grey text? Do the dimmed portraits look aged, or just dull?
- What did you look at first on the setup screen?
- Could you finish the first assignment without opening the Rulebook? Does the Goal line above the checklist answer "what do I have to do?", and is it too long on a phone?
- Pause: does it now feel like a real pause? Is the "Paused" tag on the stage noticeable without being loud?
- Turn by turn: does the default suit a first run, or does it feel slow to start (the first click only walks to the rat)? Should it skip stopping after forced moves (start, walking)? Do you read "The next move is ready", or is it noise? Do you miss Slow?
- With the turn card under the controls gone, do you miss seeing the last turn while the hero weighs the next one in a continuous run?
- Turn playback: can you tell, without reading the report, what the hero chose, what the opponent did, and whether the guard paid off? Which cue told you most: the speech bubble, the struck-through options, the play-by-play, or the sounds?
- Is normal pace readable without feeling slow? Which pace did you settle on, and did you use Skip?
- Do any sounds grate after a full circuit (the stamp thunk plays every decision)? Is the SMASH warning noticeable?
- Music: is the comedy funny, or does it grate over a long writing session at the desk? Is the bassoon too busy while you write? Is the trial march too fast or too slow for the turn pace? Do you notice the trial getting more frantic when health is LOW or the clock turns red? Does the music hide any sound effect (the SMASH warning especially)? Does the sad-brass loss land as a joke? Is 16 seconds of win stinger too long before the desk returns?
- On your machine, does the hero ever visibly wait for the model mid-run ("still reading your orders")?
- Does the blank stage space under the situation text after a busy turn bother you more than a jumping Pause button would?
- On a laptop, do you miss the map while watching a run?
- On Windows or Mac: does `npm run play` open a browser, and does the model load? If WebGPU was missing, did the setup guide get you going?
- Does "Run again" after a loss feel right, given that it restarts immediately?
- Temperature: do you use it? Does a little (0.3–0.7) make reruns more interesting, or just make the orders feel ignored?
- Random hero: does it read as a baseline to beat, or as a way to skip writing orders? Random wins First instructions two times in three; does that undercut the first lesson, or make a good joke ("even chance beats this draft")? Is the 1.4 s "picks at random" pause worth keeping, or should random picks be quicker? Should the no-WebGPU guide point to Random?

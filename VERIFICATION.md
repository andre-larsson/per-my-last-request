# Verification notes

Original prototype checks on 2026-11-13, with model-selection checks added on 2026-11-14. This file distinguishes game-rule checks, browser UI checks, and genuine model inference.

## Manual sandbox local only (2026-11-14)

The published build removes the Manual sandbox; running from the repository keeps it.

- `npm test` passed (56 tests). New: a no-WebGPU fallback names the Manual sandbox only where the page offers it, and no model note mentions it.
- `npm run test:browser` passed. Local manual play and the stub-worker flow are unchanged. New: it builds the site as the deploy does, serves it, and checks that `<html>` has no `data-manual-sandbox`, that all four `.manual-only` elements are hidden, that the no-WebGPU status and suggestion still appear, and that no visible text (Rulebook open) mentions manual play.
- Screenshots of the built and local pages at 1440 and 390 px: the built page shows the model controls with no toggle and no "Play manually"; the local page is unchanged.

Not checked: the live site after deploy (not pushed).

## Music (2026-11-14)

A musicbox score with desk, trial, won and lost cues; details in `GAME_NOTES.md`. The first score ("sparse dread") was replaced the same day by a cartoon-comedy score, after the user listened. Nobody has listened to the comedy score yet: the checks below cover its notes, levels and the game's wiring, not whether it sounds good or funny.

- `musicbox check`: no errors or warnings. The analysis lists four strong-beat notes outside the chord and some chromatic notes outside D major. All are intended: the walking bass's approach note, the bassoon's chromatic stair, the march's climb back to the top, and the loss stinger's wobble. The win stinger is the first score's, note for note.
- `npm test` passed (55 tests). Includes the cue and intensity rule (desk, trial from Run, stingers, one layer each for LOW health and the red clock, two for both).
- `npm run test:browser` passed. Includes: the music starts on the first click; the win stinger follows a win, the desk a restart, the trial the first move; the Music switch stops and restarts it without touching the sound effects; Pause lowers it and Continue restores it. These read the player's state, not the audio output.
- The first score only: a scripted tutorial run in the browser went desk → trial → won → desk by itself after the stinger; Restart did not restart the desk music; no browser errors. The comedy score keeps the same cue names and switches.
- Levels by offline render, matched to the first score: see `GAME_NOTES.md`.
- `node tools/build.mjs` now ships `assets/music/` and `vendor/`. Without them, the check fails and names `vendor/musicbox/player.js` and the score, which a deploy would otherwise have dropped.

Not checked: how it sounds, on any speakers or headphones; CPU cost on a phone; Safari, where audio rules are strictest.

## Dark palette (2026-11-14)

Colours, borders, corners and shadows only; details in `GAME_NOTES.md`.

- `npm test` passed (54 tests). `npm run test:browser` passed (manual play and the stub-worker LLM-mode flow).
- `node tools/shots.mjs`: no text under 12 px. Every state at 1440, 1180 and 390 px was reviewed by eye against a before set.
- Contrast: a one-off audit of every visible text element (setup, circuit smash, after a guard, Rulebook open) found all at least 4.5:1, or 3:1 for large text, after two fixes (tab numbers and the "Next move" label had been faded with opacity).

Not checked: the LLM-mode states with a loaded model (thinking, paused, stopped) by screenshot, other browsers, or a real phone.

## Four assignments (2026-11-14)

Two assignments now sit between the tutorial and the full circuit: Fair warning (the three stamp fights, with announced moves and guard, 16 turns) and Prize money (the circuit's second half, 30 turns). Details in `GAME_NOTES.md`.

- **Tutorial and circuit unchanged:** every prompt, action list and resulting state of 16,367 tutorial and circuit states, played by 800 seeded random and mostly-sensible policies, hashes the same as at HEAD. `node tools/balance.mjs` still reports 301 of 540 circuit styles winning (56%).
- `npm test` passed (54 tests). New tests: the assignment order and courses; for each middle assignment, the first draft loses to the new rule (scripted) and the careful orders win; the middle assignments' prompts announce moves, offer guard and state their own stamps; the checklist steps; every map layout places its own stops inside the drawing and apart; the rulebook's four assignments.
- `npm run test:browser` passed (twice; a third run failed once in the device-check section, the intermittent click after a viewport change recorded below, with the failure snapshot showing that check). New: "Next assignment" goes tutorial → Fair warning → Prize money → full circuit; both middle assignments are won through the real controls, with only their own stops on the map; the full circuit offers no next assignment; all four tabs fit at 390 px.
- `node tools/shots.mjs` (now with Fair warning start, boar and win, and Prize money start and win): no text under 12 px, no overflow. Fixed on the way: the four tabs overflowed the trial column at 390 px and at 1360–1440 px and around 900 px (they now sit two by two when the column is narrow), and on the phone the hero marker at camp covered "Prize purse".
- **Real inference, hardware WebGPU (RTX 4090), Qwen 2.5 3B, normal pace** (`npm run test:llm -- --levels`, one greedy run each):
  - Fair warning, careful orders: won on turn 15 of 16 with 33 HP, both charges guarded. First draft: lost, out of turns.
  - Prize money at 30 turns, careful orders: won on turn 27 with 20 HP. First draft: lost, out of turns. At 24 and 28 turns the earlier careful wording lost on time; the limit and wording were changed from these runs (see `GAME_NOTES.md`).
  - The tutorial combat and retreat-order checks passed in each of these runs. Every decision was ready before its options appeared, with 0 ms visible wait.
- **Not re-run:** the model-controlled tutorial (`--full`) and full circuit (`--circuit`) after this change. The last attempt failed at model load with `GPUOutOfMemoryError`: another project's process held 18 GB of the GPU at the time. Their prompts are byte-identical (above) and decoding is greedy, so the recorded results should repeat; that is an inference, not a measurement.

Not checked: the middle assignments with other models or hardware, by a person, or on a real phone.

## Pause, stop after each turn, read-ahead (2026-11-14)

Pause now freezes the trial at once; a "Turn by turn" pace (the default) replaced "One decision" and Slow; the model reads up to three decisions ahead; the duplicate turn card under the controls is gone; options not taken are red crossed-out pills. Details in `GAME_NOTES.md`.

- `npm test` passed (50 tests). The turn-card tests were removed with the card; the play-by-play test now also checks the review form (every line shown, none animating as new).
- `npm run test:browser` passed (three runs; one earlier run failed once in the unrelated device-check section, on a click straight after a viewport change, and passed on rerun). New with the stub worker (no inference): Turn by turn is the default pace, and the Pace button cycles to Normal; one turn per Run at that pace; the stopped turn stays on the stage with its options stamped; the status line reports the next move ready; Next turn uses the prepared decision with no visible wait. Pause during playback holds the beat for 2.5 s, shows the "Paused" tag, unlocks Continue and the orders at once, and Continue uses the decision prepared during the pause (asked for once). Pause while the hero waits for a slow reply: the reply arrives, is held, and is used on Continue. A retry after a parse failure gets a fresh answer (before, it repeated the failure). Manual sandbox: when the opponent acts on a turn's last beat, its box names that move ("Now … Gore"), then the next one ("Next move … Charge").
- `node tools/shots.mjs`: no text under 12 px, no overflow. Stub-worker screenshots of the stopped, paused and thinking states at 1440, 1180 and 390 px were reviewed by eye.
- **Real inference, hardware WebGPU (RTX 4090), Qwen 2.5 3B:** `QUEST_PROFILE=artifacts/llm-test-profile npm run test:llm -- --full` passed: one-turn runs gave the forced departure, then `quick`; the retreat orders still gave `retreat` (that decision was prepared ahead during the departure's playback); the introductory assignment was won in 6 turns with 37 HP; no browser errors.
- `QUEST_PROFILE=artifacts/llm-test-profile npm run test:llm -- --circuit` (careful example orders, normal pace, continuous run): **won with 1 HP on turn 32**, with the same 26 model decisions as the recorded runs (decoding is greedy, so the read-ahead does not change the choices). **All 26 decisions were ready before their options appeared** (24 of 26 with the old one-ahead read), the hero visibly waited 0 ms, model time was 16.4 s in all, and the run took 122 s on screen.

Not checked: how Pause and the stop mode feel to a person, phones, other browsers, and read-ahead on slower hardware.

## Orders size instead of the complexity meter (2026-11-14)

- `npm test` passed (50 tests). The complexity test was replaced by one for the size line. It checks words, estimated tokens marked "about", and an exact count shown only for the text that was counted.
- `npm run test:browser` passed. Without a model, 72-word orders show "72 words · about 91 tokens". With the stub worker, the count comes from the worker and "about" disappears. After the orders are edited, the size shows an estimate until the new text is counted. Token counts never overlapped a decision request.
- **Real tokenizer, Qwen 2.5 3B on hardware WebGPU (RTX 4090):** the worker counted ten sample orders in 0–14 ms each, with no errors. The counts were 3 to 280 tokens, about 5 characters or 1.25 words per token for plain sentences. The new estimate (`words × 1.25 + 1`) was within 15% of the exact count for plain sentences and up to 25% low for a terse list in capitals.
- `QUEST_PROFILE=artifacts/llm-test-profile npm run test:llm -- --full` passed. The trial was won in 6 turns with 37 HP and no browser errors. The page showed the exact "19 words · 22 tokens" for the careful tutorial orders.
- Not checked: counting with the CPU model. It uses the Transformers.js tokenizer call that CPU decisions already use.

## Browser setup guide (2026-11-14)

- `npm run test:browser` passed. It now checks that a missing WebGPU opens the in-game setup guide, which covers Windows, Mac and Linux and names `npm run play`. It also checks that the blocked status line points to the guide and that the open guide fits at 360 px. Screenshot: `artifacts/webgpu-help-phone.png`. `npm test` still passes (50 tests).
- The Chrome lookup in `npm run play` was checked only on this Linux host, plus a simulated Windows folder layout (it prefers Chrome, then Edge). It has not run on macOS or Windows.
- The browser and OS support listed in the guide and README comes from the gpuweb implementation-status page. Only Chrome on Linux (NVIDIA, X11) was tested.

## Turn playback (2026-11-14)

Turns now resolve in the engine at once and are played back beat by beat; during a run the model reads the next turn while the current one plays (previous flow: git tag `before-turn-playback`). Details in `GAME_NOTES.md`.

- `npm test` passed **50 tests**. New: each turn's events in order with the numbers at each moment; for three scripted circuit policies, every turn's last event matches the state and the events rebuild the log sentence; beats, cues and floating numbers for a guarded charge; the stage state at each beat (including a defeat changing the scene before the stamp arrives); the play-by-play markup. The prompt-pinning test for the introductory assignment still passes.
- `npm run test:browser` passed. Manual sandbox: the guarded charge plays as choice → guard → blocked charge → counter, the stage keeps the old HP until the charge lands and the boar's HP until the counter, no action can be clicked mid-turn. Stub worker (no inference): the stub now refuses overlapping requests like the real worker, and none overlapped; with playback on, every model decision in a tutorial run was prepared during the previous turn's playback; Pause during playback lets the turn finish and drops the prepared reply; Continue asks again about the state on screen; Skip ends playback.
- `node tools/shots.mjs` captured all states, plus a held mid-turn state, at three sizes: no text under 12 px, no overflow, no browser errors. Fixed a tool bug on the way: its `[data-mode="llm"]` selector matched `<body>`, so the "setup" shot had clicked the model load button.
- **Real inference, hardware WebGPU (RTX 4090 host), Qwen 2.5 3B, normal pace:** `QUEST_PROFILE=artifacts/llm-test-profile npm run test:llm -- --full --circuit` passed. The introductory assignment was won as before, and the retreat orders still produced `retreat`. The full circuit with the careful example orders was **won with 1 HP on turn 32**, with the same 26 model decisions as the earlier recorded run (the prompt is unchanged). Of those 26, **24 were ready before their options appeared, and the hero visibly waited 0 ms in total**; the other two followed a short forced walk and finished inside the 1.4 s the options always stay up. Model time was 19.1 s in all (0.48–0.86 s per decision); the run took 122 s on screen. This shows the waiting is hidden on a fast GPU; slower devices were not measured.
- Sound cues were rendered offline in headless Chrome to check levels (peaks ≤ 0.42, no clipping). Nobody has listened to them yet.

Not checked: how the playback and sounds feel to a person, other browsers, phones, and inference on slower hardware.

## Battle rework (2026-11-14)

The full circuit's battle rules changed (previous rules: git tag `balance-before`). Details and balance numbers are in `GAME_NOTES.md`.

- `npm test` passed **45 tests**. New ones cover announced routines, guard and counter (including a counter that wins a fight), brace, the prompt checklist, the armorer's stock, commendations, the complexity meter, and every new Rulebook rule. One test pins the introductory assignment's exact prompt text.
- The introductory assignment is unchanged. A script walked all 2403 reachable tutorial states under the old and new engine and protocol: actions, outcomes, log text and prompts were identical.
- `npm run test:browser` passed (desktop, 390 px, 360 px; a manual circuit victory in 32 turns using guard, the buckler and the bench; the stub-worker LLM-mode flow). `node tools/shots.mjs` captured all states at three sizes with no text under 12 px and no browser errors.
- **Real inference, introductory assignment: re-verified.** `npm run test:llm -- --full` with Qwen 2.5 3B on hardware WebGPU won in 6 turns with 37 HP; every choice after the forced departure came from the model, and the retreat orders still produced `retreat`.
- **Real inference, full circuit: one model-controlled victory.** `npm run test:llm -- --circuit` with Qwen 2.5 3B and the careful example orders ("Quick strike every turn, except: guard against a SMASH, drink a potion when health is LOW, and retreat from the optional prize fight.") won with **1 HP, 3 stamps, on turn 32 of 32**. The model made all 26 decisions that had more than one option; 6 single-option moves were taken automatically, as the game always does; no manual or scripted choices. The win is narrow and the play imperfect: 2 of 4 smashes guarded, both potions drunk outside fights. Earlier runs on the way to the final rules lost (one guard loop on an older example; two deaths at the champion about 2 HP short, before the champion went from 32 to 30 HP). This is one run on one machine, not evidence that the circuit is reliably winnable by the model.
- `node tools/probe.mjs` (13 fixed situations, same model and orders): 11 of 13 as intended. Misses: it fights the optional bruiser instead of retreating, and strikes instead of drinking at LOW health mid-fight.

## Interface redesign (2026-11-14)

The interface was rebuilt on 2026-11-14 (previous version: git tag `ui-before-redesign`). Sections below this one describe checks made against the earlier interface; their engine, protocol and model findings still apply, but their screenshots show the old layout.

- `npm test` passed **31 tests**. Eleven are new: the checklist, stage card, log deltas, verdict, markup escaping and both map layouts, plus one check per rule stated in the Rulebook dialog (strikes, stamina, armor, retaliation, retreat, starting kit, potions, the LOW threshold, medic, bench, purse, armorer, prize money, lap scaling).
- `npm run test:browser` passed on hardware WebGPU at 1440 × 1100, 390 × 844 and 360 × 844 without horizontal overflow. It now also checks that the load action is offered before a model is ready, that Run is hidden until then, that Manual sandbox is labelled and hides the model controls, and that the last move, report, checklist and verdict show what the engine did. A complete manual victory took 26 turns. This is not an LLM-controlled result.
- `node tools/shots.mjs` captured setup, fight, win, loss, low health and death at 1440, 1180 and 390 px wide with no horizontal overflow, no browser errors, and no rendered text under 12 px. It drives the Manual sandbox only.
- The same run then exercised the LLM-mode controls against a stub worker injected by the test: load progress and the ready state, the thinking state (visible, orders locked, no turn spent), a reply arriving after Restart (discarded), unusable output twice (reported, no turn spent), orders edited mid-trial (flagged, then a fresh trial with the new text on the next run), a stub-driven run to the verdict in 6 turns, and Pause (reply in flight discarded). **This is interface verification with scripted replies. It is not inference and says nothing about model behavior.**
- **Real inference on the new interface: verified on the introductory assignment.** `QUEST_PROFILE=artifacts/llm-test-profile npm run test:llm -- --full` passed on 2026-11-14 with Qwen 2.5 3B on hardware WebGPU (NVIDIA, RTX 4090 host). With the orders "Fight the practice rat using quick strikes. After earning its training stamp, return to camp and submit the assignment." the model chose every action after the forced departure: quick strike, quick strike, continue, continue, submit. The trial was won in 6 turns with 37 HP, one stamp, and no model or browser errors. The reversed orders ("Always retreat…") produced `retreat` from the same state. Decisions took 0.4 to 1.7 seconds. Screenshots of the new interface during that run: [combat](artifacts/llm-combat.png), [accepted assignment](artifacts/llm-full-trial.png). The full circuit was not attempted with a model on the new interface; its status is unchanged from the sections below.
- Getting to that pass took four earlier attempts, all of which ended while downloading the 1.7 GB model on a slow connection (about 0.6 to 1.7 MB/s) and none of which spent a game turn. Two failed with `Cache.add() encountered a network error`; the game reported it and offered a retry and manual play. One was stopped by hand. One was cut off at 84% by the game's own 15-minute load limit, which was a defect: the download was still progressing. `src/model.js` now has no total load limit and fails only after five minutes without a progress report; `tests/model.test.mjs` covers a two-hour download that keeps reporting, a silent load, and the unchanged 3-minute hard limit on a decision. The passing run's download took about 16 minutes, longer than the old limit allowed.
- `npm test` now passes **34 tests** with those three.

Not checked: the feel of the interface for a first-time player, real phones, and browsers other than Chrome on this Linux host.

## Device recommendations (2026-11-14)

`npm test` passed **20 tests**, including hardware-check errors and timeout, transient GPU startup refusal, unknown memory, software graphics, per-buffer limits, player-supplied capacity with headroom, and strict Qwen3 response normalization.

`npm run test:browser` passed on hardware WebGPU at desktop 1440 × 1100 and responsive viewports 390 × 844 and 360 × 844. It exercised the recommendation controls, a 24 GB capacity suggesting Qwen3 8B, a 2 GB capacity suggesting a smaller model, explicit application of a suggestion, memory advice for an oversized selection, and rechecking without changing the selected model. A simulated missing `navigator.gpu` exercised the real UI's CPU suggestion. Checking and selecting spent no game turns and did not load a model. Existing manual circuit victory and tutorial progression checks still passed. No browser console or runtime errors occurred.

The browser check reports adapter availability and buffer limits, not total or free VRAM. A stated GPU capacity is user input, with 20% reserved as headroom. Recommendations are estimates and are not a model speed or decision-quality benchmark.

Screenshots: [device check on desktop](artifacts/model-check-desktop.png), [device check at 360 px](artifacts/model-check-phone.png).

## Qwen3 8B browser inference (2026-11-14)

`QUEST_MODEL=Qwen3-8B-q4f32_1-MLC npm run test:llm -- --full` passed on the RTX 4090 with real hardware WebGPU:

- The model downloaded and loaded in approximately 155 seconds in a fresh test profile. The runtime reported approximately 4.4 GB of weight downloads; the UI rounds its download estimate up to 5 GB.
- The first combat decision followed the quick-strike prompt (`quick`, 2.11 seconds). Changing only the standing orders to retreat selected `retreat` in the same situation (0.84 seconds).
- The complete introductory assignment finished in **6 turns**, with **37 HP**, **2 potions**, the required stamp, and a safe return. All genuine choices came from the LLM; only the forced departure used `auto`.
- Rechecking the device after loading preserved the ready model and its selection.
- No browser console or runtime errors occurred.

The first Qwen3 attempt loaded but failed strict parsing because WebLLM includes its empty thinking prefill in `message.content`. The model-specific adapter now removes only that exact prefix with thinking disabled. Original `modelOutput` is preserved in reports. Tests confirm that nonempty reasoning, extra prose, illegal IDs, and wrappers on other models are still rejected.

This is evidence of a working Qwen3 tutorial and prompt contrast, not of better full-circuit performance. The second assignment was not tested with Qwen3. It remains labeled experimental.

Evidence: [Qwen3 report](artifacts/Qwen3-8B-q4f32-1-MLC/llm-report.json), [tutorial result](artifacts/Qwen3-8B-q4f32-1-MLC/llm-full-trial.json), [tutorial screenshot](artifacts/Qwen3-8B-q4f32-1-MLC/llm-full-trial.png).

## Game and protocol

`npm test` passed eleven tests covering introductory victory and failure, a complete full-circuit winning policy, a wasteful losing policy, illegal action rejection, potion consumption and enemy retaliation, agile-enemy behavior, the turn deadline, immutable prior states, strict JSON validation, and model-visible facts.

The reference winning policy is test code only. It is never used as a fallback controller in LLM mode.

## Browser interface

`npm run test:browser` passed on an isolated Google Chrome instance:

- Desktop at 1440 × 1100.
- Responsive viewports at 390 × 844 and 360 × 844, without horizontal overflow.
- Actual controls for movement, combat, potion consumption, and restart.
- A complete manual-controller victory in 26 turns.
- Introductory assignment completion and the Next assignment control.
- No browser console or runtime errors.

This verifies the interface and game engine. It is not an LLM-controlled victory.

The local launcher was also started with `npm run play -- --headless`; `http://localhost:4173/` returned HTTP 200, and its owned browser/server were stopped afterward. The visible app-window launcher itself was not inspected through desktop computer-use tools.

## Browser inference

The host has an NVIDIA GeForce RTX 4090 with 24 GB VRAM. Its devices are hidden inside the restricted command sandbox. Host-level testing and the documented Linux headless Vulkan flags expose a real WebGPU adapter: vendor `nvidia`, architecture `lovelace`, `isFallbackAdapter: false`.

WebLLM 0.2.88 successfully loaded a Qwen 3B four-bit / float32 build on that adapter and generated valid, engine-resolved JSON actions. Changing the prompt from attacking to retreating changed the choice in the same initial combat situation. Warm decisions in those checks took roughly 0.3–0.6 seconds; first requests included additional compilation work.

The 3B model did not reliably complete the level with the tested multi-rule policies. It ignored some healing and combat instructions. This is a behavior-quality failure, distinct from JSON parsing or engine correctness.

Qwen 7B also loaded and produced genuine model decisions on the RTX 4090. Its full-circuit attempt still lost after wasting potions and choosing poor attacks. The worker recorded the exact received orders, matching the player prompt, so this was not a stale-controller substitution. Larger size alone did not establish reliable execution of a multi-rule policy.

## Verified introductory victory

`npm run test:llm -- --full` passed with the final Qwen 3B float32 build on hardware WebGPU:

- The attack prompt selected `quick` in the initial fight.
- Changing only the orders to retreat selected `retreat` in the same situation.
- The worker's recorded received orders matched the player prompt.
- The clear introductory prompt completed the assignment in **6 turns**, with **37 HP**, **2 potions**, and the required stamp.
- Every actual choice came from the model. The forced departure was recorded as `auto`; no action used the manual controller or a scripted tactical policy.
- The first combat request took 1.74 seconds, including additional initialization work. The changed-order request took 0.43 seconds.
- No browser console or runtime errors occurred.

The original full-circuit rules are preserved as the second assignment. This introductory success is not evidence of full-circuit victory.

## Other observed limits

- Qwen 0.5B on CPU produced real browser-local decisions through Transformers.js 3.8.1 / ONNX Runtime Web. Results were sensitive to prompt framing. Some earlier instruction-change checks passed; the later CPU checks failed to reliably distinguish the attack and retreat orders. It remains explicitly experimental and is not the default controller.
- An experimental SmolLM2 135M model produced valid actions but failed the instruction-change check. It was removed from the model selector.
- An experimental SmolLM2 1.7B CPU build aborted during initialization. The exact cause was not established; it was removed from the model selector.
- Half-precision WebLLM builds failed shader compilation in this browser. The selectable GPU builds therefore use float32 arithmetic with four-bit weights.
- Software WebGPU could load the small float32 build, but its first decision exceeded the 180-second timeout. The game correctly spent no turn. Software rendering was not representative of the host's available hardware GPU.
- These checks do not establish performance or compatibility on other machines, mobile devices, or browsers.

## Local artifacts

Artifacts are generated under the ignored `artifacts/` directory:

- [UI report](artifacts/browser-report.json)
- [Model inference report](artifacts/llm-report.json)
- [Full model trial](artifacts/llm-full-trial.json)
- [Desktop](artifacts/desktop.png)
- [Phone](artifacts/phone-390.png)
- [Model trial screenshot](artifacts/llm-full-trial.png)

The repository is local. No Git remote or deployment is configured.

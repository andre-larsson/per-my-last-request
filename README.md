# Per My Last ReQuest

A local prototype of a prompt-controlled adventure. Write standing orders for a guild applicant, watch their decisions, then revise the prompt and retry.

The introductory assignment teaches one rule: the hero must fight the practice rat to earn a stamp, then return home. Its first draft tells the hero to retreat from every fight. Change the orders to complete the assignment. Two middle assignments then add the rest a few rules at a time: **Fair warning** (opponents announce their moves, and the hero can guard) and **Prize money** (the circuit's second half, with coins, gear and the champion). The last is the full twelve-stop guild circuit.

The project name is `per-my-last-request`, styled **Per My Last ReQuest** in the game. The setting uses guild trials, equipment, contracts, and comic administrative incompetence. It avoids the bells, lantern objectives, coastal story, and other signature motifs of the neighboring Brinelight and Menhir projects.

## Run

Requires Node 22 or newer. No npm install or API key is needed.

```sh
npm run play
```

This serves the game at **http://localhost:4173** and opens a dedicated Chrome game window. It looks for Chrome in the usual place on Linux, macOS and Windows, and falls back to Edge on macOS and Windows. On Linux it supplies Vulkan/WebGPU flags for the prototype. Its separate profile and model cache live in ignored `artifacts/play-browser-profile/`; your personal browser profile is unchanged. Close the window or press Ctrl+C to stop. If no browser is found, it prints the address; open it in your own browser.

Alternatively use `npm start` and open the URL in your own browser. Use `PORT=8080 npm run play` for another port. `CHROME=/path/to/chrome` overrides the browser executable.

### Browser and GPU setup

The local model needs WebGPU. Manual sandbox and the experimental CPU model work without it. The game checks for WebGPU when it opens; if it finds none, the guide **Get WebGPU on Windows, Mac or Linux** under **Who plays the hero?** opens with the short version of this table.

| | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| **Windows** | 113+, on by default. Windows on ARM: enable `chrome://flags/#enable-unsafe-webgpu`. | 141+, on by default. | — |
| **macOS** | 113+, on by default. | 147+ on Apple silicon. Intel Macs: Nightly only; use Chrome, Edge or Safari. | 26+, on by default. |
| **Linux** | On by default in Chrome 144+ for Intel Gen12 and newer, and in Chrome 147+ for NVIDIA (driver 535.183.01+) on Wayland. Other setups: use `npm run play`, or see below. | Nightly only. Mozilla plans to ship on Linux in 2026. | — |

To use your own Chrome on another Linux setup, close every Chrome window, then start it with the flags from the WebGPU status page and open the game:

```sh
google-chrome --enable-unsafe-webgpu --ozone-platform=x11 --use-angle=vulkan --enable-features=Vulkan,VulkanFromANGLE http://localhost:4173
```

If the game still reports no WebGPU, or reports software graphics:

1. Turn on hardware acceleration. In Chrome and Edge: Settings → System → *Use graphics acceleration when available*. In Firefox: Settings → General → Performance.
2. Update the graphics driver.
3. Restart the browser and reload the game.
4. Open `chrome://gpu` (or `about:support` in Firefox) and look for WebGPU. It should say hardware accelerated.

Phones and tablets: Chrome on Android 12+ and Safari on iOS 26 have WebGPU, but WebGPU needs HTTPS or localhost, and this prototype serves plain HTTP on your computer. Phone play is not set up or tested.

Only Chrome on Linux with an NVIDIA GPU (X11, `npm run play` flags) has been tested with this game. The rest of the table follows the [WebGPU implementation status page](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), last edited October 2026; check it for changes. A browser with WebGPU can still lack the GPU memory for a model; see the model sizes below.

The screen has three numbered columns: **1 Write the orders**, **2 Watch the trial**, **3 Read the report**.

1. The game checks WebGPU without downloading anything. The button under the stage names the selected model and its download size; click it to load. The initial download can take a few minutes, or much longer on a slow connection; loading stops only after five minutes without progress. **Play manually** skips the model and opens the Manual sandbox.
2. Click **Run these orders**. The stage shows the hero and the current opponent or place, and under them the turn being played. The panel under the controls shows the options on the table and (under **What the hero is told this turn**) the exact text the model receives. Each turn plays back in beats: the options stay up while the hero weighs them, the choice is stamped and the options not taken are crossed out, then the hero's action, the opponent's answer, any counter and any reward follow one at a time, each with its own sound. **Pace** and **♪** (sound on or off) sit beside the status line; **Skip** ends a turn's playback.
   - **Pace: Turn by turn** (the default) plays one turn per click and keeps that turn on the stage until **Next turn**. The model reads up to three decisions ahead meanwhile, so the next turn usually starts at once. **Normal** and **Fast** play turn after turn.
   - **Pause** freezes the trial at once, mid-turn if need be; **Continue** carries on from the same moment. While paused you can read, edit the orders, or switch assignment.
3. Compare the two example orders, or write your own. If you edit the orders mid-trial, the run button says **Restart with new orders**, and the trial restarts with the new text.
4. Read the report and optionally save its JSON.
5. After each assignment, choose **Next assignment** to go on: First instructions, Fair warning, Prize money, then the full circuit. The four assignment tabs also let you switch directly. In the two middle assignments, **An unfortunate first draft** is the previous assignment's winning orders, which fail on the new rule. The **Rulebook** button lists every rule.

The recommended **Qwen 3B** model uses WebGPU, downloads approximately 1.7 GB on first use, and needs roughly 3 GB GPU memory. The introductory assignment is deliberately short. Long policies in the later assignments are experimental: the tested models could ignore some of their conditions.

Other GPU models use WebLLM with four-bit weights and 32-bit arithmetic. The Qwen 2.5 7B build downloads approximately 4 GB and needs roughly 6 GB of GPU memory. Qwen 1.5B and 0.5B builds are also available. Bigger models did not automatically solve the multi-rule circuit in testing; see the recorded limits in `VERIFICATION.md`.

Under **Who plays the hero?**, **Change model or check this device** opens the model list and the device check. The check looks for a WebGPU adapter, software graphics, and browser buffer limits. With unknown GPU memory it suggests the tested 3B baseline, or a smaller option when buffer limits are low. Browsers do not expose total or free VRAM; the game never treats a GPU name, system RAM, or a buffer limit as available GPU memory. Under **Know your GPU memory?**, you can supply your capacity. The recommendation reserves 20% as headroom and considers larger candidates, including **Qwen3 8B** (about 5 GB download, estimated 6.9 GB GPU memory). Estimates do not guarantee a successful load or good decisions. Qwen3 is labeled experimental.

A suggestion that differs from your selection appears above the load button. **Use recommendation** changes the selection only when clicked. Checking again and changing the memory estimate never silently switch or unload your model. Downloads start only from a load button that names the model. Missing or software WebGPU suggests the experimental CPU option; Manual sandbox remains available. No benchmark, model download, or game action runs during the device check.

An experimental **Qwen 0.5B CPU** option runs through WebAssembly and needs no GPU. It downloads approximately 520 MB including tokenizer files, but was less reliable at following the orders. It does not silently replace the GPU controller.

A browser supporting the WebGPU API may still lack a usable adapter or enough memory. See `VERIFICATION.md` for the hardware and browser results actually obtained.

**Manual sandbox** offers the same game rules with clickable actions. It does not interpret prompts and is labeled separately from model-controlled play.

## What the demo implements

- An introductory assignment with one required training stamp, a return to camp, and a twelve-turn deadline.
- Two middle assignments on parts of the same course: Fair warning (the three stamp fights, with announced moves and guard, 16 turns) and Prize money (the circuit's second half: purse, optional prize fight, medic, Quickfoot, armorer, bench and champion, 30 turns).
- Progression to a fixed twelve-stop circuit with three stamps, an optional prize fight, a field medic, an armorer, a rest bench, and a champion.
- Health, stamina, two healing potions, coins, a choice of gear (sharper sword, buckler or extra potions), and a 32-turn deadline in the full circuit.
- A pure game engine. Quick strikes restore stamina; heavy strikes consume it. Agile enemies evade heavy strikes. An active enemy retaliates after a potion or a nonlethal attack.
- From Fair warning on, every opponent repeats a short routine and announces its next move: an ordinary strike, a big smash, bracing (strikes deal half) or winded (no attack). Guard blocks part of a hit; guarding a smash also counters it for a heavy strike's damage. The best action depends on what the opponent is about to do, so the orders have something to say about it. Each circuit prompt ends with a yes/no checklist (enemy about to SMASH, BRACING, WINDED, health LOW, optional fight), so short orders like "guard against a SMASH" can be matched directly. The introductory assignment keeps the original, simpler rules.
- Four optional commendations (finish early, use no potions, beat the prize bruiser, never take an unguarded smash). No single plan earns them all.
- The size of the orders, in words and tokens (the pieces of text a model reads). A loaded model counts the tokens with its own tokenizer; before that they are estimated and shown as "about". The size makes no claim about how well a model will follow the orders, and never changes how a trial plays.
- Browser inference in a dedicated Web Worker. Both backends generate a JSON action ID. CPU decoding is restricted to the offered JSON strings; GPU decoding uses WebLLM's JSON Schema support.
- Strict parsing, a second engine-side legality check, retry without consuming turns on format errors, and stale-response rejection after pause/restart/controller changes.
- Pause, a turn-by-turn pace, reset, editable standing orders, local prompt persistence, and a report export.
- Turn playback decoupled from the engine: a turn resolves at once, then the stage replays it beat by beat while the model already reads the next turn.
- Responsive layouts for three, two and one columns. The circuit map is code-drawn SVG. Portraits are generated illustrations stored in `assets/art/` (requests in `assets-src/wanted-images.tsv`); a letter placeholder appears if one is missing. No external font dependencies.

The simulation pauses during inference. The deadline counts game actions, not download or thinking time. During a run, the next decision is requested as soon as a turn resolves, so the model works while the player watches that turn play back; the reply is used only if it was asked for the same trial and the same game state, and Pause, Restart or a mode change drops it. The worker takes one request at a time. Each decision in the report records `preparedAhead` (ready before its options went up) and `waitedMs` (how long the hero visibly waited for the model beyond the time the options are always shown). When only one action is available, the game resolves it automatically and records `auto` as the source. All genuine choices in LLM mode go through the model. The course and combat rules stay fixed between retries. Model decisions are not guaranteed to repeat identically across model versions or devices.

## Model downloads and privacy

For CPU inference, the worker imports Transformers.js **3.8.1** from jsDelivr, then downloads `onnx-community/Qwen2.5-0.5B-Instruct` in q8 format from Hugging Face. It uses ONNX Runtime Web with one WebAssembly thread, so it works without cross-origin isolation headers.

For GPU inference, the worker imports WebLLM **0.2.88** from the official documentation's `esm.run` CDN route. WebLLM downloads its compiled model library and model assets from its configured public hosts, including Hugging Face.

No prompt or game state is sent to an inference API; inference runs on the client. Asset hosts receive ordinary download requests. The initial visit and model load require internet access, and browser caches can be evicted.

## Architecture

```text
Player orders + visible state + available action menu
                        ↓
                  Model worker
                        ↓
                {"action":"quick"}
                        ↓
           Strict parser + legality check
                        ↓
             Game engine → next state
```

- `src/game.js`: all rules, resources, observations, and legal actions.
- `src/protocol.js`: message construction, JSON schema, and response validation.
- `src/llm-worker.js`: pinned Transformers.js/WebLLM loading and model inference.
- `src/model.js`: worker requests, loading, timeout, and disposal.
- `src/models.js`: model catalogue, lightweight device checks, and conservative recommendations.
- `src/app.js`: UI, expedition control, cancellation, and reports.
- `src/map.js`: original SVG circuit and hero drawing.
- `tools/balance.mjs`: headless balance harness. Plays a grid of simple order styles as scripted bots, with and without random slips, and lists the undominated ways to win each fight. Measurement only; never a controller.
- `tools/probe.mjs`: asks the real local model for single decisions in fixed circuit situations, to check whether orders and prompt wording are readable for a small model. It plays no game.
- `DESIGN.md`: the broader proposed design, beyond this first implementation.

The model returns an ID rather than arbitrary functions or JavaScript. IDs map to commands generated by game code. Bad tactical choices are allowed; invented commands and free rewards are not.

Qwen3 runs with thinking disabled. Its adapter removes only WebLLM's exact empty thinking prefill before strict JSON validation. The original response is retained as `modelOutput` in the decision report; nonempty reasoning or arbitrary wrappers still fail validation.

The CPU adapter tokenizes the valid JSON responses. During generation it permits only tokens that continue at least one offered response. It preserves the model's original scores among those tokens, so the model chooses the action while the adapter enforces the response format. There is no scripted tactical policy in the adapter. Model scores at branching points and the exact received orders are included in the diagnostic report.

## Verification

```sh
npm test
npm run test:browser
npm run test:llm
npm run test:llm -- --full
npm run test:llm -- --circuit   # the model also plays the full circuit with the example orders; recorded as evidence
npm run test:llm -- --levels    # the model also plays both middle assignments, with each one's careful orders and first draft
                                # (--levels=prize for one; QUEST_ORDERS='A || B' to compare other orders)
node tools/balance.mjs          # balance proxies for the full circuit (no browser, no model); --level warning|prize for the others
node tools/probe.mjs            # the real model answers 13 fixed circuit situations with the example orders
npm run test:llm -- --cpu
QUEST_MODEL=Qwen3-8B-q4f32_1-MLC npm run test:llm -- --full
QUEST_LOAD_MINUTES=60 npm run test:llm -- --full   # allow a slow first download
QUEST_PROFILE=artifacts/llm-test-profile npm run test:llm -- --full   # keep the test browser profile, so a download is not repeated
```

Rule tests need only Node. Browser tests need Google Chrome (`CHROME=/path/to/chrome` can override the executable). The UI smoke test uses a deterministic policy to exercise the real controls and complete the circuit, then wins the two middle assignments with fixed clicks; it is not an LLM benchmark. It then exercises the LLM-mode controls (load, thinking, a stale reply after Restart, unusable output, edited orders, pause, turn playback with decisions prepared ahead, Pause during playback, Skip) against a stub worker that the test injects; that part involves no inference either. `node tools/shots.mjs` saves review screenshots of every main state at three window sizes.

The LLM smoke test downloads the real baseline GPU model in an isolated browser and verifies a combat decision, then changes the standing orders and checks that the same situation produces a different action. `--full` additionally checks a complete model-controlled introductory assignment. `--cpu` selects the experimental CPU model. `--software-gpu` selects Qwen 0.5B with software WebGPU for a GPU-runtime diagnostic. `QUEST_MODEL` overrides the GPU model and stores its evidence in a separate model-named artifact directory. Test browser profiles are temporary and removed afterward.

On Linux the hardware test uses Chrome's [documented headless Vulkan flags](https://developer.chrome.com/blog/supercharge-web-ai-testing). These apply only to its isolated test browser; it does not alter your existing browser profile or system settings. If the game reports no WebGPU adapter in your normal browser, see [Browser and GPU setup](#browser-and-gpu-setup) or select the CPU option.

Screenshots and JSON reports go in ignored `artifacts/`. See `VERIFICATION.md` for the results actually obtained in this workspace.

This repository is local. No remote hosting or publication is configured.

## Runtime references

- [Transformers.js browser installation](https://huggingface.co/docs/transformers.js/v3.8.1/en/installation)
- [Qwen 0.5B ONNX model and Transformers.js usage](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct)
- [Transformers.js custom logits processors](https://github.com/huggingface/transformers.js/blob/3.8.1/src/generation/logits_process.js)
- [WebLLM JSON mode](https://github.com/mlc-ai/web-llm/blob/main/examples/json-mode/src/json_mode.ts)
- [Pinned WebLLM model catalogue and GPU memory estimates](https://github.com/mlc-ai/web-llm/blob/v0.2.88/src/config.ts)
- [WebGPU adapter information and limits](https://gpuweb.github.io/gpuweb/#gpuadapter)
- [WebGPU implementation status by browser and OS](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)

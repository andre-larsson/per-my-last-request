# Per My Last Quest

A local prototype of a prompt-controlled adventure. Write standing orders for a guild applicant, watch their decisions, then revise the prompt and retry.

The introductory assignment teaches one rule: the hero must fight the practice rat to earn a stamp, then return home. Its first draft tells the hero to retreat from every fight. Change the orders to complete the assignment. A second, twelve-stop guild circuit adds resource management, equipment, and a champion.

The working title is provisional. The setting uses guild trials, equipment, contracts, and comic administrative incompetence. It avoids the bells, lantern objectives, coastal story, and other signature motifs of the neighboring Brinelight and Menhir projects.

## Run

Requires Node 22 or newer. No npm install or API key is needed.

```sh
npm run play
```

This serves the game at **http://localhost:4173** and opens a dedicated Chrome game window. On Linux it supplies Vulkan/WebGPU flags for the prototype. Its separate profile and model cache live in ignored `artifacts/play-browser-profile/`; your personal browser profile is unchanged. Close the window or press Ctrl+C to stop.

Alternatively use `npm start` and open the URL in your own browser. Use `PORT=8080 npm run play` for another port. `CHROME=/path/to/chrome` overrides the browser executable.

1. Click **Load local model**. The initial download can take a few minutes.
2. Click **Run these orders**, or use **One decision** to inspect each action.
3. Compare the two example prompts, or write your own. Restart to apply changed orders.
4. Inspect the expedition report and optionally save its JSON.
5. After the introductory assignment, choose **Next assignment** to try the full circuit. The assignment selector also lets you switch directly.

The recommended **Qwen 3B** model uses WebGPU, downloads approximately 1.7 GB on first use, and needs roughly 3 GB GPU memory. The introductory assignment is deliberately short. Long policies in the second assignment are experimental: the tested models could ignore some of their conditions.

Other GPU models use WebLLM with four-bit weights and 32-bit arithmetic. The largest selectable Qwen 7B build downloads approximately 4 GB and needs roughly 6 GB of GPU memory. Qwen 1.5B and 0.5B builds are also available. Bigger models did not automatically solve the multi-rule circuit in testing; see the recorded limits in `VERIFICATION.md`.

An experimental **Qwen 0.5B CPU** option runs through WebAssembly and needs no GPU. It downloads approximately 520 MB including tokenizer files, but was less reliable at following the orders. It does not silently replace the GPU controller.

A browser supporting the WebGPU API may still lack a usable adapter or enough memory. See `VERIFICATION.md` for the hardware and browser results actually obtained.

**Manual sandbox** offers the same game rules with clickable actions. It does not interpret prompts and is labeled separately from model-controlled play.

## What the demo implements

- An introductory assignment with one required training stamp, a return to camp, and a twelve-turn deadline.
- Progression to a fixed twelve-stop circuit with three stamps, an optional fight, a field medic, an armorer, a stamina-rest stop, and a champion.
- Health, stamina, two limited healing potions, coins, equipment upgrades, and a 38-turn deadline in the full circuit.
- A pure game engine. Quick strikes restore stamina; heavy strikes consume it. Agile enemies evade heavy strikes. An active enemy retaliates after a potion or a nonlethal attack.
- Browser inference in a dedicated Web Worker. Both backends generate a JSON action ID. CPU decoding is restricted to the offered JSON strings; GPU decoding uses WebLLM's JSON Schema support.
- Strict parsing, a second engine-side legality check, retry without consuming turns on format errors, and stale-response rejection after pause/restart/controller changes.
- Pause, single-step, reset, editable standing orders, local prompt persistence, and a report export.
- Responsive layouts and code-drawn SVG scenery; no external art or font dependencies.

The simulation pauses during inference. The deadline counts game actions, not download or thinking time. When only one action is available, the game resolves it automatically and records `auto` as the source. All genuine choices in LLM mode go through the model. The course and combat rules stay fixed between retries. Model decisions are not guaranteed to repeat identically across model versions or devices.

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
- `src/app.js`: UI, expedition control, cancellation, and reports.
- `src/map.js`: original SVG circuit and hero drawing.
- `DESIGN.md`: the broader proposed design, beyond this first implementation.

The model returns an ID rather than arbitrary functions or JavaScript. IDs map to commands generated by game code. Bad tactical choices are allowed; invented commands and free rewards are not.

The CPU adapter tokenizes the valid JSON responses. During generation it permits only tokens that continue at least one offered response. It preserves the model's original scores among those tokens, so the model chooses the action while the adapter enforces the response format. There is no scripted tactical policy in the adapter. Model scores at branching points and the exact received orders are included in the diagnostic report.

## Verification

```sh
npm test
npm run test:browser
npm run test:llm
npm run test:llm -- --full
npm run test:llm -- --cpu
```

Rule tests need only Node. Browser tests need Google Chrome (`CHROME=/path/to/chrome` can override the executable). The UI smoke test uses a deterministic policy to exercise the real controls and complete the circuit; it is not an LLM benchmark.

The LLM smoke test downloads the real recommended GPU model in an isolated browser and verifies a combat decision, then changes the standing orders and checks that the same situation produces a different action. `--full` additionally checks a complete model-controlled introductory assignment. `--cpu` selects the experimental CPU model. `--software-gpu` selects Qwen 0.5B with software WebGPU for a GPU-runtime diagnostic. Test browser profiles are temporary and removed afterward.

On Linux the hardware test uses Chrome's [documented headless Vulkan flags](https://developer.chrome.com/blog/supercharge-web-ai-testing). These apply only to its isolated test browser; it does not alter your existing browser profile or system settings. If the game reports no WebGPU adapter in your normal browser, use a WebGPU-enabled browser or select the CPU option.

Screenshots and JSON reports go in ignored `artifacts/`. See `VERIFICATION.md` for the results actually obtained in this workspace.

This repository is local. No remote hosting or publication is configured.

## Runtime references

- [Transformers.js browser installation](https://huggingface.co/docs/transformers.js/v3.8.1/en/installation)
- [Qwen 0.5B ONNX model and Transformers.js usage](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct)
- [Transformers.js custom logits processors](https://github.com/huggingface/transformers.js/blob/3.8.1/src/generation/logits_process.js)
- [WebLLM JSON mode](https://github.com/mlc-ai/web-llm/blob/main/examples/json-mode/src/json_mode.ts)

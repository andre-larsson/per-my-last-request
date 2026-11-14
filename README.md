# Per My Last ReQuest

A local prototype of a prompt-controlled adventure. Write standing orders for a guild applicant, watch their decisions, then revise the prompt and retry.

The introductory assignment teaches one rule: the hero must fight the practice rat to earn a stamp, then return home. Its first draft tells the hero to retreat from every fight. Change the orders to complete the assignment. A second, twelve-stop guild circuit adds resource management, equipment, and a champion.

The project name is `per-my-last-request`, styled **Per My Last ReQuest** in the game. The setting uses guild trials, equipment, contracts, and comic administrative incompetence. It avoids the bells, lantern objectives, coastal story, and other signature motifs of the neighboring Brinelight and Menhir projects.

## Run

Requires Node 22 or newer. No npm install or API key is needed.

```sh
npm run play
```

This serves the game at **http://localhost:4173** and opens a dedicated Chrome game window. On Linux it supplies Vulkan/WebGPU flags for the prototype. Its separate profile and model cache live in ignored `artifacts/play-browser-profile/`; your personal browser profile is unchanged. Close the window or press Ctrl+C to stop.

Alternatively use `npm start` and open the URL in your own browser. Use `PORT=8080 npm run play` for another port. `CHROME=/path/to/chrome` overrides the browser executable.

1. The game checks WebGPU without downloading anything. Review its suggested model, or choose one yourself, then click **Load local model**. The initial download can take a few minutes.
2. Click **Run these orders**, or use **One decision** to inspect each action.
3. Compare the two example prompts, or write your own. Restart to apply changed orders.
4. Inspect the expedition report and optionally save its JSON.
5. After the introductory assignment, choose **Next assignment** to try the full circuit. The assignment selector also lets you switch directly.

The recommended **Qwen 3B** model uses WebGPU, downloads approximately 1.7 GB on first use, and needs roughly 3 GB GPU memory. The introductory assignment is deliberately short. Long policies in the second assignment are experimental: the tested models could ignore some of their conditions.

Other GPU models use WebLLM with four-bit weights and 32-bit arithmetic. The Qwen 2.5 7B build downloads approximately 4 GB and needs roughly 6 GB of GPU memory. Qwen 1.5B and 0.5B builds are also available. Bigger models did not automatically solve the multi-rule circuit in testing; see the recorded limits in `VERIFICATION.md`.

**Find a model for this device** checks for a WebGPU adapter, software graphics, and browser buffer limits. With unknown GPU memory it suggests the tested 3B baseline, or a smaller option when buffer limits are low. Browsers do not expose total or free VRAM; the game never treats a GPU name, system RAM, or a buffer limit as available GPU memory. Under **Know your GPU memory?**, you can supply your capacity. The recommendation reserves 20% as headroom and considers larger candidates, including **Qwen3 8B** (about 5 GB download, estimated 6.9 GB GPU memory). Estimates do not guarantee a successful load or good decisions. Qwen3 is labeled experimental.

**Use recommendation** changes the selection only when clicked. Checking again and changing the memory estimate never silently switch or unload your model. Downloads still require **Load local model**. Missing or software WebGPU suggests the experimental CPU option; Manual sandbox remains available. No benchmark, model download, or game action runs during the device check.

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
- `src/models.js`: model catalogue, lightweight device checks, and conservative recommendations.
- `src/app.js`: UI, expedition control, cancellation, and reports.
- `src/map.js`: original SVG circuit and hero drawing.
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
npm run test:llm -- --cpu
QUEST_MODEL=Qwen3-8B-q4f32_1-MLC npm run test:llm -- --full
```

Rule tests need only Node. Browser tests need Google Chrome (`CHROME=/path/to/chrome` can override the executable). The UI smoke test uses a deterministic policy to exercise the real controls and complete the circuit; it is not an LLM benchmark.

The LLM smoke test downloads the real baseline GPU model in an isolated browser and verifies a combat decision, then changes the standing orders and checks that the same situation produces a different action. `--full` additionally checks a complete model-controlled introductory assignment. `--cpu` selects the experimental CPU model. `--software-gpu` selects Qwen 0.5B with software WebGPU for a GPU-runtime diagnostic. `QUEST_MODEL` overrides the GPU model and stores its evidence in a separate model-named artifact directory. Test browser profiles are temporary and removed afterward.

On Linux the hardware test uses Chrome's [documented headless Vulkan flags](https://developer.chrome.com/blog/supercharge-web-ai-testing). These apply only to its isolated test browser; it does not alter your existing browser profile or system settings. If the game reports no WebGPU adapter in your normal browser, use a WebGPU-enabled browser or select the CPU option.

Screenshots and JSON reports go in ignored `artifacts/`. See `VERIFICATION.md` for the results actually obtained in this workspace.

This repository is local. No remote hosting or publication is configured.

## Runtime references

- [Transformers.js browser installation](https://huggingface.co/docs/transformers.js/v3.8.1/en/installation)
- [Qwen 0.5B ONNX model and Transformers.js usage](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct)
- [Transformers.js custom logits processors](https://github.com/huggingface/transformers.js/blob/3.8.1/src/generation/logits_process.js)
- [WebLLM JSON mode](https://github.com/mlc-ai/web-llm/blob/main/examples/json-mode/src/json_mode.ts)
- [Pinned WebLLM model catalogue and GPU memory estimates](https://github.com/mlc-ai/web-llm/blob/v0.2.88/src/config.ts)
- [WebGPU adapter information and limits](https://gpuweb.github.io/gpuweb/#gpuadapter)

# Verification notes

Original prototype checks on 2026-11-13, with model-selection checks added on 2026-11-14. This file distinguishes game-rule checks, browser UI checks, and genuine model inference.

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

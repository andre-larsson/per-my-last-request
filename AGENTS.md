# Per My Last Quest

- Local browser game prototype. Working title; no remote or deployment is configured.
- Plain browser ES modules and CSS, with a Node-only development server. Avoid introducing a frontend framework for this small demo.
- Run with `npm run play` for a dedicated Chrome window, or `npm start` for the server alone. Run game/protocol tests with `npm test`, UI tests with `npm run test:browser`, and real browser inference verification with `npm run test:llm -- --full`.
- The introductory assignment is the verified end-to-end LLM demonstration. The original full circuit is the harder second assignment; do not claim its model-controlled victory without new evidence.
- Game outcomes and action prerequisites belong in `src/game.js`. Models select an offered action ID and cannot grant resources or execute code.
- Preserve the explicit distinction between local LLM mode and manual sandbox. Do not silently substitute a scripted policy for inference.
- Keep model failures separate from tactical failures. A generation, parsing, or loading error consumes no game turn.
- Preserve prompt and state revisions when changing asynchronous controls so stale model replies cannot act after a restart or pause.
- Keep this game's fiction distinct from neighboring projects, particularly Brinelight's bells, magical light, tides, and keeper story, and Menhir's standing-stone island puzzles.
- Do not push, publish, or add a Git remote unless asked.

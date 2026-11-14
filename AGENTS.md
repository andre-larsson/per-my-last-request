# Per My Last ReQuest

- Browser game prototype, published at https://a403.space/per-my-last-request/ (repo `andre-larsson/per-my-last-request`) and listed on the Games hub (`andre-larsson/games`). Working title.
- Plain browser ES modules and CSS, with a Node-only development server. Avoid introducing a frontend framework for this small demo.
- Run with `npm run play` for a dedicated Chrome window, or `npm start` for the server alone. Run game/protocol tests with `npm test`, UI tests with `npm run test:browser` (manual play plus the LLM-mode controls against a test-injected stub worker; no inference), and real browser inference verification with `npm run test:llm -- --full`.
- The introductory assignment is the verified end-to-end LLM demonstration. Fair warning and Prize money sit between it and the full circuit, the hardest and last assignment; do not claim a model-controlled victory without new evidence (see `VERIFICATION.md`).
- The music is a musicbox text score, `assets/music/after-hours.scrim`, played by the vendored player in `vendor/musicbox/`. Check edits with `npx -y github:andre-larsson/musicbox check assets/music/after-hours.scrim`; `GAME_NOTES.md` has the cues, layers and measured levels.
- Review UI changes with `node tools/shots.mjs` (screenshots of every main state at three window sizes, plus a text-size audit; output in `artifacts/shots/`). Rebuild portraits from `assets-src/raw/` with `python3 tools/art.py`.
- `GAME_NOTES.md` holds design decisions, the art style preamble, and open playtest questions. Read it first and update it last.
- `src/view.js` and `src/map.js` are pure presentation: they read game state and return data or markup. Every rule the Rulebook dialog states has a test in `tests/view.test.mjs`; keep the two in step.
- Game outcomes and action prerequisites belong in `src/game.js`. Models select an offered action ID and cannot grant resources or execute code.
- Preserve the explicit distinction between local LLM mode and manual sandbox. Do not silently substitute a scripted policy for inference.
- Keep model failures separate from tactical failures. A generation, parsing, or loading error consumes no game turn.
- Preserve prompt and state revisions when changing asynchronous controls so stale model replies cannot act after a restart or pause.
- Keep this game's fiction distinct from neighboring projects, particularly Brinelight's bells, magical light, tides, and keeper story, and Menhir's standing-stone island puzzles.
- The Manual sandbox is local only. `tools/build.mjs` removes `data-manual-sandbox` from `<html>`, so the published site offers model-controlled play alone; mark any new sandbox-only element `.manual-only`.
- Deploy: `.github/workflows/pages.yml` runs `npm test`, assembles `_site/` with `node tools/build.mjs`, and deploys it on push to `main`. Pushing to `main` deploys the live site, so push only when asked; then watch the Actions run and check the live URL.
- When asked to commit, commit directly to `main`. Do not create a branch first.

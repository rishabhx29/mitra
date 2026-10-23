# Mitra (app)

Electron + React voice assistant. See root `AGENTS.md`, `GLOSSARY.md`, `docs/superpowers/plans/2026-10-24-mitra-mvp.md`.

## Commands

```bash
npm install
npm run dev        # electron-vite dev (settings window opens)
npm run typecheck  # tsc on node + web configs — must be green before committing
npm run build      # production build (main/preload/renderer)
npm test           # vitest unit tests
npm run dist       # windows portable exe
```

## Conventions for agents

- Unit tests cover **pure logic only** (ACL, dispatch, mock stores, state machines, smoothing math). Visuals are verified via the dev harness pages (`?window=settings#/dev/persona`) and screenshots — do not attempt jsdom/WebGL render tests.
- Copy code out of `_reference/` with `// adapted from <repo> (MIT)` attribution; never import from `_reference/` at runtime.
- Mock mode is a feature: every provider/tool degrades gracefully when env keys are missing.

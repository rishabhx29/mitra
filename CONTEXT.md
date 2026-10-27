# Mitra — Context Handoff v2 (2026-10-25, after local-voice stack)

Supersedes the previous CONTEXT.md content: the local voice stack described there as "in-flight" is now **DONE and committed** (`1d3d7fc`). Read this fully. Working dir: `C:\Rishabh\Bolna hackathon` (Windows, Git Bash). App in `app/`. Also read: `AGENTS.md`, `GLOSSARY.md`.

## Project

**Mitra** — desktop voice AI assistant for the **Bolna Buildathon (deadline Oct 31, 2026)**. Electron 39 + electron-vite + React 19 + Tailwind v4 + three/R3F, TypeScript strict, version 0.2.0.

**Voice brain tiers (final architecture):**
1. **Bolna** (when `app/.env` has BOLNA_API_KEY/BOLNA_AGENT_ID) — live voice via `@bolna/web-call` (SDK v3.0.1 has NO transcript events — known limitation).
2. **Local voice (free forever, offline, NEW)** — Vosk STT via `vosk-browser` WASM (14 languages, small-model zips downloaded once into `<userData>/models/`, served to the renderer by the bridge `/api/models/file/:lang`), TTS via OS `speechSynthesis`, conversation via `/api/brain/chat` (Ollama tier-1 → deterministic mock). Selected automatically when no Bolna keys AND a microphone exists. Mic-less machines auto-fall-back to mock on start failure.
3. **Mock** (always available; forced when `?dev=1` on the overlay URL = e2e, or `forceMock`).

Tool execution is intent-driven in ALL tiers (shared `parseIntent`/`intentToTool` from mockProvider: en/hi/Hinglish; tools = notion, launcher, opencode, url, workspace modes, reminder, lock, memory, status — all behind the ACL).

Verification: `cd app && npm run typecheck && npm run build && npx vitest run` → **538 tests / 31 files green**; `MITRA_E2E=1 npx playwright test` → **8/8 green**. Always free port 8765 first (`netstat -ano | grep :8765` → `taskkill //F //PID <pid>`).

## Just completed (commits `1d3d7fc` + earlier)

- Local voice stack: `src/shared/voiceLanguages.ts` (14 langs: en-us/en-in/hi/gu/te/es/fr/de/it/pt/ru/ja/ko/cn), `src/server/models.ts` (download store, atomic, injected fs/fetch), bridge routes `/api/models/{status,status/:lang,download,file/:lang}`, `src/voice/localProvider.ts` (Vosk + OS TTS + intent/chat pipeline; typed text + recognized speech take the same path), mic/dev guards in `src/voice/index.ts` factory, mic-fallback in SessionController, `src/settings/VoicePanel.tsx` (language select, download+status, test voice) registered as the "Voice" section, i18n en+hi, tests (models 6, localProvider 5).
- Ollama installed (winget) and **qwen2.5:3b pulled**; gemma2:2b pull started in background (`/tmp/ollama-gemma.log`). Verify: `ollama list`. The app auto-detects Ollama for chat (Console status bar shows the model).
- Earlier: first-launch-visible fix, avatar thumbnail + auto-sample, console Enter fix, Ultron port, e2e 8/8.

## Remaining work (all human-facing or optional polish)

1. **User**: Bolna keys → `app/.env` (then voice auto-upgrades to tier 1; local voice remains default fallback).
2. **User**: GUI pass — `cd app && npm run dev`. Try: Voice panel (download Hindi model ~40MB, Test voice), overlay with real mic (Hindi/Hinglish), Console from Home.
3. **Optional**: rebuild exe after any further change (`cd app && npm run dist`, ~116MB portable → `dist/Mitra-0.2.0-portable-x64.exe`). The exe rebuilt BEFORE the local-voice commit does NOT include it — **rebuild needed** (a background `npm run dist` was started at the time of writing; check `app/dist/` timestamps vs last commit).
4. **User**: demo video per `docs/DEMO_SCRIPT.md` (add a Voice-panel + local-voice line), GitHub push (no remote yet), **submit by Oct 31**.

## Gotchas (learned the hard way — keep following these)

- e2e MUST see `?dev=1` (main adds it to the overlay when MITRA_E2E=1) → factory forces Mock. Without a rebuild after source changes, e2e tests a STALE app.
- Free port 8765 before e2e; orphaned bridges cause false failures.
- `npm` from workflow/CDP scripts: use `node C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`.
- Electron navigates on stray file drops unless a window-level dragover/drop guard exists (settings/fullscreen/console have it — add to any new window).
- Explicit Enter handling in inputs (disabled submit button kills implicit submission).
- Avatar upload `accept=".vrm"` only; Bolna endpoint is `/web-call/freeswitch-session`.
- `vosk-browser` 0.0.8 API: `createModel(url)` → `new model.KaldiRecognizer(16000)` → `acceptWaveformFloat(Float32Array, sampleRate)` + `on('result')`; model terminates on session stop.
- Vosk model zips: official mirror alphacephei.com/vosk/models (Apache-2.0); Indian langs available small: hi, gu, te (+ en-in).

## Map (unchanged from v1 except voice)

`app/electron/` windows+hotkey+tray+IPC+bridge-start · `app/src/server/` bridge (session/tools/brain/models/notion) · `app/src/voice/` providers (mock/bolna/local + index factory) · `app/src/overlay/` · `app/src/console/` · `app/src/persona/` · `app/src/settings/` (11 panels) · `app/assets/avatars/` (4 samples + ATTRIBUTION.md) · docs: ULTRON_PORT, CONSOLE_PLAN, DESIGN_BRIEF, DEMO_SCRIPT, plans/2026-10-24-mitra-mvp.

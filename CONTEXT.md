# Mitra — Context Handoff (2026-10-25)

Read this fully before doing anything. Working dir: `C:\Rishabh\Bolna hackathon` (Windows, Git Bash). App lives in `app/`. Also read: `AGENTS.md` (rules + glossary), `GLOSSARY.md`, `docs/superpowers/plans/2026-10-24-mitra-mvp.md`.

## Project

**Mitra** — cross-platform desktop voice AI assistant for the **Bolna Buildathon (submission deadline Oct 31, 2026)**. Electron 39 + electron-vite + React 19 + Tailwind v4 + three/R3F. TypeScript strict. Git repo, no remote yet. All commits by "Mitra Team".

Feature set (shipped, green): hotkey voice overlay (Ctrl+Shift+Space, en/hi/Hinglish mock brain, permission-ACL tools, status pill, 12s/30s inactivity timeouts), AGI-style Console window (chat + tool cards, boot sequence), local Ollama brain tier for chat (auto-detect localhost:11434, prefers qwen2.5:3b → gemma2:2b, mock fallback), Ultron-port features (workspace modes, reminders, lockdown, memory, status briefing), orb + VRM avatar personas (4 bundled samples, fullscreen orbit viewer, upload persists), redesigned settings (Home landing, glass panels, en+hi i18n).

Verification: `cd app && npm run typecheck && npm run build && npx vitest run` (last green: **527 tests / 29 files**) and `MITRA_E2E=1 npx playwright test` (**8/8** as of the avatar-thumbnail commit; one intermittent flake being fixed, see below). ALWAYS kill port-8765 squatters before e2e: `netstat -ano | grep :8765` → `taskkill //F //PID <pid>`.

## Current state

`git log --oneline` head ≈ `feat(persona): live avatar thumbnail…`. Working tree has **uncommitted work-in-progress: the local voice stack** (user asked for free-forever offline multilingual voice instead of Bolna-for-now). DO NOT discard it.

### In-flight: LocalVoiceProvider stack (user's latest request)

Goal: STT via **Vosk small models** (WASM `vosk-browser`, model zips downloaded on demand into userData/models, served to the renderer by the bridge over http://127.0.0.1:8765), TTS via **OS speechSynthesis**, conversation via existing `/api/brain/chat` (Ollama→mock). Free forever, offline, 14 languages (en-us, en-in, hi, gu, te, es, fr, de, it, pt, ru, ja, ko, cn).

Files already written (uncommitted):
- `app/src/shared/voiceLanguages.ts` — curated language map (id/label/native/ttsLang/modelUrl/approxMb) + `findVoiceLanguage`
- `app/src/server/models.ts` — ModelStore (ensure/status/read, injected fs+fetch, atomic .part→rename, never throws)
- `app/src/server/bridge.ts` — PATCHED with routes: GET `/api/models/status`, GET `/api/models/status/:lang`, POST `/api/models/download` {lang} (awaits ensure), GET `/api/models/file/:lang` (serves zip). Deps field `models?: ModelStore` added (params coerced with String() for Express 5 types)
- `app/src/shared/types.ts` — `Settings.voiceLanguage?: string` added
- `app/electron/store.ts` — schema + sanitize mapping for voiceLanguage added
- `app/src/voice/localProvider.ts` — LocalVoiceProvider (mic → ScriptProcessor 16k → vosk acceptWaveform → result → submitText pipeline reusing parseIntent/intentToTool/failureReply from mockProvider; tools via bridge; no-intent → /api/brain/chat; speak() via injected tts (OS speechSynthesis impl) with envelope + hard cap; syntheticAmplitude for orb)

**KNOWN ISSUE — exactly one typecheck error remains**: `src/voice/localProvider.ts:161` — `this.recognizer.on?.('result', ...)` — the local `recognizer` field is typed as `{ terminate?(): void }` (narrowed after assignment) so `.on` doesn't exist and `e` is implicit any. Fix: widen the field type to the full recognizer shape from the `createRecognizer` dep type (e.g. store it as `Awaited<ReturnType<NonNullable<LocalProviderDeps['createRecognizer']>>>` or define an exported `VoskRecognizerLike` interface and use it for the field + cast at assignment).

### Remaining steps for this feature (in order)

1. Fix the typecheck error above → full gates green.
2. Provider selection: extend `app/src/voice/index.ts` `createVoiceProvider`: if `forceMock` (e2e) or no `navigator.mediaDevices` → Mock; else if BOLNA keys (existing /api/session probe returns real session) → Bolna; else → **LocalVoiceProvider** (it self-downloads its model in start()). Pass `getLanguage: () => settings.voiceLanguage` — note SessionController currently builds providers with `{ language }`; extend `CreateVoiceProviderOptions` with `getVoiceLanguage?: () => string` and wire from SessionController (it has settings).
3. SessionController (`app/src/overlay/SessionController.tsx`): amplitude wiring — add `else if (provider instanceof LocalVoiceProvider) localAmpBox.current = provider.syntheticAmplitude` next to the Mock/Bolna instances (lines ~119), and include it in the 60fps merge `Math.max(...)` (lines ~100). Provider import from `../voice`.
4. `app/electron/main.ts`: add to startBridge deps: `models: createModelStore({ dir: join(app.getPath('userData'), 'models'), log: (m) => console.log('[mitra:models] ' + m) })` (import from `../src/server/models`). Optionally forward download completion via onProgress → sendToSettings.
5. Settings UI: new `app/src/settings/VoicePanel.tsx` — language `<select>` from VOICE_LANGUAGES (label + native + ~MB), status badge (poll `/api/models/status/:lang`), Download button (POST `/api/models/download`), "Test voice" button (uses window.speechSynthesis directly with findVoiceLanguage(settings.voiceLanguage).ttsLang), provider-mode line. Register in `src/settings/App.tsx` SECTIONS + sidebar, i18n keys en+hi (`src/i18n/{en,hi}.ts`). Saves via existing `save({ voiceLanguage })`.
6. Unit tests: `src/server/models.test.ts` (ensure→download→ready with fake fs/fetch; failure→error; read returns bytes; unknown lang), `localProvider.test.ts` (submitText: intent→tool call via fake fetch; chat fallback; speak fallback timing with fake tts + fastTimers; stop() disposes), language-map sanity (unique ids, https urls).
7. e2e: overlay path must stay Mock (MITRA_E2E=1 already forces it via forceMock — verify the factory still honors it). Optionally extend smoke test 2 to open the Voice panel and see the select.
8. Gates + e2e → thematic commits (suggested: `feat(voice): free-forever local voice — vosk STT (14 langs, on-demand models) + OS TTS + Ollama chat brain` then `feat(settings): Voice panel…`).
9. Rebuild exe: `cd app && npm run dist` (~116MB portable, `dist/Mitra-0.2.0-portable-x64.exe`).

### Also in-flight (background)

- **Ollama install** via winget was kicked off in background (`exec_d47d80c7`); after it completes run: `"C:\Users\akash\AppData\Local\Programs\Ollama\ollama.exe" pull qwen2.5:3b` and `pull gemma2:2b` (user explicitly wants Gemma + a fast task model). Verify with `curl http://127.0.0.1:11434/api/tags`. The app auto-detects it (brain tier 1).
- **e2e flake (test 6)**: after the thumbnail change, "terminal permission off" test intermittently dead-ends with the caption stuck on the greeting — the typed input lands before the re-summoned provider is live. `expectProviderReady()` guard was added to the spec (uncommitted) but the run still flaked once; suspected MockProvider `this.chain` wedge (serialized submitText queue behind a never-settling run — speak/envelope are time-bounded, runTool fetch has NO timeout; consider adding AbortSignal.timeout(8000) to the mock provider's tool fetch). Investigate only if it recurs.

## User's standing instructions

- Work **solo** (no subagents) — user switched to this after slow agent waves.
- Commit **thematically and often** (`feat(scope): …`); never one big commit. Git identity is configured repo-local.
- Mock mode is first-class: everything works with zero keys/offline.
- Bolna keys will be added later in `app/.env` (BOLNA_API_KEY/BOLNA_AGENT_ID) — when present the app should prefer Bolna for voice (selection order above). The user still needs to: GUI pass, record demo video (docs/DEMO_SCRIPT.md), push to GitHub (no remote yet), submit by **Oct 31**.
- When `.env` appears: verify live voice (boot dev, bridge `/api/health` should stop reporting mock:true — actually health mock flag tracks Bolna keys for session minting).

## Architecture quick map

- `app/electron/` — main process: windows (overlay 220×220 transparent always-on-top, settings, fullscreen avatar, console), hotkey, tray, IPC (settings zod store, avatar copy, e2e hooks `mitra:e2e-*` gated by MITRA_E2E=1), bridge startup on 127.0.0.1:8765.
- `app/src/server/` — express bridge: /api/session (Bolna mint, mock-safe), /api/tools/:name (ACL dispatcher; tools: notion, launcher, opencode, url, workspace, reminder, lock, memory, status), /api/brain/{status,chat} (Ollama→mock), /api/models/* (new), /api/notion/items. Everything injectable for vitest.
- `app/src/voice/` — VoiceProvider implementations: mockProvider (deterministic brain + parseIntent/intentToTool exports), bolnaProvider (@bolna/web-call; SDK v3.0.1 has NO transcript events — known limitation), localProvider (new).
- `app/src/overlay/` — summon circle UI (PersonaStage + status pill + dev input `?dev=1` under MITRA_E2E).
- `app/src/console/` — chat window (consoleModel reducer + Thread/ToolCard/BootSequence).
- `app/src/persona/` — Orb (samantha-ui-derived shaders) + Avatar (three-vrm + wawa-lipsync) behind PersonaStage.
- `app/src/settings/` — panels (Home, Persona, Permissions, Apps, Modes, Notion, Memory, Hotkey, Language, Transcript, FullscreenAvatarView) + mitraClient (window.mitra with local fallback).
- Bundled VRM avatars: `app/assets/avatars/` (Seed-san + 3 VRoid samples; ATTRIBUTION.md; served via allowlisted setAvatarFile IPC).
- Research/decisions: `research/00-05`, `docs/ULTRON_PORT.md`, `docs/CONSOLE_PLAN.md`, `docs/DESIGN_BRIEF.md`, `docs/DEMO_SCRIPT.md`.

## Gotchas learned the hard way

- `world.run('npm')` in workflows: ENOENT on Windows — use `node C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`.
- Electron drops → window NAVIGATES to the file unless a window-level dragover/drop preventDefault guard exists (settings + fullscreen + console have it; keep it in new windows).
- Chromium implicit form submission requires a non-disabled submit button — always add explicit onKeyDown Enter handling (console input does this).
- Packaged app boots: settings window must be shown on first launch (fixed) or double-click looks dead.
- e2e needs port 8765 free; CDP-injected files have no File path (getPathForFile returns '') — not a product bug.
- Avatar upload `accept=".vrm"` ONLY (the MIME token grays files out in Windows dialogs).
- Bolna session endpoint is `/web-call/freeswitch-session` (per SDK d.ts), not `/web-call/session`.

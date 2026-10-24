# Mitra (app)

Electron + React desktop voice assistant — hotkey-summoned orb overlay, voice sessions
(English / Hindi / Hinglish) and permission-gated tools, **fully functional in mock mode
with zero API keys**. See root `AGENTS.md`, `GLOSSARY.md` and
`docs/superpowers/plans/2026-10-24-mitra-mvp.md`.

## Quickstart (mock mode, no keys needed)

```bash
npm install
npm run dev        # electron-vite dev — boots to tray; Ctrl+Shift+Space summons the overlay
```

- **Ctrl+Shift+Space** (default) summons/dismisses the transparent overlay anywhere.
  The tray icon (Show settings / Toggle overlay / Quit) is the other entry point.
- Talk, or — for mic-less dev/testing — open the overlay with `MITRA_E2E=1` set and a
  dev text input appears at the bottom (`?dev=1` overlay affordance, same intent path
  as speech).
- With no keys configured the voice brain is `MockProvider`: intents are parsed
  locally (en / hi / Hinglish) and tools run against the local mock board. Missing
  keys never throw anything down — every path degrades.

Utterances the mock brain understands (see `src/voice/mockProvider.ts`):

| Intent | Examples |
|---|---|
| add to-do | "add milk to my todo list" · "मेरी लिस्ट में दूध जोड़ो" · "doodh add karo" |
| launch app | "open notepad" · "notepad kholo" (aliases from Settings → App launcher) |
| opencode task | "open opencode and build a snake game" · "open opencode aur banao ek landing page" |
| open link | "open github.com" |
| language switch | "speak hindi" · "अब हिंदी में बोलो" |
| stop | "stop" · "band karo" · "बंद करो" |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | electron-vite dev (main+preload+renderer with HMR) |
| `npm run typecheck` | `tsc --noEmit` on node + web configs — must be green before committing |
| `npm run build` | production build to `out/` (main / preload / renderer) |
| `npm test` | vitest unit tests (logic only, node env) |
| `npm run e2e` | Playwright Electron smoke (`npx playwright test`) — build first, see below |
| `npm run dist` | production build + electron-builder → `dist/Mitra-<version>-portable-x64.exe` |

## Architecture

```
                         ┌────────────────────────── Electron ──────────────────────────┐
                         │                                                              │
  Ctrl+Shift+Space ────▶ │  MAIN PROCESS (out/main/index.js)                            │
  tray menu / e2e hook ─▶ │  ├── hotkey ─┐                                              │
                         │              ▼                                              │
                         │  OverlayWindow 220×220 (frameless, transparent,             │
                         │  alwaysOnTop, showInactive — never steals focus)            │
                         │    └─ SessionController ── PersonaStage (Orb | VRM Avatar)  │
                         │         │                  └─ Captions (state + transcript) │
                         │         ├─ VoiceProvider                                    │
                         │         │    ├─ BolnaProvider (@bolna/web-call, WebRTC)     │
                         │         │    └─ MockProvider (local regex intents) ──────┐  │
                         │         ▼                                                 │  │
                         │  SettingsWindow (Persona · Permissions · Apps · Notion ·  │  │
                         │       │            Hotkey · Language · Transcript)        │  │
                         │       │ window.mitra  (preload IPC, contextIsolated)      │  │
                         │       ▼                                                   │  │
                         │  Local Bridge (express, 127.0.0.1:8765)                   │  │
                         │    POST /api/session      → mints Bolna session;          │  │
                         │    │                        {mock:true} without keys      │  │
                         │    POST /api/tools/:name  → ACL gate → tool dispatch ─────┘  │
                         │    GET  /api/notion/items → mock board (persisted)           │
                         │    GET  /api/health                                          │
                         │    tools: notion_add_todo · launch_app ·                     │
                         │           run_opencode_task · open_url                       │
                         └──────────────────────────────────────────────────────────────┘
```

- **IPC** (`src/shared/ipc.ts`, preload exposes `window.mitra`): `mitra:get-settings`,
  `mitra:set-settings` (zod-validated + persisted), `mitra:hide-overlay`,
  `mitra:toggle-overlay`, `mitra:session-event` (state / transcript / tool-result
  pushed to both windows).
- **ACL** (`src/server/acl.ts`): `notion_add_todo`→`notion`, `launch_app`→`launcher`,
  `run_opencode_task`→`terminal`, `open_url`→`browser`. The bridge answers `403
  {ok:false, summary:"Permission denied: <gate>"}` and the mock brain speaks an
  apology pointing at Settings. Defaults: notion / launcher / browser on, **terminal
  off**.
- **Persistence** (`electron/store.ts`, `src/server/mockNotion.ts`): settings at
  `%APPDATA%\Mitra\mitra-settings.json`, mock Notion board at
  `%APPDATA%\Mitra\mock-notion.json` (both under `app.getPath('userData')`).

## Real keys (optional)

Everything works offline; to use the real brain, set environment variables in the
shell **before** launching (`app/.env.example` documents them — note nothing loads
`.env` into the Electron main process yet):

```bash
BOLNA_API_KEY=…     # + BOLNA_AGENT_ID  → real voice sessions via @bolna/web-call
OPENCODE_PATH=…     # optional; otherwise opencode is auto-detected from PATH
```

`POST /api/session` returns a real Bolna session only when both Bolna vars are set;
any failure (bad key, offline, mint error) degrades to `{mock:true}` and the
`MockProvider` takes over. Real Notion is configured in Settings → Notion board
(token + database id); until then the mock board is used.

## Tests

**Unit** — logic only (no electron import, no jsdom/WebGL), via `vitest.config.ts`:

```bash
npm test            # 246 tests across acl/bridge/tools/voice/persona math/settings models
```

**E2E** (`e2e/smoke.spec.ts`) — launches the **built** app (`out/main/index.js`) in
mock mode with a scrubbed env, then pins the whole happy path: bridge health →
settings window → overlay summon + Escape dismiss → typed "add milk to my todo list"
→ tool result caption → `GET /api/notion/items` → terminal permission off → opencode
intent → permission-denied reply → "stop" → clean auto-dismiss.

```bash
npm run build
npm run e2e         # single worker; needs port 127.0.0.1:8765 free (close running Mitra)
```

Two small affordances make this automatable, both inert unless `MITRA_E2E=1`
(documented in `electron/main.ts`):

- main-process IPC channels `mitra:e2e-toggle-overlay` / `mitra:e2e-show-settings`,
  which re-trigger the same closures the hotkey and tray use (Playwright cannot press
  OS-level global shortcuts); the spec emits them via `electronApp.evaluate`.
- the overlay page is loaded with `?dev=1` so `SessionController` mounts its dev text
  input (`[data-testid="mitra-dev-input"]`), driving the exact mock-brain speech path.

The suite runs against an isolated `--user-data-dir` temp profile, so it never touches
your real settings or mock board.

## Packaging

`npm run dist` builds `out/` then runs electron-builder with `electron-builder.yml`
(Windows portable, x64, asar, unsigned) → `dist/Mitra-<version>-portable-x64.exe`.
The unpacked app is left in `dist/win-unpacked/`. An NSIS installer config is
included as a commented extra in `electron-builder.yml`. Product name/id come from
the yml (`Mitra` / `com.bolnabuildathon.mitra`); the tray icon is generated in code,
so no asset files are required to package.

## Conventions for agents

- Unit tests cover **pure logic only** (ACL, dispatch, mock stores, state machines,
  smoothing math). Visuals are verified via the dev harness page
  (`?window=settings#/dev/persona`) and screenshots — do not attempt jsdom/WebGL
  render tests.
- Copy code out of `_reference/` with `// adapted from <repo> (MIT)` attribution;
  never import from `_reference/` at runtime.
- Mock mode is a feature: every provider/tool degrades gracefully when env keys are
  missing.
- All user-facing strings go through `src/i18n` (`en` + `hi`).

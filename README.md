<div align="center">

# Mitra

**Your desktop, on voice.** A Jarvis-style assistant for Windows that runs **fully offline** — no cloud, no API keys, no cost.

[![Platform](https://img.shields.io/badge/platform-Windows-blue)](#install)
[![Tests](https://img.shields.io/badge/tests-767%20passing-brightgreen)](app/src)
[![E2E](https://img.shields.io/badge/e2e-8%20passing-brightgreen)](app/e2e/smoke.spec.ts)
[![Stack](https://img.shields.io/badge/stack-Electron%20·%20React%2019%20·%20Three.js-8A2BE2)](#how-it-works)

**[⬇ Download the installer (v0.2.2)](https://github.com/rishabhx29/mitra/releases/latest)**

</div>

---

## What is this?

Press **`Ctrl+Shift+Space`** anywhere → a Siri-style orb appears → speak in **English, Hindi, or Hinglish** → Mitra understands, and — with your permission — *actually does the thing*: opens apps and websites, searches YouTube and the web, writes into Notepad, adds to-dos, drives the **opencode** coding agent, sets reminders, and answers conversationally on a **local LLM**.

Built for the **Bolna Buildathon**. Every flow runs with zero API keys — the voice brain is Vosk (on-device STT), the reasoning brain is Ollama/qwen with a Laya fast-decision tier, and the voice is your OS.

## Install

1. Grab **`Mitra-Setup-0.2.2.exe`** from [**Releases**](https://github.com/rishabhx29/mitra/releases/latest) (or the portable exe — no install needed)
2. Launch — it lives in the tray; the settings window opens on first run
3. Press **`Ctrl+Shift+Space`** and just talk

Optional upgrades, auto-detected and never required: [Ollama](https://ollama.com) with `qwen2.5:3b` (local LLM brain), `laya-serve --model multilingual` (~50ms decision tier, auto-started at boot), Bolna keys in `app/.env` (cloud voice).

## What can you say?

| You say | Mitra does |
|---|---|
| "add chai to my todo list" | Adds it to the to-do board (Hindi/Hinglish too) |
| "open spotify" | Launches **any installed app** — alias or not (Start-Menu index) |
| "search avengers doomsday trailer" | **YouTube** search (media words route semantically) |
| "open animejs" / "open bolna site" | Opens **https://animejs.com** / **https://bolna.ai** — never seen them before |
| "open notepad and write hello from Mitra" | Opens Notepad **and types into it** |
| "open code and build a snake game" | Drives the **opencode** coding agent |
| "who are you?" | Converses on the local LLM — stays silent until spoken to |
| "aaj coding ka man hai" | Switches to your coding workspace preset |
| "remind me in 2 minutes to stretch" | Real desktop notification |

Nothing you say dead-ends: unknown names resolve through a Start-Menu index → DNS-verified site guess → LLM inference → web-search guarantee — always permission-gated by you.

## How it works

```
 ┌─ Overlay (orb/avatar) ── Speak or type ──┐
 │                                          ▼
 │            Local bridge (express, 127.0.0.1:8765)
 │   1. deterministic intents   ── instant, regex-pinned by tests
 │   2. Laya decision model     ── ~50ms semantic routing
 │   3. Ollama/qwen tool-calling── semantic actions + conversation
 │            │ every tool passes YOUR permission gates (ACL)
 │            ▼
 └─ Tools: apps · browser · YouTube · Notion board · notes · reminders · opencode · memory
```

- **Three windows**: the summon orb (3D wave orb or your VRM avatar with lip-sync), the Console (chat + tool cards), and Settings (permission matrix, aliases, modes, persona).
- **Mock mode is first-class**: with zero keys and zero models installed, every flow still works with honest local fallbacks — the demo never depends on credentials.
- **STT auto-repair**: misheard product names ("open court" → opencode) are repaired against a domain vocabulary before parsing.

## Build from source

```bash
git clone https://github.com/rishabhx29/mitra.git
cd mitra/app
npm install
npm run dev              # development
npm run typecheck && npm test        # 767 unit tests (42 files)
npx playwright test      # 8 e2e — boots the real app, mock mode, zero keys
npm run dist             # installer + portable exe → dist/
```

TypeScript strict throughout. The full verification story: unit-pinned utterances, ACL matrix tests, bridge HTTP tests on an ephemeral port, and an Electron smoke that drives the built app end-to-end.

## Docs

- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — the 3-minute demo flow
- [`docs/DESIGN_BRIEF.md`](docs/DESIGN_BRIEF.md) — UX decisions
- [`docs/DECISION_TIER_PLAN.md`](docs/DECISION_TIER_PLAN.md) — the three-tier brain, with the verified Laya contract
- [`app/assets/avatars/ATTRIBUTION.md`](app/assets/avatars/ATTRIBUTION.md) — bundled VRM licenses (user-supplied avatars surface their embedded license in-app)

## Licensing

MIT for this repo's code. Bundled sample avatars carry their own permissive licenses (linked above); dependencies are MIT/Apache/BSD only.

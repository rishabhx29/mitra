# Bolna Buildathon — Project Research: Overview & Brief

> Compiled 2026-10-24. Companion files: `01-desktop-voice-assistants.md`, `02-computer-use-agents.md`, `03-speech-services-indian-languages.md`, `04-voice-agent-frameworks.md`, `05-visuals-and-overlay.md`.

## 1. The hackathon (source: bolna.ai/symphony/buildathon)

- **Host:** Bolna (voice-AI company). Finale at **Symphony**, Bolna's event, **20 Nov 2026, Bengaluru** (The Lalit Ashok).
- **Timeline:** Apply & build Oct 15–31 → **Submission deadline Oct 31, 2026** → shortlist Nov 3 → interviews Nov 5–7 → results Nov 8 (top 10 get free Symphony tickets) → top 3 pitch at the finale Nov 20.
- **Requirement:** No fixed tracks — "Build whatever you like, as long as voice is part of it."
- **Prizes:** ₹1.2L total — ₹50k + YC interview (w/ Grey Baker) for 1st, ₹40k 2nd, ₹30k 3rd; travel covered for top 3.
- **Team size:** 1–4.
- **Sponsors (source of free credits, per FAQ):** **Plivo, Exotel, Sarvam AI, Cartesia, Deepgram, Kalpa Labs.** → Our stack should lean on these (Sarvam for Indic STT/TTS, Deepgram for English STT, Cartesia for TTS are the obvious fits).
- Judging rubric not published; selection = submission → interview.

**Implication: we have ~1 week. Research must translate into a buildable stack immediately.**

## 2. Our product definition (working spec)

Cross-platform **desktop voice AI assistant** — "Jarvis" for your laptop:

| Pillar | What it means |
|---|---|
| **Voice-first interaction** | Global keyboard hotkey summons a small circular, Siri-style orb overlay near the top bar; assistant listens, converses (low latency), confirms, executes |
| **Agentic action** | Executes real tasks: "add X to my Notion to-do", "open opencode in this project and build me a landing page", "open Spotify and play X", general app/terminal control |
| **Permission system** | GUI where the user grants the agent access to specific apps/integrations (an ACL) — safety + a demo-friendly visual |
| **Visual persona** | User chooses the assistant's face: real 3D mascot/avatar **or** a glowing 3D sphere/orb, with customization (color, behavior), audio-reactive animation |
| **Multilingual voice** | English (best available) + Hindi and other Indian languages, preferring Indian-built services (Sarvam, Bhashini, AI4Bharat…) |

Likely stack hypothesis (to be validated by research files 04/05): Electron or Tauri + React + Three.js; mic audio → streaming STT → LLM w/ tool-calling → streaming TTS; tools = MCP servers / CLI subprocesses (opencode) / REST APIs (Notion).

## 3. Research file index

| File | Covers |
|---|---|
| `01-desktop-voice-assistants.md` | Direct prior art: open-source desktop voice assistants & Jarvis-like projects (Leon, OpenVoiceOS, Willow, GitHub jarvis clones, closed products for UX reference) |
| `02-computer-use-agents.md` | Execution layer: computer-use/desktop-automation agents (Open Interpreter, UFO, Agent-S, self-operating-computer…), MCP servers for apps, opencode integration, OS automation libs |
| `03-speech-services-indian-languages.md` | STT/TTS landscape: Sarvam, Bhashini, AI4Bharat + Deepgram, Cartesia, ElevenLabs, OpenAI, Azure… and local fallbacks; Indic coverage, streaming, pricing |
| `04-voice-agent-frameworks.md` | Orchestration: Bolna's own platform/repo (host!), Pipecat, LiveKit Agents, TEN, Ultravox, realtime APIs, wake-word/VAD blocks, and recommended audio architecture |
| `05-visuals-and-overlay.md` | Persona & overlay UX: VRM/three-vrm, Live2D (license!), Amica, Open-LLM-VTuber, orb/sphere shaders, desktop pets, Electron/Tauri global-hotkey + transparent overlay windows |

## 4. Findings summary (read this first)

### 4.1 Nobody has built our exact product — differentiation is real
Closest neighbors, and what each is missing: **Leon** (17.6k★ — skills/agent/computer-use architecture, but web-app UI, no hotkey orb, no Indic voice), **OpenWhispr** (9.8k★ — hotkey+overlay dictation, but no actions), **ethanplusai/jarvis** (voice→Claude Code, but no persona/permissions/multilingual), **Open-LLM-VTuber** (Electron mascot w/ transparent always-on-top window, but no agentic computer control), **OpenClaw MVP** (Electron+Live2D voice assistant, small). Combining hotkey-orb overlay + agentic app control + permission ACL + 3D persona + Hindi/Hinglish is open space.

### 4.2 Recommended build stack (validated across all 5 research files)
| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron + React** (not Tauri) | Transparent/always-on-top/global-hotkey windows battle-tested (ueli, Open-LLM-VTuber both MIT); Tauri still has per-pixel click-through issues (#13070) |
| Voice brain | **Bolna hosted agent + `@bolna/web-call` SDK v3.0.1** | Hackathon host, WebRTC in Electron renderer, session-minted auth, **per-call language switch** (`agent_data.language: "hi"`) |
| STT | **Sarvam Saaras v4** (hi/Hinglish: `codemix`/`translate` modes + keyterm biasing for app names) / **Deepgram Flux** (English, interruption-aware) | Both sponsors; both native Bolna providers |
| TTS | **Cartesia Sonic 3.6** (hi-IN locale, Hinglish mixing, one multilingual persona voice) / Sarvam **Bulbul v4 Flash** (222 Indic voices) | Both sponsors; native Bolna providers |
| Actions | Notion → **official Notion MCP server** (or REST); coding agent → **`opencode run --format json`** / `opencode serve`; apps → `child_process`; stretch → DesktopCommanderMCP, playwright-mcp | See file 02 |
| Persona | **Orb day-3**: React Three Fiber + ShaderMaterial (fresnel + noise displacement, audio-reactive via Web Audio AnalyserNode — crib MIT `samantha-ui`); **VRM avatar stretch**: @pixiv/three-vrm + VRoid Studio model + wawa-lipsync | Live2D deferred — SDK license requires signed agreement for user-model apps; Ready Player Me shut down (Netflix acquisition, Jan 2026) |
| Deferred (roadmap slides) | Wake word (openWakeWord/Silero VAD), Bhashini/AI4Bharat offline mode, full screenshot computer-use (UFO/Agent-S/cua) | Pitch material, not week-1 material |

### 4.3 The killer demo line
Hinglish in → Hinglish out, with actions: user says *"open opencode aur ek portfolio website banao"* → Saaras `codemix` transcript → agent launches `opencode run` → orb pulses "building…" → Cartesia/Sonic replies in Hindi. Plus live language switching mid-session.

### 4.4 Practical notes
- Sponsor credits: Sarvam, Cartesia, Deepgram, Plivo, Exotel, Kalpa Labs — our picks consume 3 of 6 directly.
- opencode repo moved to `anomalyco/opencode` (220k★, MIT); `--format json` streams events for status display.
- Bolna OSS repo is MIT and active but "looking for maintainers" — prefer hosted APIs.
- *(research/_tools/ holds the GitHub-API verification scripts used to produce these files)*

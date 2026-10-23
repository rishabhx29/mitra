# Research 01 — Open-source desktop voice assistants & "Jarvis-like" prior art

> Direct prior art for our build. Stars/activity verified via GitHub API on **2026-10-24**. Our product: hotkey-summoned Siri-style orb overlay → voice command → agentic execution (Notion, apps, terminal, opencode) → 3D persona, English + Hindi/Indic.

## A. Verified project table (GitHub API, 2026-10-24)

| Project | Repo | ★ | License | Last push | Status |
|---|---|---|---|---|---|
| **Leon** | [leon-ai/leon](https://github.com/leon-ai/leon) | 17,599 | MIT | 2026-10-23 | Active (Leon 2.0 dev preview on `develop`) |
| **OpenVoiceOS core** | [OpenVoiceOS/ovos-core](https://github.com/OpenVoiceOS/ovos-core) | 297 | Apache-2.0 | 2026-10-22 | Active (Mycroft's community successor) |
| **Mycroft** | [MycroftAI/mycroft-core](https://github.com/MycroftAI/mycroft-core) | 6,619 | Apache-2.0 | 2024-09-08 | **Archived** (company shut down 2023) |
| **Rhasspy** | [rhasspy/rhasspy](https://github.com/rhasspy/rhasspy) | 2,750 | MIT | 2025-04-22 | **Archived** (offline assistant, RPi-era) |
| **Willow** | [HeyWillow/willow](https://github.com/HeyWillow/willow) | 3,128 | Apache-2.0 | 2026-10-01 | Active (ESP32 hardware focus) |
| **SUSI.AI server** | [fossasia/susi_server](https://github.com/fossasia/susi_server) | 2,519 | LGPL-2.1 | 2021-08-17 | Dormant/archived-ish |
| **Jasper** | [jasperproject/jasper-client](https://github.com/jasperproject/jasper-client) | 4,514 | MIT | 2023-07-19 | Dormant (2014-era classic) |
| **Jarvis (CLI, Linux/macOS)** | [sukeesh/Jarvis](https://github.com/sukeesh/Jarvis) | 3,769 | MIT | — | CLI personal assistant, plugin system |
| **Jarvis (Rust, offline)** | [Priler/jarvis](https://github.com/Priler/jarvis) | 2,994 | custom | — | WIP offline voice assistant in Rust |
| **Kalliope** | [kalliope-project/kalliope](https://github.com/kalliope-project/kalliope) | 1,786 | GPL-3.0 | — | YAML-driven assistant framework |
| **J.A.R.V.I.S (Python demo)** | [GauravSingh9356/J.A.R.V.I.S](https://github.com/GauravSingh9356/J.A.R.V.I.S) | 1,423 | MIT | — | Classic student-style Python jarvis |
| **Jarvis Desktop Voice Assistant** | [kishanrajput23/Jarvis-Desktop-Voice-Assistant](https://github.com/kishanrajput23/Jarvis-Desktop-Voice-Assistant) | 1,012 | MIT | — | Python, system-level commands |
| **jarvis — voice for Claude Code** | [ethanplusai/jarvis](https://github.com/ethanplusai/jarvis) | 908 | custom | — | **Talk to your Mac → drives Claude Code** |
| **PyGPT** | [szczyglis-dev/py-gpt](https://github.com/szczyglis-dev/py-gpt) | 2,001 | custom | — | Desktop AI assistant, huge LLM support |
| **Music Island** | [redheadesign/music-island](https://github.com/redheadesign/music-island) | 1,246 | — | — | **Controls docked at the top edge of screen** |
| **OpenClaw Assistant MVP** | [andyhuo520/openclaw-assistant-mvp](https://github.com/andyhuo520/openclaw-assistant-mvp) | 408 | — | — | **Electron AI voice assistant + Live2D character** |
| **Jarvis AI Assistant** | [AnubhavChaturvedi-GitHub/jarvis-ai-assistant](https://github.com/AnubhavChaturvedi-GitHub/jarvis-ai-assistant) | 368 | GPL-3.0 | — | Python voice → desktop control |
| **Alice** | [pmbstyle/Alice](https://github.com/pmbstyle/Alice) | 326 | MIT | — | **Voice-first desktop assistant, Electron + Vue** |
| **IRIS-AI** | [IRISX-AI/IRIS-AI](https://github.com/IRISX-AI/IRIS-AI) | 220 | — | — | Desktop assistant: voice, automation, memory, vision |

(★ for search-discovered rows measured same day; a few lack verified last-push — treat as indicative.)

## B. The dictation-cluster (hotkey + overlay UX — very close to our summon pattern)

These don't execute tasks (they insert text), but they solve exactly our **global-hotkey → listen → dismiss** UX:

| Project | Repo | ★ | Notes |
|---|---|---|---|
| **OpenWhispr** | [OpenWhispr/openwhispr](https://github.com/OpenWhispr/openwhispr) | 9,828 | Hotkey → speak → text at cursor. Local (Parakeet/Whisper) + BYOK cloud. MIT |
| **OpenSuperWhisper** | [Starmel/OpenSuperWhisper](https://github.com/Starmel/OpenSuperWhisper) | 3,082 | macOS, global shortcut dictation, MIT |
| **WhisperLive** | [collabora/WhisperLive](https://github.com/collabora/WhisperLive) | 4,329 | Near-live streaming Whisper server, MIT |
| **whisper-writer** | [savbell/whisper-writer](https://github.com/savbell/whisper-writer) | 1,108 | Small always-listening/PTT dictation app, GPL-3.0 |
| **vocalinux** | [VocaHQ/vocalinux](https://github.com/VocaHQ/vocalinux) | 963 | Offline Linux dictation daemon, AGPL |
| **VoiceFlow** | [infiniV/VoiceFlow](https://github.com/infiniV/VoiceFlow) | 431 | Win+Linux, hold-hotkey dictation, MIT |
| **betterwispr** | [opennookorg/betterwispr](https://github.com/opennookorg/betterwispr) | 420 | macOS local-first, Apache-2.0 |

Closed-source products worth studying as UX benchmarks (not reusable): Apple Siri / Apple Intelligence (orb animation), **superwhisper** (macOS), **Wispr Flow** (dictation → increasingly "voice commands"), Nuance Dragon, Raycast (hotkey summon bar).

## C. Deep-dive: the ones that matter to us

### Leon (closest big ancestor) — [leon-ai/leon](https://github.com/leon-ai/leon) · 17.6k★ · MIT
- Node.js ≥24 + pnpm, web UI served locally; MIT — code is borrowable.
- Leon 2.0 (develop branch, active daily): **"Skills → Actions → Tools → Functions (→ Binaries)"** architecture; three modes — *smart*, *controlled* (deterministic), and *agent* (step-by-step planning); **computer use** (operate desktop + browser, verify outcomes visually, local or via "Satellite"); layered memory (durable prefs / day-to-day / recent conversation).
- Reuse: skill packaging model, permission-ish "controlled mode" concept, memory layering naming. Docs lag behind 2.0 (source: [repo](https://github.com/leon-ai/leon), fetched 2026-10-24).

### ethanplusai/jarvis — voice → coding agent (our exact opencode pattern)
- 908★: voice assistant that talks to your Mac and **drives Claude Code**. Proof the "speak → coding agent builds it" flow ships. Small enough to read entirely in an evening.

### OpenClaw Assistant MVP — Electron + voice + Live2D persona
- 408★: Electron-based AI voice assistant with a **Live2D character** — the closest existing thing to our "3D mascot persona" pillar on desktop. Check its Live2D SDK usage carefully (SDK licensing, see file 05).

### Music Island — top-edge control surface
- 1.2k★: music controls + local dictation + assistant limits **docked at the top edge** of the screen — same placement as our Siri-style orb summon.

### Alice — Electron voice-first assistant
- 326★ MIT, Vue + Vite + Electron: clean small reference for wiring mic → STT → LLM → TTS inside Electron.

### OpenVoiceOS / Willow / Rhasspy / Mycroft — the "wake word stack" lineage
- Mycroft (archived) → **OpenVoiceOS** (active): full offline pipeline: wake word (Precise/OpenWakeWord), VAD, STT (Vosk/whisper plugins), intent parsing, TTS. Python. Great reference for **wake-word + VAD + plugin architecture**, overkill to adopt whole.
- **Willow** (3.1k★, active): local voice assistant on ESP32-Lyra hardware; irrelevant platform-wise but excellent docs on latency budgeting for voice UX.

## D. Closed products (UX reference only)
- **Apple Siri / Apple Intelligence**: the orb/blob summon animation we're emulating; top-of-screen sheet.
- **Wispr Flow / superwhisper**: polished hotkey dictation UX, ambient "listening" states.
- **Google Gemini Live / ChatGPT desktop voice**: full-duplex conversation latency budget (~500-800ms perceived).
- **Raycast**: gold standard for hotkey-summoned overlay bar + extensions ("access list" mental model for our permissions GUI).

## E. Top picks for our build (what to borrow, from where)

1. **Leon** — skills/actions/tools architecture + agent/controlled mode split (map to our permission ACL). Read source, don't fork (it's a web-app assistant, not an overlay).
2. **OpenWhispr** — global hotkey + recording overlay + local STT engine management in a cross-platform desktop app. Nearest neighbor of our summon-orb. MIT.
3. **ethanplusai/jarvis** — voice → terminal coding-agent bridge (they do Claude Code; we do opencode). Steal the interaction flow.
4. **OpenClaw Assistant MVP / Alice** — Electron voice-assistant scaffolds with persona/UI already wired.
5. **Music Island** — top-edge docked UI precedent.
6. **OpenVoiceOS docs** — wake-word/VAD/endpointing pipeline reference if we add always-listening later (out of scope for 1 week).

**Gap check:** nobody in this list combines hotkey-overlay + agentic computer control + 3D persona + Indic languages. The closest single product is Leon (agent + computer use, no overlay orb, no Indic voice focus). Our differentiation is real.

*Sources: all repo links above (GitHub pages/API fetched 2026-10-24); search discovery via GitHub search API (`jarvis assistant`, `voice assistant desktop`, `whispering dictation`).*

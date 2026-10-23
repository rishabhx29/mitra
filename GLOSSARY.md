# Glossary

Product vocabulary for Mitra. Use these terms exactly; avoid the listed synonyms.

| Term | Meaning | Avoid |
|---|---|---|
| **Mitra** | The product: cross-platform desktop voice AI assistant (working name) | "the app", "jarvis" (only when referring to other projects) |
| **Overlay** | The small circular, transparent, always-on-top, frameless window summoned by the global hotkey near the top of the screen | "popup", "widget" |
| **Persona** | The visual identity of the assistant shown in the Overlay and Settings: `orb` or `avatar` | "mascot", "character" (mascot only when talking about VRM models generally) |
| **Orb** | Persona #1: audio-reactive 3D sphere (R3F + ShaderMaterial) | "sphere ui", "blob" |
| **Avatar** | Persona #2: VRM 3D character with lip-sync (three-vrm + wawa-lipsync) | "Live2D" (deferred, licensing) |
| **Session** | One voice conversation: hotkey press → speak → actions → dismiss | "call" (except in Bolna SDK terms: Web Call) |
| **Voice Brain** | The STT→LLM→TTS loop. Primary: Bolna hosted agent via `@bolna/web-call`; `MockVoiceProvider` for offline development | "backend brain" |
| **Local Bridge** | The localhost HTTP server inside the Electron app that (a) mints Bolna sessions and (b) executes Tools on this machine | "server" ambiguously |
| **Tool** | A named, permission-gated capability the agent may execute: `notion_add_todo`, `launch_app`, `run_opencode_task`, … | "skill", "action" (skill = our borrowed term from Leon only in research docs) |
| **ACL** | The per-Tool/ per-app permission grants the user configures in Settings; enforced by the Local Bridge before any Tool runs | "whitelist" |
| **Mock mode** | App fully functional with `MockVoiceProvider` + stub Tools when no API keys are present | "demo mode" |
| **States** | Persona/Session lifecycle: `idle` → `listening` → `thinking` → `speaking` (+ `error`) | colors, emojis |

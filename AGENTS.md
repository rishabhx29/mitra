# Mitra — Bolna Buildathon Project

Cross-platform desktop voice AI assistant (Jarvis-like) for the [Bolna Buildathon](https://www.bolna.ai/symphony/buildathon/) (deadline **Oct 31, 2026**). Hotkey summons a Siri-style orb overlay → user speaks (English/Hindi/Hinglish) → agent converses and executes tasks (Notion, apps, terminal, opencode) → 3D persona with customization + app-permission ACL.

Stack: **Electron + React + Vite + Three.js (R3F)** · voice brain: **Bolna Web Call SDK** · STT/TTS: Sarvam Saaras v4 / Deepgram Flux / Cartesia Sonic 3.6. See `research/` for the full documented landscape (00–05) and `PLAN.md` for the build plan.

## Agent skills

### Issue tracker

Local markdown: issues live as files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

## Working agreements for agents

- `research/` is read-only reference (cited). `_reference/` holds cloned third-party repos — **never edit inside them**; copy code out with attribution comments (`// adapted from samantha-ui (MIT)`).
- Licenses matter: only MIT/Apache/BSD code may be copied into `app/`. No Live2D, no AGPL code (Whispering/Epicenter), no Wensity, no Rhubarb. See `research/05` §5.
- The app must run in **mock mode** with zero API keys (all providers behind an adapter interface) so the demo never depends on network credentials.
- TypeScript strict. Verify with `npm run typecheck` and `npm run build` before declaring done.

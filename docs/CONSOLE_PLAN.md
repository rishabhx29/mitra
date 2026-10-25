# Mitra Console — in-app AGI-style chat interface (plan)

> User ask: "inside the app an interface where I see my avatar live, ask questions or make it do stuff — chatbot-style, local model like Gemma that runs on 8GB RAM, look as cool as possible, true-AGI tech-centered."

## Concept

A dedicated **Console window** (large, dark, tech) — the persona (orb or avatar) lives large on the left, live and reactive; a chat thread on the right with glass bubbles, inline tool-execution cards, and a neural typing effect. Typed commands run through the SAME intent→tool pipeline as voice; non-command chat goes to a **local LLM** so Mitra can actually converse without any API key.

## The brain (3-tier, automatic)

1. **Ollama (local, the ask)** — bridge auto-detects `http://127.0.0.1:11434` (`/api/tags`). Model auto-pick: prefer `qwen2.5:3b` (best multilingual/Hindi at 3B, ~3GB RAM), then `gemma2:2b`, then the smallest installed model. Chat calls go bridge → Ollama `/api/generate` (non-streaming v1, system prompt = Mitra persona + mirror user language + concise). No CORS issues (main-process proxy). Ollama absent → tier 2. (One-line install note surfaces in the Console status bar.)
2. **Mock conversational fallback** — offline deterministic replies (existing mock-brain clarification path) so the Console ALWAYS works on any machine, keys or not.
3. **Bolna agent** — unchanged; live voice stays in the summon overlay (no transcript events in SDK v3.0.1 — documented limitation).

**Tool execution stays intent-driven** (our robust en/hi/Hinglish parser runs first): matched intent → tool runs → inline result card ("⚡ notion_add_todo — Added 'milk' ✓"); no intent → brain chat reply. Honest v1; Ollama function-calling is roadmap.

## UI/UX (tech-centered, "true AGI")

- **Window**: `?window=console` (~1000×680), opened via a prominent **Console** button on Home + tray entry. Glass shell consistent with settings; backdrop = faint grid + radial orb-color glow; scanline shimmer (subtle, reduced-motion-safe).
- **Left — persona stage**: full-height PersonaStage; while a reply "speaks", drive the amplitude envelope (existing synthetic envelope) so orb/avatar visibly reacts; state ring: listening(idle)/thinking(LLM call)/speaking(reply).
- **Right — conversation**: thread bubbles (user right/orb-gradient border, agent left/glass), tool cards (icon + tool name + summary + ok/denied chip), typing indicator (three dots), boot sequence on first open ("MITRA CONSOLE — neural link established · brain: Ollama qwen2.5:3b · tools: 9 armed") in monospace.
- **Input bar**: text field + send; hint chips (sample commands incl. Hinglish); mic button that summons the overlay (voice stays overlay-first v1).
- **Status bar**: brain + model + RAM-lite badge (e.g. "local · 3B · runs on 8GB") + provider mode.
- i18n en+hi everywhere; no new deps.

## Architecture deltas

- `shared/types.ts`: `Settings.console?: { model?: string }` (optional; auto otherwise). No Permission changes — tools still gated by the ACL.
- Bridge: `POST /api/brain/chat {messages, language}` → `{brain:'ollama'|'mock', model?, text}` (injected fetch for tests; 8s timeout → fallback to mock with honest note).
- Renderer: `src/console/{ConsoleApp.tsx,Thread.tsx,ToolCard.tsx,BootSequence.tsx,consoleModel.ts}` + App route `?window=console`.
- Main: console window lifecycle (pattern: fullscreen viewer) + `mitra:toggle-console` IPC + Home button + tray entry.
- Tests: brain endpoint (detection/auto-pick/fallback/timeout, injected fetch), consoleModel reducer (intent→tool card, chat fallback, boot lines), e2e: console opens, typed "add chai to my list" → tool card + notion item; typed general question → reply bubble (mock brain).

## Build: 2 parallel Flash agents → gates → e2e → thematic commits. Ollama note for user: install from ollama.com + `ollama pull qwen2.5:3b` (auto-detected; optional).

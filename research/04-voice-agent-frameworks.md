# Research 04 — Voice-agent orchestration frameworks & realtime stack (incl. Bolna itself)

> The "brain loop": streaming STT → LLM → TTS with fast turn-taking, reachable from our Electron/Tauri desktop client. Verified 2026-10-24.

## A. Verified landscape

| Project | Repo/Site | ★ | License | Status | One-liner |
|---|---|---|---|---|---|
| **Bolna (OSS)** | [bolna-ai/bolna](https://github.com/bolna-ai/bolna) | 800 | MIT | Active (pushed 2026-10-23) | End-to-end open-source voice-agent platform (ASR+LLM+TTS over websockets) |
| **Bolna (hosted)** | [bolna.ai](https://www.bolna.ai) / [docs](https://www.bolna.ai/docs) | — | commercial | Active, **hackathon host** | "The AI Voice API for India" — 40+ languages, telephony + **Web Call SDK** |
| **Pipecat** | [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) | 16,755 | BSD-2-Clause | Active | Voice/multimodal agent framework (Daily), WS/WebRTC/LiveKit transports |
| **LiveKit Agents** | [livekit/agents](https://github.com/livekit/agents) | 14,910 | Apache-2.0 | Active | Realtime voice AI agent framework (+ [client-sdk-js](https://github.com/livekit/client-sdk-js) for browsers/Electron) |
| **TEN Framework** | [TEN-framework/ten-framework](https://github.com/TEN-framework/ten-framework) | 11,195 | custom | Active | Open conversational-voice-agent framework (extensions graph) |
| **OpenAI Realtime Console** | [openai/openai-realtime-console](https://github.com/openai/openai-realtime-console) | 3,617 | MIT | Reference | React app for the OpenAI Realtime API — best crib for a browser audio loop |
| **Silero VAD** | [snakers4/silero-vad](https://github.com/snakers4/silero-vad) | 10,505 | MIT | Active | Standard voice-activity detector |
| **openWakeWord** | [dscripka/openWakeWord](https://github.com/dscripka/openWakeWord) | 2,873 | Apache-2.0 | Maintained | Open wake-word detection (if we add always-listening) |

## B. Bolna deep-dive (the strategic choice — they're hosting the hackathon)

### B1. Hosted platform ("AI Voice API for India")
Source: [docs](https://www.bolna.ai/docs), [llms.txt index](https://www.bolna.ai/docs/llms.txt), fetched 2026-10-24.
- Multilingual conversational agents, **40+ languages**, telephony in/out (Twilio, **Plivo**, **Exotel** — both hackathon sponsors), no-code Agent Studio, REST API, **CLI + MCP** for managing agents.
- Provider matrix built in: ASR — **Sarvam (Saaras)**, **Deepgram** (+Flux), AssemblyAI, OpenAI, Azure, ElevenLabs, Gladia, Soniox, Gemini; TTS — **Cartesia**, **Sarvam (Bulbul voices)**, ElevenLabs, Deepgram, AWS Polly, Azure, Rime, Maya, **Kalpa Labs**; LLMs — OpenAI, DeepSeek, Llama, Cohere, Mistral… → i.e., **all our sponsor credits plug straight into Bolna.**
- Pricing: flat per-minute rates + Pilot plan (see [what-it-costs](https://www.bolna.ai/docs/get-started/what-it-costs.md)).

### B2. **Web Call SDK** — the piece that makes a desktop app possible
Source: [SDK overview](https://www.bolna.ai/docs/developer-resources/sdks/overview.md) + [web-call page](https://www.bolna.ai/docs/developer-resources/sdks/web-call.md). Package: **`@bolna/web-call` v3.0.1** ([github.com/bolna-ai/web-call](https://github.com/bolna-ai/web-call)) — added July 2026.
```javascript
import { BolnaWebCall } from "@bolna/web-call";
const call = new BolnaWebCall({ sessionUrl: "/api/bolna-session" }); // our tiny local backend mints the session
call.on("call-start", () => {});
call.on("call-end", ({ reason }) => {});
call.on("error", (e) => console.error(e.code, e.message));
button.onclick = () => call.start();   // must be a user gesture → our HOTKEY counts
```
- Session minting (server-side, key never in renderer): `POST https://api.bolna.ai/web-call/session` with `Bearer BOLNA_API_KEY`, body `{ agent_id, user_data }`; single-use, ~120s TTL.
- Runs in the browser → runs in **Electron's renderer** unchanged. WebRTC (TURN/`iceTransportPolicy` mentioned), echo-cancelled audio.
- **Runtime language switch**: `agent_data: { language: "hi" }` in the mint body → per-call Hindi/English switching. Killer demo line: "बोलो हिंदी में".
- `userData` (≤50KB) is substituted into the agent prompt (`{{customer.name}}` style) — we can inject context (e.g., allowed apps list) per call.

**Open integration question** (design on day 1): the Bolna agent's LLM runs hosted — local actions (Notion, opencode, launching apps) need a bridge. Options:
1. **Webhook tools**: Bolna workflows can call URLs → our desktop runs a localhost bridge exposed via tunnel (ngrok/cloudflared) for the demo. Agent LLM gets tools "add_todo", "run_opencode" → hits our bridge → we execute locally → return result → agent speaks confirmation. (Verify exact tool/webhook shape in Bolna workflow docs.)
2. **Transcript-driven local agent**: use Web Call SDK purely as the ears+mouth; consume transcript events locally, run our own LLM tool-loop for actions. More control, doubles latency for actions.
3. **Bolna OSS sidecar**: run [bolna-ai/bolna](https://github.com/bolna-ai/bolna) locally (Python `Assistant`: transcriber→llm→synthesizer pipeline, websocket) and wire tools directly — no tunnel, everything on-device; more moving parts.

### B3. Bolna OSS repo reality check
- MIT, 800★, code pushed 2026-10-23, but README says **"actively looking for maintainers"** — the hosted platform is where their energy is. Use hosted APIs for the hackathon; OSS as fallback/reference.

## C. The alternatives (and when they'd win)

- **Pipecat** (16.8k★, BSD-2): the strongest "self-hosted Bolna equivalent." Python; transports include WebSocket + WebRTC + LiveKit; modular services; function/tool calling first-class. If we needed local-only or custom turn-taking, we'd run Pipecat as a local sidecar service and stream mic audio from Electron. Cost: 2 processes, we own the glue.
- **LiveKit Agents + client-sdk-js**: best if we want self-hosted SFU infra (multi-participant, robust NAT traversal). Overkill for one desktop user.
- **TEN Framework**: extension-graph voice agent runtime; promising but heavier mental model for a 1-week build.
- **OpenAI Realtime API** (via [Realtime Console](https://github.com/openai/openai-realtime-console) patterns): simplest full-duplex brain, great English; weaker Hindi story + no sponsor credits. Good fallback demo.
- **DIY pipeline** (no framework): Deepgram WS STT + any LLM w/ tools + Sarvam/Cartesia TTS, all from Node. Maximum control, more edge cases (barge-in, endpointing). The Web Call SDK gives us this polish for free.

## D. Recommended architecture for the 1-week build

**Primary: Electron + `@bolna/web-call` → Bolna-hosted agent (Sarvam Saaras ASR for hi/Hinglish, Cartesia or Sarvam Bulbul TTS) + local action bridge.**

1. Main window (React) = settings: pick persona (orb/mascot), permissions ACL (Notion on/off, Terminal on/off…), hotkey config, language default.
2. Hotkey (Electron `globalShortcut`, e.g. Alt+Space) → summon overlay (transparent always-on-top BrowserWindow, top-center orb) → `call.start()` (user gesture ✓) → speak.
3. Local bridge (Electron main process / tiny localhost server + cloudflared tunnel for demo): exposes `add_notion_todo`, `launch_opencode_task`, `open_app`… receives Bolna workflow webhook calls, executes per ACL, returns results the agent speaks aloud.
4. Stretch: barge-in/emoji states from SDK events; language switch command ("speak Hindi") → re-mint session with `agent_data.language`.

**Fallback if Web Call SDK integration stalls:** Pipecat local sidecar (day 3 decision point), or pure Deepgram+Sarvam DIY loop.
**Not now:** LiveKit/TEN/self-hosted Bolna OSS, wake-word always-listening (openWakeWord + Silero noted for the roadmap slide).

*Sources: links above; repo stats via GitHub API 2026-10-24; SDK facts from bolna.ai docs pages (fetched 2026-10-24).*

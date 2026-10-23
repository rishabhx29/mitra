# Research 03 — Speech services for English + Indian languages (STT/TTS landscape)

> For our conversational desktop assistant: streaming quality, Indic coverage (esp. Hindi + Hinglish/code-mixed), latency, and hackathon-credit fit. Primary sources fetched 2026-10-24.

## A. The headline table

| Provider | Type | Hindi | Other Indic | Hinglish / code-mix | Streaming | Self-serve | Sponsor credit |
|---|---|---|---|---|---|---|---|
| **Sarvam Saaras v4** | STT | ✅ | ✅ 22 Indic + Eng (23 total) | ✅ dedicated `codemix` + `translate` modes | ✅ WebSocket + REST + batch | ✅ ₹0.49/min | ✅ **Sarvam** |
| **Sarvam Bulbul v4 Flash** | TTS | ✅ | ✅ 10 Indic + Eng | ✅ | ✅ WS + HTTP streaming | ✅ 222 persona voices | ✅ |
| **Deepgram Flux Multilingual** | STT | ✅ `hi` | ⚠️ 10-language multi model (Nova-3: 55-lang prompting, incl codeswitching) | ✅ turn/interruption-aware, code-switching docs | ✅ WS (voice-agent-grade) | ✅ | ✅ **Deepgram** |
| **Cartesia Sonic 3.6** | TTS | ✅ `hi-IN` locale + `standard-hindi` accent | ⚠️ multilingual voices with per-locale accents | ✅ Hinglish mixing explicitly supported | ✅ low-latency | ✅ | ✅ **Cartesia** |
| **ElevenLabs Eleven v3** | STT+TTS | ✅ | ✅ ~12+ Indic (Ta, Te, Mr, Bn, Gu, Kn, Ml, Pa, Ur, As, Ne, Sd) | — | partial | ✅ | ❌ |
| **Bhashini (Govt)** | STT+TTS+MT | ✅ | ✅ 22+ | ⚠️ | ⚠️ pipeline style | ✅ org registration → API key | ❌ (free/cheap) |
| **AI4Bharat open models** | STT/TTS/MT (weights) | ✅ | ✅ broad | ⚠️ | self-host | free (HF) | ❌ |
| Azure / Google / OpenAI / Amazon | STT+TTS | ✅ | varies (Azure strong: hi-IN + major Indic) | varies | ✅ | ✅ | ❌ (not sponsors) |

## B. Sarvam AI — the Indic backbone (and a hackathon sponsor)

Source: [docs.sarvam.ai](https://docs.sarvam.ai) (llms.txt + model pages, fetched 2026-10-24).

- **Platform scope**: "Speech, text, and document models trained for 22 Indian languages and English" — REST, **WebSocket**, batch endpoints; **official Python + TypeScript SDKs** (`sarvamai`); MCP docs server; no-code dashboards; **Samvaad voice agents from ₹3/min**.
- **Saaras v4 (STT, default model)**: 23 languages (22 Indic + English; v4 adds Global English), auto language detection. Five output modes via `mode`: `transcribe`, **`translate`** (any Indic → English text!), `verbatim`, `translit` (Roman), **`codemix`** ("मेरा phone number है…" — exactly how our users will speak). **Keyterm prompting**: bias recognition with up to 50 domain terms (`opencode`, `Notion`, `Spotify`!) — REST/batch (v4). REST ≤30s/request; WebSocket streaming for realtime.
- **Bulbul v4 Flash (TTS)**: **222 persona voices** (`bulbul:v4-flash`; v3 EOL on voice agents 2026-11-10 — use v4), languages: Hindi, English, `enhi`, Bengali, Gujarati, Kannada, Marathi, Punjabi, Tamil, Telugu; HTTP streaming + WebSocket; up to 2500 chars/request; **instant voice cloning (beta)** in the SDKs.
- **Pricing** (pay-as-you-go, excl. GST): STT **₹0.49/min** (billed per second); LLMs — Sarvam-105B ₹15/₹60 per 1M in/out tokens (also hosts GLM-5.3, DeepSeek, Kimi…); no monthly minimum.
- **Why it matters for us**: `translate` mode = speak Hindi, feed English text to any LLM/tool; `codemix` = natural Hinglish transcript; keyterms fix the app-name recognition problem. Native inside **Bolna** (Sarvam transcriber + Bulbul voices are first-class Bolna providers).

## C. Deepgram — English-first excellence + real Hindi (sponsor)

Source: [developers.deepgram.com](https://developers.deepgram.com) (llms.txt + Flux language page, 2026-10-24).

- **Flux** = new conversational ASR "purpose-built for interactive voice agents" (Nova-3 successor): turn-aware, **interruption-aware**; live `Configure` messages update keyterms mid-stream without reconnecting.
- **Flux Multilingual (`flux-general-multi`)**: 10 languages incl. **Hindi (`hi`)**; `language_hint` param biases accuracy; auto-detect without hints.
- **Nova-3 multilingual**: language prompting across **55 languages**; dedicated [multilingual code-switching](https://developers.deepgram.com/docs/multilingual-code-switching.md) docs.
- TTS: **Aura** / new **Flux TTS** (voice catalog over WS + REST).
- Also ships official **Pipecat + LiveKit** voice-agent guides — pairs perfectly with fallback architectures in file 04.

## D. Cartesia — low-latency multilingual TTS (sponsor)

Source: [docs.cartesia.ai](https://docs.cartesia.ai/build-with-cartesia/capability-guides/multilingual-voices.md), 2026-10-24.

- **Sonic 3.6**: every voice speaks every supported model language; per-request `language`/`locale` (`hi-IN`) and even `accent: standard-hindi` control; **"Mixing languages inside a single generation works where it's common, such as Hindi (Hinglish)"** — explicitly supported. Mid-conversation language switching = one request each (our "अब हिंदी में बोलो" command maps directly).
- Multilingual voices (e.g., Jacqueline: native US-English + Hindi) keep ONE persona consistent across languages — nice for our mascot's identity.
- Cartesia also has **Ink 2 STT** (seen in their Bandwidth integration) and an **MCP server** for TTS. Deepgram+Cartesia = the classic "English brain" pair; both also available *inside* Bolna.

## E. Others

- **ElevenLabs**: Eleven v3 = **74 languages** incl. ~12 Indic (Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Assamese, Nepali, Sindhi); voice cloning in 12 Indian languages (demoed at IIT Delhi, Oct 2025). ([help center](https://help.elevenlabs.io/hc/en-us/articles/13313366263441-What-languages-do-you-support), [blog](https://elevenlabs.io/blog/voice-cloning-in-12-indian-languages-demonstrated-live-at-iit-delhi)). No sponsor credits → second tier for us.
- **Bhashini** (Govt of India, [bhashini.gov.in](https://bhashini.gov.in)): ASR/NMT/TTS across 22+ languages. Access = register organization on the portal → generate API key in "My Profile"; community Python SDK [`bhashini-client-sdk`](https://pypi.org/project/bhashini-client-sdk/0.2.4); docs: [Bhashini APIs gitbook](https://dibd-bhashini.gitbook.io/bhashini-apis), [ULCA](https://github.com/bhashini-dibd/ulca). Great "public digital infrastructure" pitch line, but pipeline-style APIs + org registration make it a stretch goal, not the demo backbone.
- **AI4Bharat open models** (HuggingFace, verified 2026-10-24): [`indic-conformer-600m-multilingual`](https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual) (STT, 320k downloads/mo), [`IndicF5`](https://huggingface.co/ai4bharat/IndicF5) + [`indic-parler-tts`](https://huggingface.co/ai4bharat/indic-parler-tts) (TTS), [`indictrans2`](https://huggingface.co/ai4bharat/indictrans2-en-indic-1B) (MT), Airavata (Hindi LLM). Free weights for an offline roadmap story; too slow/complex to wire in 1 week for a realtime agent.
- **Local fallbacks**: faster-whisper / whisper.cpp (decent Hindi, weak Hinglish), Meta MMS (broad Indic), sherpa-onnx/Vosk (hi). Fine for the "privacy mode" roadmap slide, not the demo.
- **Azure / Google / OpenAI Realtime**: strong but zero sponsor credits; skip for build, cite as alternatives.
- **Kalpa Labs** (sponsor): appears as a **TTS provider inside Bolna** ([bolna docs list](https://www.bolna.ai/docs/kalpa.md)); low public profile — easiest to consume via Bolna's provider dropdown.

## F. Recommended stack (for the 1-week demo)

**Primary — all sponsor credits, all first-class inside Bolna (see file 04):**
- **STT**: Sarvam **Saaras v4** for Hindi/Hinglish sessions (`codemix` or `translate` mode + keyterms for app names); **Deepgram Flux** for English-first sessions. Let the user's spoken language auto-decide (Saaras auto-detects; or route on session language).
- **TTS**: **Cartesia Sonic 3.6** multilingual voice (one persona, native EN + HI, Hinglish OK) — or Sarvam **Bulbul v4 Flash** when we want 222 Indic voices / stronger non-Hindi Indic.
- **LLM**: whatever Bolna agent config offers (OpenAI/Sarvam-105B/etc.) — conversational glue is hosted there anyway.

**Why**: single Bolna agent already stitches these three; per-call language switch (`agent_data.language`) + Sonic per-request locale = live "switch to Hindi" moment in the demo; Hinglish is supported at BOTH layers (Saaras codemix in, Sonic Hinglish out) — no one else's demo will do that.

**Alternatives**: ElevenLabs v3 (best single-voice quality across 12 Indic, no credits); Bhashini/AI4Bharat (public-infra & offline roadmap story).

*Sources: all links above; Sarvam model/pricing pages via docs.sarvam.ai `.md` endpoints; Deepgram/Cartesia docs via llms.txt pages; ElevenLabs help center; Bhashini portal; HuggingFace API — all fetched 2026-10-24.*

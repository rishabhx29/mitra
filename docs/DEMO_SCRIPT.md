# Mitra — Demo Script (draft, finalize Oct 30)

> 3-minute demo flow for the Bolna Buildathon submission video / finale pitch.
> The story: **voice in, actions out, Hindi/Hinglish native — with the user in control of permissions.**

## Setup (before recording)

- [ ] `npm run dev` (or packaged exe) — settings window opens
- [ ] Persona = orb, colors customized live (show the picker)
- [ ] Permissions: Notion ✅, Launcher ✅, Terminal ❌ (will be flipped mid-demo for the payoff)
- [ ] Language = English start; Hindi switch mid-demo
- [ ] Mock Notion board empty (real Notion if keys present)

## The flow

1. **Summon (0:00)** — Press `Alt+Space` anywhere. Orb drops in from the top bar, pulses into *listening*.
2. **Simple action (0:20)** — "Add buy milk to my to-do list." → orb *thinking* → *speaking* "Done" → settings window shows the item on the Notion board.
3. **Permission payoff (0:50)** — "Open opencode and build me a portfolio site." → **refused**: "Terminal access is off." → flip the Terminal toggle in settings (show the ACL UI) → repeat → agent spawns `opencode run` → orb shows *working* status → summary spoken.
4. **Language switch (1:40)** — "अब हिंदी में बात करो" → agent continues in Hindi (Bolna agent language switch / Saaras). Follow up: "मेरी लिस्ट में दूध जोड़ो" → same tool flow, Hindi response.
5. **Hinglish flex (2:10)** — "open opencode aur ek landing page banao" → codemix transcript handling.
6. **Persona (2:30)** — Switch persona orb → avatar (VRM drop-in with license display) — customization moment.
7. **Close (2:50)** — "That's Mitra: a voice-first desktop agent that only touches what you allow, speaks your language, and gets real work done."

## Pitch notes

- Why us: research shows nobody combines hotkey-overlay + agentic app control + permission ACL + 3D persona + Indic voice (research/00 §4.1).
- Stack cred: Bolna Web Call SDK (host's own), Sarvam Saaras codemix STT, Cartesia Sonic hi-IN TTS — all sponsor credits.
- Roadmap slide: wake word (openWakeWord/Silero), Bhashini offline mode, full computer-use (UFO/Agent-S patterns).
- Fallback: everything demo-able in mock mode offline (research the mock provider before blaming network).

## Submission checklist (Oct 31)

- [ ] Repo pushed (public) + README with setup
- [ ] 2-3 min demo video link
- [ ] Buildathon application form fields (project name, voice-AI fit)

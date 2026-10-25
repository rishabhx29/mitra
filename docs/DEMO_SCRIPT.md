# Mitra — Demo Script

> 3-minute demo flow for the Bolna Buildathon submission video / finale pitch.
> The story: **voice in, actions out, Hindi/Hinglish native — with the user in control
> of permissions.** Every flow below runs in mock mode with zero API keys; all
> utterances are pinned by unit tests (`src/voice/mockProvider.test.ts`) and the
> Playwright smoke (`app/e2e/smoke.spec.ts`).

## New since v0.1 (weave into the flow)

- **Console** (the AGI centerpiece): open from Home → boot sequence → type "add chai to my todo list" → tool card appears; ask a general question → local-brain reply (Ollama if installed, honest mock otherwise). Persona lives large and animates while replying.
- **Workspace modes**: "aaj coding ka man hai" / "gaming mode on karo" → preset launches (editable in Settings → Modes).
- **Memory**: "remember that I prefer dark mode" → "what do you remember?" — Settings → Memory viewer.
- **Reminders + status + lockdown**: "remind me in 2 minutes to stretch" / "status batao" / "lock my computer".

## Setup (before recording)

- [ ] Run the packaged exe (`app/dist/Mitra-0.1.0-portable-x64.exe`) or `npm run dev`.
      Boots to tray — no window. Close any other Mitra instance first (the bridge owns
      `127.0.0.1:8765`).
- [ ] Settings (tray → Show settings): Persona = orb, colors tweaked live on camera
      (Persona → Color A/B). Language = English.
- [ ] Permissions: Notion ✅, Open apps ✅, Open links ✅, **Terminal & opencode ❌**
      (the default — flipped ON mid-demo for the payoff).
- [ ] Clean mock Notion board: delete `%APPDATA%\Mitra\mock-notion.json` if you want
      the board to start empty.
- [ ] If `opencode` is on PATH the opencode beat does a real run; otherwise the tool
      honestly says `simulated (opencode not installed)` — both are fine on camera.
- [ ] No mic on the recording rig? Launch with `MITRA_E2E=1` in the environment and a
      dev text input appears in the overlay — typed commands take the exact same
      intent path as speech. (Dev affordance; hidden in normal runs.)

## The flow

1. **Summon (0:00)** — Press **Ctrl+Shift+Space** anywhere (default hotkey; not
   Alt+Space, which opens the Windows system menu). The orb drops in top-center,
   *without stealing focus from whatever you were doing*, and pulses into **Listening**
   with the greeting: *"Hi, I am Mitra. Try 'add milk to my list', 'open notepad', or
   'open opencode and build a snake game'."*

2. **Simple action (0:20)** — *"Add milk to my todo list."* → orb **Thinking** →
   **Speaking** → caption shows `Added to Notion (mock board): "milk"`. Cut to
   Settings → Notion board: the item is there (keep this window visible as a
   second screen — the Conversation log panel streams the same events).

3. **Permission payoff (0:50)** — *"Open opencode and build me a portfolio site."* →
   **refused**, spoken: *"Sorry, I can't do that — terminal access is turned off. You
   can enable it in Mitra Settings."* Nothing executed. Now flip **Terminal & opencode**
   in Settings → App permissions (show the ACL UI), repeat the line → the tool runs:
   progress lines stream into the captions (~8s simulated run if opencode isn't
   installed, a real `opencode run` if it is) → result spoken.

4. **Language switch (1:40)** — *"अब हिंदी में बात करो"* (or *"speak hindi"*) →
   confirmation in Hindi: *"ठीक है, अब मैं हिंदी में बात करूँगा।"* Then
   *"मेरी लिस्ट में दूध जोड़ो"* → दूध lands on the board. (Mock-mode honesty: tool
   result summaries are the bridge's English text, e.g. `Added to Notion (mock board):
   "दूध"`; with real Bolna keys the hosted agent converses fully in Hindi.)

5. **Hinglish flex (2:10)** — *"Open opencode aur banao ek landing page"* → codemix
   parsed, routed to the opencode tool. (Phrase it exactly like this — the intent
   regexes want the verb right after "aur"; a free-form variant routes to the app
   launcher, which then answers with its available aliases.)

6. **Persona (2:30)** — Settings → Persona: tweak orb colors live (zero assets
   needed). Optional beat if you have a `.vrm` handy: switch to Avatar and drop the
   model in — lip-sync + embedded-license display. No model ships with the app.

7. **Close (2:50)** — *"Stop."* → *"Okay, closing. Press the hotkey anytime you need
   me."* → orb goes idle and the overlay tucks itself away. Land the line: "That's
   Mitra: a voice-first desktop agent that only touches what you allow, speaks your
   language, and gets real work done."

## Pitch notes

- Why us: nobody combines hotkey-overlay + agentic app control + permission ACL +
  3D persona + Indic voice (research/00 §4.1).
- Stack cred: Bolna Web Call SDK (host's own), Sarvam Saaras codemix STT, Cartesia
  Sonic hi-IN TTS — all sponsor credits.
- The ACL story is the differentiator: the bridge enforces permissions at the HTTP
  edge (`403 → spoken refusal`), so the demo's "no" moment is real enforcement, not
  theater.
- Roadmap slide: wake word (openWakeWord/Silero), Bhashini offline mode, full
  computer-use (UFO/Agent-S patterns).
- Fallback: everything demo-able offline in mock mode — if the network dies mid-demo,
  the app doesn't (that's itself a talking point).

## Submission checklist (Oct 31)

- [ ] Repo pushed (public) + `app/README.md` with setup + `docs/DEMO_SCRIPT.md` (this file)
- [ ] 2–3 min demo video link
- [ ] Buildathon application form fields (project name, voice-AI fit)
- [ ] `npm run typecheck && npm run build && npx vitest run && npx playwright test`
      all green on a clean clone; `npm run dist` produces the portable exe

# Ultron → Mitra port ledger (clean-room)

> Source examined: `_reference/Ultron` (github.com/AbuZar-Ansarii/Ultron, Python/PyQt6/Gemini).
> **Licensing:** README badges MIT but the repo contains NO LICENSE file → default copyright.
> Therefore this is a behavioral port only: no code, strings, or alias lists copied;
> mechanisms were re-derived from reading and reimplemented in TypeScript.

| # | Ultron feature (evidence) | Their mechanism | Mitra port | Status |
|---|---|---|---|---|
| 1 | Workspace Modes (`actions/workspace_matrix.py`, `memory/workspace_presets.json`) | JSON preset per mode: aliases (en+Hinglish), apps[], urls[], volume/brightness/music/DND/IoT; alias-substring match on utterance | `Settings.workspaceModes` presets (name, aliases incl. Hinglish, apps[], urls[]); bridge tool `workspace_mode` launches the bundle (each app via existing launcher aliases, URLs via opener) gated by **launcher**; mock-brain intent matches aliases from settings; Settings editor panel. Volume/brightness/music/DND/IoT **skipped** (platform-specific; roadmap) | porting |
| 2 | Reminder (`actions/reminder.py`) | Detached Python script sleeps, then plyer/desktop notification | Electron main `Notification` + timer; tool `set_reminder {minutes, text}`; brain intents "remind me in N minutes (to) X" / "N minute ka timer" | porting |
| 3 | Quick timer (`actions/quick_timer.py`) | seconds/minutes → threaded countdown → notify | Same tool (`timer` phrasing, message optional) | merged into #2 |
| 4 | Lockdown (`actions/sentry_protocol.py:92-98`) | `ctypes.windll.user32.LockWorkStation()` | `rundll32.exe user32.dll,LockWorkStation` (win); NO-OP with honest summary on macOS/Linux; gated by **launcher**; brain intents "lock my computer/screen" | porting |
| 5 | Cerebro memory (`actions/cerebro_memory.py`, `memory/cerebro_graph.py`) | SQLite graph + TF-IDF vectors + cosine RAG, multi-hop | **Cerebro-lite**: flat JSON store (userData/mitra-memory.json) with normalized-text scoring for recall; tools `memory {action: remember\|recall\|list, text}`; brain intents "remember that X" / "what do you remember (about X)"; Settings viewer panel. Vector graph **skipped** (roadmap) | porting |
| 6 | Status briefing (`actions/chronos_predictive.py`) | Context watchdog: active window, thermals, fatigue | `status_briefing` tool: battery % + charging (Electron powerMonitor), uptime, platform, provider mode, counts (memory entries, notion items). Watchdog/fatigue **skipped** | porting |
| 7 | Gesture control, drone swarm, self-evolution, IoT/Home Assistant, voice DSP warp, HUD modes, network audit, ghost pilot | — | **Not ported** — scope/platform/demo-risk for a 6-day runway; cite in roadmap slide | skipped |

Permission mapping (new tools): `workspace_mode`/`set_reminder`/`lock_workstation` → **launcher** gate; `memory` → **notion** gate (notes semantics). Defaults unchanged.

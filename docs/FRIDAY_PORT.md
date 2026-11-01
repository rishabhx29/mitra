# Friday → Mitra behavioral port (REA)

Reference: `_reference/friday` (SAGAR-TAMANG/friday-tony-stark-demo, 1.6k★, cloned read-only).
Clean-room: behavior observed, implementation is our own TS. No Friday code copied.

## What Friday does (observed)

| Observed behavior | Evidence (reference files) |
|---|---|
| Voice agent keeps multi-turn context; the LLM sees prior turns | `agent_friday.py` (LiveKit AgentSession history) |
| `get_world_news`: parallel RSS from BBC/CNBC/NYT/AlJazeera, top 5 items each, HTML stripped from descriptions, merged brief | `friday/tools/web.py` SEED_FEEDS, fetch_and_parse_feed |
| `get_world_finance_news`: same pattern over CNBC/Bloomberg/Reuters/MarketWatch | `friday/tools/web.py` FINANCE_SEED_FEEDS |
| After a news brief the agent UNPROMPTED opens a visual dashboard (worldmonitor.app / finance.worldmonitor.app) | `agent_friday.py` SYSTEM_PROMPT choreography rules |
| Persona prompt: 2-4 spoken sentences, no lists/markdown/URLs/tool names, natural speech, calm aide tone | `agent_friday.py` SYSTEM_PROMPT |

## Mitra port (own implementation)

1. **Voice session memory** — `LocalVoiceProvider` keeps a per-session transcript and
   sends the last turns to `/api/brain/chat`, so follow-ups ("and in finance?") work.
2. **`get_world_news` / `get_finance_news` tools** — same free-feed strategy (feeds are
   public RSS endpoints), parallel fetch, tag-strip, merged brief. Gate: `browser`.
3. **Monitor choreography** — deterministic "open world monitor" intent → worldmonitor.app;
   the brain's semantic rules teach the news→monitor follow-through.
4. **Spoken-style persona rules** — our own phrasing: short spoken answers, no raw URLs,
   no tool names in speech.

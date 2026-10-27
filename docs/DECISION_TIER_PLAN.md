# Mitra — Fast decision tier (Laya) + real-world tools + wave orb (plan)

## 1. Decision tier: Laya (open System-1 model) between voice and LLMs

Why: qwen/gemma take ~1-3s to decide what to do; Laya (convaiinnovations/laya, Apache-2.0,
421M/322M ModernBERT) classifies in **milliseconds** on-device — perfect for
laptop-centric routing ("which tool, if any?"), leaving phrasing/args to regex and
conversation to the big LLMs.

**Runtime — VERIFIED LIVE on this machine**: `pip install "laya[serve]"` (Python 3.11),
sidecar `laya-serve --model multilingual` (322M mmBERT — the 421M English checkpoint
OOMs alongside Ollama on 8GB) → default port **8000** (the --port flag is ignored;
LAYA_URL default = http://127.0.0.1:8000).

**EXACT working request shape** (verified: "add milk to my todo list" →
choice=notion_add_todo conf=1.0; "open youtube aur lofi beats search karo" →
youtube_search conf=0.9999, model=multilingual):

POST /v1/systemone
{"state":{"text":"<utterance>"},
 "questions":{"route":{"type":"choice",
   "instructions":"Which capability does this utterance need? Pick exactly one.",
   "criteria":{"notion_add_todo":"add an item to their to-do list",
     "youtube_search":"open youtube and search or play something",
     "note_notepad":"write a note in notepad",
     "agenda_today":"asks what is due or scheduled today",
     "launch_app":"open an application",
     "run_opencode_task":"opencode coding agent should build something",
     "open_url":"open a website","set_reminder":"reminder or timer",
     "lock_workstation":"lock the screen",
     "workspace_mode":"workspace preset like coding or gaming",
     "none":"general conversation, no tool"}}}}
→ 200 {"answers":{"route":{"choice":"<tool>","confidence":<0..1>}}}

Laya is an OPTIONAL tier: absent → deterministic intents → LLM chat (unchanged).

**Tier order (per utterance)**: deterministic parseIntent (instant) → **Laya route**
(~50ms) → LLM chat (qwen/gemma via /api/brain/chat) → mock fallback.

**Route contract** (`POST /api/brain/route {text}` → `{tool?: ToolName, args?: Record<string,unknown>, confidence: number, via: 'laya'|'none'}`):
- Laya state = the utterance; typed `choice` question over tool gates
  (notion_add_todo / note_notepad / youtube_search / agenda_today / launch_app /
  run_opencode_task / open_url / reminder / lock_workstation / workspace_mode / none).
- Top choice ≠ none and noul-confidence > 0.6 → tool selected; **args extracted by
  deterministic regexes** per tool (text after "add/to-do", quoted span, search terms
  after "search/for", reminder durations reuse existing parser). No args extractable →
  fall through to chat (Laya routes, regexes parameterize).
- Bridge never blocks > 1.5s on Laya (AbortSignal); laya-serve absent → via:'none'.

**Setup for users/me**: `scripts/start-laya.ps1` (checks python, pip install laya,
starts `laya-serve --port 8899` detached) + README + Voice panel badge
("Fast decisions: Laya ✓ / off").

## 2. Real-world task tools (all ACL-gated, i18n'd intents en/hi/Hinglish)

| Tool | Utterances | Behavior |
|---|---|---|
| `note_notepad` {text} | "add/note X in notepad", "notepad me X add karo", "note this: X" | Appends a timestamped line to `<userData>/mitra-notes.txt` and opens it in Notepad (win: `notepad <file>`; mac/linux: honest fallback write-only + summary). Gate: **launcher** |
| `youtube_search` {query} | "open youtube and search X", "search X on youtube", "youtube par X chalao", "play X on youtube" | Opens `https://www.youtube.com/results?search_query=<enc>` via the existing opener. Gate: **browser** |
| `agenda_today` {} | "what's due today", "anything on my calendar today", "what do I have to do today", "aaj kya karna hai", "mera aaj ka schedule" | Reads the to-do board (real Notion or mock) and speaks the list ("You have N items today: …"); ALSO opens the Windows Calendar app (`start outlookcal:`) — best-effort, non-fatal. Gate: **notion** (reads the board) |

Arg extraction regexes live next to the tools (pure, unit-tested); Laya only names the tool.

## 3. Orb redesign — "wave ribbons in a glass sphere" (reference image)

Keep the `Orb` props contract (state/colors/amplitudeRef) and audio reactivity:
- **Glass shell**: transparent sphere, strong fresnel rim (image's blue ring), additive.
- **Gradient core**: small noise-displaced blob, vertical gradient a→b (image's pink/cyan core), breathing with amplitude.
- **3 wavy ribbons**: closed wavy tube curves (TubeGeometry on a parametric closed path with sine offsets), additive blending, per-ribbon hue (a, b, white-ish), rotating at different speeds/axes — the image's tri-color swirl.
- States: listening = calm rotation; thinking = faster + brighter; speaking = amplitude pumps core scale + ribbon displacement; error = red tint.
- 60fps budget: tubes are cheap (~2-5k tris total); keep bloom.

## 4. Avatar visibility sweep

Ensure the chosen persona is visible EVERYWHERE: overlay (auto-loads persisted/sample model — done), Console stage (done), settings thumbnail (done). Sweep: verify Console + overlay both show the avatar when `persona:'avatar'` and a path exists; fix any gap found.

## Execution: 2 parallel agents (tools+router / orb+avatar sweep) → gates → e2e → thematic commits → exe rebuild.

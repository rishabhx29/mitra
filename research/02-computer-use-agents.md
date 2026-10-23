# Research 02 — Computer-use agents, MCP ecosystem & app integration (our execution layer)

> How our voice assistant actually *does things*. Stars/activity verified via GitHub API on **2026-10-24**.

## A. Verified landscape table

| Project | Repo | ★ | License | Last push | What it is |
|---|---|---|---|---|---|
| **Open Interpreter** | [openinterpreter/openinterpreter](https://github.com/openinterpreter/openinterpreter) | 68,650 | Apache-2.0 | 2026-10-11 | LLM that runs code locally (now aimed at open models) |
| **browser-use** | [browser-use/browser-use](https://github.com/browser-use/browser-use) | 118,971 | MIT | 2026-10-23 | De-facto standard AI browser agent + cloud |
| **UFO³** | [microsoft/UFO](https://github.com/microsoft/UFO) | 10,065 | MIT | 2026-10-23 | MS Research Windows GUI agent (UFO→UFO²→UFO³) |
| **Agent-S** | [simular-ai/Agent-S](https://github.com/simular-ai/Agent-S) | 12,714 | Apache-2.0 | 2026-10-21 | SOTA open computer-use agent (S→S2/S3) |
| **self-operating-computer** | [OthersideAI/self-operating-computer](https://github.com/OthersideAI/self-operating-computer) | 10,291 | MIT | 2026-10-19 | Multimodal model operates a computer (screenshots + IO) |
| **UI-TARS** | [bytedance/UI-TARS](https://github.com/bytedance/UI-TARS) | 11,634 | Apache-2.0 | 2026-01-27 | ByteDance native GUI-agent models + repo |
| **cua** | [trycua/cua](https://github.com/trycua/cua) | 30,781 | MIT | active | Computer-use 2.0: cross-OS sandboxes + drivers |
| **Fara** | [microsoft/fara](https://github.com/microsoft/fara) | 6,221 | MIT | active | Frontier computer-use agent models (Fara 1.5) |
| **autoMate** | [yuruotong1/autoMate](https://github.com/yuruotong1/autoMate) | 3,967 | MIT | active | "Like Manus" CUA + OmniParser |
| **OS-Copilot** | [OS-Copilot/OS-Copilot](https://github.com/OS-Copilot/OS-Copilot) | 1,794 | MIT | 2024-09-09 | Embodied conversational OS agent (UFO² paper's framework) |
| **OpenAdapt** | [OpenAdaptAI/OpenAdapt](https://github.com/OpenAdaptAI/OpenAdapt) | 1,820 | MIT | 2026-10-21 | Record-and-replay RPA (EHR/portal automation) |
| **open-computer-use** | [e2b-dev/open-computer-use](https://github.com/e2b-dev/open-computer-use) | 2,384 | Apache-2.0 | active | Open-LLM computer use in E2B sandbox |
| **openagent** | [the-open-agent/openagent](https://github.com/the-open-agent/openagent) | 5,710 | Apache-2.0 | active | Personal AI assistant w/ agent loops (Go) |
| **tankwork** | [AgentTankOS/tankwork](https://github.com/AgentTankOS/tankwork) | 97 | MIT | small | Desktop agent framework: agents that see/control your computer |

## B. MCP ecosystem (the pragmatic integration path for a 1-week build)

| Server | Repo | ★ | Why we care |
|---|---|---|---|
| **Official MCP servers collection** | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | 91,520 | Reference implementations (FS, fetch, memory, etc.) |
| **Notion MCP (official)** | [makenotion/notion-mcp-server](https://github.com/makenotion/notion-mcp-server) | 4,677 | **By Notion themselves** — search/create/update pages & databases. This is the "add to my Notion to-do" integration, first-party. MIT |
| **Desktop Commander MCP** | [wonderwhy-er/DesktopCommanderMCP](https://github.com/wonderwhy-er/DesktopCommanderMCP) | 10,103 | Terminal command execution, process mgmt, file search/edit — a ready-made "agent controls my machine" toolset. MIT |
| **Playwright MCP** | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | 38,552 | Microsoft's accessibility-tree browser automation as MCP — fast, no screenshots needed. Apache-2.0 |
| **Anthropic quickstarts** | [anthropics/claude-quickstarts](https://github.com/anthropics/claude-quickstarts) | 18,971 | computer-use demo reference (screenshot loop pattern) |

Key architectural fact: MCP servers are stdio/HTTP child processes speaking JSON-RPC; a desktop app embeds an MCP **client** (TS SDK: `@modelcontextprotocol/sdk`) and spawns servers on demand. That maps perfectly to our **permission GUI**: each toggle = start/stop one MCP server; the agent only sees tools for granted apps.

## C. opencode — driving the terminal coding agent by voice

Repo moved to **[anomalyco/opencode](https://github.com/anomalyco/opencode)** (220k★, MIT, pushed 2026-10-23) — "The open source coding agent." From [docs.opencode.ai/docs/cli](https://docs.opencode.ai/docs/cli/):

- **One-shot, streaming JSON events:** `opencode run --format json "build a landing page for X"` — perfect for our Node backend (`child_process.spawn`), parse events, speak progress.
- **Flags:** `--model`, `--agent`, `--continue`, `--session <id>`, `--file`, `--auto` (auto-approve permissions — use deliberately).
- **Headless server:** `opencode serve` → HTTP API (auth via `OPENCODE_SERVER_PASSWORD`) — best for a long-lived assistant: our app starts the server once, reuses sessions (`--attach http://localhost:4096`).
- **ACP mode:** `opencode acp` — Agent Client Protocol over stdio nd-JSON (how editors integrate).
- **Sessions:** `opencode session list|export` — lets our assistant report what the coding agent did ("opencode finished your site, 3 files changed").

Integration pattern for us: tool `start_coding_task(project_path, prompt)` → spawn `opencode run --format json --auto` in `project_path` → stream events into our overlay ("Building… 12s") → on completion the agent announces a summary.

## D. OS automation libs (if we hand-roll computer control instead of MCP)

- **nut.js** (+ nut-tree) — Node.js keyboard/mouse/window control, cross-platform (Win/macOS/Linux); the standard Electron choice. RobotJS is effectively unmaintained.
- **Python fallback:** pyautogui (used by most computer-use projects above).
- Heavyweight GUI agents (UFO³, Agent-S, cua, Fara) are **research systems requiring their own model serving/sandboxes** — wrong tradeoff for 1 week. We borrow their **patterns** (screenshot→model→action loop, action verification), not their stacks. Notably UFO³ = "agent OS" orchestrating app-specific agents — conceptually similar to our app-permission model.

## E. Top picks: recommended minimal execution architecture (1-week hackathon)

**Voice → LLM (tool calling) → 3 tool families:**

1. **Notion** → official **Notion MCP server** (first-party, reliable) *or* plain Notion REST API if MCP adds friction. Demo: "add buy milk to my to-do" → page created → show link in overlay.
2. **Apps & terminal** → our own tiny "launcher" tools (Node `child_process` + OS `start`/`open`/`xdg-open`, shell exec) — no framework needed. Wrap in our permission ACL UI.
3. **opencode** → `opencode run --format json` (or `opencode serve`) as above — the flagship demo ("open opencode and build me a portfolio site").
4. **Optional stretch (day 6-7 only):** Desktop Commander MCP for terminal/file power tools, Playwright MCP for browser tasks ("search this on Google and open the top result"). Both flip on via the permissions GUI.

**Do NOT attempt:** full screenshot-driven computer use (UFO/Agent-S/cua) in week one — latency and reliability will eat the demo. Cite them in the pitch as the roadmap ("Computer Use 2.0-ready").

*Sources: all repo links above (GitHub API/pages, 2026-10-24); opencode CLI facts from docs.opencode.ai/docs/cli (fetched 2026-10-24).*

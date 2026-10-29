// consoleModel — the pure logic of the Mitra Console thread (docs/CONSOLE_PLAN.md
// "UI/UX" + Architecture deltas). No React, no DOM: the reducer, the async
// submit orchestration, brain-status probing and boot-line composition are all
// plain functions so vitest (node env) can drive them with injected fetch/clock.
//
// Pipeline (same brain as voice, docs/CONSOLE_PLAN.md "Tool execution stays
// intent-driven"): typed text → the EXISTING mock-brain intent parser
// (parseIntent imported from src/voice — reused, never copied) →
//   matched intent  → POST /api/tools/:name (403-aware) → tool-card entry +
//                     follow-up agent line from the result summary;
//   no intent       → POST /api/brain/chat {messages, language} → agent entry
//                     (missing endpoint / offline → the existing mock clarify
//                     line, so the Console ALWAYS works with zero keys AND
//                     zero local models — mock-mode rule, AGENTS.md).
import type { ToolName, WorkspaceMode } from '../shared/types';
import { t, type Lang } from '../i18n';
import { failureReply, fetchRouteDecision, intentToTool, parseIntent, ROUTE_TIMEOUT_MS } from '../voice';
import { DEFAULT_BRIDGE_BASE } from '../voice/types';

// ---------------------------------------------------------------------------
// Thread state
// ---------------------------------------------------------------------------

/** One line in the console thread (plan: user/agent bubbles, tool cards, boot lines). */
export type ConsoleEntry =
  | { id: string; kind: 'user'; text: string; ts: number }
  | { id: string; kind: 'agent'; text: string; ts: number }
  | { id: string; kind: 'tool'; tool: ToolName; summary: string; ok: boolean; ts: number }
  | { id: string; kind: 'boot'; text: string; ts: number };

/** What answers chat right now (plan brain tiers: ollama | mock fallback). */
export type BrainKind = 'ollama' | 'mock' | 'probing';

export interface BrainStatus {
  brain: BrainKind;
  /** Auto-picked model (only meaningful when brain === 'ollama'). */
  model?: string;
  /** Bridge /api/health mock flag — drives the provider-mode hint. */
  bridgeMock?: boolean;
}

export interface ConsoleState {
  entries: ConsoleEntry[];
  /** Boot sequence finished (thread accepts input; BootSequence collapses). */
  booted: boolean;
  /** Agent is composing / a bridge call is in flight → typing dots + thinking ring. */
  typing: boolean;
  /**
   * Speaking-envelope flag: epoch ms until which the persona should animate
   * (set after every agent reply, ~2s + text length; 0 = not speaking).
   */
  speakUntil: number;
  status: BrainStatus;
}

export function initialConsoleState(): ConsoleState {
  return {
    entries: [],
    booted: false,
    typing: false,
    speakUntil: 0,
    status: { brain: 'probing' },
  };
}

export type ConsoleAction =
  | { type: 'boot-line'; text: string; id: string; ts: number }
  | { type: 'boot-done' }
  | { type: 'submit'; text: string; id: string; ts: number }
  | { type: 'tool-result'; id: string; ts: number; tool: ToolName; summary: string; ok: boolean }
  | { type: 'agent-line'; id: string; ts: number; text: string; speakUntil: number }
  | { type: 'typing'; on: boolean }
  | { type: 'speak-end' }
  | { type: 'status'; status: Partial<BrainStatus> };

export type Dispatch = (action: ConsoleAction) => void;

/** Pure reducer — the ONLY writer of ConsoleState (unit-tested in consoleModel.test.ts). */
export function consoleReducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  switch (action.type) {
    case 'boot-line':
      return {
        ...state,
        entries: [...state.entries, { id: action.id, kind: 'boot', text: action.text, ts: action.ts }],
      };
    case 'boot-done':
      return { ...state, booted: true };
    case 'submit':
      // The user bubble lands instantly; typing dots run until the reply.
      return {
        ...state,
        typing: true,
        entries: [...state.entries, { id: action.id, kind: 'user', text: action.text, ts: action.ts }],
      };
    case 'tool-result':
      return {
        ...state,
        entries: [
          ...state.entries,
          { id: action.id, kind: 'tool', tool: action.tool, summary: action.summary, ok: action.ok, ts: action.ts },
        ],
      };
    case 'agent-line':
      return {
        ...state,
        typing: false,
        speakUntil: action.speakUntil,
        entries: [...state.entries, { id: action.id, kind: 'agent', text: action.text, ts: action.ts }],
      };
    case 'typing':
      return { ...state, typing: action.on };
    case 'speak-end':
      return { ...state, speakUntil: 0 };
    case 'status':
      // Merge: chat replies and boot probing each contribute partial facts.
      return { ...state, status: { ...state.status, ...action.status } };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Speaking envelope (persona amplitude) — timing policy only; the 60fps
// oscillation lives in the component (ConsoleApp), adapted from the mock
// provider's syntheticAmplitude envelope.
// ---------------------------------------------------------------------------

/** ~2s base + per-word time, clamped — plan: "drives persona amplitude for ~2s + text length". */
export function speakDurationMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(8000, Math.max(2000, 2000 + words * 90));
}

// ---------------------------------------------------------------------------
// Chat history — what /api/brain/chat receives (recent turns only)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Recent conversation as LLM messages: user bubbles → 'user', agent lines →
 * 'assistant'; boot lines and tool cards are NOT chat turns and are skipped.
 * Returns at most `max` (default 8) messages, oldest first.
 */
export function buildChatHistory(entries: ConsoleEntry[], max = 8): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = entries.length - 1; i >= 0 && out.length < max; i--) {
    const e = entries[i];
    if (e.kind === 'user') out.unshift({ role: 'user', content: e.text });
    else if (e.kind === 'agent') out.unshift({ role: 'assistant', content: e.text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Brain status probe (GET /api/brain/status — the brain engineer's endpoint)
// ---------------------------------------------------------------------------

export interface BrainProbeDeps {
  bridgeBase?: string;
  fetchImpl?: typeof fetch;
  /** Per-request timeout (default 2500ms — a status probe must never hang the boot). */
  timeoutMs?: number;
}

interface StatusBody {
  brain?: unknown;
  model?: unknown;
  mock?: unknown;
}

/**
 * Probe the bridge for the chat brain: GET /api/brain/status → {brain, model?}
 * (docs/CONSOLE_PLAN.md status bar) and GET /api/health → {mock} for the
 * provider-mode hint (same shape HomePanel consumes). NEVER throws: a missing
 * endpoint (404, brain work not landed), a down bridge, or garbage JSON all
 * degrade to brain:'mock' — the console's honest zero-model default.
 */
export async function fetchBrainStatus(deps: BrainProbeDeps = {}): Promise<BrainStatus> {
  const base = deps.bridgeBase ?? DEFAULT_BRIDGE_BASE;
  const fetchImpl: typeof fetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = deps.timeoutMs ?? 2500;

  let brain: BrainKind = 'mock';
  let model: string | undefined;
  let bridgeMock: boolean | undefined;

  try {
    const res = await fetchImpl(`${base}/api/brain/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as StatusBody | null;
      if (body && typeof body === 'object') {
        if (body.brain === 'ollama') brain = 'ollama';
        else if (body.brain === 'mock') brain = 'mock';
        if (typeof body.model === 'string' && body.model.trim()) model = body.model.trim();
      }
    }
  } catch {
    brain = 'mock'; // bridge down / endpoint absent → honest mock default
  }

  try {
    const res = await fetchImpl(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json().catch(() => null)) as StatusBody | null;
    if (res.ok && body && typeof body === 'object' && typeof body.mock === 'boolean') {
      bridgeMock = body.mock;
    }
  } catch {
    bridgeMock = undefined; // provider hint simply stays absent
  }

  return { brain, model, bridgeMock };
}

// ---------------------------------------------------------------------------
// Boot lines (docs/CONSOLE_PLAN.md: "MITRA CONSOLE — neural link established ·
// brain: … · tools: … armed", monospace) — pure composition, i18n-keyed.
// ---------------------------------------------------------------------------

/** Placeholder interpolation for i18n templates: '{brain}' etc. */
function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

/**
 * Tool count for the boot line, kept in one place: the ToolName union in
 * src/shared/types.ts has 14 members (10 base + the 3 real-world tools from
 * docs/DECISION_TIER_PLAN.md §2 + app_task, which opens an app AND types the
 * requested content into it). (No client-side tool registry exists —
 * the authoritative list lives behind the bridge's isKnownTool.)
 */
export const TOOL_COUNT = 14;

export function buildBootLines(status: BrainStatus, lang: Lang): string[] {
  const brainLabel =
    status.brain === 'ollama' && status.model
      ? `Ollama ${status.model}`
      : status.brain === 'ollama'
        ? 'Ollama'
        : t(lang, 'console.brain.mock');
  const modeLine =
    status.bridgeMock === false
      ? t(lang, 'console.boot.mode.live')
      : status.bridgeMock === true
        ? t(lang, 'console.boot.mode.mock')
        : t(lang, 'console.boot.mode.offline');
  return [
    t(lang, 'console.boot.link'),
    fmt(t(lang, 'console.boot.brain'), { brain: brainLabel }),
    fmt(t(lang, 'console.boot.tools'), { count: String(TOOL_COUNT) }),
    modeLine,
  ];
}

// ---------------------------------------------------------------------------
// Hint chips (3 sample commands: one tool, one Hinglish, one plain question)
// ---------------------------------------------------------------------------

/**
 * Sample commands under the input bar. The TEXT is the localized string itself
 * (t(lang, key)) so the hi chip feeds Devanagari/Hinglish through the SAME
 * parser — every chip is verified parseable in consoleModel.test.ts.
 */
export const HINT_CHIPS: ReadonlyArray<{ key: string }> = [
  { key: 'console.hint.tool' }, // tool intent: "add chai to my todo list"
  { key: 'console.hint.hinglish' }, // Hinglish: "notepad kholo"
  { key: 'console.hint.question' }, // identity intent → self-intro: "who are you?"
];

// ---------------------------------------------------------------------------
// Submit orchestration — the async half of the reducer
// ---------------------------------------------------------------------------

export interface ConsoleDeps {
  bridgeBase?: string;
  fetchImpl?: typeof fetch;
  lang?: Lang;
  idFactory?: () => string;
  /** Wall clock (epoch ms); inject in tests. */
  now?: () => number;
  /** Sleep between steps; inject as a no-op in tests. */
  delay?: (ms: number) => Promise<void>;
  /** Thinking-pause jitter source (0..1); default Math.random. */
  random?: () => number;
  /** Live workspace presets for the intent parser (same contract as the mock brain). */
  getWorkspaceModes?: () => WorkspaceMode[];
  /** Recent turns for /api/brain/chat (the caller builds it from the thread). */
  history?: ChatMessage[];
  /**
   * /api/brain/chat timeout (default 20000ms — must cover the local brain's
   * cold start; brain.BRAIN_CHAT_TIMEOUT_MS uses the same 20s budget so the
   * client never gives up before the bridge's own fallback does).
   */
  chatTimeoutMs?: number;
  /** /api/brain/route timeout (default 1500ms — the fast path stays fast). */
  routeTimeoutMs?: number;
}

interface ToolBody {
  ok?: unknown;
  summary?: unknown;
}

interface ChatBody {
  brain?: unknown;
  model?: unknown;
  text?: unknown;
}

function defaultId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `console-${Date.now()}`;
}

/**
 * Run one tool on the bridge's ACL-gated /api/tools/:name endpoint and dispatch
 * the tool-card + agent line. Shared by the deterministic-intent path AND the
 * decision-tier route path (docs/DECISION_TIER_PLAN.md §1) so both behave
 * identically (403-aware failureReply, bridge-offline degradation).
 */
async function runToolOnBridge(
  tool: string,
  args: Record<string, unknown>,
  ctx: {
    base: string;
    fetchImpl: typeof fetch;
    lang: Lang;
    idFactory: () => string;
    now: () => number;
    dispatch: Dispatch;
  },
): Promise<void> {
  let ok = false;
  let summary = '';
  let agentText: string;
  try {
    const res = await ctx.fetchImpl(`${ctx.base}/api/tools/${tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ctx.idFactory(), tool, args }),
    });
    const body = (await res.json().catch(() => null)) as ToolBody | null;
    summary = body && typeof body === 'object' && typeof body.summary === 'string' ? body.summary : '';
    if (res.ok && body?.ok === true) {
      ok = true;
      agentText = summary || t(ctx.lang, 'voice.toolError');
    } else {
      // HTTP 403 also carries a ToolResult body → failureReply maps "Permission
      // denied: <gate>" to the localized apology (mockProvider contract).
      agentText = failureReply(ctx.lang, summary);
    }
  } catch {
    summary = 'bridge-offline';
    agentText = t(ctx.lang, 'voice.bridgeUnreachable');
  }
  // The bridge only returns names from its known-tool list (isKnownTool), so
  // the widen to ToolName for the action type is safe.
  ctx.dispatch({
    type: 'tool-result',
    id: ctx.idFactory(),
    ts: ctx.now(),
    tool: tool as ToolName,
    summary,
    ok,
  });
  finishAgent(ctx.dispatch, ctx.idFactory, ctx.now, agentText);
}

/** Synthetic thinking pause so the typing dots are visible on a local bridge (~5ms otherwise). */
const THINK_MIN_MS = 280;
const THINK_JITTER_MS = 340;

/**
 * Run one typed user turn end-to-end, dispatching reducer actions as it goes:
 *   submit → [thinking pause] → intent?
 *     tool-bound intent → POST /api/tools/:name → tool-result + agent-line
 *     stop/language intent → agent-line only (no tool card, nothing to run)
 *     no intent → POST /api/brain/chat → agent-line (fallback: mock clarify)
 * Every failure path degrades to an honest agent line — never throws
 * (mock-mode rule). The reducer stays pure; tests drive this with a fake fetch.
 */
export async function runSubmit(text: string, dispatch: Dispatch, deps: ConsoleDeps = {}): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const base = deps.bridgeBase ?? DEFAULT_BRIDGE_BASE;
  const fetchImpl: typeof fetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const lang: Lang = deps.lang ?? 'en';
  const now = deps.now ?? Date.now;
  const delay = deps.delay ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const idFactory = deps.idFactory ?? defaultId;

  dispatch({ type: 'submit', text: trimmed, id: idFactory(), ts: now() });
  await delay(THINK_MIN_MS + Math.floor(random() * THINK_JITTER_MS));

  const intent = parseIntent(trimmed, deps.getWorkspaceModes?.() ?? []);

  // ---- no intent → decision tier, then brain chat (plan §1 tier order) -----
  if (!intent) {
    // Decision tier (docs/DECISION_TIER_PLAN.md §1): deterministic missed →
    // POST /api/brain/route (server-side parseIntent + optional Laya) BEFORE
    // the 1-3s chat LLM. Null (bridge down / via:'none' / old bridge) → the
    // pre-existing chat path below. Keeps the fast path fast (1.5s cap).
    const routed = await fetchRouteDecision({
      bridgeBase: base,
      fetchImpl,
      text: trimmed,
      timeoutMs: deps.routeTimeoutMs ?? ROUTE_TIMEOUT_MS,
    });
    if (routed) {
      await runToolOnBridge(routed.tool, routed.args, { base, fetchImpl, lang, idFactory, now, dispatch });
      return;
    }

    // The current utterance IS the last message; deps.history holds the
    // previous turns (built from the thread before this submit landed).
    const messages: ChatMessage[] = [...(deps.history ?? []), { role: 'user', content: trimmed }];
    let agentText: string;
    try {
      const res = await fetchImpl(`${base}/api/brain/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, language: lang }),
        signal: AbortSignal.timeout(deps.chatTimeoutMs ?? 20000),
      });
      const body = (await res.json().catch(() => null)) as ChatBody | null;
      const reply =
        body && typeof body === 'object' && typeof body.text === 'string' ? body.text.trim() : '';
      if (res.ok && reply) {
        if (body?.brain === 'ollama') {
          const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
          dispatch({ type: 'status', status: { brain: 'ollama', model } });
        } else {
          dispatch({ type: 'status', status: { brain: 'mock' } });
        }
        agentText = reply;
      } else {
        agentText = mockChatFallback(lang);
      }
    } catch {
      agentText = mockChatFallback(lang);
    }
    finishAgent(dispatch, idFactory, now, agentText);
    return;
  }

  // ---- stop / language_switch / identity: conversational intents, no tool --
  const mapped = intentToTool(intent);
  if (!mapped) {
    const agentText =
      intent.kind === 'language_switch'
        ? t(intent.language, `voice.langSwitched.${intent.language}`)
        : intent.kind === 'identity'
          ? t(lang, 'voice.identityReply')
          : t(lang, 'voice.stopReply');
    finishAgent(dispatch, idFactory, now, agentText);
    return;
  }

  // ---- tool-bound intent → the SAME ACL-gated bridge path as voice ---------
  const { tool, args } = mapped;
  await runToolOnBridge(tool, args, { base, fetchImpl, lang, idFactory, now, dispatch });
}

/** The mock conversational fallback (plan tier 2): the existing clarify line. */
function mockChatFallback(lang: Lang): string {
  return t(lang, 'voice.clarify');
}

function finishAgent(
  dispatch: Dispatch,
  idFactory: () => string,
  now: () => number,
  text: string,
): void {
  const ts = now();
  dispatch({ type: 'agent-line', id: idFactory(), ts, text, speakUntil: ts + speakDurationMs(text) });
}

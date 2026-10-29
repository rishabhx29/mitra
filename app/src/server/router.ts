// Fast decision tier (docs/DECISION_TIER_PLAN.md §1): between the deterministic
// intent parser and the chat LLMs sits Laya (convaiinnovations/laya — a 421M
// System-1 classifier that answers in milliseconds on-device). The bridge asks
// the optional `laya-serve` sidecar WHICH tool (if any) should handle an
// utterance; the tool's args still come from deterministic regexes below.
//
// Laya is an OPTIONAL tier: when the sidecar is absent (probe 404 / connection
// refused / timeout) or its response shape deviates in any way, every function
// here degrades to via:'none' and the caller falls through to chat — mock-mode
// rule, never throw. The wire shape is pinned by router.test.ts; parsing is
// deliberately defensive (choice + confidence extracted from several common
// response layouts, anything else → none).
import type { ToolName } from '../shared/types';
import {
  NOTE_ARG_RES,
  YOUTUBE_ARG_RES,
  extractUrl,
  normalizeUtterance,
  parseAppTask,
  parseLaunchAlias,
  parseReminder,
} from '../voice/intents';

/** Laya sidecar default (VERIFIED LIVE: laya-serve binds 8000; LAYA_URL env overrides). */
export const DEFAULT_LAYA_URL = 'http://127.0.0.1:8000';
/** The bridge never blocks on Laya longer than this (plan §1). */
export const DEFAULT_LAYA_TIMEOUT_MS = 1500;
/** Below this confidence the route is a "none" (plan §1: confidence > 0.6). */
export const LAYA_MIN_CONFIDENCE = 0.6;

/**
 * The choice options sent to laya-serve — the plan §1 tool-gate list verbatim
 * (note "reminder" maps to the set_reminder tool) + "none". Laya only NAMES the
 * tool; args are extracted by pickArgs.
 */
export const LAYA_TOOL_OPTIONS: readonly string[] = [
  'notion_add_todo',
  'note_notepad',
  'youtube_search',
  'agenda_today',
  'launch_app',
  'app_task',
  'run_opencode_task',
  'open_url',
  'reminder',
  'lock_workstation',
  'workspace_mode',
  'open_any_app',
  'close_app',
  'web_search',
  'none',
];

/**
 * criteria (label -> description) for the verified /v1/systemone choice shape —
 * descriptions steer the classifier; labels must equal LAYA_TOOL_OPTIONS.
 */
export const LAYA_TOOL_CRITERIA: Readonly<Record<string, string>> = {
  notion_add_todo: 'user wants to add an item to their to-do list',
  note_notepad: 'user wants a note written in notepad',
  youtube_search: 'user wants to open youtube and search or play something',
  agenda_today: 'user asks what is due or scheduled today',
  launch_app: 'user wants to open an application',
  app_task: 'open an app AND write/type specific content into it (notepad, etc.)',
  run_opencode_task: 'user wants the opencode coding agent to build something',
  open_url: 'user wants to open a website',
  reminder: 'user wants a reminder or timer',
  lock_workstation: 'user wants the screen locked',
  workspace_mode: 'user wants a workspace preset like coding or gaming mode',
  open_any_app: 'user wants to open any application by name',
  close_app: 'user wants to close or quit a running application',
  web_search: 'user wants to search the web (google) for something',
  none: 'general conversation, no tool',
};

/** Laya choice name → ToolName ("reminder" is the plan's name for set_reminder). */
const LAYA_CHOICE_TO_TOOL: Readonly<Record<string, ToolName>> = {
  notion_add_todo: 'notion_add_todo',
  note_notepad: 'note_notepad',
  youtube_search: 'youtube_search',
  agenda_today: 'agenda_today',
  launch_app: 'launch_app',
  app_task: 'app_task',
  run_opencode_task: 'run_opencode_task',
  open_url: 'open_url',
  reminder: 'set_reminder',
  lock_workstation: 'lock_workstation',
  workspace_mode: 'workspace_mode',
  open_any_app: 'open_any_app',
  close_app: 'close_app',
  web_search: 'web_search',
};

/** Structural subset of Response — keeps tests free of DOM/lib.dom types. */
export interface LayaResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** fetch-shaped adapter with AbortSignal support (the bridge's FetchLike fits). */
export type LayaFetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<LayaResponseLike>;

export interface LayaRouteDeps {
  fetchImpl: LayaFetchLike;
  layaUrl: string;
  timeoutMs?: number;
}

/** What routeViaLaya answers: the named tool (or none) + Laya's confidence. */
export interface LayaDecision {
  tool?: ToolName;
  confidence: number;
  via: 'laya' | 'none';
}

/** Whole-route response of POST /api/brain/route (the bridge composes args). */
export interface RouteDecision {
  tool?: ToolName;
  args?: Record<string, unknown>;
  confidence: number;
  via: 'deterministic' | 'laya' | 'none';
}

/**
 * The laya-serve /v1/systemone request (TypeSafe-Jev-compatible shape pinned
 * by router.test.ts): the utterance as `state.text` plus ONE typed `choice`
 * question whose options are the tool gates + "none".
 */
export function buildSystemOneRequest(text: string): Record<string, unknown> {
  // VERIFIED LIVE against laya-serve 0.4.15 (docs/DECISION_TIER_PLAN.md §1):
  // questions is an OBJECT keyed by id; a choice question takes `instructions`
  // + `criteria` (dict of label -> description). Array/options shapes 400/422.
  return {
    state: { text },
    questions: {
      route_tool: {
        type: 'choice',
        instructions: 'Which capability does this utterance need? Pick exactly one.',
        criteria: { ...LAYA_TOOL_CRITERIA },
      },
    },
  };
}

/** First array element (undefined when not an array / empty). */
function firstElement(value: unknown): unknown {
  return Array.isArray(value) && value.length > 0 ? value[0] : undefined;
}

/** Confidence from common numeric fields; 0 when absent/invalid (→ below gate). */
function readConfidence(source: Record<string, unknown>): number {
  for (const key of ['confidence', 'score', 'prob', 'probability', 'p']) {
    const raw = source[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
  }
  return 0;
}

/**
 * Defensively pull (choice, confidence) out of a systemone response. Accepted
 * shapes: {choice:"x", confidence:.9}, {answer:{option:"x",score:.9}},
 * {answers:[{value:"x",prob:.9}]}, {result:"x"}, {output:"x"} — anything else
 * (or a choice that is not a non-empty string) → null, i.e. via:'none'.
 */
function parseSystemOneChoice(body: unknown): [choice: string, confidence: number] | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  // VERIFIED live shape: {answers:{route_tool:{choice,confidence}}} — answers is
  // an object keyed by question id. Keep the defensive fallbacks for older shapes.
  const answersField = obj['answers'];
  const fromAnswersObj =
    answersField !== null && typeof answersField === 'object' && !Array.isArray(answersField)
      ? (answersField as Record<string, unknown>)['route_tool']
      : undefined;
  const raw =
    obj['choice'] ??
    (fromAnswersObj !== null && typeof fromAnswersObj === 'object'
      ? (fromAnswersObj as Record<string, unknown>)['choice']
      : undefined) ??
    obj['answer'] ??
    firstElement(obj['answers']) ??
    obj['result'] ??
    obj['output'];
  // confidence likewise prefers answers.route_tool.confidence
  if (
    fromAnswersObj !== null &&
    typeof fromAnswersObj === 'object' &&
    typeof (fromAnswersObj as Record<string, unknown>)['confidence'] === 'number'
  ) {
    const verifiedChoice =
      typeof raw === 'string' && raw.trim() !== '' ? raw.trim().toLowerCase() : null;
    return verifiedChoice
      ? [verifiedChoice, (fromAnswersObj as Record<string, unknown>)['confidence'] as number]
      : null;
  }
  if (typeof raw === 'string') {
    const choice = raw.trim();
    return choice ? [choice, readConfidence(obj)] : null;
  }
  if (raw !== null && typeof raw === 'object') {
    const inner = raw as Record<string, unknown>;
    const choiceRaw = inner['option'] ?? inner['choice'] ?? inner['value'] ?? inner['label'] ?? inner['tool'];
    if (typeof choiceRaw !== 'string') return null;
    const choice = choiceRaw.trim();
    if (!choice) return null;
    const confidence = readConfidence(inner);
    return [choice, confidence || readConfidence(obj)];
  }
  return null;
}

/** Map a parsed choice+confidence onto a LayaDecision (defensive, never throws). */
export function decideFromSystemOneResponse(body: unknown): LayaDecision {
  const parsed = parseSystemOneChoice(body);
  if (!parsed) return { confidence: 0, via: 'none' };
  const [choice, confidence] = parsed;
  if (!(confidence > LAYA_MIN_CONFIDENCE)) return { confidence, via: 'none' };
  const tool = LAYA_CHOICE_TO_TOOL[choice.toLowerCase()];
  if (!tool) return { confidence, via: 'none' }; // 'none' itself, or an unknown option
  return { tool, confidence, via: 'laya' };
}

/**
 * Ask the laya-serve sidecar which tool should handle `text`. Any failure —
 * connection refused, HTTP 404 (sidecar absent), 1.5s timeout (AbortSignal),
 * non-JSON body, shape deviation, low confidence — returns via:'none' so the
 * caller falls through to chat. Never throws.
 */
export async function routeViaLaya(text: string, deps: LayaRouteDeps): Promise<LayaDecision> {
  const trimmed = text.trim();
  if (!trimmed) return { confidence: 0, via: 'none' };
  const url = `${deps.layaUrl.replace(/\/+$/, '')}/v1/systemone`;
  try {
    const res = await deps.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSystemOneRequest(trimmed)),
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_LAYA_TIMEOUT_MS),
    });
    if (!res.ok) return { confidence: 0, via: 'none' };
    const body = await res.json().catch(() => null);
    return decideFromSystemOneResponse(body);
  } catch {
    return { confidence: 0, via: 'none' };
  }
}

/** First capture group of the first matching regex, or null. */
function firstCapture(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const captured = m.length > 1 ? (m[1] ?? '') : m[0];
      const value = captured.replace(/\s+/g, ' ').trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * Deterministic per-tool arg extraction (plan §1: "Laya only names the tool,
 * regexes parameterize"). The regexes are SHARED with the voice intent parser
 * (NOTE_ARG_RES / YOUTUBE_ARG_RES / parseReminder / parseLaunchAlias /
 * extractUrl from voice/mockProvider) so a deterministic hit and a Laya-routed
 * hit always yield the same args for the same utterance.
 *
 * Returns null when no args can be extracted for an args-requiring tool — the
 * bridge then reports via:'none' and the caller falls through to chat (plan §1:
 * "No args extractable → fall through to chat"). No-arg tools (agenda_today,
 * lock_workstation) get an empty args object.
 */
export function pickArgs(tool: ToolName, text: string): Record<string, unknown> | null {
  const norm = normalizeUtterance(text);
  switch (tool) {
    case 'note_notepad': {
      const note = firstCapture(norm, NOTE_ARG_RES);
      return note ? { text: note } : null;
    }
    case 'youtube_search': {
      const query = firstCapture(norm, YOUTUBE_ARG_RES);
      return query ? { query } : null;
    }
    case 'set_reminder': {
      const reminder = parseReminder(norm);
      return reminder ? { minutes: reminder.minutes, text: reminder.text } : null;
    }
    case 'launch_app': {
      const alias = parseLaunchAlias(norm);
      return alias ? { alias } : null;
    }
    case 'app_task': {
      // The opencode composite routes to run_opencode_task deterministically,
      // so only plain app_task composites parameterize here.
      const task = parseAppTask(norm);
      return task && task.kind === 'app_task' ? { app: task.app, content: task.content } : null;
    }
    case 'open_url': {
      const url = extractUrl(norm);
      return url ? { url } : null;
    }
    case 'agenda_today':
    case 'lock_workstation':
      return {};
    case 'close_app': {
      // Mirrors intents.CLOSE_APP_RES without the stop-forms (handled above).
      const close = firstCapture(norm, [
        /close\s+(?:the\s+)?(.{2,40}?)\s*(?:app|application)?\s*(?:now|please)?[.?!]?$/,
        /quit\s+(?:the\s+)?(.{2,40}?)[.?!]?$/,
        /band\s+karo\s+(.{2,40}?)[.?!]?$/,
      ]);
      return close ? { name: close } : null;
    }
    case 'web_search': {
      const web = firstCapture(norm, [
        /^google\s+(.{2,80}?)[.?!]?$/,
        /^search\s+(?:the\s+)?web\s+for\s+(.{2,80}?)[.?!]?$/,
      ]);
      return web ? { query: web } : null;
    }
    case 'open_any_app': {
      // Laya named open_any_app but parseLaunchAlias missed — args unknown
      // beyond the raw utterance; hand the whole text as the app name guess.
      return { name: norm };
    }
    // notion_add_todo / workspace_mode / run_opencode_task / memory /
    // list_reminders / status_briefing: parseIntent owns these utterances
    // deterministically; when only Laya names them there is no safe regex →
    // fall through to chat.
    default:
      return null;
  }
}

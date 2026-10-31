// The Console brain (docs/CONSOLE_PLAN.md "The brain", tier 1+2):
//   1. Ollama (local) — auto-detect http://127.0.0.1:11434 (/api/tags), auto-pick
//      a model that fits 8GB RAM (prefer qwen2.5, then gemma2, then smallest
//      installed), then chat via /api/generate (non-streaming v1).
//   2. Mock conversational fallback — deterministic, hash-varied en+hi replies so
//      the Console ALWAYS works with zero keys and zero local models (mock-mode
//      rule: AGENTS.md).
// fetch, timeouts, base URL and the model preference are all injectable, so
// vitest stays pure (no network, no sleeps beyond tiny override values). Every
// entry point resolves — never throws — and every failure degrades to tier 2.
import type { FetchResponseLike } from './tools/notion';

export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
/** Detection budget (GET /api/tags) — must be cheap, the status bar polls it. */
export const BRAIN_DETECT_TIMEOUT_MS = 1500;
/**
 * Generation budget (POST /api/generate); past it we answer from the mock brain.
 * 20s, not 8s: qwen2.5:3b cold-start on 8GB routinely exceeds 8s, which used to
 * turn real chat turns into the useless clarify fallback.
 */
export const BRAIN_CHAT_TIMEOUT_MS = 20_000;

export type BrainKind = 'ollama' | 'mock';

/** pickBrain result. mock carries no model — there is nothing to name. */
export interface BrainStatus {
  brain: BrainKind;
  model?: string;
}

/** chatWithBrain result: the tier that answered, the model used (if Ollama), the text. */
export interface BrainChatResult {
  brain: BrainKind;
  model?: string;
  text: string;
}

/** One conversation turn. The Console thread maps 1:1 onto this. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Structural subset of `Response` (same shape as tools/notion FetchResponseLike)
 * with an optional AbortSignal pass-through so real fetches are actually aborted
 * on timeout instead of leaking a hanging socket. Fakes in tests may ignore it.
 */
export type BrainFetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

const defaultFetch: BrainFetchLike = (url, init) => fetch(url, init);

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Race `p` against a timer. Resolves undefined when the timer wins (never
 * rejects), so callers branch on a plain undefined. The losing promise's late
 * rejection is swallowed — a timed-out fetch must not surface as an
 * unhandledRejection later. The timer is always cleared so vitest's event loop
 * is never kept alive by a pending clock.
 */
function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  const guarded = p.catch(() => undefined as unknown as T);
  return Promise.race([guarded, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Fire-and-forget AbortController so a REAL fetch honors our timeout budget. */
function abortAfter(ms: number): { signal: AbortSignal | undefined; cancel: () => void } {
  if (typeof AbortController !== 'function') return { signal: undefined, cancel: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

// ---------------------------------------------------------------------------
// Detection + model auto-pick (tier 1 gate)
// ---------------------------------------------------------------------------

interface OllamaModel {
  name: string;
  /** Bytes; models without a parseable size sort last (Infinity). */
  size: number;
}

/** Parse the /api/tags payload defensively: only well-named entries survive. */
export function parseOllamaTags(body: unknown): OllamaModel[] {
  if (!isRecord(body) || !Array.isArray(body['models'])) return [];
  const models: OllamaModel[] = [];
  for (const entry of body['models']) {
    if (!isRecord(entry)) continue;
    const name = entry['name'];
    if (typeof name !== 'string' || !name.trim()) continue;
    const rawSize = entry['size'];
    const size = typeof rawSize === 'number' && Number.isFinite(rawSize) ? rawSize : Number.POSITIVE_INFINITY;
    models.push({ name, size });
  }
  return models;
}

function smallest(models: OllamaModel[]): OllamaModel | null {
  if (models.length === 0) return null;
  // sort is stable in modern JS: size ties keep the /api/tags order, so the
  // choice is deterministic for a given machine.
  return [...models].sort((a, b) => a.size - b.size)[0] ?? null;
}

/**
 * Model auto-pick (docs/CONSOLE_PLAN.md): qwen2.5 first (best multilingual/Hindi
 * at 3B, ~3GB RAM), then gemma2, then the smallest installed model. Within a
 * family the SMALLEST variant (size in bytes from /api/tags) wins. Matching is
 * case-insensitive over the tag name.
 */
export function chooseOllamaModel(models: OllamaModel[]): string | null {
  const qwen = models.filter((m) => m.name.toLowerCase().includes('qwen2.5'));
  if (qwen.length > 0) return smallest(qwen)?.name ?? null;
  const gemma = models.filter((m) => m.name.toLowerCase().includes('gemma2'));
  if (gemma.length > 0) return smallest(gemma)?.name ?? null;
  return smallest(models)?.name ?? null;
}

export interface PickBrainOpts {
  fetchImpl?: BrainFetchLike;
  baseUrl?: string;
  /** Detection timeout override (tests use a few ms instead of 1.5s). */
  timeoutMs?: number;
}

/**
 * Probe Ollama once. Unreachable / slow / non-ok / garbage / zero models →
 * {brain:'mock'}. Reachable with at least one model → {brain:'ollama', model}.
 * Never throws.
 */
export async function pickBrain(opts: PickBrainOpts = {}): Promise<BrainStatus> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const base = trimBase(opts.baseUrl ?? OLLAMA_BASE_URL);
  const timeoutMs = opts.timeoutMs ?? BRAIN_DETECT_TIMEOUT_MS;
  const abort = abortAfter(timeoutMs);
  try {
    const res = await raceTimeout(
      fetchImpl(`${base}/api/tags`, { method: 'GET', signal: abort.signal }),
      timeoutMs,
    );
    if (!res || !res.ok) return { brain: 'mock' };
    const body = (await raceTimeout(res.json(), timeoutMs)) as unknown;
    const model = chooseOllamaModel(parseOllamaTags(body));
    return model ? { brain: 'ollama', model } : { brain: 'mock' };
  } catch {
    return { brain: 'mock' };
  } finally {
    abort.cancel();
  }
}

// ---------------------------------------------------------------------------
// Persona prompt + transcript rendering
// ---------------------------------------------------------------------------

/**
 * Mitra persona, concise and honest: tool execution stays intent-driven (the
 * local parser runs BEFORE the brain in the Console), so the LLM must not claim
 * it can run tools — it converses and points direct commands back at the input.
 */
export function personaSystemPrompt(language: 'en' | 'hi'): string {
  const langRule =
    language === 'hi'
      ? 'Reply in Hindi (Devanagari script).'
      : 'Reply in English; if the user writes Hinglish, mirror their Hinglish style.';
  return [
    'You are Mitra, a warm, concise desktop assistant running locally on the user\'s machine.',
    langRule,
    'Keep replies short (1-3 sentences), friendly and helpful.',
    'You can only converse: you cannot run apps, tools, browse the web, or take actions yourself.',
    'If the user asks you to DO something (open an app, add a to-do, set a reminder), tell them to type or say the command directly in the console.',
    'Never claim abilities you do not have.',
  ].join(' ');
}

/**
 * Render the thread as a transcript ending on "Mitra:" so generation continues
 * as Mitra. Deterministic: same thread in, same prompt out.
 */
/**
 * Tool-calling protocol (the "real Jarvis" tier): when the chat brain is
 * given the tool catalog, a request that maps to a tool is answered with a
 * SINGLE line of strict JSON: {"tool":"<name>","args":{...}}. Anything else is
 * conversation. The bridge executes the action (through the ACL-gated
 * dispatcher) and returns the spoken summary.
 */
export function buildToolSystemPrompt(language: 'en' | 'hi', tools: readonly string[]): string {
  const catalog = tools.map((t) => `"${t}"`).join(', ');
  const base = personaSystemPrompt(language);
  return (
    base +
    '\n\nYou can also ACT on the user\'s PC through these tools: ' +
    catalog +
    '.\nIf the user\'s latest message maps to one of them, reply with ONLY one line of strict JSON, no prose, no code fence:' +
    '\n{"tool":"<tool-name>","args":{...}}' +
    '\nChoose args that fit the tool (e.g. notion_add_todo takes {"text":"..."}; launch_app takes {"alias":"app name"}; app_task takes {"app":"notepad","content":"..."}; open_url takes {"url":"..."}; youtube_search takes {"query":"..."}; web_search takes {"query":"..."}; run_opencode_task takes {"prompt":"..."}; open_any_app/close_app take {"name":"app name"}; set_reminder takes {"minutes":N,"text":"..."}; workspace_mode takes {"name":"coding|gaming|study|chill"}).' +
    '\nComposite requests: "open <app> and write/type <content>" must use app_task (or run_opencode_task when the app is opencode) — NEVER launch_app.' +
    '\nSEMANTIC RULES (infer intent — do not match words literally):' +
    '\n- "open <name>" where <name> is a website, product or library rather than an installed app (e.g. animejs, bolna, react) → use open_url with its https URL (https://animejs.com, https://bolna.ai, https://react.dev).' +
    '\n- "search <query>" about movies, trailers, songs or videos → youtube_search; about facts, docs, code or products → web_search.' +
    '\nIf no tool fits, or information is missing, answer conversationally instead.'
  );
}

/**
 * Extract every BALANCED top-level {...} block (string-aware, escape-aware).
 * The old `\{[^{}]*\}` regex truncated at the first `}` — which for ANY tool
 * with nested args ({"args":{"url":…}}) produced invalid JSON and silently
 * killed the action. Balanced scanning handles arbitrary nesting.
 */
export function balancedJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

/** Strict-ish action extraction: first JSON object with a valid "tool" string. */
export function parseAction(text: string, allowed: readonly string[]): { tool: string; args: Record<string, unknown> } | null {
  if (!text) return null;
  for (const candidate of balancedJsonObjects(text)) {
    try {
      const obj = JSON.parse(candidate) as { tool?: unknown; args?: unknown };
      if (typeof obj['tool'] === 'string') {
        const tool = obj['tool'].trim();
        if (allowed.includes(tool)) {
          const args =
            obj['args'] !== null && typeof obj['args'] === 'object' && !Array.isArray(obj['args'])
              ? (obj['args'] as Record<string, unknown>)
              : {};
          return { tool, args };
        }
      }
    } catch {
      /* not JSON - try the next block */
    }
  }
  return null;
}

export function buildPrompt(messages: ChatMessage[]): string {
  const lines = messages.map((m) => `${m.role === 'user' ? 'User' : 'Mitra'}: ${m.content.trim()}`);
  return `${lines.join('\n')}\nMitra:`;
}

// ---------------------------------------------------------------------------
// Request sanitizing (route edge — untrusted renderer JSON)
// ---------------------------------------------------------------------------

export const MAX_CHAT_MESSAGES = 24;
export const MAX_CHAT_CONTENT_CHARS = 2000;

/**
 * Keep only valid turns ({role:'user'|'assistant', content: non-empty string}),
 * cap each content and keep the most recent MAX_CHAT_MESSAGES turns. Never throws.
 */
export function sanitizeChatMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const out: ChatMessage[] = [];
  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const role = raw['role'];
    const content = raw['content'];
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    const text = content.trim().slice(0, MAX_CHAT_CONTENT_CHARS);
    if (!text) continue;
    out.push(role === 'user' ? { role: 'user', content: text } : { role: 'assistant', content: text });
  }
  return out.slice(-MAX_CHAT_MESSAGES);
}

// ---------------------------------------------------------------------------
// Tier 2: deterministic mock conversational fallback
// ---------------------------------------------------------------------------

// Our own clean-room phrasing (no copied corpus). Honest: one variant per
// language admits the offline mock brain so the fallback never pretends to be
// something it is not (plan: "fallback to mock with honest note").
const MOCK_REPLIES_EN: readonly string[] = [
  'I\'m here and listening — what shall we do next?',
  'Happy to help! Ask me to run a tool, or just chat away.',
  'Running on my offline mock brain right now — I can still keep you company and run your tools!',
  'Tell me what you need and I\'ll take care of it.',
  'At your service. Try "add chai to my list" or just say hi!',
];

const MOCK_REPLIES_HI: readonly string[] = [
  'मैं यहाँ हूँ — बताइए, क्या मदद करूँ?',
  'मदद करने में खुशी होगी! कोई टूल चलाना हो या बस बात करनी हो?',
  'अभी मेरा ऑफ़लाइन मॉक ब्रेन चल रहा है — फिर भी बातें कर सकता हूँ और आपके टूल भी चला सकता हूँ!',
  'बताइए क्या चाहिए — मित्र हाज़िर है।',
  'आपकी सेवा में। "list me chai jodo" आज़माइए या बस नमस्ते कहिए!',
];

/** Unsigned 32-bit djb2 — tiny, dependency-free, fully deterministic. */
function hash32(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h + s.charCodeAt(i)) | 0) >>> 0;
  }
  return h >>> 0;
}

/**
 * A friendly short reply, varied by a hash of the last user message so the
 * conversation feels alive without randomness (same input → same reply;
 * different messages → usually different replies). `language` picks the pool.
 */
export function mockConversationalReply(messages: ChatMessage[], language: 'en' | 'hi'): string {
  const pool = language === 'hi' ? MOCK_REPLIES_HI : MOCK_REPLIES_EN;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const seed = hash32(`${lastUser?.content ?? ''}|${messages.length}`);
  return pool[seed % pool.length] as string;
}

// ---------------------------------------------------------------------------
// Tier 1 chat: one /api/generate round-trip with tier-2 fallback
// ---------------------------------------------------------------------------

export interface ChatWithBrainDeps {
  /** Conversation so far (already sanitized by callers that receive raw JSON). */
  messages: ChatMessage[];
  language?: 'en' | 'hi';
  fetchImpl?: BrainFetchLike;
  baseUrl?: string;
  /** Detection timeout override (tests). */
  detectTimeoutMs?: number;
  /** Generation timeout override (tests). */
  chatTimeoutMs?: number;
  /** Settings.console.model — preferred over the auto-pick when non-blank. */
  preferredModel?: string;
  /** ACL-gated dispatcher: when the brain emits a tool action, it runs here. */
  executeTool?: (tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; summary: string }>;
  /** Tool names advertised to the brain (only when executeTool is present). */
  toolNames?: readonly string[];
}

/**
 * Converse via the local brain. Order: preferred model (settings) → detection →
 * generation → on ANY failure (unreachable, timeout, non-ok, garbage, empty)
 * fall back to the deterministic mock reply. Never throws; always resolves.
 */
export async function chatWithBrain(deps: ChatWithBrainDeps): Promise<BrainChatResult> {
  const language = deps.language === 'hi' ? 'hi' : 'en';
  const messages = Array.isArray(deps.messages) ? deps.messages : [];
  const fallback = (): BrainChatResult => ({ brain: 'mock', text: mockConversationalReply(messages, language) });
  const fetchImpl = deps.fetchImpl ?? defaultFetch;
  const base = trimBase(deps.baseUrl ?? OLLAMA_BASE_URL);

  // Nothing to converse about → answer from tier 2 (honest, deterministic).
  if (messages.length === 0) return fallback();

  try {
    const preferred = deps.preferredModel?.trim();
    const status: BrainStatus = preferred
      ? { brain: 'ollama', model: preferred }
      : await pickBrain({ fetchImpl, baseUrl: base, timeoutMs: deps.detectTimeoutMs });
    if (status.brain !== 'ollama' || !status.model) return fallback();

    const chatTimeoutMs = deps.chatTimeoutMs ?? BRAIN_CHAT_TIMEOUT_MS;
    const abort = abortAfter(chatTimeoutMs);
    try {
      const withTools = Boolean(deps.executeTool && deps.toolNames && deps.toolNames.length > 0);
      const res = await raceTimeout(
        fetchImpl(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: status.model,
            system: withTools
              ? buildToolSystemPrompt(language, deps.toolNames!)
              : personaSystemPrompt(language),
            prompt: buildPrompt(messages),
            stream: false,
          }),
          signal: abort.signal,
        }),
        chatTimeoutMs,
      );
      if (!res || !res.ok) return fallback();
      const body = (await raceTimeout(res.json(), chatTimeoutMs)) as unknown;
      const text =
        isRecord(body) && typeof body['response'] === 'string' ? (body['response'] as string).trim() : '';
      if (!text) return fallback();

      // Tool action? Execute through the ACL-gated dispatcher and speak the result.
      if (withTools) {
        const action = parseAction(text, deps.toolNames!);
        if (action && deps.executeTool) {
          const outcome = await deps.executeTool(action.tool, action.args);
          return {
            brain: 'ollama',
            model: status.model,
            text: outcome.ok
              ? outcome.summary || 'Done.'
              : `${language === 'hi' ? 'माफ़ कीजिए, वह नहीं हो पाया' : 'Sorry, that did not work'}. ${outcome.summary}`,
          };
        }
      }
      return { brain: 'ollama', model: status.model, text };
    } finally {
      abort.cancel();
    }
  } catch {
    return fallback();
  }
}

// MockProvider — the offline voice brain (mock mode is first-class: AGENTS.md +
// plan Global Constraints "never throw on missing keys").
//
// - NO network for understanding: intents are parsed locally with regexes over
//   English, Hindi (Devanagari) and Hinglish (romanized).
// - Tool execution goes through the Local Bridge HTTP API exactly like the real
//   brain would (POST /api/tools/:name); HTTP 403 also carries a ToolResult
//   body, so permission denials surface as a spoken apology + Settings hint
//   (plan Review Focus #2) — never a throw.
// - Simulated latency: listening → thinking (400–900ms) → speaking, with a
//   synthetic speech envelope during speaking so the persona animates without
//   real TTS (rAF-guarded: flat 0 under vitest's node environment).
import type { SessionState, ToolName, TranscriptEntry, VoiceProvider, WorkspaceMode } from '../shared/types';
import { t, type Lang } from '../i18n';
import {
  DEFAULT_BRIDGE_BASE,
  type MockIntent,
  type MockVoiceProviderExtras,
} from './types';

export interface MockProviderDeps {
  bridgeBase?: string;
  fetchImpl?: typeof fetch;
  /** Latency/speaking clock — inject in tests so they don't sleep. */
  delay?: (ms: number) => Promise<void>;
  /** Latency jitter source (0..1); default Math.random. */
  random?: () => number;
  idFactory?: () => string;
  /** Speaking-duration model (ms per utterance); default ~260ms/word, clamped. */
  speakDuration?: (text: string) => number;
  /**
   * Live view of Settings.workspaceModes so the workspace_mode intent matches
   * the CURRENT presets (panel edits apply mid-session, no provider rebuild).
   * Empty/absent → mode matching is off.
   */
  getWorkspaceModes?: () => WorkspaceMode[];
}

// ---------------------------------------------------------------------------
// Intent parsing (pure — unit-tested across en / hi / hinglish)
// ---------------------------------------------------------------------------

/** Strip trailing punctuation + collapse whitespace; keep inner dots (URLs). */
function normalizeUtterance(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,!?;:"'’।]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanupCapture(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// 1) stop / end the session — full-utterance matches only ("stop the music" is NOT stop).
const STOP_RE =
  /^(?:stop|stop it|shut up|exit|quit|bye|goodbye|alvida|ruko|ruk ja|ruk jao|band karo|bandh karo|chup|chup ho jao|बंद करो|रुको|रुक जाओ|चुप|अलविदा)$/;

// 2) language switch — "speak hindi" / "ab hindi me bolo" / "हिंदी में बोलो" (+english).
const LANG_HI_RE =
  /\b(?:speak|talk)\s+(?:in\s+)?hindi\b|\bab\s+(?:se\s+)?hindi\b|\bhindi\b\s*(?:me(?:in)?)?\s*(?:bolo|bol|baat)\b|हिंदी\s*(?:में)?\s*(?:बोलो|बात करो)/;
const LANG_EN_RE =
  /\b(?:speak|talk)\s+(?:in\s+)?english\b|\bab\s+(?:se\s+)?english\b|\benglish\b\s*(?:me(?:in)?)?\s*(?:bolo|bol|baat)\b|अंग्रेज़?ी\s*(?:में)?\s*(?:बोलो|बात करो)/;

// 3) opencode task — BEFORE launch-app so "open opencode and build …" routes to the tool.
const OPENCODE_RES: RegExp[] = [
  /^open\s+opencode\s+(?:and|aur|or|phir|then)?\s*(?:please\s+)?(?:build|design|deso|make|banao|bana|likho|run|chalu|chala)\b[\s:,-]*(.+)$/,
  /^opencode\s+(?:me|mein|par|pe)\s+(.+?)\s+(?:banao|bana|likho|build)$/,
  /^opencode\s+(?:build|design|deso|make|banao|bana|likho|run)\b[\s:,-]*(.+)$/,
];

// 4) add-todo — "add X to my (todo )?list" / "list me X" / "X add karo" / "meri list me X jodo" (+ Devanagari).
// Order matters: the "…me X jodo" variant runs before bare "list me X" so the
// verb ending is consumed, not captured into the to-do text.
const ADD_RES: RegExp[] = [
  /^add\s+(.+?)\s+to\s+(?:(?:my|the|meri)\s+)?(?:todo|to-do|to\s?do|task)?\s*list$/,
  /^(?:meri\s+)?list\s+(?:me|mein|may)\s+(.+?)\s+(?:jodo|jod do|daal do|daalo|add karo)$/,
  /^(.+?)\s+add\s+karo$/,
  /^(.+?)\s+(?:jodo|daal do|daalo)$/,
  /^list\s+(?:me\s+|up\s+)?(.+?)(?:\s+(?:on|to|in)\s+(?:(?:my|the)\s+)?list)?$/,
  /^(?:मेरी\s+)?लिस्ट\s*(?:में|मे)\s*(.+?)\s*(?:जोड़ो|जोड़ दो|डालो|ऐड करो)$/,
  /^(.+?)\s+(?:जोड़ो|जोड़ दो|डालो)$/,
];

// 5) open-url — URL-shaped input ("open github.com", "https://…", "www.…").
const ABSOLUTE_URL_RE = /(?:https?:\/\/|www\.)[^\s]+/i;
const BARE_DOMAIN_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|ai|dev|in|co|app|xyz|me|gov|edu)(?:\/[^\s]*)?/i;

// 6) launch-app — "open X" / "X kholo" (+ Devanagari).
const LAUNCH_RES: RegExp[] = [
  /^(?:open|launch|start|run|khol|kholo|khol do|chalu karo|shuru karo)\s+(.+)$/,
  /^(.+?)\s+khol(?:o| do)?$/,
  /^(.+?)\s+खोल(?:ो| दो)?$/,
  /^खोल(?:ो)?\s+(.+)$/,
  /^(.+?)\s+चालू करो$/,
];

// 7) set_reminder — Ultron port rows 2–3 (clean-room phrasing). Minutes-only
//    scope per the ledger; Devanagari digits are mapped to ASCII first and
//    मिनट is accepted as the unit word. Patterns run on the digit-normalized
//    text and yield {minutes, text} (text optional).
const REMIND_ME_RES: RegExp[] = [
  /^(?:please\s+)?remind me (?:in|after)\s+(\d+) ?(?:m\b|mins?\b|minutes?\b|मिनट)\s*(?:(?:to|for|ki)\s+(.+))?$/,
];
const TIMER_RES: RegExp[] = [
  /^(\d+) ?(?:minutes?|mins?|मिनट) ka timer\s*(?:(?:to|for|ki)\s+(.+))?$/,
  /^(\d+) मिनट का टाइमर\s*(?:(?:कि|ki)\s+(.+))?$/,
  /^(\d+) मिनट बाद(?:\s+(.+?))?\s*(?:याद दिलाओ|याद दिलाना|रिमाइंडर दो|रिमाइंडर)?$/,
];

/** Minutes window for reminders: ≥1 and ≤ a day (nonsense values clarify instead). */
const MIN_REMINDER_MINUTES = 1;
const MAX_REMINDER_MINUTES = 24 * 60;

/** Devanagari digits → ASCII so "४ मिनट" parses like "4 मिनट". */
function normalizeDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => String('०१२३४५६७८९'.indexOf(d)));
}

function parseReminder(text: string): { minutes: number; text: string } | null {
  const norm = normalizeDigits(text);
  const attempt = (res: RegExp[]): { minutes: number; text: string } | null => {
    for (const re of res) {
      const m = re.exec(norm);
      if (!m) continue;
      const minutes = Number.parseInt(m[1] ?? '', 10);
      if (!Number.isFinite(minutes) || minutes < MIN_REMINDER_MINUTES || minutes > MAX_REMINDER_MINUTES) {
        continue; // out-of-range nonsense → try the next shape / fall through
      }
      return { minutes, text: cleanupCapture(m[2] ?? '') };
    }
    return null;
  };
  return attempt(REMIND_ME_RES) ?? attempt(TIMER_RES);
}

// 8) memory — Ultron port row 5 (Cerebro-lite). Recall-all first (exact), then
//    recall-with-query, then remember. Our own en/Hinglish/Devanagari phrasing.
const MEMORY_RECALL_ALL_RES = [
  /^(?:what do you remember|what all do you remember|kya yaad hai|kya yaad rakha hai|क्या याद है)$/,
];
const MEMORY_RECALL_RES: RegExp[] = [
  /^(?:what do you remember|what do you know)\s+about\s+(.+)$/,
  /^(.+?)\s+ke baare me(?:in)?\s+kya yaad hai$/,
  /^(?:kya\s+)?yaad hai\s+(.+?)(?:\s+ke baare me(?:in)?)?$/,
  /^(.+?)\s+के बारे में क्या याद है$/,
  /^(?:क्या\s+)?याद है\s+(.+?)(?:\s+के बारे में)?$/,
];
const MEMORY_REMEMBER_RES: RegExp[] = [
  /^remember\s+(?:that\s+|this\s+|it\s+)?(.+)$/,
  /^yaad rakho(?:\s+(?:ki|ke))?\s+(.+)$/,
  /^yaad rakhna(?:\s+ki)?\s+(.+)$/,
  /^याद रख(?:ो|ना|िए)(?:\s+कि)?\s+(.+)$/,
];

/**
 * A capture that is only a connector word means the regex backtracked past a
 * dangling "remember that" / "yaad rakho ki" — that is no memory, that is a
 * clarify. (firstCapture cannot express this, so memory gets its own matcher.)
 */
const MEMORY_CONNECTOR_WORDS = new Set(['that', 'this', 'it', 'ki', 'ke', 'कि']);

function parseMemory(text: string): MockIntent | null {
  if (MEMORY_RECALL_ALL_RES.some((re) => re.test(text))) return { kind: 'memory_recall_all' };
  for (const re of MEMORY_RECALL_RES) {
    const m = re.exec(text);
    const query = m ? cleanupCapture(m[1] ?? '') : '';
    if (query && !MEMORY_CONNECTOR_WORDS.has(query)) return { kind: 'memory_recall', query };
  }
  for (const re of MEMORY_REMEMBER_RES) {
    const m = re.exec(text);
    const memo = m ? cleanupCapture(m[1] ?? '') : '';
    if (memo && !MEMORY_CONNECTOR_WORDS.has(memo)) return { kind: 'memory_remember', text: memo };
  }
  return null;
}

// 9) lock_workstation — Ultron port row 4 (Windows LockWorkStation).
const LOCK_RES: RegExp[] = [
  /^lock(?:\s+(?:my|the|mera|meri))?\s+(?:computer|pc|laptop|screen|workstation|system)$/,
  /^(?:computer|pc|laptop|screen|workstation|system)\s+lock(?:\s+(?:karo|kar do))?$/,
  /^lockdown$/,
  /^lock(?:\s+(?:karo|kar do))?$/,
  /^(?:स्क्रीन|कंप्यूटर|लैपटॉप|सिस्टम)\s*लॉक(?:\s*करो)?$/,
  /^लॉक(?:\s*करो)?$/,
];

// 10) status_briefing — Ultron port row 6. A standalone `status` word (battery
//     status, status batao, …) or a how-are-you greeting triggers the briefing.
const STATUS_WORD_RE = /(?:^|\s)status(?:\s|$)/;
// Anchored so "ye kaise ho gaya" is not a greeting; small prefix/suffix sets
// keep the natural forms ("kaise ho bhai", "sab kaisa hai").
const STATUS_HOW_RES: RegExp[] = [
  /^how are you(?:\s+doing(?:\s+today)?)?(?:\s+today)?$/,
  /^(?:tum\s+|aap\s+|bhai\s+)?kaise ho(?:\s+(?:bhai|yaar))?$/,
  /^(?:sab\s+)?kaisa hai(?:\s+(?:bhai|yaar|sab))?$/,
  /^(?:tum\s+|aap\s+|भाई\s+)?कैसे हो(?:\s+(?:भाई|आप))?$/,
  /^(?:सब\s+)?कैसा है(?:\s+(?:भाई|सब))?$/,
];

function extractUrl(text: string): string | null {
  const trimTail = (s: string): string => s.replace(/[.,;:!?)\]}'"]+$/, '');
  const absolute = ABSOLUTE_URL_RE.exec(text);
  if (absolute) return toUrl(trimTail(absolute[0]));
  const domain = BARE_DOMAIN_RE.exec(text);
  if (domain) return toUrl(trimTail(domain[0]));
  return null;
}

function toUrl(s: string): string {
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** First capture group of the first matching regex, or null. */
function firstCapture(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const captured = m.length > 1 ? (m[1] ?? '') : m[0];
      const value = cleanupCapture(captured);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * Tokenize for workspace-mode alias matching: lowercase, apostrophes removed
 * (so "let's code" and "lets code" agree), other punctuation becomes a space
 * (Devanagari letters are \p{L} and survive). Word-boundary matching avoids
 * substring false hits like a short alias inside "status".
 */
function tokenizeUtterance(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Does the utterance contain one of the mode's aliases (as whole words, in
 * order)? Modes are checked in settings order, aliases in listed order — the
 * first hit wins, so a user can prioritize by reordering in the panel.
 */
export function matchWorkspaceMode(raw: string, modes: WorkspaceMode[]): WorkspaceMode | null {
  const tokens = tokenizeUtterance(raw);
  if (tokens.length === 0) return null;
  for (const mode of modes) {
    for (const alias of mode.aliases) {
      const aliasTokens = tokenizeUtterance(alias);
      if (aliasTokens.length === 0 || aliasTokens.length > tokens.length) continue;
      let hit = false;
      for (let i = 0; i + aliasTokens.length <= tokens.length; i++) {
        let ok = true;
        for (let j = 0; j < aliasTokens.length; j++) {
          if (tokens[i + j] !== aliasTokens[j]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          hit = true;
          break;
        }
      }
      if (hit) return mode;
    }
  }
  return null;
}

/**
 * Parse one utterance into a MockIntent, or null when nothing matched
 * (the caller replies with a friendly clarification instead).
 * Checks run in priority order: stop → language → opencode → add-todo →
 * reminder → memory → lock → status → url → workspace-mode → launch-app.
 * Specific tools beat the broad alias match (so "remind me to study in 10
 * minutes" stays a reminder even when a mode aliases "study"), and a URL
 * beats a mode whose alias shares the domain ("open movie.com" stays a link).
 * `modes` is the CURRENT settings.workspaceModes (empty → mode matching off).
 */
export function parseIntent(raw: string, modes: WorkspaceMode[] = []): MockIntent | null {
  if (!raw || !raw.trim()) return null;
  const text = normalizeUtterance(raw);

  if (STOP_RE.test(text)) return { kind: 'stop' };

  if (LANG_HI_RE.test(text)) return { kind: 'language_switch', language: 'hi' };
  if (LANG_EN_RE.test(text)) return { kind: 'language_switch', language: 'en' };

  const oc = firstCapture(text, OPENCODE_RES);
  if (oc) return { kind: 'opencode_task', prompt: oc };

  const add = firstCapture(text, ADD_RES);
  if (add) return { kind: 'add_todo', text: add };

  const reminder = parseReminder(text);
  if (reminder) {
    return reminder.text
      ? { kind: 'set_reminder', minutes: reminder.minutes, text: reminder.text }
      : { kind: 'set_reminder', minutes: reminder.minutes, text: '' };
  }

  const memory = parseMemory(text);
  if (memory) return memory;

  if (LOCK_RES.some((re) => re.test(text))) return { kind: 'lock_workstation' };

  if (STATUS_WORD_RE.test(text) || STATUS_HOW_RES.some((re) => re.test(text))) {
    return { kind: 'status_briefing' };
  }

  const url = extractUrl(text);
  if (url) return { kind: 'open_url', url };

  if (modes.length > 0) {
    const mode = matchWorkspaceMode(text, modes);
    if (mode) return { kind: 'workspace_mode', mode: mode.name };
  }

  const app = firstCapture(text, LAUNCH_RES);
  if (app) {
    const alias = cleanupCapture(app.replace(/^(?:the|a|an|mera|meri|apna)\s+/, ''));
    if (alias) return { kind: 'launch_app', alias };
  }

  return null;
}

/** Map a tool-bound intent onto the bridge's tool name + args. */
export function intentToTool(
  intent: MockIntent,
): { tool: ToolName; args: Record<string, unknown> } | null {
  switch (intent.kind) {
    case 'add_todo':
      return { tool: 'notion_add_todo', args: { text: intent.text } };
    case 'launch_app':
      return { tool: 'launch_app', args: { alias: intent.alias } };
    case 'opencode_task':
      return { tool: 'run_opencode_task', args: { prompt: intent.prompt } };
    case 'open_url':
      return { tool: 'open_url', args: { url: intent.url } };
    case 'workspace_mode':
      return { tool: 'workspace_mode', args: { name: intent.mode } };
    case 'set_reminder':
      return { tool: 'set_reminder', args: { minutes: intent.minutes, text: intent.text } };
    case 'lock_workstation':
      return { tool: 'lock_workstation', args: {} };
    case 'status_briefing':
      return { tool: 'status_briefing', args: {} };
    case 'memory_remember':
      return { tool: 'memory', args: { action: 'remember', text: intent.text } };
    case 'memory_recall_all':
      // The memory tool requires a query for `recall`; "what do you remember"
      // wants EVERYTHING → the `list` action (server contract, tools/index).
      return { tool: 'memory', args: { action: 'list' } };
    case 'memory_recall':
      return { tool: 'memory', args: { action: 'recall', text: intent.query } };
    default:
      return null;
  }
}

const PERMISSION_GATES = ['notion', 'launcher', 'terminal', 'browser'] as const;

/**
 * A spoken reply for an ok:false ToolResult. Permission denials get an apology
 * + a Settings hint localized per gate ("Permission denied: <gate>" — the exact
 * 403 shape from src/server/acl.ts); every other failure gets apology + summary.
 */
export function failureReply(lang: Lang, summary: string): string {
  if (/permission denied/i.test(summary)) {
    const gate = summary.split(':').pop()?.trim().toLowerCase() ?? '';
    const key = (PERMISSION_GATES as readonly string[]).includes(gate)
      ? `voice.denied.${gate}`
      : 'voice.denied';
    return t(lang, key);
  }
  return `${t(lang, 'voice.apology')} ${summary || t(lang, 'voice.toolError')}`.trim();
}

function defaultSpeakDuration(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(12_000, Math.max(900, 900 + words * 260));
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class MockProvider implements VoiceProvider, MockVoiceProviderExtras {
  readonly syntheticAmplitude: { current: number } = { current: 0 };

  private state: SessionState = 'idle';
  private language: Lang = 'en';
  private disposed = false;
  private rafId = 0;
  private chain: Promise<void> = Promise.resolve();

  private readonly stateCbs: Array<(s: SessionState) => void> = [];
  private readonly transcriptCbs: Array<(t: TranscriptEntry) => void> = [];

  private readonly bridgeBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly idFactory: () => string;
  private readonly speakMs: (text: string) => number;
  private readonly getWorkspaceModes?: () => WorkspaceMode[];

  constructor(deps: MockProviderDeps = {}) {
    this.bridgeBase = deps.bridgeBase ?? DEFAULT_BRIDGE_BASE;
    this.fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
    this.delay = deps.delay ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    this.random = deps.random ?? Math.random;
    this.idFactory = deps.idFactory ?? (() => globalThis.crypto?.randomUUID?.() ?? `mock-${Date.now()}`);
    this.speakMs = deps.speakDuration ?? defaultSpeakDuration;
    this.getWorkspaceModes = deps.getWorkspaceModes;
  }

  /** Start a fresh session: listening + a friendly greeting (no network). */
  async start(opts: { language: 'en' | 'hi' }): Promise<void> {
    this.disposed = false;
    this.language = opts.language === 'hi' ? 'hi' : 'en';
    this.setSessionState('listening');
    this.emitTranscript({ role: 'agent', text: t(this.language, 'voice.greeting'), ts: Date.now() });
  }

  /** End the session cleanly (plan Review Focus #4): envelope off, state idle. */
  async stop(): Promise<void> {
    this.disposed = true;
    this.stopEnvelope();
    this.setSessionState('idle');
  }

  onState(cb: (s: SessionState) => void): void {
    this.stateCbs.push(cb);
  }

  onTranscript(cb: (t: TranscriptEntry) => void): void {
    this.transcriptCbs.push(cb);
  }

  /** No real TTS in mock mode — nothing to attach; kept for interface parity. */
  attachAudio(_el: HTMLAudioElement | MediaStream): void {
    /* The synthetic envelope (syntheticAmplitude) drives the persona instead. */
  }

  /**
   * Dev/e2e entry point (?dev=1 input in the overlay): the typed text follows
   * the exact same path as recognized speech. Serialized so overlapping inputs
   * don't interleave states.
   */
  submitText(text: string): Promise<void> {
    const run = this.chain.then(() => this.handle(text));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async handle(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text || this.disposed) return;
    this.emitTranscript({ role: 'user', text, ts: Date.now() });

    // listening → thinking (400–900ms) → speaking (plan Task D latency sim).
    this.setSessionState('thinking');
    await this.delay(400 + Math.floor(this.random() * 501));
    if (this.disposed) return; // aborted mid-thinking (stop()) — no zombie tool call

    const intent = parseIntent(text, this.getWorkspaceModes?.() ?? []);
    if (!intent) {
      await this.speak(t(this.language, 'voice.clarify'));
      return;
    }
    if (intent.kind === 'stop') {
      // Session ends cleanly: speak the goodbye, then idle (the overlay hides).
      await this.speak(t(this.language, 'voice.stopReply'), 'idle');
      return;
    }
    if (intent.kind === 'language_switch') {
      this.language = intent.language;
      // Confirm in the NEW language so the user hears the switch took effect.
      await this.speak(t(intent.language, `voice.langSwitched.${intent.language}`));
      return;
    }

    const reply = await this.runTool(intent);
    await this.speak(reply);
  }

  /** Execute a tool via the Local Bridge and speak the returned summary. */
  private async runTool(intent: MockIntent): Promise<string> {
    const mapped = intentToTool(intent);
    if (!mapped) return t(this.language, 'voice.toolError');
    const { tool, args } = mapped;
    try {
      const res = await this.fetchImpl(`${this.bridgeBase}/api/tools/${tool}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: this.idFactory(), tool, args }),
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null; // non-JSON body → generic apology below
      }
      if (body && typeof body === 'object' && 'ok' in body) {
        const result = body as { ok?: unknown; summary?: unknown };
        const summary = typeof result.summary === 'string' ? result.summary : '';
        if (result.ok === true) return summary || t(this.language, 'voice.toolError');
        return failureReply(this.language, summary);
      }
      return t(this.language, 'voice.toolError');
    } catch {
      // Bridge not running (e.g. renderer opened in a plain browser) — degrade, never throw.
      return t(this.language, 'voice.bridgeUnreachable');
    }
  }

  /** speaking state + synthetic amplitude envelope for ~speakMs, then next state. */
  private async speak(text: string, then: SessionState = 'listening'): Promise<void> {
    if (this.disposed) return;
    this.setSessionState('speaking');
    this.emitTranscript({ role: 'agent', text, ts: Date.now() });
    this.startEnvelope();
    await this.delay(this.speakMs(text));
    this.stopEnvelope();
    if (!this.disposed) this.setSessionState(then);
  }

  /** Mouth-like oscillation (adapted from our Phase-1 PersonaHarness mock amplitude). */
  private startEnvelope(): void {
    if (typeof requestAnimationFrame !== 'function') return; // node/test env → flat 0
    const t0 = performance.now();
    const tick = (now: number): void => {
      const s = (now - t0) / 1000;
      const gate = Math.sin(s * 6.3) > -0.2 ? 1 : 0.06;
      const v = (0.3 + 0.25 * Math.sin(s * 7.1) + 0.15 * Math.sin(s * 11.7)) * gate;
      this.syntheticAmplitude.current = Math.min(1, Math.max(0, v));
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopEnvelope(): void {
    if (this.rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.syntheticAmplitude.current = 0;
  }

  private setSessionState(next: SessionState): void {
    if (next === this.state) return;
    this.state = next;
    for (const cb of this.stateCbs) {
      try {
        cb(next);
      } catch {
        /* a broken listener must never break the brain */
      }
    }
  }

  private emitTranscript(entry: TranscriptEntry): void {
    for (const cb of this.transcriptCbs) {
      try {
        cb(entry);
      } catch {
        /* ditto */
      }
    }
  }
}

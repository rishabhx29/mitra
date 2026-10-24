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
import type { SessionState, ToolName, TranscriptEntry, VoiceProvider } from '../shared/types';
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
 * Parse one utterance into a MockIntent, or null when nothing matched
 * (the caller replies with a friendly clarification instead).
 * Checks run in priority order: stop → language → opencode → add-todo →
 * url → launch-app (so "open opencode and build …" never becomes launch_app
 * and "open github.com" never becomes a bogus app alias).
 */
export function parseIntent(raw: string): MockIntent | null {
  if (!raw || !raw.trim()) return null;
  const text = normalizeUtterance(raw);

  if (STOP_RE.test(text)) return { kind: 'stop' };

  if (LANG_HI_RE.test(text)) return { kind: 'language_switch', language: 'hi' };
  if (LANG_EN_RE.test(text)) return { kind: 'language_switch', language: 'en' };

  const oc = firstCapture(text, OPENCODE_RES);
  if (oc) return { kind: 'opencode_task', prompt: oc };

  const add = firstCapture(text, ADD_RES);
  if (add) return { kind: 'add_todo', text: add };

  const url = extractUrl(text);
  if (url) return { kind: 'open_url', url };

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

  constructor(deps: MockProviderDeps = {}) {
    this.bridgeBase = deps.bridgeBase ?? DEFAULT_BRIDGE_BASE;
    this.fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
    this.delay = deps.delay ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    this.random = deps.random ?? Math.random;
    this.idFactory = deps.idFactory ?? (() => globalThis.crypto?.randomUUID?.() ?? `mock-${Date.now()}`);
    this.speakMs = deps.speakDuration ?? defaultSpeakDuration;
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

    const intent = parseIntent(text);
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

// MockProvider — the offline voice brain (mock mode is first-class: AGENTS.md +
// plan Global Constraints "never throw on missing keys").
//
// - NO network for understanding: intents are parsed locally with regexes over
//   English, Hindi (Devanagari) and Hinglish (romanized). The pure parsing
//   layer lives in ./intents (re-exported below) so the main-process bridge can
//   share the exact same regexes without importing DOM-typed code.
// - Tool execution goes through the Local Bridge HTTP API exactly like the real
//   brain would (POST /api/tools/:name); HTTP 403 also carries a ToolResult
//   body, so permission denials surface as a spoken apology + Settings hint
//   (plan Review Focus #2) — never a throw.
// - Decision tier (docs/DECISION_TIER_PLAN.md §1): when the deterministic
//   parser misses, this provider asks the bridge's POST /api/brain/route
//   (server-side parseIntent + the optional Laya sidecar) before clarifying.
// - Simulated latency: listening → thinking (400–900ms) → speaking, with a
//   synthetic speech envelope during speaking so the persona animates without
//   real TTS (rAF-guarded: flat 0 under vitest's node environment).
import type { SessionState, TranscriptEntry, VoiceProvider, WorkspaceMode } from '../shared/types';
import { t, type Lang } from '../i18n';
import type { MockIntent, MockVoiceProviderExtras } from './types';
import { DEFAULT_BRIDGE_BASE } from './types';
import { failureReply, fetchRouteDecision, intentToTool, parseIntent } from './intents';

// Pure parsing layer — re-exported so existing './mockProvider' and '../voice'
// imports keep working (the class below is the only DOM-typed code here).
export {
  AGENDA_RES,
  APP_TASK_RES,
  bareSearchQuery,
  NOTE_ARG_RES,
  YOUTUBE_ARG_RES,
  failureReply,
  fetchRouteDecision,
  intentToTool,
  matchWorkspaceMode,
  normalizeUtterance,
  parseAppTask,
  parseIntent,
  parseLaunchAlias,
  parseReminder,
  extractUrl,
  ROUTE_TIMEOUT_MS,
  type RouteDecisionLite,
} from './intents';

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
      // Decision tier (docs/DECISION_TIER_PLAN.md §1): deterministic parser
      // missed → the bridge route (server-side parseIntent + optional Laya).
      // Any failure degrades to the pre-existing clarify — fast path stays fast.
      const routed = await fetchRouteDecision({
        bridgeBase: this.bridgeBase,
        fetchImpl: this.fetchImpl,
        text,
      });
      if (this.disposed) return; // aborted mid-route — no zombie tool call
      if (routed) {
        await this.speak(await this.runToolArgs(routed.tool, routed.args));
        return;
      }
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
    if (intent.kind === 'identity') {
      // Self-introduction — no tool, no chat round-trip needed.
      await this.speak(t(this.language, 'voice.identityReply'));
      return;
    }

    const reply = await this.runTool(intent);
    await this.speak(reply);
  }

  /** Execute a tool-bound intent via the Local Bridge and speak the returned summary. */
  private async runTool(intent: MockIntent): Promise<string> {
    const mapped = intentToTool(intent);
    if (!mapped) return t(this.language, 'voice.toolError');
    return this.runToolArgs(mapped.tool, mapped.args);
  }

  /** Execute an already-resolved tool name + args (intent path AND route tier). */
  private async runToolArgs(tool: string, args: Record<string, unknown>): Promise<string> {
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

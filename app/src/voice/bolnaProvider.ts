// BolnaProvider — the real voice brain via @bolna/web-call (WebRTC/SIP in the
// renderer; MIT license). Sessions are minted by the Local Bridge
// (POST /api/session proxies Bolna's /web-call/freeswitch-session with the bn-
// API key) so the key never reaches the renderer (plan Global Constraints).
//
// SDK facts verified against node_modules/@bolna/web-call/dist/index.d.ts (v3.0.1):
//   - constructor takes {sessionUrl | getSession | session, userData, audioElement, …};
//     sessionUrl is OUR bridge route — the SDK POSTs {"user_data": …} there and the
//     bridge forwards it upstream with the agent language (bridge.ts Task D edit).
//   - events: state-change / call-start / call-end / error / media-permission /
//     volume-level. There are NO transcript events in v3.0.1, so live STT/LLM
//     captions for real calls are not available from this SDK — captions get
//     status + tool-result events (forwarded over mitra:session-event) instead.
//   - a pre-fetched `session` is single-use and short-lived → used for the first
//     start() only; later starts re-mint via sessionUrl.
// start() must run from a user gesture where autoplay policy requires one
// (Electron's default policy does not; browser dev may — the overlay's
// click-the-orb retry covers that, see SessionController).
import {
  BolnaWebCall,
  type BolnaWebCallOptions,
  type CallError,
  type CallState,
  type Session as BolnaSession,
} from '@bolna/web-call';
import type { SessionState, TranscriptEntry, VoiceProvider } from '../shared/types';
import { t } from '../i18n';
import { DEFAULT_BRIDGE_BASE, type BolnaVoiceProviderExtras } from './types';

/** Above this remote level the agent counts as "speaking" (volume-level ~10Hz). */
const AGENT_TALK_THRESHOLD = 0.12;
/** Quiet span after which the agent counts as done talking (back to listening). */
const AGENT_QUIET_MS = 700;

export interface BolnaProviderDeps {
  bridgeBase?: string;
  /** Defaults to `${bridgeBase}/api/session` — the Local Bridge mint route. */
  sessionUrl?: string;
  /** Pre-minted session from createVoiceProvider's probe; consumed on first start. */
  session?: BolnaSession | null;
  /** Extra dynamic variables forwarded to the agent prompt (SDK userData). */
  userData?: Record<string, unknown>;
  debug?: boolean;
}

export class BolnaProvider implements VoiceProvider, BolnaVoiceProviderExtras {
  readonly agentAmplitude: { current: number } = { current: 0 };

  private call: BolnaWebCall | null = null;
  private pendingSession: BolnaSession | null;
  private playbackEl: HTMLAudioElement | null = null;
  private language: 'en' | 'hi' = 'en';
  private state: SessionState = 'idle';
  private callState: CallState = 'idle';
  private talking = false;
  private lastLoudAt = 0;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly stateCbs: Array<(s: SessionState) => void> = [];
  private readonly transcriptCbs: Array<(t: TranscriptEntry) => void> = [];

  constructor(private readonly deps: BolnaProviderDeps = {}) {
    this.pendingSession = deps.session ?? null;
  }

  /** Start a call (mints a fresh session when the probe one is spent). */
  async start(opts: { language: 'en' | 'hi' }): Promise<void> {
    this.language = opts.language === 'hi' ? 'hi' : 'en';
    if (this.call) {
      const previous = this.call;
      this.call = null;
      try {
        await previous.stop(); // idempotent per the SDK d.ts
      } catch {
        /* keep starting the new call regardless */
      }
    }

    const options: BolnaWebCallOptions = {
      userData: { language: this.language, ...(this.deps.userData ?? {}) },
      debug: this.deps.debug ?? false,
    };
    if (this.pendingSession) {
      options.session = this.pendingSession;
      this.pendingSession = null;
    } else {
      options.sessionUrl =
        this.deps.sessionUrl ?? `${this.deps.bridgeBase ?? DEFAULT_BRIDGE_BASE}/api/session`;
    }
    if (this.playbackEl) options.audioElement = this.playbackEl;

    const call = new BolnaWebCall(options);
    this.call = call;
    call.on('state-change', (st) => this.onCallState(st));
    call.on('call-start', () => {
      this.emitTranscript({ role: 'system', text: t(this.language, 'voice.connected'), ts: Date.now() });
    });
    call.on('call-end', () => {
      this.talking = false;
      this.agentAmplitude.current = 0;
      this.emitTranscript({ role: 'system', text: t(this.language, 'voice.callEnded'), ts: Date.now() });
      this.setSessionState('idle');
    });
    call.on('error', (err) => this.onError(err));
    call.on('volume-level', (level) => this.onVolume(level));
    await call.start();
  }

  /** Hang up + release; safe from any state (SDK stop is idempotent). */
  async stop(): Promise<void> {
    if (this.quietTimer) {
      clearTimeout(this.quietTimer);
      this.quietTimer = null;
    }
    this.talking = false;
    this.agentAmplitude.current = 0;
    const call = this.call;
    this.call = null;
    if (call) {
      try {
        await call.stop();
      } catch {
        /* already torn down */
      }
    }
    this.setSessionState('idle');
  }

  onState(cb: (s: SessionState) => void): void {
    this.stateCbs.push(cb);
  }

  onTranscript(cb: (t: TranscriptEntry) => void): void {
    this.transcriptCbs.push(cb);
  }

  /**
   * Hand the UI's audio element to the provider: it becomes the SDK's playback
   * element, so the UI's single shared analyser (one MediaElementSource per
   * element — Phase-1 integration fact) sees the agent audio at 60fps. A
   * MediaStream is routed through an (unappended) <audio> element the same way;
   * echo policy stays with the caller (mic streams must not be played aloud).
   */
  attachAudio(el: HTMLAudioElement | MediaStream): void {
    if (el instanceof HTMLAudioElement) {
      this.playbackEl = el;
      return;
    }
    try {
      const audio = this.playbackEl ?? document.createElement('audio');
      audio.srcObject = el;
      void audio.play().catch(() => undefined); // no gesture → may be blocked; volume-level still works
      this.playbackEl = audio;
    } catch {
      /* degrade: the SDK's 'volume-level' feed still animates the persona */
    }
  }

  // ---- event mapping -------------------------------------------------------

  private onCallState(st: CallState): void {
    this.callState = st;
    switch (st) {
      case 'connecting':
      case 'ringing':
        this.setSessionState('thinking');
        break;
      case 'active':
        this.setSessionState(this.talking ? 'speaking' : 'listening');
        break;
      case 'idle':
      case 'ended':
        this.setSessionState('idle');
        break;
    }
  }

  private onError(err: CallError): void {
    const detail =
      err.code === 'microphone_denied'
        ? t(this.language, 'voice.err.microphone_denied')
        : err.code === 'autoplay_blocked'
          ? t(this.language, 'voice.err.autoplay_blocked')
          : `${t(this.language, 'voice.err.generic')} (${err.code}: ${err.message})`;
    this.emitTranscript({ role: 'system', text: detail, ts: Date.now() });
    this.setSessionState('error');
  }

  /** volume-level → agentAmplitude box + a speaking/listening heuristic. */
  private onVolume(level: number): void {
    const v = Math.min(1, Math.max(0, level));
    this.agentAmplitude.current = v;
    if (!this.call) return;
    if (v > AGENT_TALK_THRESHOLD) {
      this.lastLoudAt = Date.now();
      if (!this.talking) {
        this.talking = true;
        this.emitForActive();
      }
    }
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      if (this.talking && Date.now() - this.lastLoudAt >= AGENT_QUIET_MS) {
        this.talking = false;
        this.emitForActive();
      }
    }, AGENT_QUIET_MS + 60);
  }

  private emitForActive(): void {
    if (this.callState === 'active') {
      this.setSessionState(this.talking ? 'speaking' : 'listening');
    }
  }

  private setSessionState(next: SessionState): void {
    if (next === this.state) return;
    this.state = next;
    for (const cb of this.stateCbs) {
      try {
        cb(next);
      } catch {
        /* a broken listener must never break the call */
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

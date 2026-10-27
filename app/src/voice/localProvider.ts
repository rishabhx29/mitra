// LocalVoiceProvider — free-forever, offline voice brain:
//   STT  : Vosk small models via vosk-browser WASM (model zip served by the
//          local bridge from userData/models — free, on-device, 14 languages)
//   Brain: deterministic intents first (mockProvider's parser → Local Bridge
//          tools), conversation via /api/brain/chat (Ollama tier-1, mock tier-2)
//   TTS  : OS speechSynthesis voices (free, offline, per-language)
// The orb/avatar reacts through syntheticAmplitude (same envelope contract as
// MockProvider — speechSynthesis audio is not exposed to WebAudio analysers).
import type { TranscriptEntry, SessionState, VoiceProvider, WorkspaceMode } from '../shared/types';
import { findVoiceLanguage } from '../shared/voiceLanguages';
import { parseIntent, intentToTool, failureReply } from './mockProvider';
import { t, type Lang } from '../i18n';

/** Vosk surface this provider consumes (vosk-browser 0.0.8: Model.KaldiRecognizer). */
export interface VoskRecognizerLike {
  on(event: 'result', cb: (m: { result?: { text?: string } }) => void): void;
  acceptWaveformFloat(chunk: Float32Array, sampleRate: number): void;
  remove(): void;
}

export interface VoskModelLike {
  KaldiRecognizer: new (sampleRate: number) => VoskRecognizerLike;
  terminate(): void;
}

export interface LocalProviderDeps {
  /** Base URL of the Local Bridge (session/tools/models/brain). */
  bridgeBase?: string;
  /** Current voice language id (Settings.voiceLanguage). */
  getLanguage?: () => string;
  /** Live Settings.workspaceModes for the workspace-mode intent. */
  getWorkspaceModes?: () => WorkspaceMode[];
  fetchImpl?: typeof fetch;
  /** Injected for tests (node env has no speechSynthesis/mic). */
  tts?: {
    speak(text: string, lang: string, onEnd: () => void): void;
    cancel(): void;
  };
  /** Injected for tests: returns a Vosk-like model whose KaldiRecognizer feeds from the audio loop. */
  createModel?: (modelUrl: string) => Promise<VoskModelLike>;
  mediaDevices?: { getUserMedia(constraints: { audio: true }): Promise<MediaStream> };
  /** Test hook: shrink the thinking pause + no-TTS speak duration. */
  fastTimers?: boolean;
  log?: (msg: string) => void;
}

interface AudioContextLike {
  sampleRate: number;
  constructor?: unknown;
  createMediaStreamSource(stream: MediaStream): { connect(node: unknown): void };
  createScriptProcessor(size: number, inCh: number, outCh: number): {
    onaudioprocess: (e: { inputBuffer: { getChannelData(c: number): Float32Array } } & Record<string, unknown>) => void;
    connect(dest: unknown): void;
  };
  close(): Promise<void>;
  destination: unknown;
}

const OS_TTS = {
  speak(text: string, lang: string, onEnd: () => void): void {
    const synth = window.speechSynthesis;
    if (!synth) {
      onEnd();
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = 1.05;
    const voices = synth.getVoices();
    const voice =
      voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(lang.split('-')[0].toLowerCase()));
    if (voice) utter.voice = voice;
    utter.onend = () => onEnd();
    utter.onerror = () => onEnd();
    synth.speak(utter);
  },
  cancel(): void {
    window.speechSynthesis?.cancel();
  },
};

export class LocalVoiceProvider implements VoiceProvider {
  readonly syntheticAmplitude = { current: 0 };
  private stateCbs: Array<(s: SessionState) => void> = [];
  private transcriptCbs: Array<(e: TranscriptEntry) => void> = [];
  private chain: Promise<void> = Promise.resolve();
  private disposed = false; // stop() flips it; submitText works pre-start (typed path)
  private lang: Lang = 'en';
  private micStream: MediaStream | null = null;
  private audioCtx: AudioContextLike | null = null;
  private recognizer: VoskRecognizerLike | null = null;
  private model: VoskModelLike | null = null;
  private envelopeTimer: number | null = null;
  private readonly d: Required<Pick<LocalProviderDeps, 'bridgeBase' | 'fetchImpl' | 'tts' | 'log'>> &
    LocalProviderDeps;

  constructor(deps: LocalProviderDeps = {}) {
    this.d = {
      bridgeBase: deps.bridgeBase ?? 'http://127.0.0.1:8765',
      fetchImpl: deps.fetchImpl ?? ((url, init) => fetch(url, init)),
      tts: deps.tts ?? OS_TTS,
      log: deps.log ?? (() => {}),
      ...deps,
    };
  }

  private setSessionState(next: SessionState): void {
    for (const cb of this.stateCbs) {
      try {
        cb(next);
      } catch {
        /* a broken subscriber must not kill the session */
      }
    }
  }

  private emit(entry: TranscriptEntry): void {
    for (const cb of this.transcriptCbs) {
      try {
        cb(entry);
      } catch {
        /* ignore */
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, this.d.fastTimers ? Math.min(ms, 10) : ms));
  }

  onState(cb: (s: SessionState) => void): void {
    this.stateCbs.push(cb);
  }

  onTranscript(cb: (e: TranscriptEntry) => void): void {
    this.transcriptCbs.push(cb);
  }

  attachAudio(): void {
    /* envelope-driven — same reasoning as MockProvider */
  }

  async start(): Promise<void> {
    const voiceLang = findVoiceLanguage(this.d.getLanguage?.());
    // Hinglish UX stays: hi voice also understands romanized phrases via the
    // intent parser; UI language (this.lang) stays en/hi per i18n support.
    this.lang = voiceLang.ttsLang.startsWith('hi') ? 'hi' : 'en';
    this.disposed = false;
    this.setSessionState('listening');

    // 1) model (downloads on first use — bridge streams the zip to vosk)
    const ensureRes = await this.d.fetchImpl(`${this.d.bridgeBase}/api/models/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: voiceLang.id }),
    }).catch(() => null);
    if (this.disposed) return;
    if (!ensureRes || !ensureRes.ok) {
      throw new Error('model-unavailable');
    }

    // 2) recognizer + mic loop (vosk-browser: createModel → new model.KaldiRecognizer)
    const createModel: (url: string) => Promise<VoskModelLike> =
      this.d.createModel ?? ((await import('vosk-browser')).createModel as (url: string) => Promise<VoskModelLike>);
    const model = await createModel(`${this.d.bridgeBase}/api/models/file/${voiceLang.id}`);
    if (this.disposed) {
      model.terminate();
      return;
    }
    this.model = model;
    const recognizer = new model.KaldiRecognizer(16000);
    this.recognizer = recognizer;
    recognizer.on('result', (m) => {
      const text = m.result?.text?.trim();
      if (text) void this.submitText(text);
    });

    // Mic acquisition works in both environments (injected fake in tests);
    // the WebAudio pump is renderer-only (window guard).
    const media = this.d.mediaDevices ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined);
    if (!media) {
      this.emit({ role: 'agent', text: t(this.lang, 'voice.greeting'), ts: Date.now() });
      return;
    }
    this.micStream = await media.getUserMedia({ audio: true });
    const hasWindowAudio = typeof window !== 'undefined' && 'AudioContext' in window;
    if (hasWindowAudio) {
      const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as unknown as new (opts?: { sampleRate?: number }) => AudioContextLike;
      const ctx = new Ctor({ sampleRate: 16000 });
      this.audioCtx = ctx;
      const src = ctx.createMediaStreamSource(this.micStream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const sampleRate = ctx.sampleRate || 16000;
      node.onaudioprocess = (e) => {
        if (this.recognizer && !this.disposed) {
          this.recognizer.acceptWaveformFloat(e.inputBuffer.getChannelData(0), sampleRate);
        }
      };
      src.connect(node);
      node.connect(ctx.destination);
    }
    this.emit({ role: 'agent', text: t(this.lang, 'voice.greeting'), ts: Date.now() });

    this.emit({ role: 'agent', text: t(this.lang, 'voice.greeting'), ts: Date.now() });
  }

  async stop(): Promise<void> {
    this.disposed = true;
    this.stopEnvelope();
    this.d.tts.cancel();
    this.recognizer?.remove();
    this.recognizer = null;
    this.model?.terminate();
    this.model = null;
    try {
      this.micStream?.getTracks().forEach((tr) => tr.stop());
    } catch {
      /* ignore */
    }
    this.micStream = null;
    try {
      await this.audioCtx?.close();
    } catch {
      /* ignore */
    }
    this.audioCtx = null;
    this.setSessionState('idle');
  }

  /** Typed/e2e path — same pipeline recognized speech takes. Serialized. */
  submitText(text: string): Promise<void> {
    const run = this.handle(text.trim());
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async handle(raw: string): Promise<void> {
    if (!raw || this.disposed) return;
    this.emit({ role: 'user', text: raw, ts: Date.now() });
    this.setSessionState('thinking');
    await this.delay(400 + Math.floor(Math.random() * 400));
    if (this.disposed) return;

    const intent = parseIntent(raw, this.d.getWorkspaceModes?.() ?? []);
    if (intent?.kind === 'stop') {
      await this.speak(t(this.lang, 'voice.stopReply'));
      this.setSessionState('idle');
      return;
    }
    if (intent?.kind === 'language_switch') {
      await this.speak(t(intent.language, `voice.langSwitched.${intent.language}`));
      return;
    }

    let reply: string;
    const mapped = intent ? intentToTool(intent) : null;
    if (mapped) {
      reply = await this.runTool(mapped.tool, mapped.args);
    } else {
      reply = await this.chat(raw);
    }
    await this.speak(reply);
  }

  private async runTool(tool: string, args: Record<string, unknown>): Promise<string> {
    try {
      const res = await this.d.fetchImpl(`${this.d.bridgeBase}/api/tools/${tool}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: `local-${Date.now()}`, tool, args }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; summary?: string } | null;
      if (body && typeof body === 'object' && 'ok' in body) {
        if (body.ok === true) return body.summary || t(this.lang, 'voice.toolError');
        return failureReply(this.lang, body.summary ?? '');
      }
      return t(this.lang, 'voice.toolError');
    } catch {
      return t(this.lang, 'voice.bridgeUnreachable');
    }
  }

  private async chat(text: string): Promise<string> {
    try {
      const res = await this.d.fetchImpl(`${this.d.bridgeBase}/api/brain/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: text }], language: this.lang }),
        signal: AbortSignal.timeout(12000),
      });
      const body = (await res.json().catch(() => null)) as { text?: string } | null;
      return body?.text?.trim() || t(this.lang, 'voice.clarify');
    } catch {
      return t(this.lang, 'voice.clarify');
    }
  }

  private speak(text: string): Promise<void> {
    this.emit({ role: 'agent', text, ts: Date.now() });
    this.setSessionState('speaking');
    this.startEnvelope();
    const voiceLang = findVoiceLanguage(this.d.getLanguage?.());
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        this.stopEnvelope();
        if (!this.disposed) this.setSessionState('listening');
        resolve();
      };
      // Real TTS resolves on utterance end; hard cap guards a silent voice.
      const capMs = this.d.fastTimers ? 30 : Math.max(2500, text.length * 90);
      const cap = setTimeout(finish, capMs);
      this.d.tts.speak(text, voiceLang.ttsLang, () => {
        clearTimeout(cap);
        finish();
      });
    });
  }

  private startEnvelope(): void {
    if (typeof requestAnimationFrame !== 'function') return;
    const t0 = performance.now();
    const tick = (now: number): void => {
      const s = (now - t0) / 1000;
      const gate = Math.sin(s * 6.3) > -0.2 ? 1 : 0.06;
      this.syntheticAmplitude.current = Math.min(1, Math.max(0, (0.3 + 0.25 * Math.sin(s * 7.1) + 0.15 * Math.sin(s * 11.7)) * gate));
      if (!this.disposed) this.envelopeTimer = requestAnimationFrame(tick);
    };
    this.envelopeTimer = requestAnimationFrame(tick);
  }

  private stopEnvelope(): void {
    if (this.envelopeTimer && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.envelopeTimer);
    this.envelopeTimer = null;
    this.syntheticAmplitude.current = 0;
  }
}

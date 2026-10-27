// SessionController — the live overlay conversation (plan Task D).
//
// Owns the VoiceProvider lifecycle (createVoiceProvider on mount → start with
// the settings language), the transcript list, and the ONE shared amplitude
// path: a single useAudioAnalyser on the hidden <audio> element (one
// MediaElementSource per element — Phase-1 integration fact) merged with the
// provider's amplitude box (mock envelope / Bolna volume-level) into one ref
// that drives orb AND avatar via PersonaStage's amplitudeRef.
//
// Dismissal: Escape or click-outside → window.mitra.hideOverlay() (works after
// clicking the orb; the global hotkey always dismisses from the main side).
// A session that reaches `idle` after having been active hides itself after a
// beat (stop intent / Bolna call-end).
//
// Dev/e2e affordance: with ?dev=1 in the URL a tiny text input feeds typed
// commands through the mock brain's exact intent path (stable selector:
// [data-testid="mitra-dev-input"]).
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { SessionState, Settings, TranscriptEntry, VoiceProvider, WorkspaceMode } from '../shared/types';
import { PersonaStage } from '../persona/PersonaStage';
import { useAudioAnalyser } from '../persona/orb/useAudioAnalyser';
import { BolnaProvider, LocalVoiceProvider, MockProvider, createVoiceProvider } from '../voice';
import { t } from '../i18n';
import { Captions } from './Captions';
import { decideInactivity } from './timeout';

/** Subtle state ring: border + glow color per SessionState. */
const STATE_RING: Record<SessionState, { border: string; glow: string }> = {
  idle: { border: 'rgba(113,113,122,0.55)', glow: 'rgba(113,113,122,0.22)' },
  listening: { border: 'rgba(56,189,248,0.85)', glow: 'rgba(56,189,248,0.30)' },
  thinking: { border: 'rgba(251,191,36,0.85)', glow: 'rgba(251,191,36,0.30)' },
  speaking: { border: 'rgba(167,139,250,0.85)', glow: 'rgba(167,139,250,0.32)' },
  error: { border: 'rgba(248,113,113,0.85)', glow: 'rgba(248,113,113,0.38)' },
};

const MAX_ENTRIES = 20;

function dismissOverlay(): void {
  try {
    window.mitra?.hideOverlay();
  } catch {
    /* plain-browser dev: no preload — nothing to hide */
  }
}

export interface SessionControllerProps {
  settings: Settings;
  devMode?: boolean;
}

export function SessionController({ settings, devMode = false }: SessionControllerProps) {
  const [state, setState] = useState<SessionState>('idle');
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [devText, setDevText] = useState('');
  // Persisted avatar (Settings.avatarVrmPath) as a blob URL, so the summon
  // circle shows the user's chosen persona — not just the settings preview.
  const [vrmUrl, setVrmUrl] = useState<string | null>(null);

  const providerRef = useRef<VoiceProvider | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const mockAmpBox = useRef<{ current: number } | null>(null);
  const bolnaAmpBox = useRef<{ current: number } | null>(null);
  const localAmpBox = useRef<{ current: number } | null>(null);

  // Inactivity clock (docs/DESIGN_BRIEF.md §Overlay): when the current state
  // began. Re-armed on every state change and on every user transcript, so
  // decideInactivity() sees "ms since the session entered listening (or since
  // the user last spoke)" / "ms since thinking began".
  const stateRef = useRef<SessionState>('idle');
  stateRef.current = state;
  const stateSinceRef = useRef(Date.now());

  // ONE analyser for the whole overlay (orb + avatar both read its ref).
  const analyserRef = useAudioAnalyser(audioElRef);
  const driveRef = useRef(0);

  const language = settings.language;
  const languageRef = useRef(language);
  languageRef.current = language;
  const voiceLangRef = useRef(settings.voiceLanguage);
  voiceLangRef.current = settings.voiceLanguage;

  // Current workspace presets for the mock brain's workspace_mode intent
  // (ref keeps live panel edits visible without rebuilding the provider).
  const modesRef = useRef<WorkspaceMode[]>(settings.workspaceModes ?? []);
  modesRef.current = settings.workspaceModes ?? [];

  const dismiss = useCallback(dismissOverlay, []);

  // ---- persisted avatar: pull bytes via the idempotent IPC copy, make a blob URL ----
  useEffect(() => {
    if (settings.persona !== 'avatar' || !settings.avatarVrmPath || !window.mitra) return;
    let url: string | null = null;
    let disposed = false;
    void window.mitra
      .setAvatarFile({ kind: 'pick', sourcePath: settings.avatarVrmPath })
      .then((res) => {
        if (!disposed && res.ok) {
          url = URL.createObjectURL(new Blob([res.bytes], { type: 'model/gltf-binary' }));
          setVrmUrl(url);
        }
      })
      .catch(() => {
        /* avatar stays null -> PersonaStage shows its empty state */
      });
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [settings.persona, settings.avatarVrmPath]);

  // ---- provider lifecycle (mount → start; language change → fresh provider) ----
  useEffect(() => {
    let disposed = false;
    setEntries([]); // StrictMode remounts must not double the greeting
    void createVoiceProvider({
      language,
      getWorkspaceModes: () => modesRef.current,
      getVoiceLanguage: () => voiceLangRef.current,
    }).then((provider) => {
      if (disposed) {
        void provider.stop();
        return;
      }
      providerRef.current = provider;
      if (provider instanceof MockProvider) mockAmpBox.current = provider.syntheticAmplitude;
      else if (provider instanceof BolnaProvider) bolnaAmpBox.current = provider.agentAmplitude;
      else if (provider instanceof LocalVoiceProvider) localAmpBox.current = provider.syntheticAmplitude;
      provider.onState(setState);
      provider.onTranscript((entry) => {
        if (entry.role === 'user') stateSinceRef.current = Date.now(); // speech re-arms the no-speech window
        setEntries((prev) => [...prev.slice(-MAX_ENTRIES + 1), entry]);
        // Full-transcript pipe (UI-polish wave): the circle shows only the newest
        // agent/system reply, so every provider entry is reported to main for the
        // settings window's Conversation log (mitra:report-transcript).
        window.mitra?.reportTranscript(entry);
      });
      if (audioElRef.current) provider.attachAudio(audioElRef.current);
      // With the shell present, the session lifecycle is summon-driven: the overlay
      // window is created hidden at boot, and overlay-shown/hidden IPC (hotkey) is
      // what starts/stops sessions — nothing runs invisibly. Plain-browser dev
      // (no preload) keeps the old mount-start so the harness works without Electron.
      if (!window.mitra) {
        provider.start({ language }).catch((err: unknown) => {
        // Mic-less machines / failed model downloads fall back to the mock
        // brain (mock-mode rule) instead of a dead error ring.
        if (provider instanceof LocalVoiceProvider && !disposed) {
          const fb = new MockProvider({ getWorkspaceModes: () => modesRef.current });
          fb.onState(setState);
          fb.onTranscript((entry) => setEntries((prev) => [...prev.slice(-MAX_ENTRIES + 1), entry]));
          if (audioElRef.current) fb.attachAudio(audioElRef.current);
          mockAmpBox.current = fb.syntheticAmplitude;
          providerRef.current = fb;
          void fb.start({ language }).catch(() => setState('error'));
        } else {
          setState('error');
        }
        console.warn('[mitra] voice provider start failed:', err);
      });
      }
    });
    return () => {
      disposed = true;
      const p = providerRef.current;
      providerRef.current = null;
      mockAmpBox.current = null;
      bolnaAmpBox.current = null;
      if (p) void p.stop();
    };
  }, [language]);

  // ---- summon-driven sessions: hotkey summon starts fresh, dismiss stops ----
  useEffect(() => {
    if (typeof window === 'undefined' || !window.mitra) return;
    const offShown = window.mitra.onOverlayShown(() => {
      const p = providerRef.current;
      if (!p) return;
      setEntries([]); // each summon is a fresh conversation
      p.start({ language: languageRef.current }).catch(() => setState('error'));
    });
    const offHidden = window.mitra.onOverlayHidden(() => {
      void providerRef.current?.stop();
    });
    return () => {
      offShown();
      offHidden();
    };
  }, []);

  // ---- 60fps amplitude merge: analyser ∨ mock envelope ∨ Bolna volume-level ----
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      driveRef.current = Math.max(
        analyserRef.current ?? 0,
        mockAmpBox.current?.current ?? 0,
        bolnaAmpBox.current?.current ?? 0,
        localAmpBox.current?.current ?? 0,
      );
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyserRef]);

  // ---- bridge session events (tool-progress forwarded by main as tool-result) ----
  useEffect(() => {
    if (typeof window === 'undefined' || !window.mitra) return;
    return window.mitra.onSessionEvent((ev) => {
      if (ev.kind === 'state') {
        setState(ev.state);
      } else if (ev.kind === 'transcript') {
        if (ev.entry.role === 'user') stateSinceRef.current = Date.now();
        setEntries((prev) => [...prev.slice(-MAX_ENTRIES + 1), ev.entry]);
      } else {
        setEntries((prev) => [
          ...prev.slice(-MAX_ENTRIES + 1),
          { role: 'system', text: ev.result.summary, ts: Date.now() },
        ]);
      }
    });
  }, []);

  // ---- session ended cleanly (stop intent / call end) → hide after a beat ----
  const prevStateRef = useRef<SessionState>('idle');
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (state === 'idle' && prev !== 'idle') {
      const timer = setTimeout(dismiss, 900);
      return () => clearTimeout(timer);
    }
  }, [state, dismiss]);

  // ---- inactivity timeouts (docs/DESIGN_BRIEF.md §Overlay) ----
  // Pure policy lives in timeout.ts (unit-tested); this effect only wires the
  // wall clock: every 500ms ask "how long have we been in this state?" and act
  // on the decision. Each state change re-arms the clock; user speech re-arms
  // it too (see the transcript handlers above).
  useEffect(() => {
    if (state === 'idle' || state === 'error') return; // nothing can hang there
    stateSinceRef.current = Date.now();
    const interval = setInterval(() => {
      const action = decideInactivity(stateRef.current, Date.now() - stateSinceRef.current);
      if (action === 'none') return;
      const p = providerRef.current;
      if (!p) {
        clearInterval(interval); // no live session to stop — don't note-spam
        return;
      }
      if (action === 'no-speech') {
        // System note → stop → the provider drops to idle → the existing
        // idle→hide path above dismisses the overlay.
        setEntries((prev) => [
          ...prev.slice(-MAX_ENTRIES + 1),
          { role: 'system', text: t(languageRef.current, 'overlay.noSpeech'), ts: Date.now() },
        ]);
        void p.stop();
      } else {
        // thinking hung: error note + red state now, stop shortly after — but
        // only if we are still in that error episode (the user may have
        // dismissed and re-summoned inside the delay).
        setEntries((prev) => [
          ...prev.slice(-MAX_ENTRIES + 1),
          {
            role: 'system',
            text: t(languageRef.current, 'overlay.thinkingTimeout'),
            ts: Date.now(),
          },
        ]);
        setState('error');
        setTimeout(() => {
          if (stateRef.current !== 'error') return;
          void p.stop();
          // Dismissal normally rides the provider's idle→hide path; guarantee
          // it even if the provider never reports idle (hung Bolna session).
          setTimeout(() => {
            if (stateRef.current !== 'idle') dismiss();
          }, 400);
        }, 1200);
      }
      clearInterval(interval); // fire at most once per state episode
    }, 500);
    return () => clearInterval(interval);
  }, [state, dismiss]);

  // ---- Escape dismisses (main also has a before-input-event safety net) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  // ---- orb click: retry after an error (also satisfies autoplay gestures) ----
  const onOrbClick = (): void => {
    const p = providerRef.current;
    if (!p || state !== 'error') return;
    p.start({ language: languageRef.current }).catch(() => setState('error'));
  };

  // ---- dev text input (?dev=1) → the same intent path as speech ----
  const submitDev = (e: FormEvent): void => {
    e.preventDefault();
    const text = devText.trim();
    if (!text) return;
    setDevText('');
    const p = providerRef.current;
    if (p instanceof MockProvider) {
      void p.submitText(text);
    } else {
      setEntries((prev) => [
        ...prev.slice(-MAX_ENTRIES + 1),
        { role: 'system', text: t(language, 'voice.devInputUnsupported'), ts: Date.now() },
      ]);
    }
  };

  const ring = STATE_RING[state];

  return (
    <div
      className="h-full w-full overflow-hidden bg-transparent"
      onClick={dismiss}
      data-testid="mitra-overlay-root"
    >
      <div
        className="relative m-[6px] h-[calc(100%-12px)] w-[calc(100%-12px)] overflow-hidden rounded-full border-2"
        style={{
          borderColor: ring.border,
          boxShadow: `0 0 22px ${ring.glow}, inset 0 0 14px ${ring.glow}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* persona fills the circle; the parent's rounded-full clips it */}
        <div className="absolute inset-0" onClick={onOrbClick}>
          <PersonaStage
            persona={settings.persona}
            state={state}
            colors={settings.orbColors}
            amplitudeRef={driveRef}
            vrmUrl={vrmUrl}
          />
        </div>

        <Captions entries={entries} state={state} lang={language} />

        {devMode && (
          <form className="absolute inset-x-3 bottom-[54px] z-10" onSubmit={submitDev}>
            <input
              data-testid="mitra-dev-input"
              value={devText}
              onChange={(e) => setDevText(e.target.value)}
              placeholder={t(language, 'overlay.devPlaceholder')}
              spellCheck={false}
              className="w-full rounded-full border border-white/20 bg-black/60 px-2 py-1 text-center text-[10px] text-white outline-none placeholder:text-zinc-400 focus:border-sky-400/60"
            />
          </form>
        )}
      </div>

      {/* the ONE audio element: Bolna plays through it, the analyser taps it */}
      <audio ref={audioElRef} data-testid="mitra-overlay-audio" className="hidden" />
    </div>
  );
}

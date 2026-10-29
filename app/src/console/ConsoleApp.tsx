// ConsoleApp — the ?window=console AGI-style chat interface (docs/CONSOLE_PLAN.md
// "UI/UX"): left persona stage (live, envelope-reactive), right thread with tool
// cards + boot sequence, input bar with hint chips + mic, and a status bar
// (brain · model · RAM-lite badge · provider mode · Ollama install note).
//
// Logic lives in consoleModel.ts (pure, unit-tested); this file is the wiring:
//   - boot: probe GET /api/brain/status (degrades to mock when absent) and
//     reveal the monospace boot lines one by one on first open;
//   - submit: runSubmit from the model (intent→tool / brain-chat pipeline);
//   - speaking envelope: a local synthetic amplitude ref animated for the
//     speakUntil window (pattern adapted from src/voice/mockProvider.ts's
//     startEnvelope — reused behavior, NOT the provider itself);
//   - mic button → window.mitra.toggleOverlay?.() (preload may not expose it in
//     a plain browser — guarded); Esc → window.mitra.toggleConsole().
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { SessionState, Settings, WorkspaceMode } from '../shared/types';
import type { MitraApi } from '../shared/ipc';
import { t } from '../i18n';
import { DEFAULT_SETTINGS } from '../shared/types';
import { getMitra } from '../settings/mitraClient';
import { PersonaStage } from '../persona/PersonaStage';
import {
  HINT_CHIPS,
  buildBootLines,
  buildChatHistory,
  consoleReducer,
  fetchBrainStatus,
  initialConsoleState,
  runSubmit,
} from './consoleModel';
import { Thread } from './Thread';

/** Milliseconds between boot-line reveals (plan: lines "animating in"). */
const BOOT_STAGGER_MS = 320;

export default function ConsoleApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [input, setInput] = useState('');
  const [state, dispatch] = useReducer(consoleReducer, undefined, initialConsoleState);

  const lang = settings.language;
  const stateRef = useRef(state);
  stateRef.current = state;
  const modesRef = useRef<WorkspaceMode[]>(settings.workspaceModes ?? []);
  modesRef.current = settings.workspaceModes ?? [];

  // ---- settings (plain-browser dev degrades to defaults; never blocks) ----
  useEffect(() => {
    const mitra = getMitra();
    if (!mitra) return;
    void mitra.getSettings().then(setSettings).catch(() => {});
  }, []);

  // ---- boot sequence: probe the brain, reveal monospace lines, then open ----
  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    void fetchBrainStatus().then((status) => {
      if (cancelled) return;
      dispatch({ type: 'status', status });
      const lines = buildBootLines(status, lang);
      lines.forEach((text, i) => {
        timers.push(
          window.setTimeout(() => {
            if (!cancelled) dispatch({ type: 'boot-line', text, id: `boot-${i}`, ts: Date.now() });
          }, BOOT_STAGGER_MS * i + 120),
        );
      });
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) dispatch({ type: 'boot-done' });
        }, BOOT_STAGGER_MS * lines.length + 260),
      );
    });
    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
    // Boot once per window open; language is fixed for the boot log.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- persona amplitude envelope (speaking window driven by speakUntil) ----
  // Oscillation adapted from src/voice/mockProvider.ts startEnvelope (our own
  // Phase-1 synthetic speech envelope) — same mouth-like gate + sines, anchored
  // to the reducer's speakUntil flag instead of the provider.
  const envelopeRef = useRef(0);
  const speakUntilRef = useRef(state.speakUntil);
  speakUntilRef.current = state.speakUntil;
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return; // node/test env → flat 0
    let raf = 0;
    let anchor = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const nowMs = Date.now();
      if (speakUntilRef.current > nowMs) {
        if (!anchor) anchor = nowMs;
        const s = (nowMs - anchor) / 1000;
        const gate = Math.sin(s * 6.3) > -0.2 ? 1 : 0.06;
        const v = (0.3 + 0.25 * Math.sin(s * 7.1) + 0.15 * Math.sin(s * 11.7)) * gate;
        envelopeRef.current = Math.min(1, Math.max(0, v));
      } else {
        anchor = 0;
        envelopeRef.current = 0;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- speak-end: flip the persona ring back when the envelope window closes ----
  useEffect(() => {
    if (state.speakUntil <= 0) return;
    const timer = window.setTimeout(
      () => dispatch({ type: 'speak-end' }),
      Math.max(0, state.speakUntil - Date.now()) + 60,
    );
    return () => window.clearTimeout(timer);
  }, [state.speakUntil]);

  // ---- persisted avatar bytes (same idempotent IPC copy as the overlay) ----
  const [vrmUrl, setVrmUrl] = useState<string | null>(null);
  useEffect(() => {
    const mitra = getMitra();
    if (!mitra) return;
    if (settings.persona !== 'avatar' || !settings.avatarVrmPath) return;
    let url: string | null = null;
    let disposed = false;
    void mitra
      .setAvatarFile({ kind: 'pick', sourcePath: settings.avatarVrmPath })
      .then((res) => {
        if (!disposed && res.ok) {
          url = URL.createObjectURL(new Blob([res.bytes], { type: 'model/gltf-binary' }));
          setVrmUrl(url);
        }
      })
      .catch(() => {
        /* persona stays whatever PersonaStage shows without a model */
      });
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [settings.persona, settings.avatarVrmPath]);

  // ---- window-level guards (Electron default-navigates on stray file drops) ----
  useEffect(() => {
    const swallow = (e: DragEvent): void => e.preventDefault();
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  // ---- Esc closes the console window (main also keeps a safety net) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.mitra?.toggleConsole();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- submit → the consoleModel pipeline (intent→tool / brain chat) ----
  const onSubmit = useCallback(
    (e: FormEvent): void => {
      e.preventDefault();
      const text = input.trim();
      if (!text || stateRef.current.typing) return;
      setInput('');
      void runSubmit(text, dispatch, {
        lang,
        getWorkspaceModes: () => modesRef.current,
        // History = turns BEFORE this submit (runSubmit appends the utterance itself).
        history: buildChatHistory(stateRef.current.entries),
      });
    },
    [input, lang],
  );

  const onChip = useCallback(
    (text: string): void => {
      if (stateRef.current.typing) return;
      void runSubmit(text, dispatch, {
        lang,
        getWorkspaceModes: () => modesRef.current,
        history: buildChatHistory(stateRef.current.entries),
      });
    },
    [lang],
  );

  // ---- mic: summon the voice overlay (preload method may be absent — guarded) ----
  const summonVoice = useCallback((): void => {
    const mitra = getMitra() as (MitraApi & { toggleOverlay?: () => void }) | null;
    try {
      mitra?.toggleOverlay?.();
    } catch {
      /* plain-browser dev: no preload — nothing to summon */
    }
  }, []);

  // ---- derived persona state (plan ring: listening(idle) / thinking / speaking) ----
  const speaking = state.speakUntil > Date.now();
  const personaState: SessionState = state.typing ? 'thinking' : speaking ? 'speaking' : 'idle';
  const stageLabel = state.typing
    ? t(lang, 'overlay.thinking')
    : speaking
      ? t(lang, 'overlay.speaking')
      : t(lang, 'overlay.idle');

  // ---- status bar facts ----
  const { status } = state;
  const brainLabel =
    status.brain === 'ollama'
      ? status.model
        ? `ollama · ${status.model}`
        : 'ollama'
      : status.brain === 'mock'
        ? t(lang, 'console.brain.mock')
        : '…';
  const modeLabel =
    status.bridgeMock === undefined
      ? t(lang, 'console.status.offline')
      : status.bridgeMock
        ? t(lang, 'console.status.mock')
        : t(lang, 'console.status.live');

  const orbVars = {
    '--orb-a': settings.orbColors.a,
    '--orb-b': settings.orbColors.b,
    '--accent': settings.orbColors.a,
    '--accent-2': settings.orbColors.b,
  } as CSSProperties;

  return (
    <div data-testid="console-root" className="relative h-full w-full overflow-hidden text-zinc-100" style={orbVars}>
      {/* ---- backdrop: orb-tinted glow + faint grid + scanline shimmer ---- */}
      <div aria-hidden="true" className="console-backdrop absolute inset-0" />
      <div aria-hidden="true" className="console-grid absolute inset-0" />
      <div aria-hidden="true" className="console-scanline pointer-events-none absolute inset-0" />

      <div className="relative flex h-full w-full">
        {/* ---- left: persona stage ---- */}
        <div className="relative hidden w-[42%] shrink-0 border-r border-white/[0.06] sm:block">
          <div className="absolute inset-0">
            <PersonaStage
              persona={settings.persona}
              state={personaState}
              colors={settings.orbColors}
              amplitudeRef={envelopeRef}
              vrmUrl={vrmUrl}
              licenseVisible={false}
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <span className="rounded-full border border-white/10 bg-black/50 px-3 py-1 font-mono text-[11px] text-zinc-400 backdrop-blur">
              {stageLabel}
            </span>
          </div>
        </div>

        {/* ---- right: thread + input + status ---- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-6 py-3">
            <span className="orb-text font-mono text-xs font-semibold uppercase tracking-[0.2em]">
              {t(lang, 'console.title')}
            </span>
          </div>

          <Thread entries={state.entries} typing={state.typing} lang={lang} />

          {/* input bar: hint chips + field + mic + send */}
          <div className="border-t border-white/[0.06] px-6 pb-4 pt-3">
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {HINT_CHIPS.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  disabled={!state.booted || state.typing}
                  onClick={() => onChip(t(lang, chip.key))}
                  className="chip focus-orb disabled:cursor-not-allowed disabled:opacity-50 rounded-lg px-2.5 py-1 text-[11px] text-zinc-400"
                >
                  {t(lang, chip.key)}
                </button>
              ))}
            </div>
            <form className="flex items-center gap-2" onSubmit={onSubmit}>
              <input
                data-testid="console-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                // Explicit Enter handling: Chromium only performs implicit form
                // submission while a NON-disabled submit button exists — the Send
                // button is disabled until boot completes, which would swallow
                // Enter. Route Enter through the same onSubmit path instead.
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    onSubmit(e);
                  }
                }}
                placeholder={t(lang, 'console.input.placeholder')}
                spellCheck={false}
                autoComplete="off"
                className="input-glass min-w-0 flex-1 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600"
              />
              <button
                type="button"
                data-testid="console-mic"
                onClick={summonVoice}
                title={t(lang, 'console.mic')}
                aria-label={t(lang, 'console.mic')}
                className="focus-orb flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:border-white/25 hover:text-white"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
                  <rect x="6" y="1.8" width="4" height="7.2" rx="2" />
                  <path d="M3.8 7.2a4.2 4.2 0 0 0 8.4 0M8 11.4v2.4M5.8 13.8h4.4" />
                </svg>
              </button>
              <button
                type="submit"
                data-testid="console-send"
                disabled={!state.booted || state.typing || !input.trim()}
                className="btn-orb focus-orb shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t(lang, 'console.send')}
              </button>
            </form>
          </div>

          {/* status bar: brain · model · RAM-lite · provider mode · ollama note */}
          <div
            data-testid="console-status"
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.06] px-6 py-2 font-mono text-[11px] text-zinc-500"
          >
            <span>
              <span className="text-zinc-600">{t(lang, 'console.status.brain')}:</span>{' '}
              <span className="text-zinc-300">{brainLabel}</span>
            </span>
            {status.brain === 'ollama' && (
              <span
                className="rounded-full border px-2 py-0.5"
                style={{
                  borderColor: 'color-mix(in oklab, var(--orb-a) 35%, transparent)',
                  color: 'color-mix(in oklab, var(--orb-a) 70%, white)',
                }}
              >
                {t(lang, 'console.status.ram')}
              </span>
            )}
            <span
              className={`rounded-full border px-2 py-0.5 ${
                status.bridgeMock === false
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-zinc-400'
              }`}
            >
              {modeLabel}
            </span>
            {status.brain !== 'ollama' && (
              <span className="text-zinc-600">{t(lang, 'console.status.ollamaHint')}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

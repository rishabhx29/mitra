// PersonaHarness — dev playground for Task A (Persona).
//
// Route (orchestrator wires in App.tsx): ?window=settings#/dev/persona
// Lets Task B/C engineers and humans verify the persona without the voice
// stack:
//   - cycle all SessionStates
//   - switch orb <-> avatar (PersonaKind)
//   - pick orb colors (defaults = DEFAULT_SETTINGS.orbColors)
//   - drop a .vrm file (no bundled model) → embedded license panel
//   - fake speech: generated WAV tone through a real <audio> element, so the
//     orb's AnalyserNode path AND wawa-lipsync path are exercised for real;
//   - mock mode with zero audio: synthetic oscillating amplitude ref drives
//     orb + avatar fallback mouth.
//
// Note on MediaElementSource ownership: one <audio> element can only ever be
// attached to one MediaElementAudioSourceNode. When the persona flips while
// fake speech is on, this harness recreates the audio element (fakeSession)
// so each configuration gets a fresh element.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PersonaKind, SessionState } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { PersonaStage } from '../persona/PersonaStage';
import { useAudioAnalyser, type AudioSource } from '../persona/orb/useAudioAnalyser';

const STATES: SessionState[] = ['idle', 'listening', 'thinking', 'speaking', 'error'];

const NO_SOURCE: { current: AudioSource | null } = { current: null };

export default function PersonaHarness() {
  const [persona, setPersona] = useState<PersonaKind>('orb');
  const [state, setState] = useState<SessionState>('idle');
  const [colors, setColors] = useState(DEFAULT_SETTINGS.orbColors);
  const [bloom, setBloom] = useState(true);
  const [vrmUrl, setVrmUrl] = useState<string | null>(null);
  const [vrmFileName, setVrmFileName] = useState<string | null>(null);
  const [fakeSpeechOn, setFakeSpeechOn] = useState(false);
  const [mockSpeechOn, setMockSpeechOn] = useState(true);
  // 10Hz tick that re-renders the meter bar; the values live in refs.
  const [, setMeterTick] = useState(0);
  // Bumped when the fake-audio element must be recreated (see header note).
  const [fakeSession, setFakeSession] = useState(0);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const vrmObjectUrlRef = useRef<string | null>(null);

  // ONE analyser owns the element in orb mode; in avatar mode it stays
  // detached so wawa-lipsync can claim the fresh element's single
  // MediaElementSource slot.
  const orbAnalyserSource = persona === 'orb' && fakeSpeechOn ? audioElRef : NO_SOURCE;
  const analyserRef = useAudioAnalyser(orbAnalyserSource);

  // Mock-mode amplitude: synthetic "speech" oscillation, no audio at all.
  const mockAmplitudeRef = useRef(0);
  useEffect(() => {
    if (!mockSpeechOn) {
      mockAmplitudeRef.current = 0;
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const t = (now - start) / 1000;
      // Two incommensurate sines + random syllable gating → mouth-like motion.
      const syllable = Math.sin(t * 6.3) > -0.2 ? 1 : 0.05;
      const v =
        (0.3 + 0.25 * Math.sin(t * 7.1) + 0.15 * Math.sin(t * 11.7)) * syllable;
      mockAmplitudeRef.current = Math.min(1, Math.max(0, v));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mockSpeechOn]);

  // 10Hz re-render tick for the meter bar (values live in refs, render-free).
  useEffect(() => {
    const id = setInterval(() => setMeterTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  // Create/destroy the fake-speech audio element.
  useEffect(() => {
    if (!fakeSpeechOn) {
      audioElRef.current = null;
      return;
    }
    const el = document.createElement('audio');
    el.loop = true;
    el.src = generateFakeSpeechWavDataUrl();
    el.volume = 0.6;
    el.play().catch(() => undefined); // autoplay may need a click; the toggle IS the gesture
    audioElRef.current = el;
    return () => {
      el.pause();
      el.removeAttribute('src');
      audioElRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fakeSpeechOn, fakeSession]);

  const switchPersona = (next: PersonaKind) => {
    setPersona(next);
    // Fresh element for the other consumer (analyser vs wawa-lipsync).
    if (fakeSpeechOn) setFakeSession((s) => s + 1);
  };

  const onVrmFile = (file: File | undefined) => {
    if (!file) return;
    if (vrmObjectUrlRef.current) URL.revokeObjectURL(vrmObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    vrmObjectUrlRef.current = url;
    setVrmUrl(url);
    setVrmFileName(file.name);
  };

  // What the orb/meter show right now: real analysis in orb+fake mode,
  // synthetic mock amplitude otherwise.
  const displayAmplitude =
    persona === 'orb' && fakeSpeechOn ? analyserRef.current : mockAmplitudeRef.current;

  return (
    <div className="flex h-full w-full gap-4 bg-zinc-950 p-4 text-zinc-100">
      {/* Stage */}
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-black">
        <PersonaStage
          persona={persona}
          state={state}
          colors={colors}
          // Orb: the harness analyser's 60fps ref (only analyser attached).
          // Avatar: mock ref feeds the fallback mouth (wawa takes over when
          // fake speech is on).
          amplitudeRef={persona === 'orb' && fakeSpeechOn ? analyserRef : mockAmplitudeRef}
          amplitude={displayAmplitude}
          audioEl={audioElRef}
          vrmUrl={vrmUrl}
          bloom={bloom}
        />
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/50 px-2 py-1 text-[11px] text-zinc-300">
          persona: {persona} · state: {state}
          {fakeSpeechOn ? ' · fake-audio ON' : mockSpeechOn ? ' · mock amplitude' : ''}
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 h-2 w-40 overflow-hidden rounded bg-zinc-800">
          <div
            className="h-full bg-sky-400 transition-[width] duration-100"
            style={{ width: `${Math.round(displayAmplitude * 100)}%` }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="w-72 shrink-0 space-y-4 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div>
          <h1 className="text-sm font-semibold">Persona dev harness</h1>
          <p className="mt-1 text-[11px] text-zinc-400">
            Route: <code className="text-zinc-300">?window=settings#/dev/persona</code> (needs an
            App.tsx route — see PersonaHarness.tsx header).
          </p>
        </div>

        <ControlGroup label="Session state">
          <div className="grid grid-cols-3 gap-1">
            {STATES.map((s) => (
              <button
                key={s}
                onClick={() => setState(s)}
                className={`rounded px-2 py-1 text-[11px] capitalize ${
                  state === s ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </ControlGroup>

        <ControlGroup label="Persona">
          <div className="grid grid-cols-2 gap-1">
            {(['orb', 'avatar'] as PersonaKind[]).map((p) => (
              <button
                key={p}
                onClick={() => switchPersona(p)}
                className={`rounded px-2 py-1 text-[11px] capitalize ${
                  persona === p ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </ControlGroup>

        <ControlGroup label="Orb colors (Settings.orbColors)">
          <div className="flex items-center gap-3 text-[11px] text-zinc-300">
            <label className="flex items-center gap-1">
              a
              <input
                type="color"
                value={colors.a}
                onChange={(e) => setColors((c) => ({ ...c, a: e.target.value }))}
                className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
            </label>
            <label className="flex items-center gap-1">
              b
              <input
                type="color"
                value={colors.b}
                onChange={(e) => setColors((c) => ({ ...c, b: e.target.value }))}
                className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
              />
            </label>
            <label className="ml-auto flex items-center gap-1">
              <input type="checkbox" checked={bloom} onChange={(e) => setBloom(e.target.checked)} />
              bloom
            </label>
          </div>
        </ControlGroup>

        <ControlGroup label="VRM avatar (user-supplied — none bundled)">
          <input
            type="file"
            accept=".vrm"
            onChange={(e) => onVrmFile(e.target.files?.[0])}
            className="w-full text-[11px] text-zinc-300 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-[11px] file:text-zinc-200"
          />
          {vrmFileName && (
            <p className="mt-1 truncate text-[11px] text-zinc-500">loaded: {vrmFileName}</p>
          )}
          {vrmUrl && (
            <button
              onClick={() => {
                if (vrmObjectUrlRef.current) URL.revokeObjectURL(vrmObjectUrlRef.current);
                vrmObjectUrlRef.current = null;
                setVrmUrl(null);
                setVrmFileName(null);
              }}
              className="mt-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
            >
              unload model
            </button>
          )}
        </ControlGroup>

        <ControlGroup label="Audio drive">
          <div className="space-y-2 text-[11px] text-zinc-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={fakeSpeechOn}
                onChange={(e) => setFakeSpeechOn(e.target.checked)}
              />
              fake speech (generated WAV tone → real analyser path)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={mockSpeechOn}
                onChange={(e) => setMockSpeechOn(e.target.checked)}
              />
              mock amplitude (zero audio — mock mode)
            </label>
            <p className="text-zinc-500">
              {persona === 'avatar' && fakeSpeechOn
                ? 'wawa-lipsync owns the audio element in avatar mode → real viseme → aa/ih/ou/ee/oh.'
                : 'Orb mode: analyser drives amplitude. Avatar without audio: amplitude fallback (aa).'}
            </p>
          </div>
        </ControlGroup>

        <div className="rounded bg-zinc-950/70 p-2 text-[10px] leading-relaxed text-zinc-500">
          Adapted with attribution: samantha-ui (MIT) shaders + SmoothedValue + state configs;
          my-jarvis (MIT) state colors; amica (MIT) expression wiring; wawa-lipsync (MIT) visemes.
        </div>
      </div>
    </div>
  );
}

function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Generates a 2s looping 16-bit PCM WAV data URL with syllable-like envelope
 * and sweeping formants, so wawa-lipsync's band analysis produces changing
 * visemes. Pure harness helper — never used by the production persona.
 */
export function generateFakeSpeechWavDataUrl(): string {
  const sampleRate = 22050;
  const duration = 2;
  const numSamples = sampleRate * duration;
  const samples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Syllable envelope: 3Hz gate with 7Hz flutter.
    const gate = Math.max(0, Math.sin(t * 2 * Math.PI * 1.5)) ** 2;
    const env = gate * (0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 3.5));
    // Sweeping fundamental + formant-ish overtones (band content changes →
    // wawa-lipsync cycles aa/E/I/O/U-ish classifications).
    const f0 = 130 + 60 * Math.sin(t * 2 * Math.PI * 0.5);
    const s =
      Math.sin(2 * Math.PI * f0 * t) * 0.55 +
      Math.sin(2 * Math.PI * f0 * (2 + Math.sin(t * 2 * Math.PI * 0.8) * 1.2) * t * 0.5) * 0.25 +
      Math.sin(2 * Math.PI * f0 * 4 * t) * 0.12 +
      (Math.sin(t * 2 * Math.PI * 13) > 0.6 ? 0.08 : 0); // fricative-ish sparkle
    samples[i] = Math.round(Math.max(-1, Math.min(1, s * env)) * 32000);
  }
  // WAV header (44 bytes) + PCM16LE payload.
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  const dataLen = samples.length * 2;
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);

  const bytes = new Uint8Array(44 + dataLen);
  bytes.set(new Uint8Array(header), 0);
  bytes.set(new Uint8Array(samples.buffer), 44);

  // btoa over binary string (chunked to avoid arg limits).
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

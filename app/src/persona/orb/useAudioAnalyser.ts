// useAudioAnalyser — smoothed 0..1 audio amplitude for the persona stage.
//
// Pattern adapted from samantha-ui (MIT) src/hooks/useAIState.ts: amplitude is
// written into a React ref from a rAF loop so 3D scenes can read it at 60fps
// with zero React re-renders.
//
// Contract (docs/superpowers/plans/2026-10-24-mitra-mvp.md Task A):
//   useAudioAnalyser(ref) -> smoothed 0..1 amplitude via rAF + ref.
//
// Robustness rules (mock mode is first-class):
//   - never throws: no Web Audio, suspended context, or a source that is
//     already owned by another MediaElementSource (e.g. wawa-lipsync) all
//     degrade to a flat 0 amplitude;
//   - media-element sources are connected to ctx.destination so playback
//     stays audible; MediaStream sources (mic / Bolna tracks) are tapped
//     WITHOUT a destination connection to avoid echo.

import { useEffect, useRef, type RefObject } from 'react';
import { SmoothedValue } from './SmoothedValue';

export type AudioSource = HTMLAudioElement | MediaStream;
export type AudioSourceRef = RefObject<AudioSource | null>;

const FFT_SIZE = 512;
// Full-spectrum RMS of speech/TTS peaks around 0.3–0.5; scale into 0..1 with headroom.
const RMS_GAIN = 2.4;
const SMOOTH_SPEED = 9; // ~110ms to ~90% — snappy but not jittery

/**
 * Track a (possibly not-yet-mounted) audio source and expose a smoothed
 * 0..1 amplitude via the returned ref. Re-renders: none. Reconnects
 * automatically when `source.current` points at a new element/stream.
 */
export function useAudioAnalyser(source: AudioSourceRef): RefObject<number> {
  const amplitudeRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    let disposed = false;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let data: Uint8Array<ArrayBuffer> | null = null;
    let connectedKey: AudioSource | null = null;
    const smoothed = new SmoothedValue(0);
    let lastNow = 0;

    const connect = (src: AudioSource): void => {
      try {
        if (!audioCtx) {
          const Ctor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          // No Web Audio (old webview, SSR test env) → flat 0, no throw.
          if (!Ctor) {
            connectedKey = src;
            return;
          }
          audioCtx = new Ctor();
        }
        if (!analyser) {
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = FFT_SIZE;
          data = new Uint8Array(analyser.frequencyBinCount);
        }
        if (audioCtx.state === 'suspended') {
          void audioCtx.resume().catch(() => undefined);
        }
        if (src instanceof HTMLMediaElement) {
          // Throws if this element is already attached to another source node
          // (e.g. wawa-lipsync owns it) — degrade silently.
          const node = audioCtx.createMediaElementSource(src);
          node.connect(analyser);
          node.connect(audioCtx.destination); // keep playback audible
        } else {
          const node = audioCtx.createMediaStreamSource(src);
          node.connect(analyser); // tap only — no destination (no echo)
        }
      } catch {
        // leave amplitude at 0; do not retry every frame
      } finally {
        connectedKey = src; // never re-attempt for the same key
      }
    };

    const tick = (now: number): void => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);

      const src = source.current;
      if (!src) {
        smoothed.set(0);
      } else {
        if (src !== connectedKey) connect(src);
        if (analyser && data) {
          try {
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              sum += data[i] * data[i];
            }
            const rms = Math.sqrt(sum / data.length) / 255;
            smoothed.set(Math.min(1, rms * RMS_GAIN));
          } catch {
            smoothed.set(0);
          }
        }
      }

      const delta = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 1 / 60;
      lastNow = now;
      amplitudeRef.current = smoothed.update(delta, SMOOTH_SPEED);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (audioCtx) {
        void audioCtx.close().catch(() => undefined);
      }
    };
  }, [source]);

  return amplitudeRef;
}

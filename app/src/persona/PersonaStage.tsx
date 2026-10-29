// PersonaStage — the single mount point for Mitra's persona visuals.
// Switches between the shader orb and the VRM avatar by PersonaKind
// (shared/types.ts). Overlay (Task D) and the dev harness both mount this.

import { useRef, type RefObject } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import type { PersonaKind, SessionState } from '../shared/types';
import { Orb, type OrbColors } from './orb/Orb';
import { useAudioAnalyser, type AudioSource } from './orb/useAudioAnalyser';
import { Avatar } from './avatar/Avatar';

export interface PersonaStageProps {
  /** Which persona to render ('orb' | 'avatar'). */
  persona: PersonaKind;
  /** Session lifecycle state. */
  state: SessionState;
  /** User palette (Settings.orbColors); used by the orb. */
  colors?: OrbColors;
  /**
   * Audio source (HTMLAudioElement or MediaStream) the orb analyses with
   * useAudioAnalyser. Omit to drive the orb via `amplitude` / `amplitudeRef`
   * instead. Only the orb consumes this (an HTMLMediaElement can have only
   * one MediaElementSource owner).
   */
  audioSource?: RefObject<AudioSource | null>;
  /** Static 0..1 amplitude used when no audioSource is provided. */
  amplitude?: number;
  /** 60fps amplitude source (overrides `amplitude` when provided). */
  amplitudeRef?: RefObject<number>;
  /**
   * Audio element for the avatar's wawa-lipsync (must have a `src`).
   * Avatar-only: keep it distinct from `audioSource` or one of the two
   * consumers will lose the single MediaElementSource slot and degrade.
   */
  audioEl?: RefObject<HTMLAudioElement | null>;
  /** Object URL / http URL of a user-supplied .vrm (avatar persona). */
  vrmUrl?: string | null;
  /** Show the avatar's embedded-license panel (default true). */
  licenseVisible?: boolean;
  /** Enable orb bloom post-processing (default true). */
  bloom?: boolean;
  /** Avatar viewer mode: user-orbitable camera for large windows (default false). */
  orbit?: boolean;
  /** close = head-and-shoulders (overlay); full = entire model (console). */
  framing?: 'close' | 'full';
  className?: string;
}

/** Stable empty source so useAudioAnalyser can run unconditionally. */
const NO_SOURCE: RefObject<AudioSource | null> = { current: null };

export function PersonaStage({
  persona,
  state,
  colors,
  audioSource,
  amplitude = 0,
  amplitudeRef,
  audioEl,
  vrmUrl = null,
  licenseVisible = true,
  bloom = true,
  orbit = false,
  framing = 'close',
  className,
}: PersonaStageProps) {
  // Hooks run unconditionally (rules of hooks): analyse whatever source is
  // present; with none attached the analyser just holds a flat 0.
  const analysedRef = useAudioAnalyser(audioSource ?? NO_SOURCE);
  const staticRef = useRef(amplitude);
  staticRef.current = amplitude;

  // Precedence: explicit 60fps ref > analysed audio > static prop.
  const liveRef = amplitudeRef ?? (audioSource ? analysedRef : staticRef);

  if (persona === 'avatar') {
    return (
      <Avatar
        vrmUrl={vrmUrl}
        state={state}
        amplitude={amplitude}
        amplitudeRef={amplitudeRef}
        audioEl={audioEl}
        licenseVisible={licenseVisible}
        orbit={orbit}
        framing={framing}
        className={className}
      />
    );
  }

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 3.2], fov: 45 }}
        gl={{ alpha: true, antialias: true }}
      >
        <Orb
          state={state}
          colors={colors}
          amplitude={liveRef.current}
          amplitudeRef={liveRef}
        />
        {bloom && (
          <EffectComposer>
            <Bloom
              intensity={0.7}
              luminanceThreshold={0.15}
              luminanceSmoothing={0.3}
              mipmapBlur
            />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}

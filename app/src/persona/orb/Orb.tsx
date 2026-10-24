// Orb — Mitra persona #1: audio-reactive shader sphere.
//
// adapted from samantha-ui (MIT) src/components/SoulOrb/SoulOrb.jsx:
// shader-material construction, SmoothedValue-driven uniform transitions and
// the per-state useFrame behavior (breathing / pulse / liquid-silk morph).
// State colors extended with my-jarvis (MIT) VoiceOrb accents via orbTheme.ts.
//
// Contract (plan Task A): `<Orb state colors amplitude/>` is a PURE RENDER
// component — it draws only from props; no audio coupling, no DOM. Must be
// mounted inside an R3F <Canvas> (PersonaStage provides one).

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SessionState } from '../../shared/types';
import {
  ORB_CORE_FRAGMENT_SHADER,
  ORB_CORE_VERTEX_SHADER,
  ORB_FRAGMENT_SHADER,
  ORB_VERTEX_SHADER,
} from './orbShaders';
import { orbThemeForState, resolveOrbColors } from './orbTheme';
import { SmoothedValue } from './SmoothedValue';

export interface OrbColors {
  a: string;
  b: string;
}

export interface OrbProps {
  /** Session lifecycle state driving colors + behavior. */
  state?: SessionState;
  /** User-customizable palette (Settings.orbColors). Invalid hex degrades to defaults. */
  colors?: OrbColors;
  /** 0..1 audio amplitude target; smoothed internally each frame. */
  amplitude?: number;
  /**
   * Optional 60fps amplitude source (the useAudioAnalyser ref). When given,
   * it is read every frame and overrides the `amplitude` prop — lets the
   * overlay drive the orb without React re-renders. PersonaStage wires this.
   */
  amplitudeRef?: RefObject<number>;
}

const DEFAULT_COLORS: OrbColors = { a: '#4f8cff', b: '#b26bff' }; // == DEFAULT_SETTINGS.orbColors
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function Orb({
  state = 'idle',
  colors = DEFAULT_COLORS,
  amplitude = 0,
  amplitudeRef,
}: OrbProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);

  // Latest props for useFrame (avoids stale closures and re-registering).
  const stateRef = useRef(state);
  stateRef.current = state;
  const amplitudePropRef = useRef(amplitude);
  amplitudePropRef.current = amplitude;
  const externalRef = useRef<RefObject<number> | null>(null);
  externalRef.current = amplitudeRef ?? null;

  // Ambient motion gate (docs/DESIGN_BRIEF.md: respect prefers-reduced-motion).
  // When reduced: no rotation drift, no breathing/shudder pulses, no core
  // heartbeat — the glow and shape go static. Audio-reactive response and the
  // state palette stay: they are directly user-driven, not ambient motion.
  const ambientMotion = useMemo(() => {
    try {
      if (typeof window === 'undefined' || !window.matchMedia) return true;
      return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return true;
    }
  }, []);

  // Resolve the palette for the current state (pure string math in orbTheme).
  const colorTargets = useMemo(() => {
    const resolved = resolveOrbColors(state, colors);
    return { a: new THREE.Color(resolved.primary), b: new THREE.Color(resolved.secondary) };
    // Re-resolve on value change; object-identity churn is harmless here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, colors?.a, colors?.b]);

  // Shader material (created once; disposed on unmount).
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ORB_VERTEX_SHADER,
        fragmentShader: ORB_FRAGMENT_SHADER,
        uniforms: {
          uTime: { value: 0 },
          uAudio: { value: 0 },
          uState: { value: 0 },
          uNoiseFrequency: { value: 0.8 },
          uNoiseAmplitude: { value: 0.12 },
          uColorA: { value: new THREE.Color('#4f8cff') },
          uColorB: { value: new THREE.Color('#b26bff') },
          uEmissiveIntensity: { value: 0.25 },
          uFresnelPower: { value: 2.5 },
          uShapeMorph: { value: 0 },
        },
      }),
    [],
  );

  useEffect(() => () => material.dispose(), [material]);

  // Inner additive-glow core material (design brief §Overlay "Orb shape"):
  // depthTest off + AdditiveBlending + transparent → drawn after the opaque
  // shell, so the ~0.5-scale sphere reads as a light from within the orb.
  const coreMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ORB_CORE_VERTEX_SHADER,
        fragmentShader: ORB_CORE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uAudio: { value: 0 },
          uColorA: { value: new THREE.Color('#4f8cff') },
          uColorB: { value: new THREE.Color('#b26bff') },
          uCoreIntensity: { value: 0.35 },
        },
      }),
    [],
  );

  useEffect(() => () => coreMaterial.dispose(), [coreMaterial]);

  // Smoothed uniform channels — adapted from samantha-ui SoulOrb.jsx.
  const smoothed = useMemo(
    () => ({
      audio: new SmoothedValue(0),
      noiseFrequency: new SmoothedValue(0.8),
      noiseAmplitude: new SmoothedValue(0.12),
      emissiveBase: new SmoothedValue(0.25),
      pulseIntensity: new SmoothedValue(0),
      shapeMorph: new SmoothedValue(0),
      fresnelPower: new SmoothedValue(2.5),
      coreGlow: new SmoothedValue(0.35),
      scale: new SmoothedValue(1),
      positionY: new SmoothedValue(0),
      rotationX: new SmoothedValue(0), // used as accumulators (rotation drifts)
      rotationY: new SmoothedValue(0),
    }),
    [],
  );

  useFrame((_, rawDelta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const delta = Math.min(0.1, rawDelta); // clamp GC/tab-restore spikes
    timeRef.current += delta;
    const t = timeRef.current;

    const current = stateRef.current;
    const theme = orbThemeForState(current);
    const u = material.uniforms;

    const amplitude =
      externalRef.current !== null
        ? clamp01(externalRef.current.current)
        : amplitudePropRef.current;

    u.uTime.value = t;
    u.uState.value = { idle: 0, listening: 1, thinking: 2, speaking: 3, error: 4 }[current];

    // Amplitude: instant response (same policy as the reference: speed 60).
    smoothed.audio.set(clamp01(amplitude) * theme.audioResponse);
    u.uAudio.value = smoothed.audio.update(delta, 60);

    // Surface character.
    smoothed.noiseFrequency.set(theme.noiseFrequency);
    smoothed.noiseAmplitude.set(theme.noiseAmplitude);
    smoothed.fresnelPower.set(theme.fresnelPower);
    smoothed.shapeMorph.set(theme.shapeMorph);

    // Emissive: base + optional per-state pulse (thinking/error), like the
    // reference's THINKING pulse separation (base smoothed, pulse animated).
    smoothed.emissiveBase.set(theme.emissivePulse
      ? (theme.emissivePulse.min + theme.emissivePulse.max) / 2
      : theme.emissiveIntensity);
    smoothed.pulseIntensity.set(theme.emissivePulse ? 1 : 0);
    const pulse = theme.emissivePulse
      ? Math.sin(t * theme.emissivePulse.speed) * 0.2 * smoothed.pulseIntensity.value
      : 0;
    u.uEmissiveIntensity.value = Math.max(0, smoothed.emissiveBase.update(delta, 0.5) + pulse);

    // State-specific motion (ported from SoulOrb.jsx useFrame; UI-polish wave:
    // the scale pulses are theme-driven — orbTheme.scalePulse — and muted
    // under prefers-reduced-motion; audio response stays, it is user-driven).
    let targetScale = theme.scale;
    let targetPositionY = 0;

    if (current === 'idle') {
      // Gentle hover.
      if (ambientMotion) targetPositionY += Math.sin(t * 0.25) * 0.05;
    } else if (current === 'listening') {
      // Subtle reactive scale from mic amplitude.
      targetScale += clamp01(amplitude) * 0.08;
      if (ambientMotion) targetPositionY += Math.sin(t * 0.25) * 0.03;
    } else if (current === 'speaking') {
      // Silk tips do the work; keep global scale response modest.
      targetScale = 1 + clamp01(amplitude) * 0.1;
    }
    // Ambient scale pulse: idle breathing / thinking undulation / error shudder.
    if (theme.scalePulse && ambientMotion) {
      targetScale += Math.sin(t * theme.scalePulse.speed) * theme.scalePulse.amplitude;
    }

    smoothed.scale.set(targetScale);
    mesh.scale.setScalar(smoothed.scale.update(delta, 50));
    smoothed.positionY.set(targetPositionY);
    mesh.position.y = smoothed.positionY.update(delta, 3);

    // Slow transitions for surface + shape (reference: speed 0.5 / 1.0).
    u.uNoiseFrequency.value = smoothed.noiseFrequency.update(delta, 0.5);
    u.uNoiseAmplitude.value = smoothed.noiseAmplitude.update(delta, 0.5);
    u.uFresnelPower.value = smoothed.fresnelPower.update(delta, 0.5);
    u.uShapeMorph.value = smoothed.shapeMorph.update(delta, 1);

    // Colors: slow ~2s morph between state palettes.
    const colorSpeed = 1.5;
    u.uColorA.value.lerp(colorTargets.a, clamp01(delta * colorSpeed));
    u.uColorB.value.lerp(colorTargets.b, clamp01(delta * colorSpeed));

    // Continuous rotation drift (accumulators, like the reference) — muted
    // under prefers-reduced-motion.
    const drift = ambientMotion ? 1 : 0;
    smoothed.rotationX.value += delta * theme.rotationXSpeed * drift;
    smoothed.rotationY.value += delta * theme.rotationYSpeed * drift;
    mesh.rotation.x = smoothed.rotationX.value;
    mesh.rotation.y = smoothed.rotationY.value;

    // Inner core: per-state glow base (smoothed), the shared palette and the
    // smoothed audio. Its heartbeat clock freezes when motion is reduced —
    // the glow stays, just static.
    const cu = coreMaterial.uniforms;
    cu.uTime.value = ambientMotion ? t : 0;
    cu.uAudio.value = u.uAudio.value;
    cu.uColorA.value.copy(u.uColorA.value);
    cu.uColorB.value.copy(u.uColorB.value);
    smoothed.coreGlow.set(theme.coreGlow);
    cu.uCoreIntensity.value = smoothed.coreGlow.update(delta, 2);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 128, 128]} />
      <primitive object={material} attach="material" />
      {/* Inner additive-glow core (~0.5 scale, design brief) — a child so it
          inherits the shell's breathing/rotation and reads as lit-from-within. */}
      <mesh ref={coreRef} scale={0.5}>
        <sphereGeometry args={[1, 48, 48]} />
        <primitive object={coreMaterial} attach="material" />
      </mesh>
    </mesh>
  );
}

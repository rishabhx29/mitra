// Orb — Mitra persona #1: "wave ribbons in a glass sphere"
// (docs/DECISION_TIER_PLAN.md §3). Replaces the old single-sphere look
// outright: a glass shell with a strong fresnel rim, a noise-displaced
// gradient core, and three closed wavy ribbon tubes rotating at different
// speeds/axes on additive blending.
//
// adapted from samantha-ui (MIT) src/components/SoulOrb/SoulOrb.jsx:
// shader-material construction, SmoothedValue-driven uniform transitions and
// the core blob/liquid-silk displacement (see orbShaders.ts). State colors
// still extended with my-jarvis (MIT) VoiceOrb accents via orbTheme.ts.
//
// Contract (plan Task A, unchanged): `<Orb state colors amplitude amplitudeRef/>`
// is a PURE RENDER component — it draws only from props; no audio coupling, no
// DOM. Must be mounted inside an R3F <Canvas> (PersonaStage provides one).
//
// 60fps budget: every geometry is built once (useMemo) and never rebuilt —
// motion is mesh rotation + shader uniforms only. Tri counts: shell ~8k,
// core ~4.6k, three tubes ~4.3k — trivial for the GPU.

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SessionState } from '../../shared/types';
import {
  ORB_CORE_FRAGMENT_SHADER,
  ORB_CORE_VERTEX_SHADER,
  ORB_RIBBON_FRAGMENT_SHADER,
  ORB_RIBBON_VERTEX_SHADER,
  ORB_SHELL_FRAGMENT_SHADER,
  ORB_SHELL_VERTEX_SHADER,
} from './orbShaders';
import { orbThemeForState, resolveOrbColors } from './orbTheme';
import { RIBBON_CONFIGS, ribbonCurvePoint, ribbonPalette, waveThemeForState } from './orbWave';
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

/** Curve samples + tube segments per ribbon — static, built once. */
const RIBBON_CURVE_SAMPLES = 120;
const RIBBON_TUBE_SEGMENTS = 120;
const RIBBON_RADIAL_SEGMENTS = 6;

export function Orb({
  state = 'idle',
  colors = DEFAULT_COLORS,
  amplitude = 0,
  amplitudeRef,
}: OrbProps) {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const ribbonRefs = useRef<(THREE.Mesh | null)[]>([]);
  const spinRef = useRef<number[]>(RIBBON_CONFIGS.map(() => 0));
  const timeRef = useRef(0);

  // Latest props for useFrame (avoids stale closures and re-registering).
  const stateRef = useRef(state);
  stateRef.current = state;
  const amplitudePropRef = useRef(amplitude);
  amplitudePropRef.current = amplitude;
  const externalRef = useRef<RefObject<number> | null>(null);
  externalRef.current = amplitudeRef ?? null;

  // Ambient motion gate (docs/DESIGN_BRIEF.md: respect prefers-reduced-motion).
  // When reduced: no spin/drift, no travelling waves, no breathing — the scene
  // goes static. Audio-reactive response and the state palette stay: they are
  // directly user-driven, not ambient motion.
  const ambientMotion = useMemo(() => {
    try {
      if (typeof window === 'undefined' || !window.matchMedia) return true;
      return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return true;
    }
  }, []);

  // Resolve the palette for the current state (pure string math in orbTheme),
  // then split it across the three ribbon hues (pure math in orbWave).
  const palette = useMemo(() => {
    const resolved = resolveOrbColors(state, colors);
    const ribbonHexes = ribbonPalette(resolved.primary, resolved.secondary);
    return {
      a: new THREE.Color(resolved.primary),
      b: new THREE.Color(resolved.secondary),
      ribbons: ribbonHexes.map((hex) => new THREE.Color(hex)),
    };
    // Re-resolve on value change; object-identity churn is harmless here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, colors?.a, colors?.b]);

  // --- static geometry (built once, disposed on unmount — no per-frame rebuilds) ---
  const shellGeometry = useMemo(() => new THREE.SphereGeometry(1, 64, 64), []);
  const coreGeometry = useMemo(() => new THREE.SphereGeometry(1, 48, 48), []);
  const ribbonGeometries = useMemo(
    () =>
      RIBBON_CONFIGS.map((cfg) => {
        const points: THREE.Vector3[] = [];
        for (let i = 0; i < RIBBON_CURVE_SAMPLES; i++) {
          const p = ribbonCurvePoint(i / RIBBON_CURVE_SAMPLES, cfg);
          points.push(new THREE.Vector3(p.x, p.y, p.z));
        }
        const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
        return new THREE.TubeGeometry(curve, RIBBON_TUBE_SEGMENTS, cfg.tubeRadius, RIBBON_RADIAL_SEGMENTS, true);
      }),
    [],
  );

  useEffect(
    () => () => {
      shellGeometry.dispose();
      coreGeometry.dispose();
      ribbonGeometries.forEach((g) => g.dispose());
    },
    [shellGeometry, coreGeometry, ribbonGeometries],
  );

  // --- materials (created once; disposed on unmount) ---
  // Glass shell: additive + depthWrite off so the core and ribbons always show
  // through; rendered last (renderOrder 2) so its rim caps the stack.
  const shellMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ORB_SHELL_VERTEX_SHADER,
        fragmentShader: ORB_SHELL_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uAudio: { value: 0 },
          uRim: { value: 0.85 },
          uRimPower: { value: 2.5 },
          uColorA: { value: new THREE.Color('#4f8cff') },
          uColorB: { value: new THREE.Color('#b26bff') },
        },
      }),
    [],
  );

  // Gradient core: opaque noise-displaced blob (writes depth, so ribbons
  // passing behind it are properly occluded — a solid heart in the glass).
  const coreMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ORB_CORE_VERTEX_SHADER,
        fragmentShader: ORB_CORE_FRAGMENT_SHADER,
        uniforms: {
          uTime: { value: 0 },
          uAudio: { value: 0 },
          uNoiseFrequency: { value: 0.8 },
          uNoiseAmplitude: { value: 0.12 },
          uShapeMorph: { value: 0 },
          uEmissiveIntensity: { value: 0.25 },
          uColorA: { value: new THREE.Color('#4f8cff') },
          uColorB: { value: new THREE.Color('#b26bff') },
        },
      }),
    [],
  );

  // Ribbon strands: additive, depthWrite off, one material per ribbon so each
  // keeps its own hue and phase.
  const ribbonMaterials = useMemo(
    () =>
      RIBBON_CONFIGS.map(
        () =>
          new THREE.ShaderMaterial({
            vertexShader: ORB_RIBBON_VERTEX_SHADER,
            fragmentShader: ORB_RIBBON_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
              uTime: { value: 0 },
              uAudio: { value: 0 },
              uWobble: { value: 0.02 },
              uAudioWobble: { value: 0.5 },
              uAmbient: { value: ambientMotion ? 1 : 0 },
              uIntensity: { value: 0.6 },
              uColor: { value: new THREE.Color('#ffffff') },
            },
          }),
      ),
    [ambientMotion],
  );

  useEffect(
    () => () => {
      shellMaterial.dispose();
      coreMaterial.dispose();
      ribbonMaterials.forEach((m) => m.dispose());
    },
    [shellMaterial, coreMaterial, ribbonMaterials],
  );

  // Smoothed uniform channels — adapted from samantha-ui SoulOrb.jsx.
  const smoothed = useMemo(
    () => ({
      audio: new SmoothedValue(0),
      noiseFrequency: new SmoothedValue(0.8),
      noiseAmplitude: new SmoothedValue(0.12),
      emissiveBase: new SmoothedValue(0.25),
      pulseIntensity: new SmoothedValue(0),
      shapeMorph: new SmoothedValue(0),
      rimPower: new SmoothedValue(2.5),
      groupScale: new SmoothedValue(1),
      coreScale: new SmoothedValue(0.45),
      positionY: new SmoothedValue(0),
      rotationX: new SmoothedValue(0), // used as accumulators (rotation drifts)
      rotationY: new SmoothedValue(0),
    }),
    [],
  );

  useFrame((_, rawDelta) => {
    const group = groupRef.current;
    const core = coreRef.current;
    if (!group || !core) return;
    const delta = Math.min(0.1, rawDelta); // clamp GC/tab-restore spikes
    timeRef.current += delta;
    const t = timeRef.current;

    const current = stateRef.current;
    const theme = orbThemeForState(current);
    const wave = waveThemeForState(current);
    const su = shellMaterial.uniforms;
    const cu = coreMaterial.uniforms;

    const amplitude =
      externalRef.current !== null
        ? clamp01(externalRef.current.current)
        : amplitudePropRef.current;

    // Amplitude: instant response (same policy as the reference: speed 60).
    smoothed.audio.set(clamp01(amplitude) * theme.audioResponse);
    const audio = smoothed.audio.update(delta, 60);
    su.uAudio.value = audio;
    cu.uAudio.value = audio;

    // Core surface character (carried over from the samantha-ui port — the
    // blob/silk fields stay live on the new gradient core).
    smoothed.noiseFrequency.set(theme.noiseFrequency);
    smoothed.noiseAmplitude.set(theme.noiseAmplitude);
    smoothed.shapeMorph.set(theme.shapeMorph);
    cu.uNoiseFrequency.value = smoothed.noiseFrequency.update(delta, 0.5);
    cu.uNoiseAmplitude.value = smoothed.noiseAmplitude.update(delta, 0.5);
    cu.uShapeMorph.value = smoothed.shapeMorph.update(delta, 1);

    // Emissive: base + optional per-state pulse (thinking/error), like the
    // reference's THINKING pulse separation (base smoothed, pulse animated).
    smoothed.emissiveBase.set(theme.emissivePulse
      ? (theme.emissivePulse.min + theme.emissivePulse.max) / 2
      : theme.emissiveIntensity);
    smoothed.pulseIntensity.set(theme.emissivePulse ? 1 : 0);
    const pulse = theme.emissivePulse
      ? Math.sin(t * theme.emissivePulse.speed) * 0.2 * smoothed.pulseIntensity.value
      : 0;
    cu.uEmissiveIntensity.value = Math.max(0, smoothed.emissiveBase.update(delta, 0.5) + pulse);

    // Glass shell rim: theme brightness + the pulse, fresnel power from theme.
    smoothed.rimPower.set(theme.fresnelPower);
    su.uRimPower.value = smoothed.rimPower.update(delta, 0.5);
    su.uRim.value = Math.max(0, wave.shellRim * wave.brightness + pulse);

    // Colors: slow ~1.5x/s morph between state palettes (shell, core, ribbons).
    const colorSpeed = 1.5;
    su.uColorA.value.lerp(palette.a, clamp01(delta * colorSpeed));
    su.uColorB.value.lerp(palette.b, clamp01(delta * colorSpeed));
    cu.uColorA.value.copy(su.uColorA.value);
    cu.uColorB.value.copy(su.uColorB.value);

    // Shader clock freezes under prefers-reduced-motion (static glow/waves);
    // the audio-driven uniform terms keep working.
    const shaderTime = ambientMotion ? t : 0;
    su.uTime.value = shaderTime;
    cu.uTime.value = shaderTime;

    // --- group motion: drift + breathing + audio swell (samantha-ui port) ---
    let groupScale = theme.scale + audio * 0.08;
    if (theme.scalePulse && ambientMotion) {
      groupScale += Math.sin(t * theme.scalePulse.speed) * theme.scalePulse.amplitude;
    }
    smoothed.groupScale.set(groupScale);
    group.scale.setScalar(smoothed.groupScale.update(delta, 50));

    // Gentle hover (idle/listening only, like the reference) — ambient-gated.
    let targetPositionY = 0;
    if (ambientMotion) {
      if (current === 'idle') targetPositionY += Math.sin(t * 0.25) * 0.05;
      else if (current === 'listening') targetPositionY += Math.sin(t * 0.25) * 0.03;
    }
    smoothed.positionY.set(targetPositionY);
    group.position.y = smoothed.positionY.update(delta, 3);

    // Whole-constellation drift (accumulators, like the reference) — muted
    // under prefers-reduced-motion.
    const drift = ambientMotion ? 1 : 0;
    smoothed.rotationX.value += delta * theme.rotationXSpeed * drift;
    smoothed.rotationY.value += delta * theme.rotationYSpeed * drift;
    group.rotation.x = smoothed.rotationX.value;
    group.rotation.y = smoothed.rotationY.value;

    // --- core: audio pumps its scale (speaking, plan §3) ---
    smoothed.coreScale.set(wave.coreScale * 0.45 * (1 + audio * wave.audioScale));
    core.scale.setScalar(smoothed.coreScale.update(delta, 30));

    // --- ribbons: own spin (different speeds/axes) + per-ribbon uniforms ---
    ribbonMaterials.forEach((material, i) => {
      const cfg = RIBBON_CONFIGS[i];
      const mesh = ribbonRefs.current[i];
      if (mesh) {
        spinRef.current[i] += delta * cfg.speed * wave.ribbonSpeed * drift;
        mesh.rotation.y = spinRef.current[i];
      }
      const u = material.uniforms;
      u.uTime.value = shaderTime;
      u.uAudio.value = audio;
      u.uWobble.value = wave.ribbonWobble;
      u.uAudioWobble.value = wave.audioWobble;
      u.uIntensity.value = Math.max(0, wave.ribbonIntensity * wave.brightness);
      u.uColor.value.lerp(palette.ribbons[i], clamp01(delta * colorSpeed));
    });
  });

  return (
    <group ref={groupRef}>
      {/* Gradient core: noise-displaced blob, vertical a→b gradient, audio
          breathing. Opaque + depth-writing so ribbons behind it occlude. */}
      <mesh ref={coreRef} geometry={coreGeometry} material={coreMaterial} />

      {/* Three closed wavy ribbons: static tube geometry, tilted spin groups
          (different axes), per-ribbon material (distinct hues a/b/white-ish). */}
      {RIBBON_CONFIGS.map((cfg, i) => (
        <group key={cfg.phase} rotation={cfg.tilt}>
          <mesh
            ref={(mesh) => {
              ribbonRefs.current[i] = mesh;
            }}
            geometry={ribbonGeometries[i]}
            material={ribbonMaterials[i]}
            renderOrder={1}
          />
        </group>
      ))}

      {/* Glass shell: transparent, strong fresnel rim, additive, drawn last. */}
      <mesh geometry={shellGeometry} material={shellMaterial} renderOrder={2} />
    </group>
  );
}

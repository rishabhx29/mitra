// Pure state → wave-orb appearance mapping + ribbon curve math.
//
// Part of the wave-orb redesign ("wave ribbons in a glass sphere",
// docs/DECISION_TIER_PLAN.md §3). No three.js / react / DOM imports on
// purpose: this module is unit-tested in a plain node environment
// (orbWave.test.ts), same rule as orbTheme.ts. Palette math reuses the
// tested pure helpers from orbTheme (parse/mix, degrade-never-throw).
//
// State mapping contract (plan §3):
// - listening = calm rotation, low wobble
// - thinking  = faster + brighter
// - speaking  = audio amplitude pumps the core scale + ribbon wobble
// - error     = red tint (via orbTheme's accent-weighted palette) + agitated
//               motion; the whole-mesh shudder stays in orbTheme.scalePulse.

import type { SessionState } from '../../shared/types';
import { mixHex } from './orbTheme';

/** One closed wavy ribbon: a ring distorted by radial + vertical sine lobes. */
export interface RibbonCurveParams {
  /** Base ring radius (orb shell radius is 1 — keep < 1 so ribbons stay inside). */
  radius: number;
  /** Radial sine amplitude as a fraction of `radius`. */
  radialWobble: number;
  /** Radial sine lobes around the loop (integer → the curve closes). */
  lobes: number;
  /** Vertical sine amplitude (absolute units). */
  verticalWobble: number;
  /** Vertical sine lobes around the loop (integer → the curve closes). */
  verticalLobes: number;
  /** Phase offset (radians) so the three ribbons do not pulse in lockstep. */
  phase: number;
}

/** A ribbon ready to build: curve params + tube + orientation + spin. */
export interface RibbonConfig extends RibbonCurveParams {
  /** Tube cross-section radius. */
  tubeRadius: number;
  /** Static orientation of the ribbon's spin group (radians, XYZ euler). */
  tilt: [number, number, number];
  /**
   * Spin speed around the ribbon's own ring axis (radians/second, signed —
   * opposite signs make neighbouring ribbons counter-rotate).
   */
  speed: number;
}

/**
 * Point on the closed wavy curve at parameter t (0..1, clamped).
 * Pure trig — the TubeGeometry is built once from samples of this; the mesh
 * is never rebuilt per frame (60fps budget, plan §3).
 * Closed for integer `lobes`/`verticalLobes`: ribbonCurvePoint(0) === ribbonCurvePoint(1).
 */
export function ribbonCurvePoint(
  t: number,
  p: RibbonCurveParams,
): { x: number; y: number; z: number } {
  const clamped = Math.min(1, Math.max(0, t));
  const theta = clamped * Math.PI * 2;
  const r = p.radius * (1 + p.radialWobble * Math.sin(p.lobes * theta + p.phase));
  const y = p.verticalWobble * Math.sin(p.verticalLobes * theta + p.phase * 1.7);
  return { x: r * Math.cos(theta), y, z: r * Math.sin(theta) };
}

/** The three ribbons (plan §3): distinct hues come from the palette, these
 * give distinct radii / lobe counts / tilts / speeds. All radii < 1 (glass shell). */
export const RIBBON_CONFIGS: RibbonConfig[] = [
  {
    radius: 0.72,
    radialWobble: 0.16,
    lobes: 5,
    verticalWobble: 0.1,
    verticalLobes: 3,
    phase: 0.0,
    tubeRadius: 0.034,
    tilt: [0.5, 0.15, 0.1],
    speed: 0.55,
  },
  {
    radius: 0.62,
    radialWobble: 0.12,
    lobes: 7,
    verticalWobble: 0.14,
    verticalLobes: 4,
    phase: 2.1,
    tubeRadius: 0.03,
    tilt: [-0.55, -0.3, 0.35],
    speed: -0.38,
  },
  {
    radius: 0.8,
    radialWobble: 0.09,
    lobes: 4,
    verticalWobble: 0.08,
    verticalLobes: 2,
    phase: 4.4,
    tubeRadius: 0.026,
    tilt: [1.05, 0.4, -0.2],
    speed: 0.26,
  },
];

export const RIBBON_COUNT = RIBBON_CONFIGS.length;

/**
 * Hue mix for the three ribbons (plan §3: "per-ribbon hue (a, b, white-ish)").
 * Third ribbon = the primary pulled toward soft white so it reads as a light
 * strand, not a third saturated color. Invalid inputs degrade via mixHex —
 * never throws.
 */
export function ribbonPalette(primary: string, secondary: string): [string, string, string] {
  return [primary, secondary, mixHex(primary, '#ffffff', 0.72)];
}

/** Per-state appearance for the wave orb's shell + ribbons + core scale pump. */
export interface WaveOrbTheme {
  /** Glass-shell fresnel rim brightness. */
  shellRim: number;
  /** Multiplier on each ribbon's own spin speed. */
  ribbonSpeed: number;
  /** Ambient travelling-wave displacement on the tubes (time-driven). */
  ribbonWobble: number;
  /** Additive brightness of the ribbons. */
  ribbonIntensity: number;
  /** Global brightness multiplier (thinking = brighter, plan §3). */
  brightness: number;
  /** Base core blob scale multiplier. */
  coreScale: number;
  /** 0..1-ish — how strongly audio amplitude pumps the core scale. */
  audioScale: number;
  /** Audio-driven ribbon displacement (absolute units, added to ribbonWobble). */
  audioWobble: number;
}

export const WAVE_ORB_THEMES: Record<SessionState, WaveOrbTheme> = {
  idle: {
    shellRim: 0.85,
    ribbonSpeed: 0.45,
    ribbonWobble: 0.016,
    ribbonIntensity: 0.5,
    brightness: 1.0,
    coreScale: 1.0,
    audioScale: 0.08,
    audioWobble: 0.03,
  },
  listening: {
    shellRim: 0.95,
    ribbonSpeed: 0.6,
    ribbonWobble: 0.02,
    ribbonIntensity: 0.6,
    brightness: 1.05,
    coreScale: 1.02,
    audioScale: 0.1,
    audioWobble: 0.05,
  },
  thinking: {
    shellRim: 1.2,
    ribbonSpeed: 1.9,
    ribbonWobble: 0.026,
    ribbonIntensity: 0.85,
    brightness: 1.35,
    coreScale: 0.97,
    audioScale: 0.04,
    audioWobble: 0.015,
  },
  speaking: {
    shellRim: 1.05,
    ribbonSpeed: 1.0,
    ribbonWobble: 0.024,
    ribbonIntensity: 0.75,
    brightness: 1.15,
    coreScale: 1.0,
    audioScale: 0.18,
    audioWobble: 0.09,
  },
  error: {
    shellRim: 1.3,
    ribbonSpeed: 1.5,
    ribbonWobble: 0.04,
    ribbonIntensity: 0.95,
    brightness: 1.2,
    coreScale: 0.98,
    audioScale: 0.04,
    audioWobble: 0.025,
  },
};

/** Convenience accessor that always yields a theme (unknown state → idle). */
export function waveThemeForState(state: SessionState): WaveOrbTheme {
  return WAVE_ORB_THEMES[state] ?? WAVE_ORB_THEMES.idle;
}

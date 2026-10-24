// Pure state -> orb appearance mapping. No three.js / DOM imports on purpose:
// this module is unit-tested in a plain node environment (orb.test.tsx).
//
// Behavior parameters adapted from samantha-ui (MIT) src/types/ai.ts
// STATE_CONFIGS (LISTENING/THINKING/SPEAKING). State accent colors adapted from
// my-jarvis (MIT) VoiceOrb.css (listening #ff2d55, processing #ff9500,
// speaking #00e5b0), extended with Mitra's idle/error states.

import type { SessionState } from '../../shared/types';

/** Per-state visual configuration for the orb shader + mesh. */
export interface OrbStateTheme {
  /** State identity color (hex) the user palette is tinted toward. */
  accent: string;
  /** 0..1 — how strongly `accent` is mixed into the user palette (0 = user colors untouched). */
  accentWeight: number;
  /** Surface noise frequency. */
  noiseFrequency: number;
  /** Surface noise displacement amplitude. */
  noiseAmplitude: number;
  /** Base emissive glow. */
  emissiveIntensity: number;
  /** If present, emissive pulses between min and max (thinking/error). */
  emissivePulse?: { min: number; max: number; speed: number };
  /** Fresnel rim-glow power. */
  fresnelPower: number;
  /** Base scale multiplier. */
  scale: number;
  /** X rotation speed (radians/second). */
  rotationXSpeed: number;
  /** Y rotation speed (radians/second). */
  rotationYSpeed: number;
  /** 0 = blob shape, 1 = liquid-silk shape (speaking). */
  shapeMorph: number;
  /** 0..1 — how strongly audio amplitude displaces/scales the orb in this state. */
  audioResponse: number;
}

const THEME: OrbStateTheme = {
  accent: '#7c8cf8',
  accentWeight: 0,
  noiseFrequency: 0.8,
  noiseAmplitude: 0.12,
  emissiveIntensity: 0.25,
  fresnelPower: 2.5,
  scale: 1,
  rotationXSpeed: 0,
  rotationYSpeed: 0.05,
  shapeMorph: 0,
  audioResponse: 0.15,
};

/**
 * State themes for all SessionStates.
 * - idle:      calm breathing blob in the user's own palette
 * - listening: warm pink-red, gently reactive to microphone amplitude
 * - thinking:  amber, fast undulation + emissive pulse, no audio response
 * - speaking:  teal, liquid-silk morph driven by TTS amplitude
 * - error:     deep red, jittery high-frequency noise + fast pulse
 */
export const ORB_STATE_THEMES: Record<SessionState, OrbStateTheme> = {
  idle: THEME,
  listening: {
    ...THEME,
    accent: '#ff2d55',
    accentWeight: 0.35,
    noiseFrequency: 0.9,
    noiseAmplitude: 0.14,
    emissiveIntensity: 0.35,
    rotationYSpeed: 0.1,
    audioResponse: 0.5,
  },
  thinking: {
    ...THEME,
    accent: '#ff9500',
    accentWeight: 0.5,
    noiseFrequency: 2,
    noiseAmplitude: 0.12,
    emissiveIntensity: 0.7,
    emissivePulse: { min: 0.5, max: 0.9, speed: 12.56 },
    fresnelPower: 4,
    scale: 0.95,
    rotationXSpeed: 0.05,
    rotationYSpeed: 0.35,
    audioResponse: 0,
  },
  speaking: {
    ...THEME,
    accent: '#00e5b0',
    accentWeight: 0.45,
    noiseFrequency: 1.5,
    noiseAmplitude: 0.2,
    emissiveIntensity: 0.35,
    fresnelPower: 2,
    rotationYSpeed: 0.08,
    shapeMorph: 1,
    audioResponse: 0.8,
  },
  error: {
    ...THEME,
    accent: '#dc2626',
    accentWeight: 0.85,
    noiseFrequency: 3,
    noiseAmplitude: 0.16,
    emissiveIntensity: 0.6,
    emissivePulse: { min: 0.45, max: 0.75, speed: 20 },
    fresnelPower: 3,
    rotationXSpeed: 0.02,
    rotationYSpeed: 0.15,
    audioResponse: 0,
  },
};

/** Fallback palette = DEFAULT_SETTINGS.orbColors from shared/types. */
export const FALLBACK_ORB_COLORS = { a: '#4f8cff', b: '#b26bff' } as const;

/**
 * Parse `#rgb` / `#rrggbb` (leading `#` optional) into normalized 0..1 [r,g,b].
 * Returns null for anything else — callers must degrade, never throw.
 */
export function parseHexColor(hex: string): [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let body = m[1];
  if (body.length === 3) {
    body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  }
  const int = parseInt(body, 16);
  return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255];
}

function toHexByte(v: number): string {
  const b = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return b.toString(16).padStart(2, '0');
}

/**
 * Linear mix of two hex colors; t=0 → a, t=1 → b.
 * Invalid inputs degrade to the valid one (or '#ffffff' if both invalid) — never throws.
 */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);
  if (!ca && !cb) return '#ffffff';
  if (!ca) return normalizeHex(cb as [number, number, number]);
  if (!cb) return normalizeHex(ca);
  const clamped = Math.min(1, Math.max(0, t));
  return normalizeHex([
    ca[0] + (cb[0] - ca[0]) * clamped,
    ca[1] + (cb[1] - ca[1]) * clamped,
    ca[2] + (cb[2] - ca[2]) * clamped,
  ]);
}

function normalizeHex([r, g, b]: [number, number, number]): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

/**
 * Final orb palette for a session state: the user's chosen palette tinted
 * toward the state accent (which captures the "state color" identity).
 * `idle` returns the user palette untouched.
 * Invalid user colors fall back to the default palette — never throws.
 */
export function resolveOrbColors(
  state: SessionState,
  userColors?: { a?: string; b?: string } | null,
): { primary: string; secondary: string } {
  const theme = ORB_STATE_THEMES[state] ?? THEME;
  const fallback = FALLBACK_ORB_COLORS;
  const a =
    typeof userColors?.a === 'string' && parseHexColor(userColors.a)
      ? userColors.a
      : fallback.a;
  const b =
    typeof userColors?.b === 'string' && parseHexColor(userColors.b)
      ? userColors.b
      : fallback.b;
  if (theme.accentWeight <= 0) {
    return { primary: normalizeHex(parseHexColor(a) as [number, number, number]), secondary: normalizeHex(parseHexColor(b) as [number, number, number]) };
  }
  return {
    primary: mixHex(a, theme.accent, theme.accentWeight),
    secondary: mixHex(b, theme.accent, theme.accentWeight),
  };
}

/** Convenience accessor that always yields a theme (unknown state → idle). */
export function orbThemeForState(state: SessionState): OrbStateTheme {
  return ORB_STATE_THEMES[state] ?? THEME;
}

// Logic-only unit tests for the wave-orb helpers (plan §3 "wave ribbons in a
// glass sphere"). Pure functions/data only — no jsdom, no WebGL, no electron,
// no three (orbWave.ts imports none of them, same rule as orbTheme.ts).

import { describe, expect, it } from 'vitest';
import {
  RIBBON_CONFIGS,
  ribbonCurvePoint,
  ribbonPalette,
  WAVE_ORB_THEMES,
  waveThemeForState,
  type RibbonCurveParams,
} from './orbWave';
import { parseHexColor } from './orbTheme';

const ALL_STATES = ['idle', 'listening', 'thinking', 'speaking', 'error'] as const;

const EPS = 1e-9;

// ---------------------------------------------------------------------------
// ribbonCurvePoint — the closed wavy curve the TubeGeometry is sampled from
// ---------------------------------------------------------------------------

describe('ribbonCurvePoint', () => {
  const base: RibbonCurveParams = {
    radius: 0.7,
    radialWobble: 0.15,
    lobes: 5,
    verticalWobble: 0.1,
    verticalLobes: 3,
    phase: 1.3,
  };

  it('closes the loop: t=0 and t=1 are the same point', () => {
    const start = ribbonCurvePoint(0, base);
    const end = ribbonCurvePoint(1, base);
    expect(Math.abs(start.x - end.x)).toBeLessThan(EPS);
    expect(Math.abs(start.y - end.y)).toBeLessThan(EPS);
    expect(Math.abs(start.z - end.z)).toBeLessThan(EPS);
  });

  it('clamps t outside 0..1 to the loop endpoints', () => {
    const atZero = ribbonCurvePoint(0, base);
    expect(ribbonCurvePoint(-0.5, base)).toEqual(atZero);
    expect(ribbonCurvePoint(2, base)).toEqual(ribbonCurvePoint(1, base));
  });

  it('keeps the radial distance within radius * (1 ± radialWobble)', () => {
    for (let i = 0; i <= 100; i++) {
      const p = ribbonCurvePoint(i / 100, base);
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThanOrEqual(base.radius * (1 - base.radialWobble) - EPS);
      expect(r).toBeLessThanOrEqual(base.radius * (1 + base.radialWobble) + EPS);
    }
  });

  it('keeps the vertical offset within ±verticalWobble', () => {
    for (let i = 0; i <= 100; i++) {
      const p = ribbonCurvePoint(i / 100, base);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(base.verticalWobble + EPS);
    }
  });

  it('places the radial maximum exactly where the sine peaks (phase-shifted)', () => {
    // lobes=1, phase=+π/2 → sin(theta + π/2) peaks at theta=0 → r = radius*2.
    const params: RibbonCurveParams = {
      radius: 0.5,
      radialWobble: 1,
      lobes: 1,
      verticalWobble: 0,
      verticalLobes: 1,
      phase: Math.PI / 2,
    };
    const p = ribbonCurvePoint(0, params);
    expect(p.x).toBeCloseTo(1.0, 12); // 0.5 * (1 + 1)
    expect(p.z).toBeCloseTo(0, 12);
    // A quarter turn later the sine crosses zero → plain base radius.
    const q = ribbonCurvePoint(0.25, params);
    expect(Math.hypot(q.x, q.z)).toBeCloseTo(0.5, 12);
  });

  it('hits the vertical extrema at the expected quarters (no phase)', () => {
    const params: RibbonCurveParams = {
      radius: 0.6,
      radialWobble: 0,
      lobes: 1,
      verticalWobble: 0.2,
      verticalLobes: 1,
      phase: 0,
    };
    expect(ribbonCurvePoint(0, params).y).toBeCloseTo(0, 12);
    expect(ribbonCurvePoint(0.25, params).y).toBeCloseTo(0.2, 12);
    expect(ribbonCurvePoint(0.75, params).y).toBeCloseTo(-0.2, 12);
  });
});

// ---------------------------------------------------------------------------
// RIBBON_CONFIGS — the three strands (plan §3)
// ---------------------------------------------------------------------------

describe('RIBBON_CONFIGS', () => {
  it('defines exactly three ribbons', () => {
    expect(RIBBON_CONFIGS).toHaveLength(3);
  });

  it('keeps every ribbon inside the glass shell (radius < 1)', () => {
    for (const cfg of RIBBON_CONFIGS) {
      const maxReach = cfg.radius * (1 + cfg.radialWobble) + cfg.tubeRadius;
      expect(maxReach).toBeLessThan(1);
      expect(cfg.radius).toBeGreaterThan(0);
      expect(cfg.tubeRadius).toBeGreaterThan(0);
    }
  });

  it('uses integer lobe counts so every curve closes', () => {
    for (const cfg of RIBBON_CONFIGS) {
      expect(Number.isInteger(cfg.lobes)).toBe(true);
      expect(Number.isInteger(cfg.verticalLobes)).toBe(true);
      expect(cfg.lobes).toBeGreaterThan(0);
      expect(cfg.verticalLobes).toBeGreaterThan(0);
    }
  });

  it('gives each ribbon a distinct nonzero speed and distinct tilt', () => {
    const speeds = RIBBON_CONFIGS.map((c) => c.speed);
    expect(new Set(speeds).size).toBe(3);
    for (const speed of speeds) expect(speed).not.toBe(0);
    const tilts = new Set(RIBBON_CONFIGS.map((c) => c.tilt.join(',')));
    expect(tilts.size).toBe(3);
  });

  it('closes each configured curve (t=0 vs t=1)', () => {
    for (const cfg of RIBBON_CONFIGS) {
      const start = ribbonCurvePoint(0, cfg);
      const end = ribbonCurvePoint(1, cfg);
      expect(Math.hypot(start.x - end.x, start.y - end.y, start.z - end.z)).toBeLessThan(EPS);
    }
  });
});

// ---------------------------------------------------------------------------
// ribbonPalette — per-ribbon hue mix (a, b, soft white)
// ---------------------------------------------------------------------------

describe('ribbonPalette', () => {
  it('returns three distinct hues: primary, secondary, white-ish', () => {
    const [a, b, w] = ribbonPalette('#4f8cff', '#b26bff');
    expect(a).toBe('#4f8cff');
    expect(b).toBe('#b26bff');
    expect(w).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set([a.toLowerCase(), b.toLowerCase(), w.toLowerCase()]).size).toBe(3);
  });

  it('pulls the third hue toward white (lighter than the primary)', () => {
    const [a, , w] = ribbonPalette('#4f8cff', '#b26bff');
    const ca = parseHexColor(a) as [number, number, number];
    const cw = parseHexColor(w) as [number, number, number];
    for (let i = 0; i < 3; i++) expect(cw[i]).toBeGreaterThanOrEqual(ca[i] - 0.01);
    // And clearly lighter overall, not just clamped-equal.
    expect(cw[0] + cw[1] + cw[2]).toBeGreaterThan(ca[0] + ca[1] + ca[2]);
  });

  it('degrades on invalid input instead of throwing (mixHex policy)', () => {
    expect(() => ribbonPalette('not-a-color', '#b26bff')).not.toThrow();
    const [, , w] = ribbonPalette('not-a-color', '#b26bff');
    expect(w).toMatch(/^#[0-9a-f]{6}$/i); // falls back to the valid side
  });
});

// ---------------------------------------------------------------------------
// WAVE_ORB_THEMES — state mapping (plan §3: calm / faster+brighter / pumps / red)
// ---------------------------------------------------------------------------

describe('WAVE_ORB_THEMES', () => {
  it('defines a theme for every SessionState', () => {
    for (const state of ALL_STATES) {
      expect(WAVE_ORB_THEMES[state]).toBeDefined();
      const t = WAVE_ORB_THEMES[state];
      for (const value of Object.values(t)) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(t.shellRim).toBeGreaterThan(0);
      expect(t.ribbonIntensity).toBeGreaterThan(0);
      expect(t.brightness).toBeGreaterThan(0);
      expect(t.ribbonWobble).toBeGreaterThanOrEqual(0);
    }
  });

  it('listening is calmer than thinking (rotation + wobble)', () => {
    expect(WAVE_ORB_THEMES.listening.ribbonSpeed).toBeLessThan(WAVE_ORB_THEMES.thinking.ribbonSpeed);
    expect(WAVE_ORB_THEMES.listening.ribbonWobble).toBeLessThan(WAVE_ORB_THEMES.thinking.ribbonWobble);
  });

  it('thinking is brighter than every other state (faster + brighter)', () => {
    for (const state of ALL_STATES) {
      if (state === 'thinking') continue;
      expect(WAVE_ORB_THEMES.thinking.brightness).toBeGreaterThan(WAVE_ORB_THEMES[state].brightness);
    }
    expect(WAVE_ORB_THEMES.thinking.ribbonSpeed).toBeGreaterThan(WAVE_ORB_THEMES.speaking.ribbonSpeed);
  });

  it('speaking pumps hardest: audio scale + audio wobble are the maximum', () => {
    for (const state of ALL_STATES) {
      if (state === 'speaking') continue;
      expect(WAVE_ORB_THEMES.speaking.audioScale).toBeGreaterThan(WAVE_ORB_THEMES[state].audioScale);
      expect(WAVE_ORB_THEMES.speaking.audioWobble).toBeGreaterThan(WAVE_ORB_THEMES[state].audioWobble);
    }
  });

  it('error is the most agitated non-thinking state (red tint rides the palette)', () => {
    expect(WAVE_ORB_THEMES.error.shellRim).toBeGreaterThan(WAVE_ORB_THEMES.idle.shellRim);
    expect(WAVE_ORB_THEMES.error.ribbonWobble).toBeGreaterThan(WAVE_ORB_THEMES.idle.ribbonWobble);
    // The red tint itself is asserted in orb.test.tsx via resolveOrbColors('error').
  });

  it('waveThemeForState falls back to idle for unknown states', () => {
    expect(waveThemeForState('idle')).toBe(WAVE_ORB_THEMES.idle);
    expect(waveThemeForState('nope' as never)).toBe(WAVE_ORB_THEMES.idle);
  });
});

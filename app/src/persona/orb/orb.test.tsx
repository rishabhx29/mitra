// Logic-only unit tests for the persona module (plan Task A).
// Pure functions/classes only — no jsdom, no WebGL, no electron, no three.
// Covers: SmoothedValue lerp math, orbTheme state→color mapping, wawa-lipsync
// viseme → VRM expression mapping, VRM license-meta extraction.

import { describe, expect, it } from 'vitest';
import { SmoothedValue } from './SmoothedValue';
import {
  FALLBACK_ORB_COLORS,
  mixHex,
  ORB_STATE_THEMES,
  parseHexColor,
  resolveOrbColors,
} from './orbTheme';
import {
  amplitudeMouthWeights,
  VISEME_TO_VRM,
  visemeToVrmWeights,
  VRM_VISEME_NAMES,
} from '../avatar/lipsync';
import { extractLicenseMeta } from '../avatar/licenseMeta';

// ---------------------------------------------------------------------------
// SmoothedValue (adapted from samantha-ui, MIT)
// ---------------------------------------------------------------------------

describe('SmoothedValue', () => {
  it('starts at the initial value with matching target', () => {
    const s = new SmoothedValue(0.42);
    expect(s.value).toBe(0.42);
    expect(s.target).toBe(0.42);
  });

  it('does not move until update() is called', () => {
    const s = new SmoothedValue(0);
    s.set(1);
    expect(s.value).toBe(0);
  });

  it('moves monotonically toward the target and never overshoots', () => {
    const s = new SmoothedValue(0);
    s.set(1);
    let previous = 0;
    for (let i = 0; i < 100; i++) {
      const v = s.update(1 / 60, 10);
      expect(v).toBeGreaterThan(previous);
      expect(v).toBeLessThanOrEqual(1); // no overshoot past the target
      previous = v;
    }
    // ~100 frames at factor 1/6 → converged (within float epsilon).
    expect(previous).toBeCloseTo(1, 5);
  });

  it('clamps the lerp factor so a huge delta lands exactly on the target', () => {
    const s = new SmoothedValue(0);
    s.set(5);
    // delta*speed >> 1 would overshoot without the clamp (reference bug).
    expect(s.update(10, 100)).toBe(5);
  });

  it('never moves when speed is 0', () => {
    const s = new SmoothedValue(2);
    s.set(8);
    expect(s.update(1 / 60, 0)).toBe(2);
  });

  it('matches the closed-form lerp when the factor stays below 1', () => {
    const s = new SmoothedValue(0.5);
    s.set(1);
    // delta 1, speed 0.25 → factor 0.25 → value = 0.5 + (1 - 0.5) * 0.25
    expect(s.update(1, 0.25)).toBeCloseTo(0.625, 12);
  });

  it('composes exponentially across frames (10 steps of factor 0.1)', () => {
    const s = new SmoothedValue(0);
    s.set(1);
    let value = 0;
    for (let i = 0; i < 10; i++) value = s.update(1, 0.1);
    // product of (1 - 0.1) ten times → 1 - 0.9^10
    expect(value).toBeCloseTo(1 - Math.pow(0.9, 10), 12);
  });

  it('tracks negative targets and target changes mid-flight', () => {
    const s = new SmoothedValue(0);
    s.set(-1);
    const afterNegative = s.update(0.5, 10);
    expect(afterNegative).toBeLessThan(0);
    s.set(1);
    const afterFlip = s.update(2, 10); // factor clamped to 1 → snaps to target
    expect(afterFlip).toBe(1);
  });

  it('reset() snaps value and target', () => {
    const s = new SmoothedValue(0);
    s.set(3);
    s.update(1 / 60, 10);
    s.reset(0.5);
    expect(s.value).toBe(0.5);
    expect(s.target).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// orbTheme — state → color/behavior mapping (samantha-ui + my-jarvis ports)
// ---------------------------------------------------------------------------

const ALL_STATES = ['idle', 'listening', 'thinking', 'speaking', 'error'] as const;

describe('orbTheme', () => {
  it('defines a theme for every SessionState', () => {
    for (const state of ALL_STATES) {
      expect(ORB_STATE_THEMES[state]).toBeDefined();
    }
  });

  it('idle leaves the user palette untouched (accentWeight 0)', () => {
    expect(ORB_STATE_THEMES.idle.accentWeight).toBe(0);
    const resolved = resolveOrbColors('idle', { a: '#123456', b: '#654321' });
    expect(resolved.primary.toLowerCase()).toBe('#123456');
    expect(resolved.secondary.toLowerCase()).toBe('#654321');
  });

  it('maps each state to a distinct accent color (my-jarvis palette)', () => {
    // listening → pink-red, thinking → amber, speaking → teal, error → deep red
    expect(ORB_STATE_THEMES.listening.accent.toLowerCase()).toBe('#ff2d55');
    expect(ORB_STATE_THEMES.thinking.accent.toLowerCase()).toBe('#ff9500');
    expect(ORB_STATE_THEMES.speaking.accent.toLowerCase()).toBe('#00e5b0');
    expect(ORB_STATE_THEMES.error.accent.toLowerCase()).toBe('#dc2626');
  });

  it('speaking morphs to liquid silk and reacts most to audio; thinking ignores audio', () => {
    expect(ORB_STATE_THEMES.speaking.shapeMorph).toBe(1);
    expect(ORB_STATE_THEMES.speaking.audioResponse).toBeGreaterThan(0);
    expect(ORB_STATE_THEMES.thinking.audioResponse).toBe(0);
    expect(ORB_STATE_THEMES.thinking.emissivePulse).toBeDefined();
  });

  it('error tints the user palette strongly toward red', () => {
    const resolved = resolveOrbColors('error', { a: '#4f8cff', b: '#b26bff' });
    const [r, g, b] = parseHexColor(resolved.primary) as [number, number, number];
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    // Strong tint: closer to the accent than to the original blue.
    const accent = parseHexColor(ORB_STATE_THEMES.error.accent) as [number, number, number];
    const original = parseHexColor('#4f8cff') as [number, number, number];
    const dAccent = Math.abs(r - accent[0]) + Math.abs(g - accent[1]) + Math.abs(b - accent[2]);
    const dOriginal = Math.abs(r - original[0]) + Math.abs(g - original[1]) + Math.abs(b - original[2]);
    expect(dAccent).toBeLessThan(dOriginal);
  });

  it('falls back to the default palette for invalid user colors instead of throwing', () => {
    const resolved = resolveOrbColors('listening', { a: 'not-a-color', b: undefined });
    expect(resolved.primary.toLowerCase()).toBe(
      mixHex(FALLBACK_ORB_COLORS.a, ORB_STATE_THEMES.listening.accent, ORB_STATE_THEMES.listening.accentWeight).toLowerCase(),
    );
    expect(resolved.primary).toMatch(/^#[0-9a-f]{6}$/i);
    expect(resolved.secondary).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('parseHexColor handles 3/6-digit forms and rejects garbage', () => {
    expect(parseHexColor('#ff0000')).toEqual([1, 0, 0]);
    expect(parseHexColor('f00')).toEqual([1, 0, 0]);
    expect(parseHexColor('#00ff0080')).toBeNull(); // 8-digit not supported
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('')).toBeNull();
    expect(parseHexColor('zzz')).toBeNull();
  });

  it('mixHex interpolates linearly and degrades on bad input', () => {
    expect(mixHex('#000000', '#ffffff', 0).toLowerCase()).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1).toLowerCase()).toBe('#ffffff');
    const mid = parseHexColor(mixHex('#000000', '#ffffff', 0.5)) as [number, number, number];
    expect(mid.every((c) => Math.abs(c - 0.5) < 0.01)).toBe(true);
    expect(mixHex('#000000', 'bogus', 0.5).toLowerCase()).toBe('#000000'); // degrade to valid side
    expect(mixHex('x', 'y', 0.5)).toBe('#ffffff'); // both invalid → white, no throw
  });
});

// ---------------------------------------------------------------------------
// lipsync — wawa-lipsync viseme → VRM aa/ih/ou/ee/oh mapping
// ---------------------------------------------------------------------------

describe('lipsync viseme mapping', () => {
  it('maps the five vowel visemes to the five VRM mouth expressions', () => {
    expect(VISEME_TO_VRM.viseme_aa).toBe('aa');
    expect(VISEME_TO_VRM.viseme_E).toBe('ee');
    expect(VISEME_TO_VRM.viseme_I).toBe('ih');
    expect(VISEME_TO_VRM.viseme_O).toBe('oh');
    expect(VISEME_TO_VRM.viseme_U).toBe('ou');
  });

  it('closes the mouth for silence and all consonant visemes', () => {
    const closed = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    expect(visemeToVrmWeights('viseme_sil')).toEqual(closed);
    for (const consonant of [
      'viseme_PP',
      'viseme_FF',
      'viseme_TH',
      'viseme_DD',
      'viseme_kk',
      'viseme_CH',
      'viseme_SS',
      'viseme_nn',
      'viseme_RR',
    ]) {
      expect(visemeToVrmWeights(consonant)).toEqual(closed);
    }
  });

  it('scales the open expression by volume and clamps it', () => {
    const half = visemeToVrmWeights('viseme_aa', 0.5);
    expect(half.aa).toBeCloseTo(0.5);
    expect(half.ih).toBe(0);
    expect(visemeToVrmWeights('viseme_aa', 2).aa).toBe(1);
    expect(visemeToVrmWeights('viseme_aa', -1).aa).toBe(0);
  });

  it('degrades defensively: unknown / missing visemes yield all-zero weights', () => {
    const closed = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    expect(visemeToVrmWeights('viseme_made_up')).toEqual(closed);
    expect(visemeToVrmWeights('')).toEqual(closed);
    expect(visemeToVrmWeights(null)).toEqual(closed);
    expect(visemeToVrmWeights(undefined)).toEqual(closed);
  });

  it('covers every wawa-lipsync viseme value (Oculus LipSync set)', () => {
    // wawa-lipsync VISEMES: sil, PP, FF, TH, DD, kk, CH, SS, nn, RR, aa, E, I, O, U
    expect(Object.keys(VISEME_TO_VRM)).toHaveLength(15);
    for (const name of VRM_VISEME_NAMES) {
      expect(['aa', 'ih', 'ou', 'ee', 'oh']).toContain(name);
    }
  });

  it('amplitudeMouthWeights drives only aa, clamped (mock fallback)', () => {
    expect(amplitudeMouthWeights(0.25)).toEqual({ aa: 0.25, ih: 0, ou: 0, ee: 0, oh: 0 });
    expect(amplitudeMouthWeights(9).aa).toBe(1);
    expect(amplitudeMouthWeights(-3).aa).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// licenseMeta — VRM embedded license extraction
// ---------------------------------------------------------------------------

describe('licenseMeta extraction', () => {
  it('extracts VRM 1.0 meta fields into display info', () => {
    const info = extractLicenseMeta({
      metaVersion: '1',
      name: 'Test Avatar',
      version: '2.1',
      authors: ['Alice', 'Bob'],
      copyrightInformation: '(c) 2026 Alice',
      licenseUrl: 'https://example.com/license',
      avatarPermission: 'everyone',
      commercialUsage: 'personalNonProfit',
      allowExcessivelyViolentUsage: false,
      allowExcessivelySexualUsage: false,
      creditNotation: 'required',
      allowRedistribution: false,
      modification: 'prohibited',
    });
    expect(info).not.toBeNull();
    expect(info?.title).toBe('Test Avatar');
    expect(info?.version).toBe('2.1');
    expect(info?.authors).toEqual(['Alice', 'Bob']);
    expect(info?.copyright).toBe('(c) 2026 Alice');
    expect(info?.licenseUrl).toBe('https://example.com/license');
    expect(info?.usageNotes).toContain('Avatar permission: everyone');
    expect(info?.usageNotes).toContain('Commercial use: personal, non-profit use');
    expect(info?.usageNotes).toContain('Violent content: not permitted');
    expect(info?.usageNotes).toContain('Sexual content: not permitted');
    expect(info?.usageNotes).toContain('Credit: required');
    expect(info?.usageNotes).toContain('Redistribution: not permitted');
    expect(info?.usageNotes).toContain('Modification: prohibited');
  });

  it('extracts VRM 0.x meta fields (author, licenseName, usage enums)', () => {
    const info = extractLicenseMeta({
      metaVersion: '0',
      title: 'Old Avatar',
      author: 'Charlie',
      licenseName: 'CC_BY',
      allowedUserName: 'OnlyAuthor',
      commercialUssageName: 'Disallow',
      violentUssageName: 'Disallow',
      sexualUssageName: 'Allow',
    });
    expect(info).not.toBeNull();
    expect(info?.title).toBe('Old Avatar');
    expect(info?.authors).toEqual(['Charlie']);
    expect(info?.licenseLabel).toBe('CC BY');
    expect(info?.usageNotes).toContain('Avatar permission: OnlyAuthor');
    expect(info?.usageNotes).toContain('Commercial use: Disallow');
  });

  it('falls back to otherLicenseUrl for the VRM 0.x license link', () => {
    const info = extractLicenseMeta({
      metaVersion: '0',
      title: 'T',
      licenseName: 'Other',
      otherLicenseUrl: 'https://example.com/custom',
    });
    expect(info?.licenseUrl).toBe('https://example.com/custom');
    expect(info?.licenseLabel).toBe('Custom license (see license URL)');
  });

  it('returns null for missing / empty / non-object meta — never throws', () => {
    expect(extractLicenseMeta(null)).toBeNull();
    expect(extractLicenseMeta(undefined)).toBeNull();
    expect(extractLicenseMeta('nope')).toBeNull();
    expect(extractLicenseMeta(42)).toBeNull();
    expect(extractLicenseMeta({})).toBeNull(); // nothing usable
    expect(extractLicenseMeta({ metaVersion: '1' })).toBeNull();
  });

  it('is robust to malformed field types inside an otherwise valid meta', () => {
    const info = extractLicenseMeta({
      metaVersion: '1',
      name: 42, // wrong type
      authors: 'not-an-array',
      licenseUrl: 'https://example.com/license', // keeps the meta usable
    });
    expect(info).not.toBeNull();
    expect(info?.title).toBe('');
    expect(info?.authors).toEqual([]);
  });
});

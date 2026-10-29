// idle — pure idle-motion math tests (node-pure, no three.js: idle.ts imports
// nothing). Covers amplitude bounds, exact periods via fake timestamps, the
// blink envelope shape, double-blink scheduling paths with a seeded rng, and
// the blink-expression probe precedence.

import { describe, expect, it } from 'vitest';
import {
  BLINK_DURATION_MS,
  BLINK_GAP_MS,
  BLINK_INTERVAL_MAX_MS,
  BLINK_INTERVAL_MIN_MS,
  BREATHING_PERIOD_MS,
  BREATHING_SCALE,
  BREATHING_SPINE_RAD,
  DOUBLE_BLINK_PROBABILITY,
  HEAD_BOB_PITCH_PERIOD_MS,
  HEAD_BOB_RAD,
  HEAD_BOB_YAW_PERIOD_MS,
  SWAY_PERIOD_MS,
  SWAY_ROT_Y_RAD,
  SWAY_X_M,
  SWAY_Z_M,
  blinkWeight,
  breathingScale,
  breathingSpineRad,
  breathingWeight,
  createBlinkClock,
  headBob,
  isDoubleBlink,
  nextBlinkDelayMs,
  pickBlinkExpressions,
  swayOffsets,
  type ExpressionManagerLike,
} from './idle';

/** Deterministic rng (mulberry32) so blink schedules are exactly assertable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rng that replays a fixed sequence (repeating the last value forever). */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const fakeManager = (weights: Record<string, number | null>): ExpressionManagerLike => ({
  getValue: (name) => (name in weights ? weights[name] : null),
});

describe('breathing', () => {
  it('starts at rest, peaks at mid-cycle and is periodic', () => {
    expect(breathingWeight(0)).toBe(0);
    expect(breathingWeight(BREATHING_PERIOD_MS / 2)).toBeCloseTo(1, 9);
    expect(breathingWeight(BREATHING_PERIOD_MS)).toBeCloseTo(0, 9);
    expect(breathingWeight(1000)).toBeCloseTo(breathingWeight(1000 + BREATHING_PERIOD_MS), 9);
    // 0.22 Hz → ~4545ms period.
    expect(BREATHING_PERIOD_MS).toBeCloseTo(1000 / 0.22, 6);
  });

  it('stays within [0,1] across a dense sample', () => {
    for (let t = 0; t <= BREATHING_PERIOD_MS; t += 23) {
      const w = breathingWeight(t);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('gives a signed spine sway: 0 at rest, ±BREATHING_SPINE_RAD peaks, never beyond', () => {
    expect(breathingSpineRad(0)).toBe(0);
    expect(breathingSpineRad(BREATHING_PERIOD_MS / 4)).toBeCloseTo(BREATHING_SPINE_RAD, 9);
    expect(breathingSpineRad((3 * BREATHING_PERIOD_MS) / 4)).toBeCloseTo(-BREATHING_SPINE_RAD, 9);
    for (let t = 0; t <= BREATHING_PERIOD_MS; t += 17) {
      expect(Math.abs(breathingSpineRad(t))).toBeLessThanOrEqual(BREATHING_SPINE_RAD + 1e-12);
    }
  });

  it('gives a scale fallback exactly 1 at rest and within ±BREATHING_SCALE', () => {
    expect(breathingScale(0)).toBe(1);
    expect(breathingScale(BREATHING_PERIOD_MS / 4)).toBeCloseTo(1 + BREATHING_SCALE, 9);
    expect(breathingScale((3 * BREATHING_PERIOD_MS) / 4)).toBeCloseTo(1 - BREATHING_SCALE, 9);
    for (let t = 0; t <= BREATHING_PERIOD_MS; t += 17) {
      expect(breathingScale(t)).toBeGreaterThanOrEqual(1 - BREATHING_SCALE - 1e-12);
      expect(breathingScale(t)).toBeLessThanOrEqual(1 + BREATHING_SCALE + 1e-12);
    }
  });
});

describe('sway', () => {
  it('stays within its amplitude bounds and is periodic over SWAY_PERIOD_MS', () => {
    for (let t = 0; t <= SWAY_PERIOD_MS; t += 29) {
      const s = swayOffsets(t);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(SWAY_X_M + 1e-12);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(SWAY_Z_M + 1e-12);
      expect(Math.abs(s.rotY)).toBeLessThanOrEqual(SWAY_ROT_Y_RAD + 1e-12);
    }
    const a = swayOffsets(1234);
    const b = swayOffsets(1234 + SWAY_PERIOD_MS);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.z).toBeCloseTo(a.z, 9);
    expect(b.rotY).toBeCloseTo(a.rotY, 9);
  });

  it('drifts on a circular path — x peaks where z crosses zero', () => {
    const quarter = swayOffsets(SWAY_PERIOD_MS / 4);
    expect(quarter.x).toBeCloseTo(SWAY_X_M, 9);
    expect(quarter.z).toBeCloseTo(0, 9);
  });

  it('phase-shifts the yaw away from the lateral drift', () => {
    // rotY peaks at θ + π/3 = π/2 → t = period/12, where x is only sin(π/6) = 0.5 of max.
    const twelfth = swayOffsets(SWAY_PERIOD_MS / 12);
    expect(twelfth.rotY).toBeCloseTo(SWAY_ROT_Y_RAD, 9);
    expect(twelfth.x).toBeCloseTo(SWAY_X_M * Math.sin(Math.PI / 6), 9);
  });
});

describe('headBob', () => {
  it('is zero at rest and bounded by ±HEAD_BOB_RAD', () => {
    expect(headBob(0)).toEqual({ pitchRad: 0, yawRad: 0 });
    for (let t = 0; t <= 20000; t += 31) {
      const bob = headBob(t);
      expect(Math.abs(bob.pitchRad)).toBeLessThanOrEqual(HEAD_BOB_RAD + 1e-12);
      expect(Math.abs(bob.yawRad)).toBeLessThanOrEqual(HEAD_BOB_RAD + 1e-12);
    }
  });

  it('uses incommensurate periods for pitch and yaw', () => {
    expect(headBob(HEAD_BOB_PITCH_PERIOD_MS / 4).pitchRad).toBeCloseTo(HEAD_BOB_RAD, 9);
    expect(headBob(300).pitchRad).toBeCloseTo(headBob(300 + HEAD_BOB_PITCH_PERIOD_MS).pitchRad, 9);
    expect(headBob(300).yawRad).toBeCloseTo(headBob(300 + HEAD_BOB_YAW_PERIOD_MS).yawRad, 9);
    // The two axes do not share a period: at the pitch period the yaw has moved on.
    expect(headBob(HEAD_BOB_PITCH_PERIOD_MS).yawRad).not.toBeCloseTo(headBob(0).yawRad, 3);
  });
});

describe('blinkWeight', () => {
  it('is a sine half-wave peaking mid-blink and zero outside the window', () => {
    const start = 9000;
    expect(blinkWeight(start - 1, start)).toBe(0);
    expect(blinkWeight(start, start)).toBe(0);
    expect(blinkWeight(start + BLINK_DURATION_MS / 2, start)).toBeCloseTo(1, 9);
    expect(blinkWeight(start + BLINK_DURATION_MS, start)).toBe(0);
    expect(blinkWeight(start + BLINK_DURATION_MS + 5000, start)).toBe(0);
    for (let t = 1; t < BLINK_DURATION_MS; t += 7) {
      const w = blinkWeight(start + t, start);
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('is symmetric around the mid-blink peak', () => {
    const start = 4000;
    for (let t = 1; t < BLINK_DURATION_MS / 2; t += 9) {
      expect(blinkWeight(start + t, start)).toBeCloseTo(
        blinkWeight(start + BLINK_DURATION_MS - t, start),
        9,
      );
    }
  });
});

describe('blink scheduling primitives', () => {
  it('maps uniform samples to delays in [2s, 6s] and clamps bad input', () => {
    expect(nextBlinkDelayMs(0)).toBe(BLINK_INTERVAL_MIN_MS);
    expect(nextBlinkDelayMs(1)).toBe(BLINK_INTERVAL_MAX_MS);
    expect(nextBlinkDelayMs(0.5)).toBeCloseTo(
      (BLINK_INTERVAL_MIN_MS + BLINK_INTERVAL_MAX_MS) / 2,
      9,
    );
    expect(nextBlinkDelayMs(-5)).toBe(BLINK_INTERVAL_MIN_MS);
    expect(nextBlinkDelayMs(5)).toBe(BLINK_INTERVAL_MAX_MS);
  });

  it('flags ~15% of blinks as doubles with a strict threshold', () => {
    expect(isDoubleBlink(0)).toBe(true);
    expect(isDoubleBlink(DOUBLE_BLINK_PROBABILITY - 1e-9)).toBe(true);
    expect(isDoubleBlink(DOUBLE_BLINK_PROBABILITY)).toBe(false);
    expect(isDoubleBlink(0.99)).toBe(false);
    expect(isDoubleBlink(-1)).toBe(true); // clamps to 0
    expect(isDoubleBlink(2)).toBe(false); // clamps to 1
  });
});

describe('createBlinkClock', () => {
  it('waits 2–6s before the first blink and never blinks at t=0', () => {
    const clock = createBlinkClock(mulberry32(42));
    expect(clock.weightAt(0)).toBe(0);
    let firstStart: number | null = null;
    for (let t = 0; t <= 10000; t += 16) {
      if (clock.weightAt(t) > 0.5) {
        firstStart = t;
        break;
      }
    }
    expect(firstStart).not.toBeNull();
    expect(firstStart!).toBeGreaterThanOrEqual(BLINK_INTERVAL_MIN_MS);
    expect(firstStart!).toBeLessThanOrEqual(BLINK_INTERVAL_MAX_MS + 200);
  });

  it('plays an exact single-blink timeline (seeded rng, always 0.9)', () => {
    const clock = createBlinkClock(seqRng([0.9]));
    // rng#1 → initial delay 2000 + 0.9·4000 = 5600ms.
    expect(clock.weightAt(0)).toBe(0);
    expect(clock.weightAt(5599)).toBe(0);
    expect(clock.weightAt(5600)).toBe(0); // blink starts (envelope at 0)
    expect(clock.weightAt(5670)).toBeCloseTo(1, 9); // peak: start + 70ms
    expect(clock.weightAt(5739)).toBeGreaterThan(0);
    // rng#2 → not a double; rng#3 → next delay 5600ms from the blink's end (5740).
    expect(clock.weightAt(5740)).toBe(0);
    expect(clock.weightAt(10000)).toBe(0);
    expect(clock.weightAt(11340)).toBe(0); // next blink starts
    expect(clock.weightAt(11410)).toBeCloseTo(1, 9);
    expect(clock.weightAt(12000)).toBe(0);
  });

  it('plays an exact double-blink timeline (seeded rng, first sample path 0 → double → 0.5)', () => {
    const clock = createBlinkClock(seqRng([0, 0, 0.5]));
    // rng#1 → first blink at 2000ms; rng#2 → isDouble(0) = true.
    expect(clock.weightAt(2000)).toBe(0);
    expect(clock.weightAt(2070)).toBeCloseTo(1, 9); // peak of first blink
    expect(clock.weightAt(2140)).toBe(0); // first blink over
    // Second of the pair: 2000 + 140 + 260 = 2400.
    expect(clock.weightAt(2300)).toBe(0);
    expect(clock.weightAt(2400)).toBe(0);
    expect(clock.weightAt(2470)).toBeCloseTo(1, 9); // peak of second blink
    // rng#3 → post-pair delay 2000 + 0.5·4000 = 4000ms from the pair's end (2540).
    expect(clock.weightAt(2540)).toBe(0);
    expect(clock.weightAt(6000)).toBe(0);
    expect(clock.weightAt(6540)).toBe(0); // next single blink starts
    expect(clock.weightAt(6610)).toBeCloseTo(1, 9);
  });

  it('keeps every inter-blink gap either intra-pair (~400ms) or within [2s, 6s] + blink length', () => {
    const clock = createBlinkClock(mulberry32(7));
    const starts: number[] = [];
    let lastAboveHalf = -Infinity;
    for (let t = 0; t <= 60000; t += 16) {
      const w = clock.weightAt(t);
      if (w > 0.5) {
        if (t - lastAboveHalf > 200) starts.push(t); // new blink, not the same one
        lastAboveHalf = t;
      }
    }
    expect(starts.length).toBeGreaterThan(3);
    const intraPair = BLINK_DURATION_MS + BLINK_GAP_MS;
    const tolerance = 32; // two 16ms samples of start-detection slop
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      if (gap < 1000) {
        expect(Math.abs(gap - intraPair)).toBeLessThanOrEqual(tolerance);
      } else {
        expect(gap).toBeGreaterThanOrEqual(BLINK_DURATION_MS + BLINK_INTERVAL_MIN_MS - tolerance);
        expect(gap).toBeLessThanOrEqual(BLINK_DURATION_MS + BLINK_INTERVAL_MAX_MS + tolerance);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = createBlinkClock(mulberry32(123));
    const b = createBlinkClock(mulberry32(123));
    for (let t = 0; t <= 30000; t += 13) {
      expect(a.weightAt(t)).toBe(b.weightAt(t));
    }
  });
});

describe('pickBlinkExpressions', () => {
  it('prefers the VRM 1.0 preset name', () => {
    expect(pickBlinkExpressions(fakeManager({ blink: 0, Blink: 0 }))).toEqual(['blink']);
  });

  it('falls through the candidate list in order', () => {
    expect(pickBlinkExpressions(fakeManager({ Blink: 0 }))).toEqual(['Blink']);
    expect(pickBlinkExpressions(fakeManager({ BLINK: 0 }))).toEqual(['BLINK']);
    expect(pickBlinkExpressions(fakeManager({ fcl_mth_close: 0 }))).toEqual(['fcl_mth_close']);
  });

  it('uses a left/right pair when only per-eye shapes exist', () => {
    expect(pickBlinkExpressions(fakeManager({ Blink_L: 0, Blink_R: 0 }))).toEqual([
      'Blink_L',
      'Blink_R',
    ]);
    expect(pickBlinkExpressions(fakeManager({ blink_l: 0, blink_r: 0 }))).toEqual([
      'blink_l',
      'blink_r',
    ]);
  });

  it('needs BOTH eyes of a pair — a one-eyed shape is not a blink', () => {
    expect(pickBlinkExpressions(fakeManager({ Blink_L: 0 }))).toEqual([]);
  });

  it('returns an empty array (never throws) when nothing matches or values are null', () => {
    expect(pickBlinkExpressions(fakeManager({}))).toEqual([]);
    expect(pickBlinkExpressions(fakeManager({ blink: null, Blink_L: null, Blink_R: null }))).toEqual(
      [],
    );
  });
});

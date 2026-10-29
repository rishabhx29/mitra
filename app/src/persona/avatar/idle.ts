// idle — pure idle-life math for the VRM avatar: breathing, body sway, head
// bob and a randomized double-blink clock. Everything here is a pure function
// of an injected millisecond timestamp (plus an optional injected rng for the
// blink clock), so it is unit-testable in the node-only vitest environment and
// the motion is frame-rate independent (time-anchored, not delta-accumulated).
//
// Dependency-free by design: no three.js import — `ExpressionManagerLike` is a
// structural subset of three-vrm's VRMExpressionManager (same pattern as
// fit.ts's BoundsLike). VrmView consumes these per frame via useFrame and
// writes the results into normalized humanoid bones / the wrapper group.
//
// Amplitude budget: all offsets are deliberately small so the auto-fit camera
// (fit.ts, measured at rest pose pre-mount) stays valid — sway drifts the
// model by centimetres inside the 1.15× fit padding, breathing scales by
// ±0.2%, and bone rotations are ≤0.06 rad. Nothing here is gated on session
// state or audio: idle life runs whenever a model is on screen.

// ---------------------------------------------------------------------------
// Breathing — slow chest/spine motion at ~0.22 Hz (a resting adult breathes
// 12–16/min; 0.22 Hz ≈ 13.2/min). Applied to a chest/spine bone as a subtle
// rotation, or as whole-mesh scale on models without those bones.
// ---------------------------------------------------------------------------

/** Breath rate in Hz (≈ 13.2 breaths/min). */
export const BREATHING_HZ = 0.22;
/** Full breath cycle in ms: 1000 / 0.22 ≈ 4545. */
export const BREATHING_PERIOD_MS = 1000 / BREATHING_HZ;
/** Peak chest/spine sway in radians (±0.01 rad ≈ ±0.57°). */
export const BREATHING_SPINE_RAD = 0.01;
/** Peak whole-mesh scale deviation (±0.2% ≈ ±3mm on a 1.5m model). */
export const BREATHING_SCALE = 0.002;

/**
 * Breath cycle 0..1: 0 between breaths, 1 at peak inhale. Sine-raised from
 * cos so t=0 starts exactly at rest and the curve eases at both ends.
 */
export function breathingWeight(tMs: number): number {
  const theta = (2 * Math.PI * tMs) / BREATHING_PERIOD_MS;
  return (1 - Math.cos(theta)) / 2;
}

/**
 * Signed chest/spine rotation in radians: 0 at rest, peaks +BREATHING_SPINE_RAD
 * a quarter cycle in, −BREATHING_SPINE_RAD three quarters in (inhale/exhale).
 */
export function breathingSpineRad(tMs: number): number {
  const theta = (2 * Math.PI * tMs) / BREATHING_PERIOD_MS;
  return BREATHING_SPINE_RAD * Math.sin(theta);
}

/**
 * Whole-mesh breathing fallback for models without chest/spine bones: a
 * uniform scale factor oscillating 1 ± BREATHING_SCALE, exactly 1 at t=0.
 */
export function breathingScale(tMs: number): number {
  const theta = (2 * Math.PI * tMs) / BREATHING_PERIOD_MS;
  return 1 + BREATHING_SCALE * Math.sin(theta);
}

// ---------------------------------------------------------------------------
// Sway — slow weight-shifting drift of the whole model. The old implementation
// was a bare ±0.05 rad yaw with a ~15.7s period and no translation, which is
// below the perceptual threshold in a small overlay window; this combines an
// x/z Lissajous drift with a slightly phase-shifted rotation over a ~7s
// period so the body reads as subtly alive without ever leaving the frame.
// ---------------------------------------------------------------------------

/** Sway period in ms. */
export const SWAY_PERIOD_MS = 7000;
/** Peak lateral drift in world units (≈ ±1.2cm on a 1m-scale model). */
export const SWAY_X_M = 0.012;
/** Peak depth drift in world units (≈ ±8mm). */
export const SWAY_Z_M = 0.008;
/** Peak yaw rotation in radians (±0.06 rad ≈ ±3.4° about the model origin). */
export const SWAY_ROT_Y_RAD = 0.06;

/** Per-frame sway offsets applied to the avatar's wrapper group. */
export interface SwayOffsets {
  /** Position offset on x, world units. */
  x: number;
  /** Position offset on z, world units. */
  z: number;
  /** Yaw rotation in radians. */
  rotY: number;
}

/**
 * Sway offsets at `tMs`. x and z run a quarter-phase apart (circular drift
 * path — the model never just shuttles along one axis) and rotY is phase
 * shifted a further π/3 so rotation does not peak together with translation.
 */
export function swayOffsets(tMs: number): SwayOffsets {
  const theta = (2 * Math.PI * tMs) / SWAY_PERIOD_MS;
  return {
    x: SWAY_X_M * Math.sin(theta),
    z: SWAY_Z_M * Math.cos(theta),
    rotY: SWAY_ROT_Y_RAD * Math.sin(theta + Math.PI / 3),
  };
}

// ---------------------------------------------------------------------------
// Head bob — small slow rotations on the head bone so the head is not frozen
// relative to the swaying body. Two incommensurate periods (5.2s pitch,
// 6.1s yaw) so the compound motion never visibly loops.
// ---------------------------------------------------------------------------

/** Head pitch period in ms. */
export const HEAD_BOB_PITCH_PERIOD_MS = 5200;
/** Head yaw period in ms (deliberately not a multiple of the pitch period). */
export const HEAD_BOB_YAW_PERIOD_MS = 6100;
/** Peak head rotation per axis in radians (±0.01 rad ≈ ±0.57°). */
export const HEAD_BOB_RAD = 0.01;

/** Per-frame head-bob rotations applied to the head bone. */
export interface HeadBob {
  /** Rotation around x (nod), radians. */
  pitchRad: number;
  /** Rotation around y (turn), radians. */
  yawRad: number;
}

/** Head-bob rotations at `tMs`; both zero at t=0 (rest pose). */
export function headBob(tMs: number): HeadBob {
  return {
    pitchRad: HEAD_BOB_RAD * Math.sin((2 * Math.PI * tMs) / HEAD_BOB_PITCH_PERIOD_MS),
    yawRad: HEAD_BOB_RAD * Math.sin((2 * Math.PI * tMs) / HEAD_BOB_YAW_PERIOD_MS),
  };
}

// ---------------------------------------------------------------------------
// Blink — randomized 2–6s intervals with ~15% double-blinks. The old
// implementation hardcoded `setValue('blink', …)` on a metronomic t % 4
// schedule: it silently no-ops on models whose blink morph is registered
// under a different name (VRM 0.x / VRoid exports register `Blink`, some
// rigs only ship `Blink_L`/`Blink_R`, fcl-style rigs use `fcl_mth_close`),
// and even when it fired it did so at an exactly-regular 4s cadence.
// ---------------------------------------------------------------------------

/** One blink close-open duration in ms (fast, human-like). */
export const BLINK_DURATION_MS = 140;
/** Gap between the two blinks of a double-blink pair in ms. */
export const BLINK_GAP_MS = 260;
/** Minimum gap between the end of one blink and the start of the next, ms. */
export const BLINK_INTERVAL_MIN_MS = 2000;
/** Maximum gap between the end of one blink and the start of the next, ms. */
export const BLINK_INTERVAL_MAX_MS = 6000;
/** Chance that a blink is followed by a second blink. */
export const DOUBLE_BLINK_PROBABILITY = 0.15;

/**
 * Candidate expression names for the blink morph, in probe order: VRM 1.0
 * preset, VRM 0.x / VRoid capitalized export, all-caps variant, and the
 * fcl-style "mouth close" shape as a last resort.
 */
export const BLINK_EXPRESSION_CANDIDATES: readonly string[] = [
  'blink',
  'Blink',
  'BLINK',
  'fcl_mth_close',
];

/** Left/right blink pair candidates (some rigs only ship per-eye shapes). */
const BLINK_PAIR_CANDIDATES: readonly [string, string][] = [
  ['Blink_L', 'Blink_R'],
  ['blink_l', 'blink_r'],
];

/**
 * Structural subset of three-vrm's VRMExpressionManager: `getValue` returns
 * the expression's current weight, or null/undefined when no expression is
 * registered under that name (the documented missing-expression result).
 */
export interface ExpressionManagerLike {
  getValue: (name: string) => number | null | undefined;
}

/**
 * Probe an expression manager for a usable blink target. Returns the names to
 * drive each frame (a single midline name, or a left/right pair), or an empty
 * array when the model has no blink-like expression at all — callers must
 * treat that as "no blinking", never an error.
 */
export function pickBlinkExpressions(manager: ExpressionManagerLike): string[] {
  for (const name of BLINK_EXPRESSION_CANDIDATES) {
    if (manager.getValue(name) != null) return [name];
  }
  for (const [left, right] of BLINK_PAIR_CANDIDATES) {
    if (manager.getValue(left) != null && manager.getValue(right) != null) {
      return [left, right];
    }
  }
  return [];
}

/**
 * Blink envelope at `tMs` for a blink that started at `blinkStartMs`: a sine
 * half-wave, 0 → 1 (at start + BLINK_DURATION_MS/2) → 0. Exactly 0 before the
 * blink and after it ends.
 */
export function blinkWeight(tMs: number, blinkStartMs: number): number {
  const t = tMs - blinkStartMs;
  if (t < 0 || t >= BLINK_DURATION_MS) return 0;
  return Math.sin((t / BLINK_DURATION_MS) * Math.PI);
}

/**
 * Map a uniform random sample (0..1, clamped defensively) to the next
 * inter-blink delay in ms — uniformly distributed over [MIN, MAX].
 */
export function nextBlinkDelayMs(random01: number): number {
  const u = Math.min(1, Math.max(0, random01));
  return BLINK_INTERVAL_MIN_MS + u * (BLINK_INTERVAL_MAX_MS - BLINK_INTERVAL_MIN_MS);
}

/** Whether a blink with uniform sample `random01` is the first of a pair. */
export function isDoubleBlink(random01: number): boolean {
  return Math.min(1, Math.max(0, random01)) < DOUBLE_BLINK_PROBABILITY;
}

/** Stateful-but-injectable blink scheduler produced by {@link createBlinkClock}. */
export interface BlinkClock {
  /**
   * Blink envelope weight at timeline position `tMs` (ms). Advances the
   * schedule as needed; time-anchored, so frame drops never distort the
   * envelope shape — a blink that elapsed entirely between calls simply
   * reports 0 and reschedules.
   */
  weightAt: (tMs: number) => number;
}

/**
 * Create a blink clock. `rng` must return uniform 0..1 samples; defaults to
 * Math.random. Inject a seeded rng in tests for exact schedules. The first
 * blink starts 2–6s in (no blink at t=0), every blink runs the
 * {@link blinkWeight} envelope, ~15% of blinks are followed by a second one
 * BLINK_GAP_MS later, and the post-blink delay is 2–6s.
 */
export function createBlinkClock(rng: () => number = Math.random): BlinkClock {
  let nextBlinkAt = nextBlinkDelayMs(rng());
  let queuedSecondAt: number | null = null;
  let activeStart: number | null = null;

  return {
    weightAt(tMs: number): number {
      // A blink is active: play its envelope; on completion schedule what
      // follows (the queued second, or a fresh randomized delay).
      if (activeStart !== null) {
        if (tMs < activeStart + BLINK_DURATION_MS) {
          return blinkWeight(tMs, activeStart);
        }
        const start = activeStart;
        activeStart = null;
        if (queuedSecondAt !== null) {
          nextBlinkAt = queuedSecondAt; // queuedSecondAt stays set until its blink starts
        } else {
          nextBlinkAt = start + BLINK_DURATION_MS + nextBlinkDelayMs(rng());
        }
      }

      // No active blink: start one if the schedule is due. The envelope is
      // anchored to the scheduled start, not the frame that noticed it.
      if (tMs >= nextBlinkAt) {
        const start = nextBlinkAt;
        activeStart = start;
        if (queuedSecondAt !== null && queuedSecondAt === start) {
          queuedSecondAt = null; // this start IS the queued second — no new decision
        } else if (isDoubleBlink(rng())) {
          queuedSecondAt = start + BLINK_DURATION_MS + BLINK_GAP_MS;
        }
        return blinkWeight(tMs, start);
      }
      return 0;
    },
  };
}

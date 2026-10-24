// adapted from samantha-ui (MIT) — src/hooks/useSmoothValue.js `SmoothedValue` class.
// Frame-rate independent exponential smoothing toward a target, used to drive
// shader uniforms and transforms at 60fps without React re-renders.
//
// Difference vs the reference: the lerp factor `delta * speed` is clamped to
// [0, 1] so a large delta (tab restore, GC pause) can never overshoot the
// target; the reference let factor > 1 flip past the target.

/**
 * Holds a `value` that exponentially approaches `target` on every
 * {@link SmoothedValue.update} call.
 */
export class SmoothedValue {
  /** Current (smoothed) value. */
  value: number;
  /** Value the smoothing approaches. */
  target: number;

  constructor(initial: number) {
    this.value = initial;
    this.target = initial;
  }

  /** Change the target the value smooths toward. */
  set(target: number): void {
    this.target = target;
  }

  /** Snap value and target (used to seed state transitions without a ramp). */
  reset(value: number): void {
    this.value = value;
    this.target = value;
  }

  /**
   * Advance the smoothing by `delta` seconds and return the new value.
   * `speed` is the responsiveness: higher = faster convergence.
   * Factor is `clamp01(delta * speed)` so the result is frame-rate
   * independent and never overshoots.
   */
  update(delta: number, speed = 10): number {
    const factor = Math.min(1, Math.max(0, delta * speed));
    // same interpolation as THREE.MathUtils.lerp (a + (b - a) * t)
    this.value = this.value + (this.target - this.value) * factor;
    return this.value;
  }
}

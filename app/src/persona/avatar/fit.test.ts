// fit — pure framing-math tests (node-pure, no three.js: BoundsLike is plain
// objects). Covers the standard ~1.55m VRM case, scale linearity, aspect
// handling, the min-distance clamp and all degenerate-input nulls.

import { describe, expect, it } from 'vitest';
import { computeFullFrameCamera, MIN_FIT_DISTANCE, type BoundsLike } from './fit';

const bounds = (min: [number, number, number], max: [number, number, number]): BoundsLike => ({
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] },
});

const distanceOf = (fit: NonNullable<ReturnType<typeof computeFullFrameCamera>>): number =>
  fit.position[2] - fit.target[2];

/** Exact-fit distance for a height h filling a vertical fov: (h/2)/tan(fov/2). */
const exactFitDistance = (height: number, fovDeg: number): number =>
  height / 2 / Math.tan((fovDeg / 2) * (Math.PI / 180));

// Standard VRM: feet at y=0, head at ~1.55m, ~0.4m wide, ~0.3m deep.
const STANDARD_VRM = bounds([-0.2, 0, -0.15], [0.2, 1.55, 0.15]);

describe('computeFullFrameCamera', () => {
  it('frames a standard 1.55m VRM centred on its bbox centre at the exact-fit distance + padding', () => {
    const fit = computeFullFrameCamera(STANDARD_VRM, 38, 1);
    expect(fit).not.toBeNull();
    const { position, target } = fit!;

    expect(target).toEqual([0, 0.775, 0]);
    // Camera stays on the +z axis at centre height — the model is centred, not
    // pivoted at its feet like R3F's default (0,0,0) look-at.
    expect(position[0]).toBeCloseTo(0, 9);
    expect(position[1]).toBeCloseTo(0.775, 9);

    // Plausibility: the whole height must fit the vertical fov, with the 15%
    // padding on top. At fov 38° that is exactly ~1.45×height before padding
    // (1/(2·tan(19°))), ~1.67× after — so a 1.0–1.8×height band is the sane range.
    const distance = distanceOf(fit!);
    expect(distance).toBeCloseTo(exactFitDistance(1.55, 38) * 1.15, 9);
    expect(distance).toBeGreaterThan(1.0 * 1.55);
    expect(distance).toBeLessThan(1.8 * 1.55);
  });

  it('scales distance ~linearly for a 15-unit-tall model', () => {
    const k = 15 / 1.55;
    const giant = computeFullFrameCamera(
      bounds([-0.2 * k, 0, -0.15 * k], [0.2 * k, 15, 0.15 * k]),
      38,
      1,
    );
    const standard = computeFullFrameCamera(STANDARD_VRM, 38, 1);
    expect(giant).not.toBeNull();
    expect(standard).not.toBeNull();

    expect(giant!.target[1]).toBeCloseTo(7.5, 9);
    // Uniform scale → distance scales by the same factor.
    expect(distanceOf(giant!) / distanceOf(standard!)).toBeCloseTo(k, 9);
  });

  it('lets a wide model be width-bound on a square viewport and height-bound on a wide one', () => {
    // 3m wide, 1m tall billboard.
    const wide = bounds([-1.5, 0, -0.05], [1.5, 1, 0.05]);
    const square = computeFullFrameCamera(wide, 38, 1)!;
    // Horizontal term wins on a square viewport (3m across vs 1m tall).
    expect(distanceOf(square)).toBeCloseTo(exactFitDistance(3, 38) * 1.15, 9);

    const wide16x9ish = computeFullFrameCamera(wide, 38, 4)!;
    // aspect 4 → horizontal term quarters, the vertical term takes over.
    expect(distanceOf(wide16x9ish)).toBeCloseTo(exactFitDistance(1, 38) * 1.15, 9);
    expect(distanceOf(wide16x9ish)).toBeLessThan(distanceOf(square));
  });

  it('clamps tiny models to the minimum distance', () => {
    const miniature = computeFullFrameCamera(bounds([-0.01, 0.99, -0.01], [0.01, 1.01, 0.01]), 38, 1);
    expect(miniature).not.toBeNull();
    expect(distanceOf(miniature!)).toBeGreaterThanOrEqual(MIN_FIT_DISTANCE);
  });

  it('honours custom padding and keeps off-origin models centred', () => {
    // Model spanning x 1.8..2.2, y 2.0..3.55 — centre [2, 2.775, 0].
    const offOrigin = bounds([1.8, 2.0, -0.15], [2.2, 3.55, 0.15]);
    const fit = computeFullFrameCamera(offOrigin, 38, 1, 1.3);
    expect(fit).not.toBeNull();
    expect(fit!.target).toEqual([2, 2.775, 0]);
    expect(distanceOf(fit!)).toBeCloseTo(exactFitDistance(1.55, 38) * 1.3, 9);
    expect(fit!.position[0]).toBeCloseTo(2, 9);
  });

  it('returns null for degenerate bounds so callers keep their fallback', () => {
    // Zero size in every axis (a point).
    expect(computeFullFrameCamera(bounds([0, 0, 0], [0, 0, 0]), 38, 1)).toBeNull();
    // Inverted / empty box (max < min).
    expect(computeFullFrameCamera(bounds([0, 1, 0], [0.2, 0.5, 0.15]), 38, 1)).toBeNull();
    // Non-finite corners.
    expect(computeFullFrameCamera(bounds([NaN, 0, -0.15], [0.2, 1.55, 0.15]), 38, 1)).toBeNull();
    expect(
      computeFullFrameCamera(bounds([-Infinity, 0, -0.15], [0.2, 1.55, 0.15]), 38, 1),
    ).toBeNull();
  });

  it('returns null for invalid fov / aspect / non-finite results', () => {
    expect(computeFullFrameCamera(STANDARD_VRM, 0, 1)).toBeNull(); // tan(0) = 0
    expect(computeFullFrameCamera(STANDARD_VRM, -38, 1)).toBeNull(); // negative tangent
    expect(computeFullFrameCamera(STANDARD_VRM, 180, 1)).toBeNull(); // tan(90°) = Infinity
    expect(computeFullFrameCamera(STANDARD_VRM, NaN, 1)).toBeNull();
    expect(computeFullFrameCamera(STANDARD_VRM, 38, 0)).toBeNull();
    expect(computeFullFrameCamera(STANDARD_VRM, 38, -1)).toBeNull();
    expect(computeFullFrameCamera(STANDARD_VRM, 38, NaN)).toBeNull();
  });

  it('treats a nonsense padding as 1 instead of exploding the distance', () => {
    const padded = computeFullFrameCamera(STANDARD_VRM, 38, 1, 0)!;
    expect(distanceOf(padded)).toBeCloseTo(exactFitDistance(1.55, 38), 9);
  });
});

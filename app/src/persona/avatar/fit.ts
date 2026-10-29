// fit — pure framing math: compute a camera position/target that fits a
// model's bounding box fully in view (framing='full'), for ANY model scale.
//
// Dependency-free by design: `BoundsLike` is a structural subset of
// THREE.Box3 (min/max corners), so fit.test.ts needs no three.js and the
// math stays unit-testable in the node-only vitest environment (AGENTS.md).

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Structural subset of THREE.Box3 — satisfied by both Box3 and plain test objects. */
export interface BoundsLike {
  min: Vec3Like;
  max: Vec3Like;
}

export interface FullFrameCameraFit {
  /** Camera position: bbox centre pushed back along +z by the fit distance. */
  position: [number, number, number];
  /** Look-at point: the bbox centre. */
  target: [number, number, number];
}

/** Never move closer than this (world units) — avoids near-plane clipping on tiny models. */
export const MIN_FIT_DISTANCE = 0.5;

/**
 * Compute a full-frame camera for `bounds` seen by a perspective camera with
 * vertical `fovDeg` and viewport `aspect` (width/height).
 *
 * distance = max(sizeY / (2·tan(fov/2)),
 *                sizeX / (2·tan(fov/2)·aspect),
 *                sizeZ / (2·tan(fov/2)·aspect)) · padding
 *
 * The first term fits the height to the vertical FOV; the other two fit the
 * width/depth to the horizontal FOV (horizontal fov ≈ 2·atan(tan(fov/2)·aspect),
 * whose tan is tan(fov/2)·aspect). Camera sits on the +z axis at the bbox
 * centre + distance, looking at the centre.
 *
 * Returns null for anything unframeable (inverted/empty bounds, all-zero size,
 * non-finite inputs, fov with no tangent) so callers keep their fallback.
 */
export function computeFullFrameCamera(
  bounds: BoundsLike,
  fovDeg: number,
  aspect: number,
  padding = 1.15,
): FullFrameCameraFit | null {
  // Valid perspective fov is strictly (0, 180): tan(±90°) explodes and a
  // non-positive fov has no tangent fit at all.
  if (!Number.isFinite(fovDeg) || fovDeg <= 0 || fovDeg >= 180) return null;
  const halfFovTan = Math.tan((fovDeg / 2) * (Math.PI / 180));
  if (!Number.isFinite(halfFovTan) || halfFovTan <= 0) return null;
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  const safePadding = Number.isFinite(padding) && padding > 0 ? padding : 1;

  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  const centerZ = (bounds.min.z + bounds.max.z) / 2;
  const sizeX = bounds.max.x - bounds.min.x;
  const sizeY = bounds.max.y - bounds.min.y;
  const sizeZ = bounds.max.z - bounds.min.z;
  const sizes = [sizeX, sizeY, sizeZ];
  if (!sizes.every((size) => Number.isFinite(size))) return null;
  // Inverted (empty) box, or a single point — nothing to frame.
  if (sizes.some((size) => size < 0)) return null;
  if (sizes.every((size) => size === 0)) return null;

  const distance =
    Math.max(
      sizeY / (2 * halfFovTan),
      sizeX / (2 * halfFovTan * aspect),
      sizeZ / (2 * halfFovTan * aspect),
    ) * safePadding;
  if (!Number.isFinite(distance)) return null;

  const fitDistance = Math.max(MIN_FIT_DISTANCE, distance);
  return {
    position: [centerX, centerY, centerZ + fitDistance],
    target: [centerX, centerY, centerZ],
  };
}

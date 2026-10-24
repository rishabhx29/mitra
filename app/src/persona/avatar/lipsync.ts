// Pure viseme -> VRM expression mapping. No DOM, no three.js, no wawa-lipsync
// runtime import — unit-tested in node (orb.test.tsx).
//
// wawa-lipsync (MIT, _reference/wawa-lipsync) implements the Oculus LipSync
// viseme set (viseme_sil..viseme_U). VRM 1.0 defines five mouth expressions:
// aa / ih / ou / ee / oh (VRMExpressionPresetName).
//
// Mapping follows research/05-visuals-and-overlay.md §5: "wawa-lipsync (MIT) →
// map viseme → VRM expressions (aa/ih/ou/ee/oh); fallback single-`aa` amplitude
// morph if integration slips" (the fallback is amplitudeMouthWeights below).

/** VRM standard mouth expression names (VRMExpressionPresetName subset). */
export type VrmVisemeName = 'aa' | 'ih' | 'ou' | 'ee' | 'oh';

export const VRM_VISEME_NAMES: readonly VrmVisemeName[] = ['aa', 'ih', 'ou', 'ee', 'oh'];

/** Weights for the five VRM mouth expressions, each 0..1. */
export type VrmVisemeWeights = Record<VrmVisemeName, number>;

/** The string values of wawa-lipsync's VISEMES enum (structurally identical). */
export type WawaViseme =
  | 'viseme_sil'
  | 'viseme_PP'
  | 'viseme_FF'
  | 'viseme_TH'
  | 'viseme_DD'
  | 'viseme_kk'
  | 'viseme_CH'
  | 'viseme_SS'
  | 'viseme_nn'
  | 'viseme_RR'
  | 'viseme_aa'
  | 'viseme_E'
  | 'viseme_I'
  | 'viseme_O'
  | 'viseme_U';

/**
 * wawa-lipsync viseme → the VRM expression that should open.
 * - `aa` (open "ah")      → aa
 * - `E`  (eh, wide)       → ee
 * - `I`  (ih)             → ih
 * - `O`  (oh, rounded)    → oh
 * - `U`  (oo, tight)      → ou
 * - `sil` (silence)       → null (mouth closed)
 * - consonants PP/FF/TH/DD/kk/CH/SS/nn/RR → null (mouth closed; brief closures
 *   between vowels are what make speech look intelligible)
 */
export const VISEME_TO_VRM: Record<WawaViseme, VrmVisemeName | null> = {
  viseme_sil: null,
  viseme_PP: null,
  viseme_FF: null,
  viseme_TH: null,
  viseme_DD: null,
  viseme_kk: null,
  viseme_CH: null,
  viseme_SS: null,
  viseme_nn: null,
  viseme_RR: null,
  viseme_aa: 'aa',
  viseme_E: 'ee',
  viseme_I: 'ih',
  viseme_O: 'oh',
  viseme_U: 'ou',
};

export const CLOSED_MOUTH: VrmVisemeWeights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

/**
 * Map a wawa-lipsync viseme (plus its measured volume 0..1) to VRM expression
 * weights. Unknown visemes (defensive against lib changes) and closed visemes
 * yield all-zero weights. `volume` scales the open weight so quiet syllables
 * barely open the mouth; clamped 0..1 — never throws.
 */
export function visemeToVrmWeights(
  viseme: string | null | undefined,
  volume = 1,
): VrmVisemeWeights {
  const weights: VrmVisemeWeights = { ...CLOSED_MOUTH };
  if (!viseme) return weights;
  const target = VISEME_TO_VRM[viseme as WawaViseme];
  if (!target) return weights;
  weights[target] = Math.min(1, Math.max(0, volume));
  return weights;
}

/**
 * Fallback when no lipsync analysis is available (no audio element, or the
 * element is owned by another MediaElementSource): drive the `aa` expression
 * straight from the smoothed amplitude. Keeps the avatar visibly talking in
 * mock mode / degraded integrations.
 */
export function amplitudeMouthWeights(amplitude: number): VrmVisemeWeights {
  const weights: VrmVisemeWeights = { ...CLOSED_MOUTH };
  weights.aa = Math.min(1, Math.max(0, amplitude));
  return weights;
}

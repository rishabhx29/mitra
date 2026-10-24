// VrmView — loads a .vrm into the R3F scene and drives it per frame.
//
// Expression wiring pattern (expressionManager.setValue, auto-blink idea)
// adapted from amica (MIT) src/features/emoteController/expressionController.ts;
// loader setup follows @pixiv/three-vrm (MIT) official usage.
//
// NO bundled model (licensing — research/05 §3/§6): the URL always comes from
// the user (harness file input / settings). Load failures degrade to
// `onError` text, never throw.

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { extractLicenseMeta, type VrmLicenseInfo } from './licenseMeta';
import { VRM_VISEME_NAMES, type VrmVisemeWeights } from './lipsync';

const CLOSED: VrmVisemeWeights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

export interface VrmViewProps {
  /** Object URL / http URL of a user-supplied .vrm. Null → nothing rendered. */
  vrmUrl: string | null;
  /** Per-frame viseme weights target (written by the lipsync driver). */
  weightsRef: RefObject<VrmVisemeWeights>;
  /** Called with extracted embedded license meta after a successful load (null if none). */
  onReady?: (license: VrmLicenseInfo | null) => void;
  /** Called with a human-readable message on load failure. */
  onError?: (message: string) => void;
}

export function VrmView({ vrmUrl, weightsRef, onReady, onError }: VrmViewProps) {
  const groupRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);
  const [vrm, setVrm] = useState<VRM | null>(null);
  // Keep callbacks fresh for the async loader without reloading the model.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Load / swap / dispose on vrmUrl change.
  useEffect(() => {
    let cancelled = false;
    let loaded: VRM | null = null;
    setVrm(null);

    if (!vrmUrl) return;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      vrmUrl,
      (gltf) => {
        if (cancelled) return;
        const next = gltf.userData.vrm as VRM | undefined;
        if (!next) {
          onErrorRef.current?.('File loaded but contains no VRM model (.vrm expected).');
          return;
        }
        loaded = next;
        // Recommended VRM setup (three-vrm docs): cull + skeleton optimize.
        VRMUtils.removeUnnecessaryVertices(next.scene);
        VRMUtils.combineSkeletons(next.scene);
        if (next.meta.metaVersion === '0') {
          VRMUtils.rotateVRM0(next); // VRM 0.x models face the wrong way otherwise
        }
        next.scene.traverse((obj) => {
          obj.frustumCulled = false;
        });
        setVrm(next);
        onReadyRef.current?.(extractLicenseMeta(next.meta));
      },
      undefined,
      (err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load .vrm file.';
        onErrorRef.current?.(message);
      },
    );

    return () => {
      cancelled = true;
      if (loaded) {
        VRMUtils.deepDispose(loaded.scene);
      }
    };
  }, [vrmUrl]);

  // Per-frame: VRM update + smoothed viseme application + auto-blink.
  // (amica ExpressionController pattern: set current weights, update.)
  // R3F re-registers the latest callback per render, so `vrm` state is fresh.
  useFrame((_, rawDelta) => {
    if (!vrm) return;
    const delta = Math.min(0.1, rawDelta);
    timeRef.current += delta;
    vrm.update(delta);

    const manager = vrm.expressionManager;
    if (!manager) return;

    const target = weightsRef.current ?? CLOSED;
    // Smooth toward target so viseme changes do not snap.
    const k = Math.min(1, delta * 14);
    for (const name of VRM_VISEME_NAMES) {
      const value = manager.getValue(name) ?? 0;
      const next = value + (target[name] - value) * k;
      manager.setValue(name, next);
    }

    // Auto-blink (idea from amica AutoBlink, simplified): a quick 0.14s close
    // every ~4s. setValue on a missing expression is a no-op in three-vrm.
    const phase = timeRef.current % 4;
    const blink = phase < 0.14 ? Math.sin((phase / 0.14) * Math.PI) : 0;
    manager.setValue('blink', blink);

    // Gentle idle sway on the wrapper group.
    const group = groupRef.current;
    if (group) {
      group.rotation.y = Math.sin(timeRef.current * 0.4) * 0.05;
    }
  });

  if (!vrm) return null;
  return (
    <group ref={groupRef}>
      <primitive object={vrm.scene} />
    </group>
  );
}

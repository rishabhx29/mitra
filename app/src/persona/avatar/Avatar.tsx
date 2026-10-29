// Avatar — Mitra persona #2: user-supplied VRM character with viseme lip-sync.
//
// Composition: own <Canvas> (so PersonaStage can switch persona by rendering
// this instead of the orb canvas), wawa-lipsync driving VRM aa/ih/ou/ee/oh
// expressions (research/05 §5), and an embedded-license panel read from the
// model's meta (user-dropped models only — Mitra bundles no model).
//
// NO bundled model (licensing — research/05 §3/§6). Load failures and missing
// viseme-capable models degrade to text / amplitude fallback, never throw.

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { PerspectiveCamera, type Box3 } from 'three';
import { Lipsync } from 'wawa-lipsync';
import type { SessionState } from '../../shared/types';
import { VrmView } from './VrmView';
import { computeFullFrameCamera } from './fit';
import {
  amplitudeMouthWeights,
  visemeToVrmWeights,
  type VrmVisemeWeights,
} from './lipsync';
import type { VrmLicenseInfo } from './licenseMeta';

const CLOSED_MOUTH: VrmVisemeWeights = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export interface AvatarProps {
  /** URL (object URL or http) of a user-supplied .vrm file. Null → empty stage + hint. */
  vrmUrl: string | null;
  /** Session state; mouth only animates in `speaking`. */
  state?: SessionState;
  /** 0..1 amplitude fallback when no wawa-lipsync audio element is attached. */
  amplitude?: number;
  /**
   * Optional 60fps fallback amplitude source (read per frame, overrides
   * `amplitude`). Lets a host drive the fallback mouth without re-renders.
   */
  amplitudeRef?: RefObject<number>;
  /**
   * Audio element to analyse with wawa-lipsync. The element must have a `src`
   * (wawa taps it via createMediaElementSource). Optional — omit for the
   * amplitude fallback mouth.
   */
  audioEl?: RefObject<HTMLAudioElement | null>;
  /** Show the embedded-license panel (default true when a model is loaded). */
  licenseVisible?: boolean;
  /** Viewer mode: user-orbitable camera framed for a large window (default false). */
  orbit?: boolean;
  /** close = head-and-shoulders (small overlay); full = entire model visible. */
  framing?: 'close' | 'full';
  className?: string;
  /** Notified with the extracted embedded license meta on successful load. */
  onLicense?: (info: VrmLicenseInfo | null) => void;
}

/** Latest measured model bounds + a version bumped on every report (swap/unload). */
interface ModelBounds {
  box: Box3 | null;
  version: number;
}

/** Structural slice of drei's OrbitControls used for best-effort target sync. */
interface ControlsLike {
  target: { set: (x: number, y: number, z: number) => void };
  update: () => unknown;
}

export function Avatar({
  vrmUrl,
  state = 'idle',
  amplitude = 0,
  amplitudeRef,
  audioEl,
  licenseVisible = true,
  orbit = false,
  framing = 'close',
  className,
  onLicense,
}: AvatarProps) {
  const weightsRef = useRef<VrmVisemeWeights>({ ...CLOSED_MOUTH });
  const [error, setError] = useState<string | null>(null);
  const [license, setLicense] = useState<VrmLicenseInfo | null>(null);
  const boundsRef = useRef<ModelBounds>({ box: null, version: 0 });
  const boundsVersionRef = useRef(0);

  const showLicense = licenseVisible && vrmUrl !== null;

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      <Canvas
        dpr={[1, 2]}
        // Aim at head height (~1.25m on a standard ~1.55m VRM) for a
        // head-and-shoulders framing in the small overlay window. R3F aims
        // the default camera at (0,0,0) — the model's feet — unless a
        // `rotation` is passed (verified in @react-three/fiber events module:
        // "Always look at center by default ... unless cameraOptions.rotation").
        //
        // For framing='full' these hardcoded values are only the pre-load
        // fallback: once VrmView reports the model's bounds, FullFrameCamera
        // refits position + look-at to the actual bbox, so ANY model
        // scale/height lands fully in frame.
        camera={
          orbit
            ? { position: [0, 1.15, 2.8], fov: 35 }
            : framing === 'full'
              ? { position: [0, 0.85, 3.4], fov: 38 }
              : {
                  position: [0, 1.3, 1.7],
                  fov: 30,
                  rotation: [-Math.atan2(0.05, 1.7), 0, 0],
                }
        }
        gl={{ alpha: true, antialias: true }}
      >
        {orbit && <OrbitControls makeDefault target={[0, 1, 0]} enablePan={false} minDistance={1.2} maxDistance={5} />}
        <ambientLight intensity={1.1} />
        <directionalLight position={[1.5, 2.5, 2]} intensity={1.4} />
        <directionalLight position={[-2, 1, 1]} intensity={0.4} />
        <LipsyncDriver
          state={state}
          amplitude={amplitude}
          amplitudeRef={amplitudeRef}
          audioEl={audioEl}
          weightsRef={weightsRef}
        />
        <FullFrameCamera boundsRef={boundsRef} enabled={framing === 'full'} />
        <VrmView
          vrmUrl={vrmUrl}
          weightsRef={weightsRef}
          onReady={(info) => {
            setLicense(info);
            setError(null);
            onLicense?.(info);
          }}
          onBounds={(box) => {
            boundsVersionRef.current += 1;
            boundsRef.current = { box, version: boundsVersionRef.current };
          }}
          onError={setError}
        />
      </Canvas>

      {!vrmUrl && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center">
          <p className="text-xs text-zinc-400">
            No avatar loaded — drop a .vrm file to use this persona.
          </p>
        </div>
      )}

      {error && (
        <div className="absolute inset-x-3 bottom-16 rounded-md bg-red-950/80 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {showLicense && <AvatarLicensePanel info={license} />}
    </div>
  );
}

/**
 * In-canvas null component: when `enabled` (framing='full') and VrmView has
 * reported the loaded model's world-space bounds, refits the camera to the
 * model via computeFullFrameCamera — position on the bbox centre's +z axis,
 * look-at at the centre — so ANY model scale/height lands fully in frame.
 *
 * Applies once per bounds version and again on canvas resize (aspect change)
 * and when framing toggles back to 'full'. Until bounds arrive (and for
 * degenerate bounds) it does nothing, so the Canvas's hardcoded full camera
 * always stands first — there is never a flash of nothing. With OrbitControls
 * mounted (orbit mode), it also best-effort pivots the controls' target to the
 * model centre; orbiting itself is untouched. framing='close' never enables it.
 */
function FullFrameCamera({
  boundsRef,
  enabled,
}: {
  boundsRef: RefObject<ModelBounds>;
  enabled: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const appliedRef = useRef<{ version: number; aspect: number } | null>(null);
  const wasEnabledRef = useRef(false);

  useFrame(() => {
    const wasEnabled = wasEnabledRef.current;
    wasEnabledRef.current = enabled;
    if (!enabled) return;

    const { box, version } = boundsRef.current;
    if (!box) return; // nothing measured (yet / unload) — hardcoded fallback stands

    const aspect = size.height > 0 ? size.width / size.height : 1;
    const applied = appliedRef.current;
    // Re-arm on re-enable (R3F resets the camera when the `camera` prop changes
    // with framing) and on aspect change (resize) — not per frame otherwise.
    if (
      wasEnabled &&
      applied &&
      applied.version === version &&
      Math.abs(applied.aspect - aspect) < 1e-9
    ) {
      return;
    }

    // The fit math is perspective-specific; leave any other camera untouched.
    if (!(camera instanceof PerspectiveCamera)) return;
    const fit = computeFullFrameCamera(box, camera.fov, aspect);
    appliedRef.current = { version, aspect };
    if (!fit) return;

    camera.position.set(fit.position[0], fit.position[1], fit.position[2]);
    camera.lookAt(fit.target[0], fit.target[1], fit.target[2]);
    camera.updateProjectionMatrix();

    // Best-effort: pivot the orbit controls around the model centre too.
    if (controls && typeof controls.update === 'function' && controls.target) {
      controls.target.set(fit.target[0], fit.target[1], fit.target[2]);
      controls.update();
    }
  });

  return null;
}

/**
 * In-canvas null component: per frame it either analyses the attached audio
 * element with wawa-lipsync and writes viseme weights, or falls back to the
 * amplitude-driven `aa` morph (research/05 §5 fallback). Writes into
 * `weightsRef` only — no React state per frame.
 */
function LipsyncDriver({
  state,
  amplitude,
  amplitudeRef,
  audioEl,
  weightsRef,
}: {
  state: SessionState;
  amplitude: number;
  amplitudeRef?: RefObject<number>;
  audioEl?: RefObject<HTMLAudioElement | null>;
  weightsRef: RefObject<VrmVisemeWeights>;
}) {
  const lipsyncRef = useRef<Lipsync | null>(null);
  const connectedRef = useRef<HTMLAudioElement | null>(null);

  // Best-effort teardown of wawa's internal AudioContext (private field).
  useEffect(
    () => () => {
      const ls = lipsyncRef.current;
      if (ls) {
        try {
          (ls as unknown as { audioContext?: AudioContext }).audioContext?.close().catch(
            () => undefined,
          );
        } catch {
          // ignore
        }
      }
    },
    [],
  );

  useFrame(() => {
    if (state !== 'speaking') {
      weightsRef.current = { ...CLOSED_MOUTH };
      return;
    }

    const el = audioEl?.current ?? null;
    if (el) {
      let ls = lipsyncRef.current;
      if (!ls) {
        try {
          ls = new Lipsync({ fftSize: 2048, historySize: 10 });
          lipsyncRef.current = ls;
        } catch {
          lipsyncRef.current = null;
        }
      }
      if (ls) {
        if (connectedRef.current !== el) {
          try {
            ls.connectAudio(el); // throws if the element is owned by another source
          } catch {
            // degrade to amplitude fallback below
          } finally {
            connectedRef.current = el;
          }
        }
        try {
          ls.processAudio();
          const volume = clamp01((ls.features?.volume ?? 0.4) * 2.2);
          weightsRef.current = visemeToVrmWeights(ls.viseme, volume);
          return;
        } catch {
          // fall through to amplitude fallback
        }
      }
    }

    // Fallback (research/05 §5): single-`aa` morph from amplitude.
    const fallbackAmplitude = amplitudeRef ? clamp01(amplitudeRef.current) : amplitude;
    weightsRef.current = amplitudeMouthWeights(fallbackAmplitude);
  });

  return null;
}

/**
 * Renders the VRM's embedded license fields (title/authors/license/usage
 * notes) — surfaced from VrmView's onReady callback. Shows a "no metadata"
 * note when the model declares nothing, and never hides license URLs.
 */
export function AvatarLicensePanel({ info }: { info: VrmLicenseInfo | null }) {
  return (
    <div className="absolute bottom-2 left-2 right-2 rounded-md bg-black/55 px-3 py-2 text-[11px] leading-snug text-zinc-200 backdrop-blur-sm">
      {info ? (
        <>
          <div className="font-semibold text-zinc-100">
            {info.title || 'Unnamed model'}
            {info.version ? ` · v${info.version}` : ''}
          </div>
          {info.authors.length > 0 && <div>By {info.authors.join(', ')}</div>}
          {info.copyright && <div className="text-zinc-400">{info.copyright}</div>}
          <div>
            License: {info.licenseLabel}
            {info.licenseUrl && (
              <>
                {' '}
                <a
                  href={info.licenseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 underline"
                >
                  license document
                </a>
              </>
            )}
          </div>
          {info.usageNotes.length > 0 && (
            <div className="text-zinc-400">{info.usageNotes.join(' · ')}</div>
          )}
        </>
      ) : (
        <div className="text-zinc-400">
          This model embeds no license metadata — check its source before redistribution.
        </div>
      )}
    </div>
  );
}

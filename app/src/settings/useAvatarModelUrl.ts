// useAvatarModelUrl — shared avatar blob-URL loader for the Persona UI.
// Loads the persisted model via the idempotent set-avatar-file IPC (same-file
// copy returns fresh bytes) and hands back an object URL; on the FIRST visit
// ever (flag in localStorage) with no model set, it silently loads the bundled
// Seed-san sample so the Persona page always shows a real character — without
// ever re-triggering after the user deliberately unloads the model.
import { useEffect, useState } from 'react';
import type { Settings } from '../shared/types';
import { getMitra } from './mitraClient';

/** Pure decision for tests: auto-load the bundled sample only once, ever. */
export function shouldAutoSample(hasModel: boolean, alreadySampled: boolean): boolean {
  return !hasModel && !alreadySampled;
}

const FLAG = 'mitra.avatarAutoSampled';

export function useAvatarModelUrl(settings: Settings): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const mitra = getMitra();
    if (!mitra) return;
    let objectUrl: string | null = null;
    let disposed = false;

    const loadFrom = (sourcePath: string): void => {
      void mitra
        .setAvatarFile({ kind: 'pick', sourcePath })
        .then((res) => {
          if (disposed || !res.ok) return;
          objectUrl = URL.createObjectURL(new Blob([res.bytes], { type: 'model/gltf-binary' }));
          setUrl(objectUrl);
        })
        .catch(() => {
          /* thumbnail simply stays hidden */
        });
    };

    const stored = settings.avatarVrmPath;
    if (stored) {
      loadFrom(stored);
    } else if (
      shouldAutoSample(false, window.localStorage.getItem(FLAG) === '1')
    ) {
      // First visit ever: load the bundled sample once. The IPC persists the
      // path (main fires onSettingsChanged → App state refresh → this effect
      // re-runs with the stored path). The flag ensures an explicit Unload is
      // never overridden.
      window.localStorage.setItem(FLAG, '1');
      void mitra
        .setAvatarFile({ kind: 'sample', name: 'Seed-san.vrm' })
        .then((res) => {
          if (disposed || !res.ok) return;
          objectUrl = URL.createObjectURL(new Blob([res.bytes], { type: 'model/gltf-binary' }));
          setUrl(objectUrl);
        })
        .catch(() => {
          /* bundled sample missing from this build — thumbnail stays hidden */
        });
    }

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [settings.avatarVrmPath]);

  return url;
}

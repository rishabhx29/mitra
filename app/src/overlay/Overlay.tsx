// Overlay — top-level page for the overlay Electron window (?window=overlay).
// Loads settings via the preload bridge (window.mitra.getSettings) and mounts
// the SessionController. Detects the dev/e2e text-input flag (?dev=1).
// In a plain browser (no preload) it degrades to defaults — never throws.
import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { SessionController } from './SessionController';

/** Stable e2e contract: the overlay accepts ?dev=1 (search or hash) to show the dev input. */
export function isDevMode(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('dev') === '1') return true;
    return /(?:^|[?&#])dev=1(?:&|$)/.test(window.location.href);
  } catch {
    return false;
  }
}

export default function Overlay() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const api = window.mitra;
    if (!api) {
      setSettings(DEFAULT_SETTINGS); // plain-browser dev: run on defaults
      return;
    }
    api
      .getSettings()
      .then((s) => {
        if (alive) setSettings(s);
      })
      .catch(() => {
        if (alive) {
          setSettings(DEFAULT_SETTINGS);
          setLoadFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // Transparent until settings arrive — never flash a box in the overlay window.
  if (!settings) return <div className="h-full w-full bg-transparent" />;

  return (
    <>
      {loadFailed && (
        <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1 text-[8px] text-amber-300">
          defaults
        </div>
      )}
      <SessionController settings={settings} devMode={isDevMode()} />
    </>
  );
}

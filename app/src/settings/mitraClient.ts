// window.mitra access for the settings renderer (Task E).
//
// In the Electron app the preload exposes the typed MitraApi (shared/ipc.ts).
// Outside it (plain-browser dev, vitest), getSettings/setSettings degrade to an
// in-memory fallback so the UI still renders and never throws (mock-mode rule).

import type { MitraApi } from '../shared/ipc';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';

/** The real preload API, or null outside Electron. */
export function getMitra(): MitraApi | null {
  return typeof window !== 'undefined' && window.mitra ? window.mitra : null;
}

/** Deep-enough copy so fallback callers can never mutate DEFAULT_SETTINGS. */
function copySettings(s: Settings): Settings {
  return {
    ...s,
    orbColors: { ...s.orbColors },
    permissions: { ...s.permissions },
    apps: s.apps.map((a) => ({ ...a })),
    notion: { ...s.notion },
  };
}

/**
 * Local fallback when window.mitra is absent: settings live in memory for the
 * page session only. Not persisted — the header shows a hint in that case.
 */
export function createLocalFallbackApi(): MitraApi {
  let current: Settings = copySettings(DEFAULT_SETTINGS);
  return {
    getSettings: async () => copySettings(current),
    setSettings: async (patch) => {
      current = copySettings({ ...current, ...patch });
      return copySettings(current);
    },
    hideOverlay: () => {},
    onSessionEvent: () => () => {},
    onOverlayShown: () => () => {},
    onOverlayHidden: () => () => {},
    toggleAvatarFullscreen: () => {},
    // No main process to log to — degrade honestly (mock-mode rule), never throw.
    reportTranscript: () => {},
    // Browser preview has no main process to copy files into userData —
    // degrade honestly (mock-mode rule), never throw.
    setAvatarFile: async () => ({ ok: false, error: 'copy-failed' }),
    getPathForFile: () => '',
  };
}

/** Preload API when present, otherwise the local fallback (never null, never throws). */
export function resolveMitraApi(): { api: MitraApi; persisted: boolean } {
  const real = getMitra();
  if (real) return { api: real, persisted: true };
  return { api: createLocalFallbackApi(), persisted: false };
}

// IPC channel names + the typed preload API. SHELL (Task B) implements; renderer consumes.
import type { Settings, SessionState, TranscriptEntry } from './types';

export const IPC = {
  toggleOverlay: 'mitra:toggle-overlay',
  overlayShown: 'mitra:overlay-shown',
  overlayHidden: 'mitra:overlay-hidden',
  sessionEvent: 'mitra:session-event',
  getSettings: 'mitra:get-settings',
  setSettings: 'mitra:set-settings',
  hideOverlay: 'mitra:hide-overlay',
} as const;

export type SessionEvent =
  | { kind: 'state'; state: SessionState }
  | { kind: 'transcript'; entry: TranscriptEntry }
  | { kind: 'tool-result'; result: { ok: boolean; summary: string } };

export interface MitraApi {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  hideOverlay(): void;
  onSessionEvent(cb: (e: SessionEvent) => void): () => void;
  /** Fired when the main process summons the overlay (hotkey/tray) — start a fresh session. */
  onOverlayShown(cb: () => void): () => void;
  /** Fired when the overlay is hidden (hotkey/Escape/app switch) — stop the session. */
  onOverlayHidden(cb: () => void): () => void;
}

declare global {
  interface Window {
    mitra: MitraApi;
  }
}

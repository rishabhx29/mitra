// IPC channel names + the typed preload API. SHELL (Task B) implements; renderer consumes.
import type { Settings, SessionState, TranscriptEntry } from './types';

export const IPC = {
  toggleOverlay: 'mitra:toggle-overlay',
  overlayShown: 'mitra:overlay-shown',
  overlayHidden: 'mitra:overlay-hidden',
  sessionEvent: 'mitra:session-event',
  /** Renderer → main: one provider transcript entry for the settings Conversation log. */
  reportTranscript: 'mitra:report-transcript',
  getSettings: 'mitra:get-settings',
  setSettings: 'mitra:set-settings',
  hideOverlay: 'mitra:hide-overlay',
  setAvatarFile: 'mitra:set-avatar-file',
  toggleAvatarFullscreen: 'mitra:toggle-avatar-fullscreen',
  /** Open/close the Console window (docs/CONSOLE_PLAN.md; singleton, Esc also closes). */
  toggleConsole: 'mitra:toggle-console',
} as const;

export type SessionEvent =
  | { kind: 'state'; state: SessionState }
  | { kind: 'transcript'; entry: TranscriptEntry }
  | { kind: 'tool-result'; result: { ok: boolean; summary: string } };

/** Payload for mitra:set-avatar-file: copy a bundled sample (by name), or a user-picked .vrm. */
export type SetAvatarFilePayload = { kind: 'sample'; name?: string } | { kind: 'pick'; sourcePath: string };

/**
 * Bundled sample avatars (packed under assets/avatars/, shown as one-click chips).
 * Provenance + licensing in app/assets/avatars/ATTRIBUTION.md; each model's own
 * embedded license meta is displayed in-app when it loads.
 */
export const SAMPLE_AVATARS = [
  { file: 'Seed-san.vrm', label: 'Seed-san' },
  { file: 'Twintail_Sample.vrm', label: 'Twintail' },
  { file: 'AvatarSample_B.vrm', label: 'Avatar B' },
  { file: 'AvatarSample_D.vrm', label: 'Avatar D' },
] as const;

/** Stable error codes — the renderer maps them to i18n strings (main stays locale-free). */
export type SetAvatarFileError = 'invalid-extension' | 'source-missing' | 'copy-failed';

export type SetAvatarFileResult =
  | {
      ok: true;
      /** Stored absolute path: <userData>/avatars/current.vrm (also persisted to settings). */
      path: string;
      /**
       * Model bytes so the renderer can build a blob object URL for the preview
       * without a file:// fetch (blocked on the dev http:// renderer origin).
       */
      bytes: ArrayBuffer;
    }
  | { ok: false; error: SetAvatarFileError };

export interface MitraApi {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  hideOverlay(): void;
  onSessionEvent(cb: (e: SessionEvent) => void): () => void;
  /**
   * Renderer → main: report one transcript entry from the local voice session.
   * Main forwards it as a {kind:'transcript'} SessionEvent to the settings
   * window's Conversation log (the overlay circle shows only the newest reply).
   */
  reportTranscript(entry: TranscriptEntry): void;
  /** Fired when the main process summons the overlay (hotkey/tray) — start a fresh session. */
  onOverlayShown(cb: () => void): () => void;
  /** Fired when the overlay is hidden (hotkey/Escape/app switch) — stop the session. */
  onOverlayHidden(cb: () => void): () => void;
  /** Open/close the fullscreen avatar viewer window (singleton; Esc also closes it). */
  toggleAvatarFullscreen(): void;
  /** Open/close the Console chat window (singleton; Esc also closes it). */
  toggleConsole(): void;
  /**
   * Copy a .vrm (picked file or bundled sample) into userData/avatars/current.vrm
   * (atomic write, mkdir -p), persist Settings.avatarVrmPath, and return the
   * stored path + model bytes for the preview. Startup reload passes the stored
   * path back in as `sourcePath` — the copy is idempotent and returns fresh bytes.
   */
  setAvatarFile(payload: SetAvatarFilePayload): Promise<SetAvatarFileResult>;
  /** Absolute filesystem path of a picked File (File.path was removed in Electron ≥32). */
  getPathForFile(file: File): string;
}

declare global {
  interface Window {
    mitra: MitraApi;
  }
}

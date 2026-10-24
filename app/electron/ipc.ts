// IPC registration: settings get/set (zod-validated, persisted), hide/toggle overlay,
// avatar file copy (mitra:set-avatar-file). Electron's `ipcMain` is injected so vitest
// can invoke the handlers against fakes — this module never imports electron at runtime.
// Channel names come from the frozen shared/ipc.ts contract.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, SAMPLE_AVATARS } from '../src/shared/ipc';
import type { SessionEvent, SetAvatarFilePayload, SetAvatarFileResult } from '../src/shared/ipc';
import type { Settings, TranscriptEntry } from '../src/shared/types';
import { sanitizeSettings, type SettingsStore } from './store';
import type { OverlayController } from './windows/overlay';

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

/** The subset of node:fs the avatar copy needs (injected for tests, like store.ts). */
export interface AvatarFs {
  existsSync(path: string): boolean;
  readFileSync(path: string): Buffer;
  writeFileSync(path: string, data: Buffer): void;
  renameSync(from: string, to: string): void;
  mkdirSync(path: string, options: { recursive: true }): void;
  unlinkSync(path: string): void;
}

export const defaultAvatarFs: AvatarFs = {
  existsSync,
  readFileSync: (p) => readFileSync(p),
  writeFileSync: (p, data) => writeFileSync(p, data),
  renameSync,
  mkdirSync,
  unlinkSync,
};

/**
 * Bundled sample VRMs (assets/avatars/, provenance + licensing in
 * app/assets/avatars/ATTRIBUTION.md; each model's embedded meta is shown in-app
 * on load). Resolved per run layout:
 *   - dev (electron-vite builds main to out/main): out/main → ../../assets → <app>/assets
 *   - packaged: app.asar/out/main → ../assets → app.asar/assets (electron-builder packs assets/)
 *   - vitest/source: electron/ → ../assets → <app>/assets
 * `name` must be a file from the SAMPLE_AVATARS allowlist (blocks path traversal).
 * Returns the first candidate that exists, or null — never throws.
 */
export function resolveBundledSampleVrmPath(
  fs: Pick<AvatarFs, 'existsSync'> = defaultAvatarFs,
  name: string = SAMPLE_AVATARS[0].file,
): string | null {
  if (!SAMPLE_AVATARS.some((s) => s.file === name)) return null;
  const candidates = [
    join(__dirname, `../../assets/avatars/${name}`),
    join(__dirname, `../assets/avatars/${name}`),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // unreadable candidate path → try the next one
    }
  }
  return null;
}

export interface RegisterIpcDeps {
  ipcMain: IpcMainLike;
  store: SettingsStore;
  overlay: OverlayController;
  /** Called after settings were changed and persisted (main re-registers the hotkey here). */
  onSettingsChanged?: (next: Settings, previous: Settings) => void;
  /**
   * Session-event sink for renderer-reported transcripts (mitra:report-transcript):
   * main broadcasts {kind:'transcript'} events to the settings window's Conversation
   * log. Injected so vitest can observe the dispatch without electron.
   */
  onSessionEvent?: (event: SessionEvent) => void;
  /** Toggles the fullscreen avatar viewer window (main creates/closes the singleton). */
  onToggleAvatarFullscreen?: () => void;
  /** userData dir for the avatar copy target (main passes app.getPath('userData')). */
  userDataDir?: string;
  /** fs subset for the avatar copy; defaults to real node fs. */
  avatarFs?: AvatarFs;
  /** Resolves a bundled sample .vrm by allowlisted name; defaults to resolveBundledSampleVrmPath(). */
  resolveSampleVrmPath?: (sampleName?: string) => string | null;
}

export function registerIpcHandlers(deps: RegisterIpcDeps): void {
  const { ipcMain, store, overlay } = deps;

  ipcMain.handle(IPC.getSettings, () => store.load());

  ipcMain.handle(IPC.setSettings, (_event, patch: unknown) => {
    const previous = store.load();
    const next = applySettingsPatch(previous, patch);
    store.save(next);
    deps.onSettingsChanged?.(next, previous);
    return next;
  });

  // Escape key path: overlay renderer sends mitra:hide-overlay (shared/ipc.ts contract).
  ipcMain.on(IPC.hideOverlay, () => overlay.hide());

  ipcMain.on(IPC.toggleOverlay, () => overlay.toggle());

  // Avatar persistence: copy the picked/bundled .vrm into userData, persist the
  // path, and hand the bytes back for the renderer's object-URL preview.
  ipcMain.handle(IPC.setAvatarFile, (_event, payload: unknown): SetAvatarFileResult =>
    setAvatarFile(payload, deps),
  );

  // Fullscreen avatar viewer: main owns the singleton window lifecycle.
  ipcMain.on(IPC.toggleAvatarFullscreen, () => deps.onToggleAvatarFullscreen?.());

  // Full-transcript pipe (UI-polish wave): the overlay circle shows only the newest
  // agent/system reply, so the overlay reports every provider transcript entry here
  // and main routes it to the settings window's Conversation log. Malformed payloads
  // are dropped — a broken renderer must never crash main.
  ipcMain.on(IPC.reportTranscript, (_event, entry: unknown) => {
    const parsed = parseTranscriptEntry(entry);
    if (parsed) deps.onSessionEvent?.({ kind: 'transcript', entry: parsed });
  });
}

/**
 * Validate an untrusted mitra:report-transcript payload into a TranscriptEntry.
 * Anything malformed (wrong role, empty/non-string text, non-finite ts) → null.
 */
export function parseTranscriptEntry(entry: unknown): TranscriptEntry | null {
  if (entry === null || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const role = e['role'];
  if (role !== 'user' && role !== 'agent' && role !== 'system') return null;
  if (typeof e['text'] !== 'string' || e['text'].trim().length === 0) return null;
  const ts = e['ts'];
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null;
  return { role, text: e['text'], ts };
}

/** Parse the untrusted IPC payload; anything malformed degrades to "no source". */
function parseAvatarPayload(payload: unknown): SetAvatarFilePayload | null {
  if (payload === null || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p['kind'] === 'sample') {
    // Optional sample name; anything non-string degrades to the default sample.
    return { kind: 'sample', name: typeof p['name'] === 'string' ? p['name'] : undefined };
  }
  if (p['kind'] === 'pick' && typeof p['sourcePath'] === 'string' && p['sourcePath'].length > 0) {
    return { kind: 'pick', sourcePath: p['sourcePath'] };
  }
  return null;
}

/**
 * mitra:set-avatar-file core (exported for unit tests with an injected fs):
 * validate → atomic copy to <userData>/avatars/current.vrm (mkdir -p, tmp+rename)
 * → persist Settings.avatarVrmPath → return stored path + model bytes.
 * Never throws; failures come back as stable error codes the renderer localizes.
 */
export function setAvatarFile(
  payload: unknown,
  deps: Pick<RegisterIpcDeps, 'store' | 'onSettingsChanged' | 'userDataDir' | 'avatarFs' | 'resolveSampleVrmPath'>,
): SetAvatarFileResult {
  const fs = deps.avatarFs ?? defaultAvatarFs;
  const resolveSample = deps.resolveSampleVrmPath ?? ((sampleName?: string) => resolveBundledSampleVrmPath(fs, sampleName));

  // Garbage payload, or the sample resolver came up empty → no usable source.
  const parsed = parseAvatarPayload(payload);
  const source: string | null =
    parsed === null ? null : parsed.kind === 'sample' ? resolveSample(parsed.name) : parsed.sourcePath;
  if (typeof source !== 'string') return { ok: false, error: 'source-missing' };

  // Main-side extension gate (the renderer validates too; this keeps main honest).
  const baseName = source.split(/[\\/]/).pop() ?? '';
  if (!/\.vrm$/i.test(baseName)) return { ok: false, error: 'invalid-extension' };

  if (!deps.userDataDir) return { ok: false, error: 'copy-failed' };

  const destDir = join(deps.userDataDir, 'avatars');
  const dest = join(destDir, 'current.vrm');
  const tmp = `${dest}.tmp`;

  try {
    if (!fs.existsSync(source)) return { ok: false, error: 'source-missing' };
    const bytes = fs.readFileSync(source);
    fs.mkdirSync(destDir, { recursive: true });
    // Atomic write (same pattern as settings store): tmp sibling, then rename over.
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, dest);
    // Exact-size ArrayBuffer for the structured-clone trip back to the renderer
    // (Buffer.byteOffset/length may sit inside a larger pooled ArrayBuffer).
    const out = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const previous = deps.store.load();
    const next = applySettingsPatch(previous, { avatarVrmPath: dest });
    deps.store.save(next);
    deps.onSettingsChanged?.(next, previous);
    return { ok: true, path: dest, bytes: out };
  } catch (error) {
    console.warn(`[mitra] avatar file copy failed: ${String(error)}`);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* best-effort cleanup */
    }
    return { ok: false, error: 'copy-failed' };
  }
}

/**
 * Merge an untrusted partial-settings patch (from the renderer) onto current settings.
 * Unknown keys are dropped and every field degrades independently to a valid value —
 * a malformed patch can never produce invalid settings or throw.
 */
export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return { ...current };
  const entries = Object.entries(patch as Record<string, unknown>).filter(
    ([, value]) => value !== undefined,
  );
  return sanitizeSettings({ ...current, ...Object.fromEntries(entries) });
}

// note_notepad — appends a timestamped line to the user's notes file and opens
// it in Notepad on Windows (docs/DECISION_TIER_PLAN.md §2). macOS/Linux are
// write-only with an honest summary (no default GUI editor to assume). Every
// dependency (file adapter, exec, clock, platform) is injectable so vitest
// never touches a real file and the "open" failure degrades gracefully.
import { basename } from 'node:path';
import process from 'node:process';
import { createDefaultMockNotionFileAdapter, type MockNotionFileAdapter } from '../mockNotion';
import { createDefaultExec, type ExecLike } from './launcher';
import type { ToolOutcome } from './notion';

export interface NoteNotepadDeps {
  /** Absolute path of the notes file (main injects <userData>/mitra-notes.txt). */
  notesPath: string;
  /** File adapter; defaults to the real filesystem (mkdir -p on write). */
  fs?: MockNotionFileAdapter;
  /** Shell exec for the win32 `notepad <file>` open (launcher's ExecLike). */
  exec?: ExecLike;
  platform?: string;
  /** Injectable clock for the timestamp (tests pass a fixed value). */
  now?: () => number;
}

/** One appended line: `[2026-10-27T10:00:00.000Z] buy milk` (newlines flattened). */
export function formatNoteLine(text: string, iso: string): string {
  return `[${iso}] ${text.replace(/\s*\r?\n\s*/g, ' ').trim()}`;
}

export function createNoteNotepadTool(
  deps: NoteNotepadDeps,
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  const fs = deps.fs ?? createDefaultMockNotionFileAdapter();
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? Date.now;
  const exec = deps.exec ?? createDefaultExec();
  return async (args) => {
    const raw = args['text'];
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) {
      return { ok: false, summary: 'No text provided for the note.' };
    }
    if (!deps.notesPath) {
      // Host did not inject a notes file — honest refusal, never a crash.
      return { ok: false, summary: 'Notes file is not configured on this machine.' };
    }

    const line = formatNoteLine(text, new Date(now()).toISOString());
    let contents: string;
    try {
      const existing = await fs.read(deps.notesPath);
      contents =
        existing && existing.trim().length > 0 ? `${existing.replace(/\n+$/, '')}\n${line}\n` : `${line}\n`;
    } catch (err) {
      return {
        ok: false,
        summary: `Failed to read the notes file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    try {
      await fs.write(deps.notesPath, contents);
    } catch (err) {
      return {
        ok: false,
        summary: `Failed to save the note: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const file = basename(deps.notesPath);
    if (platform !== 'win32') {
      // mac/linux: no assumed default editor — write-only, said honestly.
      return { ok: true, summary: `Note saved to ${file}`, data: { path: deps.notesPath, opened: false } };
    }
    try {
      const res = await exec(`notepad "${deps.notesPath}"`);
      if (res.code === 0) {
        return {
          ok: true,
          summary: `Note saved to ${file} and opened in Notepad`,
          data: { path: deps.notesPath, opened: true },
        };
      }
      const detail = (res.stderr || res.stdout || `exit code ${res.code ?? 'unknown'}`).trim().slice(0, 120);
      return {
        ok: true,
        summary: `Note saved to ${file} (could not open Notepad: ${detail})`,
        data: { path: deps.notesPath, opened: false },
      };
    } catch (err) {
      return {
        ok: true,
        summary: `Note saved to ${file} (could not open Notepad: ${err instanceof Error ? err.message : String(err)})`,
        data: { path: deps.notesPath, opened: false },
      };
    }
  };
}

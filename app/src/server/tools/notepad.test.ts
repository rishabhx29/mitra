// note_notepad tool tests — happy (win32 open), append semantics, empty/missing
// args, fs failures, the darwin/linux write-only fallback, win32 open-failure
// degradation, and the dispatcher-level ACL denial (launcher gate).
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { createToolDispatcher, type ToolDispatcherDeps } from './index';
import { createNoteNotepadTool, formatNoteLine } from './notepad';

const NOTES = 'C:\\Users\\t\\AppData\\Roaming\\mitra\\mitra-notes.txt';
const FIXED_ISO = '2026-10-27T10:00:00.000Z';
const FIXED_NOW_MS = new Date(FIXED_ISO).getTime();

function fakeFs(initial: string | null = null) {
  const writes: Array<{ path: string; contents: string }> = [];
  let contents = initial;
  return {
    writes,
    read: async (_path: string): Promise<string | null> => contents,
    write: async (path: string, next: string): Promise<void> => {
      writes.push({ path, contents: next });
      contents = next;
    },
  };
}

function fakeExec(code = 0, stderr = '') {
  const commands: string[] = [];
  return {
    commands,
    exec: async (command: string) => {
      commands.push(command);
      return { code, stdout: '', stderr };
    },
  };
}

function baseDeps(overrides: Partial<ToolDispatcherDeps> = {}): ToolDispatcherDeps {
  return {
    settings: () => DEFAULT_SETTINGS,
    ...overrides,
  };
}

describe('formatNoteLine', () => {
  it('timestamps and flattens newlines so a multi-line paste stays one line', () => {
    expect(formatNoteLine('buy milk', FIXED_ISO)).toBe(`[${FIXED_ISO}] buy milk`);
    expect(formatNoteLine('line one\nline two', FIXED_ISO)).toBe(`[${FIXED_ISO}] line one line two`);
  });
});

describe('createNoteNotepadTool', () => {
  it('happy (win32): appends a timestamped line and execs notepad on the file', async () => {
    const fs = fakeFs(null);
    const { exec, commands } = fakeExec();
    const tool = createNoteNotepadTool({ notesPath: NOTES, fs, exec, platform: 'win32', now: () => FIXED_NOW_MS });
    const outcome = await tool({ text: 'buy milk' });
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBe('Note saved to mitra-notes.txt and opened in Notepad');
    expect(fs.writes).toHaveLength(1);
    expect(fs.writes[0]?.contents).toBe(`[${FIXED_ISO}] buy milk\n`);
    expect(commands).toEqual([`notepad "${NOTES}"`]);
  });

  it('appends to existing content, preserving prior lines and normalizing the trailing newline', async () => {
    const fs = fakeFs('[2026-10-26T09:00:00.000Z] old note');
    const { exec } = fakeExec();
    const tool = createNoteNotepadTool({ notesPath: NOTES, fs, exec, platform: 'win32', now: () => FIXED_NOW_MS });
    await tool({ text: 'new note' });
    expect(fs.writes[0]?.contents).toBe(`[2026-10-26T09:00:00.000Z] old note\n[${FIXED_ISO}] new note\n`);
  });

  it('empty text → honest refusal, no fs/exec touched', async () => {
    const fs = fakeFs(null);
    const { exec } = fakeExec();
    const tool = createNoteNotepadTool({ notesPath: NOTES, fs, exec, platform: 'win32' });
    const outcome = await tool({ text: '   ' });
    expect(outcome).toMatchObject({ ok: false });
    expect(fs.writes).toHaveLength(0);
  });

  it('missing notesPath (host injected none) → honest refusal, never a crash', async () => {
    const tool = createNoteNotepadTool({ notesPath: '', fs: fakeFs(null), platform: 'win32' });
    const outcome = await tool({ text: 'buy milk' });
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('not configured');
  });

  it('fs read/write failures → ok:false with the reason', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('EACCES');
    };
    const readFail = createNoteNotepadTool({
      notesPath: NOTES,
      fs: { read: boom, write: async () => undefined },
      platform: 'win32',
    });
    expect((await readFail({ text: 'x' })).summary).toContain('Failed to read the notes file');
    const writeFail = createNoteNotepadTool({
      notesPath: NOTES,
      fs: { read: async () => null, write: boom },
      platform: 'win32',
    });
    expect((await writeFail({ text: 'x' })).summary).toContain('Failed to save the note');
  });

  it('darwin/linux: write-only + honest summary — exec is never called', async () => {
    for (const platform of ['darwin', 'linux']) {
      const fs = fakeFs(null);
      const { exec, commands } = fakeExec();
      const tool = createNoteNotepadTool({ notesPath: NOTES, fs, exec, platform, now: () => FIXED_NOW_MS });
      const outcome = await tool({ text: 'buy milk' });
      expect(outcome.ok).toBe(true);
      expect(outcome.summary).toBe('Note saved to mitra-notes.txt');
      expect(commands).toHaveLength(0);
    }
  });

  it('win32 open failure (non-zero exec / thrown) degrades: note still saved, ok stays true, honest summary', async () => {
    const failing = fakeExec(1, 'not: command not found');
    const tool1 = createNoteNotepadTool({
      notesPath: NOTES,
      fs: fakeFs(null),
      exec: failing.exec,
      platform: 'win32',
    });
    const outcome1 = await tool1({ text: 'x' });
    expect(outcome1.ok).toBe(true);
    expect(outcome1.summary).toContain('could not open Notepad');

    const throwing = createNoteNotepadTool({
      notesPath: NOTES,
      fs: fakeFs(null),
      exec: async () => {
        throw new Error('spawn failed');
      },
      platform: 'win32',
    });
    const outcome2 = await throwing({ text: 'x' });
    expect(outcome2.ok).toBe(true);
    expect(outcome2.summary).toContain('spawn failed');
  });
});

describe('note_notepad via the tool dispatcher', () => {
  it('routes to the handler with the injected notesPath/notesFs and ACL-gates on launcher', async () => {
    const fs = fakeFs(null);
    const { exec } = fakeExec();
    const dispatch = createToolDispatcher(baseDeps({ notesPath: NOTES, notesFs: fs, exec, platform: 'win32' }));
    const result = await dispatch({ id: 'r1', tool: 'note_notepad', args: { text: 'call mom' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Note saved to mitra-notes.txt');
    expect(fs.writes[0]?.contents).toContain('call mom');
  });

  it('denied when the launcher gate is off — the handler (fs/exec) is never invoked', async () => {
    const fs = fakeFs(null);
    const exec = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const dispatch = createToolDispatcher(
      baseDeps({
        settings: () => ({ ...DEFAULT_SETTINGS, permissions: { ...DEFAULT_SETTINGS.permissions, launcher: false } }),
        notesPath: NOTES,
        notesFs: fs,
        exec,
        platform: 'win32',
      }),
    );
    const result = await dispatch({ id: 'r2', tool: 'note_notepad', args: { text: 'call mom' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Permission denied: launcher');
    expect(fs.writes).toHaveLength(0);
    expect(exec).not.toHaveBeenCalled();
  });
});

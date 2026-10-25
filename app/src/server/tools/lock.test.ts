// lock_workstation tests (docs/ULTRON_PORT.md row 4): win32 runs the standard
// rundll32 incantation through the injected exec; macOS/Linux are honest no-ops
// (ok:true, "not supported on this OS") that never exec anything.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { createLockWorkstationTool, LOCK_WORKSTATION_COMMAND } from './lock';
import type { ExecLike } from './launcher';
import { createToolDispatcher } from './index';

describe('lock_workstation', () => {
  it('win32: runs the exact rundll32 command through the injected exec', async () => {
    const exec = vi.fn<ExecLike>(async () => ({ code: 0, stdout: '', stderr: '' }));
    const tool = createLockWorkstationTool({ exec, platform: 'win32' });
    const result = await tool({});
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Locking the workstation now.');
    expect(exec.mock.calls).toEqual([[LOCK_WORKSTATION_COMMAND]]);
    expect(LOCK_WORKSTATION_COMMAND).toBe('rundll32.exe user32.dll,LockWorkStation');
    expect(result.data).toMatchObject({ platform: 'win32', supported: true });
  });

  it('win32: nonzero exit → ok:false with the stderr detail', async () => {
    const exec = vi.fn<ExecLike>(async () => ({ code: 1, stdout: '', stderr: 'access denied' }));
    const tool = createLockWorkstationTool({ exec, platform: 'win32' });
    const result = await tool({});
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Could not lock the workstation: access denied');
  });

  it('win32: exec throwing → ok:false, never a rejection', async () => {
    const exec = vi.fn<ExecLike>(async () => {
      throw new Error('ENOENT');
    });
    const tool = createLockWorkstationTool({ exec, platform: 'win32' });
    const result = await tool({});
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Could not lock the workstation: ENOENT');
  });

  it.each(['darwin', 'linux'])('%s: honest no-op — ok:true, "not supported on this OS", exec never called', async (platform) => {
    const exec = vi.fn<ExecLike>(async () => ({ code: 0, stdout: '', stderr: '' }));
    const tool = createLockWorkstationTool({ exec, platform });
    const result = await tool({});
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(
      `Locking the workstation is not supported on this OS (${platform}) — nothing was locked.`,
    );
    expect(exec.mock.calls).toHaveLength(0);
    expect(result.data).toEqual({ platform, supported: false });
  });

  it('through the dispatcher: launcher gate denies it before any exec', async () => {
    const exec = vi.fn<ExecLike>(async () => ({ code: 0, stdout: '', stderr: '' }));
    const dispatch = createToolDispatcher({
      settings: () => ({ ...DEFAULT_SETTINGS, permissions: { ...DEFAULT_SETTINGS.permissions, launcher: false } }),
      exec,
      platform: 'win32',
      env: {},
    });
    const result = await dispatch({ id: 'l1', tool: 'lock_workstation', args: {} });
    expect(result).toEqual({ id: 'l1', ok: false, summary: 'Permission denied: launcher' });
    expect(exec.mock.calls).toHaveLength(0);
  });

  it('through the dispatcher: allowed under the shipped defaults (launcher: true)', async () => {
    const exec = vi.fn<ExecLike>(async () => ({ code: 0, stdout: '', stderr: '' }));
    const dispatch = createToolDispatcher({
      settings: () => ({ ...DEFAULT_SETTINGS }),
      exec,
      platform: 'win32',
      env: {},
    });
    const result = await dispatch({ id: 'l2', tool: 'lock_workstation', args: {} });
    expect(result.ok).toBe(true);
    expect(exec.mock.calls).toHaveLength(1);
  });
});

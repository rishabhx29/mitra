// workspace_mode tests (docs/ULTRON_PORT.md row 1): the launch fan-out runs each
// app alias through the SAME injected exec path the launcher tool uses and each
// URL through the same opener; anything that cannot run is skipped with a reason.
// Node env, no electron import.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppAlias, type WorkspaceMode } from '../../shared/types';
import { findWorkspaceMode, normalizeModeKey, createWorkspaceModeTool } from './workspace';
import type { ExecLike } from './launcher';
import type { UrlOpener } from './url';
import { createToolDispatcher, type ToolDispatcherDeps } from './index';

const APPS: AppAlias[] = [
  { name: 'notepad', command: 'notepad' },
  { name: 'terminal', command: 'wt' },
  { name: 'browser', command: 'start https://www.google.com' },
];

const MODES: WorkspaceMode[] = [
  {
    id: 'coding',
    name: 'Coding',
    aliases: ['coding', 'coding mode', 'padhai ka man hai'],
    apps: ['terminal', 'notepad'],
    urls: ['https://github.com'],
  },
  {
    id: 'chill',
    name: 'Chill',
    aliases: ['chill', 'movie dekhni hai'],
    apps: ['browser'],
    urls: ['https://www.youtube.com'],
  },
];

/** Tool + capturing fakes; overrides swap fixtures before construction. */
function makeFixture(overrides: { exec?: ExecLike; opener?: UrlOpener; modes?: WorkspaceMode[] } = {}) {
  const exec = vi.fn<ExecLike>(async () => ({ code: 0, stdout: '', stderr: '' }));
  const opener = vi.fn<UrlOpener>(async () => {});
  const tool = createWorkspaceModeTool({
    modes: overrides.modes ?? MODES,
    apps: APPS,
    exec: overrides.exec ?? exec,
    opener: overrides.opener ?? opener,
    platform: 'win32',
  });
  return { exec, opener, tool };
}

describe('findWorkspaceMode', () => {
  it('matches by id, name and alias (case/whitespace-insensitive)', () => {
    expect(findWorkspaceMode('coding', MODES)?.id).toBe('coding');
    expect(findWorkspaceMode('  CODING  ', MODES)?.id).toBe('coding');
    expect(findWorkspaceMode('Coding', MODES)?.id).toBe('coding');
    expect(findWorkspaceMode('movie dekhni hai', MODES)?.id).toBe('chill');
  });

  it('lenient pass: a query containing an alias (or vice versa) resolves to it', () => {
    expect(findWorkspaceMode('please start coding mode now', MODES)?.id).toBe('coding');
  });

  it('returns null for unknown queries and for sub-3-char lenient queries', () => {
    expect(findWorkspaceMode('karaoke', MODES)).toBeNull();
    expect(findWorkspaceMode('co', MODES)).toBeNull(); // too short for the lenient pass
    expect(findWorkspaceMode('', MODES)).toBeNull();
  });

  it('normalizeModeKey collapses case and whitespace', () => {
    expect(normalizeModeKey('  PADHAI   ka   man  hai ')).toBe('padhai ka man hai');
  });
});

describe('workspace_mode fan-out (fake exec capturing calls)', () => {
  it('launches every app alias via exec and opens every URL via the opener', async () => {
    const fx = makeFixture();
    const result = await fx.tool({ name: 'coding' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Workspace "Coding": launched terminal, notepad; opened https://github.com/');
    expect(fx.exec.mock.calls).toEqual([['wt'], ['notepad']]);
    expect(fx.opener.mock.calls).toEqual([['https://github.com/']]);
    expect(result.data).toEqual({
      mode: 'coding',
      launched: ['terminal', 'notepad'],
      opened: ['https://github.com/'],
      skipped: [],
    });
  });

  it('resolves via alias and skips an unknown alias while the rest still run', async () => {
    const fx = makeFixture({ modes: [{ ...MODES[0], apps: ['vscode', 'terminal'] }] });
    const result = await fx.tool({ name: 'coding mode' }); // alias hit
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(
      'Workspace "Coding": launched terminal; opened https://github.com/ (skipped vscode: no launcher alias named "vscode")',
    );
  });

  it('nonzero exec exit is a skipped app with the stderr detail', async () => {
    const fx = makeFixture({
      exec: vi.fn<ExecLike>(async () => ({ code: 1, stdout: '', stderr: 'wt not recognized' })),
    });
    const result = await fx.tool({ name: 'chill' });
    expect(result.ok).toBe(true); // the URL still opened
    expect(result.summary).toBe(
      'Workspace "Chill": opened https://www.youtube.com/ (skipped browser: wt not recognized)',
    );
    expect(result.data).toMatchObject({ launched: [], opened: ['https://www.youtube.com/'] });
  });

  it('exec throwing is skipped without breaking the fan-out', async () => {
    const fx = makeFixture({
      exec: vi.fn<ExecLike>(async () => {
        throw new Error('spawn failed');
      }),
    });
    const result = await fx.tool({ name: 'chill' });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('skipped browser: spawn failed');
  });

  it('opener failure marks the URL skipped while the app still launches', async () => {
    const fx = makeFixture({
      opener: vi.fn<UrlOpener>(async () => {
        throw new Error('xdg-open missing');
      }),
    });
    const result = await fx.tool({ name: 'chill' });
    expect(result.ok).toBe(true); // the browser app (fake exec) still launched
    expect(result.summary).toBe(
      'Workspace "Chill": launched browser (skipped https://www.youtube.com/: xdg-open missing)',
    );
    expect(result.data).toMatchObject({ launched: ['browser'], opened: [] });
  });

  it('a mode whose everything fails → ok:false "nothing launched"', async () => {
    const fx = makeFixture({
      exec: vi.fn<ExecLike>(async () => ({ code: 1, stdout: '', stderr: 'boom' })),
      opener: vi.fn<UrlOpener>(async () => {
        throw new Error('nope');
      }),
    });
    const result = await fx.tool({ name: 'coding' });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('nothing launched');
    expect(result.summary).toContain('terminal: boom');
    expect(result.summary).toContain('https://github.com/: nope');
  });

  it('non-http(s) URLs are refused (same policy as open_url)', async () => {
    const fx = makeFixture({
      modes: [{ id: 'shady', name: 'Shady', aliases: [], apps: [], urls: ['javascript:alert(1)'] }],
    });
    const result = await fx.tool({ name: 'shady' });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('skipped javascript:alert(1): refusing non-http(s) URL');
  });

  it('unknown mode lists the available ids and runs nothing', async () => {
    const fx = makeFixture();
    const result = await fx.tool({ name: 'party' });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Unknown workspace mode "party". Available modes: coding, chill');
    expect(fx.exec.mock.calls).toHaveLength(0);
  });

  it('missing name lists the available ids', async () => {
    const fx = makeFixture();
    const result = await fx.tool({});
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('No workspace mode given. Available modes: coding, chill');
  });

  it('empty modes list degrades to "(none configured)"', async () => {
    const fx = makeFixture({ modes: [] });
    const result = await fx.tool({ name: 'coding' });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Unknown workspace mode "coding". Available modes: (none configured)');
  });
});

describe('workspace_mode through the dispatcher (ACL + settings)', () => {
  function makeDispatch(overrides: Partial<ToolDispatcherDeps> = {}) {
    const exec = vi.fn<ExecLike>(async () => ({ code: 0, stdout: '', stderr: '' }));
    const opener = vi.fn<UrlOpener>(async () => {});
    const dispatch = createToolDispatcher({
      settings: () => ({ ...DEFAULT_SETTINGS }),
      exec,
      opener,
      platform: 'win32',
      env: {},
      ...overrides,
    });
    return { exec, opener, dispatch };
  }

  it('launches the shipped coding preset via the dispatcher', async () => {
    const { exec, dispatch } = makeDispatch();
    const result = await dispatch({ id: 'w1', tool: 'workspace_mode', args: { name: 'coding' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Workspace "Coding": launched terminal; opened https://github.com/');
    expect(exec.mock.calls).toEqual([['wt']]);
  });

  it('denied when launcher gate is false — exec never called', async () => {
    const { exec, opener, dispatch } = makeDispatch({
      settings: () => ({
        ...DEFAULT_SETTINGS,
        permissions: { ...DEFAULT_SETTINGS.permissions, launcher: false },
      }),
    });
    const result = await dispatch({ id: 'w2', tool: 'workspace_mode', args: { name: 'coding' } });
    expect(result).toEqual({ id: 'w2', ok: false, summary: 'Permission denied: launcher' });
    expect(exec.mock.calls).toHaveLength(0);
    expect(opener.mock.calls).toHaveLength(0);
  });

  it('settings-UI mode edits apply without recreating the dispatcher (re-read per dispatch)', async () => {
    let modes: WorkspaceMode[] = [];
    const { dispatch } = makeDispatch({
      settings: () => ({ ...DEFAULT_SETTINGS, workspaceModes: modes }),
    });

    const before = await dispatch({ id: 'w3', tool: 'workspace_mode', args: { name: 'party' } });
    expect(before.ok).toBe(false);

    modes = [{ id: 'party', name: 'Party', aliases: [], apps: ['notepad'], urls: [] }];
    const after = await dispatch({ id: 'w4', tool: 'workspace_mode', args: { name: 'party' } });
    expect(after.ok).toBe(true);
    expect(after.summary).toBe('Workspace "Party": launched notepad');
  });
});

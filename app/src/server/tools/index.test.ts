// Dispatcher routing + tool behavior with every I/O adapter stubbed (pure node-env vitest):
// ACL enforcement, notion real/mock/fallback, launcher aliases, opencode found/not-found,
// open_url scheme policy, and ToolResult id plumbing.
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type Permissions,
  type Settings,
  type ToolName,
} from '../../shared/types';
import type { MockNotion } from '../mockNotion';
import type { ExecLike } from './launcher';
import type { FetchLike } from './notion';
import type { OpencodeLookup, OpencodeSpawnRunner } from './opencode';
import { OPENCODE_SIMULATED_SUMMARY } from './opencode';
import type { UrlOpener } from './url';
import { createDefaultOpencodeLookup, summarizeOpencodeOutput } from './opencode';
import { createToolDispatcher, type ToolDispatcherDeps } from './index';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function makePermissions(overrides: Partial<Permissions> = {}): Permissions {
  return { ...DEFAULT_SETTINGS.permissions, ...overrides };
}

/** Spy mock board recording every add. */
function makeMockNotion(): MockNotion & { adds: string[] } {
  const adds: string[] = [];
  return {
    adds,
    list: async () =>
      adds.map((text, i) => ({ id: `t${i}`, text, createdAt: '2026-01-01T00:00:00.000Z' })),
    add: async (text: string) => {
      adds.push(text);
      return { id: `t${adds.length - 1}`, text, createdAt: '2026-01-01T00:00:00.000Z' };
    },
  };
}

interface FetchCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

function fetchStub(
  impl: (init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    status: number;
    body: string;
  },
): FetchLike & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, init });
    const out = impl(init);
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      json: async () => JSON.parse(out.body) as unknown,
      text: async () => out.body,
    };
  }) as FetchLike;
  return Object.assign(fn, { calls });
}

function fetchThrowsStub(): FetchLike & { calls: FetchCall[] } {
  return Object.assign(
    (async () => {
      throw new Error('EAI_AGAIN');
    }) as FetchLike,
    { calls: [] as FetchCall[] },
  );
}

function makeStubs(opts: { opencodePath?: string | null; spawnCode?: number; spawnStdout?: string } = {}) {
  return {
    exec: vi.fn<ExecLike>(async () => ({ code: 0, stdout: '', stderr: '' })),
    opener: vi.fn<UrlOpener>(async () => {}),
    lookup: vi.fn<OpencodeLookup>(async () => opts.opencodePath ?? null),
    spawn: vi.fn<OpencodeSpawnRunner>(async () => ({
      code: opts.spawnCode ?? 0,
      stdout: opts.spawnStdout ?? '{"content":"done"}',
      stderr: '',
      timedOut: false,
    })),
    mock: makeMockNotion(),
    fetch: fetchStub(() => ({ status: 200, body: '{"id":"page-1"}' })),
    progress: [] as string[],
    delays: [] as number[],
  };
}

type Stubs = ReturnType<typeof makeStubs>;

function makeDeps(stubs: Stubs, overrides: Partial<ToolDispatcherDeps> = {}): ToolDispatcherDeps {
  return {
    // All gates granted by default so per-tool tests exercise the handlers;
    // the ACL describe overrides settings explicitly to pin denials.
    settings: () =>
      makeSettings({ permissions: { notion: true, launcher: true, terminal: true, browser: true } }),
    mockNotion: stubs.mock,
    fetchImpl: stubs.fetch,
    exec: stubs.exec,
    opener: stubs.opener,
    opencodeLookup: stubs.lookup,
    opencodeSpawn: stubs.spawn,
    delay: async (ms) => {
      stubs.delays.push(ms);
    },
    env: {},
    platform: 'win32',
    onProgress: (_tool, msg) => stubs.progress.push(msg),
    ...overrides,
  };
}

describe('ACL enforcement at the dispatcher', () => {
  const CASES: Array<[ToolName, keyof Permissions, Record<string, unknown>, (s: Stubs) => number]> = [
    ['notion_add_todo', 'notion', { text: 'milk' }, (s) => s.mock.adds.length],
    ['launch_app', 'launcher', { alias: 'notepad' }, (s) => s.exec.mock.calls.length],
    ['run_opencode_task', 'terminal', { prompt: 'fix the bug' }, (s) => s.spawn.mock.calls.length],
    ['open_url', 'browser', { url: 'https://example.com' }, (s) => s.opener.mock.calls.length],
  ];

  it.each(CASES)('%s denied when all gates false — never executes', async (tool, gate, args, effectOf) => {
    const stubs = makeStubs({ opencodePath: 'C:/bin/opencode.exe' });
    const dispatch = createToolDispatcher(
      makeDeps(stubs, { settings: () => makeSettings({ permissions: makePermissions({ [gate]: false }) }) }),
    );
    const result = await dispatch({ id: 'r1', tool, args });
    expect(result).toEqual({ id: 'r1', ok: false, summary: `Permission denied: ${gate}` });
    expect(effectOf(stubs)).toBe(0); // the handler never ran
  });

  it.each(CASES)('%s denied when ONLY its gate is false — never executes', async (tool, gate, args, effectOf) => {
    const stubs = makeStubs({ opencodePath: 'C:/bin/opencode.exe' });
    const dispatch = createToolDispatcher(
      makeDeps(stubs, {
        settings: () =>
          makeSettings({
            permissions: { notion: true, launcher: true, terminal: true, browser: true, [gate]: false },
          }),
      }),
    );
    const result = await dispatch({ id: 'r1', tool, args });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe(`Permission denied: ${gate}`);
    expect(effectOf(stubs)).toBe(0);
  });

  it.each(CASES)('%s executes when its gate is granted', async (tool, _gate, args, effectOf) => {
    const stubs = makeStubs({ opencodePath: 'C:/bin/opencode.exe' });
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'r2', tool, args });
    expect(result.ok).toBe(true);
    expect(effectOf(stubs)).toBeGreaterThan(0);
  });

  it('permission flips apply without re-creating the dispatcher (settings re-read per dispatch)', async () => {
    const stubs = makeStubs();
    let permissions = makePermissions({ notion: false });
    const dispatch = createToolDispatcher(
      makeDeps(stubs, { settings: () => makeSettings({ permissions }) }),
    );
    const denied = await dispatch({ id: 'a', tool: 'notion_add_todo', args: { text: 'x' } });
    expect(denied.summary).toBe('Permission denied: notion');

    permissions = makePermissions({ notion: true });
    const allowed = await dispatch({ id: 'b', tool: 'notion_add_todo', args: { text: 'x' } });
    expect(allowed.ok).toBe(true);
    expect(stubs.mock.adds).toEqual(['x']);
  });
});

describe('routing + ToolResult plumbing', () => {
  it('unknown tool → ok:false "Unknown tool: …"', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'u1', tool: 'format_disk' as ToolName, args: {} });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Unknown tool: format_disk');
  });

  it('echoes the request id', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'echo-me', tool: 'notion_add_todo', args: { text: 'x' } });
    expect(result.id).toBe('echo-me');
  });

  it('generates an id when the request has none', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs, { idFactory: () => 'generated-id' }));
    const result = await dispatch({ id: '', tool: 'notion_add_todo', args: { text: 'x' } });
    expect(result.id).toBe('generated-id');
  });

  it('handler throw → ok:false, never rejects', async () => {
    const stubs = makeStubs();
    const broken: MockNotion = {
      list: async () => [],
      add: async () => {
        throw new Error('disk on fire');
      },
    };
    const dispatch = createToolDispatcher(makeDeps(stubs, { mockNotion: broken }));
    const result = await dispatch({ id: 'e1', tool: 'notion_add_todo', args: { text: 'x' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Tool notion_add_todo failed: disk on fire');
  });
});

describe('notion_add_todo', () => {
  it('mock path adds to the injected board', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'n1', tool: 'notion_add_todo', args: { text: 'milk' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Added to Notion (mock board): "milk"');
    expect(stubs.mock.adds).toEqual(['milk']);
    expect(stubs.fetch.calls).toHaveLength(0); // never touched the network
  });

  it('real path POSTs to the Notion v1 pages endpoint with auth headers', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(
      makeDeps(stubs, {
        settings: () => makeSettings({ notion: { mock: false, token: 'secret', databaseId: 'db123' } }),
      }),
    );
    const result = await dispatch({ id: 'n2', tool: 'notion_add_todo', args: { text: 'ship it' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Added to Notion: "ship it"');
    expect(stubs.fetch.calls).toHaveLength(1);
    const call = stubs.fetch.calls[0]!;
    expect(call.url).toBe('https://api.notion.com/v1/pages');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.headers?.['Authorization']).toBe('Bearer secret');
    expect(call.init?.headers?.['Notion-Version']).toBe('2022-06-28');
    const body = JSON.parse(call.init?.body ?? '{}') as {
      parent: { database_id: string };
      properties: { Title: { title: Array<{ text: { content: string } }> } };
    };
    expect(body.parent.database_id).toBe('db123');
    expect(body.properties.Title.title[0]?.text.content).toBe('ship it');
    expect(stubs.mock.adds).toHaveLength(0);
  });

  it('real path failure (HTTP 500) falls back to the mock board with a saying-so summary', async () => {
    const stubs = makeStubs();
    stubs.fetch = fetchStub(() => ({ status: 500, body: 'boom' }));
    const dispatch = createToolDispatcher(
      makeDeps(stubs, {
        settings: () => makeSettings({ notion: { mock: false, token: 't', databaseId: 'd' } }),
      }),
    );
    const result = await dispatch({ id: 'n3', tool: 'notion_add_todo', args: { text: 'milk' } });
    expect(result.ok).toBe(true); // the user's todo WAS captured
    expect(result.summary).toContain('Notion unavailable');
    expect(result.summary).toContain('500');
    expect(result.summary).toContain('mock board');
    expect(stubs.mock.adds).toEqual(['milk']);
  });

  it('real path network throw falls back to the mock board', async () => {
    const stubs = makeStubs();
    stubs.fetch = fetchThrowsStub();
    const dispatch = createToolDispatcher(
      makeDeps(stubs, {
        settings: () => makeSettings({ notion: { mock: false, token: 't', databaseId: 'd' } }),
      }),
    );
    const result = await dispatch({ id: 'n4', tool: 'notion_add_todo', args: { text: 'milk' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('EAI_AGAIN');
    expect(stubs.mock.adds).toEqual(['milk']);
  });

  it('real config with missing token falls back to the mock board', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(
      makeDeps(stubs, {
        settings: () => makeSettings({ notion: { mock: false, token: '', databaseId: 'd' } }),
      }),
    );
    const result = await dispatch({ id: 'n5', tool: 'notion_add_todo', args: { text: 'milk' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('missing token or database id');
    expect(stubs.fetch.calls).toHaveLength(0);
    expect(stubs.mock.adds).toEqual(['milk']);
  });

  it('empty text → ok:false, nothing stored', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'n6', tool: 'notion_add_todo', args: { text: '   ' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('No text provided for the todo.');
    expect(stubs.mock.adds).toHaveLength(0);
  });
});

describe('launch_app', () => {
  const APPS = [
    { name: 'notepad', command: 'notepad' },
    { name: 'browser', command: 'start https://www.google.com' },
  ];

  it('known alias runs its command through exec (case-insensitive)', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs, { settings: () => makeSettings({ apps: APPS }) }));
    const result = await dispatch({ id: 'l1', tool: 'launch_app', args: { alias: 'Notepad' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Opening notepad');
    expect(stubs.exec.mock.calls).toEqual([['notepad']]);
  });

  it('unknown alias falls back to the shell resolver (start "" <name>)', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs, { settings: () => makeSettings({ apps: APPS }) }));
    const result = await dispatch({ id: 'l2', tool: 'launch_app', args: { alias: 'skype' } });
    // Universal resolver (§2b): shell fallback runs the raw name via `start`.
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Opening skype');
    expect(stubs.exec.mock.calls.at(-1)?.[0]).toBe('start "" skype');
  });

  it('unknown alias with a FAILING shell fallback reports honestly', async () => {
    const stubs = makeStubs();
    stubs.exec.mockImplementation(async () => ({ code: 1, stdout: '', stderr: 'not found' }));
    const dispatch = createToolDispatcher(makeDeps(stubs, { settings: () => makeSettings({ apps: APPS }) }));
    const result = await dispatch({ id: 'l2b', tool: 'launch_app', args: { alias: 'skype' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('skype');
  });

  it('missing alias lists the available ones', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs, { settings: () => makeSettings({ apps: APPS }) }));
    const result = await dispatch({ id: 'l3', tool: 'launch_app', args: {} });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('No app alias provided. Available apps: notepad, browser');
  });

  it('exec failure → ok:false with stderr detail', async () => {
    const stubs = makeStubs();
    stubs.exec = vi.fn<ExecLike>(async () => ({ code: 1, stdout: '', stderr: 'not recognized' }));
    const dispatch = createToolDispatcher(makeDeps(stubs, { settings: () => makeSettings({ apps: APPS }) }));
    const result = await dispatch({ id: 'l4', tool: 'launch_app', args: { alias: 'notepad' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Failed to launch notepad: not recognized');
  });
});

describe('run_opencode_task', () => {
  it('found binary: spawns `run --format json --auto <prompt>` with 120s timeout + cwd', async () => {
    const stubs = makeStubs({ opencodePath: 'C:/bin/opencode.exe', spawnStdout: '{"content":"refactored utils"}' });
    const dispatch = createToolDispatcher(makeDeps(stubs, { cwd: 'C:/project' }));
    const result = await dispatch({ id: 'o1', tool: 'run_opencode_task', args: { prompt: 'fix the login bug' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('refactored utils');
    expect(stubs.spawn.mock.calls).toHaveLength(1);
    const call = stubs.spawn.mock.calls[0]![0]!;
    expect(call.binPath).toBe('C:/bin/opencode.exe');
    expect(call.args).toEqual(['run', '--format', 'json', '--auto', 'fix the login bug']);
    expect(call.cwd).toBe('C:/project');
    expect(call.timeoutMs).toBe(120_000);
    expect(stubs.lookup.mock.calls).toHaveLength(1);
    expect(stubs.exec.mock.calls).toHaveLength(0); // lookup was injected; exec untouched
  });

  it('not found: honest simulation — exact summary + progress callbacks over ~8s', async () => {
    const stubs = makeStubs({ opencodePath: null });
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'o2', tool: 'run_opencode_task', args: { prompt: 'write tests' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('simulated (opencode not installed)');
    expect(OPENCODE_SIMULATED_SUMMARY).toBe('simulated (opencode not installed)');
    // 1 "not found" notice + 4 steps, spaced 8000/4 = 2000ms apart
    expect(stubs.progress.length).toBe(5);
    expect(stubs.delays).toEqual([2000, 2000, 2000, 2000]);
    expect(stubs.progress[0]).toContain('opencode not found');
    expect(stubs.spawn.mock.calls).toHaveLength(0);
  });

  it('progress callbacks flow through onProgress with the tool name', async () => {
    const stubs = makeStubs({ opencodePath: null });
    const named: string[] = [];
    const dispatch = createToolDispatcher(
      makeDeps(stubs, { onProgress: (tool, msg) => named.push(`${tool}:${msg}`) }),
    );
    await dispatch({ id: 'o2b', tool: 'run_opencode_task', args: { prompt: 'x' } });
    expect(named.filter((n) => n.startsWith('run_opencode_task:'))).toHaveLength(5);
  });

  it('spawn failure (exit 1) → ok:false with stderr detail', async () => {
    const stubs = makeStubs({ opencodePath: 'C:/bin/opencode.exe', spawnCode: 1, spawnStdout: '' });
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'o3', tool: 'run_opencode_task', args: { prompt: 'x' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('opencode failed (exit 1): no output');
  });

  it('spawn timeout with NO usable output → ok:false "opencode timed out after 120s"', async () => {
    const stubs = makeStubs({ opencodePath: 'C:/bin/opencode.exe' });
    stubs.spawn = vi.fn<OpencodeSpawnRunner>(async () => ({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: true,
    }));
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'o4', tool: 'run_opencode_task', args: { prompt: 'x' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('opencode timed out after 120s');
  });

  it('spawn timeout WITH completed output salvages the answer (opencode lingers after finishing — verified live)', async () => {
    const stubs = makeStubs({ opencodePath: 'C:/bin/opencode.exe' });
    stubs.spawn = vi.fn<OpencodeSpawnRunner>(async () => ({
      code: null,
      stdout:
        '{"type":"step_start","part":{"type":"step-start","snapshot":"s1"}}\r\n' +
        '{"type":"text","part":{"type":"text","text":"pong"}}\r\n',
      stderr: '',
      timedOut: true,
    }));
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'o4b', tool: 'run_opencode_task', args: { prompt: 'x' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('pong');
    const data = result.data as { timedOut: boolean; note: string };
    expect(data.timedOut).toBe(true);
    expect(data.note).toContain('120s cap');
  });

  it('summarizeOpencodeOutput reads the real `--format json` event shape (part.text)', () => {
    const stdout =
      '{"type":"step_start","timestamp":1,"part":{"type":"step-start","snapshot":"abc"}}\r\n' +
      '{"type":"text","timestamp":2,"part":{"type":"text","text":"pong","time":{"start":1,"end":2}}}\r\n';
    expect(summarizeOpencodeOutput(stdout)).toBe('pong');
  });

  it('summarizeOpencodeOutput joins multiple text parts and falls back to the first stdout line', () => {
    expect(summarizeOpencodeOutput('{"type":"text","part":{"text":"a"}}\n{"type":"text","part":{"text":"b"}}')).toBe(
      'a b',
    );
    expect(summarizeOpencodeOutput('plain text output')).toBe('plain text output');
    expect(summarizeOpencodeOutput('')).toBe('opencode finished (no output)');
  });

  it('empty prompt → ok:false without even looking up the binary', async () => {
    const stubs = makeStubs({ opencodePath: 'C:/bin/opencode.exe' });
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'o5', tool: 'run_opencode_task', args: {} });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('No prompt provided for the opencode task.');
    expect(stubs.lookup.mock.calls).toHaveLength(0);
  });
});

describe('default opencode lookup (Windows PATH probe)', () => {
  it('prefers the .cmd shim among `where opencode` results (bare sh wrapper is not spawnable)', async () => {
    const exec = vi.fn<ExecLike>(async () => ({
      code: 0,
      stdout: 'C:\\npm\\opencode\r\nC:\\npm\\opencode.cmd\r\nC:\\npm\\opencode.ps1\r\n',
      stderr: '',
    }));
    const lookup = createDefaultOpencodeLookup({ env: {}, exec, platform: 'win32' });
    expect(await lookup()).toBe('C:\\npm\\opencode.cmd');
  });

  it('prefers .exe over .cmd', async () => {
    const exec = vi.fn<ExecLike>(async () => ({
      code: 0,
      stdout: 'C:\\npm\\opencode.cmd\r\nC:\\bin\\opencode.exe\r\n',
      stderr: '',
    }));
    const lookup = createDefaultOpencodeLookup({ env: {}, exec, platform: 'win32' });
    expect(await lookup()).toBe('C:\\bin\\opencode.exe');
  });

  it('returns null when only non-spawnable entries exist (honest simulation instead of ENOENT)', async () => {
    const exec = vi.fn<ExecLike>(async () => ({
      code: 0,
      stdout: 'C:\\npm\\opencode\r\nC:\\npm\\opencode.ps1\r\n',
      stderr: '',
    }));
    const lookup = createDefaultOpencodeLookup({ env: {}, exec, platform: 'win32' });
    expect(await lookup()).toBeNull();
  });

  it('uses OPENCODE_PATH when set (before any PATH probe)', async () => {
    const exec = vi.fn<ExecLike>(async () => ({ code: 0, stdout: 'C:\\npm\\opencode.cmd', stderr: '' }));
    const lookup = createDefaultOpencodeLookup({
      env: { OPENCODE_PATH: 'C:/custom/opencode.exe' },
      exec,
      platform: 'win32',
    });
    expect(await lookup()).toBe('C:/custom/opencode.exe');
    expect(exec.mock.calls).toHaveLength(0);
  });

  it('returns null when `where` exits nonzero', async () => {
    const exec = vi.fn<ExecLike>(async () => ({ code: 1, stdout: '', stderr: 'not found' }));
    const lookup = createDefaultOpencodeLookup({ env: {}, exec, platform: 'win32' });
    expect(await lookup()).toBeNull();
  });

  it('on POSIX returns the first `which` line as-is', async () => {
    const exec = vi.fn<ExecLike>(async () => ({ code: 0, stdout: '/usr/local/bin/opencode\n', stderr: '' }));
    const lookup = createDefaultOpencodeLookup({ env: {}, exec, platform: 'linux' });
    expect(await lookup()).toBe('/usr/local/bin/opencode');
  });
});

describe('open_url', () => {
  it('http(s) URL goes through the injected opener', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'b1', tool: 'open_url', args: { url: 'https://example.com/a?b=1' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Opened https://example.com/a?b=1 in the browser');
    expect(stubs.opener.mock.calls).toEqual([['https://example.com/a?b=1']]);
  });

  it('refuses javascript: URLs', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'b2', tool: 'open_url', args: { url: 'javascript:alert(1)' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Refusing to open non-http(s) URL: "javascript:alert(1)"');
    expect(stubs.opener.mock.calls).toHaveLength(0);
  });

  it('refuses file: URLs', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'b3', tool: 'open_url', args: { url: 'file:///C:/Windows/System32' } });
    expect(result.ok).toBe(false);
    expect(stubs.opener.mock.calls).toHaveLength(0);
  });

  it('invalid URL → ok:false', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'b4', tool: 'open_url', args: { url: 'not a url' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Not a valid URL: "not a url"');
  });

  it('missing URL → ok:false', async () => {
    const stubs = makeStubs();
    const dispatch = createToolDispatcher(makeDeps(stubs));
    const result = await dispatch({ id: 'b5', tool: 'open_url', args: {} });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('No URL provided.');
  });
});

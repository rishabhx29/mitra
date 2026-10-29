// app_task tool tests — alias launch + the win32 one-shot typing command
// (AppActivate + SendKeys + the base64 content round-trip), the WINDOW-WAIT
// that polls Get-Process before typing (replacing the blind 1.5s sleep), the
// 30s exec budget, Start-Menu index resolution, unknown-app refusal, non-win32
// honest degradation, the optional {ENTER}, content with newlines/quotes
// surviving the shell, and the dispatcher-level wiring + ACL denial (launcher gate).
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { createToolDispatcher } from './index';
import {
  APP_TASK_EXEC_TIMEOUT_MS,
  APP_TASK_LAUNCH_DELAY_MS,
  APP_TASK_WINDOW_POLL_INTERVAL_MS,
  APP_TASK_WINDOW_WAIT_MS,
  buildTypeCommand,
  buildWindowWaitCommand,
  createAppTaskTool,
  escapeSendKeys,
} from './appTask';

const LNK = 'C:\\SM\\Programs\\Notepad.lnk';
const APPS = [{ name: 'notepad', command: 'notepad' }];

/** The window-wait probe command (distinguishes polls from the typing command). */
const IS_WINDOW_WAIT = (command: string): boolean => command.includes('Measure-Object');

/**
 * Fake exec: launch/alias commands return `code`; window-wait probes return
 * successive window counts from `windowPolls` (last value repeats); typing
 * commands return `code` too — pass a custom exec when they must differ.
 */
function fakeExec(code = 0, windowPolls: number[] = [1]) {
  const commands: string[] = [];
  let poll = 0;
  return {
    commands,
    exec: async (command: string) => {
      commands.push(command);
      if (IS_WINDOW_WAIT(command)) {
        const count = windowPolls[Math.min(poll, windowPolls.length - 1)] ?? 0;
        poll += 1;
        return { code: 0, stdout: String(count), stderr: '' };
      }
      return { code, stdout: '', stderr: code === 0 ? '' : 'start failed' };
    },
  };
}

/** Fake exec where the typing invocation returns a fixed non-zero result. */
function fakeExecTypingResult(typing: { code: number; stderr: string }) {
  const commands: string[] = [];
  return {
    commands,
    exec: async (command: string) => {
      commands.push(command);
      if (IS_WINDOW_WAIT(command)) return { code: 0, stdout: '1', stderr: '' };
      if (command.startsWith('powershell')) return { ...typing, stdout: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

const noDelay = async (): Promise<void> => {};
let delayCalls = 0;
const spyDelay = async (): Promise<void> => {
  delayCalls += 1;
};

/** Flat one-dir Start-Menu index exposing Notepad.lnk. */
const appFs = {
  existsSync: (p: string): boolean => p === 'C:\\SM\\Programs',
  readdirSync: (p: string): Array<{ name: string; isDirectory(): boolean }> =>
    p === 'C:\\SM\\Programs' ? [{ name: 'Notepad.lnk', isDirectory: () => false }] : [],
};

/** Decode the base64 literal embedded in the typing command. */
function decodedContent(command: string): string {
  const m = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(command);
  expect(m).not.toBeNull();
  return Buffer.from(m![1] ?? '', 'base64').toString('utf8');
}

/** Decode every base64 literal embedded in the typing command. */
function literals(command: string): string[] {
  return [...command.matchAll(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/g)].map((m) =>
    Buffer.from(m[1] ?? '', 'base64').toString('utf8'),
  );
}

describe('buildTypeCommand', () => {
  it('activates the window and types the ESCAPED text in chunks (no clipboard)', () => {
    const command = buildTypeCommand('Notepad', 'line one\nline "two" — done', false);
    expect(command).toContain("AppActivate('Notepad')");
    expect(command).toContain('$w.SendKeys');
    expect(command).toContain('-STA');
    expect(command).toContain('-WindowStyle Hidden');
    // All typing chunks (every literal except the final raw clipboard one)
    // concatenate back to the SendKeys-escaped text.
    const ls = literals(command);
    expect(ls.slice(0, -1).join('')).toBe('line one{ENTER}line "two" — done');
    expect(ls.at(-1)).toBe('line one\nline "two" — done');
    expect(command).toContain('Start-Sleep -Milliseconds 60');
  });

  it('keeps the raw content for the clipboard fallback after the typing chunks', () => {
    const command = buildTypeCommand('Notepad', 'line one\na + b (x)', false);
    const ls = literals(command);
    expect(ls.slice(0, -1).join('')).toBe('line one{ENTER}a {+} b {(}x{)}');
    expect(ls.at(-1)).toBe('line one\na + b (x)');
    // clipboard fallback exists, after the primary SendKeys, single bounded try
    expect(command.indexOf('$w.SendKeys')).toBeLessThan(command.indexOf('Set-Clipboard'));
    expect(command).toContain('Set-Clipboard -Value');
    expect(command).toContain('PATH=typed');
    expect(command).toContain('PATH=pasted');
    expect(command).not.toContain('Add-Type');
    expect(command).toContain('clip-error');
    expect(command).toContain('Get-Process');
  });

  it('escapeSendKeys braces metacharacters and names newlines/tabs', () => {
    expect(escapeSendKeys('hi\nthere\tx ^ y')).toBe('hi{ENTER}there{TAB}x {^} y');
    expect(escapeSendKeys('100% (great)')).toBe('100{%} {(}great{)}');
  });

  it('appends {ENTER} only when asked, and sanitizes the AppActivate title', () => {
    expect(buildTypeCommand('Notepad', 'hi there', false)).not.toContain("$w.SendKeys('{ENTER}')");
    expect(buildTypeCommand('Notepad', 'hi there', true)).toContain("$w.SendKeys('{ENTER}')");
    // Quotes/percent/ampersand stripped from the title so the cmd quoting holds.
    expect(buildTypeCommand("100% \"Great\" App & Co", 'hi there', false)).toContain(
      "AppActivate('100 Great App  Co')",
    );
  });
});

describe('buildWindowWaitCommand', () => {
  it('probes the process for a visible window via Get-Process + Measure-Object', () => {
    const command = buildWindowWaitCommand('notepad');
    expect(command).toContain("Get-Process -Name 'notepad'");
    expect(command).toContain('MainWindowHandle -ne 0');
    expect(command).toContain('Measure-Object).Count');
    expect(command).toContain('-WindowStyle Hidden');
    expect(command).toContain('-ErrorAction SilentlyContinue');
  });
});

describe('app_task timing budget', () => {
  it('typing + window-wait polls share a 30s exec budget; the 1.5s pause survives as fallback', () => {
    expect(APP_TASK_EXEC_TIMEOUT_MS).toBe(30_000);
    expect(APP_TASK_WINDOW_POLL_INTERVAL_MS).toBe(400);
    expect(APP_TASK_WINDOW_WAIT_MS).toBe(8_000);
    expect(APP_TASK_LAUNCH_DELAY_MS).toBe(1_500);
  });
});

describe('createAppTaskTool', () => {
  it('happy (win32): resolves the alias, window-waits ONE poll, then ONE PowerShell typing invocation', async () => {
    delayCalls = 0;
    const { exec, commands } = fakeExec();
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'win32', delay: spyDelay });
    const outcome = await tool({ app: 'notepad', content: 'buy milk' });
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBe('Opened notepad and typed your text');
    // The window was already up at the first poll: just the settle delay —
    // the input pipeline needs a beat after the window handle exists, or the
    // keystrokes get swallowed (the "took two attempts" bug).
    expect(delayCalls).toBe(1);
    expect(commands).toHaveLength(3); // launch, window probe, typing
    expect(commands[0]).toBe('start "" notepad');
    expect(IS_WINDOW_WAIT(commands[1] ?? '')).toBe(true);
    expect(commands[2]).toContain("AppActivate('notepad')");
    expect(commands[2]).toContain("$w.SendKeys('^v')");
    expect(decodedContent(commands[2] ?? '')).toBe('buy milk');
  });

  it('window-wait: polls until the window exists, settles, then types once', async () => {
    const { exec, commands } = fakeExec(0, [0, 1]); // window appears on the 2nd poll
    const delays: number[] = [];
    const tool = createAppTaskTool({
      apps: APPS,
      exec,
      platform: 'win32',
      delay: async (ms) => {
        delays.push(ms);
      },
    });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(true);
    expect(commands.filter(IS_WINDOW_WAIT)).toHaveLength(2);
    expect(delays).toEqual([APP_TASK_WINDOW_POLL_INTERVAL_MS, 1_500]); // poll, then settle
    expect(commands[commands.length - 1]).toContain('$w.SendKeys');
  });

  it('window-wait: window never appears → polls to the cap, falls back to the fixed 1.5s, still types', async () => {
    const { exec, commands } = fakeExec(0, [0]); // every probe reports zero windows
    const delays: number[] = [];
    const tool = createAppTaskTool({
      apps: APPS,
      exec,
      platform: 'win32',
      delay: async (ms) => {
        delays.push(ms);
      },
    });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(true); // typing is still attempted after the fallback
    const maxPolls = Math.round(APP_TASK_WINDOW_WAIT_MS / APP_TASK_WINDOW_POLL_INTERVAL_MS);
    expect(commands.filter(IS_WINDOW_WAIT)).toHaveLength(maxPolls);
    expect(delays).toEqual([
      ...Array.from({ length: maxPolls - 1 }, () => APP_TASK_WINDOW_POLL_INTERVAL_MS),
      APP_TASK_LAUNCH_DELAY_MS,
    ]);
    expect(commands[commands.length - 1]).toContain('$w.SendKeys');
  });

  it('window-wait: a broken probe falls back to the fixed 1.5s and still types', async () => {
    const commands: string[] = [];
    const exec = async (command: string) => {
      commands.push(command);
      if (IS_WINDOW_WAIT(command)) throw new Error('powershell blocked');
      return { code: 0, stdout: '', stderr: '' };
    };
    const delays: number[] = [];
    const tool = createAppTaskTool({
      apps: APPS,
      exec,
      platform: 'win32',
      delay: async (ms) => {
        delays.push(ms);
      },
    });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBe('Opened notepad and typed your text');
    expect(delays).toEqual([APP_TASK_LAUNCH_DELAY_MS]);
    expect(commands[commands.length - 1]).toContain("AppActivate('notepad')");
  });

  it('resolves through the Start-Menu index when no alias matches (and launches the .lnk)', async () => {
    const { exec, commands } = fakeExec();
    const tool = createAppTaskTool({
      apps: [],
      exec,
      appIndexDirs: ['C:\\SM\\Programs'],
      appFs,
      platform: 'win32',
      delay: noDelay,
    });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBe('Opened Notepad and typed your text');
    expect(commands[0]).toBe(`start "" "${LNK}"`);
    // typing chunks concatenate to the escaped content (last literal = raw clipboard fallback)
    const ls = literals(commands[commands.length - 1] ?? '');
    expect(ls.slice(0, -1).join('')).toBe('hello world');
  });

  it('unknown app → honest refusal with did-you-mean hints, no typing command', async () => {
    const { exec, commands } = fakeExec(1); // every launch fails
    const tool = createAppTaskTool({
      apps: [],
      exec,
      appIndexDirs: ['C:\\SM\\Programs'],
      appFs,
      platform: 'win32',
      delay: noDelay,
    });
    // 'note' fuzzy-matches Notepad in the index (hint source) but the launch fails.
    const outcome = await tool({ app: 'note', content: 'hello world' });
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('Unknown app "note"');
    expect(outcome.summary).toContain('Did you mean: Notepad?');
    expect(commands).toHaveLength(2); // index + shell-fallback attempts, no PowerShell

    // A name with no fuzzy match refuses too — without hints.
    const none = await tool({ app: 'nosuchapp', content: 'hello world' });
    expect(none.ok).toBe(false);
    expect(none.summary).toContain('Unknown app "nosuchapp"');
    expect(none.summary).not.toContain('Did you mean');
  });

  it('non-win32: launches but says typing is Windows-only, no PowerShell invocation', async () => {
    const { exec, commands } = fakeExec();
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'linux', delay: noDelay });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBe('Opened notepad (typing into apps is Windows-only right now)');
    expect(commands).toEqual(['start "" notepad']);
  });

  it('missing app or content args → refusal without exec', async () => {
    const { exec, commands } = fakeExec();
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'win32', delay: noDelay });
    expect((await tool({ content: 'x' })).ok).toBe(false);
    expect((await tool({ app: 'notepad' })).ok).toBe(false);
    expect(commands).toHaveLength(0);
  });

  it('a failed typing invocation keeps the app-open fact but reports the copy failure', async () => {
    const { exec } = fakeExecTypingResult({ code: 1, stderr: 'no window' });
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'win32', delay: noDelay });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('Opened notepad but could not copy your text');
  });

  it('exit 2 (no window focus): honest partial success — never pastes into an unknown window', async () => {
    const { exec } = fakeExecTypingResult({ code: 2, stderr: 'no-focus' });
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'win32', delay: noDelay });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toContain('could not bring its window to the front');
  });

  it('a generic typing failure (exit 1) keeps the app-open fact but refuses the success claim', async () => {
    const { exec } = fakeExecTypingResult({ code: 1, stderr: 'something else broke' });
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'win32', delay: noDelay });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('could not copy your text');
  });

  it('exit 4 (keystrokes refused): honest failure pointing at the clipboard fallback', async () => {
    const { exec } = fakeExecTypingResult({ code: 4, stderr: 'keys-denied' });
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'win32', delay: noDelay });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('refused both the keystrokes and the clipboard fallback');
  });
});

describe('app_task dispatcher wiring', () => {
  it('runs through the ACL-gated dispatcher with the launcher deps', async () => {
    const { exec, commands } = fakeExec();
    const dispatch = createToolDispatcher({
      settings: () => DEFAULT_SETTINGS,
      exec,
      platform: 'win32',
      delay: noDelay,
    });
    const outcome = await dispatch({ id: 't1', tool: 'app_task', args: { app: 'notepad', content: 'hi there' } });
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBe('Opened notepad and typed your text');
    expect(commands[0]).toBe('start "" notepad');
    expect(commands[commands.length - 1]).toContain('$w.SendKeys');
  });

  it('denied when the launcher permission is off (handler never runs)', async () => {
    const { exec, commands } = fakeExec();
    const dispatch = createToolDispatcher({
      settings: () => ({
        ...DEFAULT_SETTINGS,
        permissions: { ...DEFAULT_SETTINGS.permissions, launcher: false },
      }),
      exec,
      platform: 'win32',
      delay: noDelay,
    });
    const outcome = await dispatch({ id: 't2', tool: 'app_task', args: { app: 'notepad', content: 'hi' } });
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toBe('Permission denied: launcher');
    expect(commands).toHaveLength(0);
  });
});

// app_task tool tests — alias launch + the win32 one-shot typing command
// (AppActivate + SendKeys + the base64 content round-trip), Start-Menu index
// resolution, unknown-app refusal, non-win32 honest degradation, the optional
// {ENTER}, content with newlines/quotes surviving the shell, and the
// dispatcher-level wiring + ACL denial (launcher gate).
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { createToolDispatcher } from './index';
import { APP_TASK_LAUNCH_DELAY_MS, buildTypeCommand, createAppTaskTool, escapeSendKeys } from './appTask';

const LNK = 'C:\\SM\\Programs\\Notepad.lnk';
const APPS = [{ name: 'notepad', command: 'notepad' }];

function fakeExec(code = 0) {
  const commands: string[] = [];
  return {
    commands,
    exec: async (command: string) => {
      commands.push(command);
      return { code, stdout: '', stderr: code === 0 ? '' : 'start failed' };
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

describe('buildTypeCommand', () => {
  it('activates the window and types the ESCAPED text directly first (no clipboard)', () => {
    const command = buildTypeCommand('Notepad', 'line one\nline "two" — done', false);
    expect(command).toContain("AppActivate('Notepad')");
    expect(command).toContain('$w.SendKeys');
    expect(command).toContain('-STA');
    expect(command).toContain('-WindowStyle Hidden');
    const literals = [...command.matchAll(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/g)].map((m) =>
      Buffer.from(m[1] ?? '', 'base64').toString('utf8'),
    );
    expect(literals[0]).toBe('line one{ENTER}line "two" — done');
  });

  it('keeps the raw content for the clipboard fallback inside the typing catch', () => {
    const command = buildTypeCommand('Notepad', 'line one\na + b (x)', false);
    const literals = [...command.matchAll(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/g)].map((m) =>
      Buffer.from(m[1] ?? '', 'base64').toString('utf8'),
    );
    expect(literals[1]).toBe('line one\na + b (x)');
    // clipboard fallback exists, after the primary SendKeys, with retries
    expect(command.indexOf('$w.SendKeys')).toBeLessThan(command.indexOf('Set-Clipboard'));
    expect(command).toContain('for ($i = 0; $i -lt 2');
    expect(command).toContain('Start-Sleep -Milliseconds 150');
    expect(command).not.toContain('Add-Type');
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

describe('createAppTaskTool', () => {
  it('happy (win32): resolves the alias, waits the launch delay, then ONE PowerShell typing invocation', async () => {
    const { exec, commands } = fakeExec();
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'win32', delay: spyDelay });
    const outcome = await tool({ app: 'notepad', content: 'buy milk' });
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBe('Opened notepad and typed your text');
    expect(delayCalls).toBe(1);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe('notepad');
    expect(commands[1]).toContain("AppActivate('notepad')");
    expect(commands[1]).toContain("$w.SendKeys('^v')");
    expect(decodedContent(commands[1] ?? '')).toBe('buy milk');
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
    expect(decodedContent(commands[1] ?? '')).toBe('hello world');
  });

  it('waits APP_TASK_LAUNCH_DELAY_MS (1500ms) before typing', async () => {
    const { exec } = fakeExec();
    let waited = 0;
    const tool = createAppTaskTool({
      apps: APPS,
      exec,
      platform: 'win32',
      delay: async (ms) => {
        waited = ms;
      },
    });
    await tool({ app: 'notepad', content: 'hello world' });
    expect(waited).toBe(APP_TASK_LAUNCH_DELAY_MS);
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
    expect(commands).toEqual(['notepad']);
  });

  it('missing app or content args → refusal without exec', async () => {
    const { exec, commands } = fakeExec();
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'win32', delay: noDelay });
    expect((await tool({ content: 'x' })).ok).toBe(false);
    expect((await tool({ app: 'notepad' })).ok).toBe(false);
    expect(commands).toHaveLength(0);
  });

  it('a failed typing invocation keeps the app-open fact but reports the copy failure', async () => {
    const commands: string[] = [];
    const exec = async (command: string) => {
      commands.push(command);
      // The launch succeeds; the PowerShell typing step fails.
      return command.startsWith('powershell')
        ? { code: 1, stdout: '', stderr: 'no window' }
        : { code: 0, stdout: '', stderr: '' };
    };
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'win32', delay: noDelay });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('Opened notepad but could not copy your text');
  });

  it('exit 2 (no window focus): honest partial success — never pastes into an unknown window', async () => {
    const commands: string[] = [];
    const exec = async (command: string) => {
      commands.push(command);
      return command.startsWith('powershell')
        ? { code: 2, stdout: '', stderr: 'no-focus' }
        : { code: 0, stdout: '', stderr: '' };
    };
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'win32', delay: noDelay });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toContain('could not bring its window to the front');
  });

  it('a generic typing failure (exit 1) keeps the app-open fact but refuses the success claim', async () => {
    const exec = async (command: string) =>
      command.startsWith('powershell')
        ? { code: 1, stdout: '', stderr: 'something else broke' }
        : { code: 0, stdout: '', stderr: '' };
    const tool = createAppTaskTool({ apps: APPS, exec, platform: 'win32', delay: noDelay });
    const outcome = await tool({ app: 'notepad', content: 'hello world' });
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('could not copy your text');
  });

  it('exit 4 (keystrokes refused): honest failure pointing at the clipboard fallback', async () => {
    const exec = async (command: string) =>
      command.startsWith('powershell')
        ? { code: 4, stdout: '', stderr: 'keys-denied' }
        : { code: 0, stdout: '', stderr: '' };
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
    expect(commands[0]).toBe('notepad');
    expect(commands[1]).toContain('$w.SendKeys');
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

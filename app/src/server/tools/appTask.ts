// app_task — open an app AND type specific content into it ("open notepad and
// write hello"). Resolution mirrors launch_app: configured alias → Start-Menu
// index → shell fallback. On win32 the typing step is ONE hidden PowerShell
// invocation that foregrounds the window (WScript AppActivate), puts the
// content on the clipboard — base64-decoded INSIDE PowerShell so arbitrary
// text/newlines/quotes survive the cmd→PS quoting — and pastes via SendKeys.
// Every adapter (exec, app-index fs, clock, platform) is injectable so vitest
// stays pure; non-win32 launches but says honestly that typing is Windows-only.
import process from 'node:process';
import type { AppAlias } from '../../shared/types';
import type { ToolOutcome } from './notion';
import { createDefaultExec, type ExecLike } from './launcher';
import { buildAppIndex, matchApp, type AppEntry, type AppIndex } from './appIndex';

/** How long the freshly launched app gets to open its window before typing. */
export const APP_TASK_LAUNCH_DELAY_MS = 1500;

/**
 * Exec budget for app_task's own default exec adapter (typing command AND the
 * window-wait polls share it). Long content + a slow first launch can outgrow
 * the launcher's 15s default, which read as "it took two attempts".
 */
export const APP_TASK_EXEC_TIMEOUT_MS = 30_000;

/** Window-wait: poll Get-Process every 400ms for up to ~8s (20 polls). */
export const APP_TASK_WINDOW_POLL_INTERVAL_MS = 400;
export const APP_TASK_WINDOW_WAIT_MS = 8_000;

export interface AppTaskDeps {
  /** Configured launcher aliases (Settings.apps) — the same list launch_app uses. */
  apps: AppAlias[];
  exec?: ExecLike;
  /** Start-Menu dirs for the universal resolver (same contract as launch_app). */
  appIndexDirs?: string[];
  appFs?: import('./appIndex').FsLike;
  platform?: string;
  /**
   * Injectable clock for the window-wait poll intervals and the fallback pause
   * between launch and typing (tests pass a no-op).
   */
  delay?: (ms: number) => Promise<void>;
}

/** Strip cmd/PowerShell-hostile characters from the AppActivate title. */
function safeAppTitle(name: string): string {
  return name.replace(/['"%&|<>^\r\n]/g, '').trim();
}

/** First token of the display name, lowercased — the Get-Process name probe. */
function appProcessName(appTitle: string): string {
  return safeAppTitle(appTitle).split(/\s+/)[0]?.toLowerCase() ?? '';
}

/**
 * PowerShell one-liner that prints how many visible top-level windows the
 * target process owns (0 = the app has not opened its window yet). Exported
 * for tests; polled by waitForAppWindow until the count is > 0.
 */
export function buildWindowWaitCommand(procName: string): string {
  return (
    `powershell -NoProfile -STA -WindowStyle Hidden -Command ` +
    `"(Get-Process -Name '${procName}' -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.MainWindowHandle -ne 0 } | Measure-Object).Count"`
  );
}

/**
 * Wait until the freshly launched app actually HAS a window, then let it
 * settle. Polls buildWindowWaitCommand every 400ms for up to ~8s so the typing
 * step no longer fires into a void on slow first launches (the "took two
 * attempts" bug), then waits a fixed SETTLE delay — a window handle appears
 * before the app's input pipeline is ready (WinUI Notepad fly-in etc.), and
 * keystrokes sent during initialization are silently swallowed. If the process
 * name never shows a window — aliases like `wt` spawn under a different exe —
 * or the probe itself errors, fall back to the historical fixed 1.5s pause.
 */
const APP_TASK_WINDOW_SETTLE_MS = 1_500;

async function waitForAppWindow(
  display: string,
  exec: ExecLike,
  delay: (ms: number) => Promise<void>,
): Promise<void> {
  const procName = appProcessName(display);
  if (!procName) {
    await delay(APP_TASK_LAUNCH_DELAY_MS);
    return;
  }
  const maxPolls = Math.max(1, Math.round(APP_TASK_WINDOW_WAIT_MS / APP_TASK_WINDOW_POLL_INTERVAL_MS));
  let seen = false;
  for (let poll = 0; poll < maxPolls && !seen; poll++) {
    try {
      const res = await exec(buildWindowWaitCommand(procName));
      if (Number.parseInt(res.stdout.trim(), 10) > 0) seen = true;
    } catch {
      break; // probe broken → the fixed-delay fallback below
    }
    if (!seen && poll < maxPolls - 1) await delay(APP_TASK_WINDOW_POLL_INTERVAL_MS);
  }
  if (seen) {
    await delay(APP_TASK_WINDOW_SETTLE_MS);
  } else {
    await delay(APP_TASK_LAUNCH_DELAY_MS);
  }
}

/**
 * The single win32 typing invocation (exported for tests): AppActivate the app
 * window, then TYPE the SendKeys-escaped text directly (newlines → {ENTER},
 * metacharacters brace-wrapped) via WScript SendKeys — no clipboard involved,
 * so clipboard managers/monitors that hold the clipboard open (and would block
 * or even hang Set-Clipboard) can never stall or silently no-op the task. If
 * keystrokes are refused, fall back to retried Set-Clipboard + ^v. Failure
 * modes exit with distinct codes so the caller can answer honestly instead of
 * pasting into whatever window happens to be focused: 2 = the window never
 * came to the front, 4 = keystrokes refused AND the clipboard fallback failed,
 * 1/other = anything else. Only single quotes appear inside the script (the
 * whole script is a cmd double-quoted argument), and the only interpolated
 * values are the sanitized title and base64 literals.
 */
export const APP_TASK_EXIT_NO_FOCUS = 2;
export const APP_TASK_EXIT_NO_KEYS = 4;

/** SendKeys metacharacters → literal braces first, THEN newlines/tabs → key names. */
export function escapeSendKeys(text: string): string {
  return text
    .replace(/([+^%~(){}[\]])/g, '{$1}')
    .replace(/\r?\n/g, '{ENTER}')
    .replace(/\t/g, '{TAB}');
}

export function buildTypeCommand(appTitle: string, content: string, enter: boolean): string {
  const keys = escapeSendKeys(content);
  const b64Raw = Buffer.from(content, 'utf8').toString('base64');
  const decode = (b: string) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b}'))`;
  // WScript.Shell.SendKeys (NOT .NET SendKeys): no Add-Type compile, so the
  // whole hidden invocation stays inside the app_task 30s exec budget.
  // Activation: prefer the process's own window handle area (PID match via
  // Get-Process, newest window first) — title matching alone can grab a wrong
  // window with a similar title; the title is only the fallback.
  const procName = appProcessName(appTitle);
  // Typing in CHUNKS with micro-pauses: freshly-initialized WinUI windows
  // swallow keys fired as one atomic burst (the "took two attempts"/partial
  // doc bug) — small chunks let the target's input queue drain. Chunk size
  // scales with length so 2000-char notes still type in ~1s of pauses.
  const chunkLen = Math.max(8, Math.ceil(keys.length / 20));
  const chunks: string[] = [];
  for (let i = 0; i < keys.length; i += chunkLen) chunks.push(keys.slice(i, i + chunkLen));
  const b64Chunks = chunks.map((c) => Buffer.from(c, 'utf8').toString('base64'));
  const typeStatements = b64Chunks
    .map((b, i) => {
      const send = `try { $w.SendKeys(${decode(b)}) } catch { [Console]::Error.WriteLine('keys-error: ' + $_.Exception.Message); $typedAll = $false }`;
      return i === 0
        ? `$typedAll = $true; ${send}`
        : `Start-Sleep -Milliseconds 60; ${send}`;
    })
    .join('; ');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$w = New-Object -ComObject WScript.Shell',
    // Newest PID ≈ newest process (StartTime can throw "access denied" for
    // other-user processes, killing the whole script under Stop preference).
    `$p = Get-Process -Name '${procName}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object Id -Descending | Select-Object -First 1`,
    `$act = if ($p) { $w.AppActivate($p.Id) } else { $false }`,
    `if (-not $act) { $act = $w.AppActivate('${safeAppTitle(appTitle)}') }`,
    `if (-not $act) { [Console]::Error.WriteLine('no-focus'); exit ${APP_TASK_EXIT_NO_FOCUS} }`,
    'Start-Sleep -Milliseconds 400',
    typeStatements,
    `if ($typedAll) { [Console]::Out.WriteLine('PATH=typed') } else {`,
    // Fallback: some apps refuse synthesized keys — one bounded clipboard
    // attempt and paste instead (Set-Clipboard can BLOCK indefinitely when a
    // clipboard manager holds the clipboard open, so only one try).
    '$set = $false',
    `try { Set-Clipboard -Value (${decode(b64Raw)}); $set = $true } catch { [Console]::Error.WriteLine('clip-error: ' + $_.Exception.Message) }`,
    `if ($set) { try { $w.SendKeys('^v'); [Console]::Out.WriteLine('PATH=pasted') } catch { [Console]::Error.WriteLine('keys-denied'); exit ${APP_TASK_EXIT_NO_KEYS} } } else { [Console]::Error.WriteLine('keys-denied'); exit ${APP_TASK_EXIT_NO_KEYS} }`,
    '} ',
    ...(enter
      ? [
          `try { $w.SendKeys('{ENTER}') } catch { [Console]::Error.WriteLine('keys-denied'); exit ${APP_TASK_EXIT_NO_KEYS} }`,
        ]
      : []),
  ].join('; ');
  return `powershell -NoProfile -STA -WindowStyle Hidden -Command "${script}"`;
}

export function createAppTaskTool(
  deps: AppTaskDeps,
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  const exec = deps.exec ?? createDefaultExec({ timeoutMs: APP_TASK_EXEC_TIMEOUT_MS });
  const platform = deps.platform ?? process.platform;
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return async (args) => {
    const raw = typeof args['app'] === 'string' ? args['app'].trim() : '';
    const content = typeof args['content'] === 'string' ? args['content'].trim() : '';
    if (!raw) return { ok: false, summary: 'No app provided for app_task.' };
    if (!content) return { ok: false, summary: 'No content provided to type.' };

    const available =
      deps.apps.length > 0 ? deps.apps.map((a) => a.name).join(', ') : '(none configured)';

    // 1) configured alias (same first step as launch_app; a failed alias falls
    //    through to the universal resolver below, and its error is kept so the
    //    final failure can say "Failed to launch" instead of "Unknown app").
    // A BARE command word ("notepad") is detached via `start ""` — cmd would
    // otherwise WAIT on console stubs (npm/Store apps) until the exec timeout.
    const alias = deps.apps.find((a) => a.name.toLowerCase() === raw.toLowerCase());
    let display: string | null = null;
    let aliasFailure = '';
    if (alias) {
      const bare = /^[\w.-]+$/.test(alias.command);
      const launchCmd = bare ? `start "" ${alias.command}` : alias.command;
      try {
        const res = await exec(launchCmd);
        if (res.code === 0) {
          display = alias.name;
        } else {
          aliasFailure =
            (res.stderr || res.stdout || `exit code ${res.code ?? 'unknown'}`).trim().slice(0, 120) ||
            'launch failed';
        }
      } catch (err) {
        aliasFailure = err instanceof Error ? err.message : String(err);
      }
    }

    // 2) universal resolver: ANY installed app via the Start-Menu index (built
    //    once and reused for the did-you-mean hints, unlike launch_app which
    //    rescans — same 3-step lookup, one less disk walk).
    let index: AppIndex | null = null;
    if (!display && deps.appIndexDirs && deps.appIndexDirs.length > 0) {
      try {
        index = buildAppIndex(deps.appIndexDirs, deps.appFs);
        const matches = matchApp(index, raw);
        if (matches.length > 0) {
          try {
            const res = await exec(`start "" "${matches[0].path}"`);
            if (res.code === 0) display = matches[0].name;
          } catch {
            /* fall through to the shell fallback */
          }
        }
      } catch {
        /* the index is best-effort */
      }
    }

    // 3) shell fallback for registered app execution aliases (winget installs,
    //    Store apps) - sanitized: no quotes/semicolons/pipes in the name.
    if (!display) {
      const safe = raw.replace(/[";|&`]/g, '');
      if (safe && safe === raw) {
        try {
          const res = await exec(`start "" ${safe}`);
          if (res.code === 0) display = raw;
        } catch {
          /* final miss below */
        }
      }
    }

    if (!display) {
      if (alias) {
        return {
          ok: false,
          summary: `Failed to launch ${alias.name}: ${aliasFailure || 'launch failed'}`,
          data: { alias: alias.name, command: alias.command },
        };
      }
      // Closest-match hints from the index so "notpad" suggests "Notepad".
      let hints = '';
      if (index) {
        const near = matchApp(index, raw)
          .slice(0, 3)
          .map((m) => m.name);
        if (near.length > 0) hints = ` Did you mean: ${near.join(', ')}?`;
      }
      return {
        ok: false,
        summary: `Unknown app "${raw}". Available apps: ${available}.${hints}`,
        data: { apps: deps.apps },
      };
    }

    if (platform !== 'win32') {
      // mac/linux: launch parity with launch_app, no SendKeys there — said honestly.
      return { ok: true, summary: `Opened ${display} (typing into apps is Windows-only right now)` };
    }

    // Wait until the app's first window exists (poll, ≤ ~8s, fixed 1.5s
    // fallback for aliases whose process name never shows up), then clipboard
    // + activate + paste in one shot.
    await waitForAppWindow(display, exec, delay);
    try {
      const res = await exec(buildTypeCommand(display, content, args['enter'] === true));
      // PATH=typed | PATH=pasted marker from the script — keeps the success
      // claim debuggable (which mechanism actually delivered the text).
      const path = /PATH=(typed|pasted)/.exec(res.stdout)?.[1] ?? 'unknown';
      if (res.code === 0) {
        return { ok: true, summary: `Opened ${display} and typed your text`, data: { path } };
      }
      const detail = (res.stderr || res.stdout || `exit code ${res.code ?? 'unknown'}`).trim().slice(0, 120);
      if (res.code === APP_TASK_EXIT_NO_FOCUS) {
        return {
          ok: true,
          summary: `Opened ${display} but could not bring its window to the front — click the app, then ask me again`,
        };
      }
      if (res.code === APP_TASK_EXIT_NO_KEYS) {
        return {
          ok: false,
          summary: `Opened ${display} but Windows refused both the keystrokes and the clipboard fallback (${detail})`,
        };
      }
      return {
        ok: false,
        summary: `Opened ${display} but could not copy your text (${detail})`,
      };
    } catch (err) {
      return {
        ok: false,
        summary: `Opened ${display} but could not copy your text: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}

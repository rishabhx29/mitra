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
import { buildAppIndex, matchApp, type AppEntry } from './appIndex';

/** How long the freshly launched app gets to open its window before typing. */
export const APP_TASK_LAUNCH_DELAY_MS = 1500;

export interface AppTaskDeps {
  /** Configured launcher aliases (Settings.apps) — the same list launch_app uses. */
  apps: AppAlias[];
  exec?: ExecLike;
  /** Start-Menu dirs for the universal resolver (same contract as launch_app). */
  appIndexDirs?: string[];
  appFs?: import('./appIndex').FsLike;
  platform?: string;
  /** Injectable pause between launch and typing (tests pass a no-op). */
  delay?: (ms: number) => Promise<void>;
}

/** Strip cmd/PowerShell-hostile characters from the AppActivate title. */
function safeAppTitle(name: string): string {
  return name.replace(/['"%&|<>^\r\n]/g, '').trim();
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
  const b64Keys = Buffer.from(escapeSendKeys(content), 'utf8').toString('base64');
  const b64Raw = Buffer.from(content, 'utf8').toString('base64');
  const decode = (b: string) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b}'))`;
  // WScript.Shell.SendKeys (NOT .NET SendKeys): no Add-Type compile, so the
  // whole hidden invocation stays inside the launcher's 15s exec budget.
  // Activation: prefer the process's own window handle area (PID match via
  // Get-Process, newest window first) — title matching alone can grab a wrong
  // window with a similar title; the title is only the fallback.
  const procName = safeAppTitle(appTitle).split(/\s+/)[0]?.toLowerCase() ?? '';
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$w = New-Object -ComObject WScript.Shell',
    `$p = Get-Process -Name '${procName}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1`,
    `$act = if ($p) { $w.AppActivate($p.Id) } else { $false }`,
    `if (-not $act) { $act = $w.AppActivate('${safeAppTitle(appTitle)}') }`,
    `if (-not $act) { [Console]::Error.WriteLine('no-focus'); exit ${APP_TASK_EXIT_NO_FOCUS} }`,
    'Start-Sleep -Milliseconds 400',
    `try { $w.SendKeys(${decode(b64Keys)}) } catch {`,
    // Fallback: some apps refuse synthesized keys — retry the clipboard a few
    // times and paste instead.
    '$set = $false',
    `for ($i = 0; $i -lt 2; $i++) { try { Set-Clipboard -Value (${decode(b64Raw)}); $set = $true; break } catch { Start-Sleep -Milliseconds 150 } }`,
    `if ($set) { try { $w.SendKeys('^v') } catch { [Console]::Error.WriteLine('keys-denied'); exit ${APP_TASK_EXIT_NO_KEYS} } } else { [Console]::Error.WriteLine('keys-denied'); exit ${APP_TASK_EXIT_NO_KEYS} }`,
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
  const exec = deps.exec ?? createDefaultExec();
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
    const alias = deps.apps.find((a) => a.name.toLowerCase() === raw.toLowerCase());
    let display: string | null = null;
    let aliasFailure = '';
    if (alias) {
      try {
        const res = await exec(alias.command);
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
    let index: { entries: AppEntry[]; byKey: Map<string, AppEntry> } | null = null;
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

    // Give the window time to appear, then clipboard + activate + paste in one shot.
    await delay(APP_TASK_LAUNCH_DELAY_MS);
    try {
      const res = await exec(buildTypeCommand(display, content, args['enter'] === true));
      if (res.code === 0) {
        return { ok: true, summary: `Opened ${display} and typed your text` };
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

// launch_app — resolves an alias from Settings.apps and runs its command through a
// shell exec. The exec adapter is injected so vitest stubs it; the default adapter
// shells out via child_process.exec (plan: "exec via child_process.exec with shell").
import { exec } from 'node:child_process';
import type { AppAlias } from '../../shared/types';
import { buildAppIndex, matchApp } from './appIndex';
import type { ToolOutcome } from './notion';

export interface ExecResultLike {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ExecLike = (command: string) => Promise<ExecResultLike>;

export interface LaunchAppDeps {
  apps: AppAlias[];
  exec?: ExecLike;
  /** Start-Menu dirs for the universal resolver (plan §2b): ANY installed app. */
  appIndexDirs?: string[];
  appFs?: import('./appIndex').FsLike;
}

function listAliases(apps: AppAlias[]): string {
  return apps.length > 0 ? apps.map((a) => a.name).join(', ') : '(none configured)';
}

function firstLine(s: string): string {
  const line = s
    .split(/\r?\n/)
    .map((t) => t.trim())
    .find(Boolean);
  return line ? line.slice(0, 160) : '';
}

/** Default adapter: shell exec, hidden window, 15s cap (launchers return immediately). */
export function createDefaultExec(): ExecLike {
  return async (command) => {
    try {
      const res = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        // exec always runs through the system shell; the `shell` option here only
        // customizes WHICH shell, so it stays at its default (string-typed).
        exec(
          command,
          { windowsHide: true, timeout: 15_000 },
          (err, stdout, stderr) => {
            if (err) {
              const enriched = err as { message?: string; code?: string; stdout?: string; stderr?: string };
              enriched.stdout = stdout;
              enriched.stderr = stderr;
              reject(enriched);
              return;
            }
            resolve({ stdout, stderr });
          },
        );
      });
      return { code: 0, stdout: res.stdout, stderr: res.stderr };
    } catch (err) {
      const e = err as { code?: number | null; stdout?: string; stderr?: string; message?: string };
      return {
        code: typeof e.code === 'number' ? e.code : null,
        stdout: e.stdout ?? '',
        stderr: e.stderr || e.message || 'exec failed',
      };
    }
  };
}

export function createLaunchAppTool(
  deps: LaunchAppDeps,
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  const exec = deps.exec ?? createDefaultExec();
  return async (args) => {
    const raw = typeof args['alias'] === 'string' ? args['alias'].trim() : '';
    const available = listAliases(deps.apps);
    if (!raw) {
      return {
        ok: false,
        summary: `No app alias provided. Available apps: ${available}`,
        data: { apps: deps.apps },
      };
    }
    // 1) configured alias (existing behavior)
    const alias = deps.apps.find((a) => a.name.toLowerCase() === raw.toLowerCase());
    if (alias) {
      let res0: ExecResultLike;
      try {
        res0 = await exec(alias.command);
      } catch (err) {
        return {
          ok: false,
          summary: `Failed to launch ${alias.name}: ${err instanceof Error ? err.message : String(err)}`,
          data: { apps: deps.apps },
        };
      }
      if (res0.code === 0) {
        return { ok: true, summary: `Opening ${alias.name}`, data: { apps: deps.apps } };
      }
      // alias command failed -> keep trying the universal resolver below
    }

    // 2) universal resolver: ANY installed app via the Start-Menu index
    if (deps.appIndexDirs && deps.appIndexDirs.length > 0) {
      const index = buildAppIndex(deps.appIndexDirs, deps.appFs);
      const matches = matchApp(index, raw);
      if (matches.length > 0) {
        const target = matches[0];
        try {
          const resLnk = await exec(`start "" "${target.path}"`);
          if (resLnk.code === 0) {
            return { ok: true, summary: `Opening ${target.name}`, data: { apps: deps.apps } };
          }
        } catch {
          /* fall through to shell fallback */
        }
      }
    }

    // 3) shell fallback for registered app execution aliases (winget installs,
    //    Store apps) - sanitized: no quotes/semicolons/pipes in the name.
    const safe = raw.replace(/[";|&`]/g, '');
    if (safe && safe === raw) {
      try {
        const resShell = await exec(`start "" ${safe}`);
        if (resShell.code === 0) {
          return { ok: true, summary: `Opening ${raw}` };
        }
      } catch {
        /* final miss below */
      }
    }

    if (!alias) {
      // closest-match hints from the index so "chrome" suggests "Google Chrome"
      let hints = '';
      if (deps.appIndexDirs && deps.appIndexDirs.length > 0) {
        try {
          const index = buildAppIndex(deps.appIndexDirs, deps.appFs);
          const near = matchApp(index, raw)
            .slice(0, 3)
            .map((m) => m.name);
          if (near.length > 0) hints = ` Did you mean: ${near.join(', ')}?`;
        } catch {
          /* hints are best-effort */
        }
      }
      return {
        ok: false,
        summary: `Unknown app "${raw}". Available apps: ${available}.${hints}`,
        data: { apps: deps.apps },
      };
    }
    let res: ExecResultLike;
    try {
      res = await exec(alias.command);
    } catch (err) {
      return {
        ok: false,
        summary: `Failed to launch ${alias.name}: ${err instanceof Error ? err.message : String(err)}`,
        data: { alias: alias.name, command: alias.command },
      };
    }
    if (res.code === 0) {
      return {
        ok: true,
        summary: `Launched ${alias.name}`,
        data: { alias: alias.name, command: alias.command },
      };
    }
    const detail = firstLine(res.stderr) || firstLine(res.stdout) || `exit code ${res.code ?? 'unknown'}`;
    return {
      ok: false,
      summary: `Failed to launch ${alias.name}: ${detail}`,
      data: { alias: alias.name, command: alias.command, exitCode: res.code },
    };
  };
}

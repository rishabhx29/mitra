// lock_workstation — locks the desktop (docs/ULTRON_PORT.md row 4). Windows runs
// the standard rundll32 incantation through the same injected exec path the
// launcher tool uses; macOS/Linux are honest no-ops (ok:true, "not supported on
// this OS") so the agent never pretends it locked something it cannot. Gated by
// `launcher`.
import process from 'node:process';
import type { ToolOutcome } from './notion';
import { createDefaultExec, type ExecLike } from './launcher';

/** Standard Windows lock command ( rundll32 → user32.dll LockWorkStation ). */
export const LOCK_WORKSTATION_COMMAND = 'rundll32.exe user32.dll,LockWorkStation';

export interface LockWorkstationDeps {
  exec?: ExecLike;
  platform?: string;
}

function firstLine(s: string, max = 120): string {
  const line = s
    .split(/\r?\n/)
    .map((t) => t.trim())
    .find(Boolean);
  return line ? line.slice(0, max) : '';
}

export function createLockWorkstationTool(
  deps: LockWorkstationDeps = {},
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  const exec = deps.exec ?? createDefaultExec();
  const platform = deps.platform ?? process.platform;
  return async () => {
    if (platform !== 'win32') {
      return {
        ok: true,
        summary: `Locking the workstation is not supported on this OS (${platform}) — nothing was locked.`,
        data: { platform, supported: false },
      };
    }
    try {
      const res = await exec(LOCK_WORKSTATION_COMMAND);
      if (res.code === 0) {
        return {
          ok: true,
          summary: 'Locking the workstation now.',
          data: { platform, supported: true, command: LOCK_WORKSTATION_COMMAND },
        };
      }
      const detail =
        firstLine(res.stderr) || firstLine(res.stdout) || `exit code ${res.code ?? 'unknown'}`;
      return {
        ok: false,
        summary: `Could not lock the workstation: ${detail}`,
        data: { platform, supported: true, command: LOCK_WORKSTATION_COMMAND },
      };
    } catch (err) {
      return {
        ok: false,
        summary: `Could not lock the workstation: ${err instanceof Error ? err.message : String(err)}`,
        data: { platform, supported: true, command: LOCK_WORKSTATION_COMMAND },
      };
    }
  };
}

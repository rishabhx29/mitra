// workspace_mode — launches a named bundle of app aliases + URLs from
// Settings.workspaceModes in one go (docs/ULTRON_PORT.md row 1). Apps resolve
// against the same launcher alias list the launch_app tool uses and run through
// the same injected exec path; URLs go through the same opener as open_url
// (with the same http(s)-only policy). Every app/URL that cannot run is listed
// as skipped with its reason — a partially-installed mode still launches the
// rest. Gated by `launcher`.
import process from 'node:process';
import type { AppAlias, WorkspaceMode } from '../../shared/types';
import type { ToolOutcome } from './notion';
import { createDefaultExec, type ExecLike } from './launcher';
import { createDefaultUrlOpener, type UrlOpener } from './url';

export interface WorkspaceModeDeps {
  /** Presets from Settings.workspaceModes (re-read per dispatch by the bridge). */
  modes: WorkspaceMode[];
  /** Launcher aliases from Settings.apps. */
  apps: AppAlias[];
  exec?: ExecLike;
  opener?: UrlOpener;
  /** Used only to build the default opener. */
  platform?: string;
}

export function normalizeModeKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Case-insensitive alias lookup, same matching rule as the launch_app tool. */
function findAppAlias(name: string, apps: AppAlias[]): AppAlias | undefined {
  const key = normalizeModeKey(name);
  return apps.find((a) => normalizeModeKey(a.name) === key);
}

/**
 * Resolve a mode by id, name or alias. Pass 1 is exact (case/whitespace-normalized);
 * pass 2 is a lenient containment match (query inside a key or a key inside the
 * query, minimum 3 chars) so near-misses like "please gaming" still resolve.
 * Settings order breaks ties.
 */
export function findWorkspaceMode(query: string, modes: WorkspaceMode[]): WorkspaceMode | null {
  const q = normalizeModeKey(query);
  if (!q) return null;
  for (const mode of modes) {
    if (normalizeModeKey(mode.id) === q || normalizeModeKey(mode.name) === q) return mode;
    if (mode.aliases.some((a) => normalizeModeKey(a) === q)) return mode;
  }
  if (q.length < 3) return null;
  for (const mode of modes) {
    const keys = [mode.id, mode.name, ...mode.aliases].map(normalizeModeKey).filter(Boolean);
    if (keys.some((k) => k.includes(q) || q.includes(k))) return mode;
  }
  return null;
}

function firstLine(s: string, max = 120): string {
  const line = s
    .split(/\r?\n/)
    .map((t) => t.trim())
    .find(Boolean);
  return line ? line.slice(0, max) : '';
}

function reasonFromExec(res: { code: number | null; stdout: string; stderr: string }): string {
  return (
    firstLine(res.stderr) || firstLine(res.stdout) || `exit code ${res.code ?? 'unknown'}`
  );
}

function reasonFromError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function createWorkspaceModeTool(
  deps: WorkspaceModeDeps,
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  const exec = deps.exec ?? createDefaultExec();
  const opener = deps.opener ?? createDefaultUrlOpener(deps.platform ?? process.platform, exec);
  return async (args) => {
    const raw = typeof args['name'] === 'string' ? args['name'] : '';
    const available = deps.modes.length > 0 ? deps.modes.map((m) => m.id).join(', ') : '(none configured)';
    if (!raw.trim()) {
      return { ok: false, summary: `No workspace mode given. Available modes: ${available}` };
    }
    const mode = findWorkspaceMode(raw, deps.modes);
    if (!mode) {
      return { ok: false, summary: `Unknown workspace mode "${raw}". Available modes: ${available}` };
    }

    const launched: string[] = [];
    const opened: string[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const appName of mode.apps) {
      const alias = findAppAlias(appName, deps.apps);
      if (!alias) {
        skipped.push({ name: appName, reason: `no launcher alias named "${appName}"` });
        continue;
      }
      try {
        const res = await exec(alias.command);
        if (res.code === 0) {
          launched.push(alias.name);
        } else {
          skipped.push({ name: alias.name, reason: reasonFromExec(res) });
        }
      } catch (err) {
        skipped.push({ name: alias.name, reason: reasonFromError(err) });
      }
    }

    for (const url of mode.urls) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        skipped.push({ name: url, reason: 'not a valid URL' });
        continue;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        skipped.push({ name: url, reason: 'refusing non-http(s) URL' });
        continue;
      }
      const finalUrl = parsed.toString();
      try {
        await opener(finalUrl);
        opened.push(finalUrl);
      } catch (err) {
        skipped.push({ name: finalUrl, reason: reasonFromError(err) });
      }
    }

    const parts: string[] = [];
    if (launched.length > 0) parts.push(`launched ${launched.join(', ')}`);
    if (opened.length > 0) parts.push(`opened ${opened.join(', ')}`);
    const ok = launched.length + opened.length > 0;
    let summary = ok
      ? `Workspace "${mode.name}": ${parts.join('; ')}`
      : `Workspace "${mode.name}": nothing launched`;
    if (skipped.length > 0) {
      summary += ` (skipped ${skipped.map((s) => `${s.name}: ${s.reason}`).join('; ')})`;
    }
    return { ok, summary, data: { mode: mode.id, launched, opened, skipped } };
  };
}

// open_any_app / close_app / web_search — the GENERAL app-control tools
// (docs/DECISION_TIER_PLAN.md §2b): any installed app via the Start-Menu index,
// graceful close, and web search. Exec/opener injected for vitest.
import type { ToolOutcome } from './notion';
import { exeGuess, matchApp, type AppEntry } from './appIndex';
import type { ExecLike } from './launcher';

export interface OpenAnyAppDeps {
  index: { entries: AppEntry[]; byKey: Map<string, AppEntry> };
  exec: ExecLike;
  /** settings.apps alias names for the "did you mean one of these" hint. */
  aliasNames: string[];
}

export async function openAnyApp(name: string, deps: OpenAnyAppDeps): Promise<ToolOutcome> {
  const query = name.trim();
  if (!query) {
    return { ok: false, summary: 'Which app should I open? Say the app name.' };
  }
  const matches = matchApp(deps.index, query);
  if (matches.length === 0) {
    const aliases = deps.aliasNames.length > 0 ? ` Configured aliases: ${deps.aliasNames.join(', ')}.` : '';
    return { ok: false, summary: `I could not find an app called "${query}".${aliases}` };
  }
  const target = matches[0];
  // Windows resolves .lnk targets natively; `start "" "<path>"` avoids title parsing.
  const res = await deps.exec(`start "" "${target.path}"`);
  if (res.code !== 0) {
    return { ok: false, summary: `Could not launch ${target.name}: ${res.stderr || 'unknown error'}` };
  }
  return { ok: true, summary: `Opening ${target.name}` };
}

export async function closeApp(name: string, deps: OpenAnyAppDeps): Promise<ToolOutcome> {
  const query = name.trim();
  if (!query) {
    return { ok: false, summary: 'Which app should I close?' };
  }
  const matches = matchApp(deps.index, query);
  if (matches.length === 0) {
    return { ok: false, summary: `I could not find a running-install match for "${query}".` };
  }
  const target = matches[0];
  const exe = exeGuess(target.name);
  // Graceful close first (no /F — apps get a chance to save); report honestly.
  const res = await deps.exec(`taskkill /IM ${exe}.exe`);
  if (res.code !== 0) {
    return {
      ok: false,
      summary: `${target.name} is not running (or could not be closed): ${firstLine(res.stderr)}`,
    };
  }
  return { ok: true, summary: `Closed ${target.name}` };
}

export async function webSearch(query: string, opener: (url: string) => Promise<void>): Promise<ToolOutcome> {
  const q = query.trim();
  if (!q) {
    return { ok: false, summary: 'What should I search for?' };
  }
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  try {
    await opener(url);
    return { ok: true, summary: `Searching the web for "${q}"` };
  } catch (error) {
    return { ok: false, summary: `Could not open the browser: ${String(error).slice(0, 80)}` };
  }
}

function firstLine(s: string): string {
  const line = s
    .split(/\r?\n/)
    .map((t) => t.trim())
    .find(Boolean);
  return line ? line.slice(0, 120) : 'unknown error';
}

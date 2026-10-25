// Settings → Local Bridge HTTP client (Task E NotionPanel; extended by the
// Ultron-port panels — ModesPanel workspace_mode runs, MemoryPanel memory CRUD).
//
// Runs in the renderer; the bridge lives in Electron main on 127.0.0.1:8765
// (bridge.ts DEFAULT_BRIDGE_PORT). The constant is re-declared here instead of
// imported: importing ../server/bridge would pull express into the renderer
// bundle. If the port ever changes, change both (frozen at Phase 0).
//
// Every call degrades — network failures and denials become typed results,
// never thrown (mock-mode rule).

import type {
  MemoryEntry,
  MemoryToolArgs,
  WorkspaceModeRunData,
} from '../shared/types';
import { toMemoryEntries } from './memoryModel';

export const BRIDGE_PORT = 8765;
const BASE = `http://127.0.0.1:${BRIDGE_PORT}`;

/** Mirrors MockTodo in src/server/mockNotion.ts (shape-frozen by the bridge route). */
export interface BoardItem {
  id: string;
  text: string;
  createdAt: string;
}

export type BoardResult =
  | { ok: true; items: BoardItem[] }
  | { ok: false; summary: string; items: [] };

/** GET /api/notion/items — the persisted mock board. */
export async function fetchBoardItems(timeoutMs = 2500): Promise<BoardResult> {
  try {
    const res = await fetch(`${BASE}/api/notion/items`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json()) as { ok?: unknown; items?: unknown; summary?: unknown };
    if (body.ok !== true || !Array.isArray(body.items)) {
      return {
        ok: false,
        summary: typeof body.summary === 'string' ? body.summary : 'Bridge returned an unexpected response',
        items: [],
      };
    }
    const items = body.items.filter(
      (it): it is BoardItem =>
        typeof it === 'object' &&
        it !== null &&
        typeof (it as BoardItem).id === 'string' &&
        typeof (it as BoardItem).text === 'string' &&
        typeof (it as BoardItem).createdAt === 'string',
    );
    return { ok: true, items };
  } catch {
    return { ok: false, summary: 'bridge-offline', items: [] };
  }
}

export type AddResult =
  | { ok: true; summary: string }
  | { ok: false; summary: string; denied: boolean };

export type HealthResult = { ok: true; mock: boolean } | { ok: false; summary: string };

/**
 * GET /api/health — liveness + mock mode (src/server/bridge.ts route shape:
 * { ok, service, mock }). `mock` drives the Home page's provider-mode badge.
 */
export async function fetchBridgeHealth(timeoutMs = 2500): Promise<HealthResult> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json().catch(() => null)) as { ok?: unknown; mock?: unknown } | null;
    if (body?.ok !== true) return { ok: false, summary: `HTTP ${res.status}` };
    return { ok: true, mock: body.mock === true };
  } catch {
    return { ok: false, summary: 'bridge-offline' };
  }
}

/**
 * POST /api/tools/notion_add_todo — the same ACL-gated path the voice agent uses
 * (integration fact: tool responses branch on body.ok; HTTP 403 also carries a
 * ToolResult body → denied).
 */
export async function addBoardItem(text: string, timeoutMs = 4000): Promise<AddResult> {
  const fail = (summary: string, denied = false): AddResult => ({ ok: false, summary, denied });
  const trimmed = text.trim();
  if (!trimmed) return fail('empty');
  try {
    const res = await fetch(`${BASE}/api/tools/notion_add_todo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: { text: trimmed } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as { ok?: unknown; summary?: unknown } | null;
    const summary = typeof body?.summary === 'string' ? body.summary : `HTTP ${res.status}`;
    if (res.status === 403) return fail(summary, true);
    return body?.ok === true ? { ok: true, summary } : fail(summary);
  } catch {
    return fail('bridge-offline');
  }
}

// ---- Ultron-port tools (docs/ULTRON_PORT.md rows 1 & 5) ----

export type ToolRunResult<T> =
  | { ok: true; summary: string; data: T | null }
  | { ok: false; summary: string; denied: boolean };

export type MemoryListResult =
  | { ok: true; entries: MemoryEntry[] }
  | { ok: false; summary: string; denied: boolean };

/**
 * POST /api/tools/:name — the same ACL-gated path the voice agent uses.
 * The bridge reads the tool from the URL and `args` from the body (403 also
 * carries a ToolResult body → denied). Never throws; offline → bridge-offline.
 */
async function callTool(
  tool: string,
  args: Record<string, unknown>,
  timeoutMs = 4000,
): Promise<ToolRunResult<unknown>> {
  const fail = (summary: string, denied = false): ToolRunResult<unknown> => ({ ok: false, summary, denied });
  try {
    const res = await fetch(`${BASE}/api/tools/${tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok?: unknown; summary?: unknown; data?: unknown }
      | null;
    const summary = typeof body?.summary === 'string' ? body.summary : `HTTP ${res.status}`;
    if (res.status === 403) return fail(summary, true);
    if (body?.ok === true) {
      return { ok: true, summary, data: (body.data ?? null) as unknown };
    }
    return fail(summary);
  } catch {
    return fail('bridge-offline');
  }
}

/** "Run now" from the Modes panel: launch a saved workspace bundle by name. */
export async function runWorkspaceMode(name: string, timeoutMs = 8000): Promise<ToolRunResult<WorkspaceModeRunData>> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, summary: 'empty', denied: false };
  const result = await callTool('workspace_mode', { name: trimmed }, timeoutMs);
  if (!result.ok) return result;
  // Defensive: data must be the workspace.ts payload
  // { mode, launched, opened, skipped } to render the launched chips.
  const d = result.data as Partial<WorkspaceModeRunData> | null;
  if (!d || typeof d !== 'object' || !Array.isArray(d.launched) || !Array.isArray(d.opened)) {
    return { ok: true, summary: result.summary, data: null };
  }
  const strings = (list: unknown[]): string[] => list.filter((x): x is string => typeof x === 'string');
  const data: WorkspaceModeRunData = {
    mode: typeof d.mode === 'string' ? d.mode : '',
    launched: strings(d.launched),
    opened: strings(d.opened),
    skipped: Array.isArray(d.skipped)
      ? d.skipped.flatMap((s) =>
          s !== null && typeof s === 'object' &&
          typeof (s as { name?: unknown }).name === 'string' &&
          typeof (s as { reason?: unknown }).reason === 'string'
            ? [{ name: (s as { name: string }).name, reason: (s as { reason: string }).reason }]
            : [],
        )
      : [],
  };
  return { ok: true, summary: result.summary, data };
}

/** GET-equivalent of the memory store: the raw entry list (row 5 `list`). */
export async function listMemoryEntries(timeoutMs = 4000): Promise<MemoryListResult> {
  const result = await callTool('memory', { action: 'list' } satisfies MemoryToolArgs, timeoutMs);
  if (!result.ok) return result;
  return { ok: true, entries: toMemoryEntries(result.data) };
}

/** Scored recall ("what do you remember about X") for the viewer search box. */
export async function recallMemoryEntries(query: string, timeoutMs = 4000): Promise<MemoryListResult> {
  const text = query.trim();
  // The tool REQUIRES a query for `recall` (bare recall → ok:false); an empty
  // search box means "show everything", which is exactly the `list` action.
  if (!text) return listMemoryEntries(timeoutMs);
  const result = await callTool('memory', { action: 'recall', text } satisfies MemoryToolArgs, timeoutMs);
  if (!result.ok) return result;
  return { ok: true, entries: toMemoryEntries(result.data) };
}

/** Store one fact ("remember that …"). */
export async function rememberEntry(text: string, timeoutMs = 4000): Promise<AddResult> {
  const fail = (summary: string, denied = false): AddResult => ({ ok: false, summary, denied });
  const trimmed = text.trim();
  if (!trimmed) return fail('empty');
  const result = await callTool('memory', { action: 'remember', text: trimmed } satisfies MemoryToolArgs, timeoutMs);
  return result.ok ? { ok: true, summary: result.summary } : fail(result.summary, result.denied);
}

/** Delete one entry (extends the ledger's remember/recall/list — see MemoryToolArgs). */
export async function forgetEntry(id: string, timeoutMs = 4000): Promise<AddResult> {
  const fail = (summary: string, denied = false): AddResult => ({ ok: false, summary, denied });
  const trimmed = id.trim();
  if (!trimmed) return fail('empty');
  const result = await callTool('memory', { action: 'forget', id: trimmed } satisfies MemoryToolArgs, timeoutMs);
  return result.ok ? { ok: true, summary: result.summary } : fail(result.summary, result.denied);
}

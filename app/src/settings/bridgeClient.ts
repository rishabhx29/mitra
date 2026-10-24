// Settings → Local Bridge HTTP client (Task E NotionPanel).
//
// Runs in the renderer; the bridge lives in Electron main on 127.0.0.1:8765
// (bridge.ts DEFAULT_BRIDGE_PORT). The constant is re-declared here instead of
// imported: importing ../server/bridge would pull express into the renderer
// bundle. If the port ever changes, change both (frozen at Phase 0).
//
// Every call degrades — network failures and denials become typed results,
// never thrown (mock-mode rule).

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

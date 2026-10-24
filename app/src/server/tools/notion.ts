// notion_add_todo — real path hits the Notion API v1 pages endpoint; mock path writes
// the local mock board. Any real-path failure degrades to the mock board with a summary
// that says so (plan Review Focus #1: mock mode must never depend on credentials/network).
import type { NotionConfig } from '../../shared/types';
import type { MockNotion } from '../mockNotion';

export type ToolOutcome = { ok: boolean; summary: string; data?: unknown };

/** Structural subset of `Response` — lets tests stub fetch without node/DOM types. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponseLike>;

export const NOTION_API_BASE = 'https://api.notion.com/v1';
export const NOTION_API_VERSION = '2022-06-28';

export interface NotionToolDeps {
  notion: NotionConfig;
  mock: MockNotion;
  fetchImpl?: FetchLike;
}

function fallbackToMock(mock: MockNotion, text: string, reason: string): Promise<ToolOutcome> {
  // Collapse whitespace + cap length so the summary stays speakable (TTS-friendly).
  const detail = reason.replace(/\s+/g, ' ').trim().slice(0, 160);
  return mock.add(text).then((todo) => ({
    ok: true,
    summary: `Notion unavailable (${detail}); saved to the local mock board instead: "${text}"`,
    data: { todo, fallback: true, reason: detail },
  }));
}

export function createNotionAddTodoTool(
  deps: NotionToolDeps,
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  return async (args) => {
    const raw = args['text'];
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) {
      return { ok: false, summary: 'No text provided for the todo.' };
    }

    if (deps.notion.mock) {
      const todo = await deps.mock.add(text);
      return {
        ok: true,
        summary: `Added to Notion (mock board): "${text}"`,
        data: { todo, mock: true },
      };
    }

    const { token, databaseId } = deps.notion;
    if (!token || !databaseId) {
      return fallbackToMock(deps.mock, text, 'missing token or database id');
    }

    try {
      const res = await fetchImpl(`${NOTION_API_BASE}/pages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties: { Title: { title: [{ text: { content: text } }] } },
        }),
      });
      if (!res.ok) {
        return fallbackToMock(deps.mock, text, `Notion API responded ${res.status}: ${(await res.text()).slice(0, 120)}`);
      }
      const page = (await res.json()) as { id?: string } | null;
      return {
        ok: true,
        summary: `Added to Notion: "${text}"`,
        data: { pageId: typeof page?.id === 'string' ? page.id : null },
      };
    } catch (err) {
      return fallbackToMock(deps.mock, text, err instanceof Error ? err.message : String(err));
    }
  };
}

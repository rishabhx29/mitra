// youtube_search — opens the YouTube search-results page for a query via the
// injected opener (docs/DECISION_TIER_PLAN.md §2). URL building is a separate
// exported pure function so tests pin the encoding without any opener; the
// default opener shells out per-platform exactly like open_url.
import process from 'node:process';
import type { ToolOutcome } from './notion';
import { createDefaultUrlOpener, type UrlOpener } from './url';
import { createDefaultExec, type ExecLike } from './launcher';

/** URL-encoded YouTube results URL for `query`. */
export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export interface YoutubeSearchDeps {
  opener?: UrlOpener;
  /** Used only to build the default opener. */
  platform?: string;
  exec?: ExecLike;
}

export function createYoutubeSearchTool(
  deps: YoutubeSearchDeps = {},
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  const opener =
    deps.opener ?? createDefaultUrlOpener(deps.platform ?? process.platform, deps.exec ?? createDefaultExec());
  return async (args) => {
    const raw = args['query'];
    const query = typeof raw === 'string' ? raw.trim() : '';
    if (!query) {
      return { ok: false, summary: 'No search query provided.' };
    }
    const url = youtubeSearchUrl(query);
    try {
      await opener(url);
      return { ok: true, summary: `Searching YouTube for "${query}"`, data: { url, query } };
    } catch (err) {
      return {
        ok: false,
        summary: `Failed to open YouTube: ${err instanceof Error ? err.message : String(err)}`,
        data: { url, query },
      };
    }
  };
}

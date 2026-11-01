// get_world_news / get_finance_news — spoken news briefs from free public RSS
// feeds (no keys, no cloud dependency beyond the feeds themselves). Parallel
// fetch, top items per feed, tags stripped, merged into a speakable summary.
// Behavior ported from the Friday reference (see docs/FRIDAY_PORT.md); this
// implementation is our own. Fetch is injectable so vitest stays offline.
import type { ToolOutcome } from './notion';
import { createDefaultExec, type ExecLike } from './launcher';

export type NewsFetchLike = (url: string) => Promise<{ ok: boolean; status: number; text: string }>;

export interface NewsDeps {
  fetchImpl?: NewsFetchLike;
  /** Injectable clock-independent sleep for tests. */
  all?: <T>(items: Promise<T>[]) => Promise<T[]>;
  /** Opens the visual monitor after a successful brief (win32 default). */
  exec?: ExecLike;
  platform?: string;
  /** Skip opening the monitor (tests). */
  openMonitor?: boolean;
}

const WORLD_FEEDS = [
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://www.aljazeera.com/xml/rss/all.xml',
  'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
  'https://www.cnbc.com/id/100727362/device/rss/rss.html',
];

const FINANCE_FEEDS = [
  'https://www.cnbc.com/id/10000664/device/rss/rss.html',
  'https://feeds.marketwatch.com/marketwatch/topstories/',
  'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
  'https://feeds.bloomberg.com/markets/news.rss',
];

export const WORLD_MONITOR_URL = 'https://www.worldmonitor.app/';
export const FINANCE_MONITOR_URL = 'https://finance.worldmonitor.app/';

/** Strip HTML tags + CDATA noise and collapse whitespace for speakable text. */
export function stripTags(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^<]+?>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract the first `limit` <item> titles from an RSS/XML document. */
export function parseFeedTitles(xml: string, limit = 4): string[] {
  const out: string[] = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && out.length < limit) {
    const block = m[0];
    const t = /<title>([\s\S]*?)<\/title>/i.exec(block)?.[1];
    const title = t ? stripTags(t) : '';
    if (title) out.push(title);
  }
  return out;
}

const SOURCE_BRANDS: ReadonlyArray<[RegExp, string]> = [
  [/bbci\.co\.uk|bbc/, 'BBC'],
  [/aljazeera/, 'Al Jazeera'],
  [/nytimes/, 'NYT'],
  [/cnbc/, 'CNBC'],
  [/marketwatch/, 'MarketWatch'],
  [/bloomberg/, 'Bloomberg'],
  [/reuters/, 'Reuters'],
];

function sourceName(url: string): string {
  for (const [re, brand] of SOURCE_BRANDS) {
    if (re.test(url)) return brand;
  }
  const host = /https:\/\/(?:www\.)?([^/]+)/.exec(url)?.[1] ?? url;
  const parts = host.split('.').filter((p) => !['feeds', 'www', 'rss'].includes(p));
  const base = parts[0] ?? host;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function createNewsTool(kind: 'world' | 'finance', deps: NewsDeps = {}) {
  const fetchImpl: NewsFetchLike =
    deps.fetchImpl ?? ((url) => fetch(url).then((r) => r.text().then((text) => ({ ok: r.ok, status: r.status, text }))));
  const exec = deps.exec ?? createDefaultExec();
  const platform = deps.platform ?? process.platform;
  const feeds = kind === 'world' ? WORLD_FEEDS : FINANCE_FEEDS;
  const monitorUrl = kind === 'world' ? WORLD_MONITOR_URL : FINANCE_MONITOR_URL;
  const label = kind === 'world' ? 'world' : 'finance';

  return async (): Promise<ToolOutcome> => {
    const results = await Promise.all(
      feeds.map(async (url) => {
        try {
          const res = await fetchImpl(url);
          if (!res.ok) return [] as Array<{ source: string; title: string }>;
          return parseFeedTitles(res.text, 3).map((t) => ({ source: sourceName(url), title: t }));
        } catch {
          return [] as Array<{ source: string; title: string }>;
        }
      }),
    );
    const items = results.flat();
    if (items.length === 0) {
      return { ok: false, summary: `The ${label} news feeds are unreachable right now — try again in a moment.` };
    }
    // One headline per source, in feed order — a speakable brief, not a dump.
    const brief: string[] = [];
    for (const item of items) {
      if (brief.length >= 6) break;
      brief.push(`${item.source}: ${item.title}`);
    }
    const summary = `Here's the ${label} brief. ${brief.join('. ')}`;

    // Friday's choreography: after the brief, pull up the visual monitor.
    if (deps.openMonitor !== false && platform === 'win32') {
      try {
        await exec(`start "" "${monitorUrl}"`);
      } catch {
        /* the brief still stands even if the monitor fails to open */
      }
    }
    return {
      ok: true,
      summary,
      data: { kind, monitorUrl, headlines: items.slice(0, 8) },
    };
  };
}

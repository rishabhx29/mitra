// youtube_search tool tests — URL encoding (pure), happy open via the injected
// opener, empty query, opener failure, and the dispatcher-level ACL denial
// (browser gate).
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { createToolDispatcher, type ToolDispatcherDeps } from './index';
import { createYoutubeSearchTool, youtubeSearchUrl } from './youtube';

function baseDeps(overrides: Partial<ToolDispatcherDeps> = {}): ToolDispatcherDeps {
  return {
    settings: () => DEFAULT_SETTINGS,
    ...overrides,
  };
}

describe('youtubeSearchUrl (pure)', () => {
  it('URL-encodes the query into the results endpoint', () => {
    expect(youtubeSearchUrl('lofi beats')).toBe('https://www.youtube.com/results?search_query=lofi%20beats');
  });

  it('encodes ampersands, ampersand-joined params and Devanagari safely', () => {
    expect(youtubeSearchUrl('a & b')).toBe('https://www.youtube.com/results?search_query=a%20%26%20b');
    expect(youtubeSearchUrl('ड्रम कवर')).toBe(
      'https://www.youtube.com/results?search_query=%E0%A4%A1%E0%A5%8D%E0%A4%B0%E0%A4%AE%20%E0%A4%95%E0%A4%B5%E0%A4%B0',
    );
  });
});

describe('createYoutubeSearchTool', () => {
  it('happy: opens the encoded URL via the injected opener and speaks the query', async () => {
    const opened: string[] = [];
    const tool = createYoutubeSearchTool({
      opener: (url) => {
        opened.push(url);
      },
    });
    const outcome = await tool({ query: 'lofi beats' });
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toBe('Searching YouTube for "lofi beats"');
    expect(opened).toEqual(['https://www.youtube.com/results?search_query=lofi%20beats']);
  });

  it('empty query → honest refusal, opener never touched', async () => {
    const opened: string[] = [];
    const tool = createYoutubeSearchTool({
      opener: (url) => {
        opened.push(url);
      },
    });
    const outcome = await tool({ query: '  ' });
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('No search query provided');
    expect(opened).toHaveLength(0);
  });

  it('opener failure → ok:false with the reason', async () => {
    const tool = createYoutubeSearchTool({
      opener: () => {
        throw new Error('xdg-open missing');
      },
    });
    const outcome = await tool({ query: 'news' });
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('Failed to open YouTube');
    expect(outcome.summary).toContain('xdg-open missing');
  });
});

describe('youtube_search via the tool dispatcher', () => {
  it('routes to the handler with the shared opener and ACL-gates on browser', async () => {
    const opened: string[] = [];
    const dispatch = createToolDispatcher(
      baseDeps({
        opener: (url) => {
          opened.push(url);
        },
        platform: 'win32',
      }),
    );
    const result = await dispatch({ id: 'y1', tool: 'youtube_search', args: { query: 'cat videos' } });
    expect(result.ok).toBe(true);
    expect(opened).toEqual(['https://www.youtube.com/results?search_query=cat%20videos']);
  });

  it('denied when the browser gate is off — the opener is never invoked', async () => {
    const opened: string[] = [];
    const dispatch = createToolDispatcher(
      baseDeps({
        settings: () => ({ ...DEFAULT_SETTINGS, permissions: { ...DEFAULT_SETTINGS.permissions, browser: false } }),
        opener: (url) => {
          opened.push(url);
        },
      }),
    );
    const result = await dispatch({ id: 'y2', tool: 'youtube_search', args: { query: 'cat videos' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Permission denied: browser');
    expect(opened).toHaveLength(0);
  });
});

// News tool tests — RSS parse, tag strip, per-source brief, monitor choreography.
// All fetch/exec faked; no network.
import { describe, expect, it } from 'vitest';
import { createNewsTool, parseFeedTitles, stripTags } from './news';

const FEED_XML = `<?xml version="1.0"?><rss><channel>
<item><title>Big story &amp; one</title><link>https://a.example/1</link></item>
<item><title><![CDATA[CDATA story two]]></title></item>
<item><title>Third <b>bold</b> story</title></item>
</channel></rss>`;

describe('parseFeedTitles / stripTags', () => {
  it('extracts titles, strips tags, entities and CDATA', () => {
    expect(stripTags('<b>Hello</b> &amp; goodbye&nbsp;world')).toBe('Hello & goodbye world');
    expect(parseFeedTitles(FEED_XML, 5)).toEqual([
      'Big story & one', // &amp;amp; → literal &amp; → stripped once
      'CDATA story two',
      'Third bold story',
    ]);
  });
});

describe('createNewsTool', () => {
  const fakeDeps = (failWorld = false) => {
    const execs: string[] = [];
    return {
      execs,
      deps: {
        openMonitor: true,
        exec: async (cmd: string) => {
          execs.push(cmd);
          return { code: 0, stdout: '', stderr: '' };
        },
        platform: 'win32',
        fetchImpl: async (url: string) => {
          if (failWorld) return { ok: false, status: 500, text: '' };
          // every feed "succeeds" so both variants have items
          return { ok: true, status: 200, text: FEED_XML };
        },
      },
    };
  };

  it('builds a per-source spoken brief from the feeds', async () => {
    const { deps, execs } = fakeDeps();
    const tool = createNewsTool('world', deps);
    const out = await tool();
    expect(out.ok).toBe(true);
    expect(out.summary).toContain('BBC:');
    expect(out.summary).toContain('Big story');
    // Friday choreography: the brief pulls up the visual monitor.
    expect(execs.some((c) => c.includes('worldmonitor.app'))).toBe(true);
  });

  it('reports honestly when every feed is unreachable', async () => {
    const { deps } = fakeDeps(true);
    const tool = createNewsTool('world', deps);
    const out = await tool();
    expect(out.ok).toBe(false);
    expect(out.summary).toContain('unreachable');
  });

  it('finance variant opens the finance monitor', async () => {
    const { deps, execs } = fakeDeps();
    const tool = createNewsTool('finance', deps);
    const out = await tool();
    expect(out.ok).toBe(true);
    expect(execs.some((c) => c.includes('finance.worldmonitor.app'))).toBe(true);
  });
});

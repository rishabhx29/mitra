// Router tests — the fast decision tier (docs/DECISION_TIER_PLAN.md §1), pure
// with a fake fetch (no network, no Laya install needed):
//   routeViaLaya  — success shapes, the 'reminder'→set_reminder mapping, the
//                   confidence gate (>0.6), timeout/404/garbage degradation;
//   pickArgs      — deterministic per-tool arg extraction (note text, youtube
//                   query, reminder minutes, launch alias, url; no-arg tools;
//                   fall-through-to-chat when nothing extracts).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYA_URL,
  LAYA_MIN_CONFIDENCE,
  LAYA_TOOL_OPTIONS,
  buildSystemOneRequest,
  decideFromSystemOneResponse,
  pickArgs,
  routeViaLaya,
  type LayaFetchLike,
  type LayaResponseLike,
} from './router';

function jsonResponse(payload: unknown, ok = true, status = 200): LayaResponseLike {
  return { ok, status, json: async () => payload };
}

type Captured = { url: string; init?: { method?: string; body?: string; signal?: AbortSignal } };

function fakeLaya(answer: (url: string, init?: Captured['init']) => Promise<LayaResponseLike> | LayaResponseLike): LayaFetchLike & { calls: Captured[] } {
  const calls: Captured[] = [];
  return Object.assign(
    (async (url: string, init?: Captured['init']) => {
      calls.push({ url, init });
      return answer(url, init);
    }) as LayaFetchLike,
    { calls },
  );
}

describe('buildSystemOneRequest', () => {
  it('carries the utterance as state.text + the VERIFIED live choice shape (object questions, instructions + criteria)', () => {
    const body = buildSystemOneRequest('play lofi on youtube') as {
      state: { text: string };
      questions: Record<string, { type: string; instructions: string; criteria: Record<string, string> }>;
    };
    expect(body.state.text).toBe('play lofi on youtube');
    // Verified live shape: questions is an OBJECT keyed by question id.
    const q = body.questions['route_tool'];
    expect(q.type).toBe('choice');
    expect(Object.keys(q.criteria)).toEqual([...LAYA_TOOL_OPTIONS]);
    expect(q.criteria['none']).toContain('no tool');
  });
});

describe('routeViaLaya', () => {
  const deps = (fetchImpl: LayaFetchLike, layaUrl = DEFAULT_LAYA_URL) => ({ fetchImpl, layaUrl });

  it('success: {choice, confidence} → {tool, confidence, via:"laya"}; POSTs state+question to /v1/systemone', async () => {
    const laya = fakeLaya(() => jsonResponse({ choice: 'youtube_search', confidence: 0.92 }));
    const decision = await routeViaLaya('play lofi on youtube', deps(laya));
    expect(decision).toEqual({ tool: 'youtube_search', confidence: 0.92, via: 'laya' });
    expect(laya.calls).toHaveLength(1);
    expect(laya.calls[0]?.url).toBe('http://127.0.0.1:8000/v1/systemone');
    expect(laya.calls[0]?.init?.method).toBe('POST');
    const body = JSON.parse(laya.calls[0]?.init?.body ?? '{}') as { state: { text: string } };
    expect(body.state.text).toBe('play lofi on youtube');
    expect(laya.calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('trailing slash on layaUrl is stripped; a custom URL is honored', async () => {
    const laya = fakeLaya(() => jsonResponse({ choice: 'agenda_today', confidence: 0.9 }));
    const decision = await routeViaLaya("what's due today", deps(laya, 'http://127.0.0.1:9000/'));
    expect(decision.tool).toBe('agenda_today');
    expect(laya.calls[0]?.url).toBe('http://127.0.0.1:9000/v1/systemone');
  });

  it('object answer shapes ({answer:{option,score}} / {answers:[…]}) parse too', async () => {
    const obj = await routeViaLaya(
      'x',
      deps(fakeLaya(() => jsonResponse({ answer: { option: 'agenda_today', score: 0.8 } }))),
    );
    expect(obj).toEqual({ tool: 'agenda_today', confidence: 0.8, via: 'laya' });
    const arr = await routeViaLaya(
      'x',
      deps(fakeLaya(() => jsonResponse({ answers: [{ value: 'launch_app', prob: '0.75' }] }))),
    );
    expect(arr).toEqual({ tool: 'launch_app', confidence: 0.75, via: 'laya' });
  });

  it("the plan's 'reminder' option names the set_reminder tool", async () => {
    const decision = await routeViaLaya('x', deps(fakeLaya(() => jsonResponse({ choice: 'reminder', confidence: 0.95 }))));
    expect(decision).toEqual({ tool: 'set_reminder', confidence: 0.95, via: 'laya' });
  });

  it(`confidence must be STRICTLY above the gate (${LAYA_MIN_CONFIDENCE}) — 0.6 is a none`, async () => {
    const at = await routeViaLaya('x', deps(fakeLaya(() => jsonResponse({ choice: 'agenda_today', confidence: 0.6 }))));
    expect(at).toEqual({ confidence: 0.6, via: 'none' });
    const below = await routeViaLaya('x', deps(fakeLaya(() => jsonResponse({ choice: 'agenda_today', confidence: 0.59 }))));
    expect(below).toEqual({ confidence: 0.59, via: 'none' });
    const missing = await routeViaLaya('x', deps(fakeLaya(() => jsonResponse({ choice: 'agenda_today' }))));
    expect(missing).toEqual({ confidence: 0, via: 'none' }); // no confidence → below the gate
  });

  it("the 'none' choice and unknown choices never name a tool", async () => {
    const none = await routeViaLaya('hello there', deps(fakeLaya(() => jsonResponse({ choice: 'none', confidence: 0.99 }))));
    expect(none).toEqual({ confidence: 0.99, via: 'none' });
    const unknown = await routeViaLaya('hello there', deps(fakeLaya(() => jsonResponse({ choice: 'hack_the_planet', confidence: 0.99 }))));
    expect(unknown).toEqual({ confidence: 0.99, via: 'none' });
  });

  it('404 (sidecar absent) → {confidence:0, via:"none"}', async () => {
    const decision = await routeViaLaya('x', deps(fakeLaya(() => jsonResponse({ choice: 'none' }, false, 404))));
    expect(decision).toEqual({ confidence: 0, via: 'none' });
  });

  it('timeout / connection refused (fetch throws) → via:"none", never throws', async () => {
    const decision = await routeViaLaya(
      'x',
      deps(
        fakeLaya(() => {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }),
      ),
    );
    expect(decision).toEqual({ confidence: 0, via: 'none' });
  });

  it('garbage responses (non-JSON, null, array, wrong types, empty choice) → via:"none"', async () => {
    const garbage: unknown[] = [
      'not json at all',
      null,
      [1, 2, 3],
      {},
      { choice: 42 },
      { choice: '' },
      { choice: '   ' },
      { answer: { nope: true } },
    ];
    for (const payload of garbage) {
      const decision = await routeViaLaya('x', deps(fakeLaya(() => jsonResponse(payload))));
      expect(decision).toEqual({ confidence: 0, via: 'none' });
    }
    const throwing = await routeViaLaya(
      'x',
      deps(
        fakeLaya(() => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('invalid json');
          },
        })),
      ),
    );
    expect(throwing).toEqual({ confidence: 0, via: 'none' });
  });

  it('empty text short-circuits to none without any fetch', async () => {
    const laya = fakeLaya(() => jsonResponse({ choice: 'youtube_search', confidence: 0.9 }));
    const decision = await routeViaLaya('   ', deps(laya));
    expect(decision).toEqual({ confidence: 0, via: 'none' });
    expect(laya.calls).toHaveLength(0);
  });
});

describe('decideFromSystemOneResponse', () => {
  it('is the pure decision core routeViaLaya wraps', () => {
    expect(decideFromSystemOneResponse({ choice: 'agenda_today', confidence: 0.9 })).toEqual({
      tool: 'agenda_today',
      confidence: 0.9,
      via: 'laya',
    });
    expect(decideFromSystemOneResponse('garbage')).toEqual({ confidence: 0, via: 'none' });
  });
});

describe('pickArgs (deterministic per-tool regexes)', () => {
  it('note_notepad → the note text (en + hinglish + Devanagari shapes)', () => {
    expect(pickArgs('note_notepad', 'note this: buy milk')).toEqual({ text: 'buy milk' });
    expect(pickArgs('note_notepad', 'note that the wifi password is 1234')).toEqual({
      text: 'the wifi password is 1234',
    });
    expect(pickArgs('note_notepad', 'add buy milk to my notepad')).toEqual({ text: 'buy milk' });
    expect(pickArgs('note_notepad', 'notepad me call mom add karo')).toEqual({ text: 'call mom' });
    expect(pickArgs('note_notepad', 'दूध लेना है notepad me likho')).toEqual({ text: 'दूध लेना है' });
    expect(pickArgs('note_notepad', 'नोट करो दूध लेना है')).toEqual({ text: 'दूध लेना है' });
  });

  it('youtube_search → the query (en + hinglish + Devanagari shapes)', () => {
    expect(pickArgs('youtube_search', 'open youtube and search lofi beats')).toEqual({ query: 'lofi beats' });
    expect(pickArgs('youtube_search', 'search cat videos on youtube')).toEqual({ query: 'cat videos' });
    expect(pickArgs('youtube_search', 'play despacito on youtube')).toEqual({ query: 'despacito' });
    expect(pickArgs('youtube_search', 'youtube par cricket highlights search karo')).toEqual({
      query: 'cricket highlights',
    });
    expect(pickArgs('youtube_search', 'youtube pe old songs chalao')).toEqual({ query: 'old songs' });
    expect(pickArgs('youtube_search', 'lofi youtube pe chalao')).toEqual({ query: 'lofi' });
  });

  it('youtube_search bare "search X" extracts too (pickArgs-only shape — deterministic intents never fire on it)', () => {
    expect(pickArgs('youtube_search', 'search quantum computing')).toEqual({ query: 'quantum computing' });
  });

  it('set_reminder → reuses the existing duration parser (minutes + optional text)', () => {
    expect(pickArgs('set_reminder', 'remind me in 10 minutes to stretch')).toEqual({
      minutes: 10,
      text: 'stretch',
    });
    expect(pickArgs('set_reminder', '15 minute ka timer')).toEqual({ minutes: 15, text: '' });
    expect(pickArgs('set_reminder', 'remind me soon')).toBeNull(); // no duration → fall through to chat
  });

  it('launch_app / open_url → alias and URL', () => {
    expect(pickArgs('launch_app', 'open notepad')).toEqual({ alias: 'notepad' });
    expect(pickArgs('open_url', 'open github.com')).toEqual({ url: 'https://github.com' });
  });

  it('no-arg tools get an empty args object', () => {
    expect(pickArgs('agenda_today', "what's due today")).toEqual({});
    expect(pickArgs('lock_workstation', 'lock my pc')).toEqual({});
  });

  it('args-requiring tools without a safe regex → null (bridge falls through to chat)', () => {
    for (const tool of ['notion_add_todo', 'workspace_mode', 'run_opencode_task', 'memory'] as const) {
      expect(pickArgs(tool, 'hello there')).toBeNull();
    }
  });

  it('no matching shape in the utterance → null (e.g. Laya misfired)', () => {
    expect(pickArgs('note_notepad', 'hello there')).toBeNull();
    expect(pickArgs('youtube_search', 'hello there')).toBeNull();
  });
});

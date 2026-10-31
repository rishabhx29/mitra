// Bridge route tests — the fast decision tier HTTP surface (pattern:
// bridge.brain.test.ts — real express on an ephemeral loopback port, injected
// fetch so the suite NEVER touches the network):
//   POST /api/brain/route  — deterministic tier, Laya tier (success/absent/404/
//                            garbage/no-extractable-args), LAYA_URL env,
//                            empty text, never-5xx;
//   GET  /api/brain/laya   — Voice-panel badge probe {available:boolean}.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { startBridge, type BridgeDeps, type BridgeHandle } from './bridge';
import type { FetchResponseLike } from './tools/notion';

let handle: BridgeHandle | null = null;

afterEach(async () => {
  if (handle) {
    await handle.close();
    handle = null;
  }
});

async function start(deps: BridgeDeps): Promise<BridgeHandle> {
  handle = await startBridge({ ...deps, port: deps.port ?? 0 });
  return handle;
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

type Captured = { url: string; init?: { method?: string; body?: string } };

function jsonResponse(payload: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

/** Fake fetch that answers ONLY the laya sidecar; records every call. */
function fakeLaya(answer: (url: string) => FetchResponseLike | Promise<FetchResponseLike>, urlMatch = '/v1/systemone') {
  const calls: Captured[] = [];
  const impl = Object.assign(
    (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, init });
      if (url.includes(urlMatch)) return answer(url);
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as (url: string, init?: { method?: string; body?: string }) => Promise<FetchResponseLike>,
    { calls },
  );
  return impl as typeof impl & { calls: Captured[] };
}

async function postRoute(port: number, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/brain/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/brain/route — tier 1: deterministic parseIntent', () => {
  it('add-todo utterance → the mapped tool + args with via:"deterministic" (no Laya call)', async () => {
    const laya = fakeLaya(() => jsonResponse({ choice: 'none' }));
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: laya });
    const { status, json } = await postRoute(h.port, { text: 'add milk to my list' });
    expect(status).toBe(200);
    expect(json).toEqual({ tool: 'notion_add_todo', args: { text: 'milk' }, confidence: 1, via: 'deterministic' });
    expect(laya.calls).toHaveLength(0);
  });

  it('new-real-world utterances route deterministically too (note / youtube / agenda)', async () => {
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: fakeLaya(() => jsonResponse({})) });
    const note = await postRoute(h.port, { text: 'note this: buy milk' });
    expect(note.json).toEqual({ tool: 'note_notepad', args: { text: 'buy milk' }, confidence: 1, via: 'deterministic' });

    const yt = await postRoute(h.port, { text: 'play lofi beats on youtube' });
    expect(yt.json).toEqual({ tool: 'youtube_search', args: { query: 'lofi beats' }, confidence: 1, via: 'deterministic' });

    const agenda = await postRoute(h.port, { text: 'aaj kya karna hai' });
    expect(agenda.json).toEqual({ tool: 'agenda_today', args: {}, confidence: 1, via: 'deterministic' });
  });

  it('workspace modes feed the deterministic parser (same contract as the voice brain)', async () => {
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: fakeLaya(() => jsonResponse({})) });
    const { json } = await postRoute(h.port, { text: 'coding mode chalu karo' });
    expect(json).toEqual({
      tool: 'workspace_mode',
      args: { name: 'Coding' },
      confidence: 1,
      via: 'deterministic',
    });
  });
});

describe('POST /api/brain/route — tier 2: the optional Laya sidecar', () => {
  it('Laya names the tool → pickArgs parameterizes it → via:"laya"', async () => {
    const laya = fakeLaya(() => jsonResponse({ choice: 'youtube_search', confidence: 0.9 }));
    const h = await start({
      settings: () => makeSettings(),
      env: {},
      fetchImpl: laya,
      layaUrl: 'http://127.0.0.1:8899',
    });
    const { json } = await postRoute(h.port, { text: 'search quantum computing videos' });
    expect(json).toEqual({
      tool: 'youtube_search',
      args: { query: 'quantum computing videos' },
      confidence: 0.9,
      via: 'laya',
    });
    expect(laya.calls[0]?.url).toBe('http://127.0.0.1:8899/v1/systemone');
    const body = JSON.parse(laya.calls[0]?.init?.body ?? '{}') as { state: { text: string } };
    expect(body.state.text).toBe('search quantum computing videos');
  });

  it("LAYA_URL env overrides the default sidecar URL (deps.layaUrl stays highest)", async () => {
    const laya = fakeLaya(() => jsonResponse({ choice: 'agenda_today', confidence: 0.8 }));
    const h = await start({ settings: () => makeSettings(), env: { LAYA_URL: 'http://127.0.0.1:9111' }, fetchImpl: laya });
    const { json } = await postRoute(h.port, { text: 'hello there' });
    expect(json).toEqual({ tool: 'agenda_today', args: {}, confidence: 0.8, via: 'laya' });
    expect(laya.calls[0]?.url).toBe('http://127.0.0.1:9111/v1/systemone');
  });

  it("Laya picks 'none' / low confidence → {confidence, via:'none'}", async () => {
    const laya = fakeLaya(() => jsonResponse({ choice: 'none', confidence: 0.99 }));
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: laya });
    const { json } = await postRoute(h.port, { text: 'who are you?' });
    expect(json).toEqual({ confidence: 0.99, via: 'none' });
  });

  it('Laya names an args-requiring tool but no regex extracts args → via:"none" (fall through to chat)', async () => {
    const laya = fakeLaya(() => jsonResponse({ choice: 'notion_add_todo', confidence: 0.9 }));
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: laya });
    const { json } = await postRoute(h.port, { text: 'something about milk maybe' });
    expect(json).toEqual({ confidence: 0.9, via: 'none' });
  });

  it('sidecar absent (fetch throws) → {confidence:0, via:"none"} — the tier is optional', async () => {
    const laya = fakeLaya(() => {
      throw new Error('ECONNREFUSED');
    });
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: laya });
    const { status, json } = await postRoute(h.port, { text: 'who are you?' });
    expect(status).toBe(200);
    expect(json).toEqual({ confidence: 0, via: 'none' });
  });

  it('sidecar absent + bare "search X" → web_search fallback (spoken searches work without Laya)', async () => {
    const laya = fakeLaya(() => {
      throw new Error('ECONNREFUSED');
    });
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: laya });
    const { json } = await postRoute(h.port, { text: 'search lofi beats' });
    expect(json).toEqual({
      tool: 'web_search',
      args: { query: 'lofi beats' },
      confidence: 0.6,
      via: 'deterministic',
    });
    // A youtube-named search stays deterministic territory even with Laya down.
    const yt = await postRoute(h.port, { text: 'search cat videos on youtube' });
    expect(yt.json).toMatchObject({ tool: 'youtube_search', via: 'deterministic' });
  });

  it('media words in a bare search read as YouTube intent ("search avengers doomsday trailer")', async () => {
    const laya = fakeLaya(() => {
      throw new Error('ECONNREFUSED');
    });
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: laya });
    const { json } = await postRoute(h.port, { text: 'search avengers doomsday trailer' });
    expect(json).toMatchObject({
      tool: 'youtube_search',
      args: { query: 'avengers doomsday trailer' },
      via: 'deterministic',
    });
    // non-media queries stay web
    const web = await postRoute(h.port, { text: 'search rust vs go' });
    expect(web.json).toMatchObject({ tool: 'web_search' });
  });

  it('sidecar 404 / garbage shape → via:"none", never a 5xx', async () => {
    const h404 = await start({
      settings: () => makeSettings(),
      env: {},
      fetchImpl: fakeLaya(() => jsonResponse('Not Found', false, 404)),
    });
    expect((await postRoute(h404.port, { text: 'who are you?' })).json).toEqual({ confidence: 0, via: 'none' });
    await handle?.close();

    const hGarbage = await start({
      settings: () => makeSettings(),
      env: {},
      fetchImpl: fakeLaya(() => jsonResponse({ totally: 'different' })),
    });
    expect((await postRoute(hGarbage.port, { text: 'who are you?' })).json).toEqual({ confidence: 0, via: 'none' });
  });

  it('empty / missing text → {confidence:0, via:"none"} without touching Laya', async () => {
    const laya = fakeLaya(() => jsonResponse({ choice: 'agenda_today', confidence: 0.9 }));
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: laya });
    const empty = await postRoute(h.port, { text: '   ' });
    expect(empty.json).toEqual({ confidence: 0, via: 'none' });
    const missing = await postRoute(h.port, {});
    expect(missing.json).toEqual({ confidence: 0, via: 'none' });
    expect(laya.calls).toHaveLength(0);
  });

  it('malformed JSON body → the express error handler keeps JSON (400, ok:false)', async () => {
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: fakeLaya(() => jsonResponse({})) });
    const { status, json } = await postRoute(h.port, '{not json');
    expect(status).toBe(400);
    expect(json).toEqual({ ok: false, summary: 'Invalid JSON body' });
  });
});

describe('GET /api/brain/laya — Voice-panel badge probe', () => {
  it('sidecar answers (any status) → {available:true}', async () => {
    const laya = fakeLaya(() => jsonResponse({}, false, 404), '127.0.0.1:8000');
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: laya });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/brain/laya`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true });
    expect(laya.calls[0]?.url).toBe('http://127.0.0.1:8000/');
  });

  it('sidecar unreachable → {available:false}, still HTTP 200', async () => {
    const laya = fakeLaya(() => {
      throw new Error('ECONNREFUSED');
    });
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: laya });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/brain/laya`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
  });
});

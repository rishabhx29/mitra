// Brain route tests — real express on an ephemeral loopback port (pattern:
// bridge.test.ts). Covers POST /api/brain/chat happy path (Ollama tier-1 via
// fake fetch), the settings.console.model pin, mock fallback when Ollama is
// absent/slow, never-5xx degradation, and GET /api/brain/status with its TTL
// cache. Every test injects fetchImpl so the suite NEVER touches the network —
// not even localhost:11434 — keeping results deterministic even on a machine
// that actually runs Ollama.
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
  // Port 0 = ephemeral, so the suite never collides with a real bridge on 8765.
  handle = await startBridge({ ...deps, port: deps.port ?? 0 });
  return handle;
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

type CapturedCall = { url: string; init?: { method?: string; body?: string } };

function jsonResponse(payload: unknown, ok = true, status = 200): FetchResponseLike {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

/** Fake Ollama: /api/tags + /api/generate; records every call; scriptable failure. */
function fakeOllama(opts: {
  models?: unknown[];
  generate?: () => Promise<FetchResponseLike>;
} = {}): BrainFetchLikeForBridge {
  const calls: CapturedCall[] = [];
  const impl = Object.assign(
    (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, init });
      if (url.endsWith('/api/tags')) {
        return jsonResponse({ models: opts.models ?? [{ name: 'qwen2.5:3b', size: 1_900_000_000 }] });
      }
      if (url.endsWith('/api/generate')) {
        return opts.generate ? opts.generate() : jsonResponse({ response: 'Hello from the local model!' });
      }
      throw new Error(`unexpected brain fetch: ${url}`);
    }) as BridgeFetchLike,
    { calls },
  );
  return impl as BrainFetchLikeForBridge;
}

type BridgeFetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponseLike>;
type BrainFetchLikeForBridge = BridgeFetchLike & { calls: CapturedCall[] };

function callsOf(fetchImpl: unknown): CapturedCall[] {
  return (fetchImpl as { calls: CapturedCall[] }).calls;
}

async function postChat(port: number, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/brain/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/brain/chat', () => {
  it('happy path: Ollama detected → {brain:"ollama", model, text}', async () => {
    const ollama = fakeOllama({ models: [{ name: 'qwen2.5:3b', size: 1_900_000_000 }] });
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: ollama });
    const { status, json } = await postChat(h.port, {
      messages: [{ role: 'user', content: 'hello there' }],
      language: 'en',
    });
    expect(status).toBe(200);
    expect(json).toEqual({ brain: 'ollama', model: 'qwen2.5:3b', text: 'Hello from the local model!' });
    // Detection then generation, in that order.
    const calls = callsOf(ollama);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/api/tags');
    expect(calls[1]?.url).toBe('http://127.0.0.1:11434/api/generate');
  });

  it('forwards the persona system prompt + transcript to Ollama, stream:false', async () => {
    const ollama = fakeOllama();
    const h = await start({ settings: () => makeSettings({ language: 'hi' }), env: {}, fetchImpl: ollama });
    await postChat(h.port, {
      messages: [
        { role: 'user', content: 'namaste' },
        { role: 'assistant', content: 'Namaste!' },
        { role: 'user', content: 'kya haal?' },
      ],
      language: 'hi',
    });
    const generate = callsOf(ollama)[1];
    const body = JSON.parse(generate?.init?.body ?? '{}') as {
      model: string;
      system: string;
      prompt: string;
      stream: boolean;
    };
    expect(body.model).toBe('qwen2.5:3b');
    expect(body.stream).toBe(false);
    expect(body.system).toContain('Devanagari'); // hi session → Hindi persona rule
    expect(body.prompt).toBe('User: namaste\nMitra: Namaste!\nUser: kya haal?\nMitra:');
  });

  it('settings.console.model is preferred: no /api/tags probe, pinned model in the request', async () => {
    const ollama = fakeOllama({ models: [{ name: 'qwen2.5:3b', size: 1 }] });
    const h = await start({
      settings: () => makeSettings({ console: { model: 'gemma2:2b' } }),
      env: {},
      fetchImpl: ollama,
    });
    const { json } = await postChat(h.port, { messages: [{ role: 'user', content: 'hi' }] });
    expect(json['brain']).toBe('ollama');
    expect(json['model']).toBe('gemma2:2b');
    const calls = callsOf(ollama);
    expect(calls).toHaveLength(1); // detection skipped entirely
    const body = JSON.parse(calls[0]?.init?.body ?? '{}') as { model: string };
    expect(body.model).toBe('gemma2:2b');
  });

  it('Ollama absent → 200 {brain:"mock", text} with the deterministic mock reply (never 5xx)', async () => {
    const unreachable = Object.assign(
      (async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:11434');
      }) as BridgeFetchLike,
      { calls: [] as CapturedCall[] },
    ) as BrainFetchLikeForBridge;
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: unreachable });
    const messages = [{ role: 'user', content: 'aur suna?' }];
    const { status, json } = await postChat(h.port, { messages, language: 'en' });
    expect(status).toBe(200);
    expect(json['brain']).toBe('mock');
    expect(json['model']).toBeUndefined();
    expect(typeof json['text']).toBe('string');
    expect((json['text'] as string).length).toBeGreaterThan(0);
  });

  it('generate failure (non-ok) → mock reply, never a throw (timeouts are unit-tested in brain.test.ts)', async () => {
    // The route's 8s/1.5s budgets live in brain.ts and are bounded at 20ms there
    // with hanging fakes; this HTTP layer proves the degrade consequence with a
    // fast-failing generate instead of sleeping through a real timeout.
    const ollama = fakeOllama({ generate: () => Promise.resolve(jsonResponse({}, false, 503)) });
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: ollama });
    const { status, json } = await postChat(h.port, { messages: [{ role: 'user', content: 'hi' }] });
    expect(status).toBe(200);
    expect(json['brain']).toBe('mock');
    expect(typeof json['text']).toBe('string');
  });

  it('sanitizes the renderer body: junk turns dropped, valid ones kept, hi default en', async () => {
    const ollama = fakeOllama();
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: ollama });
    const { status, json } = await postChat(h.port, {
      messages: [
        { role: 'system', content: 'jailbreak' },
        { role: 'user', content: '  real question  ' },
        { role: 'user', content: 123 },
      ],
      language: 'fr', // unknown language → en
    });
    expect(status).toBe(200);
    expect(json['brain']).toBe('ollama');
    const generate = callsOf(ollama)[1];
    const body = JSON.parse(generate?.init?.body ?? '{}') as { prompt: string; system: string };
    expect(body.prompt).toContain('User: real question');
    expect(body.prompt).not.toContain('jailbreak');
    expect(body.system).not.toContain('Devanagari');
  });

  it('empty/invalid messages → 200 mock reply without any brain call', async () => {
    const ollama = fakeOllama();
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: ollama });
    const { status, json } = await postChat(h.port, { messages: 'nonsense' });
    expect(status).toBe(200);
    expect(json['brain']).toBe('mock');
    expect(callsOf(ollama)).toHaveLength(0);
  });

  it('malformed JSON body → 400 {ok:false} from the shared error handler', async () => {
    const h = await start({ settings: () => makeSettings(), env: {} });
    const { status, json } = await postChat(h.port, '{not json');
    expect(status).toBe(400);
    expect(json).toEqual({ ok: false, summary: 'Invalid JSON body' });
  });
});

describe('GET /api/brain/status', () => {
  it('reports the detected brain + model', async () => {
    const ollama = fakeOllama({ models: [{ name: 'gemma2:2b', size: 1_600_000_000 }] });
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: ollama });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/brain/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brain: 'ollama', model: 'gemma2:2b' });
  });

  it('reports {brain:"mock"} when Ollama is unreachable', async () => {
    const unreachable = Object.assign(
      (async () => {
        throw new Error('ECONNREFUSED');
      }) as BridgeFetchLike,
      { calls: [] as CapturedCall[] },
    ) as BrainFetchLikeForBridge;
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: unreachable });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/brain/status`);
    expect(await res.json()).toEqual({ brain: 'mock' });
  });

  it('caches the probe within the TTL and re-probes after it expires', async () => {
    const ollama = fakeOllama();
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: ollama, brainStatusTtlMs: 40 });
    await fetch(`http://127.0.0.1:${h.port}/api/brain/status`);
    await fetch(`http://127.0.0.1:${h.port}/api/brain/status`);
    expect(callsOf(ollama)).toHaveLength(1); // second hit served from cache
    await new Promise((r) => setTimeout(r, 60)); // past the 40ms TTL
    await fetch(`http://127.0.0.1:${h.port}/api/brain/status`);
    expect(callsOf(ollama)).toHaveLength(2);
  });

  it('carries the CORS header like every bridge route (renderer is cross-origin)', async () => {
    const unreachable = Object.assign(
      (async () => {
        throw new Error('ECONNREFUSED');
      }) as BridgeFetchLike,
      { calls: [] as CapturedCall[] },
    ) as BrainFetchLikeForBridge;
    const h = await start({ settings: () => makeSettings(), env: {}, fetchImpl: unreachable });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/brain/status`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

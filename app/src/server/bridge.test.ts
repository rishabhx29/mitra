// Bridge HTTP surface — real express server on an ephemeral loopback port, real fetch.
// This is the automated equivalent of "curl the health endpoint non-interactively".
// Covers: health, session mock/proxy/degrade, ACL 403 at the HTTP edge, tool dispatch,
// unknown tool, malformed JSON.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { createMemoryMockNotion } from './mockNotion';
import { startBridge, type BridgeDeps, type BridgeHandle } from './bridge';
import type { FetchLike } from './tools/notion';

let handle: BridgeHandle | null = null;

type FetchCall = { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } };

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

describe('GET /api/health', () => {
  it('returns ok:true and mock:true when no Bolna keys are configured', async () => {
    const h = await start({ settings: () => DEFAULT_SETTINGS, env: {} });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'mitra-bridge', mock: true });
  });

  it('reports mock:false when Bolna keys are present', async () => {
    const h = await start({ settings: () => DEFAULT_SETTINGS, env: { BOLNA_API_KEY: 'k', BOLNA_AGENT_ID: 'a' } });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/health`);
    expect((await res.json())['mock']).toBe(false);
  });
});

describe('POST /api/session', () => {
  it('returns {mock:true} 200 when keys are absent — never throws', async () => {
    const h = await start({ settings: () => DEFAULT_SETTINGS, env: {} });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'hi' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mock: true });
  });

  it('proxies to Bolna with Bearer auth + agent_id when keys are present', async () => {
    const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = [];
    const session = {
      run_id: 'run-1',
      agent_id: 'a',
      sip_username: 'u',
      sip_password: 'p',
      sip_domain: 'd',
      wss_url: 'wss://x',
      sip_register: false,
      expires_in: 120,
      ice_servers: [],
    };
    const fetchImpl: FetchLike = Object.assign(
      (async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => session,
          text: async () => JSON.stringify(session),
        };
      }) as FetchLike,
      { calls },
    );
    const h = await start({
      settings: () => DEFAULT_SETTINGS,
      env: { BOLNA_API_KEY: 'bn-key', BOLNA_AGENT_ID: 'agent-42' },
      fetchImpl,
    });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'hi' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(session);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://api.bolna.ai/web-call/freeswitch-session');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.headers?.['Authorization']).toBe('Bearer bn-key');
    const body = JSON.parse(call.init?.body ?? '{}') as {
      agent_id: string;
      agent_data: { language: string };
      user_data: { language: string };
    };
    expect(body.agent_id).toBe('agent-42');
    expect(body.agent_data.language).toBe('hi');
    expect(body.user_data.language).toBe('hi');
  });

  it('degrades to {mock:true} when the upstream mint fails — never 5xx', async () => {
    const fetchImpl: FetchLike = Object.assign(
      (async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => 'overloaded',
      })) as FetchLike,
      { calls: [] as FetchCall[] },
    );
    const h = await start({
      settings: () => DEFAULT_SETTINGS,
      env: { BOLNA_API_KEY: 'k', BOLNA_AGENT_ID: 'a' },
      fetchImpl,
    });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'en' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mock: boolean; error: string };
    expect(body.mock).toBe(true);
    expect(body.error).toContain('503');
  });
});

describe('POST /api/tools/:name', () => {
  it('denied tool → HTTP 403 with { ok:false, summary:"Permission denied: <gate>" } and nothing executes', async () => {
    const executeTool = vi.fn(async (req: { id: string }) => ({ id: req.id, ok: true, summary: 'should never run' }));
    const h = await start({
      settings: () => makeSettings({ permissions: { notion: true, launcher: false, terminal: true, browser: true } }),
      executeTool: executeTool as unknown as BridgeDeps['executeTool'],
    });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/tools/launch_app`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 't1', args: { alias: 'notepad' } }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ id: 't1', ok: false, summary: 'Permission denied: launcher' });
    expect(executeTool).not.toHaveBeenCalled(); // never executed
  });

  it('allowed tool → 200 ToolResult via the default dispatcher (mock Notion board)', async () => {
    const board = createMemoryMockNotion();
    const h = await start({ settings: () => DEFAULT_SETTINGS, env: {}, mockNotion: board });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/tools/notion_add_todo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 't2', args: { text: 'milk' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; ok: boolean; summary: string };
    expect(body.id).toBe('t2');
    expect(body.ok).toBe(true);
    expect(body.summary).toBe('Added to Notion (mock board): "milk"');
    expect(await board.list()).toHaveLength(1);
  });

  it('generates an id when the body omits it', async () => {
    const captured: Array<{ id: string }> = [];
    const h = await start({
      settings: () => DEFAULT_SETTINGS,
      executeTool: async (req) => {
        captured.push({ id: req.id });
        return { id: req.id, ok: true, summary: 'ok' };
      },
    });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/tools/open_url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: { url: 'https://example.com' } }),
    });
    expect(res.status).toBe(200);
    expect((await res.json())['ok']).toBe(true);
    expect(captured[0]?.id).toBeTruthy();
  });

  it('unknown tool → 200 { ok:false, summary:"Unknown tool: …" }', async () => {
    const h = await start({ settings: () => DEFAULT_SETTINGS });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/tools/definitely_not_a_tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 't3', args: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; ok: boolean; summary: string };
    expect(body.id).toBe('t3');
    expect(body.ok).toBe(false);
    expect(body.summary).toBe('Unknown tool: definitely_not_a_tool');
  });

  it('malformed JSON body → 400 { ok:false, summary:"Invalid JSON body" }', async () => {
    const h = await start({ settings: () => DEFAULT_SETTINGS });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/tools/notion_add_todo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, summary: 'Invalid JSON body' });
  });

  // Activity log (ADDITIVE): one hook call per COMPLETED execution — allowed
  // runs report their ToolResult, ACL denials at the HTTP edge never execute
  // and therefore never report.
  it('onToolExecuted fires once per completed execution and never for a 403 denial', async () => {
    const executed: Array<{ tool: string; ok: boolean; summary: string }> = [];
    const h = await start({
      settings: () => makeSettings({ permissions: { notion: true, launcher: false, terminal: true, browser: true } }),
      executeTool: async (req) => ({ id: req.id, ok: true, summary: `ran ${req.tool}` }),
      onToolExecuted: (tool, result) => {
        executed.push({ tool, ok: result.ok, summary: result.summary });
      },
    });
    // Denied at the HTTP edge → nothing executes → no hook call.
    const denied = await fetch(`http://127.0.0.1:${h.port}/api/tools/launch_app`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'd1', args: {} }),
    });
    expect(denied.status).toBe(403);
    // Allowed → executes → exactly one hook call carrying the result.
    const allowed = await fetch(`http://127.0.0.1:${h.port}/api/tools/notion_add_todo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 't9', args: { text: 'milk' } }),
    });
    expect(allowed.status).toBe(200);
    expect(executed).toEqual([{ tool: 'notion_add_todo', ok: true, summary: 'ran notion_add_todo' }]);
  });

  it('onToolExecuted survives a throwing sink (tool still answers, never throws)', async () => {
    const h = await start({
      settings: () => DEFAULT_SETTINGS,
      executeTool: async (req) => ({ id: req.id, ok: true, summary: 'fine' }),
      onToolExecuted: () => {
        throw new Error('sink exploded');
      },
    });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/tools/notion_add_todo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 't10', args: { text: 'milk' } }),
    });
    expect(res.status).toBe(200);
    expect((await res.json())['summary']).toBe('fine');
  });
});

describe('GET /api/notion/items (Task E: settings board view)', () => {
  it('returns the persisted mock items, sharing the board with notion_add_todo', async () => {
    const board = createMemoryMockNotion();
    const h = await start({ settings: () => DEFAULT_SETTINGS, env: {}, mockNotion: board });
    await fetch(`http://127.0.0.1:${h.port}/api/tools/notion_add_todo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 't9', args: { text: 'milk' } }),
    });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/notion/items`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; items: Array<{ text: string; createdAt: string; id: string }> };
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.text).toBe('milk');
    expect(body.items[0]?.id).toBeTruthy();
    expect(typeof body.items[0]?.createdAt).toBe('string');
  });

  it('returns an empty list on a fresh board', async () => {
    const h = await start({ settings: () => DEFAULT_SETTINGS, env: {} });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/notion/items`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, items: [] });
  });

  it('degrades to { ok:false, items:[] } when the board read fails — never 5xx', async () => {
    const broken = {
      list: async () => {
        throw new Error('disk full');
      },
      add: async () => {
        throw new Error('disk full');
      },
    };
    const h = await start({ settings: () => DEFAULT_SETTINGS, env: {}, mockNotion: broken });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/notion/items`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; summary: string; items: unknown[] };
    expect(body.ok).toBe(false);
    expect(body.summary).toContain('disk full');
    expect(body.items).toEqual([]);
  });
});

// Task D: the @bolna/web-call SDK mints its own sessions by POSTing
// {"user_data": …} to sessionUrl — the session route must forward that shape
// verbatim and derive agent_data.language from user_data.language.
describe('POST /api/session — SDK-shaped body ({user_data})', () => {
  const session = {
    run_id: 'run-sdk',
    agent_id: 'a',
    sip_username: 'u',
    sip_password: 'p',
    sip_domain: 'd',
    wss_url: 'wss://x',
    sip_register: false,
    expires_in: 120,
    ice_servers: [],
  };

  function capturingFetch(): FetchLike {
    const calls: Array<{ url: string; init?: { body?: string } }> = [];
    const impl = Object.assign(
      (async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => session, text: async () => JSON.stringify(session) };
      }) as FetchLike,
      { calls },
    );
    return impl;
  }

  it('forwards user_data verbatim and passes user_data.language via agent_data', async () => {
    const fetchImpl = capturingFetch();
    const h = await start({
      settings: () => DEFAULT_SETTINGS,
      env: { BOLNA_API_KEY: 'bn-key', BOLNA_AGENT_ID: 'agent-42' },
      fetchImpl,
    });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_data: { language: 'hi', customer: 'mitra' } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(session);
    const call = (fetchImpl as unknown as { calls: Array<{ init?: { body?: string } }> }).calls[0]!;
    const body = JSON.parse(call.init?.body ?? '{}') as {
      agent_id: string;
      agent_data: { language: string };
      user_data: Record<string, unknown>;
    };
    expect(body.agent_id).toBe('agent-42');
    expect(body.agent_data.language).toBe('hi');
    expect(body.user_data).toEqual({ language: 'hi', customer: 'mitra' });
  });

  it('defaults agent_data.language to en when the SDK body has none', async () => {
    const fetchImpl = capturingFetch();
    const h = await start({
      settings: () => DEFAULT_SETTINGS,
      env: { BOLNA_API_KEY: 'bn-key', BOLNA_AGENT_ID: 'agent-42' },
      fetchImpl,
    });
    await fetch(`http://127.0.0.1:${h.port}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_data: {} }),
    });
    const call = (fetchImpl as unknown as { calls: Array<{ init?: { body?: string } }> }).calls[0]!;
    const body = JSON.parse(call.init?.body ?? '{}') as { agent_data: { language: string }; user_data: Record<string, unknown> };
    expect(body.agent_data.language).toBe('en');
    expect(body.user_data).toEqual({});
  });

  it('still returns {mock:true} for the SDK shape when keys are absent', async () => {
    const h = await start({ settings: () => DEFAULT_SETTINGS, env: {} });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_data: { language: 'hi' } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mock: true });
  });
});

describe('CORS (renderer pages are cross-origin to the loopback bridge)', () => {
  it('GET responses carry Access-Control-Allow-Origin:*', async () => {
    const h = await start({ settings: () => DEFAULT_SETTINGS, env: {} });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/notion/items`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('OPTIONS preflight → 204 with allow-origin/headers (JSON POSTs need it)', async () => {
    const h = await start({ settings: () => DEFAULT_SETTINGS, env: {} });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/tools/notion_add_todo`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'null',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
  });
});

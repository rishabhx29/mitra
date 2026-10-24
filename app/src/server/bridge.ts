// Local Bridge: the localhost HTTP server inside Electron main (plan: 127.0.0.1:8765).
//   GET  /api/health        → liveness + whether we're in mock mode
//   POST /api/session       → mints a Bolna Web Call session ({mock:true} with no keys)
//   POST /api/tools/:name   → ACL-gated tool execution returning a ToolResult
// fetch, env, clock, paths and all tool adapters are injectable so vitest is pure.
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'node:http';
import process from 'node:process';
import { DEFAULT_SETTINGS, type Settings, type ToolName, type ToolRequest, type ToolResult } from '../shared/types';
import { checkPermission } from './acl';
import { isKnownTool, createToolDispatcher } from './tools/index';
import { createMemoryMockNotion, type MockNotion } from './mockNotion';
import type { FetchLike } from './tools/notion';

export const DEFAULT_BRIDGE_HOST = '127.0.0.1';
export const DEFAULT_BRIDGE_PORT = 8765;
/**
 * Session-mint endpoint per plan + research/04 §"Session minting". Note: the
 * @bolna/web-call SDK's d.ts mentions "/web-call/freeswitch-session" — the URL is
 * injectable so a one-line change at the wiring site fixes it if Bolna renames it.
 */
export const DEFAULT_BOLNA_SESSION_URL = 'https://api.bolna.ai/web-call/freeswitch-session';

export interface BridgeDeps {
  /** Current settings; re-read per request so Settings-UI changes apply live. */
  settings?: () => Settings;
  /** Tool dispatcher override (defaults to createToolDispatcher with default adapters). */
  executeTool?: (req: ToolRequest) => Promise<ToolResult>;
  fetchImpl?: FetchLike;
  /** Env for Bolna keys + tools (defaults to process.env). Inject in tests. */
  env?: Record<string, string | undefined>;
  host?: string;
  port?: number;
  bolnaSessionUrl?: string;
  mockNotion?: MockNotion;
  /** Working directory for opencode runs. */
  cwd?: string;
  onProgress?: (tool: ToolName, msg: string) => void;
  log?: (msg: string) => void;
}

export interface BridgeHandle {
  server: Server;
  host: string;
  /** Actually-bound port (differs when deps.port is 0 / ephemeral). */
  port: number;
  close(): Promise<void>;
}

function hasErrorCode(err: unknown): err is { code?: unknown; type?: unknown } {
  return typeof err === 'object' && err !== null && ('code' in err || 'type' in err);
}

export function bolnaKeys(env: Record<string, string | undefined>): { apiKey: string; agentId: string } | null {
  const apiKey = env['BOLNA_API_KEY']?.trim();
  const agentId = env['BOLNA_AGENT_ID']?.trim();
  return apiKey && agentId ? { apiKey, agentId } : null;
}

export function createBridgeApp(deps: BridgeDeps): Express {
  const app = express();
  app.use(express.json());

  // CORS for the renderer: the settings/overlay pages run on file:// (prod) or a
  // dev-server origin, both cross-origin to http://127.0.0.1:8765, so Chromium
  // blocks every response without this header — and the JSON POSTs need an
  // OPTIONS preflight. The bridge binds loopback only, carries no credentials,
  // and mutations stay ACL-gated, so a permissive origin header is safe here.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const settings = deps.settings ?? (() => DEFAULT_SETTINGS);
  const env = deps.env ?? process.env;
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  // Shared board (Task E: GET /api/notion/items reads the same store the notion tool
  // writes). In-memory fallback when the host passes no board — hoisted so items
  // persist across requests within this process instead of resetting per dispatch.
  const mockNotion: MockNotion = deps.mockNotion ?? createMemoryMockNotion();
  const executeTool =
    deps.executeTool ??
    createToolDispatcher({
      settings,
      fetchImpl: deps.fetchImpl,
      env,
      mockNotion,
      cwd: deps.cwd,
      onProgress: deps.onProgress,
    });
  const log = deps.log ?? (() => {});

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'mitra-bridge', mock: bolnaKeys(env) === null });
  });

  // Task E (Settings UI): the mock to-do board read endpoint — returns the same
  // persisted items notion_add_todo writes. Never throws (mock-mode rule).
  app.get('/api/notion/items', async (_req: Request, res: Response) => {
    try {
      const items = await mockNotion.list();
      res.json({ ok: true, items });
    } catch (err) {
      res
        .status(200)
        .json({ ok: false, summary: `Board read failed: ${err instanceof Error ? err.message : String(err)}`, items: [] });
    }
  });

  app.post('/api/session', async (req: Request, res: Response) => {
    try {
      // Two caller shapes (Task D):
      //   {language}          — our own callers (createVoiceProvider probe, etc.)
      //   {user_data: {...}}  — the @bolna/web-call SDK shape (it POSTs this to
      //                         sessionUrl when it mints itself). With the SDK
      //                         shape the agent language comes from
      //                         user_data.language via agent_data and user_data
      //                         is forwarded verbatim.
      const body = (req.body ?? {}) as { language?: unknown; user_data?: Record<string, unknown> };
      const userData =
        body.user_data !== null &&
        typeof body.user_data === 'object' &&
        !Array.isArray(body.user_data)
          ? (body.user_data as Record<string, unknown>)
          : undefined;
      const language = (userData ? userData['language'] : body.language) === 'hi' ? 'hi' : 'en';
      const keys = bolnaKeys(env);
      if (!keys) {
        // Mock mode: zero keys must still yield a usable session — never throw (Review Focus #1).
        res.status(200).json({ mock: true, reason: 'BOLNA_API_KEY / BOLNA_AGENT_ID not configured' });
        return;
      }
      // Per-call language switch via agent_data.language (research/00 §product table).
      const upstreamBody = userData
        ? {
            agent_id: keys.agentId,
            agent_data: { language },
            user_data: { ...userData },
          }
        : {
            agent_id: keys.agentId,
            agent_data: { language },
            user_data: { language, ...(body.user_data ?? {}) },
          };
      try {
        const upstream = await fetchImpl(deps.bolnaSessionUrl ?? DEFAULT_BOLNA_SESSION_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${keys.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(upstreamBody),
        });
        const text = await upstream.text();
        if (!upstream.ok) {
          res
            .status(200)
            .json({ mock: true, error: `Bolna session mint failed (${upstream.status}): ${text.slice(0, 200)}` });
          return;
        }
        try {
          res.status(200).json(JSON.parse(text) as unknown);
        } catch {
          res.status(200).json({ mock: true, error: 'Bolna returned a non-JSON session payload' });
        }
      } catch (err) {
        res
          .status(200)
          .json({ mock: true, error: `Bolna session unreachable: ${err instanceof Error ? err.message : String(err)}` });
      }
    } catch (err) {
      res
        .status(500)
        .json({ ok: false, summary: `Bridge error: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  app.post('/api/tools/:name', async (req: Request, res: Response) => {
    try {
      const nameParam = req.params['name'];
      const name = Array.isArray(nameParam) ? (nameParam[0] ?? '') : (nameParam ?? '');
      const body = (req.body ?? {}) as Partial<ToolRequest>;
      const id = typeof body.id === 'string' && body.id ? body.id : crypto.randomUUID();
      const args =
        body.args !== null && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {};

      if (!isKnownTool(name)) {
        res.status(200).json({ id, ok: false, summary: `Unknown tool: ${name}` });
        return;
      }

      // ACL at the HTTP edge so denials surface as 403 and never reach execution;
      // the dispatcher re-checks internally (defense in depth).
      const decision = checkPermission(name, settings().permissions);
      if (!decision.allowed) {
        res.status(403).json({ id, ok: false, summary: decision.reason ?? 'Permission denied' });
        return;
      }

      const result = await executeTool({ id, tool: name, args });
      res.json(result);
    } catch (err) {
      res
        .status(500)
        .json({ id: '', ok: false, summary: `Bridge error: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // Malformed JSON bodies from express.json() land here; keep every response JSON.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const parseFailed =
      hasErrorCode(err) && (err.type === 'entity.parse.failed' || err.code === 'entity.parse.failed');
    const detail = parseFailed ? 'Invalid JSON body' : 'Bad request';
    res.status(400).json({ ok: false, summary: detail });
  });

  log('Mitra bridge app created');
  return app;
}

export async function startBridge(deps: BridgeDeps = {}): Promise<BridgeHandle> {
  const host = deps.host ?? DEFAULT_BRIDGE_HOST;
  const port = deps.port ?? DEFAULT_BRIDGE_PORT;
  const app = createBridgeApp(deps);
  const server: Server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on('error', reject);
  });
  const address = server.address();
  const boundPort = address !== null && typeof address === 'object' ? address.port : port;
  const close = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  (deps.log ?? (() => {}))(`Mitra bridge listening on http://${host}:${boundPort}`);
  return { server, host, port: boundPort, close };
}

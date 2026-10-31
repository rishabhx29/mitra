// Local Bridge: the localhost HTTP server inside Electron main (plan: 127.0.0.1:8765).
//   GET  /api/health        → liveness + whether we're in mock mode
//   POST /api/session       → mints a Bolna Web Call session ({mock:true} with no keys)
//   POST /api/tools/:name   → ACL-gated tool execution returning a ToolResult
//   GET  /api/brain/status  → Console status bar: {brain, model?} (cached probe)
//   POST /api/brain/chat    → Console conversation (Ollama tier-1, mock tier-2)
// fetch, env, clock, paths and all tool adapters are injectable so vitest is pure.
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'node:http';
import process from 'node:process';
import { DEFAULT_SETTINGS, type Settings, type ToolName, type ToolRequest, type ToolResult } from '../shared/types';
import { checkPermission } from './acl';
import { isKnownTool, createToolDispatcher, KNOWN_TOOLS } from './tools/index';
import { createMemoryMockNotion, type MockNotion } from './mockNotion';
import type { ModelStore } from './models';
import { createMemoryStore, type MemoryStore } from './memory';
import {
  chatWithBrain,
  mockConversationalReply,
  pickBrain,
  sanitizeChatMessages,
  type BrainStatus,
} from './brain';
import type { ReminderService } from './tools/reminder';
import type { OsLike, PowerMonitorLike } from './tools/status';
import type { FetchLike } from './tools/notion';
import {
  DEFAULT_LAYA_TIMEOUT_MS,
  DEFAULT_LAYA_URL,
  pickArgs,
  routeViaLaya,
  type LayaFetchLike,
  type RouteDecision,
} from './router';
import { bareSearchQuery, intentToTool, parseIntent } from '../voice/intents';

export const DEFAULT_BRIDGE_HOST = '127.0.0.1';
export const DEFAULT_BRIDGE_PORT = 8765;
/**
 * Console status bar: how long a /api/brain/status probe result stays fresh.
 * Longer than the detection timeout so the bar never hammers /api/tags.
 */
export const DEFAULT_BRAIN_STATUS_TTL_MS = 30_000;
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
  /** Offline STT model store (Vosk zips). Optional: model routes degrade when absent. */
  models?: ModelStore;
  /** Start-Menu dirs for the §2b general app index (main injects the real pair). */
  appIndexDirs?: string[];
  /** Shared reminder service (main injects the Electron-Notification notifier). */
  reminders?: ReminderService;
  /** Cerebro-lite memory store (main persists it to <userData>/mitra-memory.json). */
  memory?: MemoryStore;
  /** Electron powerMonitor probe for status_briefing. */
  power?: PowerMonitorLike;
  /** node:os probe for status_briefing (defaults to the real node:os downstream). */
  os?: OsLike;
  /** Working directory for opencode runs. */
  cwd?: string;
  /** How long GET /api/brain/status caches its pickBrain probe (tests shrink it). */
  brainStatusTtlMs?: number;
  /** Laya sidecar base URL (docs/DECISION_TIER_PLAN.md §1). Defaults to env LAYA_URL, then 127.0.0.1:8899. */
  layaUrl?: string;
  /** POST /api/brain/route Laya timeout — the bridge never blocks > 1.5s (plan §1). */
  routeTimeoutMs?: number;
  /** GET /api/brain/laya sidecar probe timeout (Voice-panel badge). */
  layaProbeTimeoutMs?: number;
  /** Absolute notes file for note_notepad (main injects <userData>/mitra-notes.txt). */
  notesPath?: string;
  onProgress?: (tool: ToolName, msg: string) => void;
  /**
   * ADDITIVE (Activity log): called once per COMPLETED tool execution with its
   * ToolResult — whatever the entry path (/api/tools/:name, brain-chat tools).
   * Main injects a sink that reports every run to the settings window's
   * Activity log from ONE place; the call site wraps the sink in try/catch so
   * a broken reporter can never break a tool.
   */
  onToolExecuted?: (tool: ToolName, result: ToolResult) => void;
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
  // Decision-tier fetch: same injected fetchImpl, widened with AbortSignal so
  // routeViaLaya / the laya probe can never hang the bridge (plan §1).
  const layaFetch: LayaFetchLike = fetchImpl;
  const layaUrl = (deps.layaUrl ?? (env['LAYA_URL']?.trim() || DEFAULT_LAYA_URL)).replace(/\/+$/, '');
  const routeTimeoutMs = deps.routeTimeoutMs ?? DEFAULT_LAYA_TIMEOUT_MS;
  const layaProbeTimeoutMs = deps.layaProbeTimeoutMs ?? 1000;
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
      reminders: deps.reminders,
      memory: deps.memory,
      power: deps.power,
      os: deps.os,
      cwd: deps.cwd,
      appIndexDirs: deps.appIndexDirs,
      notesPath: deps.notesPath,
      onProgress: deps.onProgress,
    });
  const log = deps.log ?? (() => {});

  /**
   * Unknown-app brain escalation ("open animejs"): the deterministic launch_app
   * matcher matches any "open X" shape but can only resolve INSTALLED apps —
   * for a website/product name it would dead-end with "Unknown app". The user's
   * intent is semantic, so escalate ONCE to the tool-calling brain, which knows
   * common sites (animejs → https://animejs.com) and can act via open_url /
   * web_search / app_task instead. One-shot: the brain's own tool call runs
   * through the raw dispatcher (no re-escalation → no loops). Brain offline →
   * the honest unknown-app failure stands.
   */
  const escalateUnknownApp = async (req: ToolRequest, fallback: ToolResult): Promise<ToolResult> => {
    const name = String(req.args['alias'] ?? req.args['name'] ?? '').trim();
    if (!name) return fallback;
    let acted: { ok: boolean; summary: string } | null = null;
    try {
      await chatWithBrain({
        messages: [{ role: 'user', content: `open ${name}` }],
        language: 'en',
        fetchImpl,
        preferredModel: settings().console?.model?.trim() || undefined,
        toolNames: KNOWN_TOOLS,
        executeTool: async (tool, args) => {
          const out = await executeTool({ id: `escalate-${Date.now()}`, tool: tool as ToolName, args });
          acted = { ok: out.ok, summary: out.summary };
          return { ok: out.ok, summary: out.summary };
        },
      });
    } catch {
      return fallback;
    }
    const outcome = acted as { ok: boolean; summary: string } | null;
    return outcome
      ? { id: req.id, ok: outcome.ok, summary: outcome.summary, data: { escalated: true } }
      : fallback;
  };

  // Every completed execution flows through this wrapper (the /api/tools route
  // AND the brain-chat executeTool callback both call it), so one optional hook
  // sees every bridge tool run — voice, Console and brain-initiated alike.
  // Never throws, never alters the result.
  const executeToolWithHook = async (req: ToolRequest, allowEscalation = true): Promise<ToolResult> => {
    let result = await executeTool(req);
    if (
      allowEscalation &&
      !result.ok &&
      (req.tool === 'launch_app' || req.tool === 'open_any_app') &&
      (/^Unknown app /i.test(result.summary) || /could not find an app called/i.test(result.summary))
    ) {
      result = await escalateUnknownApp(req, result);
    }
    if (deps.onToolExecuted) {
      try {
        deps.onToolExecuted(req.tool, result);
      } catch (err) {
        log(`onToolExecuted sink failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return result;
  };

  // ---- Console brain routes (docs/CONSOLE_PLAN.md "Architecture deltas" item 2) ----
  // The brain rides the SAME injected fetchImpl as the session mint / tools, so
  // tests fake Ollama without any network. The main process is the proxy: the
  // renderer never talks to Ollama directly, so there are no CORS issues with
  // the local model server. Both routes never throw — any failure degrades to
  // the deterministic mock conversational reply (mock-mode rule).
  const brainStatusTtlMs = deps.brainStatusTtlMs ?? DEFAULT_BRAIN_STATUS_TTL_MS;
  let brainStatusCache: { at: number; status: BrainStatus } | null = null;

  // ---- offline STT models (LocalVoiceProvider; shared/voiceLanguages.ts) ----
  app.get('/api/models/status', (_req: Request, res: Response) => {
    res.json({ models: deps.models ? deps.models.statusAll() : [] });
  });

  app.get('/api/models/status/:lang', (req: Request, res: Response) => {
    if (!deps.models) {
      res.status(503).json({ lang: req.params.lang, state: 'error', bytes: 0, approxMb: 0 });
      return;
    }
    res.json(deps.models.status(String(req.params.lang)));
  });

  app.post('/api/models/download', async (req: Request, res: Response) => {
    const lang = typeof (req.body as { lang?: unknown })?.lang === 'string' ? (req.body as { lang: string }).lang : '';
    if (!deps.models || !lang) {
      res.status(400).json({ ok: false, error: 'bad-request' });
      return;
    }
    // Awaits the idempotent download so success needs no polling; ~40MB
    // local-network fetches finish well inside default fetch timeouts.
    const status = await deps.models.ensure(lang);
    res.json(status);
  });

  app.get('/api/models/file/:lang', (req: Request, res: Response) => {
    const bytes = deps.models?.read(String(req.params.lang));
    if (!bytes) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', bytes.byteLength);
    res.end(bytes);
  });

  // Console status bar: {brain:'ollama', model} or {brain:'mock'}. Cheap: one
  // cached probe per TTL window instead of one /api/tags per render tick.
  app.get('/api/brain/status', async (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      if (!brainStatusCache || now - brainStatusCache.at >= brainStatusTtlMs) {
        const status = await pickBrain({ fetchImpl });
        brainStatusCache = { at: now, status };
      }
      const status = brainStatusCache.status;
      res.json(status.brain === 'ollama' ? { brain: 'ollama', model: status.model } : { brain: 'mock' });
    } catch (err) {
      // pickBrain never throws, but a broken cache read must still answer.
      log(`brain status probe failed: ${err instanceof Error ? err.message : String(err)}`);
      res.json({ brain: 'mock' });
    }
  });

  // Console conversation: {messages:[{role,content}], language:'en'|'hi'} →
  // {brain:'ollama'|'mock', model?, text}. Ollama tier-1 (or the pinned
  // settings.console.model), deterministic mock tier-2 — never 5xx.
  app.post('/api/brain/chat', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { messages?: unknown; language?: unknown };
    const language = body.language === 'hi' ? 'hi' : 'en';
    try {
      const messages = sanitizeChatMessages(body.messages);
      const result = await chatWithBrain({
        messages,
        language,
        fetchImpl,
        preferredModel: settings().console?.model?.trim() || undefined,
        executeTool: async (tool, args) => {
        const out = await executeToolWithHook({ id: `brain-${Date.now()}`, tool: tool as ToolName, args });
        return { ok: out.ok, summary: out.summary };
      },
      toolNames: KNOWN_TOOLS,
    });
      res.json(result);
    } catch (err) {
      // chatWithBrain never throws; this is defense in depth for the route edge.
      log(`brain chat failed: ${err instanceof Error ? err.message : String(err)}`);
      res.json({ brain: 'mock', text: mockConversationalReply(sanitizeChatMessages(body.messages), language) });
    }
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'mitra-bridge', mock: bolnaKeys(env) === null });
  });

  // Media-word heuristic for bare-search routing: "search avengers doomsday
  // trailer" reads as YouTube; "search rust vs go" reads as the web.
  const MEDIA_SEARCH_RE =
    /\b(trailer|teaser|song|music|video|movie|film|episode|scene|lyrics|playlist|cover|remix|official)\b/i;

  // ---- fast decision tier (docs/DECISION_TIER_PLAN.md §1) ----
  // POST /api/brain/route {text} → {tool?, args?, confidence, via}:
  //   tier 1  deterministic parseIntent (instant, args via intentToTool) → via:'deterministic'
  //   tier 2  the OPTIONAL laya-serve sidecar names the tool (~50ms; absent /
  //           404 / timeout / garbage → via:'none') and pickArgs parameterizes
  //           it; no args extractable → via:'none' (Laya routes, regexes
  //           parameterize — fall through to chat).
  // Never throws: every failure degrades to {confidence:0, via:'none'}.
  app.post('/api/brain/route', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { text?: unknown };
    const text = typeof body.text === 'string' ? body.text : '';
    const fail: RouteDecision = { confidence: 0, via: 'none' };
    if (!text.trim()) {
      res.json(fail);
      return;
    }
    try {
      const intent = parseIntent(text, settings().workspaceModes ?? []);
      const mapped = intent ? intentToTool(intent) : null;
      if (mapped) {
        res.json({ tool: mapped.tool, args: mapped.args, confidence: 1, via: 'deterministic' });
        return;
      }
      // Bare "search X" is pickArgs-only while Laya is UP (it decides youtube
      // vs web), but when the sidecar is down — or it names a tool whose args
      // no regex can extract — a bare search must still DO something. Media
      // words (trailer/song/movie…) read as YouTube intent; everything else
      // is a plain web search.
      const bareToolFor = (t: string): ToolName =>
        MEDIA_SEARCH_RE.test(t) ? 'youtube_search' : 'web_search';
      const decision = await routeViaLaya(text, { fetchImpl: layaFetch, layaUrl, timeoutMs: routeTimeoutMs });
      if (!decision.tool) {
        const bare = bareSearchQuery(text);
        if (bare) {
          res.json({ tool: bareToolFor(text), args: { query: bare }, confidence: 0.6, via: 'deterministic' });
          return;
        }
        res.json({ confidence: decision.confidence, via: 'none' });
        return;
      }
      const args = pickArgs(decision.tool, text);
      if (!args) {
        // Laya named an args-requiring tool but no regex extracted args (e.g.
        // it picks web_search for bare "search X", whose arg shape is
        // intentionally not a deterministic intent). Fall back to the bare
        // query before giving the utterance up to chat.
        const bare = bareSearchQuery(text);
        if (bare) {
          res.json({
            tool: bareToolFor(text),
            args: { query: bare },
            confidence: decision.confidence,
            via: 'deterministic',
          });
          return;
        }
        res.json({ confidence: decision.confidence, via: 'none' });
        return;
      }
      res.json({ tool: decision.tool, args, confidence: decision.confidence, via: 'laya' });
    } catch (err) {
      // routeViaLaya/parseIntent never throw — defense in depth for the route edge.
      log(`brain route failed: ${err instanceof Error ? err.message : String(err)}`);
      res.json(fail);
    }
  });

  // Voice-panel badge probe: is the optional Laya sidecar reachable? Any HTTP
  // response (even a 404 on /) proves something is listening; 1s cap so the
  // panel never hangs on it. Never throws.
  app.get('/api/brain/laya', async (_req: Request, res: Response) => {
    try {
      await layaFetch(`${layaUrl}/`, { signal: AbortSignal.timeout(layaProbeTimeoutMs) });
      res.json({ available: true });
    } catch {
      res.json({ available: false });
    }
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

      const result = await executeToolWithHook({ id, tool: name, args });
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

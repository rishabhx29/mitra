// Tool dispatcher: routes a ToolRequest to its handler AFTER the ACL gate.
// Denied requests NEVER execute (plan Review Focus #2); handler failures degrade to
// ok:false ToolResults instead of throwing. All I/O adapters are injectable.
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import type { Permissions, Settings, ToolName, ToolRequest, ToolResult } from '../../shared/types';
import { checkPermission } from '../acl';
import { createMemoryMockNotion, type MockNotion } from '../mockNotion';
import { createMemoryStore, type MemoryStore } from '../memory';
import { createNotionAddTodoTool, type FetchLike } from './notion';
import { createLaunchAppTool, type ExecLike } from './launcher';
import { createOpencodeTool, type OpencodeLookup, type OpencodeSpawnRunner } from './opencode';
import { createOpenUrlTool, type UrlOpener } from './url';
import { createWorkspaceModeTool } from './workspace';
import { createSetReminderTool, createListRemindersTool, createReminderService, type ReminderService } from './reminder';
import { createLockWorkstationTool } from './lock';
import { createMemoryTool } from './memory';
import { createStatusBriefingTool, type OsLike, type PowerMonitorLike } from './status';

export type ToolOutcome = { ok: boolean; summary: string; data?: unknown };
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolOutcome>;

export const KNOWN_TOOLS: readonly ToolName[] = [
  'notion_add_todo',
  'launch_app',
  'run_opencode_task',
  'open_url',
  'workspace_mode',
  'set_reminder',
  'list_reminders',
  'lock_workstation',
  'memory',
  'status_briefing',
];

export function isKnownTool(name: string): name is ToolName {
  return (KNOWN_TOOLS as readonly string[]).includes(name);
}

export interface ToolDispatcherDeps {
  /** Re-read per dispatch so Settings-UI permission flips apply without a restart. */
  settings: () => Settings;
  /** Backing store for notion_add_todo's mock path AND the status item count.
   *  In-memory when omitted (hoisted once per dispatcher, shared across dispatches). */
  mockNotion?: MockNotion;
  fetchImpl?: FetchLike;
  exec?: ExecLike;
  opener?: UrlOpener;
  opencodeLookup?: OpencodeLookup;
  opencodeSpawn?: OpencodeSpawnRunner;
  /** Injectable clock tick (opencode simulation pacing). Defaults to setTimeout. */
  delay?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
  /** Working directory handed to opencode runs. */
  cwd?: string;
  platform?: string;
  /** Streaming progress (opencode simulation/spawn) with the tool name attached. */
  onProgress?: (tool: ToolName, msg: string) => void;
  idFactory?: () => string;
  /** Shared reminder state + notifier (docs/ULTRON_PORT.md rows 2-3). */
  reminders?: ReminderService;
  /** Shared Cerebro-lite memory store (row 5); in-memory when omitted. */
  memory?: MemoryStore;
  /** Electron powerMonitor-shaped probe for status_briefing (row 6). */
  power?: PowerMonitorLike;
  /** node:os-shaped probe for status_briefing; defaults to the real node:os. */
  os?: OsLike;
}

/** Default notifier when the host injects none: honest console line, never a crash. */
function defaultReminderNotify(note: { title: string; body: string }): void {
  console.log(`[mitra] ${note.title} — reminder: ${note.body}`);
}

/** State shared across dispatches of one dispatcher (hoisted once, not per request). */
interface SharedToolState {
  mockNotion: MockNotion;
  reminders: ReminderService;
  memory: MemoryStore;
}

function buildHandler(
  tool: ToolName,
  deps: ToolDispatcherDeps,
  env: Record<string, string | undefined>,
  platform: string,
  shared: SharedToolState,
): ToolHandler {
  switch (tool) {
    case 'notion_add_todo':
      return createNotionAddTodoTool({
        notion: deps.settings().notion,
        mock: shared.mockNotion,
        fetchImpl: deps.fetchImpl,
      });
    case 'launch_app':
      return createLaunchAppTool({ apps: deps.settings().apps, exec: deps.exec });
    case 'run_opencode_task':
      return createOpencodeTool({
        lookup: deps.opencodeLookup,
        spawn: deps.opencodeSpawn,
        exec: deps.exec,
        env,
        cwd: deps.cwd,
        platform,
        delay: deps.delay,
        progress: deps.onProgress ? (msg) => deps.onProgress!('run_opencode_task', msg) : undefined,
      });
    case 'open_url':
      return createOpenUrlTool({ opener: deps.opener, platform, exec: deps.exec });
    case 'workspace_mode':
      return createWorkspaceModeTool({
        modes: deps.settings().workspaceModes ?? [],
        apps: deps.settings().apps,
        exec: deps.exec,
        opener: deps.opener,
        platform,
      });
    case 'set_reminder':
      return createSetReminderTool({ reminders: shared.reminders });
    case 'list_reminders':
      return createListRemindersTool({ reminders: shared.reminders });
    case 'lock_workstation':
      return createLockWorkstationTool({ exec: deps.exec, platform });
    case 'memory':
      return createMemoryTool({ memory: shared.memory });
    case 'status_briefing':
      return createStatusBriefingTool({
        power: deps.power,
        os: deps.os,
        env,
        memoryCount: async () => (await shared.memory.list()).length,
        notionItemCount: async () => (await shared.mockNotion.list()).length,
      });
  }
}

export function createToolDispatcher(
  deps: ToolDispatcherDeps,
): (req: ToolRequest) => Promise<ToolResult> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const idFactory = deps.idFactory ?? randomUUID;
  // Hoisted ONCE per dispatcher so tool state (mock board, pending reminders,
  // memory notes) persists across dispatches even when the host injects nothing.
  const shared: SharedToolState = {
    mockNotion: deps.mockNotion ?? createMemoryMockNotion(),
    reminders: deps.reminders ?? createReminderService({ notify: defaultReminderNotify }),
    memory: deps.memory ?? createMemoryStore(),
  };

  return async (req) => {
    const id = typeof req?.id === 'string' && req.id ? req.id : idFactory();
    const fail = (summary: string, data?: unknown): ToolResult => ({ id, ok: false, summary, data });

    const tool = req?.tool;
    if (!tool || !isKnownTool(tool)) {
      return fail(`Unknown tool: ${String(tool)}`);
    }

    // ACL gate — a denied tool's handler is never constructed, never invoked.
    const permissions: Permissions = deps.settings().permissions;
    const decision = checkPermission(tool, permissions);
    if (!decision.allowed) {
      return fail(decision.reason ?? 'Permission denied');
    }

    const handler = buildHandler(tool, deps, env, platform, shared);
    try {
      const outcome = await handler(req?.args ?? {});
      return { id, ok: outcome.ok, summary: outcome.summary, data: outcome.data };
    } catch (err) {
      return fail(`Tool ${tool} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

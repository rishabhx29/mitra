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
import { createAppTaskTool } from './appTask';
import { createOpencodeTool, type OpencodeLookup, type OpencodeSpawnRunner } from './opencode';
import { createOpenUrlTool, type UrlOpener } from './url';
import { createWorkspaceModeTool } from './workspace';
import { createSetReminderTool, createListRemindersTool, createReminderService, type ReminderService } from './reminder';
import { createLockWorkstationTool } from './lock';
import { createMemoryTool } from './memory';
import { createStatusBriefingTool, type OsLike, type PowerMonitorLike } from './status';
import { createNoteNotepadTool } from './notepad';
import { openAnyApp, closeApp, webSearch } from './genericApps';
import { createNewsTool } from './news';
import { buildAppIndex, matchApp, type AppEntry, type AppIndex } from './appIndex';
import { createYoutubeSearchTool } from './youtube';
import { createAgendaTodayTool } from './agenda';
import type { MockNotionFileAdapter } from '../mockNotion';

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
  // Real-world task tools (docs/DECISION_TIER_PLAN.md §2).
  'note_notepad',
  'youtube_search',
  'agenda_today',
  // Composite: open an app AND type content into it (voice intents.ts app_task).
  'app_task',
  // Generic app control + web search (§2b) — the brain advertises these too,
  // so "search X" / "close chrome" from the LLM tier actually route.
  'open_any_app',
  'close_app',
  'web_search',
  // Friday port (docs/FRIDAY_PORT.md): spoken news briefs.
  'get_world_news',
  'get_finance_news',
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
  /** Start-Menu dirs for the general app index (§2b); main injects the real pair. */
  appIndexDirs?: string[];
  /** Injectable fs for the index scan (tests); defaults to node fs wrappers. */
  appFs?: import('./appIndex').FsLike;
  /** Absolute notes-file path for note_notepad (main injects <userData>/mitra-notes.txt). */
  notesPath?: string;
  /** File adapter for note_notepad; defaults to the real filesystem. */
  notesFs?: MockNotionFileAdapter;
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
  /** §2b Start-Menu app index (lazy, once per dispatcher; refreshed on a miss). */
  appIndex?: AppIndex;
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
      return createLaunchAppTool({ apps: deps.settings().apps, exec: deps.exec, appIndexDirs: deps.appIndexDirs, appFs: deps.appFs });
    case 'app_task':
      // Same resolution deps as launch_app (alias → Start-Menu index → shell);
      // the tool then types the content (win32 clipboard + SendKeys).
      return createAppTaskTool({
        apps: deps.settings().apps,
        exec: deps.exec,
        appIndexDirs: deps.appIndexDirs,
        appFs: deps.appFs,
        platform,
        delay: deps.delay,
      });
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
    // Real-world task tools (docs/DECISION_TIER_PLAN.md §2). Each degrades
    // gracefully: notepad refuses honestly without a notesPath; youtube uses
    // the shared opener; agenda reads the shared mock board.
    case 'note_notepad':
      return createNoteNotepadTool({
        notesPath: deps.notesPath ?? '',
        fs: deps.notesFs,
        exec: deps.exec,
        platform,
      });
    case 'youtube_search':
      return createYoutubeSearchTool({ opener: deps.opener, platform, exec: deps.exec });
    case 'agenda_today':
      return createAgendaTodayTool({ board: shared.mockNotion, exec: deps.exec, platform });
    case 'open_any_app':
    case 'close_app':
      return (args) => {
        // §2b: Start-Menu index built lazily once per dispatcher (a fast shallow
        // walk); refreshed whenever a lookup misses entirely.
        if (!shared.appIndex) {
          shared.appIndex = buildAppIndex(deps.appIndexDirs ?? [], deps.appFs);
        }
        const name = String(args?.name ?? '');
        let index = shared.appIndex;
        if (matchApp(index, name).length === 0) {
          shared.appIndex = buildAppIndex(deps.appIndexDirs ?? [], deps.appFs);
          index = shared.appIndex;
        }
        const execLike = deps.exec ?? (async () => ({ code: 0, stdout: '', stderr: '' }));
        const appDeps = { index, exec: execLike, aliasNames: deps.settings().apps.map((a) => a.name) };
        return tool === 'open_any_app' ? openAnyApp(name, appDeps) : closeApp(name, appDeps);
      };
    case 'web_search':
      return async (args) =>
        webSearch(String(args?.query ?? ''), async (url) => {
          if (deps.opener) {
            await deps.opener(url);
          } else if (deps.exec) {
            await deps.exec(`start "" "${url}"`);
          }
        });
    // Friday port (docs/FRIDAY_PORT.md): spoken news briefs + monitor follow-through.
    case 'get_world_news':
      return createNewsTool('world', { exec: deps.exec, platform });
    case 'get_finance_news':
      return createNewsTool('finance', { exec: deps.exec, platform });
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

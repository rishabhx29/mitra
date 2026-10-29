// Shared contracts for all modules (PERSONA / SHELL / BRIDGE / VOICE / SETTINGS).
// FROZEN at Phase 0 — see docs/superpowers/plans/2026-10-24-mitra-mvp.md. Change only via the orchestrator.

export type PersonaKind = 'orb' | 'avatar';

export type SessionState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export type ToolName =
  | 'notion_add_todo'
  | 'launch_app'
  | 'run_opencode_task'
  | 'open_url'
  | 'workspace_mode'
  | 'set_reminder'
  | 'list_reminders'
  | 'lock_workstation'
  | 'memory'
  | 'status_briefing'
  // Real-world task tools (docs/DECISION_TIER_PLAN.md §2). Each degrades
  // gracefully when its service is absent (mock mode is first-class).
  | 'note_notepad'
  | 'youtube_search'
  | 'agenda_today'
  // General app control (docs/DECISION_TIER_PLAN.md §2b): ANY installed app + web search.
  | 'open_any_app'
  | 'close_app'
  | 'web_search'
  // Composite app task: open an app AND write/type specific content into it
  // ("open notepad and write hello") — launch + clipboard paste (win32).
  | 'app_task';

export interface ToolRequest {
  id: string;
  tool: ToolName;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  ok: boolean;
  summary: string;
  data?: unknown;
}

export interface Permissions {
  notion: boolean;
  launcher: boolean;
  terminal: boolean;
  browser: boolean;
}

export interface AppAlias {
  name: string;
  command: string;
}

/**
 * A named bundle of apps + URLs the agent can launch in one go (Ultron port
 * ledger row 1: workspace modes). `apps` entries are alias names resolved
 * against Settings.apps (same launcher aliases); `urls` open in the browser.
 * Aliases are our own en+Hinglish phrasing — clean-room, nothing copied.
 */
export interface WorkspaceMode {
  id: string;
  name: string;
  aliases: string[];
  apps: string[];
  urls: string[];
}

/**
 * `data` payload of a successful workspace_mode run (Ultron port row 1, shape
 * frozen by src/server/tools/workspace.ts): what the bundle launched, what it
 * opened, and what it skipped (with reasons) — consumed by ModesPanel "Run now".
 */
export interface WorkspaceModeRunData {
  mode: string;
  launched: string[];
  opened: string[];
  skipped?: Array<{ name: string; reason: string }>;
}

/** One Cerebro-lite memory entry (Ultron port row 5, shape frozen by src/server/memory.ts). */
export interface MemoryEntry {
  id: string;
  text: string;
  /** Epoch ms when the note was stored. */
  ts: number;
}

/**
 * Args for the `memory` tool (Ultron port row 5): remember stores a fact;
 * recall scores entries against a query (the query is REQUIRED — the tool
 * rejects a bare recall; "recall everything" is the `list` action); forget
 * deletes one entry by id. `forget` extends the landed remember/recall/list so
 * the Memory panel can offer delete without a second tool.
 */
export type MemoryToolArgs =
  | { action: 'remember'; text: string }
  | { action: 'recall'; text: string }
  | { action: 'list' }
  | { action: 'forget'; id: string };

export type NotionConfig = { mock: true } | { mock: false; token: string; databaseId: string };

export interface Settings {
  persona: PersonaKind;
  orbColors: { a: string; b: string };
  hotkey: string;
  language: 'en' | 'hi';
  permissions: Permissions;
  apps: AppAlias[];
  notion: NotionConfig;
  /**
   * Absolute path of the user's avatar model, copied by main into
   * <userData>/avatars/current.vrm (mitra:set-avatar-file). Optional so existing
   * persisted settings and DEFAULT_SETTINGS stay valid; absent/'' = no avatar.
   */
  avatarVrmPath?: string;
  /**
   * Workspace-mode presets (docs/ULTRON_PORT.md row 1). Optional so existing
   * persisted settings stay valid; when absent the store degrades to
   * DEFAULT_SETTINGS.workspaceModes on load.
   */
  workspaceModes?: WorkspaceMode[];
  /**
   * Console chat settings (docs/CONSOLE_PLAN.md "Architecture deltas" item 1).
   * Optional so existing persisted settings and DEFAULT_SETTINGS stay valid.
   * `model` pins the local Ollama brain used by /api/brain/chat (the bridge's
   * chatWithBrain prefers it over the auto-pick); absent/'' = auto-pick.
   */
  console?: { model?: string };
  /** Offline STT language id (shared/voiceLanguages.ts); default en-us. */
  voiceLanguage?: string;
}

export interface TranscriptEntry {
  role: 'user' | 'agent' | 'system';
  text: string;
  ts: number;
}

/** Voice brain abstraction. BolnaProvider (real) / MockProvider (offline). Implemented in Phase 2. */
export interface VoiceProvider {
  start(opts: { language: 'en' | 'hi' }): Promise<void>;
  stop(): Promise<void>;
  onState(cb: (s: SessionState) => void): void;
  onTranscript(cb: (t: TranscriptEntry) => void): void;
  /** Attach an audio source so persona can react (AnalyserNode fed by implementer or UI). */
  attachAudio(el: HTMLAudioElement | MediaStream): void;
}

export const DEFAULT_SETTINGS: Settings = {
  persona: 'orb',
  // Ember-family defaults so the persona matches the UI theme out of the box.
  orbColors: { a: '#ff5a2b', b: '#ff8a3d' },
  hotkey: 'Ctrl+Shift+Space',
  language: 'en',
  // terminal defaults ON: run_opencode_task is the flagship flow — a fresh
  // install must not answer it with "Permission denied: terminal".
  permissions: { notion: true, launcher: true, terminal: true, browser: true },
  apps: [
    { name: 'notepad', command: 'notepad' },
    { name: 'terminal', command: 'wt' },
    { name: 'browser', command: 'start https://www.google.com' },
  ],
  notion: { mock: true },
  // Ultron port row 1: four workspace presets. Apps reference the shipped
  // launcher aliases only (notepad/terminal/browser — extended alias lists
  // degrade gracefully to a "skipped" line via the workspace_mode tool);
  // alias phrasing is original en+Hinglish+Devanagari, not copied from any source.
  workspaceModes: [
    {
      id: 'coding',
      name: 'Coding',
      aliases: [
        'coding',
        'coding mode',
        'work mode',
        'dev mode',
        'code karna hai',
        'coding karna hai',
        'kaam karna hai',
        'kaam pe lag jao',
        "let's code",
        'code karne ka man hai',
        'coding ka man hai',
        'कोडिंग',
      ],
      apps: ['terminal'],
      urls: ['https://github.com'],
    },
    {
      id: 'gaming',
      name: 'Gaming',
      aliases: [
        'gaming',
        'gaming mode',
        'game time',
        'game on',
        'game khelna hai',
        'game khelein',
        'khelne ka man hai',
        'gaming mode on karo',
        'gaming karenge',
        'lets game',
        'esports mode',
        'play mode',
        'गेमिंग',
      ],
      apps: [],
      urls: ['https://store.steampowered.com'],
    },
    {
      id: 'study',
      name: 'Study',
      aliases: [
        'study',
        'study mode',
        'focus mode',
        'study time',
        'deep work',
        'padhai',
        'padhai karni hai',
        'padhai ka man hai',
        'padhai karenge',
        'padhai mode',
        'study karna hai',
        'focus karna hai',
        'पढ़ाई',
      ],
      apps: ['notepad', 'browser'],
      urls: ['https://www.wikipedia.org'],
    },
    {
      id: 'chill',
      name: 'Chill',
      aliases: [
        'chill',
        'chill mode',
        'relax',
        'movie',
        'movie time',
        'movie dekhni hai',
        'movie dekhna hai',
        'chill karna hai',
        'aaram karna hai',
        'entertainment mode',
        'chill time',
        'bore ho raha hun',
        'break le lo',
        'मूवी',
      ],
      apps: [],
      urls: ['https://www.youtube.com'],
    },
  ],
};

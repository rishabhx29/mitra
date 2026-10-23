// Shared contracts for all modules (PERSONA / SHELL / BRIDGE / VOICE / SETTINGS).
// FROZEN at Phase 0 — see docs/superpowers/plans/2026-10-24-mitra-mvp.md. Change only via the orchestrator.

export type PersonaKind = 'orb' | 'avatar';

export type SessionState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export type ToolName = 'notion_add_todo' | 'launch_app' | 'run_opencode_task' | 'open_url';

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

export type NotionConfig = { mock: true } | { mock: false; token: string; databaseId: string };

export interface Settings {
  persona: PersonaKind;
  orbColors: { a: string; b: string };
  hotkey: string;
  language: 'en' | 'hi';
  permissions: Permissions;
  apps: AppAlias[];
  notion: NotionConfig;
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
  orbColors: { a: '#4f8cff', b: '#b26bff' },
  hotkey: 'Alt+Space',
  language: 'en',
  permissions: { notion: true, launcher: true, terminal: false, browser: true },
  apps: [
    { name: 'notepad', command: 'notepad' },
    { name: 'terminal', command: 'wt' },
    { name: 'browser', command: 'start https://www.google.com' },
  ],
  notion: { mock: true },
};

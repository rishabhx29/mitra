// Voice-module contracts layered on the FROZEN VoiceProvider interface
// (src/shared/types.ts — the lifecycle semantics live there and are not
// redefined here). Task D: docs/superpowers/plans/2026-10-24-mitra-mvp.md.
//
// NOTE: DEFAULT_BRIDGE_BASE is duplicated from src/server/bridge.ts on purpose —
// importing bridge.ts here would pull express + node:http into the renderer
// bundle. Keep the two values in sync (both pinned by the plan: 127.0.0.1:8765).

/** Local Bridge base URL (plan Global Constraints; mirror of bridge.ts constant). */
export const DEFAULT_BRIDGE_BASE = 'http://127.0.0.1:8765';

/** What the mock brain understood from one utterance (parsed by parseIntent). */
export type MockIntent =
  | { kind: 'add_todo'; text: string }
  | { kind: 'launch_app'; alias: string }
  | { kind: 'opencode_task'; prompt: string }
  | { kind: 'open_url'; url: string }
  /** Ultron port row 1: launch a workspace bundle by its mode name. */
  | { kind: 'workspace_mode'; mode: string }
  /** Ultron port rows 2–3: minutes from now, optional message. */
  | { kind: 'set_reminder'; minutes: number; text: string }
  /** Ultron port row 4: lock the workstation (Windows LockWorkStation). */
  | { kind: 'lock_workstation' }
  /** Ultron port row 6: battery/uptime/provider briefing. */
  | { kind: 'status_briefing' }
  /** Ultron port row 5: Cerebro-lite memory. */
  | { kind: 'memory_remember'; text: string }
  | { kind: 'memory_recall_all' }
  | { kind: 'memory_recall'; query: string }
  // Real-world task tools (docs/DECISION_TIER_PLAN.md §2).
  /** Append a timestamped line to <userData>/mitra-notes.txt (+ open Notepad on win32). */
  | { kind: 'note_notepad'; text: string }
  /** Open youtube.com/results?search_query=<query> via the browser opener. */
  | { kind: 'youtube_search'; query: string }
  /** Read the to-do board and speak the count + items (also best-effort opens the OS calendar). */
  | { kind: 'agenda_today' }
  // General app control (docs/DECISION_TIER_PLAN.md §2b): ANY installed app + web search.
  | { kind: 'open_any_app'; name: string }
  | { kind: 'close_app'; name: string }
  | { kind: 'web_search'; query: string }
  // Composite task: open an app AND put content into it ("open notepad and write hello").
  | { kind: 'app_task'; app: string; content: string }
  // Identity question ("who are you?") — answered conversationally, no tool.
  | { kind: 'identity' }
  | { kind: 'world_news' }
  | { kind: 'finance_news' }
  | { kind: 'stop' }
  | { kind: 'language_switch'; language: 'en' | 'hi' };

/** Extras MockProvider adds beyond the frozen VoiceProvider interface. */
export interface MockVoiceProviderExtras {
  /**
   * Dev/e2e affordance: feed typed text through the exact same intent path as
   * speech (no microphone needed). Used by the overlay's ?dev=1 input.
   */
  submitText(text: string): Promise<void>;
  /**
   * Synthetic 0..1 speech envelope (~60fps while speaking; 0 otherwise) so the
   * orb/avatar animate without real TTS audio in mock mode.
   */
  readonly syntheticAmplitude: { current: number };
}

/** Extras BolnaProvider adds beyond the frozen VoiceProvider interface. */
export interface BolnaVoiceProviderExtras {
  /**
   * Remote (agent) audio level 0..1 from the SDK's 'volume-level' event
   * (~10 updates/sec). Fallback amplitude when no audio element was attached
   * via attachAudio (the element path gives the UI analyser 60fps instead).
   */
  readonly agentAmplitude: { current: number };
}

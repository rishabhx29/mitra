// Voice module entry: the createVoiceProvider factory (plan Task D).
// "Bolna when the bridge /api/session returns a real session, MockProvider
// otherwise (and after any {mock:true})" — the probe result decides once per
// provider creation; runtime Bolna failures degrade to an error state, not a
// silent mid-session brain swap. Every failure path degrades to mock, never
// throws (plan Review Focus #1: missing keys / offline still fully works).
import type { VoiceProvider, WorkspaceMode } from '../shared/types';
import type { Session as BolnaSession } from '@bolna/web-call';
import { BolnaProvider } from './bolnaProvider';
import { MockProvider } from './mockProvider';
import { LocalVoiceProvider } from './localProvider';
export { LocalVoiceProvider } from './localProvider';
import { DEFAULT_BRIDGE_BASE } from './types';

export interface CreateVoiceProviderOptions {
  language: 'en' | 'hi';
  bridgeBase?: string;
  /** Injectable fetch (tests stub it; defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Force the mock brain (tests / explicit offline dev). */
  forceMock?: boolean;
  /**
   * Live getter for Settings.workspaceModes (mock/local brains): the workspace_mode
   * intent matches whatever the panel currently holds, without a provider rebuild.
   */
  getWorkspaceModes?: () => WorkspaceMode[];
  /** Live getter for Settings.voiceLanguage (local brain STT language). */
  getVoiceLanguage?: () => string | undefined;
}

/** Structural check: the bridge forwards Bolna's mint JSON as-is when keys exist. */
function looksLikeRealSession(value: unknown): value is BolnaSession {
  if (value === null || typeof value !== 'object') return false;
  const s = value as { mock?: unknown; run_id?: unknown; wss_url?: unknown };
  if (s.mock === true) return false; // "after any {mock:true}" → mock
  return typeof s.run_id === 'string' && s.run_id.length > 0 && typeof s.wss_url === 'string' && s.wss_url.length > 0;
}

export async function createVoiceProvider(opts: CreateVoiceProviderOptions): Promise<VoiceProvider> {
  const bridgeBase = opts.bridgeBase ?? DEFAULT_BRIDGE_BASE;
  const fetchImpl: typeof fetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  // Deterministic mock for e2e (?dev=1 on the overlay) — no mic prompts, no
  // model downloads, no network beyond the local bridge.
  const devParam =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('dev') === '1';
  if (opts.forceMock || devParam) {
    return new MockProvider({ bridgeBase, fetchImpl, getWorkspaceModes: opts.getWorkspaceModes });
  }

  try {
    const res = await fetchImpl(`${bridgeBase}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: opts.language }),
    });
    if (res.ok) {
      const body: unknown = await res.json().catch(() => null);
      if (looksLikeRealSession(body)) {
        // The probe's session carries the agent language already (bridge sets
        // agent_data.language from the probe body); BolnaProvider spends it on
        // the first start and re-mints via sessionUrl afterwards.
        return new BolnaProvider({ bridgeBase, session: body });
      }
    }
  } catch {
    /* offline / bridge down → next tier */
  }

  // Tier 2 — free-forever local voice (Vosk STT + OS TTS + Ollama chat brain):
  // needs a microphone. Without one (CI, remote sessions) or in test contexts
  // we fall through to the deterministic mock brain.
  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (mediaDevices?.getUserMedia) {
    return new LocalVoiceProvider({
      bridgeBase,
      fetchImpl,
      getWorkspaceModes: opts.getWorkspaceModes,
      getLanguage: () => opts.getVoiceLanguage?.() ?? 'en-us',
      mediaDevices,
    });
  }
  return new MockProvider({ bridgeBase, fetchImpl, getWorkspaceModes: opts.getWorkspaceModes });
}

export { BolnaProvider, type BolnaProviderDeps } from './bolnaProvider';
export {
  MockProvider,
  parseIntent,
  parseAppTask,
  intentToTool,
  failureReply,
  fetchRouteDecision,
  ROUTE_TIMEOUT_MS,
  type MockProviderDeps,
} from './mockProvider';
export {
  DEFAULT_BRIDGE_BASE,
  type BolnaVoiceProviderExtras,
  type MockIntent,
  type MockVoiceProviderExtras,
} from './types';

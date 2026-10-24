// Voice module entry: the createVoiceProvider factory (plan Task D).
// "Bolna when the bridge /api/session returns a real session, MockProvider
// otherwise (and after any {mock:true})" — the probe result decides once per
// provider creation; runtime Bolna failures degrade to an error state, not a
// silent mid-session brain swap. Every failure path degrades to mock, never
// throws (plan Review Focus #1: missing keys / offline still fully works).
import type { VoiceProvider } from '../shared/types';
import type { Session as BolnaSession } from '@bolna/web-call';
import { BolnaProvider } from './bolnaProvider';
import { MockProvider } from './mockProvider';
import { DEFAULT_BRIDGE_BASE } from './types';

export interface CreateVoiceProviderOptions {
  language: 'en' | 'hi';
  bridgeBase?: string;
  /** Injectable fetch (tests stub it; defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Force the mock brain (tests / explicit offline dev). */
  forceMock?: boolean;
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
  if (opts.forceMock) return new MockProvider({ bridgeBase, fetchImpl });

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
    /* offline / bridge down → mock */
  }
  return new MockProvider({ bridgeBase, fetchImpl });
}

export { BolnaProvider, type BolnaProviderDeps } from './bolnaProvider';
export { MockProvider, parseIntent, intentToTool, failureReply, type MockProviderDeps } from './mockProvider';
export {
  DEFAULT_BRIDGE_BASE,
  type BolnaVoiceProviderExtras,
  type MockIntent,
  type MockVoiceProviderExtras,
} from './types';

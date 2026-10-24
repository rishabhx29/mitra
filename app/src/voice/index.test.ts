// Factory tests (plan Task D): createVoiceProvider returns BolnaProvider only
// when the bridge /api/session returns a real (non-mock) session; everything
// else — {mock:true}, non-2xx, garbage JSON, fetch throwing — degrades to
// MockProvider without throwing. The @bolna/web-call import is node-safe
// (verified: `node -e "import('@bolna/web-call')…"` → IMPORT OK).
import { describe, expect, it } from 'vitest';
import { BolnaProvider } from './bolnaProvider';
import { MockProvider } from './mockProvider';
import { createVoiceProvider } from './index';

const REAL_SESSION = {
  run_id: 'run-1',
  agent_id: 'a',
  sip_username: 'u',
  sip_password: 'p',
  sip_domain: 'd',
  wss_url: 'wss://example',
  sip_register: false,
  expires_in: 120,
  ice_servers: [],
};

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

function fetchThrowing(): typeof fetch {
  return (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
}

describe('createVoiceProvider', () => {
  it('returns BolnaProvider when the bridge mints a real session', async () => {
    const provider = await createVoiceProvider({
      language: 'en',
      fetchImpl: fetchReturning(REAL_SESSION),
    });
    expect(provider).toBeInstanceOf(BolnaProvider);
  });

  it('returns MockProvider on {mock:true} (no keys) — and it can run a session', async () => {
    const provider = await createVoiceProvider({
      language: 'hi',
      fetchImpl: fetchReturning({ mock: true, reason: 'BOLNA_API_KEY / BOLNA_AGENT_ID not configured' }),
    });
    expect(provider).toBeInstanceOf(MockProvider);
    const states: string[] = [];
    provider.onState((s) => states.push(s));
    await provider.start({ language: 'hi' });
    expect(states).toEqual(['listening']);
  });

  it('returns MockProvider when the mint degrades ({mock:true, error})', async () => {
    const provider = await createVoiceProvider({
      language: 'en',
      fetchImpl: fetchReturning({ mock: true, error: 'Bolna session mint failed (503): overloaded' }),
    });
    expect(provider).toBeInstanceOf(MockProvider);
  });

  it('returns MockProvider on non-2xx, garbage JSON, or a fetch failure — never throws', async () => {
    for (const fetchImpl of [
      fetchReturning({ some: 'garbage' }, 500),
      fetchReturning('not an object'),
      fetchReturning(null),
      fetchThrowing(),
    ]) {
      const provider = await createVoiceProvider({ language: 'en', fetchImpl });
      expect(provider).toBeInstanceOf(MockProvider);
    }
  });

  it('forceMock bypasses the probe entirely', async () => {
    const provider = await createVoiceProvider({
      language: 'en',
      forceMock: true,
      fetchImpl: fetchReturning(REAL_SESSION),
    });
    expect(provider).toBeInstanceOf(MockProvider);
  });
});

// Logic-only unit tests for the mock voice brain (plan Task D "Verify").
// Pure parser + flow tests with stubbed fetch and injected clocks — no DOM,
// no jsdom, no WebGL, no electron. rAF is absent in node, so the synthetic
// amplitude envelope stays flat (asserted below) and no timers hang.
import { describe, expect, it } from 'vitest';
import type { SessionState, TranscriptEntry } from '../shared/types';
import { t } from '../i18n';
import { MockProvider, failureReply, parseIntent, type MockProviderDeps } from './mockProvider';

// ---------------------------------------------------------------------------
// parseIntent — en / hi (Devanagari) / Hinglish
// ---------------------------------------------------------------------------

describe('parseIntent — add_todo', () => {
  it('parses the English "add X to my (todo )?list" family', () => {
    expect(parseIntent('add milk to my list')).toEqual({ kind: 'add_todo', text: 'milk' });
    expect(parseIntent('Add buy groceries to my todo list.')).toEqual({
      kind: 'add_todo',
      text: 'buy groceries',
    });
    expect(parseIntent('add ship the demo to the task list')).toEqual({
      kind: 'add_todo',
      text: 'ship the demo',
    });
    expect(parseIntent('add call mom to list')).toEqual({ kind: 'add_todo', text: 'call mom' });
  });

  it('parses "list me X"', () => {
    expect(parseIntent('list me call the plumber')).toEqual({
      kind: 'add_todo',
      text: 'call the plumber',
    });
  });

  it('parses Hinglish "X add karo" and "meri list me X jodo"', () => {
    expect(parseIntent('milk add karo')).toEqual({ kind: 'add_todo', text: 'milk' });
    expect(parseIntent('meri list me doodh jodo')).toEqual({ kind: 'add_todo', text: 'doodh' });
    expect(parseIntent('list me reply to rahul jodo')).toEqual({
      kind: 'add_todo',
      text: 'reply to rahul',
    });
  });

  it('parses Devanagari Hindi', () => {
    expect(parseIntent('मेरी लिस्ट में दूध जोड़ो')).toEqual({ kind: 'add_todo', text: 'दूध' });
    expect(parseIntent('दूध जोड़ो')).toEqual({ kind: 'add_todo', text: 'दूध' });
  });
});

describe('parseIntent — launch_app', () => {
  it('parses "open X" and strips leading articles', () => {
    expect(parseIntent('open notepad')).toEqual({ kind: 'launch_app', alias: 'notepad' });
    expect(parseIntent('open the calculator')).toEqual({ kind: 'launch_app', alias: 'calculator' });
    expect(parseIntent('launch spotify')).toEqual({ kind: 'launch_app', alias: 'spotify' });
  });

  it('parses Hinglish "X kholo" and Devanagari', () => {
    expect(parseIntent('notepad kholo')).toEqual({ kind: 'launch_app', alias: 'notepad' });
    expect(parseIntent('browser khol do')).toEqual({ kind: 'launch_app', alias: 'browser' });
    expect(parseIntent('notepad खोलो')).toEqual({ kind: 'launch_app', alias: 'notepad' });
  });

  it('does not hijack "open opencode and build …" into launch_app', () => {
    const intent = parseIntent('open opencode and build a snake game');
    expect(intent).toEqual({ kind: 'opencode_task', prompt: 'a snake game' });
  });
});

describe('parseIntent — opencode_task', () => {
  it('parses the spec form "open opencode and build/deso/banao …"', () => {
    expect(parseIntent('open opencode and build a snake game')).toEqual({
      kind: 'opencode_task',
      prompt: 'a snake game',
    });
    expect(parseIntent('open opencode and deso a landing page')).toEqual({
      kind: 'opencode_task',
      prompt: 'a landing page',
    });
    expect(parseIntent('open opencode aur banao todo app')).toEqual({
      kind: 'opencode_task',
      prompt: 'todo app',
    });
  });

  it('parses Hinglish variants', () => {
    expect(parseIntent('opencode me todo app banao')).toEqual({
      kind: 'opencode_task',
      prompt: 'todo app',
    });
    expect(parseIntent('opencode build a cli tool')).toEqual({
      kind: 'opencode_task',
      prompt: 'a cli tool',
    });
  });
});

describe('parseIntent — open_url', () => {
  it('detects absolute and bare URLs, including after "open"', () => {
    expect(parseIntent('open github.com')).toEqual({ kind: 'open_url', url: 'https://github.com' });
    expect(parseIntent('https://docs.bolna.ai/docs?x=1')).toEqual({
      kind: 'open_url',
      url: 'https://docs.bolna.ai/docs?x=1',
    });
    expect(parseIntent('www.example.com/path')).toEqual({
      kind: 'open_url',
      url: 'https://www.example.com/path',
    });
    expect(parseIntent('youtube.com kholo')).toEqual({ kind: 'open_url', url: 'https://youtube.com' });
  });
});

describe('parseIntent — stop + language_switch', () => {
  it('parses stop in en/hi/hinglish as full-utterance only', () => {
    expect(parseIntent('stop')).toEqual({ kind: 'stop' });
    expect(parseIntent('ruko!')).toEqual({ kind: 'stop' });
    expect(parseIntent('band karo')).toEqual({ kind: 'stop' });
    expect(parseIntent('बंद करो')).toEqual({ kind: 'stop' });
    // Not a stop: longer sentence containing "stop".
    expect(parseIntent('stop the music')).not.toEqual({ kind: 'stop' });
  });

  it('parses language switches both ways', () => {
    expect(parseIntent('speak hindi')).toEqual({ kind: 'language_switch', language: 'hi' });
    expect(parseIntent('ab hindi me bolo')).toEqual({ kind: 'language_switch', language: 'hi' });
    expect(parseIntent('hindi me bolo')).toEqual({ kind: 'language_switch', language: 'hi' });
    expect(parseIntent('हिंदी में बोलो')).toEqual({ kind: 'language_switch', language: 'hi' });
    expect(parseIntent('speak english')).toEqual({ kind: 'language_switch', language: 'en' });
    expect(parseIntent('ab english me bolo')).toEqual({ kind: 'language_switch', language: 'en' });
  });
});

describe('parseIntent — unknown input', () => {
  it('returns null so the caller replies with a clarification', () => {
    expect(parseIntent("what's the weather today")).toBeNull();
    expect(parseIntent('tell me a joke yaar')).toBeNull();
    expect(parseIntent('')).toBeNull();
    expect(parseIntent('   ')).toBeNull();
    expect(parseIntent('open')).toBeNull(); // launch requires a target
  });
});

// ---------------------------------------------------------------------------
// failureReply — permission-denial shape (mirrors the bridge 403 body)
// ---------------------------------------------------------------------------

describe('failureReply', () => {
  it('maps each gate to a localized apology + Settings hint', () => {
    for (const gate of ['notion', 'launcher', 'terminal', 'browser'] as const) {
      expect(failureReply('en', `Permission denied: ${gate}`)).toBe(t('en', `voice.denied.${gate}`));
      expect(failureReply('hi', `Permission denied: ${gate}`)).toBe(t('hi', `voice.denied.${gate}`));
    }
  });

  it('falls back to the generic denial for an unknown gate, and apology+summary otherwise', () => {
    expect(failureReply('en', 'Permission denied: whatever')).toBe(t('en', 'voice.denied'));
    expect(failureReply('en', 'Unknown tool: x')).toBe(
      `${t('en', 'voice.apology')} Unknown tool: x`,
    );
  });
});

// ---------------------------------------------------------------------------
// MockProvider flow — stubbed fetch (permission denial + happy path)
// ---------------------------------------------------------------------------

type FetchCall = { url: string; init?: { method?: string; body?: string } };

function makeProvider(
  fetchImpl: (url: string, init?: { method?: string; body?: string }) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>,
  overrides: Partial<MockProviderDeps> = {},
): { provider: MockProvider; calls: FetchCall[]; states: SessionState[]; transcripts: TranscriptEntry[] } {
  const calls: FetchCall[] = [];
  const wrapped = Object.assign(
    (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    }) as unknown as typeof fetch,
    { calls },
  );
  const provider = new MockProvider({
    bridgeBase: 'http://127.0.0.1:8765',
    fetchImpl: wrapped,
    delay: async () => undefined, // no sleeps in tests
    random: () => 0.5,
    idFactory: () => 'test-id',
    ...overrides,
  });
  const states: SessionState[] = [];
  const transcripts: TranscriptEntry[] = [];
  provider.onState((s) => states.push(s));
  provider.onTranscript((entry) => transcripts.push(entry));
  return { provider, calls, states, transcripts };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('MockProvider flow', () => {
  it('start() → listening + greeting; no network', async () => {
    const { provider, calls, states, transcripts } = makeProvider(async () => {
      throw new Error('network must not be used');
    });
    await provider.start({ language: 'en' });
    expect(states).toEqual(['listening']);
    expect(transcripts[0]?.role).toBe('agent');
    expect(transcripts[0]?.text).toBe(t('en', 'voice.greeting'));
    expect(calls).toHaveLength(0);
  });

  it('add-todo → POSTs the ToolRequest to the bridge and speaks the returned summary', async () => {
    const { provider, calls, states, transcripts } = makeProvider(async () =>
      jsonResponse({ id: 'test-id', ok: true, summary: 'Added to Notion (mock board): "milk"' }),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('add milk to my list');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8765/api/tools/notion_add_todo');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init?.body ?? '{}')).toEqual({
      id: 'test-id',
      tool: 'notion_add_todo',
      args: { text: 'milk' },
    });

    expect(states).toEqual(['listening', 'thinking', 'speaking', 'listening']);
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe('Added to Notion (mock board): "milk"');
    // Envelope ends at 0 after speaking (rAF absent in node → flat all along).
    expect(provider.syntheticAmplitude.current).toBe(0);
  });

  it('permission denial (HTTP 403 carrying a ToolResult body) → apology + Settings hint, tool still "spoke" gracefully', async () => {
    const { provider, calls, transcripts } = makeProvider(async () =>
      jsonResponse({ id: 'test-id', ok: false, summary: 'Permission denied: notion' }, 403),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('add milk to my list');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8765/api/tools/notion_add_todo');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('en', 'voice.denied.notion'));
  });

  it('other ok:false results → apology + the bridge summary', async () => {
    const { provider, transcripts } = makeProvider(async () =>
      jsonResponse({ id: 'x', ok: false, summary: 'Unknown alias "skype". Available: notepad, terminal' }),
    );
    await provider.start({ language: 'en' });
    await provider.submitText('open skype');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(
      `${t('en', 'voice.apology')} Unknown alias "skype". Available: notepad, terminal`,
    );
  });

  it('bridge unreachable (fetch throws) → localized apology, never throws', async () => {
    const { provider, transcripts } = makeProvider(async () => {
      throw new Error('ECONNREFUSED');
    });
    await provider.start({ language: 'hi' });
    await provider.submitText('मेरी लिस्ट में दूध जोड़ो');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('hi', 'voice.bridgeUnreachable'));
  });

  it('unknown input → clarification, no fetch', async () => {
    const { provider, calls, transcripts } = makeProvider(async () => {
      throw new Error('must not be called');
    });
    await provider.start({ language: 'en' });
    await provider.submitText("what's the weather today");
    expect(calls).toHaveLength(0);
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('en', 'voice.clarify'));
  });

  it('stop → speaks the goodbye and ends the session in idle', async () => {
    const { provider, states, transcripts } = makeProvider(async () => {
      throw new Error('must not be called');
    });
    await provider.start({ language: 'en' });
    await provider.submitText('ruko');
    expect(states[states.length - 1]).toBe('idle');
    const agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('en', 'voice.stopReply'));
  });

  it('language switch → confirmation in the NEW language, later replies follow it', async () => {
    const { provider, transcripts } = makeProvider(async () => {
      throw new Error('must not be called');
    });
    await provider.start({ language: 'en' });
    await provider.submitText('ab hindi me bolo');
    let agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('hi', 'voice.langSwitched.hi'));

    await provider.submitText('blah blah blah');
    agent = transcripts.filter((e) => e.role === 'agent');
    expect(agent[agent.length - 1]?.text).toBe(t('hi', 'voice.clarify'));
  });

  it('stop() → idle from any active state (mid-session abort, Review Focus #4)', async () => {
    const { provider, states } = makeProvider(async () => jsonResponse({ id: 'x', ok: true, summary: 'ok' }));
    await provider.start({ language: 'en' });
    const pending = provider.submitText('add milk to my list'); // in flight
    await provider.stop();
    expect(states[states.length - 1]).toBe('idle');
    await pending;
  });
});

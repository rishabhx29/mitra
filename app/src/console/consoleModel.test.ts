// Logic-only unit tests for the console model (node env, injected fetch/clock —
// AGENTS.md). Covers: the reducer (submit/tool-card/agent-line/boot/speak
// flags), runSubmit (intent→tool card incl. permission-denied, chat fallback,
// ollama chat reply, stop/language intents, offline bridge), buildChatHistory,
// boot lines, brain-status probing, the speak-duration policy and the
// hint-chip config (parseable in BOTH locales through the real intent parser).

import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { t } from '../i18n';
import { DEFAULT_SETTINGS } from '../shared/types';
import { parseIntent } from '../voice';
import {
  HINT_CHIPS,
  TOOL_COUNT,
  buildBootLines,
  buildChatHistory,
  consoleReducer,
  fetchBrainStatus,
  initialConsoleState,
  runSubmit,
  speakDurationMs,
  type ConsoleAction,
  type ConsoleEntry,
  type ConsoleState,
} from './consoleModel';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const NO_DELAY = async (): Promise<void> => {};
let idSeq = 0;
const nextId = (): string => `id-${++idSeq}`;
const FIXED_NOW = (): number => 5_000;

/** Reducer run through a tiny harness so tests assert final + per-action state. */
function runActions(actions: ConsoleAction[], start?: ConsoleState): ConsoleState {
  return actions.reduce(consoleReducer, start ?? initialConsoleState());
}

/** Collect dispatched actions from runSubmit. */
function collector(): ConsoleAction[] {
  const out: ConsoleAction[] = [];
  return out;
}

/** JSON response helper (node's global Response). */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchLog = Array<{ url: string; init: RequestInit | undefined }>;

/** Fake fetch that records calls and answers per-URL. */
function fakeFetch(
  answer: (url: string) => Response | Promise<Response>,
): { fetch: typeof fetch; log: FetchLog } {
  const log: FetchLog = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    log.push({ url: String(url), init });
    return answer(String(url));
  }) as unknown as typeof fetch;
  return { fetch: impl, log };
}

const baseDeps = {
  bridgeBase: 'http://127.0.0.1:8765',
  now: FIXED_NOW,
  idFactory: nextId,
  delay: NO_DELAY,
  random: () => 0,
};

function lastAction(actions: ConsoleAction[]): ConsoleAction {
  expect(actions.length).toBeGreaterThan(0);
  return actions[actions.length - 1] as ConsoleAction;
}

// ---------------------------------------------------------------------------
// Reducer (pure)
// ---------------------------------------------------------------------------

describe('consoleReducer', () => {
  it('submit adds a user bubble and turns the typing flag on', () => {
    const s = runActions([{ type: 'submit', text: 'hello', id: 'u1', ts: 1 }]);
    expect(s.typing).toBe(true);
    expect(s.entries).toEqual([{ id: 'u1', kind: 'user', text: 'hello', ts: 1 }]);
  });

  it('tool-result appends a tool card without clearing typing', () => {
    const s = runActions([
      { type: 'submit', text: 'add chai', id: 'u1', ts: 1 },
      { type: 'tool-result', id: 't1', ts: 2, tool: 'notion_add_todo', summary: "Added 'chai' ✓", ok: true },
    ]);
    expect(s.typing).toBe(true);
    const tool = s.entries[1];
    expect(tool.kind).toBe('tool');
    if (tool.kind === 'tool') {
      expect(tool.tool).toBe('notion_add_todo');
      expect(tool.ok).toBe(true);
      expect(tool.summary).toBe("Added 'chai' ✓");
    }
  });

  it('agent-line appends the reply, clears typing and sets the speak envelope flag', () => {
    const s = runActions([
      { type: 'submit', text: 'hi', id: 'u1', ts: 1 },
      { type: 'agent-line', id: 'a1', ts: 2, text: 'Hello!', speakUntil: 9999 },
    ]);
    expect(s.typing).toBe(false);
    expect(s.speakUntil).toBe(9999);
    const agent = s.entries[1];
    expect(agent.kind).toBe('agent');
    if (agent.kind === 'agent') expect(agent.text).toBe('Hello!');
  });

  it('speak-end clears the envelope flag', () => {
    const s = runActions([
      { type: 'agent-line', id: 'a1', ts: 1, text: 'x', speakUntil: 123 },
      { type: 'speak-end' },
    ]);
    expect(s.speakUntil).toBe(0);
  });

  it('boot lines accumulate and boot-done flips the flag', () => {
    let s = runActions([
      { type: 'boot-line', text: 'l1', id: 'b1', ts: 1 },
      { type: 'boot-line', text: 'l2', id: 'b2', ts: 2 },
    ]);
    expect(s.booted).toBe(false);
    expect(s.entries.map((e) => (e.kind === 'boot' ? e.text : ''))).toEqual(['l1', 'l2']);
    s = consoleReducer(s, { type: 'boot-done' });
    expect(s.booted).toBe(true);
  });

  it('status actions merge (probe first, chat reply refines)', () => {
    let s = consoleReducer(initialConsoleState(), {
      type: 'status',
      status: { brain: 'mock', bridgeMock: true },
    });
    s = consoleReducer(s, { type: 'status', status: { brain: 'ollama', model: 'qwen2.5:3b' } });
    expect(s.status).toEqual({ brain: 'ollama', model: 'qwen2.5:3b', bridgeMock: true });
  });
});

// ---------------------------------------------------------------------------
// runSubmit — intent → tool path
// ---------------------------------------------------------------------------

describe('runSubmit — tool intent', () => {
  it('matched intent → POST /api/tools/:name → tool card ok + agent line from summary', async () => {
    const { fetch, log } = fakeFetch(() =>
      jsonResponse({ id: 'x', ok: true, summary: "Added 'chai' to your board ✓" }),
    );
    const actions = collector();
    await runSubmit('add chai to my todo list', (a) => actions.push(a), {
      ...baseDeps,
      fetchImpl: fetch,
    });

    expect(log).toHaveLength(1);
    expect(log[0].url).toBe('http://127.0.0.1:8765/api/tools/notion_add_todo');
    const kinds = actions.map((a) => a.type);
    expect(kinds).toEqual(['submit', 'tool-result', 'agent-line']);

    const tool = actions[1];
    if (tool.type === 'tool-result') {
      expect(tool.tool).toBe('notion_add_todo');
      expect(tool.ok).toBe(true);
      expect(tool.summary).toBe("Added 'chai' to your board ✓");
    } else {
      throw new Error('expected tool-result');
    }
    const agent = lastAction(actions);
    if (agent.type === 'agent-line') {
      expect(agent.text).toBe("Added 'chai' to your board ✓");
      expect(agent.speakUntil).toBe(FIXED_NOW() + speakDurationMs(agent.text));
    } else {
      throw new Error('expected agent-line last');
    }
  });

  it('permission denied (HTTP 403 + ToolResult body) → denied tool card + localized apology', async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse({ id: 'x', ok: false, summary: 'Permission denied: notion' }, 403),
    );
    const actions = collector();
    await runSubmit('add chai to my todo list', (a) => actions.push(a), {
      ...baseDeps,
      fetchImpl: fetch,
    });

    const tool = actions[1];
    if (tool.type === 'tool-result') {
      expect(tool.ok).toBe(false);
      expect(tool.summary).toBe('Permission denied: notion');
    } else {
      throw new Error('expected tool-result');
    }
    const agent = lastAction(actions);
    if (agent.type === 'agent-line') {
      // failureReply maps the gate to voice.denied.notion (mockProvider contract).
      expect(agent.text).toBe(t('en', 'voice.denied.notion'));
    } else {
      throw new Error('expected agent-line');
    }
  });

  it('tool failure (ok:false) → failed card + apology + summary', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ id: 'x', ok: false, summary: 'board exploded' }));
    const actions = collector();
    await runSubmit('add chai to my todo list', (a) => actions.push(a), {
      ...baseDeps,
      fetchImpl: fetch,
    });
    const tool = actions[1];
    if (tool.type === 'tool-result') expect(tool.ok).toBe(false);
    else throw new Error('expected tool-result');
    const agent = lastAction(actions);
    if (agent.type === 'agent-line') {
      expect(agent.text).toBe(`${t('en', 'voice.apology')} board exploded`);
    } else throw new Error('expected agent-line');
  });

  it('bridge unreachable (fetch throws) → failed card + honest offline line, never throws', async () => {
    const { fetch } = fakeFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const actions = collector();
    await runSubmit('add chai to my todo list', (a) => actions.push(a), {
      ...baseDeps,
      fetchImpl: fetch,
    });
    const tool = actions[1];
    if (tool.type === 'tool-result') {
      expect(tool.ok).toBe(false);
      expect(tool.summary).toBe('bridge-offline');
    } else throw new Error('expected tool-result');
    const agent = lastAction(actions);
    if (agent.type === 'agent-line') {
      expect(agent.text).toBe(t('en', 'voice.bridgeUnreachable'));
    } else throw new Error('expected agent-line');
  });

  it('empty input dispatches nothing', async () => {
    const actions = collector();
    await runSubmit('   ', (a) => actions.push(a), baseDeps);
    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runSubmit — conversational intents (no tool) + chat fallback
// ---------------------------------------------------------------------------

describe('runSubmit — chat + non-tool intents', () => {
  it('no intent → POST /api/brain/chat {messages, language} → ollama reply + status update', async () => {
    const { fetch, log } = fakeFetch(() =>
      jsonResponse({ brain: 'ollama', model: 'qwen2.5:3b', text: 'I am Mitra, your assistant.' }),
    );
    const history = [{ role: 'assistant' as const, content: 'Welcome.' }];
    const actions = collector();
    await runSubmit('who are you?', (a) => actions.push(a), {
      ...baseDeps,
      fetchImpl: fetch,
      history,
      lang: 'en',
    });

    expect(log).toHaveLength(1);
    expect(log[0].url).toBe('http://127.0.0.1:8765/api/brain/chat');
    const body = JSON.parse(String(log[0].init?.body)) as {
      messages: Array<{ role: string; content: string }>;
      language: string;
    };
    expect(body.language).toBe('en');
    // history first, current utterance last:
    expect(body.messages[0]).toEqual({ role: 'assistant', content: 'Welcome.' });
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'who are you?' });

    const agent = lastAction(actions);
    if (agent.type === 'agent-line') expect(agent.text).toBe('I am Mitra, your assistant.');
    else throw new Error('expected agent-line');
    const status = actions.find((a) => a.type === 'status');
    if (status?.type === 'status') {
      expect(status.status).toEqual({ brain: 'ollama', model: 'qwen2.5:3b' });
    } else throw new Error('expected status update');
  });

  it('no intent + chat endpoint missing (404) → mock clarify fallback (zero local models still works)', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ ok: false, summary: 'Not Found' }, 404));
    const actions = collector();
    await runSubmit('who are you?', (a) => actions.push(a), { ...baseDeps, fetchImpl: fetch });
    const agent = lastAction(actions);
    if (agent.type === 'agent-line') {
      expect(agent.text).toBe(t('en', 'voice.clarify'));
    } else throw new Error('expected agent-line');
    expect(actions.some((a) => a.type === 'status' && a.status.brain === 'ollama')).toBe(false);
  });

  it('no intent + chat throws → mock clarify fallback, never throws', async () => {
    const { fetch } = fakeFetch(() => {
      throw new Error('offline');
    });
    const actions = collector();
    await runSubmit('who are you?', (a) => actions.push(a), { ...baseDeps, fetchImpl: fetch });
    const agent = lastAction(actions);
    if (agent.type === 'agent-line') expect(agent.text).toBe(t('en', 'voice.clarify'));
    else throw new Error('expected agent-line');
  });

  it('stop intent → goodbye agent line, no tool card', async () => {
    const { fetch, log } = fakeFetch(() => jsonResponse({}));
    const actions = collector();
    await runSubmit('stop', (a) => actions.push(a), { ...baseDeps, fetchImpl: fetch });
    expect(log).toHaveLength(0); // nothing was called
    expect(actions.some((a) => a.type === 'tool-result')).toBe(false);
    const agent = lastAction(actions);
    if (agent.type === 'agent-line') expect(agent.text).toBe(t('en', 'voice.stopReply'));
    else throw new Error('expected agent-line');
  });

  it('language_switch intent → confirmation in the NEW language, no tool card', async () => {
    const { fetch, log } = fakeFetch(() => jsonResponse({}));
    const actions = collector();
    await runSubmit('speak hindi', (a) => actions.push(a), { ...baseDeps, fetchImpl: fetch });
    expect(log).toHaveLength(0);
    const agent = lastAction(actions);
    if (agent.type === 'agent-line') expect(agent.text).toBe(t('hi', 'voice.langSwitched.hi'));
    else throw new Error('expected agent-line');
  });

  it('workspace modes feed the parser (mode utterance → workspace_mode tool)', async () => {
    const { fetch, log } = fakeFetch(() => jsonResponse({ id: 'x', ok: true, summary: 'Coding mode on' }));
    const actions = collector();
    await runSubmit('coding karna hai', (a) => actions.push(a), {
      ...baseDeps,
      fetchImpl: fetch,
      getWorkspaceModes: () => DEFAULT_SETTINGS.workspaceModes ?? [],
    });
    expect(log).toHaveLength(1);
    expect(log[0].url).toBe('http://127.0.0.1:8765/api/tools/workspace_mode');
    const tool = actions[1];
    if (tool.type === 'tool-result') expect(tool.tool).toBe('workspace_mode');
    else throw new Error('expected tool-result');
  });
});

// ---------------------------------------------------------------------------
// buildChatHistory
// ---------------------------------------------------------------------------

describe('buildChatHistory', () => {
  const entries: ConsoleEntry[] = [
    { id: 'b1', kind: 'boot', text: 'neural link', ts: 1 },
    { id: 'u1', kind: 'user', text: 'q1', ts: 2 },
    { id: 'a1', kind: 'agent', text: 'r1', ts: 3 },
    { id: 't1', kind: 'tool', tool: 'notion_add_todo', summary: 'ok', ok: true, ts: 4 },
    { id: 'u2', kind: 'user', text: 'q2', ts: 5 },
  ];

  it('keeps only user/agent turns, oldest first, skips boot + tool cards', () => {
    expect(buildChatHistory(entries)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'r1' },
      { role: 'user', content: 'q2' },
    ]);
  });

  it('caps at max messages (most recent)', () => {
    const many: ConsoleEntry[] = Array.from({ length: 12 }, (_, i): ConsoleEntry => ({
      id: `u${i}`,
      kind: 'user',
      text: `m${i}`,
      ts: i,
    }));
    const out = buildChatHistory(many, 4);
    expect(out).toHaveLength(4);
    expect(out.map((m) => m.content)).toEqual(['m8', 'm9', 'm10', 'm11']);
  });
});

// ---------------------------------------------------------------------------
// speakDurationMs (envelope timing policy: ~2s + text length, clamped)
// ---------------------------------------------------------------------------

describe('speakDurationMs', () => {
  it('floors at 2s (empty text) and adds ~90ms per word', () => {
    expect(speakDurationMs('')).toBe(2000);
    expect(speakDurationMs('Hi.')).toBe(2090); // 2000 + 1 × 90
  });
  it('grows with length', () => {
    const short = speakDurationMs('ok');
    const long = speakDurationMs('one two three four five six seven eight nine ten words here');
    expect(long).toBeGreaterThan(short);
  });
  it('clamps very long replies', () => {
    const big = speakDurationMs(Array.from({ length: 200 }, () => 'word').join(' '));
    expect(big).toBe(8000);
  });
});

// ---------------------------------------------------------------------------
// Boot lines + status probe
// ---------------------------------------------------------------------------

describe('buildBootLines', () => {
  it('renders 4 lines with the ollama brain + model and the armed tool count', () => {
    const lines = buildBootLines({ brain: 'ollama', model: 'qwen2.5:3b', bridgeMock: false }, 'en');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(t('en', 'console.boot.link'));
    expect(lines[1]).toContain('Ollama qwen2.5:3b');
    expect(lines[2]).toContain(String(TOOL_COUNT));
    expect(lines[3]).toBe(t('en', 'console.boot.mode.live'));
  });

  it('falls back to the mock brain label without a model', () => {
    const lines = buildBootLines({ brain: 'mock', bridgeMock: true }, 'en');
    expect(lines[1]).toContain(t('en', 'console.brain.mock'));
    expect(lines[3]).toBe(t('en', 'console.boot.mode.mock'));
  });

  it('localizes to Hindi', () => {
    const lines = buildBootLines({ brain: 'ollama', model: 'qwen2.5:3b' }, 'hi');
    expect(lines[1]).toBe(t('hi', 'console.boot.brain').replace('{brain}', 'Ollama qwen2.5:3b'));
  });
});

describe('fetchBrainStatus', () => {
  it('maps a healthy ollama status + bridge health', async () => {
    const { fetch, log } = fakeFetch((url) =>
      url.endsWith('/api/brain/status')
        ? jsonResponse({ brain: 'ollama', model: 'qwen2.5:3b' })
        : jsonResponse({ ok: true, mock: false }),
    );
    const status = await fetchBrainStatus({ fetchImpl: fetch });
    expect(status).toEqual({ brain: 'ollama', model: 'qwen2.5:3b', bridgeMock: false });
    expect(log.map((l) => l.url).some((u) => u.endsWith('/api/health'))).toBe(true);
  });

  it('degrades to mock when the brain endpoint is missing (404)', async () => {
    const { fetch } = fakeFetch((url) =>
      url.endsWith('/api/brain/status') ? jsonResponse({ ok: false }, 404) : jsonResponse({ ok: true, mock: true }),
    );
    const status = await fetchBrainStatus({ fetchImpl: fetch });
    expect(status.brain).toBe('mock');
    expect(status.bridgeMock).toBe(true);
  });

  it('never throws when the bridge is down', async () => {
    const { fetch } = fakeFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const status = await fetchBrainStatus({ fetchImpl: fetch });
    expect(status).toEqual({ brain: 'mock', model: undefined, bridgeMock: undefined });
  });

  it('ignores garbage bodies and junk model values', async () => {
    const { fetch } = fakeFetch((url) =>
      url.endsWith('/api/brain/status')
        ? jsonResponse({ brain: 'skynet', model: 42 })
        : jsonResponse({ mock: 'yes' }),
    );
    const status = await fetchBrainStatus({ fetchImpl: fetch });
    expect(status.brain).toBe('mock'); // unknown brain string → honest mock
    expect(status.model).toBeUndefined();
    expect(status.bridgeMock).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Hint chips (3 samples: tool + Hinglish + question; parseable en+hi)
// ---------------------------------------------------------------------------

describe('HINT_CHIPS', () => {
  it('has exactly 3 distinct i18n keys present in BOTH dictionaries', () => {
    expect(HINT_CHIPS).toHaveLength(3);
    const keys = HINT_CHIPS.map((c) => c.key);
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) {
      expect(en[key]).toBeTruthy();
      expect(hi[key]).toBeTruthy();
    }
  });

  it('tool chip parses to an add-todo intent in en AND hi', () => {
    const key = 'console.hint.tool';
    expect(parseIntent(t('en', key), [])).toMatchObject({ kind: 'add_todo' });
    expect(parseIntent(t('hi', key), [])).toMatchObject({ kind: 'add_todo' });
  });

  it('hinglish chip parses to launch_app "notepad" in en AND hi', () => {
    const key = 'console.hint.hinglish';
    for (const lang of ['en', 'hi'] as const) {
      const intent = parseIntent(t(lang, key), []);
      expect(intent).toMatchObject({ kind: 'launch_app' });
      if (intent?.kind === 'launch_app') expect(intent.alias).toBe('notepad');
    }
  });

  it('question chip has NO intent in en AND hi (→ brain chat)', () => {
    const key = 'console.hint.question';
    for (const lang of ['en', 'hi'] as const) {
      expect(parseIntent(t(lang, key), [])).toBeNull();
    }
  });

  it('chips still parse with the shipped workspace presets active (no alias collisions)', () => {
    const modes = DEFAULT_SETTINGS.workspaceModes ?? [];
    expect(parseIntent(t('en', 'console.hint.tool'), modes)).toMatchObject({ kind: 'add_todo' });
    expect(parseIntent(t('en', 'console.hint.hinglish'), modes)).toMatchObject({ kind: 'launch_app' });
    expect(parseIntent(t('en', 'console.hint.question'), modes)).toBeNull();
  });
});

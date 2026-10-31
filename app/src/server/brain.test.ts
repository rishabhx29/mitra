// Brain unit tests — pure node env, injected fetch, no network, no electron.
// Covers: pickBrain auto-pick order (qwen2.5 → gemma2 → smallest), unreachable /
// timeout / non-ok / garbage degradation; chatWithBrain success / preferred model /
// fallbacks (incl. timeouts) with fake fetch; mockConversationalReply determinism,
// en/hi pools and variety; request sanitizing + prompt building.
import { describe, expect, it } from 'vitest';
import type { FetchResponseLike } from './tools/notion';
import {
  BRAIN_CHAT_TIMEOUT_MS,
  BRAIN_DETECT_TIMEOUT_MS,
  MAX_CHAT_CONTENT_CHARS,
  MAX_CHAT_MESSAGES,
  OLLAMA_BASE_URL,
  buildPrompt,
  chatWithBrain,
  chooseOllamaModel,
  mockConversationalReply,
  parseAction,
  parseOllamaTags,
  personaSystemPrompt,
  pickBrain,
  sanitizeChatMessages,
  type BrainFetchLike,
  type ChatMessage,
} from './brain';

describe('parseAction — nested args (balanced scanning)', () => {
  it('parses nested-args JSON the old regex truncated ({"args":{"url":…}})', () => {
    const text = '{"tool":"open_url","args":{"url":"https://animejs.com"}}';
    expect(parseAction(text, ['open_url'])).toEqual({
      tool: 'open_url',
      args: { url: 'https://animejs.com' },
    });
  });

  it('ignores prose around the action and picks the allowed tool', () => {
    const text = 'Sure! {"tool":"youtube_search","args":{"query":"doom trailer"}} hope that helps';
    expect(parseAction(text, ['youtube_search', 'open_url'])).toEqual({
      tool: 'youtube_search',
      args: { query: 'doom trailer' },
    });
  });

  it('still refuses tools outside the allowed list', () => {
    expect(parseAction('{"tool":"open_url","args":{"url":"https://x.dev"}}', ['web_search'])).toBeNull();
  });
});

// ---- fakes (pattern: bridge.test.ts's capturing fetch) ----

function jsonResponse(payload: unknown, ok = true, status = 200): FetchResponseLike {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

type CapturedCall = { url: string; init?: { method?: string; body?: string; signal?: AbortSignal } };

function fakeFetch(
  handler: (url: string, init?: { method?: string; body?: string; signal?: AbortSignal }) => Promise<FetchResponseLike>,
): BrainFetchLike {
  const calls: CapturedCall[] = [];
  const impl = Object.assign(
    (async (url: string, init?: { method?: string; body?: string; signal?: AbortSignal }) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as BrainFetchLike,
    { calls },
  );
  return impl;
}

function callsOf(fetchImpl: BrainFetchLike): CapturedCall[] {
  return (fetchImpl as unknown as { calls: CapturedCall[] }).calls;
}

function tagsHandler(models: unknown): BrainFetchLike {
  return fakeFetch((url) => {
    if (url.endsWith('/api/tags')) return Promise.resolve(jsonResponse({ models }));
    throw new Error(`unexpected brain fetch: ${url}`);
  });
}

const USER_HI: ChatMessage = { role: 'user', content: 'hi' };

describe('pickBrain — auto-pick order', () => {
  it('prefers the SMALLEST qwen2.5 variant over bigger ones and other models', async () => {
    const f = tagsHandler([
      { name: 'llama3.2:1b', size: 1_300_000_000 },
      { name: 'qwen2.5:7b', size: 4_700_000_000 },
      { name: 'qwen2.5:3b', size: 1_900_000_000 },
    ]);
    await expect(pickBrain({ fetchImpl: f })).resolves.toEqual({ brain: 'ollama', model: 'qwen2.5:3b' });
  });

  it('matches qwen2.5 case-insensitively', async () => {
    const f = tagsHandler([{ name: 'Qwen2.5:3b-Instruct', size: 1_900_000_000 }]);
    await expect(pickBrain({ fetchImpl: f })).resolves.toEqual({ brain: 'ollama', model: 'Qwen2.5:3b-Instruct' });
  });

  it('falls back to the smallest gemma2 variant when no qwen2.5 is installed', async () => {
    const f = tagsHandler([
      { name: 'llama3:8b', size: 4_700_000_000 },
      { name: 'gemma2:9b', size: 5_400_000_000 },
      { name: 'gemma2:2b', size: 1_600_000_000 },
    ]);
    await expect(pickBrain({ fetchImpl: f })).resolves.toEqual({ brain: 'ollama', model: 'gemma2:2b' });
  });

  it('falls back to the smallest installed model when neither family exists', async () => {
    const f = tagsHandler([
      { name: 'llama3:8b', size: 4_700_000_000 },
      { name: 'tinyllama:1.1b', size: 640_000_000 },
      { name: 'mistral:7b', size: 4_100_000_000 },
    ]);
    await expect(pickBrain({ fetchImpl: f })).resolves.toEqual({ brain: 'ollama', model: 'tinyllama:1.1b' });
  });

  it('probes the default Ollama base URL with GET /api/tags', async () => {
    const f = tagsHandler([{ name: 'qwen2.5:3b', size: 1_900_000_000 }]);
    await pickBrain({ fetchImpl: f });
    const call = callsOf(f)[0];
    expect(call?.url).toBe('http://127.0.0.1:11434/api/tags');
    expect(call?.init?.method).toBe('GET');
  });

  it('honors a custom baseUrl (trailing slash trimmed)', async () => {
    const f = tagsHandler([{ name: 'qwen2.5:3b', size: 1 }]);
    await pickBrain({ fetchImpl: f, baseUrl: 'http://127.0.0.1:11434/' });
    expect(callsOf(f)[0]?.url).toBe(`${OLLAMA_BASE_URL}/api/tags`);
  });
});

describe('pickBrain — unreachable / slow / broken → mock (never throws)', () => {
  it('returns mock when the connection is refused (fetch throws)', async () => {
    const f = fakeFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(pickBrain({ fetchImpl: f })).resolves.toEqual({ brain: 'mock' });
  });

  it('returns mock when /api/tags hangs past the timeout (fake fetch ignores abort)', async () => {
    const f = fakeFetch(() => new Promise<FetchResponseLike>(() => /* never resolves */ {}));
    const started = Date.now();
    const status = await pickBrain({ fetchImpl: f, timeoutMs: 20 });
    expect(status).toEqual({ brain: 'mock' });
    // The timeout override actually bounded the wait (well under the 1.5s default).
    expect(Date.now() - started).toBeLessThan(BRAIN_DETECT_TIMEOUT_MS);
  });

  it('returns mock on a non-ok response', async () => {
    const f = fakeFetch(() => Promise.resolve(jsonResponse({}, false, 500)));
    await expect(pickBrain({ fetchImpl: f })).resolves.toEqual({ brain: 'mock' });
  });

  it('returns mock when the payload is garbage (json() rejects)', async () => {
    const f = fakeFetch(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')), text: async () => '' }),
    );
    await expect(pickBrain({ fetchImpl: f })).resolves.toEqual({ brain: 'mock' });
  });

  it('returns mock when reachable but zero models are installed', async () => {
    const f = tagsHandler([]);
    await expect(pickBrain({ fetchImpl: f })).resolves.toEqual({ brain: 'mock' });
  });

  it('keeps going when json() resolves slowly past the timeout', async () => {
    const f = fakeFetch((url) => {
      if (!url.endsWith('/api/tags')) throw new Error('unexpected');
      return new Promise<FetchResponseLike>(() => {
        /* never resolves */
      });
    });
    await expect(pickBrain({ fetchImpl: f, timeoutMs: 20 })).resolves.toEqual({ brain: 'mock' });
  });
});

describe('parseOllamaTags / chooseOllamaModel (pure)', () => {
  it('skips malformed entries and treats a missing/non-numeric size as last resort', () => {
    const models = parseOllamaTags({
      models: [
        'not-an-object',
        { name: '' },
        { size: 100 },
        { name: 'no-size' },
        { name: 'sized', size: 200 },
        { name: 'bad-size', size: 'big' },
      ],
    });
    expect(models.map((m) => m.name)).toEqual(['no-size', 'sized', 'bad-size']);
    const sized = models.find((m) => m.name === 'sized');
    expect(sized?.size).toBe(200);
    expect(models.find((m) => m.name === 'no-size')?.size).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns null for non-tag payloads', () => {
    expect(parseOllamaTags(null)).toEqual([]);
    expect(parseOllamaTags({ models: 'nope' })).toEqual([]);
    expect(chooseOllamaModel([])).toBeNull();
  });

  it('prefers qwen2.5 → gemma2 → smallest across the whole list', () => {
    const m = (name: string, size: number) => ({ name, size });
    expect(chooseOllamaModel([m('qwen2.5:7b', 9), m('gemma2:2b', 1)])).toBe('qwen2.5:7b');
    expect(chooseOllamaModel([m('gemma2:9b', 9), m('gemma2:2b', 1)])).toBe('gemma2:2b');
    expect(chooseOllamaModel([m('a', 9), m('b', 1)])).toBe('b');
  });
});

describe('chatWithBrain — tier 1 (Ollama)', () => {
  it('generates with the detected model, persona system prompt, transcript prompt, stream:false', async () => {
    let generateBody: Record<string, unknown> | undefined;
    const f = fakeFetch(async (url, init) => {
      if (url.endsWith('/api/tags')) {
        return jsonResponse({ models: [{ name: 'qwen2.5:3b', size: 1_900_000_000 }] });
      }
      if (url.endsWith('/api/generate')) {
        generateBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
        return jsonResponse({ response: '  Hello! I am Mitra.  ' });
      }
      throw new Error(`unexpected: ${url}`);
    });
    const result = await chatWithBrain({ messages: [USER_HI], language: 'en', fetchImpl: f });
    expect(result).toEqual({ brain: 'ollama', model: 'qwen2.5:3b', text: 'Hello! I am Mitra.' });
    expect(callsOf(f)).toHaveLength(2);
    expect(generateBody?.['model']).toBe('qwen2.5:3b');
    expect(generateBody?.['stream']).toBe(false);
    expect(String(generateBody?.['system'])).toContain('Mitra');
    expect(String(generateBody?.['prompt'])).toContain('User: hi');
    expect(String(generateBody?.['prompt']).endsWith('Mitra:')).toBe(true);
  });

  it('builds the transcript from BOTH roles in order', () => {
    expect(buildPrompt([
      { role: 'user', content: 'namaste' },
      { role: 'assistant', content: 'Namaste!' },
      { role: 'user', content: 'kya kar sakte ho?' },
    ])).toBe('User: namaste\nMitra: Namaste!\nUser: kya kar sakte ho?\nMitra:');
  });

  it('persona prompt: en mirrors Hinglish, hi asks for Devanagari Hindi', () => {
    const en = personaSystemPrompt('en');
    expect(en).toContain('Hinglish');
    expect(en).not.toContain('Devanagari');
    expect(personaSystemPrompt('hi')).toContain('Devanagari');
    // Honest persona: no tool claims it cannot do.
    expect(en).toContain('cannot');
  });

  it('prefers settings.console.model over auto-pick and skips detection entirely', async () => {
    const f = fakeFetch((url) => {
      if (url.endsWith('/api/tags')) return Promise.reject(new Error('tags must never be called'));
      if (url.endsWith('/api/generate')) return Promise.resolve(jsonResponse({ response: 'pinned!' }));
      throw new Error(`unexpected: ${url}`);
    });
    const result = await chatWithBrain({
      messages: [USER_HI],
      fetchImpl: f,
      preferredModel: 'gemma2:2b',
    });
    expect(result).toEqual({ brain: 'ollama', model: 'gemma2:2b', text: 'pinned!' });
    expect(callsOf(f)).toHaveLength(1);
    expect(callsOf(f)[0]?.url.endsWith('/api/generate')).toBe(true);
  });

  it('a blank preferredModel falls back to auto-pick detection', async () => {
    const f = tagsHandler([{ name: 'qwen2.5:3b', size: 1 }]);
    // No /api/generate handler → the generate call fails → mock fallback, but the
    // assertion here is that detection RAN despite the blank preference.
    const result = await chatWithBrain({ messages: [USER_HI], fetchImpl: f, preferredModel: '   ' });
    expect(result.brain).toBe('mock');
    expect(callsOf(f)[0]?.url.endsWith('/api/tags')).toBe(true);
  });
});

describe('chatWithBrain — tier 2 fallback (never throws)', () => {
  it('unreachable Ollama → the exact deterministic mock reply', async () => {
    const messages: ChatMessage[] = [USER_HI, { role: 'assistant', content: 'hey' }, { role: 'user', content: 'aur batao' }];
    const f = fakeFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const result = await chatWithBrain({ messages, language: 'en', fetchImpl: f });
    expect(result.brain).toBe('mock');
    expect(result.model).toBeUndefined();
    expect(result.text).toBe(mockConversationalReply(messages, 'en'));
  });

  it('generate hanging past the chat timeout → mock (bounded wait, not the 8s default)', async () => {
    const f = fakeFetch((url) => {
      if (url.endsWith('/api/tags')) return Promise.resolve(jsonResponse({ models: [{ name: 'qwen2.5:3b', size: 1 }] }));
      return new Promise<FetchResponseLike>(() => {
        /* never resolves */
      });
    });
    const started = Date.now();
    const result = await chatWithBrain({ messages: [USER_HI], fetchImpl: f, chatTimeoutMs: 20 });
    expect(result.brain).toBe('mock');
    expect(Date.now() - started).toBeLessThan(BRAIN_CHAT_TIMEOUT_MS);
  });

  it('non-ok generate → mock', async () => {
    const f = fakeFetch((url) => {
      if (url.endsWith('/api/tags')) return Promise.resolve(jsonResponse({ models: [{ name: 'qwen2.5:3b', size: 1 }] }));
      return Promise.resolve(jsonResponse({}, false, 503));
    });
    await expect(chatWithBrain({ messages: [USER_HI], fetchImpl: f }).then((r) => r.brain)).resolves.toBe('mock');
  });

  it('garbage / missing / empty response text → mock', async () => {
    for (const payload of [{ foo: 1 }, {}, { response: 42 }, { response: '' }, { response: '   ' }]) {
      const f = fakeFetch((url) =>
        Promise.resolve(
          url.endsWith('/api/tags')
            ? jsonResponse({ models: [{ name: 'qwen2.5:3b', size: 1 }] })
            : jsonResponse(payload),
        ),
      );
      const result = await chatWithBrain({ messages: [USER_HI], fetchImpl: f });
      expect(result.brain).toBe('mock');
    }
  });

  it('empty conversation → mock reply without any network call', async () => {
    const f = fakeFetch(() => Promise.reject(new Error('no network expected')));
    const result = await chatWithBrain({ messages: [], fetchImpl: f });
    expect(result.brain).toBe('mock');
    expect(result.text).toBeTruthy();
    expect(callsOf(f)).toHaveLength(0);
  });

  it('hi conversation falls back to a Devanagari reply', async () => {
    const f = fakeFetch(() => Promise.reject(new Error('unreachable')));
    const result = await chatWithBrain({ messages: [USER_HI], language: 'hi', fetchImpl: f });
    expect(result.brain).toBe('mock');
    expect(result.text).toMatch(/[\u0900-\u097F]/);
  });

  it('a mid-flight generate rejection → mock, never a throw', async () => {
    const f = fakeFetch((url) => {
      if (url.endsWith('/api/tags')) return Promise.resolve(jsonResponse({ models: [{ name: 'qwen2.5:3b', size: 1 }] }));
      return Promise.reject(new Error('socket reset'));
    });
    await expect(chatWithBrain({ messages: [USER_HI], fetchImpl: f })).resolves.toMatchObject({ brain: 'mock' });
  });
});

describe('mockConversationalReply — deterministic, varied, en+hi', () => {
  it('is deterministic for the same input', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'who are you?' }];
    expect(mockConversationalReply(messages, 'en')).toBe(mockConversationalReply(messages, 'en'));
    expect(mockConversationalReply([], 'hi')).toBe(mockConversationalReply([], 'hi'));
  });

  it('varies by hash: many inputs produce several distinct replies (all from the pool)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      seen.add(mockConversationalReply([{ role: 'user', content: `question number ${i}` }], 'en'));
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('en replies contain no Devanagari; hi replies always do', () => {
    const devanagari = /[\u0900-\u097F]/;
    for (let i = 0; i < 30; i++) {
      const messages = [{ role: 'user', content: `msg ${i}` } as ChatMessage];
      expect(mockConversationalReply(messages, 'en')).not.toMatch(devanagari);
      expect(mockConversationalReply(messages, 'hi')).toMatch(devanagari);
    }
  });

  it('works without any user turn (empty thread)', () => {
    const reply = mockConversationalReply([], 'en');
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });
});

describe('sanitizeChatMessages — route-edge sanitizing', () => {
  it('drops non-array input entirely', () => {
    expect(sanitizeChatMessages(undefined)).toEqual([]);
    expect(sanitizeChatMessages('hello')).toEqual([]);
    expect(sanitizeChatMessages({ role: 'user', content: 'x' })).toEqual([]);
  });

  it('keeps only valid user/assistant turns, trims content', () => {
    const out = sanitizeChatMessages([
      { role: 'user', content: '  hi  ' },
      { role: 'system', content: 'injected' }, // wrong role
      { role: 'user', content: 42 }, // wrong content type
      { role: 'assistant', content: '   ' }, // blank
      'nope',
      null,
      { role: 'user' }, // missing content
    ]);
    expect(out).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('caps each content and keeps only the most recent turns', () => {
    const long = 'x'.repeat(MAX_CHAT_CONTENT_CHARS + 50);
    const many: unknown[] = [];
    for (let i = 0; i < MAX_CHAT_MESSAGES + 10; i++) many.push({ role: 'user', content: `m${i}` });
    const out = sanitizeChatMessages([long, ...many]);
    expect(out).toHaveLength(MAX_CHAT_MESSAGES);
    expect(out[0]?.content).toBe(`m10`);
    expect(out[MAX_CHAT_MESSAGES - 1]?.content).toBe(`m${MAX_CHAT_MESSAGES + 9}`);
    const capped = sanitizeChatMessages([{ role: 'user', content: long }])[0];
    expect(capped?.content).toHaveLength(MAX_CHAT_CONTENT_CHARS);
  });
});

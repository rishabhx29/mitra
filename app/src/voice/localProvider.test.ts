import { describe, expect, it, vi } from 'vitest';
import { LocalVoiceProvider, type VoskModelLike } from './localProvider';

/** Bridge fake: captures tool/brain/model calls and answers deterministically. */
function bridgeFake(toolReply: { ok: boolean; summary: string } = { ok: true, summary: 'Added "milk"' }, chatReply?: string) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const fetchImpl = (async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.includes('/api/tools/')) {
      return { ok: true, status: 200, json: async () => toolReply } as unknown as Response;
    }
    if (url.endsWith('/api/brain/chat')) {
      return { ok: true, status: 200, json: async () => ({ brain: 'mock', text: chatReply ?? 'Sure thing.' }) } as unknown as Response;
    }
    if (url.endsWith('/api/models/download')) {
      return { ok: true, status: 200, json: async () => ({ lang: 'en-us', state: 'ready', bytes: 1, approxMb: 40 }) } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function fakeTts() {
  const spoken: string[] = [];
  return {
    spoken,
    speak: (text: string, _lang: string, onEnd: () => void) => {
      spoken.push(text);
      onEnd();
    },
    cancel: () => {},
  };
}

function modelFake() {
  const made: VoskModelLike[] = [];
  const recognizers: Array<{ fed: number; listeners: Array<(m: { result?: { text?: string } }) => void> }> = [];
  return {
    made,
    recognizers,
    createModel: async (_url: string): Promise<VoskModelLike> => {
      const listeners: Array<(m: { result?: { text?: string } }) => void> = [];
      const rec = {
        fed: 0,
        listeners,
        on(_event: 'result', cb: (m: { result?: { text?: string } }) => void): void {
          listeners.push(cb);
        },
        acceptWaveformFloat(_c: Float32Array, _rate: number): void {
          rec.fed += 1;
        },
        remove(): void {},
      };
      recognizers.push(rec);
      const model: VoskModelLike = {
        KaldiRecognizer: class {
          constructor() {
            return rec as unknown as object;
          }
        } as unknown as VoskModelLike['KaldiRecognizer'],
        terminate: () => {},
      };
      made.push(model);
      (model as unknown as { __listeners: typeof listeners }).__listeners = listeners;
      return model;
    },
  };
}

describe('LocalVoiceProvider.submitText', () => {
  it('routes an add-todo intent through the bridge tool and speaks the summary', async () => {
    const { fetchImpl, calls } = bridgeFake();
    const tts = fakeTts();
    const p = new LocalVoiceProvider({ fetchImpl, tts, fastTimers: true, getLanguage: () => 'en-us' });
    const entries: string[] = [];
    p.onTranscript((e) => entries.push(`${e.role}:${e.text}`));
    await p.submitText('add milk to my todo list');
    expect(calls.some((c) => c.url.endsWith('/api/tools/notion_add_todo'))).toBe(true);
    expect(tts.spoken.at(-1)).toBe('Added "milk"');
    expect(entries[0]).toBe('user:add milk to my todo list');
  });

  it('falls back to the brain chat route when no intent matches (decision tier tried FIRST)', async () => {
    const { fetchImpl, calls } = bridgeFake(undefined, 'Because pointers, that is why.');
    const tts = fakeTts();
    const p = new LocalVoiceProvider({ fetchImpl, tts, fastTimers: true, getLanguage: () => 'en-us' });
    await p.submitText('why is the sky blue');
    // docs/DECISION_TIER_PLAN.md §1: POST /api/brain/route runs before the chat
    // LLM; this fake 404s it (old bridge / absent sidecar) so chat still answers.
    expect(calls.some((c) => c.url.endsWith('/api/brain/route'))).toBe(true);
    const routeIdx = calls.findIndex((c) => c.url.endsWith('/api/brain/route'));
    const chatIdx = calls.findIndex((c) => c.url.endsWith('/api/brain/chat'));
    expect(routeIdx).toBeGreaterThanOrEqual(0);
    expect(chatIdx).toBeGreaterThan(routeIdx);
    expect(tts.spoken.at(-1)).toBe('Because pointers, that is why.');
  });

  it('decision tier: no intent + bridge routes to a tool → runs it instead of chat', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetchImpl = (async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.endsWith('/api/brain/route')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tool: 'youtube_search', args: { query: 'cat videos' }, confidence: 0.9, via: 'laya' }),
        } as unknown as Response;
      }
      if (url.includes('/api/tools/')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, summary: 'Searching YouTube for "cat videos"' }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const tts = fakeTts();
    const p = new LocalVoiceProvider({ fetchImpl, tts, fastTimers: true, getLanguage: () => 'en-us' });
    await p.submitText('search cat videos');
    expect(calls.some((c) => c.url.endsWith('/api/tools/youtube_search'))).toBe(true);
    expect(calls.some((c) => c.url.endsWith('/api/brain/chat'))).toBe(false);
    expect(tts.spoken.at(-1)).toBe('Searching YouTube for "cat videos"');
  });

  it('speaks the localized refusal when the tool is permission-denied', async () => {
    const { fetchImpl } = bridgeFake({ ok: false, summary: 'Permission denied: terminal' });
    const tts = fakeTts();
    const p = new LocalVoiceProvider({ fetchImpl, tts, fastTimers: true, getLanguage: () => 'en-us' });
    await p.submitText('open opencode and build me a portfolio site');
    expect(tts.spoken.at(-1)).toMatch(/terminal/i);
  });
});

describe('LocalVoiceProvider.start (injected model + mic)', () => {
  it('greets, feeds the recognizer, and submits recognized speech', async () => {
    const { fetchImpl } = bridgeFake();
    const tts = fakeTts();
    const model = modelFake();
    let streamStop = 0;
    const p = new LocalVoiceProvider({
      fetchImpl,
      tts,
      fastTimers: true,
      getLanguage: () => 'en-us',
      createModel: model.createModel,
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => { streamStop += 1; } }] }) as unknown as MediaStream,
      },
    });
    const entries: string[] = [];
    p.onTranscript((e) => entries.push(e.text));
    await p.start();

    // ONE short intro (was: a paragraph, emitted TWICE — the agent talked non-stop)
    expect(entries).toEqual(['Listening.']);
    expect(model.made.length).toBe(1);

    // simulate a recognition final → same pipeline as typed text
    const listeners = (model.made[0] as unknown as { __listeners: Array<(m: { result?: { text?: string } }) => void> }).__listeners;
    listeners[0]?.({ result: { text: 'add chai to my todo list' } });
    await new Promise((r) => setTimeout(r, 40));
    expect(entries.some((t) => t.includes('chai'))).toBe(true);

    await p.stop();
    expect(streamStop).toBeGreaterThan(0);
  });

  it('sends prior conversation turns to the brain chat (Friday-style follow-ups)', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetchImpl = (async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.includes('/api/tools/')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, summary: 'Added "chai"' }) } as unknown as Response;
      }
      if (url.endsWith('/api/brain/chat')) {
        return { ok: true, status: 200, json: async () => ({ brain: 'ollama', text: 'Sure thing, boss.' }) } as unknown as Response;
      }
      if (url.endsWith('/api/models/download')) {
        return { ok: true, status: 200, json: async () => ({ lang: 'en-us', state: 'ready', bytes: 1, approxMb: 40 }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const tts = fakeTts();
    const model = modelFake();
    const p = new LocalVoiceProvider({
      fetchImpl,
      tts,
      fastTimers: true,
      getLanguage: () => 'en-us',
      createModel: model.createModel,
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream },
    });
    await p.start();
    const listeners = model.recognizers[0]!.listeners;

    listeners[0]?.({ result: { text: 'add chai to my todo list' } });
    await new Promise((r) => setTimeout(r, 40));
    listeners[0]?.({ result: { text: 'who are you?' } });
    await new Promise((r) => setTimeout(r, 40));

    const chatCalls = calls.filter((c) => c.url.endsWith('/api/brain/chat'));
    expect(chatCalls.length).toBe(1);
    const msgs = (chatCalls[0]!.body as { messages: Array<{ role: string; content: string }> }).messages;
    // The prior tool exchange (user turn + agent summary) rides along as context.
    expect(msgs.some((m) => m.role === 'user' && m.content.includes('chai'))).toBe(true);
    expect(msgs.some((m) => m.role === 'assistant' && m.content.includes('chai'))).toBe(true);
    expect(msgs[msgs.length - 1]!.content).toBe('who are you?');
    await p.stop();
  });

  it('gates the mic while the agent speaks and resumes after (never transcribes its own voice)', async () => {
    const { fetchImpl } = bridgeFake();
    // TTS that holds the utterance open until the test releases it.
    let release: () => void = () => {};
    const tts = {
      speak: (_t: string, _l: string, onEnd: () => void) => {
        release = onEnd;
      },
      cancel: () => {},
    };
    const model = modelFake();
    const p = new LocalVoiceProvider({
      fetchImpl,
      tts,
      fastTimers: true,
      getLanguage: () => 'en-us',
      createModel: model.createModel,
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream,
      },
    });
    await p.start();
    const rec = model.recognizers[0]!;
    p.feedAudio(new Float32Array(64), 16000);
    const fedListening = rec.fed;
    expect(fedListening).toBeGreaterThan(0); // listening: audio flows

    // Trigger a reply; the TTS stays open => still speaking.
    const run = p.submitText('add chai to my todo list');
    await new Promise((r) => setTimeout(r, 30));
    p.feedAudio(new Float32Array(64), 16000);
    expect(rec.fed).toBe(fedListening); // GATED — our own TTS can never re-enter

    release(); // TTS ends
    await run;
    await new Promise((r) => setTimeout(r, 20)); // post-speech cooldown (5ms fast)
    p.feedAudio(new Float32Array(64), 16000);
    expect(rec.fed).toBe(fedListening + 1); // resumed for the user
    await p.stop();
  });

  it('ignores single noise-word recognitions — room noise must not trigger replies', async () => {
    const { fetchImpl } = bridgeFake();
    const tts = fakeTts();
    const model = modelFake();
    const p = new LocalVoiceProvider({
      fetchImpl,
      tts,
      fastTimers: true,
      getLanguage: () => 'en-us',
      createModel: model.createModel,
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream },
    });
    const entries: string[] = [];
    p.onTranscript((e) => entries.push(e.text));
    await p.start();
    const listeners = model.recognizers[0]!.listeners;
    listeners[0]?.({ result: { text: 'the' } });
    listeners[0]?.({ result: { text: 'hmm' } });
    listeners[0]?.({ result: { text: 'a' } });
    await new Promise((r) => setTimeout(r, 30));
    // nothing but the intro so far — no replies to noise
    expect(entries).toEqual(['Listening.']);
    listeners[0]?.({ result: { text: 'add chai to my todo list' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(entries.some((x) => x.includes('chai'))).toBe(true);
    await p.stop();
  });

  it('throws model-unavailable when the model download fails (never silently)', async () => {
    const failFetch = (async () => ({ ok: false, status: 400, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const p = new LocalVoiceProvider({ fetchImpl: failFetch, tts: fakeTts(), fastTimers: true, getLanguage: () => 'hi' });
    await expect(p.start()).rejects.toThrow('model-unavailable');
  });
});

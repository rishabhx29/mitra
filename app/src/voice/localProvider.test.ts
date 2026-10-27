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
  return {
    made,
    createModel: async (_url: string): Promise<VoskModelLike> => {
      const listeners: Array<(m: { result?: { text?: string } }) => void> = [];
      const model: VoskModelLike = {
        KaldiRecognizer: class {
          on(_event: 'result', cb: (m: { result?: { text?: string } }) => void): void {
            listeners.push(cb);
          }
          acceptWaveformFloat(_c: Float32Array, _rate: number): void {}
          remove(): void {}
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

  it('falls back to the brain chat route when no intent matches', async () => {
    const { fetchImpl, calls } = bridgeFake(undefined, 'Because pointers, that is why.');
    const tts = fakeTts();
    const p = new LocalVoiceProvider({ fetchImpl, tts, fastTimers: true, getLanguage: () => 'en-us' });
    await p.submitText('why is the sky blue');
    expect(calls.some((c) => c.url.endsWith('/api/brain/chat'))).toBe(true);
    expect(tts.spoken.at(-1)).toBe('Because pointers, that is why.');
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

    // greeting emitted (voice.greeting key), recognizer created from the bridge URL
    expect(entries[0]).toContain('Mitra');
    expect(model.made.length).toBe(1);

    // simulate a recognition final → same pipeline as typed text
    const listeners = (model.made[0] as unknown as { __listeners: Array<(m: { result?: { text?: string } }) => void> }).__listeners;
    listeners[0]?.({ result: { text: 'add chai to my todo list' } });
    await new Promise((r) => setTimeout(r, 40));
    expect(entries.some((t) => t.includes('chai'))).toBe(true);

    await p.stop();
    expect(streamStop).toBeGreaterThan(0);
  });

  it('throws model-unavailable when the model download fails (never silently)', async () => {
    const failFetch = (async () => ({ ok: false, status: 400, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const p = new LocalVoiceProvider({ fetchImpl: failFetch, tts: fakeTts(), fastTimers: true, getLanguage: () => 'hi' });
    await expect(p.start()).rejects.toThrow('model-unavailable');
  });
});

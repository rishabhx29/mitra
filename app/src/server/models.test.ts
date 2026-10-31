import { describe, expect, it } from 'vitest';
import { createModelStore, type FetchLike, type ModelFs } from './models';
import { VOICE_LANGUAGES, findVoiceLanguage } from '../shared/voiceLanguages';

function fakeFs(seed: Record<string, Buffer> = {}): ModelFs & { files: Map<string, Buffer> } {
  const norm = (p: string): string => p.split(String.fromCharCode(92)).join('/');
  const files = new Map<string, Buffer>(Object.entries(seed).map(([k, v]) => [norm(k), v]));
  return {
    files,
    existsSync: (p) => files.has(norm(p)),
    mkdirSync: () => {},
    readFileSync: (p) => {
      const b = files.get(norm(p));
      if (!b) throw new Error('ENOENT');
      return b;
    },
    writeFileSync: (p, d) => files.set(norm(p), d),
    statSync: (p) => ({ size: (files.get(norm(p)) as Buffer).byteLength }),
    unlinkSync: (p) => files.delete(norm(p)),
  };
}

const okFetch = (bytes: number): FetchLike => async () => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new ArrayBuffer(bytes),
});

describe('voiceLanguages map', () => {
  it('has unique ids and https model urls', () => {
    const ids = VOICE_LANGUAGES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of VOICE_LANGUAGES) {
      expect(l.modelUrl.startsWith('https://alphacephei.com/vosk/models/')).toBe(true);
      expect(l.ttsLang).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/i);
    }
  });
  it('covers the headline languages', () => {
    for (const id of ['en-us', 'en-in', 'hi', 'gu', 'te']) {
      expect(VOICE_LANGUAGES.some((l) => l.id === id)).toBe(true);
    }
  });
  it('falls back to the default for unknown ids', () => {
    expect(findVoiceLanguage(undefined).id).toBe('en-in');
    expect(findVoiceLanguage('klingon').id).toBe('en-in');
  });
});

describe('createModelStore', () => {
  it('downloads once → ready; ensure is idempotent and reuses the file', async () => {
    const fs = fakeFs();
    const store = createModelStore({ dir: '/ud/models', fs, fetchImpl: okFetch(1000) });
    expect(store.status('hi').state).toBe('none');
    const first = await store.ensure('hi');
    expect(first.state).toBe('ready');
    expect(first.bytes).toBe(1000);
    // Second ensure must not re-download (fetch would throw).
    const second = await store.ensure('hi');
    expect(second.state).toBe('ready');
  });

  it('reports error when the download fails and there is no prior file', async () => {
    const fs = fakeFs();
    const failing: FetchLike = async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) });
    const store = createModelStore({ dir: '/ud/models', fs, fetchImpl: failing });
    const status = await store.ensure('hi');
    expect(status.state).toBe('error');
    // A previously ready file survives a failed refresh.
    await createModelStore({ dir: '/ud/models', fs, fetchImpl: okFetch(5) }).ensure('hi');
    const retry = await store.ensure('hi');
    expect(retry.state).toBe('ready');
  });

  it('serves zip bytes only for allowlisted languages', () => {
    const fs = fakeFs({ '/ud/models/hi.zip': Buffer.from('zipbytes') });
    const store = createModelStore({ dir: '/ud/models', fs, fetchImpl: okFetch(1) });
    expect(store.read('hi')?.toString()).toBe('zipbytes');
    expect(store.read('../etc/passwd')).toBeNull();
    expect(store.read('en-us')).toBeNull();
  });
});

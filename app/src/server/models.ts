// Offline STT model store: downloads Vosk small-model zips once into
// <userData>/models/<id>.zip and serves them to the renderer's vosk-browser
// WASM worker over the local bridge (fetch on file:// renderer origins is
// blocked; http://127.0.0.1:<port> with our CORS policy works everywhere).
// All FS + fetch is injected for vitest.
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VOICE_LANGUAGES, findVoiceLanguage } from '../shared/voiceLanguages';

export interface ModelFs {
  existsSync(path: string): boolean;
  mkdirSync(path: string, opts: { recursive: true }): void;
  readFileSync(path: string): Buffer;
  writeFileSync(path: string, data: Buffer): void;
  statSync(path: string): { size: number };
  unlinkSync(path: string): void;
}

export const defaultModelFs: ModelFs = {
  existsSync,
  mkdirSync,
  readFileSync: (p) => readFileSync(p),
  writeFileSync: (p, d) => writeFileSync(p, d),
  statSync: (p) => statSync(p),
  unlinkSync,
};

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export type ModelState = 'none' | 'downloading' | 'ready' | 'error';

export interface ModelStatus {
  lang: string;
  state: ModelState;
  /** Bytes on disk when ready; received bytes while downloading. */
  bytes: number;
  approxMb: number;
}

export interface ModelStore {
  status(lang: string): ModelStatus;
  statusAll(): ModelStatus[];
  /** Kicks off (or no-ops) a download; resolves when settled. Never rejects. */
  ensure(lang: string): Promise<ModelStatus>;
  /** Zip bytes for the bridge static route; null when not ready. */
  read(lang: string): Buffer | null;
}

export function createModelStore(deps: {
  dir: string;
  fs?: ModelFs;
  fetchImpl?: FetchLike;
  log?: (msg: string) => void;
  onProgress?: (s: ModelStatus) => void;
}): ModelStore {
  const fs = deps.fs ?? defaultModelFs;
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const log = deps.log ?? (() => {});
  const inflight = new Map<string, Promise<ModelStatus>>();

  const fileFor = (lang: string): string => join(deps.dir, `${lang}.zip`);
  const langOk = (lang: string): boolean => VOICE_LANGUAGES.some((l) => l.id === lang);

  const snapshot = (lang: string): ModelStatus => {
    const approx = findVoiceLanguage(lang).approxMb;
    try {
      if (fs.existsSync(fileFor(lang))) {
        return { lang, state: 'ready', bytes: fs.statSync(fileFor(lang)).size, approxMb: approx };
      }
    } catch {
      /* unreadable → treat as absent */
    }
    return { lang, state: 'none', bytes: 0, approxMb: approx };
  };

  const download = async (lang: string): Promise<ModelStatus> => {
    const meta = findVoiceLanguage(lang);
    const dest = fileFor(lang);
    const tmp = `${dest}.part`;
    try {
      fs.mkdirSync(deps.dir, { recursive: true });
      log(`downloading STT model ${lang} (~${meta.approxMb}MB)`);
      const res = await fetchImpl(meta.modelUrl);
      if (!res.ok) throw new Error(`model server responded ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(tmp, buf);
      // Write-then-rename keeps a crashed download from masquerading as ready.
      fs.writeFileSync(dest, fs.readFileSync(tmp));
      try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
      log(`STT model ${lang} ready (${Math.round(buf.byteLength / 1e6)}MB)`);
      deps.onProgress?.(snapshot(lang));
      return snapshot(lang);
    } catch (error) {
      log(`STT model ${lang} download failed: ${String(error)}`);
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort */ }
      // A previously-ready file still wins over a failed refresh.
      const snap = snapshot(lang);
      return snap.state === 'ready' ? snap : { ...snap, state: 'error' };
    }
  };

  return {
    status(lang) {
      if (!langOk(lang)) return { lang, state: 'none', bytes: 0, approxMb: 0 };
      return inflight.has(lang) ? { ...snapshot(lang), state: 'downloading' } : snapshot(lang);
    },
    statusAll() {
      return VOICE_LANGUAGES.map((l) => this.status(l.id));
    },
    ensure(lang) {
      if (!langOk(lang)) return Promise.resolve({ lang, state: 'error' as ModelState, bytes: 0, approxMb: 0 });
      const snap = snapshot(lang);
      if (snap.state === 'ready') return Promise.resolve(snap);
      const existing = inflight.get(lang);
      if (existing) return existing;
      const run = download(lang).finally(() => inflight.delete(lang));
      inflight.set(lang, run);
      return run;
    },
    read(lang) {
      if (!langOk(lang)) return null;
      try {
        return fs.readFileSync(fileFor(lang));
      } catch {
        return null;
      }
    },
  };
}

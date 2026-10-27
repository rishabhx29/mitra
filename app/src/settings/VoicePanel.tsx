// VoicePanel — offline voice settings: STT language (Vosk models, 14 langs),
// on-demand model download with status, OS TTS test button, and which brain
// tier is live (bolna keys → local voice → mock). Free forever: everything
// runs on-device once the one-time model zip is downloaded.
import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '../shared/types';
import { VOICE_LANGUAGES, findVoiceLanguage } from '../shared/voiceLanguages';
import { Badge, Btn, Card, Tt } from './ui';
import type { SaveFn } from './types';

const BRIDGE_BASE = 'http://127.0.0.1:8765';

interface ModelState {
  lang: string;
  state: 'none' | 'downloading' | 'ready' | 'error';
  bytes: number;
  approxMb: number;
}

export default function VoicePanel({
  settings,
  tt,
  save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  const [status, setStatus] = useState<ModelState | null>(null);
  const [busy, setBusy] = useState(false);
  const [testSpoken, setTestSpoken] = useState(false);
  // Optional Laya decision tier (docs/DECISION_TIER_PLAN.md §1): one badge line.
  const [layaAvailable, setLayaAvailable] = useState<boolean | null>(null);
  const selected = findVoiceLanguage(settings.voiceLanguage);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${BRIDGE_BASE}/api/models/status/${selected.id}`);
      if (res.ok) setStatus((await res.json()) as ModelState);
    } catch {
      setStatus(null);
    }
  }, [selected.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    fetch(`${BRIDGE_BASE}/api/brain/laya`, { signal: AbortSignal.timeout(1500) })
      .then((res) => (res.ok ? (res.json() as Promise<{ available?: boolean }>) : null))
      .then((body) => {
        if (alive) setLayaAvailable(body?.available === true);
      })
      .catch(() => {
        if (alive) setLayaAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const download = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${BRIDGE_BASE}/api/models/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: selected.id }),
      });
      if (res.ok) setStatus((await res.json()) as ModelState);
    } catch {
      /* status stays whatever the last refresh saw */
    } finally {
      setBusy(false);
    }
  };

  const testVoice = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    setTestSpoken(true);
    window.setTimeout(() => setTestSpoken(false), 2500);
    const utter = new SpeechSynthesisUtterance(tt('settings.voice.sampleLine'));
    utter.lang = selected.ttsLang;
    const voices = synth.getVoices();
    const voice =
      voices.find((v) => v.lang.toLowerCase() === selected.ttsLang.toLowerCase()) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(selected.ttsLang.split('-')[0].toLowerCase()));
    if (voice) utter.voice = voice;
    synth.speak(utter);
  };

  const stateBadge = () => {
    if (!status) return <Badge tone="muted">{tt('settings.voice.stateUnknown')}</Badge>;
    if (status.state === 'ready') return <Badge tone="accent">{tt('settings.voice.stateReady')}</Badge>;
    if (status.state === 'downloading') return <Badge tone="muted">{tt('settings.voice.stateDownloading')}</Badge>;
    if (status.state === 'error') return <Badge tone="muted">{tt('settings.voice.stateError')}</Badge>;
    return <Badge tone="muted">{tt('settings.voice.stateNone')}</Badge>;
  };

  return (
    <div className="stagger space-y-4">
      <Card micro={tt('settings.micro.voice')} title={tt('settings.voice.title')}>
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">{tt('settings.voice.blurb')}</p>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">
              {tt('settings.voice.language')}
            </span>
            <select
              data-testid="voice-language-select"
              value={selected.id}
              onChange={(e) => {
                save({ voiceLanguage: e.target.value });
                setStatus(null);
              }}
              className="input-glass w-full rounded-xl px-3 py-2 text-sm text-zinc-100"
            >
              {VOICE_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id} className="bg-zinc-900">
                  {l.label} · {l.native} (~{l.approxMb}MB)
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            {stateBadge()}
            <Badge tone={layaAvailable ? 'accent' : 'muted'}>
              {tt(layaAvailable ? 'settings.voice.layaOn' : 'settings.voice.layaOff')}
            </Badge>
            <span className="text-[11px] text-zinc-500">
              {status?.state === 'ready'
                ? `${Math.round(status.bytes / 1e6)}MB · ${tt('settings.voice.onDevice')}`
                : tt('settings.voice.needsDownload').replace('{mb}', String(selected.approxMb))}
            </span>
          </div>

          <div className="flex gap-2">
            <Btn variant="primary" disabled={busy || status?.state === 'ready'} onClick={() => void download()}>
              <span data-testid="voice-download">
                {status?.state === 'ready' ? tt('settings.voice.downloaded') : tt('settings.voice.download')}
              </span>
            </Btn>
            <Btn variant="ghost" onClick={testVoice}>
              {tt('settings.voice.test')}
            </Btn>
          </div>
          {testSpoken && <p className="text-[11px] text-zinc-500">{tt('settings.voice.speaking')}</p>}
        </div>
      </Card>
    </div>
  );
}

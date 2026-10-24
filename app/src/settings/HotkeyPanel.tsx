// HotkeyPanel (Task E): recorder + validator for the global toggle hotkey.
// Recording captures the next keydown (capture phase, default prevented), maps
// it to an Electron accelerator via accel.ts, validates it (empty / modifier-
// only / no-modifier / Windows system combos), and saves via setSettings —
// the main process re-registers the shortcut on change (electron/ipc.ts).

import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../shared/types';
import {
  HOTKEY_SUGGESTIONS,
  detectPlatform,
  eventToAccelerator,
  validateAccelerator,
} from './accel';
import { Badge, Btn, Card, Kbd, Tt } from './ui';
import type { SaveFn } from './types';

export default function HotkeyPanel({
  settings,
  tt,
  save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const platform = detectPlatform();

  const value = draft ?? settings.hotkey;
  const verdict = validateAccelerator(value, platform);
  const dirty = draft !== null && draft !== settings.hotkey;
  const canSave = dirty && verdict.ok;

  // Capture the next keydown while recording (capture phase so nothing else
  // acts on it; Escape cancels, modifier-only presses keep listening).
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setRecording(false);
        setHint(null);
        return;
      }
      const accel = eventToAccelerator(e, platform);
      if (accel === null) {
        setHint(tt('settings.hotkey.modifierOnly'));
        return;
      }
      setDraft(accel);
      setHint(null);
      setRecording(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // tt is stable enough per render; platform per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, platform]);

  const accelFor = (accel: string): string[] => accel.split('+').filter(Boolean);

  return (
    <div className="space-y-4">
      <Card title={tt('settings.hotkey')} help={tt('settings.hotkey.saveHint')}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-zinc-400">{tt('settings.hotkey.current')}</span>
          <span className="flex items-center gap-1">
            {accelFor(value).map((part, i) => (
              <Kbd key={`${part}-${i}`}>{part}</Kbd>
            ))}
          </span>
          {verdict.ok ? (
            dirty && <Badge tone="accent">{tt('settings.apps.dirtyHint')}</Badge>
          ) : (
            <Badge tone="muted">{tt('settings.hotkey.invalid')}</Badge>
          )}
          <span className="ml-auto">
            {recording ? (
              <Badge tone="accent">{tt('settings.hotkey.recording')}</Badge>
            ) : (
              <Btn onClick={() => setRecording(true)}>{tt('settings.hotkey.record')}</Btn>
            )}
          </span>
        </div>

        {hint && <p className="mt-3 text-xs text-amber-300">{hint}</p>}
        {!verdict.ok && !recording && (
          <p className="mt-3 text-xs text-amber-300">
            {tt(verdict.reason ?? 'settings.hotkey.invalid')}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-4">
          <span className="text-xs text-zinc-400">{tt('settings.hotkey.suggestions')}</span>
          {HOTKEY_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setDraft(s);
                setHint(null);
                setRecording(false);
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-sky-500/60 hover:text-sky-300"
            >
              {s}
            </button>
          ))}
          <span className="ml-auto">
            <Btn
              variant="primary"
              disabled={!canSave}
              onClick={() => {
                if (!canSave || draft === null) return;
                save({ hotkey: draft });
                setDraft(null);
              }}
            >
              {tt('btn.save')}
            </Btn>
          </span>
        </div>
      </Card>
    </div>
  );
}

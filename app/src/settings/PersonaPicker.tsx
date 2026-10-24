// PersonaPicker (Task E): orb vs avatar radio cards.
// - orb: two color pickers (Settings.orbColors.a/b) with a live CSS-gradient mini
//   preview — a plain radial gradient approximates the orb well, avoids mounting a
//   second WebGL canvas in the settings window, and updates live while dragging.
// - avatar: .vrm file input (object URL preview-only — persistence of the chosen
//   path is not in the frozen Settings contract) + embedded license fields parsed
//   from the GLB meta via settings/vrmMeta.ts → persona/avatar/licenseMeta.ts.

import { useEffect, useRef, useState } from 'react';
import type { PersonaKind, Settings } from '../shared/types';
import { PersonaStage } from '../persona/PersonaStage';
import type { VrmLicenseInfo } from '../persona/avatar/licenseMeta';
import { readVrmLicense } from './vrmMeta';
import { Badge, Card, RadioCard, Tt } from './ui';
import type { SaveFn } from './types';

const SAVE_DEBOUNCE_MS = 250;

export default function PersonaPicker({
  settings,
  tt,
  save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  return (
    <div className="space-y-4">
      <KindCards settings={settings} tt={tt} save={save} />
      {settings.persona === 'orb' ? (
        <OrbSection settings={settings} tt={tt} save={save} />
      ) : (
        <AvatarSection tt={tt} />
      )}
    </div>
  );
}

function KindCards({
  settings,
  tt,
  save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  const kinds: PersonaKind[] = ['orb', 'avatar'];
  return (
    <Card title={tt('settings.persona')}>
      <div className="flex gap-3" role="radiogroup" aria-label={tt('settings.persona')}>
        {kinds.map((kind) => (
          <RadioCard
            key={kind}
            selected={settings.persona === kind}
            onClick={() => save({ persona: kind })}
            title={tt(kind === 'orb' ? 'settings.persona.orb' : 'settings.persona.avatar')}
            desc={tt(kind === 'orb' ? 'settings.persona.orbDesc' : 'settings.persona.avatarDesc')}
            visual={
              kind === 'orb' ? (
                <span
                  className="h-10 w-10 rounded-full"
                  style={{
                    background: `radial-gradient(circle at 32% 28%, ${settings.orbColors.a}, ${settings.orbColors.b} 75%)`,
                    boxShadow: `0 0 18px ${settings.orbColors.b}80`,
                  }}
                />
              ) : (
                <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" strokeLinecap="round" />
                </svg>
              )
            }
          />
        ))}
      </div>
    </Card>
  );
}

function OrbSection({ settings, tt, save }: { settings: Settings; tt: Tt; save: SaveFn }) {
  // Local mirror so the swatch + preview track the color input 1:1 while the
  // debounced IPC save catches up (type=color fires `input` continuously).
  const [colors, setColors] = useState(settings.orbColors);
  const timer = useRef<number | null>(null);

  useEffect(() => setColors(settings.orbColors), [settings.orbColors]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const onColor = (which: 'a' | 'b', value: string) => {
    const next = { ...colors, [which]: value };
    setColors(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save({ orbColors: next }), SAVE_DEBOUNCE_MS);
  };

  return (
    <Card title={tt('settings.colors')}>
      <div className="flex items-start gap-6">
        <div className="space-y-3">
          {(['a', 'b'] as const).map((which) => (
            <label key={which} className="flex items-center gap-3 text-xs text-zinc-300">
              {tt(which === 'a' ? 'settings.persona.colorA' : 'settings.persona.colorB')}
              <input
                type="color"
                value={colors[which]}
                onChange={(e) => onColor(which, e.target.value)}
                className="h-8 w-12 cursor-pointer rounded-md border border-zinc-700 bg-transparent"
                aria-label={tt('settings.colors') + ' ' + which.toUpperCase()}
              />
              <code className="font-mono text-[11px] text-zinc-500">{colors[which]}</code>
            </label>
          ))}
        </div>
        <div className="flex flex-1 flex-col items-center gap-2">
          <div className="flex h-36 w-36 items-center justify-center rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-black">
            <div
              className="h-24 w-24 animate-pulse rounded-full"
              style={{
                background: `radial-gradient(circle at 32% 28%, ${colors.a} 0%, ${colors.b} 72%)`,
                boxShadow: `0 0 40px ${colors.b}66, 0 0 96px ${colors.a}33`,
              }}
            />
          </div>
          <span className="text-[11px] text-zinc-500">{tt('settings.persona.preview')}</span>
        </div>
      </div>
    </Card>
  );
}

function AvatarSection({ tt }: { tt: Tt }) {
  const [vrmUrl, setVrmUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [license, setLicense] = useState<VrmLicenseInfo | null>(null);
  const [readingLicense, setReadingLicense] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  // Revoke the previous object URL whenever it is replaced or on unmount.
  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  // Parse the embedded license out of the chosen file (degrades to null).
  useEffect(() => {
    if (!vrmUrl) {
      setLicense(null);
      return;
    }
    let cancelled = false;
    setReadingLicense(true);
    void readVrmLicense(vrmUrl).then((info) => {
      if (cancelled) return;
      setLicense(info);
      setReadingLicense(false);
    });
    return () => {
      cancelled = true;
    };
  }, [vrmUrl]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVrmUrl(url);
    setFileName(file.name);
  };

  const unload = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setVrmUrl(null);
    setFileName(null);
  };

  return (
    <Card title={tt('settings.persona.avatar')}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700">
            {tt('settings.persona.vrmFile')}
            <input
              type="file"
              accept=".vrm,model/gltf-binary"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {fileName && (
            <>
              <span className="truncate text-xs text-zinc-400">
                {tt('settings.persona.vrmLoaded')}: {fileName}
              </span>
              <button onClick={unload} className="text-xs text-zinc-500 underline hover:text-zinc-300">
                {tt('settings.persona.vrmUnload')}
              </button>
            </>
          )}
        </div>

        <div className="relative h-56 overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-black">
          {vrmUrl ? (
            <PersonaStage persona="avatar" state="idle" vrmUrl={vrmUrl} licenseVisible={false} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="px-6 text-center text-xs text-zinc-500">{tt('settings.persona.vrmFile')}</p>
            </div>
          )}
        </div>
        {fileName && <p className="text-[11px] text-zinc-500">{tt('settings.persona.vrmPreviewOnly')}</p>}

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">{tt('settings.persona.license')}</span>
            {readingLicense ? (
              <Badge tone="muted">{tt('settings.persona.licenseReading')}</Badge>
            ) : license ? (
              <Badge tone="accent">{license.licenseLabel}</Badge>
            ) : null}
          </div>
          {readingLicense ? null : license ? (
            <div className="space-y-0.5 text-[11px] leading-snug text-zinc-400">
              <div className="text-xs font-medium text-zinc-200">
                {license.title || 'Unnamed model'}
                {license.version ? ` · v${license.version}` : ''}
              </div>
              {license.authors.length > 0 && <div>By {license.authors.join(', ')}</div>}
              {license.copyright && <div>{license.copyright}</div>}
              {license.licenseUrl && (
                <a href={license.licenseUrl} target="_blank" rel="noreferrer" className="text-sky-400 underline">
                  {license.licenseUrl}
                </a>
              )}
              {license.usageNotes.length > 0 && <div>{license.usageNotes.join(' · ')}</div>}
            </div>
          ) : (
            vrmUrl && <div className="text-[11px] text-zinc-500">{tt('settings.persona.licenseNone')}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

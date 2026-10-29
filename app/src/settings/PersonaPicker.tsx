// PersonaPicker (Task E): orb vs avatar radio cards.
// - orb: two color pickers (Settings.orbColors.a/b) with a live CSS-gradient mini
//   preview — a plain radial gradient approximates the orb well, avoids mounting a
//   second WebGL canvas in the settings window, and updates live while dragging.
// - avatar: .vrm upload (accept=".vrm" only — the MIME token grays models out in
//   Windows dialogs) with extension validation, drag-and-drop, and persistence via
//   mitra:set-avatar-file: main copies the file into <userData>/avatars/current.vrm,
//   stores Settings.avatarVrmPath, and returns the bytes for the object-URL preview.
//   Startup/section-open re-invokes the same channel with the stored path to restore
//   the preview. Embedded license fields are parsed from the GLB meta via
//   settings/vrmMeta.ts → persona/avatar/licenseMeta.ts.

import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { PersonaKind, Settings } from '../shared/types';
import { PersonaStage } from '../persona/PersonaStage';
import type { VrmLicenseInfo } from '../persona/avatar/licenseMeta';
import { baseName, isValidVrmFileName, readVrmLicense } from './vrmMeta';
import { getMitra } from './mitraClient';
import { useAvatarModelUrl } from './useAvatarModelUrl';
import { SAMPLE_AVATARS } from '../shared/ipc';
import { Badge, Btn, Card, RadioCard, Tt } from './ui';
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
    <div className="stagger space-y-4">
      <KindCards settings={settings} tt={tt} save={save} />
      {settings.persona === 'orb' ? (
        <OrbSection settings={settings} tt={tt} save={save} />
      ) : (
        <AvatarSection settings={settings} tt={tt} save={save} />
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
  // Live mini-render of the loaded avatar (first visit auto-loads the bundled
  // sample) so the card shows a real character, not just an icon.
  const avatarThumbUrl = useAvatarModelUrl(settings);
  return (
    <Card micro={tt('settings.micro.persona')} title={tt('settings.persona')}>
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
                avatarThumbUrl ? (
                  <div
                    data-testid="avatar-thumb"
                    className="h-12 w-12 overflow-hidden rounded-xl border border-white/10 bg-black/40"
                    aria-label={tt('settings.persona.avatarThumb')}
                  >
                    <PersonaStage persona="avatar" state="idle" vrmUrl={avatarThumbUrl} licenseVisible={false} />
                  </div>
                ) : (
                  <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" strokeLinecap="round" />
                  </svg>
                )
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
    <Card micro={tt('settings.micro.persona')} title={tt('settings.colors')}>
      <div className="flex items-start gap-6">
        <div className="space-y-3">
          {(['a', 'b'] as const).map((which) => (
            <label key={which} className="flex items-center gap-3 text-xs text-zinc-300">
              {tt(which === 'a' ? 'settings.persona.colorA' : 'settings.persona.colorB')}
              <input
                type="color"
                value={colors[which]}
                onChange={(e) => onColor(which, e.target.value)}
                className="focus-orb h-8 w-12 cursor-pointer rounded-md border border-white/10 bg-transparent"
                aria-label={tt('settings.colors') + ' ' + which.toUpperCase()}
              />
              <code className="font-mono text-[11px] text-zinc-500">{colors[which]}</code>
            </label>
          ))}
        </div>
        <div className="flex flex-1 flex-col items-center gap-2">
          <div className="flex h-36 w-36 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
            <div
              className="orb-pulse h-24 w-24 rounded-full"
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

function AvatarSection({
  settings,
  tt,
  save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  const [vrmUrl, setVrmUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [license, setLicense] = useState<VrmLicenseInfo | null>(null);
  const [readingLicense, setReadingLicense] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The stored path currently backing vrmUrl — lets the restore effect skip a
  // reload once the settings prop catches up to what we already preview.
  const loadedPathRef = useRef<string | null>(null);

  // Revoke the previous object URL whenever it is replaced or on unmount.
  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  // Parse the embedded license out of the shown model (degrades to null).
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

  // Restore the persisted avatar when the section opens / the stored path changes:
  // re-invoke the copy IPC with the stored path (idempotent — same source and
  // destination) and preview the returned bytes. A missing file clears the stale
  // setting (main reports 'source-missing') instead of erroring on every launch.
  useEffect(() => {
    const stored = settings.avatarVrmPath;
    const mitra = getMitra();
    if (!stored || !mitra || loadedPathRef.current === stored) return;
    let cancelled = false;
    setBusy(true);
    mitra
      .setAvatarFile({ kind: 'pick', sourcePath: stored })
      .then((res) => {
        if (cancelled) return;
        setBusy(false);
        if (res.ok) {
          applyPreview(res.bytes, baseName(res.path), res.path);
        } else if (res.error === 'source-missing') {
          save({ avatarVrmPath: '' }); // '' is dropped by sanitizeSettings → cleared
          setErrorKey('settings.persona.vrmMissing');
        } else {
          setErrorKey('settings.persona.vrmCopyFailed');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setBusy(false);
        setErrorKey('settings.persona.vrmCopyFailed');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyPreview is stable over refs
  }, [settings.avatarVrmPath, save]);

  /** Swap the preview to a fresh blob URL built from bytes main copied for us. */
  const applyPreview = (bytes: ArrayBuffer, name: string, storedPath: string) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
    objectUrlRef.current = url;
    loadedPathRef.current = storedPath;
    setVrmUrl(url);
    setFileName(name);
    setErrorKey(null);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    // Client-side gate matching accept=".vrm" (extension only — no MIME).
    if (!isValidVrmFileName(file.name)) {
      setErrorKey('settings.persona.vrmInvalid');
      return;
    }
    const mitra = getMitra();
    if (!mitra) {
      // Plain-browser preview (window.mitra absent): preview-only, like the old UI.
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      loadedPathRef.current = null;
      setVrmUrl(url);
      setFileName(file.name);
      setErrorKey(null);
      return;
    }
    setErrorKey(null);
    setBusy(true);
    void mitra
      .setAvatarFile({ kind: 'pick', sourcePath: mitra.getPathForFile(file) })
      .then((res) => {
        setBusy(false);
        if (res.ok) {
          applyPreview(res.bytes, file.name, res.path);
          // Main already persisted the path; route through save() to sync App
          // state (and the status.saved toast) via the normal settings flow.
          save({ avatarVrmPath: res.path });
        } else {
          setErrorKey(
            res.error === 'invalid-extension'
              ? 'settings.persona.vrmInvalid'
              : 'settings.persona.vrmCopyFailed',
          );
        }
      })
      .catch(() => {
        setBusy(false);
        setErrorKey('settings.persona.vrmCopyFailed');
      });
  };

  const useSample = (sample: (typeof SAMPLE_AVATARS)[number]) => {
    const mitra = getMitra();
    if (!mitra || busy) return;
    setErrorKey(null);
    setBusy(true);
    void mitra
      .setAvatarFile({ kind: 'sample', name: sample.file })
      .then((res) => {
        setBusy(false);
        if (res.ok) {
          applyPreview(res.bytes, sample.file, res.path);
          save({ avatarVrmPath: res.path });
        } else {
          setErrorKey(res.error === 'source-missing' ? 'settings.persona.vrmSampleMissing' : 'settings.persona.vrmCopyFailed');
        }
      })
      .catch(() => {
        setBusy(false);
        setErrorKey('settings.persona.vrmCopyFailed');
      });
  };

  const unload = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    loadedPathRef.current = null;
    setVrmUrl(null);
    setFileName(null);
    setErrorKey(null);
    save({ avatarVrmPath: '' }); // '' is dropped by sanitizeSettings → cleared
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    onFile(e.dataTransfer?.files?.[0]);
  };

  return (
    <Card micro={tt('settings.micro.persona')} title={tt('settings.persona.avatar')}>
      <div className="space-y-3">
        {/* Drop zone + preview: accepts a dragged .vrm whether empty or loaded.
            Hover/active highlight is color-only — respects prefers-reduced-motion. */}
        <div
          data-testid="avatar-dropzone"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`relative h-64 overflow-hidden rounded-2xl border-2 border-dashed transition-colors duration-150 ${
            dragging
              ? 'dropzone-drag'
              : vrmUrl
                ? 'border-white/[0.12] bg-white/[0.03]'
                : 'border-white/[0.14] bg-white/[0.02] hover:border-white/25'
          }`}
        >
          {vrmUrl ? (
            <PersonaStage persona="avatar" state="idle" vrmUrl={vrmUrl} licenseVisible={false} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-500" aria-hidden="true">
                <path d="M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" />
              </svg>
              <p className="text-sm font-medium text-zinc-200">{tt('settings.persona.vrmDropTitle')}</p>
              <p className="max-w-xs text-[11px] leading-snug text-zinc-500">{tt('settings.persona.vrmDropHint')}</p>
              <div className="mt-2 flex items-center gap-2">
                <Btn variant="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
                  <span data-testid="avatar-browse">{tt('settings.persona.vrmBrowse')}</span>
                </Btn>
              </div>
              {/* Bundled samples: one-click chips (provenance in assets/avatars/ATTRIBUTION.md) */}
              <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5" data-testid="avatar-samples">
                {SAMPLE_AVATARS.map((s) => (
                  <button
                    key={s.file}
                    type="button"
                    disabled={busy}
                    onClick={() => useSample(s)}
                    data-testid={`avatar-sample-${s.file}`}
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-white/25 hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {dragging && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium"
              style={{
                background: 'color-mix(in oklab, var(--accent) 12%, transparent)',
                color: 'var(--accent-2)',
              }}
            >
              {tt('settings.persona.vrmDropActive')}
            </div>
          )}
          {/* Single hidden input; both CTAs trigger it. value is reset so picking
              the same file again still fires onChange. accept=".vrm" ONLY — the
              model/gltf-binary MIME grays .vrm files out in Windows dialogs. */}
          <input
            ref={inputRef}
            type="file"
            accept=".vrm"
            className="hidden"
            data-testid="avatar-file-input"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {/* Status row: copy progress, loaded file, unload, inline friendly error. */}
        <div className="flex min-h-[1.25rem] flex-wrap items-center gap-3">
          {busy && <Badge tone="muted">{tt('settings.persona.vrmWorking')}</Badge>}
          {!busy && fileName && (
            <>
              <span data-testid="avatar-status" className="truncate text-xs text-zinc-400">
                {tt('settings.persona.vrmLoaded')}: {fileName}
              </span>
              <button
                data-testid="avatar-browse-loaded"
                onClick={() => inputRef.current?.click()}
                className="focus-orb rounded text-xs text-zinc-500 underline hover:text-zinc-300"
              >
                {tt('settings.persona.vrmBrowse')}
              </button>
              <button
                data-testid="avatar-fullscreen"
                onClick={() => window.mitra?.toggleAvatarFullscreen()}
                className="focus-orb rounded text-xs text-zinc-500 underline hover:text-zinc-300"
              >
                {tt('settings.persona.vrmFullscreen')}
              </button>
              <button onClick={unload} className="focus-orb rounded text-xs text-zinc-500 underline hover:text-zinc-300">
                {tt('settings.persona.vrmUnload')}
              </button>
            </>
          )}
          {errorKey && (
            <span data-testid="avatar-error" role="alert" className="text-xs text-red-300">
              {tt(errorKey)}
            </span>
          )}
        </div>
        {fileName && !errorKey && (
          <p className="text-[11px] text-zinc-500">{tt('settings.persona.vrmPersisted')}</p>
        )}

        <div className="glass-row p-3">
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
                <a
                  href={license.licenseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                  style={{ color: 'var(--accent-2)' }}
                >
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

// FullscreenAvatarView — the ?window=fullscreen viewer for the user's avatar.
// Loads Settings.avatarVrmPath through the same idempotent set-avatar-file IPC
// the picker uses (returns fresh bytes), renders the model user-orbitable on a
// true-fullscreen dark stage. Esc closes (window-level safety net also exists).
import { useEffect, useState } from 'react';
import { PersonaStage } from '../persona/PersonaStage';
import { t } from '../i18n';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { getMitra } from '../settings/mitraClient';

export default function FullscreenAvatarView() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [vrmUrl, setVrmUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lang = settings.language;

  useEffect(() => {
    const mitra = getMitra();
    if (!mitra) return;
    void mitra.getSettings().then(setSettings).catch(() => {});
  }, []);

  // Pull the persisted model bytes (same idempotent copy the picker preview uses).
  useEffect(() => {
    const mitra = getMitra();
    if (!mitra) return;
    if (settings.persona !== 'avatar' || !settings.avatarVrmPath) {
      setError('settings.persona.vrmMissing');
      return;
    }
    let url: string | null = null;
    void mitra
      .setAvatarFile({ kind: 'pick', sourcePath: settings.avatarVrmPath })
      .then((res) => {
        if (res.ok) {
          url = URL.createObjectURL(new Blob([res.bytes], { type: 'model/gltf-binary' }));
          setVrmUrl(url);
          setError(null);
        } else {
          setError('settings.persona.vrmMissing');
        }
      })
      .catch(() => setError('settings.persona.vrmCopyFailed'));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [settings.persona, settings.avatarVrmPath]);

  // A stray OS file-drop must not navigate this window (Electron default).
  useEffect(() => {
    const swallow = (e: DragEvent): void => e.preventDefault();
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  // Esc closes (the main-process before-input-event is the safety net).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.mitra?.toggleAvatarFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative h-full w-full bg-[#0a0a0f]">
      <div data-testid="avatar-fullscreen" className="absolute inset-0">
        <PersonaStage persona="avatar" state="speaking" vrmUrl={vrmUrl} licenseVisible={false} orbit />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
        <p className="rounded-full border border-white/10 bg-black/60 px-4 py-1.5 text-xs text-zinc-300 backdrop-blur">
          {t(lang, 'settings.persona.fsHint')}
        </p>
      </div>
      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-zinc-400">{t(lang, error)}</p>
        </div>
      )}
    </div>
  );
}

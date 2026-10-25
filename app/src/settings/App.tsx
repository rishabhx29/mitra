// Settings window shell (Task E; UI-polish wave: glass/depth shell per
// docs/DESIGN_BRIEF.md — orb-color CSS vars drive the radial shell background,
// the sidebar indicator and every accent). Loads settings over the mitra IPC
// bridge, hosts the panels, and shows a status.saved toast after each
// successful save. Outside Electron (plain-browser dev) it degrades to an
// in-memory fallback so the UI still works — flagged with a local-only hint.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { t } from '../i18n';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { resolveMitraApi } from './mitraClient';
import HomePanel from './HomePanel';
import PersonaPicker from './PersonaPicker';
import PermissionsPanel from './PermissionsPanel';
import AppsPanel from './AppsPanel';
import ModesPanel from './ModesPanel';
import NotionPanel from './NotionPanel';
import MemoryPanel from './MemoryPanel';
import HotkeyPanel from './HotkeyPanel';
import LanguagePanel from './LanguagePanel';
import TranscriptLog from './TranscriptLog';
import { Icon } from './ui';
import type { SectionId, SaveFn } from './types';

const SECTIONS: ReadonlyArray<{ id: SectionId; labelKey: string; icon: string }> = [
  { id: 'home', labelKey: 'settings.home', icon: 'home' },
  { id: 'persona', labelKey: 'settings.persona', icon: 'persona' },
  { id: 'permissions', labelKey: 'settings.permissions', icon: 'permissions' },
  { id: 'apps', labelKey: 'settings.apps', icon: 'apps' },
  { id: 'modes', labelKey: 'settings.modes', icon: 'modes' },
  { id: 'notion', labelKey: 'settings.notion', icon: 'notion' },
  { id: 'memory', labelKey: 'settings.memory', icon: 'memory' },
  { id: 'hotkey', labelKey: 'settings.hotkey', icon: 'hotkey' },
  { id: 'language', labelKey: 'settings.language', icon: 'language' },
  { id: 'transcript', labelKey: 'settings.transcript', icon: 'transcript' },
];

const TOAST_MS = 1800;

/**
 * Electron's default is to NAVIGATE the window when a file is dropped outside a
 * handled dropzone — the #1 way "drag my .vrm in" turns into a blank/garbage page.
 * Swallow every unhandled drag at the window level; the styled dropzone in
 * PersonaPicker still receives its events (stopPropagation-free, they just also
 * hit this guard). Same guard lives in the fullscreen viewer.
 */
function useDndNavigationGuard(): void {
  useEffect(() => {
    const swallow = (e: DragEvent): void => {
      // Only intercept drags we didn't opt into: if the target is inside the
      // avatar dropzone, its own handlers already preventDefault — re-doing it
      // here is harmless and keeps the window from navigating regardless.
      e.preventDefault();
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);
}

export default function SettingsApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [persisted, setPersisted] = useState(true);
  const [section, setSection] = useState<SectionId>('home');
  const [toast, setToast] = useState<{ tone: 'ok' | 'err'; key: string } | null>(null);
  const apiRef = useRef<{ api: ReturnType<typeof resolveMitraApi>['api'] } | null>(null);
  const toastTimer = useRef<number | null>(null);
  useDndNavigationGuard();

  useEffect(() => {
    const resolved = resolveMitraApi();
    apiRef.current = { api: resolved.api };
    setPersisted(resolved.persisted);
    resolved.api
      .getSettings()
      .then(setSettings)
      .catch(() => {
        // Never block the window on a broken store — defaults + honest hint.
        setSettings({ ...DEFAULT_SETTINGS });
        setPersisted(false);
      });
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = useCallback((tone: 'ok' | 'err', key: string) => {
    setToast({ tone, key });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const lang = settings?.language ?? 'en';
  const tt = useCallback((key: string) => t(lang, key), [lang]);

  const save: SaveFn = useCallback(
    (patch) => {
      const api = apiRef.current?.api;
      if (!api) return;
      api
        .setSettings(patch)
        .then((next) => {
          setSettings(next);
          showToast('ok', 'status.saved');
        })
        .catch(() => showToast('err', 'status.saveFailed'));
    },
    [showToast],
  );

  // Orb accent vars (brief §"Base"): the whole shell — background tint,
  // gradients, glows — re-tints live when the user changes their orb colors.
  const orbVars =
    settings === null
      ? undefined
      : ({
          '--orb-a': settings.orbColors.a,
          '--orb-b': settings.orbColors.b,
        } as CSSProperties);

  if (settings === null) {
    return (
      <div className="mitra-shell flex h-full w-full items-center justify-center text-sm text-zinc-500">
        …
      </div>
    );
  }

  const panelProps = { settings, tt, save };

  return (
    <div className="mitra-shell flex h-full w-full text-zinc-100" style={orbVars}>
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.02] backdrop-blur-xl">
        <div className="flex items-center gap-3 px-5 py-5">
          <span
            className="h-7 w-7 rounded-full"
            style={{
              background: `radial-gradient(circle at 32% 28%, ${settings.orbColors.a}, ${settings.orbColors.b} 75%)`,
              boxShadow: `0 0 14px ${settings.orbColors.b}80`,
            }}
          />
          <div>
            <div className="text-sm font-semibold text-zinc-50">{tt('app.title')}</div>
            <div className="text-[11px] text-zinc-500">{tt('settings.title')}</div>
          </div>
        </div>
        <nav className="stagger flex-1 space-y-1 px-3" aria-label={tt('settings.title')}>
          {SECTIONS.map(({ id, labelKey, icon }) => {
            const active = section === id;
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                aria-current={active ? 'page' : undefined}
                className={`focus-orb relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  active ? 'bg-white/[0.06] text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                }`}
              >
                {/* Orb-gradient indicator on the active item (brief §"Accent system"). */}
                {active && (
                  <span
                    aria-hidden="true"
                    className="orb-gradient absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full"
                  />
                )}
                <span style={active ? { color: 'var(--orb-a)' } : undefined}>
                  <Icon name={icon} />
                </span>
                {tt(labelKey)}
              </button>
            );
          })}
        </nav>
        {!persisted && (
          <p className="mx-3 mb-3 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-[11px] leading-snug text-amber-300">
            {tt('settings.localOnly')}
          </p>
        )}
      </aside>

      {/* Content */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className={`mx-auto px-8 py-8 ${section === 'home' ? 'max-w-3xl' : 'max-w-2xl'}`}>
          {section !== 'home' && (
            <h2 className="mb-6 text-lg font-semibold text-zinc-50">
              {tt(SECTIONS.find((s) => s.id === section)?.labelKey ?? 'settings.title')}
            </h2>
          )}

          <div className={section === 'home' ? '' : 'hidden'}>
            {section === 'home' && (
              <HomePanel settings={settings} tt={tt} onNavigate={setSection} />
            )}
          </div>
          <div className={section === 'persona' ? '' : 'hidden'}>
            {section === 'persona' && <PersonaPicker {...panelProps} />}
          </div>
          <div className={section === 'permissions' ? '' : 'hidden'}>
            {section === 'permissions' && <PermissionsPanel {...panelProps} />}
          </div>
          <div className={section === 'apps' ? '' : 'hidden'}>
            {section === 'apps' && <AppsPanel {...panelProps} />}
          </div>
          <div className={section === 'modes' ? '' : 'hidden'}>
            {section === 'modes' && <ModesPanel {...panelProps} />}
          </div>
          <div className={section === 'notion' ? '' : 'hidden'}>
            {section === 'notion' && <NotionPanel {...panelProps} />}
          </div>
          <div className={section === 'memory' ? '' : 'hidden'}>
            {section === 'memory' && <MemoryPanel {...panelProps} />}
          </div>
          <div className={section === 'hotkey' ? '' : 'hidden'}>
            {section === 'hotkey' && <HotkeyPanel {...panelProps} />}
          </div>
          <div className={section === 'language' ? '' : 'hidden'}>
            {section === 'language' && <LanguagePanel {...panelProps} />}
          </div>
          {/* TranscriptLog stays mounted (subscription lives) and toggles visibility. */}
          <div className={section === 'transcript' ? '' : 'hidden'}>
            <TranscriptLog tt={tt} visible={section === 'transcript'} />
          </div>
        </div>
      </main>

      {/* Saved toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 flex items-center gap-2 rounded-xl border px-4 py-2 text-sm shadow-lg backdrop-blur ${
            toast.tone === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
              : 'border-red-500/40 bg-red-500/15 text-red-200'
          }`}
        >
          {toast.tone === 'ok' ? (
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m3 8.5 3.5 3.5L13 4.5" />
            </svg>
          ) : (
            '!'
          )}
          {tt(toast.key)}
        </div>
      )}
    </div>
  );
}

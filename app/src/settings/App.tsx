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
import AssistantPage from './AssistantPage';
import CapabilitiesPage from './CapabilitiesPage';
import ActivityPage from './ActivityPage';
import TranscriptLog from './TranscriptLog';
import { Icon } from './ui';
import type { SectionId, SaveFn } from './types';

const SECTIONS: ReadonlyArray<{ id: SectionId; labelKey: string; icon: string }> = [
  { id: 'home', labelKey: 'settings.home', icon: 'home' },
  { id: 'assistant', labelKey: 'settings.nav.assistant', icon: 'persona' },
  { id: 'capabilities', labelKey: 'settings.nav.capabilities', icon: 'permissions' },
  { id: 'activity', labelKey: 'settings.nav.activity', icon: 'transcript' },
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
    <div className="mitra-shell relative flex h-full w-full flex-col text-zinc-100" style={orbVars}>
      {/* Sidebar */}
      {/* Top bar — launcher-style: brand left, pill tabs, Console right (ref 2). */}
      <header className="top-bar z-10 flex items-center gap-6 px-6 py-3.5">
        <div className="flex items-center gap-3">
          <span
            className="orb-pulse h-8 w-8 rounded-full"
            style={{
              background: `radial-gradient(circle at 32% 28%, ${settings.orbColors.a}, ${settings.orbColors.b} 75%)`,
              boxShadow: `0 0 14px ${settings.orbColors.b}70`,
            }}
          />
          <div>
            <div className="text-sm font-semibold tracking-wide text-white">{tt('app.title')}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {tt('settings.title')}
            </div>
          </div>
        </div>

        <nav className="ml-4 flex items-center gap-1.5" aria-label={tt('settings.title')}>
          {SECTIONS.map(({ id, labelKey, icon }) => {
            const active = section === id;
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                aria-current={active ? 'page' : undefined}
                data-active={active}
                className={`top-tab focus-orb flex items-center gap-2 rounded-full px-4 py-2 text-sm ${
                  active ? 'font-medium text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span style={active ? { color: 'var(--accent)' } : undefined}>
                  <Icon name={icon} />
                </span>
                {tt(labelKey)}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {!persisted && (
            <span className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-1.5 text-[11px] text-amber-300">
              {tt('settings.localOnly')}
            </span>
          )}
          <button
            data-testid="nav-console"
            onClick={() => window.mitra?.toggleConsole()}
            className="top-console focus-orb flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-white"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
              <path d="m4.5 6 2.5 2L4.5 10M8.5 10h3" />
            </svg>
            {tt('console.open')}
          </button>
        </div>
      </header>

      {/* Content spans full width below the top bar (launcher layout). */}
      <main className="z-10 min-w-0 flex-1 overflow-y-auto">
        <div className={`mx-auto px-8 py-8 ${section === 'home' ? 'max-w-3xl' : 'max-w-3xl'}`}>
          <div className={section === 'home' ? '' : 'hidden'}>
            {section === 'home' && (
              <HomePanel settings={settings} tt={tt} onNavigate={setSection} />
            )}
          </div>
          <div className={section === 'assistant' ? '' : 'hidden'}>
            {section === 'assistant' && <AssistantPage {...panelProps} />}
          </div>
          <div className={section === 'capabilities' ? '' : 'hidden'}>
            {section === 'capabilities' && <CapabilitiesPage {...panelProps} />}
          </div>
          {/* TranscriptLog stays mounted (subscription lives) — ActivityPage
              provides the page chrome, App supplies the single log instance. */}
          <div className={section === 'activity' ? '' : 'hidden'}>
            <ActivityPage tt={tt}>
              <TranscriptLog tt={tt} visible={section === 'activity'} />
            </ActivityPage>
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

// Home (UI-polish wave, docs/DESIGN_BRIEF.md §"Home / landing"): the settings
// window's first page — gradient hero + "Try it" CTA, 6-card feature grid,
// live status strip (bridge /api/health · provider mode · version · hotkey)
// and the 3-step how-it-works strip.
//
// The CTA does NOT add IPC: window.mitra exposes no show/toggle-overlay method
// (verified in electron/preload.ts — only hideOverlay exists; the hotkey/tray
// toggle lives in main). So the CTA surfaces the hotkey chips and instructs to
// press them. Deep links into panels go through onNavigate (local state only).

import { useEffect, useState, type ReactNode } from 'react';
import type { Settings } from '../shared/types';
import { fetchBridgeHealth } from './bridgeClient';
import { Badge, Icon, Kbd, type Tt } from './ui';
import type { SectionId } from './types';

// App version straight from package.json (resolveJsonModule is on in
// tsconfig.web.json) so the status strip can't drift from the release.
import pkg from '../../package.json';
const APP_VERSION: string = pkg.version;

type Health = { status: 'checking' | 'online' | 'offline'; mock: boolean | null };

const FEATURES: ReadonlyArray<{ icon: string; titleKey: string; descKey: string }> = [
  { icon: 'mic', titleKey: 'home.feature.voice.title', descKey: 'home.feature.voice.desc' },
  { icon: 'permissions', titleKey: 'home.feature.perms.title', descKey: 'home.feature.perms.desc' },
  { icon: 'notion', titleKey: 'home.feature.notion.title', descKey: 'home.feature.notion.desc' },
  { icon: 'code', titleKey: 'home.feature.opencode.title', descKey: 'home.feature.opencode.desc' },
  { icon: 'language', titleKey: 'home.feature.langs.title', descKey: 'home.feature.langs.desc' },
  { icon: 'persona', titleKey: 'home.feature.persona.title', descKey: 'home.feature.persona.desc' },
];

const STEPS: ReadonlyArray<{ titleKey: string; descKey: string }> = [
  { titleKey: 'home.how.step1.title', descKey: 'home.how.step1.desc' },
  { titleKey: 'home.how.step2.title', descKey: 'home.how.step2.desc' },
  { titleKey: 'home.how.step3.title', descKey: 'home.how.step3.desc' },
];

export default function HomePanel({
  settings,
  tt,
  onNavigate,
}: {
  settings: Settings;
  tt: Tt;
  onNavigate: (section: SectionId) => void;
}) {
  const [health, setHealth] = useState<Health>({ status: 'checking', mock: null });
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchBridgeHealth().then((result) => {
      if (cancelled) return;
      setHealth(
        result.ok
          ? { status: 'online', mock: result.mock }
          : { status: 'offline', mock: null },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const hotkeyParts = settings.hotkey.split('+').filter(Boolean);

  return (
    <div className="stagger space-y-8">
      {/* ---- Hero ------------------------------------------------------- */}
      <section className="glass-card relative overflow-hidden p-8">
        {/* Decorative orb glow, tinted by the user's orb colors. */}
        <div
          aria-hidden="true"
          className="orb-gradient orb-pulse pointer-events-none absolute -right-8 -top-14 h-44 w-44 rounded-full opacity-25 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="orb-gradient pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full opacity-10 blur-3xl"
        />

        <div className="relative">
          {health.status !== 'checking' && (
            <div className="mb-4">
              {health.status === 'offline' ? (
                <Badge tone="muted">{tt('home.status.offline')}</Badge>
              ) : health.mock ? (
                <Badge tone="muted">{tt('home.mode.mock')}</Badge>
              ) : (
                <Badge tone="accent">{tt('home.mode.live')}</Badge>
              )}
            </div>
          )}
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50">
            <span className="orb-text">{tt('home.hero.title')}</span>
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-zinc-400">
            {tt('home.hero.sub')}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setPressed(true)}
              title={tt('home.hero.pressHint')}
              className="focus-orb btn-orb inline-flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-semibold"
            >
              <span className="text-white/90">
                <Icon name="persona" />
              </span>
              {tt('home.hero.cta')}
              <span className="flex items-center gap-1">
                {hotkeyParts.map((part, i) => (
                  <Kbd key={`${part}-${i}`}>{part}</Kbd>
                ))}
              </span>
            </button>
            <p className="min-h-5 text-xs text-zinc-400" aria-live="polite">
              {pressed ? tt('home.hero.pressHint') : ''}
            </p>
          </div>
        </div>
      </section>

      {/* ---- Feature grid (6 glass cards) ------------------------------- */}
      <section>
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.14em] text-zinc-500">
          {tt('home.features.title')}
        </h2>
        <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.icon} className="glass-card p-4">
              <span className="icon-tile mb-3 flex h-8 w-8 items-center justify-center">
                <Icon name={feature.icon} />
              </span>
              <h3 className="text-sm font-semibold text-zinc-50">{tt(feature.titleKey)}</h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">{tt(feature.descKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Status strip ----------------------------------------------- */}
      <section className="glass-card flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
        <StatusItem label={tt('home.status.bridge')}>
          <span className="flex items-center gap-1.5 text-xs text-zinc-200">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                health.status === 'online'
                  ? 'bg-emerald-400'
                  : health.status === 'offline'
                    ? 'bg-state-error'
                    : 'bg-state-thinking'
              }`}
            />
            {health.status === 'online'
              ? tt('home.status.online')
              : health.status === 'offline'
                ? tt('home.status.offline')
                : tt('home.status.checking')}
          </span>
        </StatusItem>
        <StatusItem label={tt('home.status.mode')}>
          {health.mock === null ? (
            <span className="text-xs text-zinc-500">—</span>
          ) : health.mock ? (
            <Badge tone="muted">{tt('home.mode.mock')}</Badge>
          ) : (
            <Badge tone="accent">{tt('home.mode.live')}</Badge>
          )}
        </StatusItem>
        <StatusItem label={tt('home.status.version')}>
          <span className="font-mono text-xs text-zinc-300">v{APP_VERSION}</span>
        </StatusItem>
        <StatusItem label={tt('home.status.hotkey')}>
          <button
            type="button"
            onClick={() => onNavigate('hotkey')}
            className="focus-orb flex items-center gap-1 rounded-md transition-colors hover:brightness-125"
            title={tt('settings.hotkey.current')}
          >
            {hotkeyParts.map((part, i) => (
              <Kbd key={`${part}-${i}`}>{part}</Kbd>
            ))}
          </button>
        </StatusItem>
      </section>

      {/* ---- How it works (3 steps, horizontal) -------------------------- */}
      <section>
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.14em] text-zinc-500">
          {tt('home.how.title')}
        </h2>
        <ol className="stagger grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.titleKey} className="glass-card flex items-start gap-3 p-4">
              <span className="orb-gradient flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white">
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-50">{tt(step.titleKey)}</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{tt(step.descKey)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function StatusItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

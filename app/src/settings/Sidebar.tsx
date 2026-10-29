// Settings sidebar (Steam-desktop-client style rail): brand block on top,
// vertical icon+label nav with an ember indicator bar hugging the window's
// left edge on the active item, the ember Open Console action, then status
// hints pinned to the bottom. Extracted from App.tsx so the shell is a plain
// row: rail + scrollable main.
//
// No data fetching here — the version/hotkey hints read straight off
// package.json and the settings object (HomePanel owns the live bridge strip).

import type { CSSProperties } from 'react';
import pkg from '../../package.json';
import type { Settings } from '../shared/types';
import { Icon, Kbd } from './ui';
import type { SectionId } from './types';

// App version straight from package.json (same source HomePanel's status strip
// uses) so the rail hint can't drift from the release.
const APP_VERSION: string = pkg.version;

export interface SidebarSection {
  id: SectionId;
  labelKey: string;
  icon: string;
}

interface SidebarProps {
  sections: ReadonlyArray<SidebarSection>;
  section: SectionId;
  onNavigate: (id: SectionId) => void;
  tt: (key: string) => string;
  settings: Settings;
  persisted: boolean;
}

export default function Sidebar({
  sections,
  section,
  onNavigate,
  tt,
  settings,
  persisted,
}: SidebarProps) {
  // Brand orb dot — same radial treatment the top bar used, still re-tinted
  // live by the shell's --orb-a/--orb-b vars (settings.orbColors).
  const orbDotStyle: CSSProperties = {
    background: `radial-gradient(circle at 32% 28%, ${settings.orbColors.a}, ${settings.orbColors.b} 75%)`,
    boxShadow: `0 0 14px ${settings.orbColors.b}70`,
  };
  const hotkeyParts = settings.hotkey.split('+').filter(Boolean);

  return (
    <aside className="side-rail z-10 flex h-full w-64 shrink-0 flex-col px-4 py-5">
      {/* Brand block */}
      <div className="flex items-center gap-3">
        <span className="orb-pulse h-8 w-8 rounded-full" style={orbDotStyle} />
        <div>
          <div className="text-sm font-semibold tracking-wide text-white">{tt('app.title')}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            {tt('settings.title')}
          </div>
        </div>
      </div>

      {/* Vertical nav — the ember indicator sits at -left-4 (the rail's padding),
          so it hugs the sidebar's left edge, Steam-style. */}
      <nav className="mt-8 flex flex-col gap-1" aria-label={tt('settings.title')}>
        {sections.map(({ id, labelKey, icon }) => {
          const active = section === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              aria-current={active ? 'page' : undefined}
              data-active={active}
              className={`side-nav-item focus-orb relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                active ? 'bg-white/5 font-medium text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="side-indicator absolute -left-4 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
                />
              )}
              <span style={active ? { color: 'var(--accent)' } : undefined}>
                <Icon name={icon} />
              </span>
              {tt(labelKey)}
            </button>
          );
        })}
      </nav>

      {/* The one loud action: open/close the console window (IPC-owned entry —
          window.mitra.toggleConsole is the same call the old top bar made). */}
      <div className="mt-6">
        <button
          data-testid="nav-console"
          onClick={() => window.mitra?.toggleConsole()}
          className="side-console focus-orb flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-white"
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
            <path d="m4.5 6 2.5 2L4.5 10M8.5 10h3" />
          </svg>
          {tt('console.open')}
        </button>
      </div>

      {/* Spacer pushes the status block to the bottom of the rail. */}
      <div className="flex-1" />

      {/* Bottom: the !persisted local-only warning, then static status hints. */}
      {!persisted && (
        <span className="mb-3 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-1.5 text-[11px] text-amber-300">
          {tt('settings.localOnly')}
        </span>
      )}
      <div className="space-y-2 border-t border-white/5 pt-3">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-zinc-500">{tt('home.status.version')}</span>
          <span className="font-mono text-zinc-400">v{APP_VERSION}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-zinc-500">{tt('home.status.hotkey')}</span>
          <span className="flex items-center gap-1">
            {hotkeyParts.map((part, i) => (
              <Kbd key={`${part}-${i}`}>{part}</Kbd>
            ))}
          </span>
        </div>
      </div>
    </aside>
  );
}

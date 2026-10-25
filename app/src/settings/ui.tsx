// Shared dark-theme primitives for the settings UI (Task E; UI-polish wave:
// glass/depth system per docs/DESIGN_BRIEF.md — orb-gradient accents driven by
// the --orb-a/--orb-b CSS vars set on the settings root in App.tsx). Tailwind
// v4, no component library — small hand-rolled pieces keep panels readable.

import type { ReactNode } from 'react';

export type Tt = (key: string) => string;

export function Card({
  micro,
  title,
  help,
  right,
  children,
}: {
  /** Uppercase micro-label above the title (brief §"Type"). */
  micro?: string;
  title?: string;
  help?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass-card p-5">
      {micro && (
        <p className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-zinc-500">{micro}</p>
      )}
      {(title || right) && (
        <div className="mb-1 flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-semibold text-zinc-50">{title}</h3>}
          {right}
        </div>
      )}
      {help && <p className="mb-3 text-xs leading-relaxed text-zinc-400">{help}</p>}
      {children}
    </section>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`focus-orb relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 ${
        checked ? 'border-transparent' : 'border-white/10 bg-white/5'
      }`}
      style={
        checked
          ? {
              background: 'linear-gradient(135deg, var(--orb-a), var(--orb-b))',
              boxShadow: '0 0 12px color-mix(in oklab, var(--orb-b) 35%, transparent)',
            }
          : undefined
      }
    >
      <span
        className={`absolute top-0.5 h-[1.125rem] w-[1.125rem] rounded-full bg-white shadow transition-all duration-150 ${
          checked ? 'left-[1.375rem]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export function RadioCard({
  selected,
  onClick,
  title,
  desc,
  visual,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  visual: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`focus-orb flex flex-1 flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-colors ${
        selected
          ? 'border-transparent bg-white/[0.06]'
          : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
      }`}
      style={
        selected
          ? {
              borderColor: 'color-mix(in oklab, var(--orb-a) 55%, transparent)',
              background: 'color-mix(in oklab, var(--orb-a) 10%, rgb(255 255 255 / 3%))',
              boxShadow: '0 0 18px color-mix(in oklab, var(--orb-a) 22%, transparent)',
            }
          : undefined
      }
    >
      <div className="flex h-16 w-16 items-center justify-center">{visual}</div>
      <span className="text-sm font-medium text-zinc-100">{title}</span>
      <span className="text-[11px] leading-snug text-zinc-400">{desc}</span>
    </button>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'accent' | 'muted'; children: ReactNode }) {
  const tones = {
    ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    accent: 'badge-orb',
    muted: 'border-white/10 bg-white/5 text-zinc-300',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  // Brief §"KBD chips": rounded-md border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px].
  return (
    <kbd className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
      {children}
    </kbd>
  );
}

export function Btn({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const styles = {
    primary: 'btn-orb',
    ghost: 'border border-white/10 bg-white/5 text-zinc-200 hover:border-white/20 hover:bg-white/10',
    danger: 'border border-red-500/30 bg-red-950/50 text-red-300 hover:bg-red-900/60',
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`focus-orb rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export const inputCls =
  'input-glass w-full rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600';

// ---- icons: minimal 16px stroke glyphs (no icon dependency) ----

const ICON_PATHS: Record<string, ReactNode> = {
  home: <path d="M2.5 7 8 2.2 13.5 7v6.3H9.8V9.8H6.2v3.5H2.5V7Z" />,
  mic: (
    <>
      <rect x="6" y="1.8" width="4" height="7.2" rx="2" />
      <path d="M3.8 7.2a4.2 4.2 0 0 0 8.4 0M8 11.4v2.4M5.8 13.8h4.4" />
    </>
  ),
  code: <path d="m5.5 5-3 3 3 3M10.5 5l3 3-3 3" />,
  persona: <circle cx="8" cy="8" r="5.5" />,
  permissions: (
    <path d="M8 1.8 2.8 3.6v4.1c0 3.2 2.2 5.3 5.2 6.5 3-1.2 5.2-3.3 5.2-6.5V3.6L8 1.8Z" />
  ),
  apps: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  ),
  notion: (
    <>
      <path d="M3 4.5h10M3 8h10M3 11.5h6.5" />
    </>
  ),
  modes: (
    <>
      <rect x="1.8" y="5.5" width="8.7" height="8.7" rx="1.5" />
      <path d="M5.5 5.5V3.3A1.5 1.5 0 0 1 7 1.8h6.2A1.5 1.5 0 0 1 14.7 3.3V9.5a1.5 1.5 0 0 1-1.5 1.5H11" />
    </>
  ),
  memory: (
    <>
      <ellipse cx="8" cy="3.6" rx="5.6" ry="1.8" />
      <path d="M2.4 3.6v8.8c0 1 2.5 1.8 5.6 1.8s5.6-.8 5.6-1.8V3.6" />
      <path d="M2.4 8c0 1 2.5 1.8 5.6 1.8s5.6-.8 5.6-1.8" />
    </>
  ),
  hotkey: (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.5h6" />
    </>
  ),
  language: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c-1.8 1.6-2.8 3.7-2.8 6S6.2 12.4 8 14c1.8-1.6 2.8-3.7 2.8-6S9.8 3.6 8 2Z" />
    </>
  ),
  transcript: (
    <>
      <path d="M2.5 3.5h11v7h-6L4 13v-2.5H2.5v-7Z" />
    </>
  ),
};

export function Icon({ name }: { name: keyof typeof ICON_PATHS & string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

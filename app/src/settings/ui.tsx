// Shared dark-theme primitives for the settings UI (Task E). Tailwind v4, no
// component library — small hand-rolled pieces keep the panel files readable.

import type { ReactNode } from 'react';

export type Tt = (key: string) => string;

export function Card({
  title,
  help,
  right,
  children,
}: {
  title?: string;
  help?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      {(title || right) && (
        <div className="mb-1 flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>}
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
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        checked ? 'border-sky-500/60 bg-sky-600/80' : 'border-zinc-700 bg-zinc-800'
      }`}
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
      className={`flex flex-1 flex-col items-center gap-2 rounded-xl border p-4 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        selected
          ? 'border-sky-500/70 bg-sky-500/10'
          : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900'
      }`}
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
    accent: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    muted: 'border-zinc-700 bg-zinc-800/60 text-zinc-300',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 font-mono text-xs text-zinc-200 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
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
    primary: 'bg-sky-600 text-white hover:bg-sky-500 disabled:bg-zinc-800 disabled:text-zinc-500',
    ghost: 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:text-zinc-600',
    danger: 'bg-red-950/60 text-red-300 hover:bg-red-900/60',
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500/70 focus:outline-none';

// ---- icons: minimal 16px stroke glyphs (no icon dependency) ----

const ICON_PATHS: Record<string, ReactNode> = {
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

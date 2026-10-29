// PageHeader — unified page intro (UI refactor): one title + one-line purpose
// per page, replacing the repeated per-panel card headers that made the old
// sidebar feel clustered. Numbered like chapters; orb-gradient index.
import type { ReactNode } from 'react';

export function PageHeader({
  index,
  title,
  description,
  actions,
}: {
  index: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="mt-1 font-mono text-2xl font-semibold text-transparent"
          style={{
            backgroundImage: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
          }}
        >
          {index}
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">{title}</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-400">{description}</p>
        </div>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

/** Section divider inside a page: small numbered label, hairline rule. */
export function PageSection({
  index,
  label,
  children,
}: {
  index: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-zinc-500">{index}</span>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
          {label}
        </h2>
        <span className="h-px flex-1 bg-white/[0.06]" />
      </div>
      {children}
    </section>
  );
}

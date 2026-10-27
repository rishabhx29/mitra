// ActivityPage — the conversation log (UI refactor): one calm place to review
// what Mitra heard, replied, and executed.
import { PageHeader } from './PageHeader';
import type { ReactNode } from 'react';
import type { Tt } from './ui';

export default function ActivityPage({ tt, children }: { tt: Tt; children: ReactNode }) {
  return (
    <div className="stagger mx-auto max-w-3xl space-y-4">
      <PageHeader index="03" title={tt('page.activity.title')} description={tt('page.activity.desc')} />
      {children}
    </div>
  );
}

// CapabilitiesPage — the full capability map (UI refactor): the tool matrix
// (every executable tool grouped under the gate that unlocks it), the gate
// toggles themselves, launcher aliases, workspace modes and the integrations
// (Notion board + memory) — previously four separate sidebar pages repeating
// the same card chrome, later "a few toggles and apps" that read like a
// placeholder. Each section carries its own one-line purpose.
import { PageHeader, PageSection } from './PageHeader';
import ToolMatrix from './ToolMatrix';
import PermissionsPanel from './PermissionsPanel';
import AppsPanel from './AppsPanel';
import ModesPanel from './ModesPanel';
import NotionPanel from './NotionPanel';
import MemoryPanel from './MemoryPanel';
import type { Settings } from '../shared/types';
import type { SaveFn } from './types';
import type { Tt } from './ui';

/** Section intro line — small, quiet, between the section rule and the card. */
function SectionDesc({ tt, k }: { tt: Tt; k: string }) {
  return <p className="text-xs leading-relaxed text-zinc-500">{tt(k)}</p>;
}

export default function CapabilitiesPage({
  settings,
  tt,
  save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  return (
    <div className="stagger mx-auto max-w-3xl space-y-8">
      <PageHeader
        index="02"
        title={tt('page.capabilities.title')}
        description={tt('page.capabilities.desc')}
      />
      <PageSection index="2.1" label={tt('page.capabilities.toolMatrix')}>
        <SectionDesc tt={tt} k="page.capabilities.toolMatrix.desc" />
        <ToolMatrix permissions={settings.permissions} tt={tt} />
      </PageSection>
      <PageSection index="2.2" label={tt('page.capabilities.gates')}>
        <SectionDesc tt={tt} k="page.capabilities.gates.desc" />
        <PermissionsPanel settings={settings} tt={tt} save={save} />
      </PageSection>
      <PageSection index="2.3" label={tt('page.capabilities.apps')}>
        <SectionDesc tt={tt} k="page.capabilities.apps.desc" />
        <AppsPanel settings={settings} tt={tt} save={save} />
      </PageSection>
      <PageSection index="2.4" label={tt('page.capabilities.modes')}>
        <SectionDesc tt={tt} k="page.capabilities.modes.desc" />
        <ModesPanel settings={settings} tt={tt} save={save} />
      </PageSection>
      <PageSection index="2.5" label={tt('page.capabilities.integrations')}>
        <SectionDesc tt={tt} k="page.capabilities.integrations.desc" />
        <div className="grid gap-3 lg:grid-cols-2">
          <NotionPanel settings={settings} tt={tt} save={save} />
          <MemoryPanel settings={settings} tt={tt} save={save} />
        </div>
      </PageSection>
    </div>
  );
}

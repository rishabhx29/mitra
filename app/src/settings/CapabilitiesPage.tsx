// CapabilitiesPage — unified "what Mitra may do & what it works with" page
// (UI refactor): the permission gates WITH the tools they unlock, app aliases,
// workspace modes, and the integrations (Notion board + memory) — previously
// four separate sidebar pages repeating the same card chrome.
import { PageHeader, PageSection } from './PageHeader';
import PermissionsPanel from './PermissionsPanel';
import AppsPanel from './AppsPanel';
import ModesPanel from './ModesPanel';
import NotionPanel from './NotionPanel';
import MemoryPanel from './MemoryPanel';
import type { Settings } from '../shared/types';
import type { SaveFn } from './types';
import type { Tt } from './ui';

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
      <PageSection index="2.1" label={tt('page.capabilities.gates')}>
        <PermissionsPanel settings={settings} tt={tt} save={save} />
      </PageSection>
      <PageSection index="2.2" label={tt('page.capabilities.apps')}>
        <AppsPanel settings={settings} tt={tt} save={save} />
      </PageSection>
      <PageSection index="2.3" label={tt('page.capabilities.modes')}>
        <ModesPanel settings={settings} tt={tt} save={save} />
      </PageSection>
      <PageSection index="2.4" label={tt('page.capabilities.integrations')}>
        <div className="grid gap-3 lg:grid-cols-2">
          <NotionPanel settings={settings} tt={tt} save={save} />
          <MemoryPanel settings={settings} tt={tt} save={save} />
        </div>
      </PageSection>
    </div>
  );
}

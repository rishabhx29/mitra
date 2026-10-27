// AssistantPage — unified "look & listen" page (UI refactor): persona, voice,
// summon hotkey and conversation language in ONE scroll — the old sidebar split
// these across four near-identical pages.
import { PageHeader, PageSection } from './PageHeader';
import PersonaPicker from './PersonaPicker';
import VoicePanel from './VoicePanel';
import HotkeyPanel from './HotkeyPanel';
import LanguagePanel from './LanguagePanel';
import { Kbd } from './ui';
import type { SaveFn } from './types';
import type { Tt } from './ui';
import type { Settings } from '../shared/types';

export default function AssistantPage({
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
        index="01"
        title={tt('page.assistant.title')}
        description={tt('page.assistant.desc')}
      />
      <PageSection index="1.1" label={tt('page.assistant.look')}>
        <PersonaPicker settings={settings} tt={tt} save={save} />
      </PageSection>
      <PageSection index="1.2" label={tt('page.assistant.voice')}>
        <VoicePanel settings={settings} tt={tt} save={save} />
      </PageSection>
      <PageSection index="1.3" label={tt('page.assistant.summon')}>
        <HotkeyPanel settings={settings} tt={tt} save={save} />
        <p className="text-[11px] text-zinc-500">
          {tt('page.assistant.summonHint')} <Kbd>{settings.hotkey}</Kbd>
        </p>
      </PageSection>
      <PageSection index="1.4" label={tt('page.assistant.replyLang')}>
        <LanguagePanel settings={settings} tt={tt} save={save} />
      </PageSection>
    </div>
  );
}

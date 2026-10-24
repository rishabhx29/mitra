// LanguagePanel (Task E): en/hi radio. Saves immediately; the whole settings
// window re-labels because App re-renders with the new language.

import type { Lang, } from '../i18n';
import type { Settings } from '../shared/types';
import { Card, Tt } from './ui';
import type { SaveFn } from './types';

const LANGS: ReadonlyArray<{ value: Lang; labelKey: string }> = [
  { value: 'en', labelKey: 'settings.language.en' },
  { value: 'hi', labelKey: 'settings.language.hi' },
];

export default function LanguagePanel({
  settings,
  tt,
  save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  return (
    <div className="space-y-4">
      <Card title={tt('settings.language')} help={tt('settings.language.help')}>
        <div className="space-y-2" role="radiogroup" aria-label={tt('settings.language')}>
          {LANGS.map(({ value, labelKey }) => {
            const selected = settings.language === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => save({ language: value })}
                className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                  selected
                    ? 'border-sky-500/70 bg-sky-500/10'
                    : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                    selected ? 'border-sky-400' : 'border-zinc-600'
                  }`}
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-sky-400" />}
                </span>
                <span className={`text-sm ${selected ? 'text-zinc-100' : 'text-zinc-300'}`}>
                  {tt(labelKey)}
                </span>
                <span className="ml-auto font-mono text-[11px] text-zinc-600">{value}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

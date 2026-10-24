// AppsPanel (Task E): launcher aliases (Settings.apps) with add/edit/remove.
// Edits happen on a local draft; a Save button persists (per-keystroke IPC
// writes would spam the settings file). Pure list logic lives in appsModel.ts.

import { useEffect, useState } from 'react';
import type { AppAlias, Settings } from '../shared/types';
import { appsReducer, sanitizeApps, type AppsAction } from './appsModel';
import { Badge, Btn, Card, Tt, inputCls } from './ui';
import type { SaveFn } from './types';

export default function AppsPanel({
  settings,
  tt,
  save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  const [draft, setDraft] = useState<AppAlias[]>(settings.apps);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');

  useEffect(() => setDraft(settings.apps), [settings.apps]);

  const saved = settings.apps;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const dispatch = (action: AppsAction) => {
    setDraft(appsReducer(draft, action).apps);
  };

  const onAdd = () => {
    const result = appsReducer(draft, { type: 'add', name: newName, command: newCommand });
    if (result.error) return; // empty fields — Add button stays honest, inputs keep their text
    setDraft(result.apps);
    setNewName('');
    setNewCommand('');
  };

  return (
    <div className="space-y-4">
      <Card
        title={tt('settings.apps')}
        right={dirty ? <Badge tone="accent">{tt('settings.apps.dirtyHint')}</Badge> : undefined}
      >
        {draft.length === 0 ? (
          <p className="text-xs text-zinc-500">{tt('settings.apps.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {draft.map((alias, index) => (
              <li key={index} className="flex items-center gap-2">
                <input
                  value={alias.name}
                  onChange={(e) => dispatch({ type: 'update', index, name: e.target.value })}
                  className={`${inputCls} w-36`}
                  aria-label={tt('settings.apps.name')}
                  placeholder={tt('settings.apps.namePlaceholder')}
                />
                <input
                  value={alias.command}
                  onChange={(e) => dispatch({ type: 'update', index, command: e.target.value })}
                  className={`${inputCls} flex-1 font-mono text-xs`}
                  aria-label={tt('settings.apps.command')}
                  placeholder={tt('settings.apps.commandPlaceholder')}
                />
                <Btn variant="danger" onClick={() => dispatch({ type: 'remove', index })}>
                  {tt('btn.remove')}
                </Btn>
              </li>
            ))}
          </ul>
        )}

        <form
          className="mt-4 flex items-center gap-2 border-t border-zinc-800 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            onAdd();
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={`${inputCls} w-36`}
            placeholder={tt('settings.apps.namePlaceholder')}
            aria-label={tt('settings.apps.name')}
          />
          <input
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            className={`${inputCls} flex-1 font-mono text-xs`}
            placeholder={tt('settings.apps.commandPlaceholder')}
            aria-label={tt('settings.apps.command')}
          />
          <Btn variant="primary" type="submit" disabled={!newName.trim() || !newCommand.trim()}>
            {tt('btn.add')}
          </Btn>
        </form>

        <div className="mt-4 flex items-center justify-end">
          <Btn
            variant="primary"
            disabled={!dirty}
            onClick={() => save({ apps: sanitizeApps(draft) })}
          >
            {tt('btn.save')}
          </Btn>
        </div>
      </Card>
    </div>
  );
}

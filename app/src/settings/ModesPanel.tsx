// ModesPanel (Ultron port row 1): workspace-mode presets (Settings.workspaceModes)
// with add/edit/remove, plus a per-mode "Run now" that calls the SAME bridge
// tool the voice agent uses (POST /api/tools/workspace_mode) and shows what
// launched. Edits happen on a local draft; Save persists via SaveFn (same
// pattern as AppsPanel). Pure list logic lives in modesModel.ts.
//
// Run now only enables for rows that exist in the SAVED settings — the bridge
// resolves the bundle from the persisted settings in main, not from this draft.

import { useEffect, useState } from 'react';
import type { Settings, WorkspaceModeRunData } from '../shared/types';
import { fromWorkspaceModes, modesReducer, sanitizeModes, type ModesAction, type WorkspaceModeDraft } from './modesModel';
import { runWorkspaceMode } from './bridgeClient';
import { Badge, Btn, Card, Tt, inputCls } from './ui';
import type { SaveFn } from './types';

type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; name: string }
  | { phase: 'ok'; name: string; summary: string; data: WorkspaceModeRunData | null }
  | { phase: 'error'; name: string; summary: string; denied: boolean };

export default function ModesPanel({
  settings,
  tt,
  save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  const saved = settings.workspaceModes ?? [];
  const [draft, setDraft] = useState<WorkspaceModeDraft[]>(fromWorkspaceModes(saved));
  const [newName, setNewName] = useState('');
  const [newAliases, setNewAliases] = useState('');
  const [newApps, setNewApps] = useState('');
  const [newUrls, setNewUrls] = useState('');
  const [run, setRun] = useState<RunState>({ phase: 'idle' });

  useEffect(() => setDraft(fromWorkspaceModes(settings.workspaceModes ?? [])), [settings.workspaceModes]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(fromWorkspaceModes(saved));
  const savedNames = new Set(saved.map((mode) => mode.name));

  const dispatch = (action: ModesAction) => {
    setDraft(modesReducer(draft, action).modes);
  };

  const onAdd = () => {
    const result = modesReducer(draft, {
      type: 'add',
      name: newName,
      aliases: newAliases,
      apps: newApps,
      urls: newUrls,
    });
    if (result.error) return; // Add stays honest — the inputs keep their text
    setDraft(result.modes);
    setNewName('');
    setNewAliases('');
    setNewApps('');
    setNewUrls('');
  };

  const onRun = async (name: string) => {
    setRun({ phase: 'running', name });
    const result = await runWorkspaceMode(name);
    setRun(
      result.ok
        ? { phase: 'ok', name, summary: result.summary, data: result.data }
        : { phase: 'error', name, summary: result.summary, denied: result.denied },
    );
  };

  return (
    <div className="stagger space-y-4">
      <Card
        micro={tt('settings.micro.modes')}
        title={tt('settings.modes')}
        help={tt('settings.modes.help')}
        right={dirty ? <Badge tone="accent">{tt('settings.modes.dirtyHint')}</Badge> : undefined}
      >
        {draft.length === 0 ? (
          <p className="text-xs text-zinc-500">{tt('settings.modes.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {draft.map((mode, index) => {
              const runnable = savedNames.has(mode.name) && run.phase !== 'running';
              const isRunning = run.phase === 'running' && run.name === mode.name;
              return (
                <li key={mode.id || index} className="glass-row space-y-2 px-3 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={mode.name}
                      onChange={(e) => dispatch({ type: 'update', index, field: 'name', value: e.target.value })}
                      className={`${inputCls} w-40 font-medium`}
                      aria-label={tt('settings.modes.name')}
                      placeholder={tt('settings.modes.namePlaceholder')}
                    />
                    <div className="flex-1" />
                    <Btn
                      variant="primary"
                      disabled={!runnable || !savedNames.has(mode.name)}
                      onClick={() => void onRun(mode.name)}
                    >
                      {isRunning ? '…' : tt('settings.modes.runNow')}
                    </Btn>
                    <Btn variant="danger" onClick={() => dispatch({ type: 'remove', index })}>
                      {tt('btn.remove')}
                    </Btn>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <input
                      value={mode.aliases}
                      onChange={(e) => dispatch({ type: 'update', index, field: 'aliases', value: e.target.value })}
                      className={inputCls}
                      aria-label={tt('settings.modes.aliases')}
                      placeholder={tt('settings.modes.aliasesPlaceholder')}
                    />
                    <input
                      value={mode.apps}
                      onChange={(e) => dispatch({ type: 'update', index, field: 'apps', value: e.target.value })}
                      className={`${inputCls} font-mono text-xs`}
                      aria-label={tt('settings.modes.apps')}
                      placeholder={tt('settings.modes.appsPlaceholder')}
                    />
                    <input
                      value={mode.urls}
                      onChange={(e) => dispatch({ type: 'update', index, field: 'urls', value: e.target.value })}
                      className={`${inputCls} font-mono text-xs`}
                      aria-label={tt('settings.modes.urls')}
                      placeholder={tt('settings.modes.urlsPlaceholder')}
                    />
                  </div>
                  {!savedNames.has(mode.name) && (
                    <p className="text-[11px] text-zinc-500">{tt('settings.modes.unsavedRunHint')}</p>
                  )}
                  {run.phase === 'ok' && run.name === mode.name && (
                    <div
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200"
                      data-testid={`mode-run-ok-${mode.id}`}
                    >
                      <p className="break-words">{run.summary}</p>
                      {run.data && (run.data.launched.length > 0 || run.data.opened.length > 0) && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {[...run.data.launched, ...run.data.opened].map((item) => (
                            <span
                              key={item}
                              className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      )}
                      {run.data && run.data.skipped && run.data.skipped.length > 0 && (
                        <p className="mt-1.5 text-[11px] text-amber-300">
                          {run.data.skipped.map((s) => `${s.name}: ${s.reason}`).join('; ')}
                        </p>
                      )}
                    </div>
                  )}
                  {run.phase === 'error' && run.name === mode.name && (
                    <p className="rounded-lg border border-amber-800/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                      {run.denied ? tt('settings.modes.denied') : errorText(run.summary, tt)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form
          className="mt-4 space-y-2 border-t border-white/[0.08] pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            onAdd();
          }}
        >
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={`${inputCls} w-40`}
              placeholder={tt('settings.modes.namePlaceholder')}
              aria-label={tt('settings.modes.name')}
            />
            <input
              value={newAliases}
              onChange={(e) => setNewAliases(e.target.value)}
              className={`${inputCls} flex-1`}
              placeholder={tt('settings.modes.aliasesPlaceholder')}
              aria-label={tt('settings.modes.aliases')}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              value={newApps}
              onChange={(e) => setNewApps(e.target.value)}
              className={`${inputCls} flex-1 font-mono text-xs`}
              placeholder={tt('settings.modes.appsPlaceholder')}
              aria-label={tt('settings.modes.apps')}
            />
            <input
              value={newUrls}
              onChange={(e) => setNewUrls(e.target.value)}
              className={`${inputCls} flex-1 font-mono text-xs`}
              placeholder={tt('settings.modes.urlsPlaceholder')}
              aria-label={tt('settings.modes.urls')}
            />
            <Btn variant="primary" type="submit" disabled={!newName.trim() || !newAliases.trim()}>
              {tt('btn.add')}
            </Btn>
          </div>
        </form>

        <div className="mt-4 flex items-center justify-end">
          <Btn
            variant="primary"
            disabled={!dirty}
            onClick={() => save({ workspaceModes: sanitizeModes(draft) })}
          >
            {tt('btn.save')}
          </Btn>
        </div>
      </Card>
    </div>
  );
}

/** Map a failed run to honest copy: offline / denial / raw summary. */
function errorText(summary: string, tt: Tt): string {
  if (summary === 'bridge-offline') return tt('settings.bridgeOffline');
  if (summary === 'empty') return tt('settings.modes.runFailed');
  return summary;
}

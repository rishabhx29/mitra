// MemoryPanel (Ultron port row 5): viewer for the Cerebro-lite store
// (userData/mitra-memory.json). Lists entries, searches via the SAME scored
// `recall` action the voice agent uses, adds facts through `remember`, deletes
// through `forget` — all via the ACL-gated /api/tools/memory bridge path (so a
// disabled Notion permission surfaces as a denial here too). Pure entry
// validation/ordering lives in memoryModel.ts.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { MemoryEntry, Settings } from '../shared/types';
import { forgetEntry, listMemoryEntries, recallMemoryEntries, rememberEntry } from './bridgeClient';
import { sortByNewest } from './memoryModel';
import { formatClock } from './transcriptModel';
import { Badge, Btn, Card, Tt, inputCls } from './ui';
import type { SaveFn } from './types';

type LoadError = { tone: 'offline' | 'denied' | 'other'; detail: string };

export default function MemoryPanel({
  settings: _settings,
  tt,
  save: _save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemoryEntry[] | null>(null); // non-null while a search is shown
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const result = await listMemoryEntries();
    setBusy(false);
    if (result.ok) {
      setEntries(sortByNewest(result.entries));
      setError(null);
    } else {
      setEntries([]);
      setError(toLoadError(result.summary, result.denied));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSearch = async () => {
    const q = query.trim();
    setBusy(true);
    const result = await recallMemoryEntries(q);
    setBusy(false);
    if (result.ok) {
      setResults(result.entries); // server-scored order — NOT re-sorted here
      setError(null);
    } else {
      setError(toLoadError(result.summary, result.denied));
    }
  };

  const onAdd = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const result = await rememberEntry(trimmed);
    setBusy(false);
    if (result.ok) {
      setText('');
      setError(null);
      setResults(null); // a fresh fact belongs in the full list
      await load();
      return;
    }
    setError(toLoadError(result.summary, result.denied));
  };

  const onForget = async (id: string) => {
    setBusy(true);
    const result = await forgetEntry(id);
    setBusy(false);
    if (result.ok) {
      setError(null);
      setEntries((prev) => prev?.filter((e) => e.id !== id) ?? prev);
      setResults((prev) => prev?.filter((e) => e.id !== id) ?? prev);
      return;
    }
    setError(toLoadError(result.summary, result.denied));
  };

  const searching = results !== null;
  const rows = searching ? results : entries;

  const onSubmitSearch = (e: FormEvent) => {
    e.preventDefault();
    void onSearch();
  };

  return (
    <div className="stagger space-y-4">
      <Card
        micro={tt('settings.micro.memory')}
        title={tt('settings.memory')}
        help={tt('settings.memory.help')}
        right={<Badge tone="accent">{tt('settings.memory.badge')}</Badge>}
      >
        <ErrorLine error={error} tt={tt} />

        <form className="mb-3 flex items-center gap-2" onSubmit={onSubmitSearch}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={inputCls}
            placeholder={tt('settings.memory.searchPlaceholder')}
            aria-label={tt('settings.memory.searchPlaceholder')}
          />
          <Btn type="submit" disabled={busy}>
            {tt('settings.memory.search')}
          </Btn>
          {searching && (
            <Btn onClick={() => setResults(null)} disabled={busy}>
              {tt('settings.memory.showAll')}
            </Btn>
          )}
        </form>

        {rows === null ? (
          <p className="py-2 text-xs text-zinc-500">…</p>
        ) : rows.length === 0 ? (
          <p className="py-2 text-xs text-zinc-500">
            {searching ? tt('settings.memory.noResults') : tt('settings.memory.empty')}
          </p>
        ) : (
          <>
            <p className="mb-2 text-[11px] text-zinc-500">
              {rows.length} {searching ? tt('settings.memory.matches') : tt('settings.memory.entries')}
            </p>
            <ul className="max-h-72 space-y-1 overflow-y-auto pr-1" data-testid="mitra-memory-list">
              {rows.map((entry) => (
                <li key={entry.id} className="glass-row flex items-baseline gap-3 px-3 py-2 text-sm text-zinc-200">
                  <span className="flex-1 break-words">{entry.text}</span>
                  {entry.ts > 0 && (
                    <time
                      className="shrink-0 font-mono text-[10px] text-zinc-600"
                      dateTime={new Date(entry.ts).toISOString()}
                    >
                      {formatClock(entry.ts)}
                    </time>
                  )}
                  <Btn variant="danger" onClick={() => void onForget(entry.id)} disabled={busy}>
                    {tt('settings.memory.forget')}
                  </Btn>
                </li>
              ))}
            </ul>
          </>
        )}

        <form
          className="mt-4 flex items-center gap-2 border-t border-white/[0.08] pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onAdd();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={inputCls}
            placeholder={tt('settings.memory.addPlaceholder')}
            aria-label={tt('settings.memory.add')}
          />
          <Btn variant="primary" type="submit" disabled={!text.trim() || busy}>
            {tt('settings.memory.add')}
          </Btn>
          <Btn onClick={() => void load()} disabled={busy}>
            {tt('btn.refresh')}
          </Btn>
        </form>
      </Card>
    </div>
  );
}

function toLoadError(summary: string, denied: boolean): LoadError {
  if (summary === 'bridge-offline') return { tone: 'offline', detail: summary };
  if (denied) return { tone: 'denied', detail: summary };
  return { tone: 'other', detail: summary };
}

function ErrorLine({ error, tt }: { error: LoadError | null; tt: Tt }) {
  if (!error) return null;
  const text =
    error.tone === 'offline'
      ? tt('settings.bridgeOffline')
      : error.tone === 'denied'
        ? tt('settings.memory.denied')
        : error.detail;
  return (
    <p className="mb-3 rounded-lg border border-amber-800/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
      {text}
    </p>
  );
}

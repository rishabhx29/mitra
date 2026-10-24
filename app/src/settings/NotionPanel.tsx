// NotionPanel (Task E): the mock to-do board view. Reads via the new
// GET /api/notion/items bridge route, adds through the same ACL-gated
// /api/tools/notion_add_todo path the voice agent uses (so a disabled
// permission surfaces as a denial here too). When settings.notion.mock is
// false (real Notion configured) it shows a "connected" badge instead.

import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '../shared/types';
import { addBoardItem, fetchBoardItems, type BoardItem } from './bridgeClient';
import { formatClock } from './transcriptModel';
import { Badge, Btn, Card, Tt, inputCls } from './ui';
import type { SaveFn } from './types';

type LoadError = { tone: 'offline' | 'denied' | 'other'; detail: string };

export default function NotionPanel({
  settings,
  tt,
  save: _save,
}: {
  settings: Settings;
  tt: Tt;
  save: SaveFn;
}) {
  if (!settings.notion.mock) {
    return (
      <Card
        micro={tt('settings.micro.notion')}
        title={tt('settings.notion')}
        right={<Badge tone="ok">{tt('settings.notion.connected')}</Badge>}
      >
        <p className="text-xs leading-relaxed text-zinc-400">{tt('settings.notion.connectedHelp')}</p>
      </Card>
    );
  }
  return <MockBoard tt={tt} notionEnabled={settings.permissions.notion} />;
}

function MockBoard({ tt, notionEnabled }: { tt: Tt; notionEnabled: boolean }) {
  const [items, setItems] = useState<BoardItem[] | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const result = await fetchBoardItems();
    setBusy(false);
    if (result.ok) {
      setItems(result.items);
      setError(null);
    } else {
      setItems([]);
      setError({ tone: result.summary === 'bridge-offline' ? 'offline' : 'other', detail: result.summary });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onAdd = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const result = await addBoardItem(trimmed);
    setBusy(false);
    if (result.ok) {
      setText('');
      setError(null);
      await load();
      return;
    }
    if (result.denied) {
      setError({ tone: 'denied', detail: result.summary });
      return;
    }
    setError({ tone: result.summary === 'bridge-offline' ? 'offline' : 'other', detail: result.summary });
  };

  return (
    <Card
      micro={tt('settings.micro.notion')}
      title={tt('settings.notion')}
      right={<Badge tone="accent">{tt('settings.notion.mockBadge')}</Badge>}
    >
      <ErrorLine error={error} tt={tt} />

      {items === null ? (
        <p className="py-2 text-xs text-zinc-500">…</p>
      ) : items.length === 0 ? (
        <p className="py-2 text-xs text-zinc-500">{tt('settings.notion.empty')}</p>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-zinc-500">
            {items.length} {tt('settings.notion.items')}
          </p>
          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {items.map((item) => (
              <li
                key={item.id}
                className="glass-row flex items-baseline gap-3 px-3 py-2 text-sm text-zinc-200"
              >
                <span className="flex-1 break-words">{item.text}</span>
                <time className="shrink-0 font-mono text-[10px] text-zinc-600" dateTime={item.createdAt}>
                  {formatClock(new Date(item.createdAt).getTime())}
                </time>
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
          placeholder={tt('settings.notion.itemPlaceholder')}
          aria-label={tt('settings.notion.add')}
        />
        <Btn variant="primary" type="submit" disabled={!text.trim() || busy || !notionEnabled}>
          {tt('settings.notion.add')}
        </Btn>
        <Btn onClick={() => void load()} disabled={busy}>
          {tt('settings.notion.refresh')}
        </Btn>
      </form>
    </Card>
  );
}

function ErrorLine({ error, tt }: { error: LoadError | null; tt: Tt }) {
  if (!error) return null;
  const text =
    error.tone === 'offline'
      ? tt('settings.notion.bridgeOffline')
      : error.tone === 'denied'
        ? tt('settings.notion.denied')
        : error.detail;
  return (
    <p className="mb-3 rounded-lg border border-amber-800/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
      {text}
    </p>
  );
}

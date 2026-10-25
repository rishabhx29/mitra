// ModesPanel state logic (Ultron port row 1): pure reducer over the
// workspace-mode draft list (shared/types.ts WorkspaceMode[]). No React / DOM —
// unit-tested in node (modesModel.test.ts), same split as appsModel.ts.

import type { WorkspaceMode } from '../shared/types';

/**
 * A mode row as edited in the panel: the three lists are comma-separated
 * strings so one <input> per field stays as light as the Apps panel rows.
 */
export interface WorkspaceModeDraft {
  id: string;
  name: string;
  aliases: string;
  apps: string;
  urls: string;
}

export type ModesAction =
  | { type: 'add'; name: string; aliases: string; apps: string; urls: string }
  | { type: 'update'; index: number; field: 'name' | 'aliases' | 'apps' | 'urls'; value: string }
  | { type: 'remove'; index: number };

export interface ModesEditResult {
  modes: WorkspaceModeDraft[];
  /** 'empty' = name or aliases missing; 'dup' = another mode already has that name. */
  error?: 'empty' | 'dup';
}

/** Comma-separated field → trimmed, de-duplicated list (empty items dropped). */
export function splitList(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const item = part.trim();
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

/** List → comma-separated field (inverse of splitList). */
export function joinList(list: string[]): string {
  return list.join(', ');
}

/** Saved mode → draft row (lists flattened for the inputs). */
export function fromWorkspaceModes(modes: WorkspaceMode[]): WorkspaceModeDraft[] {
  return modes.map((mode) => ({
    id: mode.id,
    name: mode.name,
    aliases: joinList(mode.aliases),
    apps: joinList(mode.apps),
    urls: joinList(mode.urls),
  }));
}

/** URL-friendly slug of a mode name ('Chill Vibes!' → 'chill-vibes'); '' if none. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}

/** First free id from a slug base ('coding', 'coding-2', 'coding-3', …). */
export function freshId(name: string, takenIds: ReadonlySet<string>): string {
  const base = slugify(name) || 'mode';
  if (!takenIds.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!takenIds.has(candidate)) return candidate;
  }
}

/** Draft row → saved mode, or null when it has no name or no aliases yet. */
export function toWorkspaceMode(draft: WorkspaceModeDraft): WorkspaceMode | null {
  const name = draft.name.trim();
  const aliases = splitList(draft.aliases);
  if (!name || aliases.length === 0) return null;
  const id = draft.id.trim() || freshId(name, new Set());
  return { id, name, aliases, apps: splitList(draft.apps), urls: splitList(draft.urls) };
}

/** Normalize a draft list for persistence: drop empty rows, enforce unique ids. */
export function sanitizeModes(drafts: WorkspaceModeDraft[]): WorkspaceMode[] {
  const seen = new Set<string>();
  const out: WorkspaceMode[] = [];
  for (const draft of drafts) {
    const mode = toWorkspaceMode(draft);
    if (!mode) continue;
    if (seen.has(mode.id)) continue; // keep the first — later dupes are dropped
    seen.add(mode.id);
    out.push(mode);
  }
  return out;
}

/**
 * Add/update/remove over the draft list. Add validates (name + ≥1 alias, name
 * unique case-insensitively) and mints an id; updates stay permissive while
 * typing (sanitizeModes cleans up at save time), mirroring appsReducer.
 */
export function modesReducer(drafts: WorkspaceModeDraft[], action: ModesAction): ModesEditResult {
  switch (action.type) {
    case 'add': {
      const name = action.name.trim();
      if (!name || splitList(action.aliases).length === 0) {
        return { modes: drafts, error: 'empty' };
      }
      const dup = drafts.some((d) => d.name.trim().toLowerCase() === name.toLowerCase());
      if (dup) return { modes: drafts, error: 'dup' };
      const ids = new Set(drafts.map((d) => d.id.trim()).filter(Boolean));
      return {
        modes: [
          ...drafts,
          {
            id: freshId(name, ids),
            name,
            // Normalize the list fields once at creation (per-keystroke updates
            // stay permissive; save-time sanitizeModes re-normalizes anyway).
            aliases: joinList(splitList(action.aliases)),
            apps: joinList(splitList(action.apps)),
            urls: joinList(splitList(action.urls)),
          },
        ],
      };
    }
    case 'update': {
      if (action.index < 0 || action.index >= drafts.length) return { modes: drafts };
      return {
        modes: drafts.map((draft, i) =>
          i === action.index ? { ...draft, [action.field]: action.value } : draft,
        ),
      };
    }
    case 'remove': {
      if (action.index < 0 || action.index >= drafts.length) return { modes: drafts };
      return { modes: drafts.filter((_, i) => i !== action.index) };
    }
  }
}

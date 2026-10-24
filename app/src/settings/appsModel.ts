// AppsPanel state logic (Task E): pure reducer over the launcher alias list
// (shared/types.ts AppAlias[]). No React / DOM — unit-tested in node
// (appsModel.test.ts).

import type { AppAlias } from '../shared/types';

export type AppsAction =
  | { type: 'add'; name: string; command: string }
  | { type: 'update'; index: number; name?: string; command?: string }
  | { type: 'remove'; index: number };

export interface AppsEditResult {
  apps: AppAlias[];
  /** Set when the action was ignored (empty alias, out-of-range index). */
  error?: 'settings.apps.empty';
}

/** Add/update/remove with trimming; empty aliases are rejected, never thrown. */
export function appsReducer(apps: AppAlias[], action: AppsAction): AppsEditResult {
  switch (action.type) {
    case 'add': {
      const name = action.name.trim();
      const command = action.command.trim();
      if (!name || !command) return { apps, error: 'settings.apps.empty' };
      return { apps: [...apps, { name, command }] };
    }
    case 'update': {
      if (action.index < 0 || action.index >= apps.length) return { apps };
      const name = action.name !== undefined ? action.name : apps[action.index]!.name;
      const command = action.command !== undefined ? action.command : apps[action.index]!.command;
      // Permissive while typing (clearing a field mid-edit must not snap back);
      // sanitizeApps trims and drops empties at save time.
      return { apps: apps.map((app, i) => (i === action.index ? { name, command } : app)) };
    }
    case 'remove': {
      if (action.index < 0 || action.index >= apps.length) return { apps };
      return { apps: apps.filter((_, i) => i !== action.index) };
    }
  }
}

/** Normalize a draft for persistence: trim fields, drop rows missing name or command. */
export function sanitizeApps(apps: AppAlias[]): AppAlias[] {
  return apps
    .map((app) => ({ name: app.name.trim(), command: app.command.trim() }))
    .filter((app) => app.name !== '' && app.command !== '');
}

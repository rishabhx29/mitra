// appIndex — resolve ANY installed application by name (plan §2b): scans the
// Start-Menu shortcut directories once, building a normalized name → .lnk path
// index. Windows resolves .lnk targets natively when the shortcut is started,
// so launching = `start "" "<lnk path>"`. Pure helpers are exported for tests;
// the scanner takes injected fs/dir listing so vitest stays in node-env.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface AppEntry {
  /** Display name without extension, as found on disk ("Google Chrome"). */
  name: string;
  /** Absolute .lnk path. */
  path: string;
  /** Normalized match key. */
  key: string;
}

/** The once-built Start-Menu index (entries + lookup maps). */
export interface AppIndex {
  entries: AppEntry[];
  byKey: Map<string, AppEntry>;
  byCompact: Map<string, AppEntry>;
}

export interface FsLike {
  existsSync(path: string): boolean;
  readdirSync(path: string, opts: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>;
}

export const defaultAppFs: FsLike = { existsSync, readdirSync };

/** normalize("Google-Chrome (x86)") → "google chrome x86" — comparable keys. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(lnk|url)$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Start-Menu roots (all-users + per-user). Non-Windows returns []. */
export function startMenuDirs(home: string, programData = 'C:\\ProgramData'): string[] {
  if (process.platform !== 'win32') return [];
  return [
    join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
}

/** Walk a directory tree collecting .lnk paths (depth-capped; Start Menus are shallow). */
function collectLnks(fs: FsLike, dir: string, depth: number, out: string[]): void {
  if (depth > 4 || !fs.existsSync(dir)) return;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir → skip silently
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectLnks(fs, full, depth + 1, out);
    } else if (/\.lnk$/i.test(entry.name)) {
      out.push(full);
    }
  }
}

/** Build the index once per bridge start; lazy-refresh is the caller's choice. */
export function buildAppIndex(
  dirs: string[],
  fs: FsLike = defaultAppFs,
): AppIndex {
  const lnks: string[] = [];
  for (const dir of dirs) collectLnks(fs, dir, 0, lnks);
  const entries: AppEntry[] = lnks.map((path) => {
    const name = path.split(/[\\/]/).pop()?.replace(/\.lnk$/i, '') ?? path;
    return { name, path, key: normalizeName(name) };
  });
  const byKey = new Map(entries.map((e) => [e.key, e]));
  return { entries, byKey, byCompact: new Map(entries.map((e) => [compactKey(e.key), e])) };
}

/** Compact key: normalizeName with ALL spaces dropped — "WorkBuddy AI" and "work buddy" both → "workbuddyai"/"workbuddy". */
export function compactKey(normalized: string): string {
  return normalized.replace(/\s+/g, '');
}

/**
 * Fuzzy match: exact key → key startsWith query → query startsWith key →
 * containment. Returns matches ordered by score; empty when nothing plausible.
 */
export function matchApp(
  index: AppIndex,
  query: string,
): AppEntry[] {
  const q = normalizeName(query);
  if (!q) return [];
  const exact = index.byKey.get(q);
  if (exact) return [exact];
  // Space-insensitive tier: "work buddy" must find "WorkBuddy AI" — compare
  // compact (space-dropped) keys with the same startsWith/contains tiers.
  const cq = compactKey(q);
  const compactExact = index.byCompact.get(cq);
  if (compactExact) return [compactExact];
  const scored = index.entries
    .map((e) => {
      const ck = compactKey(e.key);
      if (ck.startsWith(cq)) return { e, score: 3 - ck.length / 100 };
      if (cq.startsWith(ck) && ck.length >= 3) return { e, score: 2 };
      if (ck.includes(cq)) return { e, score: 1 };
      // Keep the space-aware tiers too (they win on word-boundary quality).
      if (e.key.startsWith(q)) return { e, score: 2.5 - e.key.length / 100 };
      if (q.startsWith(e.key) && e.key.length >= 3) return { e, score: 2 };
      if (e.key.includes(q)) return { e, score: 1 };
      return null;
    })
    .filter((v): v is { e: AppEntry; score: number } => v !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return scored.map((s) => s.e);
}

/** Close-app exe guess: "Google Chrome.lnk" → "chrome" (taskkill /IM chrome.exe). */
export function exeGuess(lnkName: string): string {
  const words = normalizeName(lnkName)
    .split(' ')
    .filter((w) => !['x86', 'x64', 'client', 'app'].includes(w));
  const last = words.at(-1) ?? normalizeName(lnkName).replace(/\s+/g, '');
  return last.replace(/\s+/g, '');
}

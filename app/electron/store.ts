// Settings persistence: atomic JSON read/write at <userData>/mitra-settings.json.
// The Electron `app` module is injected (as a path provider) so vitest can pass a fake
// path — this module never imports electron.
import { readFileSync, renameSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z, type ZodType } from 'zod';
import { DEFAULT_SETTINGS, type AppAlias, type NotionConfig, type Permissions, type Settings } from '../src/shared/types';

// ---- zod schema (mirrors shared/types.ts Settings exactly) ----

export const AppAliasSchema: z.ZodType<AppAlias> = z.object({
  name: z.string(),
  command: z.string(),
});

export const NotionConfigSchema: z.ZodType<NotionConfig> = z.union([
  z.object({ mock: z.literal(true) }),
  z.object({ mock: z.literal(false), token: z.string(), databaseId: z.string() }),
]);

export const PermissionsSchema: z.ZodType<Permissions> = z.object({
  notion: z.boolean(),
  launcher: z.boolean(),
  terminal: z.boolean(),
  browser: z.boolean(),
});

export const SettingsSchema: z.ZodType<Settings> = z.object({
  persona: z.enum(['orb', 'avatar']),
  orbColors: z.object({ a: z.string(), b: z.string() }),
  hotkey: z.string().min(1),
  language: z.enum(['en', 'hi']),
  permissions: PermissionsSchema,
  apps: z.array(AppAliasSchema),
  notion: NotionConfigSchema,
});

/**
 * Sanitize untrusted input (corrupt file, partial JSON, older versions) into a valid
 * Settings. Each field degrades independently to its default — a single bad field never
 * nukes the rest (mock-mode rule: never throw, degrade gracefully).
 */
export function sanitizeSettings(input: unknown): Settings {
  if (input === null || typeof input !== 'object') return { ...DEFAULT_SETTINGS };
  const raw = input as Record<string, unknown>;
  return {
    persona: pick(z.enum(['orb', 'avatar']), raw['persona'], DEFAULT_SETTINGS.persona),
    orbColors: pick(
      z.object({ a: z.string(), b: z.string() }),
      raw['orbColors'],
      DEFAULT_SETTINGS.orbColors,
    ),
    hotkey: pick(z.string().min(1), raw['hotkey'], DEFAULT_SETTINGS.hotkey),
    language: pick(z.enum(['en', 'hi']), raw['language'], DEFAULT_SETTINGS.language),
    permissions: pick(PermissionsSchema, raw['permissions'], DEFAULT_SETTINGS.permissions),
    apps: pick(z.array(AppAliasSchema), raw['apps'], DEFAULT_SETTINGS.apps),
    notion: pick(NotionConfigSchema, raw['notion'], DEFAULT_SETTINGS.notion),
  };
}

function pick<T>(schema: ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

// ---- store ----

export interface SettingsStore {
  /** Load settings from disk, degrading to defaults (or per-field defaults) when absent/corrupt. */
  load(): Settings;
  /** Persist settings atomically (temp file + rename). Returns false when invalid or write failed. */
  save(settings: Settings): boolean;
  /** Absolute path of the settings file. */
  readonly path: string;
}

export interface SettingsStoreDeps {
  /** Electron main passes `app` itself; tests pass `{ getPath: () => fakeDir }`. */
  app: { getPath(name: 'userData'): string };
  /** Injected for testability; defaults to real node fs. */
  fs?: SettingsFs;
  fileName?: string;
}

/** The subset of node:fs the store needs. */
export interface SettingsFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf-8'): string;
  writeFileSync(path: string, data: string): void;
  renameSync(from: string, to: string): void;
  mkdirSync(path: string, options: { recursive: true }): void;
  unlinkSync(path: string): void;
}

export const defaultFs: SettingsFs = {
  existsSync,
  readFileSync: (p, _enc) => readFileSync(p, 'utf-8'),
  writeFileSync: (p, d) => writeFileSync(p, d, 'utf-8'),
  renameSync,
  mkdirSync,
  unlinkSync,
};

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStore {
  const fs = deps.fs ?? defaultFs;
  const fileName = deps.fileName ?? 'mitra-settings.json';
  const dir = deps.app.getPath('userData');
  const path = join(dir, fileName);

  const load = (): Settings => {
    try {
      if (!fs.existsSync(path)) return { ...DEFAULT_SETTINGS };
      const text = fs.readFileSync(path, 'utf-8');
      return sanitizeSettings(JSON.parse(text) as unknown);
    } catch (error) {
      // Corrupt JSON / unreadable file → defaults. Never throw on bad environment.
      console.warn(`[mitra] settings load failed, using defaults: ${String(error)}`);
      return { ...DEFAULT_SETTINGS };
    }
  };

  const save = (settings: Settings): boolean => {
    const parsed = SettingsSchema.safeParse(settings);
    if (!parsed.success) {
      console.warn(`[mitra] refusing to save invalid settings: ${parsed.error.message}`);
      return false;
    }
    // Atomic write: write to a temp sibling, then rename over the target. A crash mid-write
    // can never leave a truncated settings file.
    const tmp = `${path}.tmp`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(parsed.data, null, 2));
      fs.renameSync(tmp, path);
      return true;
    } catch (error) {
      console.warn(`[mitra] settings save failed: ${String(error)}`);
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch {
        /* best-effort cleanup */
      }
      return false;
    }
  };

  return { load, save, path };
}

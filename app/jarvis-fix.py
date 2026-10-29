import io
import re

# ============ 1. launcher.ts: universal resolver (alias -> Start-Menu index -> shell) ============
p = 'src/server/tools/launcher.ts'
s = io.open(p, encoding='utf-8').read()

old = """export interface LaunchAppDeps {
  apps: AppAlias[];
  exec?: ExecLike;
}"""
new = """export interface LaunchAppDeps {
  apps: AppAlias[];
  exec?: ExecLike;
  /** Start-Menu dirs for the universal resolver (plan §2b): ANY installed app. */
  appIndexDirs?: string[];
  appFs?: import('./appIndex').FsLike;
}"""
assert old in s, 'deps'
s = s.replace(old, new)

# import index helpers
old = "import type { AppAlias } from '../../shared/types';"
new = "import type { AppAlias } from '../../shared/types';\nimport { buildAppIndex, matchApp } from './appIndex';"
assert old in s, 'imports'
s = s.replace(old, new)

# resolver inside the tool: alias miss -> index -> shell fallback
old = """    const alias = deps.apps.find((a) => a.name.toLowerCase() === raw.toLowerCase());
    if (!alias) {
      return {
        ok: false,
        summary: `Unknown app "${raw}". Available apps: ${available}`,
        data: { apps: deps.apps },
      };
    }
    let res: ExecResultLike;
    try {
      res = await exec(alias.command);"""
new = """    // 1) configured alias (existing behavior)
    const alias = deps.apps.find((a) => a.name.toLowerCase() === raw.toLowerCase());
    if (alias) {
      let res0: ExecResultLike;
      try {
        res0 = await exec(alias.command);
      } catch (err) {
        return {
          ok: false,
          summary: `Failed to launch ${alias.name}: ${err instanceof Error ? err.message : String(err)}`,
          data: { apps: deps.apps },
        };
      }
      if (res0.code === 0) {
        return { ok: true, summary: `Opening ${alias.name}`, data: { apps: deps.apps } };
      }
      // alias command failed -> keep trying the universal resolver below
    }

    // 2) universal resolver: ANY installed app via the Start-Menu index
    if (deps.appIndexDirs && deps.appIndexDirs.length > 0) {
      const index = buildAppIndex(deps.appIndexDirs, deps.appFs);
      const matches = matchApp(index, raw);
      if (matches.length > 0) {
        const target = matches[0];
        try {
          const resLnk = await exec(`start "" "${target.path}"`);
          if (resLnk.code === 0) {
            return { ok: true, summary: `Opening ${target.name}`, data: { apps: deps.apps } };
          }
        } catch {
          /* fall through to shell fallback */
        }
      }
    }

    // 3) shell fallback for registered app execution aliases (winget installs,
    //    Store apps) - sanitized: no quotes/semicolons/pipes in the name.
    const safe = raw.replace(/[";|&`]/g, '');
    if (safe && safe === raw) {
      try {
        const resShell = await exec(`start "" ${safe}`);
        if (resShell.code === 0) {
          return { ok: true, summary: `Opening ${raw}` };
        }
      } catch {
        /* final miss below */
      }
    }

    if (!alias) {
      // closest-match hints from the index so "chrome" suggests "Google Chrome"
      let hints = '';
      if (deps.appIndexDirs && deps.appIndexDirs.length > 0) {
        try {
          const index = buildAppIndex(deps.appIndexDirs, deps.appFs);
          const near = matchApp(index, raw)
            .slice(0, 3)
            .map((m) => m.name);
          if (near.length > 0) hints = ` Did you mean: ${near.join(', ')}?`;
        } catch {
          /* hints are best-effort */
        }
      }
      return {
        ok: false,
        summary: `Unknown app "${raw}". Available apps: ${available}.${hints}`,
        data: { apps: deps.apps },
      };
    }
    let res: ExecResultLike;
    try {
      res = await exec(alias.command);"""
assert old in s, 'resolver'
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('launcher universal resolver')

# ============ 2. dispatcher: pass appIndexDirs into launch_app ============
p = 'src/server/tools/index.ts'
s = io.open(p, encoding='utf-8').read()
old = "    case 'launch_app':\n      return createLaunchAppTool({ apps: deps.settings().apps, exec: deps.exec });"
new = "    case 'launch_app':\n      return createLaunchAppTool({ apps: deps.settings().apps, exec: deps.exec, appIndexDirs: deps.appIndexDirs, appFs: deps.appFs });"
assert old in s, 'dispatch'
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('dispatcher wired')

# ============ 3. intents.ts: well-known sites -> open_url ============
p = 'src/voice/intents.ts'
s = io.open(p, encoding='utf-8').read()
old = "  const app = parseLaunchAlias(text);\n  if (app) return { kind: 'launch_app', alias: app };"
new = """  // Well-known sites: "open youtube/netflix/github..." opens the SITE, not an
  // app alias (the #1 deterministic miss users hit).
  const site = matchWellKnownSite(text);
  if (site) return { kind: 'open_url', url: site };

  const app = parseLaunchAlias(text);
  if (app) return { kind: 'launch_app', alias: app };"""
assert old in s, 'site branch'
s = s.replace(old, new)

old = "function parseMemory(text: string): MockIntent | null {"
new = """/** Well-known site tokens -> canonical URLs (checked before app aliases). */
const WELL_KNOWN_SITES: Readonly<Record<string, string>> = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  github: 'https://github.com',
  reddit: 'https://www.reddit.com',
  netflix: 'https://www.netflix.com',
  spotify: 'https://open.spotify.com',
  twitter: 'https://x.com',
  x: 'https://x.com',
  instagram: 'https://www.instagram.com',
  whatsapp: 'https://web.whatsapp.com',
  facebook: 'https://www.facebook.com',
  chatgpt: 'https://chatgpt.com',
  amazon: 'https://www.amazon.in',
  flipkart: 'https://www.flipkart.com',
  linkedin: 'https://www.linkedin.com',
};

/** "open youtube" / "youtube kholo" / "go to github" -> canonical URL, else null. */
export function matchWellKnownSite(text: string): string | null {
  const t = text.toLowerCase();
  const hasVerb = /\\b(open|kholo|go\\s+to|visit|launch)\\b/.test(t);
  if (!hasVerb) return null;
  for (const [token, url] of Object.entries(WELL_KNOWN_SITES)) {
    if (new RegExp(`\\\\b${token}\\\\b`).test(t)) return url;
  }
  return null;
}

function parseMemory(text: string): MockIntent | null {"""
assert old in s, 'site map'
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('well-known sites')


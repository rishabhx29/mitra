// open_url — opens an http(s) URL via the injected opener. Non-http(s) schemes
// (javascript:, file:, …) are refused at the bridge so the renderer never becomes
// an arbitrary-scheme launcher. The default opener shells out per-platform.
import process from 'node:process';
import type { ToolOutcome } from './notion';
import { createDefaultExec, type ExecLike } from './launcher';

export type UrlOpener = (url: string) => Promise<void> | void;

export interface OpenUrlDeps {
  opener?: UrlOpener;
  /** Used only to build the default opener. */
  platform?: string;
  exec?: ExecLike;
}

/**
 * Default opener. Windows uses ONE PowerShell invocation that (a) launches the
 * URL through the default handler and (b) FOREGROUNDS the browser's main
 * window — without the raise, a tab lands in an already-running Firefox/Chrome
 * BEHIND the Mitra window and the user sees nothing happen (the "just showing
 * that it's doing so" report). Plain `start "" <url>` cannot do the raise.
 */
export function createDefaultUrlOpener(platform: string, exec: ExecLike): UrlOpener {
  return (url) => {
    if (platform !== 'win32') {
      const command = platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      return exec(command).then((res) => {
        if (res.code !== 0) {
          throw new Error((res.stderr || res.stdout || `exit code ${res.code ?? 'unknown'}`).trim().slice(0, 160));
        }
      });
    }
    const psUrl = url.replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `Start-Process '${psUrl}'`,
      'Start-Sleep -Milliseconds 900',
      "$b = Get-Process firefox,chrome,msedge,brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1",
      'if ($b) { $w = New-Object -ComObject WScript.Shell; $null = $w.AppActivate($b.Id) }',
    ].join('; ');
    return exec(`powershell -NoProfile -STA -WindowStyle Hidden -Command "${script}"`).then((res) => {
      if (res.code !== 0) {
        throw new Error((res.stderr || res.stdout || `exit code ${res.code ?? 'unknown'}`).trim().slice(0, 160));
      }
    });
  };
}

export function createOpenUrlTool(
  deps: OpenUrlDeps = {},
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  const opener =
    deps.opener ?? createDefaultUrlOpener(deps.platform ?? process.platform, deps.exec ?? createDefaultExec());
  return async (args) => {
    const raw = typeof args['url'] === 'string' ? args['url'].trim() : '';
    if (!raw) {
      return { ok: false, summary: 'No URL provided.' };
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, summary: `Not a valid URL: "${raw}"` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, summary: `Refusing to open non-http(s) URL: "${raw}"` };
    }
    const url = parsed.toString();
    // TTS speaks the summary — "opening H T T P S colon slash…" is useless.
    // Name the SITE (youtube.com), never the wire format.
    const pretty = `${parsed.hostname.replace(/^www\./i, '')}${parsed.pathname.replace(/\/$/, '')}`;
    try {
      await opener(url);
      return { ok: true, summary: `Opened ${pretty} in the browser`, data: { url } };
    } catch (err) {
      return {
        ok: false,
        summary: `Failed to open ${pretty}: ${err instanceof Error ? err.message : String(err)}`,
        data: { url },
      };
    }
  };
}

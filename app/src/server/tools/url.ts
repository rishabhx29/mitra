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

/** Default opener: `start "" <url>` on Windows, `open` on macOS, `xdg-open` elsewhere. */
export function createDefaultUrlOpener(platform: string, exec: ExecLike): UrlOpener {
  return (url) => {
    const command =
      platform === 'win32'
        ? `start "" "${url}"`
        : platform === 'darwin'
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    return exec(command).then((res) => {
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
    try {
      await opener(url);
      return { ok: true, summary: `Opened ${url} in the browser`, data: { url } };
    } catch (err) {
      return {
        ok: false,
        summary: `Failed to open ${url}: ${err instanceof Error ? err.message : String(err)}`,
        data: { url },
      };
    }
  };
}

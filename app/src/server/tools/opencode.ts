// run_opencode_task — runs `opencode run --format json --auto <prompt>` when the binary
// is resolvable (OPENCODE_PATH env, then PATH via where/which); otherwise runs an honest
// ~8s simulation with progress callbacks and the summary "simulated (opencode not installed)"
// (plan Review Focus #3 — judges' machines may not have opencode). All spawn/exec/lookup
// adapters are injected so vitest stubs them.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import type { ToolOutcome } from './notion';
import { createDefaultExec, type ExecLike } from './launcher';

export const OPENCODE_RUN_ARGS = ['run', '--format', 'json', '--auto'] as const;
export const DEFAULT_OPENCODE_TIMEOUT_MS = 120_000;
export const DEFAULT_OPENCODE_SIMULATE_MS = 8_000;
/** Exact degradation summary required by the plan (Review Focus #3). */
export const OPENCODE_SIMULATED_SUMMARY = 'simulated (opencode not installed)';

export interface OpencodeSpawnOptions {
  binPath: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
}

export interface OpencodeSpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when the run was killed by the timeout. */
  timedOut: boolean;
  /** True when the idle-after-text early stop resolved the run. */
  earlyStopped?: boolean;
}

export type OpencodeSpawnRunner = (opts: OpencodeSpawnOptions) => Promise<OpencodeSpawnResult>;
export type OpencodeLookup = () => Promise<string | null>;

export interface OpencodeToolDeps {
  lookup?: OpencodeLookup;
  spawn?: OpencodeSpawnRunner;
  /** Used by the default lookup to probe the PATH. */
  exec?: ExecLike;
  env?: Record<string, string | undefined>;
  cwd?: string;
  platform?: string;
  timeoutMs?: number;
  simulateMs?: number;
  /** Injectable timer — tests pass an instant no-op delay. */
  delay?: (ms: number) => Promise<void>;
  progress?: (msg: string) => void;
}

const OUTPUT_TAIL_CHARS = 4_000;

function tail(s: string): string {
  return s.length > OUTPUT_TAIL_CHARS ? `…${s.slice(-OUTPUT_TAIL_CHARS)}` : s;
}

function firstLine(s: string, max = 200): string {
  const line = s
    .split(/\r?\n/)
    .map((t) => t.trim())
    .find(Boolean);
  return line ? line.slice(0, max) : '';
}

/**
 * Default PATH probe: OPENCODE_PATH wins if set; otherwise `where opencode` (Windows)
 * or `which opencode`. On Windows, `where` lists sibling npm shims (bare sh wrapper,
 * .cmd, .ps1) — only .exe/.cmd/.bat are spawnable, so pick those; bare sh wrappers
 * would fail with ENOENT (verified live). Returns null when nothing usable resolves.
 */
export function createDefaultOpencodeLookup(deps: {
  env: Record<string, string | undefined>;
  exec: ExecLike;
  platform: string;
}): OpencodeLookup {
  return async () => {
    const fromEnv = deps.env['OPENCODE_PATH']?.trim();
    if (fromEnv) return fromEnv;
    const probe = deps.platform === 'win32' ? 'where opencode' : 'which opencode';
    try {
      const res = await deps.exec(probe);
      if (res.code !== 0) return null;
      const lines = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) return null;
      if (deps.platform === 'win32') {
        const spawnable =
          lines.find((l) => /\.exe$/i.test(l)) ?? lines.find((l) => /\.(cmd|bat)$/i.test(l));
        return spawnable ?? null;
      }
      return lines[0] ?? null;
    } catch {
      return null;
    }
  };
}

/** Quote an arg for cmd.exe when the binary is a .cmd/.bat shim (npm global installs). */
function winQuote(arg: string): string {
  // eslint-disable-next-line no-useless-escape
  if (/^[\w\-\./:=\\]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * Extract the target an npm .cmd shim wraps. Shims look like either:
 *   node  "%~dp0\node_modules\<pkg>\bin\tool" %*      (node script)
 *   "%dp0%\node_modules\@scope\cli\bin\tool.exe"  %*  (native binary)
 * Returns the absolute target path, or null when nothing plausible is found
 * (the caller then falls back to the buffered shell:true path).
 */
export function nodeScriptFromShim(shimPath: string, text: string): string | null {
  const re = /"(?:%~dp0|%dp0%)(\\[^"\r\n]+?)"?\s*%/g;
  const dir = shimPath.slice(0, Math.max(shimPath.lastIndexOf('\\'), shimPath.lastIndexOf('/')));
  for (const m of text.matchAll(re)) {
    if (!m[1]) continue;
    const target = `${dir}${m[1]}`;
    if (/\.(exe|js|mjs|cjs)$/i.test(target) && existsSync(target)) return target;
  }
  return null;
}

/**
 * Default spawn adapter: child_process.spawn with a hard timeout.
 *
 * VERIFIED LIVE: through `shell:true` (required for npm .cmd shims), cmd.exe
 * buffers the child's entire stdout until the process dies — the answer lands
 * at the ~2-minute timeout instead of the ~3s it actually took, so no idle
 * stop can ever see it. For .cmd shims we therefore PARSE the shim and spawn
 * its node script directly (ELECTRON_RUN_AS_NODE turns Electron's own binary
 * into a plain node): output streams, and the text-part idle stop fires. Any
 * parse/read failure falls back to the buffered shell:true path. Non-Windows
 * spawns directly.
 */
export const OPENCODE_FINISH_IDLE_MS = 12_000;

export function createDefaultOpencodeSpawn(platform: string): OpencodeSpawnRunner {
  return (opts) => {
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(opts.binPath)) {
      try {
        const text = readFileSync(opts.binPath, 'utf-8');
        const target = nodeScriptFromShim(opts.binPath, text);
        if (target && /\.(exe)$/i.test(target)) {
          // Native binary wrapped by the shim — spawn it directly so stdout
          // streams (shell:true buffers everything until process death).
          return spawnDirect(target, opts.args, opts);
        }
        if (target) {
          // Node script wrapped by the shim — Electron's own binary as node.
          return spawnDirect(
            process.execPath,
            [target, ...opts.args],
            opts,
            { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          );
        }
      } catch {
        /* unreadable shim → buffered shell fallback below */
      }
      return new Promise<OpencodeSpawnResult>((resolve) => {
        const child = spawn(opts.binPath, opts.args.map(winQuote), {
          cwd: opts.cwd,
          timeout: opts.timeoutMs,
          windowsHide: true,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        wireStream(child, resolve);
      });
    }
    return spawnDirect(opts.binPath, opts.args, opts);
  };
}

interface DirectSpawnOpts {
  cwd?: string;
  timeoutMs: number;
}

function spawnDirect(
  bin: string,
  args: string[],
  opts: DirectSpawnOpts,
  env?: NodeJS.ProcessEnv,
): Promise<OpencodeSpawnResult> {
  return new Promise<OpencodeSpawnResult>((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      windowsHide: true,
      // stdin MUST be ignored: opencode stalls forever waiting on an open
      // (never-written) stdin pipe — verified live, exit in ~5s with 'ignore'.
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(env ? { env } : {}),
    });
    wireStream(child, resolve);
  });
}

function wireStream(
  child: ReturnType<typeof spawn>,
  resolve: (r: OpencodeSpawnResult) => void,
): void {
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let settled = false;
  let lastTextEndedAt = 0;
  // Events can split across pipe chunks — scan a rolling window of recent
  // output instead of individual chunks (capped so memory stays bounded).
  const SCAN_KEEP = 8_000;
  let scanBuf = '';
  const finish = (result: OpencodeSpawnResult) => {
    if (settled) return;
    settled = true;
    clearInterval(idleTimer);
    resolve(result);
  };
  const idleTimer = setInterval(() => {
    if (lastTextEndedAt === 0 || settled) return;
    if (Date.now() - lastTextEndedAt >= OPENCODE_FINISH_IDLE_MS) {
      child.kill();
      finish({ code: 0, stdout, stderr, timedOut: false, earlyStopped: true });
    }
  }, 1_000);
  child.stdout?.on('data', (chunk: unknown) => {
    const text = String(chunk);
    scanBuf = (scanBuf + text).slice(-SCAN_KEEP);
    // A text part carrying time.end means the model finished that message.
    if (scanBuf.includes('"type":"text"') && scanBuf.includes('"end":')) {
      lastTextEndedAt = Date.now();
    }
    if (stdout.length < OUTPUT_TAIL_CHARS) stdout += text;
  });
  child.stderr?.on('data', (chunk: unknown) => {
    if (stderr.length < OUTPUT_TAIL_CHARS) stderr += String(chunk);
  });
  child.on('error', (err: Error) => {
    finish({ code: null, stdout, stderr: stderr || err.message, timedOut });
  });
  child.on('close', (code, signal) => {
    if (signal) timedOut = true;
    finish({ code, stdout, stderr, timedOut });
  });
}

async function simulate(
  prompt: string,
  deps: {
    delay: (ms: number) => Promise<void>;
    progress: (msg: string) => void;
    simulateMs: number;
  },
): Promise<ToolOutcome> {
  const steps = [
    'Analyzing the task…',
    'Planning the changes…',
    'Applying the changes…',
    'Verifying the result…',
  ];
  const stepMs = Math.max(1, Math.round(deps.simulateMs / steps.length));
  deps.progress(`opencode not found — simulating task: ${prompt}`);
  for (const step of steps) {
    await deps.delay(stepMs);
    deps.progress(step);
  }
  return {
    ok: true,
    summary: OPENCODE_SIMULATED_SUMMARY,
    data: { simulated: true, prompt, progressSteps: steps },
  };
}

const GENERIC_OUTPUT_KEYS = ['content', 'output', 'message', 'text', 'result', 'summary'] as const;

/** Extract human-readable text from one opencode JSON event line (if any). */
function textFromEvent(obj: Record<string, unknown>): string | null {
  // Real `opencode run --format json` shape (verified live 2026-10-24):
  // {"type":"text", …, "part":{"type":"text","text":"pong", …}}
  const type = obj['type'];
  const part = obj['part'];
  if (type === 'text' && part !== null && typeof part === 'object') {
    const t = (part as Record<string, unknown>)['text'];
    if (typeof t === 'string' && t.trim()) return t;
  }
  for (const key of GENERIC_OUTPUT_KEYS) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/**
 * Summarize `opencode --format json` output: join the text parts of all event lines,
 * falling back to generic string-ish fields, then to the first stdout line.
 */
export function summarizeOpencodeOutput(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const textParts: string[] = [];
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed !== null && typeof parsed === 'object') {
        const t = textFromEvent(parsed as Record<string, unknown>);
        if (t) textParts.push(t);
      } else if (typeof parsed === 'string' && parsed.trim()) {
        textParts.push(parsed);
      }
    } catch {
      // Not JSON — skip.
    }
  }
  const joined = textParts.join(' ').trim();
  if (joined) return joined.slice(0, 200);
  return firstLine(stdout) || 'opencode finished (no output)';
}

export function createOpencodeTool(
  deps: OpencodeToolDeps = {},
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const lookup =
    deps.lookup ?? createDefaultOpencodeLookup({ env, exec: deps.exec ?? createDefaultExec(), platform });
  const spawnRunner = deps.spawn ?? createDefaultOpencodeSpawn(platform);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_OPENCODE_TIMEOUT_MS;
  const simulateMs = deps.simulateMs ?? DEFAULT_OPENCODE_SIMULATE_MS;
  const delay =
    deps.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const progress = deps.progress ?? (() => {});

  return async (args) => {
    const raw = args['prompt'];
    const prompt = typeof raw === 'string' ? raw.trim() : '';
    if (!prompt) {
      return { ok: false, summary: 'No prompt provided for the opencode task.' };
    }

    const binPath = await lookup();
    if (!binPath) {
      return simulate(prompt, { delay, progress, simulateMs });
    }

    progress(`Running opencode (${binPath})…`);
    let res: OpencodeSpawnResult;
    try {
      res = await spawnRunner({ binPath, args: [...OPENCODE_RUN_ARGS, prompt], cwd: deps.cwd, timeoutMs });
    } catch (err) {
      return {
        ok: false,
        summary: `opencode failed to start: ${err instanceof Error ? err.message : String(err)}`,
        data: { binPath },
      };
    }

    const data = {
      binPath,
      exitCode: res.code,
      timedOut: res.timedOut,
      stdoutTail: tail(res.stdout),
      stderrTail: tail(res.stderr),
    };

    if (res.timedOut) {
      // Real-world finding (verified live): `opencode run --format json` can finish the
      // task yet linger without exiting, so the 120s cap fires after the answer already
      // arrived. If the output stream contains a usable result, return it (still marked
      // timedOut in data); otherwise report the honest timeout failure.
      const salvaged = summarizeOpencodeOutput(res.stdout);
      if (salvaged && salvaged !== 'opencode finished (no output)') {
        return {
          ok: true,
          summary: salvaged,
          data: {
            ...data,
            note: `opencode kept running past the ${Math.round(timeoutMs / 1000)}s cap; result captured from its output before the process was killed`,
          },
        };
      }
      return {
        ok: false,
        summary: `opencode timed out after ${Math.round(timeoutMs / 1000)}s`,
        data,
      };
    }
    if (res.code !== 0) {
      const detail = firstLine(res.stderr) || firstLine(res.stdout) || 'no output';
      return { ok: false, summary: `opencode failed (exit ${res.code ?? 'signal'}): ${detail}`, data };
    }
    return { ok: true, summary: summarizeOpencodeOutput(res.stdout), data };
  };
}

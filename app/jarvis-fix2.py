import io
import re

# ============ 4. brain.ts: tool-calling chat (the "real Jarvis" core) ============
p = 'src/server/brain.ts'
s = io.open(p, encoding='utf-8').read()

# tool system prompt + action parser
old = "export function buildPrompt(messages: ChatMessage[]): string {"
new = """/**
 * Tool-calling protocol (the "real Jarvis" tier): when the chat brain is
 * given the tool catalog, a request that maps to a tool is answered with a
 * SINGLE line of strict JSON: {"tool":"<name>","args":{...}}. Anything else is
 * conversation. The bridge executes the action (through the ACL-gated
 * dispatcher) and returns the spoken summary.
 */
export function buildToolSystemPrompt(language: 'en' | 'hi', tools: readonly string[]): string {
  const catalog = tools.map((t) => `"${t}"`).join(', ');
  const base = personaSystemPrompt(language);
  return (
    base +
    '\\n\\nYou can also ACT on the user\\'s PC through these tools: ' +
    catalog +
    '.\\nIf the user\\'s latest message maps to one of them, reply with ONLY one line of strict JSON, no prose, no code fence:' +
    '\\n{"tool":"<tool-name>","args":{...}}' +
    '\\nChoose args that fit the tool (e.g. notion_add_todo takes {"text":"..."}; launch_app takes {"alias":"app name"}; open_url takes {"url":"..."}; youtube_search takes {"query":"..."}; web_search takes {"query":"..."}; run_opencode_task takes {"prompt":"..."}; open_any_app/close_app take {"name":"app name"}; set_reminder takes {"minutes":N,"text":"..."}; workspace_mode takes {"name":"coding|gaming|study|chill"}).' +
    '\\nIf no tool fits, or information is missing, answer conversationally instead.'
  );
}

/** Strict-ish action extraction: first JSON object with a valid "tool" string. */
export function parseAction(text: string, allowed: readonly string[]): { tool: string; args: Record<string, unknown> } | null {
  if (!text) return null;
  const matches = text.match(/\\{[^{}]*\\}/g);
  if (!matches) return null;
  for (const candidate of matches) {
    try {
      const obj = JSON.parse(candidate) as { tool?: unknown; args?: unknown };
      if (typeof obj['tool'] === 'string') {
        const tool = obj['tool'].trim();
        if (allowed.includes(tool)) {
          const args =
            obj['args'] !== null && typeof obj['args'] === 'object' && !Array.isArray(obj['args'])
              ? (obj['args'] as Record<string, unknown>)
              : {};
          return { tool, args };
        }
      }
    } catch {
      /* not JSON - try the next block */
    }
  }
  return null;
}

export function buildPrompt(messages: ChatMessage[]): string {"""
assert old in s, 'prompt anchor'
s = s.replace(old, new, 1)

# ChatWithBrainDeps: executeTool + toolNames
m = re.search(r"export interface ChatWithBrainDeps \{[^}]*\}", s)
assert m, 'deps interface'
dep_block = m.group(0)
new_deps = dep_block[:-1] + """  /** ACL-gated dispatcher: when the brain emits a tool action, it runs here. */
  executeTool?: (tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; summary: string }>;
  /** Tool names advertised to the brain (only when executeTool is present). */
  toolNames?: readonly string[];
}"""
s = s.replace(dep_block, new_deps, 1)

# chatWithBrain: use the tool system prompt + execute actions
old = """    const chatTimeoutMs = deps.chatTimeoutMs ?? BRAIN_CHAT_TIMEOUT_MS;
    const abort = abortAfter(chatTimeoutMs);
    try {
      const res = await raceTimeout(
        fetchImpl(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: status.model,
            system: personaSystemPrompt(language),
            prompt: buildPrompt(messages),
            stream: false,
          }),
          signal: abort.signal,
        }),
        chatTimeoutMs,
      );
      if (!res || !res.ok) return fallback();
      const body = (await raceTimeout(res.json(), chatTimeoutMs)) as unknown;
      const text =
        isRecord(body) && typeof body['response'] === 'string' ? (body['response'] as string).trim() : '';
      if (!text) return fallback();
      return { brain: 'ollama', model: status.model, text };
    } finally {
      abort.cancel();
    }"""
new = """    const chatTimeoutMs = deps.chatTimeoutMs ?? BRAIN_CHAT_TIMEOUT_MS;
    const abort = abortAfter(chatTimeoutMs);
    try {
      const withTools = Boolean(deps.executeTool && deps.toolNames && deps.toolNames.length > 0);
      const res = await raceTimeout(
        fetchImpl(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: status.model,
            system: withTools
              ? buildToolSystemPrompt(language, deps.toolNames!)
              : personaSystemPrompt(language),
            prompt: buildPrompt(messages),
            stream: false,
          }),
          signal: abort.signal,
        }),
        chatTimeoutMs,
      );
      if (!res || !res.ok) return fallback();
      const body = (await raceTimeout(res.json(), chatTimeoutMs)) as unknown;
      const text =
        isRecord(body) && typeof body['response'] === 'string' ? (body['response'] as string).trim() : '';
      if (!text) return fallback();

      // Tool action? Execute through the ACL-gated dispatcher and speak the result.
      if (withTools) {
        const action = parseAction(text, deps.toolNames!);
        if (action && deps.executeTool) {
          const outcome = await deps.executeTool(action.tool, action.args);
          return {
            brain: 'ollama',
            model: status.model,
            text: outcome.ok
              ? outcome.summary || 'Done.'
              : `${language === 'hi' ? 'माफ़ कीजिए, वह नहीं हो पाया' : 'Sorry, that did not work'}. ${outcome.summary}`,
          };
        }
      }
      return { brain: 'ollama', model: status.model, text };
    } finally {
      abort.cancel();
    }"""
assert old in s, 'chat exec'
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('brain tool-calling')

# ============ 5. bridge chat route: pass executeTool + toolNames ============
p = 'src/server/bridge.ts'
s = io.open(p, encoding='utf-8').read()
m = re.search(r"chatWithBrain\(\{[^}]*\}\)", s)
assert m, 'chat call'
call = m.group(0)
new_call = call[:-1] + """  executeTool: async (tool, args) => {
        const out = await executeTool({ id: `brain-${Date.now()}`, tool: tool as ToolName, args });
        return { ok: out.ok, summary: out.summary };
      },
      toolNames: KNOWN_TOOLS,
    })"""
s = s.replace(call, new_call, 1)
# KNOWN_TOOLS import
if 'KNOWN_TOOLS' not in s.split('chatWithBrain')[0]:
    old = "import { isKnownTool, createToolDispatcher } from './tools/index';"
    new2 = "import { isKnownTool, createToolDispatcher, KNOWN_TOOLS } from './tools/index';\nimport type { ToolName } from '../shared/types';"
    assert old in s, 'tools import'
    s = s.replace(old, new2)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('bridge chat executes actions')

# ============ 6. Avatar framing prop (console shows the FULL model) ============
p = 'src/persona/avatar/Avatar.tsx'
s = io.open(p, encoding='utf-8').read()
old = "  /** Viewer mode: user-orbitable camera framed for a large window (default false). */\n  orbit?: boolean;"
new = "  /** Viewer mode: user-orbitable camera framed for a large window (default false). */\n  orbit?: boolean;\n  /** close = head-and-shoulders (small overlay); full = entire model visible. */\n  framing?: 'close' | 'full';"
assert old in s, 'avatar props'
s = s.replace(old, new)
old = "  licenseVisible = true,\n  orbit = false,\n  className,\n  onLicense,\n}: AvatarProps) {"
new = "  licenseVisible = true,\n  orbit = false,\n  framing = 'close',\n  className,\n  onLicense,\n}: AvatarProps) {"
assert old in s, 'avatar destructure'
s = s.replace(old, new)
old = """        camera={
          orbit
            ? { position: [0, 1.15, 2.8], fov: 35 }
            : {
                position: [0, 1.3, 1.7],
                fov: 30,
                rotation: [-Math.atan2(0.05, 1.7), 0, 0],
              }
        }"""
new = """        camera={
          orbit
            ? { position: [0, 1.15, 2.8], fov: 35 }
            : framing === 'full'
              ? { position: [0, 0.85, 3.4], fov: 38 }
              : {
                  position: [0, 1.3, 1.7],
                  fov: 30,
                  rotation: [-Math.atan2(0.05, 1.7), 0, 0],
                }
        }"""
assert old in s, 'camera'
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('avatar framing')

p = 'src/persona/PersonaStage.tsx'
s = io.open(p, encoding='utf-8').read()
old = "  /** Avatar viewer mode: user-orbitable camera for large windows (default false). */\n  orbit?: boolean;"
new = "  /** Avatar viewer mode: user-orbitable camera for large windows (default false). */\n  orbit?: boolean;\n  /** close = head-and-shoulders (overlay); full = entire model (console). */\n  framing?: 'close' | 'full';"
assert old in s; s = s.replace(old, new)
old = "  bloom = true,\n  orbit = false,\n  className,\n}: PersonaStageProps) {"
new = "  bloom = true,\n  orbit = false,\n  framing = 'close',\n  className,\n}: PersonaStageProps) {"
assert old in s; s = s.replace(old, new)
old = "        orbit={orbit}\n        className={className}"
new = "        orbit={orbit}\n        framing={framing}\n        className={className}"
assert old in s; s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('PersonaStage framing passthrough')

p = 'src/console/ConsoleApp.tsx'
s = io.open(p, encoding='utf-8').read()
m = re.search(r"<PersonaStage[^>]*>", s)
assert m, 'console stage'
tag = m.group(0)
if 'framing' not in tag:
    new_tag = tag.replace('/>', 'framing="full" />').replace('orbit', 'orbit')
    s = s.replace(tag, new_tag, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('console framing=full')

# ============ 7. main.ts: ollama autostart on probe failure ============
p = 'electron/main.ts'
s = io.open(p, encoding='utf-8').read()
old = "  }).catch((err: unknown) => {"
new = """  }).catch((err: unknown) => {"""
# insert autostart BEFORE the bridge catch - anchor on the bridge start call
old = "  void startBridge({"
new = """  // Ollama autostart: the winget install does NOT auto-run the service. If the
  // brain probe fails at boot but the binary exists, start `ollama serve`
  // detached so the local brain lights up without user action.
  void (async () => {
    const probe = await fetch('http://127.0.0.1:11434/api/tags').catch(() => null);
    if (probe && probe.ok) return;
    const candidates = [
      join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Ollama', 'ollama.exe'),
      'C:\\\\Program Files\\\\Ollama\\\\ollama.exe',
    ];
    const fsx = require('node:fs') as typeof import('node:fs');
    const { spawn } = require('node:child_process') as typeof import('node:child_process');
    const bin = candidates.find((c) => c && fsx.existsSync(c));
    if (!bin) return;
    try {
      const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      console.log('[mitra] started ollama serve for the local brain');
    } catch (err) {
      console.warn('[mitra] ollama autostart failed:', err);
    }
  })();

  void startBridge({"""
assert old in s; s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ollama autostart')

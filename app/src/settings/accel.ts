// Hotkey recorder logic (Task E): KeyboardEvent → Electron accelerator string,
// plus validation of recorded/stored accelerators. Pure functions, no DOM or
// electron imports — unit-tested in node (accel.test.ts).
//
// Accelerator grammar per Electron docs (docs/latest/api/accelerator): parts
// joined by '+', modifiers Ctrl/Cmd/CommandOrControl/Alt/Shift/Super/Meta,
// key codes 0-9, A-Z, F1-F24, and named keys like Space/Tab/Esc/Enter/
// Backspace/Up/Down/Left/Right.

/** Structural subset of KeyboardEvent the recorder needs — plain objects work in tests. */
export interface RecorderKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Modifiers that exist only as modifiers — pressing one alone records nothing. */
const MODIFIER_KEYS = new Set([
  'control',
  'shift',
  'alt',
  'meta',
  'altgraph',
  'capslock',
  'numlock',
  'scrolllock',
  'dead',
  'unidentified',
  'contextmenu',
]);

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  spacebar: 'Space',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  escape: 'Esc',
  return: 'Enter',
  del: 'Delete',
  ins: 'Insert',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  scrolllock: 'ScrollLock',
};

/** Normalize a KeyboardEvent.key into an Electron key-code part, or null when unusable. */
export function normalizeKey(key: string): string | null {
  const lower = key.toLowerCase();
  if (MODIFIER_KEYS.has(lower)) return null;
  const named = KEY_NAMES[lower] ?? KEY_NAMES[key];
  if (named) return named;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key.toUpperCase())) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  // Multi-char named keys Electron understands (Tab, Enter, Backspace, Home, End,
  // Plus, Minus, PrintScreen …) — pass through capitalized as-is.
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Platform label for the meta modifier: Cmd on macOS, Super elsewhere. */
export function metaModifier(platform: string): 'Cmd' | 'Super' {
  return platform === 'darwin' ? 'Cmd' : 'Super';
}

/**
 * Best-effort platform detection for validation/recording (navigator.platform in
 * the renderer; 'win32' default outside a browser, e.g. node tests).
 */
export function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'win32';
  const p = String(navigator.platform || '');
  if (/mac|iphone|ipad/i.test(p)) return 'darwin';
  if (/win/i.test(p)) return 'win32';
  if (/linux/i.test(p)) return 'linux';
  return 'win32';
}

/**
 * Convert a keydown into an Electron accelerator string, or null when the press
 * carries no usable key (modifier-only) or no modifier at all is held and the
 * key is not an F-key (typing "A" alone must not become a global hotkey).
 * `platform` decides the meta mapping (Cmd on darwin, Super elsewhere).
 */
export function eventToAccelerator(e: RecorderKeyEvent, platform: string): string | null {
  const key = normalizeKey(e.key);
  if (key === null) return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push(metaModifier(platform));
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);

  const hasModifier = e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
  const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
  if (!hasModifier && !isFunctionKey) return null;

  return parts.join('+');
}

export interface AcceleratorVerdict {
  ok: boolean;
  /** i18n key of the problem, set when ok is false. */
  reason?: 'settings.hotkey.empty' | 'settings.hotkey.noModifier' | 'settings.hotkey.modifierOnly' | 'settings.hotkey.altSpace' | 'settings.hotkey.ctrlAltDel';
}

const MODIFIER_PARTS = new Set(['Ctrl', 'Alt', 'Shift', 'Cmd', 'Super', 'Meta', 'CommandOrControl', 'CmdOrCtrl']);

/**
 * Validate an accelerator string for registration on `platform`.
 * Rejects: empty strings, modifier-only combos, single keys without a modifier
 * (lone F1–F24 allowed — the recorder can produce them), and known-bad system
 * combinations — plain Alt+Space on Windows (system menu) and Ctrl+Alt+Del on
 * Windows (reserved, unregistrable).
 */
export function validateAccelerator(accel: string, platform: string): AcceleratorVerdict {
  const trimmed = accel.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'settings.hotkey.empty' };

  const parts = trimmed.split('+').map((p) => p.trim());
  const key = parts[parts.length - 1] ?? '';
  const modifiers = parts.slice(0, -1);

  if (key.length === 0) return { ok: false, reason: 'settings.hotkey.empty' };
  // Modifier-only ("Ctrl", "Ctrl+Shift") — check before the no-modifier rule so
  // the message names the real problem.
  if (MODIFIER_PARTS.has(key)) return { ok: false, reason: 'settings.hotkey.modifierOnly' };
  if (modifiers.length === 0 && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key.toUpperCase())) {
    return { ok: false, reason: 'settings.hotkey.noModifier' };
  }

  if (platform === 'win32') {
    const mods = new Set(modifiers.map((m) => m.toLowerCase()));
    const keyUpper = key.toUpperCase();
    if (keyUpper === 'SPACE' && mods.has('alt') && !mods.has('ctrl') && !mods.has('shift') && !mods.has('super')) {
      return { ok: false, reason: 'settings.hotkey.altSpace' };
    }
    if (keyUpper === 'DELETE' && mods.has('ctrl') && mods.has('alt')) {
      return { ok: false, reason: 'settings.hotkey.ctrlAltDel' };
    }
  }
  return { ok: true };
}

/** Quick-pick suggestions offered under the recorder (ask spec: Ctrl+Shift+Space default, Cmd+Shift+M macOS alternative). */
export const HOTKEY_SUGGESTIONS: readonly string[] = ['Ctrl+Shift+Space', 'Cmd+Shift+M'];

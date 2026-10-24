// Hotkey recorder logic — node-pure unit tests (no DOM, no electron).

import { describe, expect, it } from 'vitest';
import {
  HOTKEY_SUGGESTIONS,
  detectPlatform,
  eventToAccelerator,
  metaModifier,
  normalizeKey,
  validateAccelerator,
  type RecorderKeyEvent,
} from './accel';

function key(partial: Partial<RecorderKeyEvent>): RecorderKeyEvent {
  return { key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...partial };
}

describe('normalizeKey', () => {
  it('maps named keys to Electron codes', () => {
    expect(normalizeKey(' ')).toBe('Space');
    expect(normalizeKey('ArrowUp')).toBe('Up');
    expect(normalizeKey('Escape')).toBe('Esc');
    expect(normalizeKey('f5')).toBe('F5');
    expect(normalizeKey('F24')).toBe('F24');
  });

  it('uppercases single characters', () => {
    expect(normalizeKey('m')).toBe('M');
    expect(normalizeKey('7')).toBe('7');
  });

  it('returns null for modifier-only and unusable keys', () => {
    expect(normalizeKey('Control')).toBeNull();
    expect(normalizeKey('Meta')).toBeNull();
    expect(normalizeKey('AltGraph')).toBeNull();
    expect(normalizeKey('Unidentified')).toBeNull();
  });
});

describe('eventToAccelerator', () => {
  it('records Ctrl+Shift+Space on Windows', () => {
    expect(eventToAccelerator(key({ key: ' ', ctrlKey: true, shiftKey: true }), 'win32')).toBe(
      'Ctrl+Shift+Space',
    );
  });

  it('maps meta to Cmd on darwin and Super elsewhere', () => {
    expect(eventToAccelerator(key({ key: 'm', metaKey: true }), 'darwin')).toBe('Cmd+M');
    expect(eventToAccelerator(key({ key: 'm', metaKey: true }), 'win32')).toBe('Super+M');
    expect(metaModifier('darwin')).toBe('Cmd');
    expect(metaModifier('linux')).toBe('Super');
  });

  it('combines all four modifiers deterministically', () => {
    expect(
      eventToAccelerator(key({ key: 'j', ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }), 'win32'),
    ).toBe('Super+Ctrl+Alt+Shift+J');
  });

  it('returns null for modifier-only presses', () => {
    expect(eventToAccelerator(key({ key: 'Control', ctrlKey: true }), 'win32')).toBeNull();
    expect(eventToAccelerator(key({ key: 'Shift', shiftKey: true }), 'win32')).toBeNull();
  });

  it('returns null when no modifier is held and the key is not an F-key', () => {
    expect(eventToAccelerator(key({ key: 'a' }), 'win32')).toBeNull();
    expect(eventToAccelerator(key({ key: '1' }), 'win32')).toBeNull();
  });

  it('allows lone F-keys (Electron registers them)', () => {
    expect(eventToAccelerator(key({ key: 'F9' }), 'win32')).toBe('F9');
  });

  it('normalizes arrows and Esc', () => {
    expect(eventToAccelerator(key({ key: 'ArrowLeft', ctrlKey: true }), 'win32')).toBe('Ctrl+Left');
    expect(eventToAccelerator(key({ key: 'Escape', ctrlKey: true }), 'win32')).toBe('Ctrl+Esc');
  });
});

describe('validateAccelerator', () => {
  it('rejects empty and modifier-only values', () => {
    expect(validateAccelerator('', 'win32').reason).toBe('settings.hotkey.empty');
    expect(validateAccelerator('   ', 'win32').reason).toBe('settings.hotkey.empty');
    expect(validateAccelerator('Ctrl', 'win32').reason).toBe('settings.hotkey.modifierOnly');
    expect(validateAccelerator('Ctrl+Shift', 'win32').reason).toBe('settings.hotkey.modifierOnly');
  });

  it('rejects plain unmodified keys but allows lone F-keys', () => {
    expect(validateAccelerator('Space', 'win32').reason).toBe('settings.hotkey.noModifier');
    expect(validateAccelerator('A', 'win32').reason).toBe('settings.hotkey.noModifier');
    expect(validateAccelerator('F5', 'win32')).toEqual({ ok: true });
  });

  it('accepts the suggested default combos', () => {
    expect(validateAccelerator('Ctrl+Shift+Space', 'win32')).toEqual({ ok: true });
    expect(validateAccelerator('Cmd+Shift+M', 'darwin')).toEqual({ ok: true });
  });

  it('rejects plain Alt+Space on Windows only', () => {
    expect(validateAccelerator('Alt+Space', 'win32').reason).toBe('settings.hotkey.altSpace');
    expect(validateAccelerator('Alt+Space', 'darwin')).toEqual({ ok: true });
    expect(validateAccelerator('Alt+Space', 'linux')).toEqual({ ok: true });
    // More than plain Alt is fine (not the bare system-menu combo).
    expect(validateAccelerator('Ctrl+Alt+Space', 'win32')).toEqual({ ok: true });
    expect(validateAccelerator('Shift+Alt+Space', 'win32')).toEqual({ ok: true });
  });

  it('rejects Ctrl+Alt+Del on Windows', () => {
    expect(validateAccelerator('Ctrl+Alt+Delete', 'win32').reason).toBe('settings.hotkey.ctrlAltDel');
    expect(validateAccelerator('Ctrl+Alt+Delete', 'darwin')).toEqual({ ok: true });
  });
});

describe('detectPlatform', () => {
  it('defaults to win32 outside a browser (node tests)', () => {
    expect(detectPlatform()).toBe('win32');
  });
});

describe('HOTKEY_SUGGESTIONS', () => {
  it('contains the default binding and both suggestions are valid somewhere', () => {
    expect(HOTKEY_SUGGESTIONS).toContain('Ctrl+Shift+Space');
    for (const s of HOTKEY_SUGGESTIONS) {
      const ok = validateAccelerator(s, 'win32').ok || validateAccelerator(s, 'darwin').ok;
      expect(ok).toBe(true);
    }
  });
});

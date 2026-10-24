// Hotkey manager tests — fake globalShortcut, no electron import.
// Pins the plan bullet "hotkey re-register swap".
import { describe, expect, it, vi } from 'vitest';
import { createHotkeyManager, type ShortcutApi } from './hotkey';

interface FakeShortcut extends ShortcutApi {
  registered: Map<string, () => void>;
}

function makeShortcut(options?: { failOn?: string[] }): FakeShortcut {
  const failOn = options?.failOn ?? [];
  const registered = new Map<string, () => void>();
  return {
    registered,
    register(accelerator, callback) {
      if (failOn.includes(accelerator)) return false;
      registered.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) {
      registered.delete(accelerator);
    },
  };
}

describe('createHotkeyManager', () => {
  it('registers the accelerator and invokes the callback on trigger', () => {
    const shortcut = makeShortcut();
    const onToggle = vi.fn();
    const manager = createHotkeyManager({ shortcut });

    expect(manager.register('Alt+Space', onToggle)).toBe(true);
    expect(manager.current()).toBe('Alt+Space');

    shortcut.registered.get('Alt+Space')!(); // simulate the OS firing the hotkey
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('re-register swaps accelerators: old unregistered, new bound, callback preserved', () => {
    const shortcut = makeShortcut();
    const onToggle = vi.fn();
    const manager = createHotkeyManager({ shortcut });
    manager.register('Alt+Space', onToggle);

    expect(manager.reregister('CommandOrControl+Shift+M')).toBe(true);

    expect(shortcut.registered.has('Alt+Space')).toBe(false); // old released
    expect(manager.current()).toBe('CommandOrControl+Shift+M');

    shortcut.registered.get('CommandOrControl+Shift+M')!();
    expect(onToggle).toHaveBeenCalledTimes(1); // same callback
  });

  it('registering a new accelerator keeps the same swap semantics as reregister', () => {
    const shortcut = makeShortcut();
    const onToggle = vi.fn();
    const manager = createHotkeyManager({ shortcut });
    manager.register('Alt+Space', onToggle);

    expect(manager.register('Ctrl+K', onToggle)).toBe(true);
    expect(shortcut.registered.has('Alt+Space')).toBe(false);
    expect(manager.current()).toBe('Ctrl+K');
  });

  it('when the new accelerator fails, the previous hotkey keeps working (failure handling)', () => {
    const shortcut = makeShortcut({ failOn: ['Ctrl+Shift+X'] });
    const onError = vi.fn();
    const onToggle = vi.fn();
    const manager = createHotkeyManager({ shortcut, onError });
    manager.register('Alt+Space', onToggle);

    expect(manager.register('Ctrl+Shift+X', onToggle)).toBe(false);

    expect(manager.current()).toBe('Alt+Space'); // previous binding restored
    expect(shortcut.registered.has('Alt+Space')).toBe(true);
    expect(onError).toHaveBeenCalledWith(
      'Failed to register hotkey "Ctrl+Shift+X" — kept previous hotkey "Alt+Space"',
    );

    shortcut.registered.get('Alt+Space')!();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('registering a failing accelerator with no previous binding reports the error', () => {
    const shortcut = makeShortcut({ failOn: ['Alt+Space'] });
    const onError = vi.fn();
    const manager = createHotkeyManager({ shortcut, onError });

    expect(manager.register('Alt+Space', () => undefined)).toBe(false);
    expect(manager.current()).toBeNull();
    expect(onError).toHaveBeenCalledWith('Failed to register hotkey "Alt+Space"');
  });

  it('re-registering the same accelerator rebinds the (possibly new) callback', () => {
    const shortcut = makeShortcut();
    const first = vi.fn();
    const second = vi.fn();
    const manager = createHotkeyManager({ shortcut });
    manager.register('Alt+Space', first);
    manager.register('Alt+Space', second);

    expect(manager.current()).toBe('Alt+Space');
    shortcut.registered.get('Alt+Space')!();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unregister releases the accelerator', () => {
    const shortcut = makeShortcut();
    const manager = createHotkeyManager({ shortcut });
    manager.register('Alt+Space', () => undefined);

    manager.unregister();

    expect(manager.current()).toBeNull();
    expect(shortcut.registered.size).toBe(0);
  });

  it('reregister with nothing registered is a no-op that reports the error', () => {
    const onError = vi.fn();
    const manager = createHotkeyManager({ shortcut: makeShortcut(), onError });
    expect(manager.reregister('Ctrl+K')).toBe(false);
    expect(onError).toHaveBeenCalledWith('reregister called with no hotkey registered — ignoring');
  });
});

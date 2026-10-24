// Global hotkey registration with swap/re-register support.
// Electron's `globalShortcut` is injected so vitest can pass a fake — this module never
// imports electron. Re-register pattern adapted from ueli GlobalShortcutModule (MIT):
// _reference/ueli/src/main/Core/GlobalShortcut/GlobalShortcutModule.ts (unregister old →
// register new when the setting changes; on failure keep the previous binding alive).
export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface HotkeyManager {
  /** Register (or re-register) the toggle hotkey. Returns false and keeps the previous
   *  binding when the new accelerator cannot be registered. */
  register(accelerator: string, onToggle: () => void): boolean;
  /** Swap to a new accelerator, preserving the current callback. */
  reregister(accelerator: string): boolean;
  unregister(): void;
  /** Currently registered accelerator, or null. */
  current(): string | null;
}

export function createHotkeyManager(deps: {
  shortcut: ShortcutApi;
  onError?: (message: string) => void;
}): HotkeyManager {
  let bound: { accelerator: string; onToggle: () => void } | null = null;

  const manager: HotkeyManager = {
    register(accelerator, onToggle): boolean {
      const previous = bound;
      if (previous && previous.accelerator === accelerator) {
        // Same accelerator: swap the callback by re-registering.
        deps.shortcut.unregister(accelerator);
      } else if (previous) {
        deps.shortcut.unregister(previous.accelerator);
      }
      bound = null;

      if (deps.shortcut.register(accelerator, onToggle)) {
        bound = { accelerator, onToggle };
        return true;
      }

      // Failure handling: restore the previous hotkey so the app stays operable.
      if (previous) {
        if (deps.shortcut.register(previous.accelerator, previous.onToggle)) {
          bound = previous;
          deps.onError?.(
            `Failed to register hotkey "${accelerator}" — kept previous hotkey "${previous.accelerator}"`,
          );
        } else {
          deps.onError?.(
            `Failed to register hotkey "${accelerator}" and could not restore "${previous.accelerator}"`,
          );
        }
      } else {
        deps.onError?.(`Failed to register hotkey "${accelerator}"`);
      }
      return false;
    },

    reregister(accelerator): boolean {
      if (!bound) {
        deps.onError?.('reregister called with no hotkey registered — ignoring');
        return false;
      }
      return manager.register(accelerator, bound.onToggle);
    },

    unregister(): void {
      if (!bound) return;
      deps.shortcut.unregister(bound.accelerator);
      bound = null;
    },

    current: () => bound?.accelerator ?? null,
  };

  return manager;
}

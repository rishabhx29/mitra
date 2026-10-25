// Tray: menu-bar icon + Show settings / Toggle overlay / Quit menu.
// The icon is a generated 16×16 RGBA PNG (gradient orb in DEFAULT_SETTINGS.orbColors colors,
// produced by a small node/zlib script) embedded as a data URL so no asset file ships.
import { nativeImage } from 'electron';
import type { MenuItemConstructorOptions, NativeImage } from 'electron';

export const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA/ElEQVR42qXLsWqDUBSH8fMuvkxHt4zZAkWUgAghYCwiBFsRSu4gOIRmKDRDi2PBd/vK4SqIuSENGX5w+HM+eaqRR4hf4eL5FaFfYQbhsF38yqJkzixKuMLM/2W5Z6pf7uGGftrIqmBkVgWo9tsqPyCu7TZjxk6iHOVFOajmE7re0jt7t7uDNiJJhgqTDFRzhK8fS+/8ze4O2oikKcqkKai6hqax9N7t7O6gjUixRZliC6PXF2u6OWgjUm1QYbWBO2kjckhQ3iGBO2kj0saMTBvDP5mxk9Oaqf60hhv6aSPniDlzjuAKM/+XLsDF6wLCLsAMwmG7+JXfZx7yB3JXiFP1qINqAAAAAElFTkSuQmCC';

export interface TrayLike {
  setToolTip(toolTip: string): void;
  setContextMenu(menu: unknown): void;
  on(event: string, listener: () => void): unknown;
  destroy(): void;
}

export interface MenuFactory {
  buildFromTemplate(template: MenuItemConstructorOptions[]): unknown;
}

export interface TrayDeps {
  Tray: new (image: NativeImage | string, guid?: string) => TrayLike;
  Menu: MenuFactory;
  onShowSettings: () => void;
  onToggleOverlay: () => void;
  /** Opens the Mitra Console window (docs/CONSOLE_PLAN.md; singleton toggle). */
  onOpenConsole?: () => void;
  onQuit: () => void;
}

export function createTray(deps: TrayDeps): TrayLike {
  const tray = new deps.Tray(nativeImage.createFromDataURL(TRAY_ICON_DATA_URL));
  tray.setToolTip('Mitra');

  const template: MenuItemConstructorOptions[] = [
    { label: 'Show settings', click: () => deps.onShowSettings() },
    { label: 'Open Console', click: () => deps.onOpenConsole?.() },
    { label: 'Toggle overlay', click: () => deps.onToggleOverlay() },
    { type: 'separator' },
    { label: 'Quit', click: () => deps.onQuit() },
  ];
  tray.setContextMenu(deps.Menu.buildFromTemplate(template));

  // Double-clicking the tray icon opens settings (common menu-bar-app convention).
  tray.on('double-click', () => deps.onShowSettings());

  return tray;
}

// Minimal Phase-0 stub. Task B (SHELL) replaces this with the full window/hotkey/tray/bridge setup.
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

function createSettingsWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.on('ready-to-show', () => win.show());
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?window=settings`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'settings' } });
  }
}

app.whenReady().then(createSettingsWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

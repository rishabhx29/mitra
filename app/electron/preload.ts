// Minimal Phase-0 stub. Task B (SHELL) implements the full typed API.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type MitraApi, type SessionEvent } from '../src/shared/ipc';

const api: MitraApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  hideOverlay: () => void ipcRenderer.send(IPC.hideOverlay),
  onSessionEvent: (cb: (e: SessionEvent) => void) => {
    const listener = (_e: unknown, ev: SessionEvent) => cb(ev);
    ipcRenderer.on(IPC.sessionEvent, listener);
    return () => ipcRenderer.removeListener(IPC.sessionEvent, listener);
  },
};

contextBridge.exposeInMainWorld('mitra', api);

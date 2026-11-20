// Preload: узкий мост renderer <-> main через contextBridge (ТЗ §5, §6).
// sandbox: true, поэтому здесь только electron-модуль и сериализуемые данные.
import { contextBridge, ipcRenderer } from 'electron'
import type { LoadOutcome, PlatformApi } from '../api'

const bridge: PlatformApi = {
  kind: 'electron',
  flags: {
    // Трейд и горячие клавиши появляются на M3.
    hasTray: false,
    hasHotkeys: false,
  },
  loadDb: () => ipcRenderer.invoke('db:load') as Promise<LoadOutcome>,
  saveDb: (db) => ipcRenderer.invoke('db:save', db) as Promise<void>,
}

contextBridge.exposeInMainWorld('tzPlatform', bridge)

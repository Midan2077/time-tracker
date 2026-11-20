// Preload: узкий мост renderer <-> main через contextBridge (ТЗ §5, §6).
// sandbox: true, поэтому здесь только electron-модуль и сериализуемые данные.
import { contextBridge, ipcRenderer } from 'electron'
import type { LoadOutcome, PlatformApi } from '../api'

const bridge: PlatformApi = {
  kind: 'electron',
  flags: {
    hasTray: true,
    hasHotkeys: true,
  },
  loadDb: () => ipcRenderer.invoke('db:load') as Promise<LoadOutcome>,
  saveDb: (db) => ipcRenderer.invoke('db:save', db) as Promise<void>,
  setTimerActive: (active) => {
    ipcRenderer.send('timer:active', active)
  },
  onTimerCommand: (cb) => {
    ipcRenderer.on('timer:command', (_event, cmd: unknown) => {
      if (cmd === 'toggle') cb('toggle')
    })
  },
}

contextBridge.exposeInMainWorld('tzPlatform', bridge)

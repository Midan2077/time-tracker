// Main-процесс Electron: окно, безопасность, IPC до файлового хранилища (ТЗ §5, §6).
// Всё платформенное живёт здесь и в ./storage.ts; UI про Electron не знает.
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LoadOutcome } from '../api'
import { dataDir, dbFilePath, loadDbOutcome, parseAndValidate, saveDbFile } from './storage'

const isDev = !app.isPackaged
const smoke = process.env['TZ_SMOKE_SHOT'] === '1'

let mainWindow: BrowserWindow | null = null
let lastLoad: LoadOutcome = { kind: 'empty' }

function rendererEntry(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return devUrl
  return pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname.replace(/\/$/, '')}${u.search}`
  } catch {
    return url
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'Тайм-трекер',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  })
  mainWindow = win
  const wc = win.webContents

  // Никаких новых окон; внешние https-ссылки — через shell.openExternal (ТЗ §6).
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Навигация запрещена: приложение — одна страница; разрешаем только свой entry.
  wc.on('will-navigate', (event, url) => {
    if (normalizeUrl(url) !== normalizeUrl(rendererEntry())) {
      event.preventDefault()
      if (url.startsWith('https://')) void shell.openExternal(url)
    }
  })

  if (isDev || smoke) {
    // Пробрасываем консоль renderer (в т.ч. CSP-нарушения) в терминал для приёмки M0.
    wc.on('console-message', (...args: unknown[]) => {
      const first = args[0]
      if (typeof first === 'object' && first !== null && 'message' in first) {
        const d = first as { level?: unknown; message?: unknown }
        console.log(`[renderer:${String(d.level ?? '?')}] ${String(d.message ?? '')}`)
      } else {
        console.log(`[renderer:${String(first)}] ${String(args[1] ?? '')}`)
      }
    })
    wc.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`[main] did-fail-load ${code} ${desc} ${url}`)
    })
  }

  win.once('ready-to-show', () => {
    console.log('[main] window ready')
    win.show()
    if (smoke) {
      setTimeout(() => {
        void wc
          .executeJavaScript(
            `(() => {
               const b = document.querySelector('button');
               if (b) b.click();
               return JSON.stringify({
                 h1: document.querySelector('h1')?.textContent ?? null,
                 status: document.querySelector('.status')?.textContent ?? null,
                 bridge: typeof window.tzPlatform?.kind,
                 clicked: Boolean(b),
               });
             })()`,
          )
          .then((summary: string) => {
            console.log(`[main] smoke: renderer state (до сохранения): ${summary}`)
            return new Promise<void>((resolve) => setTimeout(resolve, 700))
          })
          .then(() =>
            wc.executeJavaScript(`document.querySelector('.status')?.textContent ?? null`),
          )
          .then((statusAfter: string) => {
            const dbExists = existsSync(dbFilePath())
            console.log(`[main] smoke: статус после клика: ${statusAfter}; файл БД создан: ${dbExists}`)
            return wc.capturePage()
          })
          .then((image) => {
            mkdirSync(dataDir(), { recursive: true })
            writeFileSync(join(dataDir(), 'smoke.png'), image.toPNG())
            console.log('[main] smoke: screenshot saved, quitting')
            app.quit()
          })
      }, 2000)
    }
  })

  const entry = rendererEntry()
  if (entry.startsWith('http')) {
    void wc.loadURL(entry)
  } else {
    void wc.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.enableSandbox()

app.whenReady().then(() => {
  ipcMain.handle('db:load', (): LoadOutcome => {
    lastLoad = loadDbOutcome()
    return lastLoad
  })
  ipcMain.handle('db:save', (_event, raw: unknown): void => {
    // Схема новее нашей: файл не трогаем (ТЗ §3).
    if (lastLoad.kind === 'too-new') {
      throw new Error('db schema is newer than this app supports; saving is disabled')
    }
    saveDbFile(parseAndValidate(raw))
    lastLoad = { kind: 'ok', db: parseAndValidate(raw) }
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

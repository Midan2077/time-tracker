// Main-процесс Electron: окно, безопасность, IPC до файлового хранилища (ТЗ §5, §6).
// Всё платформенное живёт здесь и в ./storage.ts; UI про Electron не знает.
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LoadOutcome } from '../api'
import { dataDir, loadDbOutcome, parseAndValidate, saveDbFile } from './storage'

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
      const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      const assertRenderer = async (): Promise<Electron.NativeImage> => {
        await sleep(2000)
        const step1 = await wc.executeJavaScript(`(() => ({
          h1: document.querySelector('h1')?.textContent ?? null,
          calendar: Boolean(document.querySelector('.fc')),
          status: document.querySelector('[data-testid="status"]')?.textContent ?? null,
          events: document.querySelectorAll('.fc-event').length,
        }))()`)
        console.log(`[main] smoke шаг 1 (после загрузки): ${JSON.stringify(step1)}`)
        await wc.executeJavaScript(`(async () => {
          const res = await window.tzPlatform.loadDb();
          const db = (res.kind === 'ok' || res.kind === 'restored') ? res.db
            : { schemaVersion: 1, projects: [], entries: [], timer: null,
                settings: { weekStartsOn: 1, notificationsEnabled: true } };
          const s = new Date(); s.setHours(9, 0, 0, 0);
          const e = new Date(); e.setHours(10, 0, 0, 0);
          const z = (d) => d.toISOString().replace(/\\.000Z$/, 'Z');
          await window.tzPlatform.saveDb({ ...db, entries: [...db.entries, {
            id: crypto.randomUUID(), projectId: null, title: 'Smoke-блок',
            start: z(s), end: z(e),
          }]});
          return 'saved';
        })()`)
        console.log('[main] smoke шаг 2: блок записан через PlatformApi, перезагрузка окна')
        const reloaded = new Promise<void>((resolve) => wc.once('did-finish-load', () => resolve()))
        wc.reload()
        await reloaded
        await sleep(1500)
        const step2 = await wc.executeJavaScript(`(() => ({
          calendar: Boolean(document.querySelector('.fc')),
          events: document.querySelectorAll('.fc-event').length,
          firstEvent: document.querySelector('.fc-event')?.textContent ?? null,
          status: document.querySelector('[data-testid="status"]')?.textContent ?? null,
        }))()`)
        console.log(`[main] smoke шаг 3 (после перезагрузки): ${JSON.stringify(step2)}`)
        return wc.capturePage()
      }
      void assertRenderer()
        .then((image) => {
          mkdirSync(dataDir(), { recursive: true })
          writeFileSync(join(dataDir(), 'smoke.png'), image.toPNG())
          console.log('[main] smoke: screenshot saved, quitting')
          app.quit()
        })
        .catch((e: unknown) => {
          console.error(`[main] smoke failure: ${String(e)}`)
          app.quit()
        })
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
  ipcMain.handle('db:load', (): LoadOutcome => loadDbOutcome())
  // Валидация на границе (ТЗ §6): невалидные данные -> ошибка в renderer, файл не тронут.
  // Защита too-new живёт в fileStore: файл с новой схемой не перезаписывается.
  ipcMain.handle('db:save', (_event, raw: unknown): void => {
    saveDbFile(parseAndValidate(raw))
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Main-процесс Electron: окно, безопасность, IPC до файлового хранилища (ТЗ §5, §6).
// Всё платформенное живёт здесь и в ./storage.ts; UI про Electron не знает.
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LoadOutcome } from '../api'
import type { DbFile } from '../../shared/db'
import { toZ } from '../../shared/calendar'
import { dueReminders, nextReminderAt } from '../../shared/reminders'
import { dataDir, loadDbOutcome, parseAndValidate, saveDbFile } from './storage'
import { createTray, type TrayController } from './tray'

const isDev = !app.isPackaged
const smoke = process.env['TZ_SMOKE_SHOT'] === '1'

let mainWindow: BrowserWindow | null = null
let lastLoad: LoadOutcome = { kind: 'empty' }
let trayCtl: TrayController | null = null

// --- M3.5: планировщик напоминаний (ТЗ §4: живёт в main, офлайн, пока приложение живо). ---
const MISSED_CUTOFF_MS = 60 * 60_000 // старше часа — не показываем, только помечаем (N=60, ТЗ §4)
const RESCHEDULE_WATCHDOG_MS = 15_000 // страховка от смены системного времени (polling, DECISIONS)
let lastDb: DbFile | null = null
let schedulerTimer: ReturnType<typeof setTimeout> | null = null
let shownOnce: Set<string> = new Set() // дубли при перепланировании до записи firedAt

function rescheduleReminders(): void {
  if (schedulerTimer !== null) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }
  if (lastDb === null || !lastDb.settings.notificationsEnabled) return
  const now = Date.now()
  const due = dueReminders(lastDb.entries, now, MISSED_CUTOFF_MS)
  const notify = (e: DbFile['entries'][number], show: boolean): void => {
    if (shownOnce.has(e.id)) return
    shownOnce.add(e.id)
    if (show) {
      try {
        new Notification({ title: 'Тайм-трекер: напоминание', body: e.title }).show()
      } catch {
        /* сервис уведомлений недоступен — сигнал всё равно уходит в UI */
      }
      console.log(`[reminder] показан ${e.id}`)
    } else {
      console.log(`[reminder] пропущен(просрочен) ${e.id}`)
    }
    mainWindow?.webContents.send('reminder:fired', { entryId: e.id, firedAt: toZ(Date.now()), show })
  }
  for (const e of due.cleanup) notify(e, false)
  for (const e of due.show) notify(e, true)
  const next = nextReminderAt(lastDb.entries, now)
  if (next !== null) {
    schedulerTimer = setTimeout(rescheduleReminders, Math.min(Math.max(next.atMs - now, 0), 2_147_483_647))
  }
}

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

  // M3: крестик прячет окно в трей; полное завершение — только «Выход» из меню трея.
  trayCtl = createTray(win)
  ipcMain.on('timer:active', (event, active: unknown) => {
    if (typeof active === 'boolean' && event.sender === wc) trayCtl?.setTimerActive(active)
  })

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
          const ps = new Date(s); ps.setDate(ps.getDate() + 7);
          const pe = new Date(e); pe.setDate(pe.getDate() + 7);
          const rStart = new Date(Date.now() + 5000);
          const rEnd = new Date(rStart.getTime() + 30 * 60000);
          const ws = new Date(); const dow = (ws.getDay() + 6) % 7; ws.setDate(ws.getDate() - dow); ws.setHours(0, 0, 0, 0);
          const we = new Date(Date.now() - 60000);
          const z = (d) => d.toISOString().replace(/\\.000Z$/, 'Z');
          await window.tzPlatform.saveDb({ ...db, entries: [...db.entries,
            { id: crypto.randomUUID(), projectId: null, title: 'Smoke-блок', start: z(s), end: z(e) },
            { id: crypto.randomUUID(), projectId: null, title: 'Smoke-план', start: z(ps), end: z(pe), planned: true },
            { id: crypto.randomUUID(), projectId: null, title: 'Smoke-напоминание', start: rStart.toISOString(), end: rEnd.toISOString(), reminder: 0 },
            ...(we > ws ? [{ id: crypto.randomUUID(), projectId: null, title: 'Дыра; "тест"', start: ws.toISOString(), end: we.toISOString() }] : []),
          ]});
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
        console.log(`[main] smoke шаг 3 (записи из bridge видны): ${JSON.stringify(step2)}`)
        await wc.executeJavaScript(
          `(() => { const b = document.querySelector('[data-testid="timer-start"]'); if (!b) throw new Error('нет кнопки Старт'); b.click(); return 'started'; })()`,
        )
        await sleep(1500)
        const grew = await wc.executeJavaScript(
          `document.querySelector('[data-testid="timer-elapsed"]')?.textContent ?? null`,
        )
        console.log(`[main] smoke шаг 3b: таймер запущен, выросло до: ${String(grew)}`)
        const reloaded2 = new Promise<void>((resolve) => wc.once('did-finish-load', () => resolve()))
        wc.reload()
        await reloaded2
        await sleep(1500)
        const timerAlive = await wc.executeJavaScript(`(() => ({
          timerStillRunning: Boolean(document.querySelector('[data-testid="timer-active"]')),
          timerBlock: Boolean(document.querySelector('.tz-event--timer')),
          status: document.querySelector('[data-testid="status"]')?.textContent ?? null,
        }))()`)
        console.log(`[main] smoke шаг 3c (таймер пережил перезапуск): ${JSON.stringify(timerAlive)}`)
        await wc.executeJavaScript(
          `(() => { const b = document.querySelector('[data-testid="timer-stop"]'); if (!b) throw new Error('таймер не пережил перезапуск'); b.click(); return 'stopped'; })()`,
        )
        await sleep(900)
        const stopCheck = await wc.executeJavaScript(`(async () => {
          const res = await window.tzPlatform.loadDb();
          const db = res.db;
          const e = [...db.entries].reverse().find((x) => x.title === 'Задача');
          return { timerAfterStop: db.timer, entries: db.entries.length, hasTimerEntry: Boolean(e),
            durSec: e ? Math.round((Date.parse(e.end) - Date.parse(e.start)) / 1000) : null };
        })()`)
        console.log(`[main] smoke шаг 3d (стоп — ровно один Entry): ${JSON.stringify(stopCheck)}`)
        // M3.5: напоминание Smoke-напоминание due через ~5 с после записи шага 2.
        // Отождествление идемпотентности: reminderFiredAt записан ровно один раз
        // (строка '[reminder] показан' в этом логе — тоже ровно одна, см. shownOnce).
        const reminderCheck = await wc.executeJavaScript(`(async () => {
          for (let i = 0; i < 15; i++) {
            const res = await window.tzPlatform.loadDb();
            const e = [...res.db.entries].reverse().find((x) => x.title === 'Smoke-напоминание');
            if (e && e.reminderFiredAt) return { fired: true, polls: i, firedAt: e.reminderFiredAt };
            await new Promise((r) => setTimeout(r, 1000));
          }
          return { fired: false };
        })()`)
        console.log(`[main] smoke шаг 3e (напоминание сработало, отметка в файле): ${JSON.stringify(reminderCheck)}`)
        await wc.executeJavaScript(
          `(() => { const b = document.querySelector('.fc-next-button'); if (!b) throw new Error('нет .fc-next-button'); b.click(); return 'ok'; })()`,
        )
        await sleep(800)
        const step3 = await wc.executeJavaScript(`(() => ({
          plannedEvents: document.querySelectorAll('.fc-event.tz-event--planned').length,
          plannedBadge: document.querySelector('[data-testid="planned-total"]')?.textContent ?? null,
        }))()`)
        console.log(`[main] smoke шаг 4 (неделя вперёд): ${JSON.stringify(step3)}`)
        // M4: отчёт + экспорт CSV (в smoke диалог заменяется путём из TZ_SMOKE_EXPORT_PATH).
        await wc.executeJavaScript(
          `(() => { const b = document.querySelector('[data-testid="open-report"]'); if (!b) throw new Error('нет кнопки Отчёт'); b.click(); return 'ok'; })()`,
        )
        await sleep(600)
        const reportView = await wc.executeJavaScript(`(() => ({
          table: Boolean(document.querySelector('[data-testid="report-table"]')),
          rows: Array.from(document.querySelectorAll('[data-testid="report-table"] tbody tr')).map((r) => r.textContent),
        }))()`)
        console.log(`[main] smoke шаг 5a (таблица отчёта): ${JSON.stringify(reportView)}`)
        await wc.executeJavaScript(
          `(() => { const b = document.querySelector('[data-testid="report-export"]'); if (!b) throw new Error('нет кнопки Экспорт'); b.click(); return 'ok'; })()`,
        )
        await sleep(900)
        const exportStatus = await wc.executeJavaScript(
          `document.querySelector('[data-testid="status"]')?.textContent ?? null`,
        )
        const csvPath = join(dataDir(), 'export.csv')
        const csv = readFileSync(csvPath, 'utf8')
        console.log(
          `[main] smoke шаг 5b (экспорт): статус=${JSON.stringify(exportStatus)}, ` +
            `BOM=${String(csv.charCodeAt(0) === 0xFEFF)}, ` +
            `разделатор=/${String(csv.includes('Проект;Дата;'))}/, ` +
            `экранирование=/${String(csv.includes('"Дыра; ""тест"""'))}/, ` +
            `итог=/${String(csv.includes('ВСЕГО;'))}/, CRLF=/${String(csv.includes('\r\n'))}/`,
        )
        const image = await wc.capturePage()
        // Крестик (закрытие окна) = в трей: окно скрыто, процесс жив (ТЗ §4 M3).
        win.close()
        await sleep(400)
        console.log(
          `[main] smoke: закрытие крестиком — окно видно: ${String(win.isVisible())}, процесс жив: ${String(!win.isDestroyed())}`,
        )
        return image
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
  ipcMain.handle('db:load', (): LoadOutcome => {
    const outcome = loadDbOutcome()
    if (outcome.kind === 'ok' || outcome.kind === 'restored') lastDb = outcome.db
    setTimeout(rescheduleReminders, 0) // пересчёт при каждом чтении (в т.ч. ресинки UI)
    return outcome
  })
  // Валидация на границе (ТЗ §6): невалидные данные -> ошибка в renderer, файл не тронут.
  // Защита too-new живёт в fileStore: файл с новой схемой не перезаписывается.
  ipcMain.handle('db:save', (_event, raw: unknown): void => {
    lastDb = parseAndValidate(raw)
    saveDbFile(lastDb)
    setTimeout(rescheduleReminders, 0) // пересчёт при любом изменении БД (ТЗ §4)
  })
  // Смена системного времени отслеживаем watchdog'ем (DECISIONS M3.5): дешёвый polling.
  setInterval(rescheduleReminders, RESCHEDULE_WATCHDOG_MS)

  // M4: диалог сохранения CSV (ТЗ §6). В smoke-режиме диалог не показываем — путь из env,
  // иначе приёмочный прогон зависнет на модальном окне.
  ipcMain.handle('csv:export', async (_event, job: { suggestedName: string; content: string }) => {
    const smokePath = process.env['TZ_SMOKE_EXPORT_PATH']
    let path: string | undefined
    if (smoke && smokePath !== undefined) {
      path = smokePath
    } else {
      const res = await dialog.showSaveDialog({
        defaultPath: join(app.getPath('documents'), job.suggestedName),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      })
      path = res.canceled ? undefined : res.filePath
    }
    if (path === undefined) return { kind: 'cancelled' } as const
    writeFileSync(path, job.content)
    return { kind: 'saved', path } as const
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

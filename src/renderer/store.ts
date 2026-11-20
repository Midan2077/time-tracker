// Единый store UI (ТЗ §5): projects/entries/settings, один источник истины,
// производные значения — селекторами. Единственный, кто пишет в хранилище.
//
// Модель сохранений: оптимистичное обновление + последовательная очередь записей;
// при ошибке записи — баннер и ресинхронизация с хранилищем (оно авторитетно).
// Решение — DECISIONS.md (M2).
import { create } from 'zustand'
import { emptyDb, validateDb, MAX_NAME_LENGTH, MAX_NOTE_LENGTH, type DbFile, type Entry, type Project, type Settings } from '../shared/db'
import { toZ } from '../shared/calendar'
import { timerStopRange } from '../shared/timer'
import { resetReminderOnTimeChange } from '../shared/reminders'
import type { LoadOutcome, PlatformApi } from '../platform/api'

export type Phase = 'loading' | 'ready' | 'readonly'

export type NewEntryInput = {
  projectId: string | null
  title: string
  start: string
  end: string
  note?: string
  reminder?: number | null
  // planned не спрашиваем у вызывающего: future = planned (ТЗ §4 M2.5), считает store.
}

export type EntryPatch = {
  projectId?: string | null
  title?: string
  start?: string
  end?: string
  note?: string | null // null — очистить заметку (exactOptionalPropertyTypes)
  planned?: boolean
  reminder?: number | null
}

type StoreState = {
  phase: Phase
  db: DbFile
  statusText: string
  banner: string | null
  saveError: string | null
  platform: PlatformApi | null
  now: number // «текущий момент» для статусов/сумм; тикает, чтобы переход будущее->настоящее был живым (M2.5)
}

const NOW_TICK_MS = 1_000 // растущий блок таймера обновляется раз в секунду (ТЗ §4 M3, фиксировано)
let nowTicker: ReturnType<typeof setInterval> | null = null

type StoreActions = {
  init: (platform: PlatformApi) => Promise<void>
  dismissBanner: () => void
  dismissSaveError: () => void
  createProject: (name: string, color: string) => void
  renameProject: (id: string, name: string) => void
  setProjectColor: (id: string, color: string) => void
  setProjectArchived: (id: string, archived: boolean) => void
  addEntry: (input: NewEntryInput) => void
  updateEntry: (id: string, patch: EntryPatch) => void
  deleteEntry: (id: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  markReminderFired: (entryId: string, firedAt: string) => void
  startTimer: (input: { projectId: string | null; title: string }) => void
  stopTimer: () => void
  toggleTimer: () => void
}

export type Store = StoreState & StoreActions

let platformRef: PlatformApi | null = null
let saveChain: Promise<void> = Promise.resolve()

function outcomeBanner(o: LoadOutcome): string | null {
  switch (o.kind) {
    case 'restored':
      return `файл был повреждён (${o.reason}) — данные восстановлены из бэкапа`
    case 'corrupt-clean':
      return `данные повреждены (${o.reason}) — начаты с чистой БД`
    case 'too-new':
      return `схема БД новее поддерживаемой (v${o.version}) — запись отключена`
    case 'ok':
    case 'empty':
      return null
  }
}

async function resyncFromStorage(): Promise<DbFile> {
  if (platformRef === null) return emptyDb()
  const outcome = await platformRef.loadDb()
  return outcome.kind === 'ok' || outcome.kind === 'restored' ? outcome.db : emptyDb()
}

function describeOutcomeForUi(o: LoadOutcome): string {
  switch (o.kind) {
    case 'ok':
      return `файл данных прочитан (projects: ${o.db.projects.length}, entries: ${o.db.entries.length})`
    case 'empty':
      return 'файл данных ещё не создан — изменения появятся после первого действия'
    case 'restored':
      return `восстановлено из бэкапа (entries: ${o.db.entries.length})`
    case 'corrupt-clean':
      return 'чистая БД после повреждения'
    case 'too-new':
      return `схема новее поддерживаемой (v${o.version})`
  }
}

export const useStore = create<Store>((set, get) => {
  // Общий путь мутаций: сборка следующей БД -> валидация -> оптимистичный set -> очередь записи.
  const mutate = (label: string, fn: (db: DbFile) => DbFile): void => {
    const state = get()
    if (state.phase === 'readonly' || state.platform === null) {
      set({ saveError: `${label}: запись отключена (схема новее поддерживаемой)` })
      return
    }
    let next: DbFile
    try {
      next = validateDb(fn(state.db))
    } catch (e) {
      set({ saveError: `${label}: ${e instanceof Error ? e.message : String(e)}` })
      return
    }
    set({ db: next, saveError: null })
    const platform = state.platform
    saveChain = saveChain
      .then(async () => {
        await platform.saveDb(next)
        set((s) => ({
          statusText: `изменения сохранены (projects: ${next.projects.length}, entries: ${next.entries.length})`,
          saveError: s.saveError,
        }))
      })
      .catch((e: unknown) => {
        void resyncFromStorage().then((fresh) => {
          set((s) => ({
            db: fresh,
            saveError: `${label}: сохранение не удалось (${e instanceof Error ? e.message : String(e)}), состояние загружено из хранилища`,
          }))
        })
      })
  }

  return {
    phase: 'loading',
    db: emptyDb(),
    statusText: 'загрузка данных…',
    banner: null,
    saveError: null,
    platform: null,
    now: Date.now(),

    async init(p) {
      platformRef = p
      set({ platform: p })
      p.onTimerCommand(() => get().toggleTimer()) // команда из меню трея
      p.onReminderFired((p2) => get().markReminderFired(p2.entryId, p2.firedAt)) // M3.5
      if (nowTicker === null) {
        nowTicker = setInterval(() => set({ now: Date.now() }), NOW_TICK_MS)
      }
      try {
        const outcome = await p.loadDb()
        const db = outcome.kind === 'ok' || outcome.kind === 'restored' ? outcome.db : emptyDb()
        p.setTimerActive(db.timer !== null) // трей мог стартовать раньше UI
        set({
          phase: outcome.kind === 'too-new' ? 'readonly' : 'ready',
          db,
          banner: outcomeBanner(outcome),
          saveError: null,
          statusText: describeOutcomeForUi(outcome),
        })
      } catch (e) {
        set({ phase: 'ready', banner: `хранилище недоступно: ${String(e)}`, statusText: 'хранилище недоступно' })
      }
    },

    dismissBanner: () => set({ banner: null }),
    dismissSaveError: () => set({ saveError: null }),

    createProject(name, color) {
      mutate('проект', (db) => ({
        ...db,
        projects: [...db.projects, { id: crypto.randomUUID(), name, color, archived: false }],
      }))
    },
    renameProject(id, name) {
      mutate('переименование', (db) => ({
        ...db,
        projects: db.projects.map((p) => (p.id === id ? { ...p, name } : p)),
      }))
    },
    setProjectColor(id, color) {
      mutate('цвет проекта', (db) => ({
        ...db,
        projects: db.projects.map((p) => (p.id === id ? { ...p, color } : p)),
      }))
    },
    setProjectArchived(id, archived) {
      mutate('архив проекта', (db) => ({
        ...db,
        projects: db.projects.map((p) => (p.id === id ? { ...p, archived } : p)),
      }))
    },

    addEntry(input) {
      const entry: Entry = {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        title: input.title,
        start: input.start,
        end: input.end,
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.reminder !== undefined && input.reminder !== null ? { reminder: input.reminder } : {}),
        // Создание блока в будущем = запланированный (ТЗ §4 M2.5).
        ...(Date.parse(input.start) > Date.now() ? { planned: true } : {}),
      }
      mutate('блок', (db) => ({ ...db, entries: [...db.entries, entry] }))
    },

    updateEntry(id, patch) {
      mutate('правка блока', (db) => ({
        ...db,
        entries: db.entries.map((e) => {
          if (e.id !== id) return e
          const next: Entry = { ...e }
          if (patch.title !== undefined) next.title = patch.title
          if (patch.projectId !== undefined) next.projectId = patch.projectId
          if (patch.start !== undefined) next.start = patch.start
          if (patch.end !== undefined) next.end = patch.end
          if (patch.reminder !== undefined) {
            if (patch.reminder === null) delete next.reminder
            else next.reminder = patch.reminder
            // Перенастройка напоминания — отсчёт заново (M3.5).
            delete next.reminderFiredAt
          }
          if (patch.planned !== undefined) {
            if (patch.planned) next.planned = true
            else delete next.planned
          }
          // Перенос начала меняет planned, если он не задан явно той же правкой (M2.5):
          // перетащил в будущее — запланирован, перетащил в прошлое — слот флага чистим.
          if (patch.start !== undefined && patch.planned === undefined) {
            if (Date.parse(next.start) > Date.now()) next.planned = true
            else delete next.planned
          }
          if (patch.note !== undefined) {
            if (patch.note === null) delete next.note
            else next.note = patch.note
          }
          // Перенос старта снимает отметку показанного напоминания — сработает по новому
          // времени (ТЗ §4 M3.5); чистая функция в shared, тесты reminders.test.ts.
          return resetReminderOnTimeChange(e, next)
        }),
      }))
    },

    deleteEntry(id) {
      mutate('удаление блока', (db) => ({ ...db, entries: db.entries.filter((e) => e.id !== id) }))
    },

    updateSettings: (patch) =>
      mutate('настройки', (db) => ({ ...db, settings: { ...db.settings, ...patch } })),

    // М3.5: платформа сигналит — store (единый писатель) ставит reminderFiredAt.
    // Идемпотентно: уже помеченный блок не перезаписываем и не плодим сохранение.
    markReminderFired(entryId, firedAt) {
      const cur = get().db.entries.find((e) => e.id === entryId)
      if (cur === undefined || (cur.reminderFiredAt !== undefined && cur.reminderFiredAt !== null)) return
      mutate('напоминание: отметка', (db) => ({
        ...db,
        entries: db.entries.map((e) => (e.id === entryId ? { ...e, reminderFiredAt: firedAt } : e)),
      }))
    },

    // Таймер (ТЗ §4 M3): состояние — таймстарт в файле БД, поэтому переживает любой
    // рестарт; единый писатель — store, трей лишь шлёт команду toggle.
    // Повторный Start при активном таймере — игнорируется (DECISIONS.md M3).
    startTimer(input) {
      if (get().db.timer !== null) return
      mutate('таймер: старт', (db) => ({
        ...db,
        timer: { projectId: input.projectId, title: input.title, startedAt: toZ(Date.now()) },
      }))
      get().platform?.setTimerActive(true)
    },

    stopTimer() {
      const timer = get().db.timer
      const range = timerStopRange(timer, Date.now())
      if (timer === null || range === null) return
      const entry: Entry = {
        id: crypto.randomUUID(),
        projectId: timer.projectId,
        title: timer.title,
        start: range.start,
        end: range.end,
      }
      mutate('таймер: стоп', (db) => ({ ...db, entries: [...db.entries, entry], timer: null }))
      get().platform?.setTimerActive(false)
    },

    toggleTimer() {
      if (get().db.timer !== null) get().stopTimer()
      else get().startTimer({ projectId: null, title: 'Задача' })
    },
  }
})

// --- Селекторы (производные значения не храним) ---

export const selectActiveProjects = (db: DbFile): Project[] => db.projects.filter((p) => !p.archived)
export const selectArchivedProjects = (db: DbFile): Project[] => db.projects.filter((p) => p.archived)
export const selectProjectById = (db: DbFile, id: string | null): Project | undefined =>
  id === null ? undefined : db.projects.find((p) => p.id === id)

export { MAX_NAME_LENGTH, MAX_NOTE_LENGTH }

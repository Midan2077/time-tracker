// Единый store UI (ТЗ §5): projects/entries/settings, один источник истины,
// производные значения — селекторами. Единственный, кто пишет в хранилище.
//
// Модель сохранений: оптимистичное обновление + последовательная очередь записей;
// при ошибке записи — баннер и ресинхронизация с хранилищем (оно авторитетно).
// Решение — DECISIONS.md (M2).
import { create } from 'zustand'
import { emptyDb, validateDb, MAX_NAME_LENGTH, MAX_NOTE_LENGTH, type DbFile, type Entry, type Project, type Settings } from '../shared/db'
import type { LoadOutcome, PlatformApi } from '../platform/api'

export type Phase = 'loading' | 'ready' | 'readonly'

export type NewEntryInput = {
  projectId: string | null
  title: string
  start: string
  end: string
  note?: string
  planned?: boolean
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
}

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

    async init(p) {
      platformRef = p
      set({ platform: p })
      try {
        const outcome = await p.loadDb()
        const db = outcome.kind === 'ok' || outcome.kind === 'restored' ? outcome.db : emptyDb()
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
        ...(input.planned === true ? { planned: true } : {}),
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
          if (patch.reminder !== undefined) next.reminder = patch.reminder
          if (patch.planned !== undefined) {
            if (patch.planned) next.planned = true
            else delete next.planned
          }
          if (patch.note !== undefined) {
            if (patch.note === null) delete next.note
            else next.note = patch.note
          }
          // Смена начала блока сбрасывает отметку показанного напоминания (ТЗ §3).
          if (patch.start !== undefined && patch.start !== e.start) {
            next.reminderFiredAt = null
          }
          return next
        }),
      }))
    },

    deleteEntry(id) {
      mutate('удаление блока', (db) => ({ ...db, entries: db.entries.filter((e) => e.id !== id) }))
    },

    updateSettings(patch) {
      mutate('настройки', (db) => ({ ...db, settings: { ...db.settings, ...patch } }))
    },
  }
})

// --- Селекторы (производные значения не храним) ---

export const selectActiveProjects = (db: DbFile): Project[] => db.projects.filter((p) => !p.archived)
export const selectArchivedProjects = (db: DbFile): Project[] => db.projects.filter((p) => p.archived)
export const selectProjectById = (db: DbFile, id: string | null): Project | undefined =>
  id === null ? undefined : db.projects.find((p) => p.id === id)

export { MAX_NAME_LENGTH, MAX_NOTE_LENGTH }

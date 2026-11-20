// Реализация PlatformApi для запуска renderer в обычном браузере (ТЗ §5):
// архитектурный тест изоляции UI от Electron. Хранилище — localStorage.
// Разбор/миграции — общий shared-код; бэкапной копии здесь нет (одна запись в хранилище),
// поэтому повреждённые данные = чистый старт с сообщением.
import { parseDbText, validateDb, type DbFile } from '../../shared/db'
import type { LoadOutcome, PlatformApi } from '../api'

const STORAGE_KEY = 'tz-tracker.db.json'

export function createBrowserPlatform(): PlatformApi {
  return {
    kind: 'browser',
    flags: { hasTray: false, hasHotkeys: false },
    async loadDb(): Promise<LoadOutcome> {
      let text: string | null = null
      try {
        text = localStorage.getItem(STORAGE_KEY)
      } catch (e) {
        return { kind: 'corrupt-clean', reason: `localStorage: ${String(e)}` }
      }
      if (text === null) return { kind: 'empty' }
      if (text.trim().length === 0) return { kind: 'corrupt-clean', reason: 'storage entry is empty' }
      const parsed = parseDbText(text)
      switch (parsed.kind) {
        case 'ok':
          return { kind: 'ok', db: parsed.db, migrated: parsed.migrated }
        case 'too-new':
          return parsed
        case 'corrupt':
          return { kind: 'corrupt-clean', reason: parsed.reason }
      }
    },
    async saveDb(db: DbFile): Promise<void> {
      const validated = validateDb(db) // та же граница валидации, что и в Electron
      const existing = localStorage.getItem(STORAGE_KEY)
      if (existing !== null && parseDbText(existing).kind === 'too-new') {
        throw new Error('db schema is newer than this app supports; saving is disabled')
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validated))
    },
  }
}

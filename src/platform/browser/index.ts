// Реализация PlatformApi для запуска renderer в обычном браузере (ТЗ §5):
// архитектурный тест изоляции UI от Electron. Хранилище — localStorage.
import { parseDbText, validateDb, type DbFile } from '../../shared/db'
import type { LoadOutcome, PlatformApi } from '../api'

const STORAGE_KEY = 'tz-trac...b.json'

export function createBrowserPlatform(): PlatformApi {
  return {
    kind: 'browser',
    flags: { hasTray: false, hasHotkeys: false },
    async loadDb(): Promise<LoadOutcome> {
      let text: string | null = null
      try {
        text = localStorage.getItem(STORAGE_KEY)
      } catch (e) {
        return { kind: 'corrupt', reason: `localStorage: ${String(e)}` }
      }
      if (text === null) return { kind: 'empty' }
      if (text.trim().length === 0) return { kind: 'corrupt', reason: 'storage entry is empty' }
      return parseDbText(text)
    },
    async saveDb(db: DbFile): Promise<void> {
      const validated = validateDb(db) // та же граница валидации, что и в Electron
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validated))
    },
  }
}

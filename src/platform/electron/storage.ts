// Файловое хранилище БД в main-процессе (ТЗ §5): только здесь решается, ГДЕ лежат данные.
// Сама логика атомарной записи/восстановления/миграций — в ./fileStore.ts
// (не зависит от Electron и покрывается тестами в node-окружении).
import { app } from 'electron'
import { join } from 'node:path'
import { validateDb, type DbFile } from '../../shared/db'
import { loadStore, pathsFor, saveStore, type StorePaths } from './fileStore'
import type { LoadOutcome } from '../api'

// Во время разработки данные лежат в каталоге проекта (.data), в собранном приложении —
// в userData (ТЗ §0). Решение — DECISIONS.md (M0).
export function dataDir(): string {
  return app.isPackaged ? app.getPath('userData') : join(process.cwd(), '.data')
}

export function storePaths(): StorePaths {
  return pathsFor(dataDir())
}

export function dbFilePath(): string {
  return storePaths().main
}

export function loadDbOutcome(): LoadOutcome {
  return loadStore(storePaths())
}

// Валидация данных, пришедших из renderer, на границе платформы (ТЗ §6).
// Бросает DbValidationError; файл при этом не трогается.
export function parseAndValidate(raw: unknown): DbFile {
  return validateDb(raw)
}

export function saveDbFile(db: DbFile): void {
  const result = saveStore(storePaths(), db)
  if (!result.ok) {
    throw new Error(
      result.error === 'too-new'
        ? 'db schema is newer than this app supports; saving is disabled'
        : `db write failed: ${result.detail}`,
    )
  }
}

export { DbValidationError } from '../../shared/db'

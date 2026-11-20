// Файловое хранилище БД в main-процессе (ТЗ §2, §5): только main имеет доступ к fs.
// Запись атомарная: tmp-файл в той же директории -> fsync ('flush') ->
// бэкап предыдущей копии -> rename -> fsync директории (best effort).
import { app } from 'electron'
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDbText, validateDb, DbValidationError, type DbFile } from '../../shared/db'
import type { LoadOutcome } from '../api'

// Во время разработки данные лежат в каталоге проекта (.data), в собранном приложении —
// в userData (ТЗ §0). Решение — DECISIONS.md (M0).
export function dataDir(): string {
  return app.isPackaged ? app.getPath('userData') : join(process.cwd(), '.data')
}

export function dbFilePath(): string {
  return join(dataDir(), 'db.json')
}

function backupFilePath(): string {
  return join(dataDir(), 'db.backup.json')
}

function tmpFilePath(): string {
  return `${dbFilePath()}.tmp`
}

export function loadDbOutcome(): LoadOutcome {
  // Убираем tmp-файл, оставшийся от аварийного завершения (ТЗ §2).
  try {
    rmSync(tmpFilePath(), { force: true })
  } catch {
    /* best effort */
  }
  let text: string
  try {
    text = readFileSync(dbFilePath(), 'utf-8')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { kind: 'empty' }
    return { kind: 'corrupt', reason: `read failed: ${code ?? String(e)}` }
  }
  if (text.trim().length === 0) return { kind: 'corrupt', reason: 'file is empty' }
  return parseDbText(text)
}

// Атомарная запись. Предыдущая копия сохраняется в db.backup.json перед подменой
// основного файла: при обрыве в любой момент целая (старая или новая) версия осталась.
export function saveDbFile(db: DbFile): void {
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  const text = JSON.stringify(db, null, 2)
  const tmp = tmpFilePath()
  // Явный fsync: open -> write -> fsync -> close, затем rename по финальному имени.
  const fd = openSync(tmp, 'w')
  try {
    writeFileSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  if (existsSync(dbFilePath())) {
    copyFileSync(dbFilePath(), backupFilePath())
  }
  renameSync(tmp, dbFilePath())
  try {
    const dirFd = openSync(dir, 'r')
    try {
      fsyncSync(dirFd)
    } finally {
      closeSync(dirFd)
    }
  } catch {
    /* fsync директории поддерживается не всеми ОС */
  }
}

// Валидация данных, пришедших из renderer, на границе платформы (ТЗ §6).
export function parseAndValidate(raw: unknown): DbFile {
  return validateDb(raw)
}

export { DbValidationError }

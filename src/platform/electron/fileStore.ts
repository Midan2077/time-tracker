// Файловое хранилище БД (ТЗ §2, §5, M1). Только node:fs — без electron, чтобы логика
// покрывалась тестами в node-окружении. Electron-привязка (путь userData) — в ./storage.ts.
//
// Запись атомарная: tmp в том же каталоге -> write -> fsync -> (бэкап предыдущего) -> rename
// -> fsync каталога (best effort). Бэкап db.backup.json перезаписывается только когда
// основной файл существовал — целая копия сохраняется перед любой подменой.
//
// Сценарии загрузки (ТЗ M1): файл отсутствует; пустой; невалидный JSON; валидный JSON с
// неверной схемой; schemaVersion новее известной. Во всех случаях возврат — корректный
// LoadOutcome, приложение стартует, данные не теряются безвозвратно: битый файл сохраняется
// в db.corrupt.json (внимание: одна копия, перезаписывается), при живом бэкапе данные
// восстанавливаются из него.
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDbText, type DbFile } from '../../shared/db'
import type { LoadOutcome } from '../api'

export type StorePaths = {
  dir: string
  main: string
  backup: string
  tmp: string
  corrupt: string
}

export type StoreErrorKind = 'too-new' | 'write-failed'
export type StoreResult = { ok: true } | { ok: false; error: StoreErrorKind; detail: string }

export function pathsFor(dir: string): StorePaths {
  return {
    dir,
    main: join(dir, 'db.json'),
    backup: join(dir, 'db.backup.json'),
    tmp: join(dir, 'db.json.tmp'),
    corrupt: join(dir, 'db.corrupt.json'),
  }
}

// Блокировка записи при too-new живёт в памяти процесса и привязана к каталогу хранилища:
// файл с новой схемой не должен быть перезаписан, пока приложение показывает ошибку.
// Сбрасывается на каждой загрузке этого же каталога.
const tooNewDirs = new Set<string>()

export function isSchemaTooNew(paths: StorePaths): boolean {
  return tooNewDirs.has(paths.dir)
}

function readOrUndefined(path: string): { text?: string; error?: string } {
  try {
    return { text: readFileSync(path, 'utf-8') }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return {}
    return { error: `read failed: ${code ?? String(e)}` }
  }
}

// Сохраняем битый файл как доказательство. Перенос (а не копирование) освобождает основной
// путь, чтобы последующая запись не затёрла бэкап мусором.
function preserveCorrupt(paths: StorePaths): void {
  try {
    if (existsSync(paths.main)) {
      try {
        copyFileSync(paths.main, paths.corrupt)
      } catch {
        /* доказательство вторично */
      }
      rmSync(paths.main, { force: true })
    }
  } catch {
    /* best effort */
  }
}

export function loadStore(paths: StorePaths): LoadOutcome {
  tooNewDirs.delete(paths.dir)
  // tmp-файл от аварийного завершения (ТЗ §2).
  try {
    rmSync(paths.tmp, { force: true })
  } catch {
    /* best effort */
  }
  const main = readOrUndefined(paths.main)
  if (main.error !== undefined) {
    // Файл есть, но не читается: считаем повреждённым, бэкап пробуем ниже.
    return tryRestore(paths, main.error)
  }
  if (main.text === undefined) {
    return { kind: 'empty' }
  }
  if (main.text.trim().length === 0) {
    return tryRestore(paths, 'file is empty')
  }
  const parsed = parseDbText(main.text)
  switch (parsed.kind) {
    case 'ok':
      return { kind: 'ok', db: parsed.db, migrated: parsed.migrated }
    case 'too-new':
      tooNewDirs.add(paths.dir)
      return parsed
    case 'corrupt':
      return tryRestore(paths, parsed.reason)
  }
}

// Повреждение основного файла: пробуем бэкап; иначе — чистый старт с сохранённым доказательством.
function tryRestore(paths: StorePaths, reason: string): LoadOutcome {
  const backup = readOrUndefined(paths.backup)
  if (backup.text !== undefined && backup.text.trim().length > 0) {
    const parsedBackup = parseDbText(backup.text)
    if (parsedBackup.kind === 'ok') {
      preserveCorrupt(paths)
      // Сразу чиним основной файл, иначе каждое окно будет «восстанавливаться» заново.
      const repair = writeDbUnlocked(paths, parsedBackup.db)
      if (repair.ok) {
        return { kind: 'restored', db: parsedBackup.db, reason }
      }
      return { kind: 'corrupt-clean', reason: `${reason}; restore write failed: ${repair.detail}` }
    }
  }
  preserveCorrupt(paths)
  return { kind: 'corrupt-clean', reason }
}

function fsyncClose(fd: number): void {
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function writeDbUnlocked(paths: StorePaths, db: DbFile): StoreResult {
  try {
    mkdirSync(paths.dir, { recursive: true })
    const text = JSON.stringify(db, null, 2)
    const fd = openSync(paths.tmp, 'w')
    try {
      writeFileSync(fd, text)
      fsyncClose(fd)
    } catch (e) {
      try {
        closeSync(fd)
      } catch {
        /* уже закрыт */
      }
      throw e
    }
    if (existsSync(paths.main)) {
      copyFileSync(paths.main, paths.backup)
    }
    renameSync(paths.tmp, paths.main)
    try {
      const dirFd = openSync(paths.dir, 'r')
      try {
        fsyncSync(dirFd)
      } finally {
        closeSync(dirFd)
      }
    } catch {
      /* fsync директории поддерживается не всеми ОС */
    }
    return { ok: true }
  } catch (e) {
    try {
      rmSync(paths.tmp, { force: true })
    } catch {
      /* best effort */
    }
    const code = (e as NodeJS.ErrnoException).code
    return { ok: false, error: 'write-failed', detail: code ?? String(e) }
  }
}

// Запись с валидацией на входе и защитой too-new (ТЗ §3: файл новее нашей схемы не трогаем).
export function saveStore(paths: StorePaths, db: DbFile): StoreResult {
  if (tooNewDirs.has(paths.dir)) return { ok: false, error: 'too-new', detail: 'schema newer than supported' }
  return writeDbUnlocked(paths, db)
}

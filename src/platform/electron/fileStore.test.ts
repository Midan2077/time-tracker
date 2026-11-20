// Сценарии M1 (ТЗ): файла нет; файл пустой; невалидный JSON; валидный JSON с неверной
// схемой; schemaVersion новее известной; повреждение + живой бэкап -> восстановление.
// Реальная ФС во временном каталоге; Electron не привлекается.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyDb } from '../../shared/db'
import { loadStore, pathsFor, saveStore, type StorePaths } from './fileStore'

const GARBAGE = '{"projects": [broken'
const dbWithProject = {
  ...emptyDb(),
  projects: [{ id: 'p1', name: 'Проект', color: '#ff0000', archived: false }],
}

let dir: string
let paths: StorePaths

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tz-store-test-'))
  paths = pathsFor(dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadStore', () => {
  it('файла нет — empty', () => {
    expect(loadStore(paths)).toEqual({ kind: 'empty' })
  })

  it('пустой файл — corrupt-clean без бэкапа', () => {
    writeFileSync(paths.main, '')
    const out = loadStore(paths)
    expect(out.kind).toBe('corrupt-clean')
    expect(existsSync(paths.corrupt)).toBe(true)
    expect(existsSync(paths.main)).toBe(false)
  })

  it('невалидный JSON — corrupt-clean, доказательство сохранено', () => {
    writeFileSync(paths.main, GARBAGE)
    const out = loadStore(paths)
    expect(out.kind).toBe('corrupt-clean')
    if (out.kind === 'corrupt-clean') expect(out.reason).toMatch(/JSON/)
    expect(readFileSync(paths.corrupt, 'utf-8')).toBe(GARBAGE)
  })

  it('валидный JSON с неверной схемой — corrupt-clean с причиной', () => {
    writeFileSync(paths.main, '{"schemaVersion":1,"projects":[],"entries":[],"timer":null,"settings":{"weekStartsOn":2,"notificationsEnabled":true}}')
    const out = loadStore(paths)
    expect(out.kind).toBe('corrupt-clean')
    if (out.kind === 'corrupt-clean') expect(out.reason).toMatch(/weekStartsOn/)
  })

  it('schemaVersion новее — too-new, файл не тронут, запись отключена', () => {
    const text = '{"schemaVersion":9,"projects":[],"entries":[],"timer":null,"settings":{"weekStartsOn":1,"notificationsEnabled":true}}'
    writeFileSync(paths.main, text)
    expect(loadStore(paths)).toEqual({ kind: 'too-new', version: 9 })
    expect(readFileSync(paths.main, 'utf-8')).toBe(text)
    const saved = saveStore(paths, emptyDb())
    expect(saved.ok).toBe(false)
    if (!saved.ok) expect(saved.error).toBe('too-new')
    expect(readFileSync(paths.main, 'utf-8')).toBe(text) // и после попытки записи
  })

  it('повреждён при живом бэкапе — restored, основной файл починен', () => {
    // Симулируем живую работу: сохранение создаёт файл, второе сохранение создаёт бэкап.
    expect(saveStore(paths, emptyDb()).ok).toBe(true)
    expect(saveStore(paths, dbWithProject).ok).toBe(true)
    expect(existsSync(paths.backup)).toBe(true)
    writeFileSync(paths.main, GARBAGE)

    const out = loadStore(paths)
    expect(out.kind).toBe('restored')
    if (out.kind === 'restored') expect(out.db.entries).toEqual([])
    // восстановились на бэкап = предыдущая валидная версия (emptyDb)
    if (out.kind === 'restored') expect(out.db.projects).toEqual([])
    // основной файл перезаписан валидным содержимым
    expect(loadStore(paths)).toMatchObject({ kind: 'ok', migrated: false })
    // доказательство повреждения сохранено
    expect(readFileSync(paths.corrupt, 'utf-8')).toBe(GARBAGE)
  })

  it('повреждён и бэкап битый — corrupt-clean', () => {
    writeFileSync(paths.main, GARBAGE)
    writeFileSync(paths.backup, 'nope')
    expect(loadStore(paths).kind).toBe('corrupt-clean')
  })

  it('stale tmp-файл удаляется при загрузке', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(paths.tmp, 'x')
    loadStore(paths)
    expect(existsSync(paths.tmp)).toBe(false)
  })
})

describe('saveStore', () => {
  it('первое сохранение: файл создан, бэкапа нет, tmp cleaned', () => {
    expect(saveStore(paths, emptyDb()).ok).toBe(true)
    expect(existsSync(paths.main)).toBe(true)
    expect(existsSync(paths.backup)).toBe(false)
    expect(existsSync(paths.tmp)).toBe(false)
  })

  it('второе сохранение: бэкап содержит предыдущую версию', () => {
    saveStore(paths, emptyDb())
    saveStore(paths, dbWithProject)
    const backup = JSON.parse(readFileSync(paths.backup, 'utf-8')) as { projects: unknown[] }
    expect(backup.projects).toEqual([])
    expect(loadStore(paths)).toMatchObject({ kind: 'ok' })
  })

  it('roundtrip: прочитанное равно записанному', () => {
    saveStore(paths, dbWithProject)
    const out = loadStore(paths)
    expect(out.kind === 'ok' && out.db).toEqual(dbWithProject)
  })

  it('не пишет, если не смог создать директорию, и не оставляет tmp', () => {
    // портим путь: dir существует, но main-путь — это директория
    mkdirSync(paths.main, { recursive: true })
    const res = saveStore(paths, emptyDb())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('write-failed')
    expect(existsSync(paths.tmp)).toBe(false)
  })
})

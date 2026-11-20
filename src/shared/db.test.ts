import { describe, expect, it } from 'vitest'
import { emptyDb, parseDbText, validateDb, DbValidationError } from './db'

describe('validateDb', () => {
  it('принимает пустую БД', () => {
    const db = validateDb(emptyDb())
    expect(db.schemaVersion).toBe(1)
    expect(db.projects).toEqual([])
    expect(db.settings.weekStartsOn).toBe(1)
  })

  it('отбрасывает лишние ключи, сохраняет валидные данные', () => {
    const db = validateDb({
      ...emptyDb(),
      junk: 'x',
      projects: [{ id: 'p1', name: 'Проект', color: '#aB09Cf', archived: true, extra: 1 }],
    })
    expect(db.projects).toHaveLength(1)
    expect(db.projects[0]?.color).toBe('#aB09Cf')
    expect(db.projects[0]?.archived).toBe(true)
  })

  it('требует цвет #RRGGBB', () => {
    expect(() =>
      validateDb({ ...emptyDb(), projects: [{ id: 'p1', name: 'A', color: 'red', archived: false }] }),
    ).toThrow(DbValidationError)
  })

  it('требует end > start и ISO с Z', () => {
    const entry = (start: string, end: string) =>
      validateDb({
        ...emptyDb(),
        entries: [{ id: 'e1', projectId: null, title: 'T', start, end }],
      })
    expect(() => entry('2026-11-21T10:00:00Z', '2026-11-21T10:00:00Z')).toThrow('end must be after start')
    expect(() => entry('2026-11-21T10:00:00', '2026-11-21T11:00:00Z')).toThrow('ISO 8601 UTC with Z')
    expect(entry('2026-11-21T10:00:00Z', '2026-11-21T11:00:00Z').entries).toHaveLength(1)
  })

  it('валидирует напоминания по белому списку', () => {
    const entry = (reminder: unknown) =>
      validateDb({
        ...emptyDb(),
        entries: [
          { id: 'e1', projectId: null, title: 'T', start: '2026-11-21T10:00:00Z', end: '2026-11-21T11:00:00Z', reminder },
        ],
      })
    expect(entry(15).entries[0]?.reminder).toBe(15)
    expect(entry(null).entries[0]?.reminder).toBeNull()
    expect(() => entry(7)).toThrow('whitelist')
  })
})

describe('parseDbText', () => {
  it('пустой/битый JSON — corrupt, не исключение', () => {
    expect(parseDbText('').kind).toBe('corrupt')
    expect(parseDbText('{oops').kind).toBe('corrupt')
    expect(parseDbText('{"schemaVersion":1}').kind).toBe('corrupt')
  })

  it('schemaVersion новее известной — too-new', () => {
    const res = parseDbText('{"schemaVersion":9,"projects":[],"entries":[]}')
    expect(res).toEqual({ kind: 'too-new', version: 9 })
  })

  it('корректный JSON — ok', () => {
    const res = parseDbText(JSON.stringify(emptyDb()))
    expect(res.kind).toBe('ok')
  })
})

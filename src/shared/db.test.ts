import { describe, expect, it } from 'vitest'
import { emptyDb, parseDbText, validateDb, DbValidationError } from './db'
import { runMigrations, type MigrationStep } from './migrations'

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
    expect(parseDbText('[]').kind).toBe('corrupt')
    expect(parseDbText('{"schemaVersion":1}').kind).toBe('corrupt')
  })

  it('schemaVersion новее известной — too-new', () => {
    const res = parseDbText('{"schemaVersion":9,"projects":[],"entries":[]}')
    expect(res).toEqual({ kind: 'too-new', version: 9 })
  })

  it('корректный JSON — ok без миграции', () => {
    const res = parseDbText(JSON.stringify(emptyDb()))
    expect(res.kind).toBe('ok')
    expect(res.kind === 'ok' && res.migrated).toBe(false)
  })

  it('поля планирования читаются из v1 со значениями по умолчанию', () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      projects: [],
      entries: [
        {
          id: 'e1',
          projectId: null,
          title: 'Встреча',
          start: '2026-12-01T10:00:00Z',
          end: '2026-12-01T11:00:00Z',
          planned: true,
          reminder: 15,
        },
      ],
      timer: null,
      settings: { weekStartsOn: 1, notificationsEnabled: true },
    })
    const res = parseDbText(text)
    expect(res.kind).toBe('ok')
    if (res.kind === 'ok') {
      expect(res.db.entries[0]?.planned).toBe(true)
      expect(res.db.entries[0]?.reminder).toBe(15)
      expect(res.db.entries[0]?.reminderFiredAt).toBeUndefined()
    }
  })
})

describe('миграции', () => {
  const step1to2: MigrationStep = {
    from: 1,
    to: 2,
    migrate: (db) => {
      const settings = (db['settings'] ?? {}) as Record<string, unknown>
      return { ...db, settings: { ...settings, defaultReminder: 15 } }
    },
  }

  it('parseDbText прогоняет цепочку и помечает migrated', () => {
    const res = parseDbText(JSON.stringify(emptyDb()), [step1to2], 2)
    expect(res.kind).toBe('ok')
    if (res.kind === 'ok') {
      expect(res.migrated).toBe(true)
      expect(res.db.schemaVersion).toBe(2)
      expect(res.db.settings.defaultReminder).toBe(15)
    }
  })

  it('нет шага — corrupt с причиной (данные не теряются молча)', () => {
    const res = parseDbText(JSON.stringify(emptyDb()), [], 2)
    expect(res.kind).toBe('corrupt')
    if (res.kind === 'corrupt') expect(res.reason).toMatch(/no migration path from schemaVersion 1/)
  })

  it('версия выше цели — too-new даже с цепочкой', () => {
    const res = parseDbText('{"schemaVersion":3}', [step1to2], 2)
    expect(res).toEqual({ kind: 'too-new', version: 3 })
  })

  it('шаг не увеличивает версию — no-path', () => {
    const res = runMigrations({ schemaVersion: 1 }, [{ from: 1, to: 1, migrate: (d) => d }], 2)
    expect(res.kind).toBe('no-path')
  })

  it('отсутствующий schemaVersion — no-path', () => {
    const res = runMigrations({ projects: [] }, [], 1)
    expect(res.kind).toBe('no-path')
  })
})

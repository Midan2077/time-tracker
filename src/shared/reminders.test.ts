import { describe, expect, it } from 'vitest'
import {
  dueReminders,
  isReminderFired,
  nextReminderAt,
  reminderDueAtMs,
  resetReminderOnTimeChange,
  validateReminderOffset,
} from './reminders'
import type { Entry } from './db'

const NOW = Date.parse('2026-11-21T12:00:00Z')
const CUTOFF = 3_600_000
const at = (iso: string): number => Date.parse(iso)
const mk = (over: Partial<Entry> & { id: string; start: string; end: string }): Entry => ({
  projectId: null,
  title: 'тест',
  ...over,
})

describe('validateReminderOffset', () => {
  it('белый список и null проходят, мусор и нецелые — нет', () => {
    expect(validateReminderOffset(0)).toBe(true)
    expect(validateReminderOffset(1440)).toBe(true)
    expect(validateReminderOffset(null)).toBe(true)
    expect(validateReminderOffset(7)).toBe(false)
    expect(validateReminderOffset(1.5)).toBe(false)
    expect(validateReminderOffset('5')).toBe(false)
    expect(validateReminderOffset(undefined)).toBe(false)
  })
})

describe('reminderDueAtMs', () => {
  it('старт минус офсет', () => {
    const e = mk({ id: 'a', start: '2026-11-21T13:00:00Z', end: '2026-11-21T14:00:00Z', reminder: 15 })
    expect(reminderDueAtMs(e)).toBe(at('2026-11-21T12:45:00Z'))
  })
  it('без напоминания — null; reminder:null — тоже null', () => {
    expect(reminderDueAtMs(mk({ id: 'a', start: '2026-11-21T13:00:00Z', end: '2026-11-21T14:00:00Z' }))).toBeNull()
    expect(reminderDueAtMs(mk({ id: 'a', start: '2026-11-21T13:00:00Z', end: '2026-11-21T14:00:00Z', reminder: null }))).toBeNull()
  })
})

describe('dueReminders', () => {
  const base = { id: 'a', end: '2026-11-21T13:00:00Z', reminder: 0 }
  it('граница: due == now — созревает прямо сейчас', () => {
    const fresh = mk({ ...base, start: '2026-11-21T12:00:00Z' })
    expect(dueReminders([fresh], NOW, CUTOFF).show).toEqual([fresh])
  })
  it('граница cutoff: просрочка ровно cutoff — ещё показываем; на секунду больше — cleanup', () => {
    const edge = mk({ ...base, start: new Date(NOW - CUTOFF).toISOString() })
    expect(dueReminders([edge], NOW, CUTOFF).show.length).toBe(1)
    const late = mk({ ...base, start: new Date(NOW - CUTOFF - 1000).toISOString() })
    expect(dueReminders([late], NOW, CUTOFF).cleanup.length).toBe(1)
  })
  it('показанное не возвращается; будущее не созревает', () => {
    const fired = mk({ ...base, start: '2026-11-21T11:00:00Z', reminderFiredAt: '2026-11-21T11:00:05Z' })
    const future = mk({ ...base, start: '2026-11-21T13:00:00Z' })
    const r = dueReminders([fired, future], NOW, CUTOFF)
    expect(r.show).toEqual([])
    expect(r.cleanup).toEqual([])
    expect(isReminderFired(fired)).toBe(true)
  })
})

describe('nextReminderAt', () => {
  it('ближайший_future, строгое сравнение (due == now — не будущее)', () => {
    const near = mk({ id: 'near', start: '2026-11-21T12:10:00Z', end: '2026-11-21T13:00:00Z', reminder: 5 })
    const far = mk({ id: 'far', start: '2026-11-21T15:00:00Z', end: '2026-11-21T16:00:00Z', reminder: 30 })
    const nowDue = mk({ id: 'now', start: '2026-11-21T12:05:00Z', end: '2026-11-21T13:00:00Z', reminder: 5 })
    expect(nextReminderAt([far, near, nowDue], NOW)?.entryId).toBe('near')
    expect(nextReminderAt([far], NOW)?.atMs).toBe(at('2026-11-21T14:30:00Z'))
    expect(nextReminderAt([nowDue], NOW)).toBeNull() // nowDue из-за reminder 5 due = 12:00 == NOW -> не будущее
  })
})

describe('resetReminderOnTimeChange', () => {
  it('перенос старта снимает отметку показанного (сработает по новому времени)', () => {
    const old = mk({ id: 'a', start: '2026-11-21T10:00:00Z', end: '2026-11-21T11:00:00Z', reminder: 10, reminderFiredAt: '2026-11-21T09:50:00Z' })
    const moved = { ...old, start: '2026-11-22T10:00:00Z' }
    const next = resetReminderOnTimeChange(old, moved)
    expect(next.reminderFiredAt).toBeUndefined()
  })
  it('без переноса — не трогаем', () => {
    const old = mk({ id: 'a', start: '2026-11-21T10:00:00Z', end: '2026-11-21T11:00:00Z', reminder: 10 })
    expect(resetReminderOnTimeChange(old, { ...old })).toEqual(old)
  })
})

import { describe, expect, it } from 'vitest'
import { isoToLocalInput, localInputToIso, snapRangeUtc, toZ } from './calendar'

describe('snapRangeUtc', () => {
  it('выравнивает по сетке 15 минут: вниз и вверх', () => {
    const r = snapRangeUtc('2026-11-21T09:07:00Z', '2026-11-21T10:19:00Z')
    expect(r).toEqual({ start: '2026-11-21T09:00:00Z', end: '2026-11-21T10:30:00Z' })
  })

  it('точно по границе — без изменений', () => {
    const r = snapRangeUtc('2026-11-21T09:00:00Z', '2026-11-21T10:00:00Z')
    expect(r).toEqual({ start: '2026-11-21T09:00:00Z', end: '2026-11-21T10:00:00Z' })
  })

  it('короткое выделение удлиняется до минимума', () => {
    const r = snapRangeUtc('2026-11-21T09:02:00Z', '2026-11-21T09:03:00Z')
    expect(r.start).toBe('2026-11-21T09:00:00Z')
    expect(r.end).toBe('2026-11-21T09:15:00Z')
  })

  it('клик (нулевое выделение) даёт один шаг сетки', () => {
    const r = snapRangeUtc('2026-11-21T09:07:00Z', '2026-11-21T09:07:00Z')
    expect(r.end).toBe('2026-11-21T09:15:00Z')
  })
})

describe('datetime-local преобразования', () => {
  // Проверки не зависят от хостовой зоны: сравниваем с Date-семантикой той же машины.
  it('roundtrip: iso -> input -> iso сохраняет момент (с точностью до минут)', () => {
    const iso = toZ(Math.floor(Date.now() / 60_000) * 60_000) // текущий момент без секунд
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso)
  })

  it('input парсится как локальное время', () => {
    const iso = localInputToIso('2026-11-21T09:30')
    const expected = new Date(2026, 10, 21, 9, 30).getTime() // конструктор Date — тоже локальная зона
    expect(Date.parse(iso)).toBe(expected)
  })

  it('isoToLocalInput даёт формат YYYY-MM-DDTHH:mm', () => {
    expect(isoToLocalInput(localInputToIso('2026-11-21T09:30'))).toBe('2026-11-21T09:30')
  })

  it('мусор бросает ошибку', () => {
    expect(() => localInputToIso('не дата')).toThrow()
    expect(() => isoToLocalInput('не дата')).toThrow()
  })
})

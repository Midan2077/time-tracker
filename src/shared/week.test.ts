import { describe, expect, it } from 'vitest'
import { weekRangeUtc } from './calendar'

// Якорь — локальный полдень субботы 2026-11-21 (системная зона; тест не зависит от смещения,
// пока проверка идёт через локальные компоненты даты).
const ANCHOR = new Date(2026, 10, 21, 12, 0, 0).getTime()

describe('weekRangeUtc', () => {
  it('weekStartsOn=1: неделя пн..вс, содержит якорь, ровно 7 суток', () => {
    const w = weekRangeUtc(ANCHOR, 1)
    const start = new Date(w.start)
    const end = new Date(w.end)
    expect(start.getDay()).toBe(1)
    expect(end.getDay()).toBe(1)
    expect(start.getTime()).toBeLessThanOrEqual(ANCHOR)
    expect(end.getTime()).toBeGreaterThan(ANCHOR)
    expect(end.getTime() - start.getTime()).toBe(7 * 86_400_000)
    // локальная полночь
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0])
  })
  it('weekStartsOn=7 (воскресенье, ISO-стиль): начало в вс', () => {
    const w = weekRangeUtc(ANCHOR, 7)
    expect(new Date(w.start).getDay()).toBe(0)
  })
  it('граница понедельника: якорь в 00:00 понедельника — начало той же недели', () => {
    const mondayMidnight = new Date(2026, 10, 16, 0, 0, 0).getTime()
    const w = weekRangeUtc(mondayMidnight, 1)
    expect(new Date(w.start).getDate()).toBe(16)
  })
})

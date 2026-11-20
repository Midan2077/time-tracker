import { describe, expect, it } from 'vitest'
import { entryStatus, isPlanned, plannedForRange } from './planning'
import type { Entry } from './db'

// Все случаи — с явным now: границы «прошлое/будущее» проверяются детерминированно (ТЗ §4 M2.5).
const T0 = Date.parse('2026-11-21T12:00:00Z')
const at = (hm: string): string => `2026-11-21T${hm}:00Z`
const mk = (start: string, end: string, planned = false): Entry => ({
  id: 'e1',
  projectId: null,
  title: 'тест',
  start,
  end,
  ...(planned ? { planned: true } : {}),
})

describe('entryStatus', () => {
  it('начало в будущем — planned', () => {
    expect(entryStatus(mk(at('13:00'), at('14:00'), true), T0)).toBe('planned')
  })
  it('граница: start == now — уже не planned, а running', () => {
    expect(entryStatus(mk(at('12:00'), at('13:00'), true), T0)).toBe('running')
  })
  it('граница: end == now — past', () => {
    expect(entryStatus(mk(at('11:00'), at('12:00'), true), T0)).toBe('past')
  })
  it('без флага тоже считает по времени', () => {
    expect(entryStatus(mk(at('13:00'), at('14:00')), T0)).toBe('planned')
    expect(entryStatus(mk(at('10:00'), at('11:00')), T0)).toBe('past')
  })
})

describe('isPlanned', () => {
  it('флаг + будущее — запланирован', () => {
    expect(isPlanned(mk(at('13:00'), at('14:00'), true), T0)).toBe(true)
  })
  it('без флага — нет', () => {
    expect(isPlanned(mk(at('13:00'), at('14:00')), T0)).toBe(false)
  })
  it('начало наступило — переход будущее->настоящее: уже не запланирован (флаг не авто-сбрасывается)', () => {
    expect(isPlanned(mk(at('11:00'), at('13:00'), true), T0)).toBe(false)
  })
  it('граница: start == now — не запланирован', () => {
    expect(isPlanned(mk(at('12:00'), at('13:00'), true), T0)).toBe(false)
  })
})

describe('plannedForRange', () => {
  const range = { start: at('14:00'), end: at('20:00') }
  it('берёт только планируемые пересечения периода', () => {
    const inside = mk(at('15:00'), at('16:00'), true)
    const overlap = mk(at('13:00'), at('15:00'), true) // начало в будущем, но за периодом — пересечение есть
    const outside = mk(at('21:00'), at('22:00'), true)
    const started = mk(at('11:30'), at('17:00'), true) // формально в периоде, но уже началось — не план
    const noFlag = mk(at('15:00'), at('16:00'))
    expect(plannedForRange([inside, overlap, outside, started, noFlag], range, T0)).toEqual([inside, overlap])
  })
  it('касание границей (end == начало периода) — не пересечение', () => {
    const touching = mk(at('13:00'), at('14:00'), true)
    expect(plannedForRange([touching], range, T0)).toEqual([])
  })
})

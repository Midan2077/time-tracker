import { describe, expect, it } from 'vitest'
import { formatElapsed, timerElapsedMs, timerLiveRange, timerStopRange } from './timer'
import type { RunningTimer } from './db'

const T: RunningTimer = { projectId: null, title: 'дело', startedAt: '2026-11-21T09:00:00Z' }
const AT = Date.parse('2026-11-21T10:00:00Z')

describe('timerStopRange', () => {
  it('обычный стоп: end = момент стопа', () => {
    expect(timerStopRange(T, AT)).toEqual({ start: T.startedAt, end: '2026-11-21T10:00:00Z' })
  })
  it('стоп через 3 секунды — короче шага сетки не бывает: end = start + 15 мин', () => {
    expect(timerStopRange(T, AT - 57 * 60_000)).toEqual({ start: T.startedAt, end: '2026-11-21T09:15:00Z' })
  })
  it('системные часы отстали (now < start) — блок всё равно валиден', () => {
    const r = timerStopRange(T, AT - 3 * 3600_000)
    expect(r?.end).toBe('2026-11-21T09:15:00Z')
    expect(Date.parse(r!.end)).toBeGreaterThan(Date.parse(r!.start))
  })
  it('таймера нет — null', () => {
    expect(timerStopRange(null, AT)).toBeNull()
  })
})

describe('timerLiveRange / elapsed', () => {
  it('растущий блок: end = now', () => {
    expect(timerLiveRange(T, AT)).toEqual({ start: T.startedAt, end: '2026-11-21T10:00:00Z' })
  })
  it('now раньше начала — блок нулевой длины, не отрицательный', () => {
    expect(timerLiveRange(T, AT - 3600_000)?.end).toBe(T.startedAt)
    expect(timerElapsedMs(T, AT - 3600_000)).toBe(0)
  })
  it('формат: мм:сс, после часа — ч:мм:сс', () => {
    expect(formatElapsed(61_000)).toBe('01:01')
    expect(formatElapsed(3661_000)).toBe('1:01:01')
  })
})

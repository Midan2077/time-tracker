import { describe, expect, it } from 'vitest'
import { plannedMinutesForRange, totalsForRange } from './sums'
import type { Entry } from './db'

// M2.5: правила «план vs факт» (ТЗ §3).
const NOW = '2026-11-21T12:00:00Z'
const DAY = { start: '2026-11-21T00:00:00Z', end: '2026-11-22T00:00:00Z' }
const mk = (start: string, end: string, planned = false): Entry => ({
  id: 'e1',
  projectId: null,
  title: 'тест',
  start,
  end,
  ...(planned ? { planned: true } : {}),
})
const at = (hm: string): string => `2026-11-21T${hm}:00Z`

describe('totalsForRange и planned (M2.5)', () => {
  it('план в будущем в факт не входит (end > now)', () => {
    const entries = [mk(at('13:00'), at('14:00'), true)]
    expect(totalsForRange(entries, [], DAY.start, DAY.end, NOW).length).toBe(0)
  })
  it('план, чьё время прошло, — фактическая трата и в сумму входит', () => {
    const entries = [mk(at('09:00'), at('10:00'), true)]
    const totals = totalsForRange(entries, [], DAY.start, DAY.end, NOW)
    expect(totals).toHaveLength(1)
    expect(totals[0]?.minutes).toBe(60)
  })
})

describe('plannedMinutesForRange (M2.5)', () => {
  it('считает только не наступившие блоки', () => {
    const entries = [
      mk(at('13:00'), at('14:00'), true), // план, 60 мин
      mk(at('09:00'), at('09:30'), true), // время прошло — не план, а факт
      mk(at('15:00'), at('15:30')), // без флага
    ]
    expect(plannedMinutesForRange(entries, DAY.start, DAY.end, NOW)).toBe(60)
  })
  it('длительность отсекается границами периода', () => {
    const entries = [mk(at('23:00'), '2026-11-22T01:00:00Z', true)] // 120 мин, 60 за границей
    expect(plannedMinutesForRange(entries, DAY.start, DAY.end, NOW)).toBe(60)
  })
})

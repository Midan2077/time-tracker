import { describe, expect, it } from 'vitest'
import type { Entry, Project } from './db'
import { totalsForRange, NO_PROJECT_LABEL } from './sums'

const project: Project = { id: 'p1', name: 'Проект', color: '#ff0000', archived: false }
const archived: Project = { id: 'p2', name: 'Архив', color: '#00ff00', archived: true }

function entry(patch: Partial<Entry> & { start: string; end: string }): Entry {
  return { id: Math.random().toString(36).slice(2), projectId: null, title: 't', ...patch }
}

const NOW = '2026-11-21T12:00:00Z'
const DAY = { rangeStart: '2026-11-21T00:00:00Z', rangeEnd: '2026-11-22T00:00:00Z' }

describe('totalsForRange', () => {
  it('суммирует прошедшие блоки по проектам', () => {
    const totals = totalsForRange(
      [
        entry({ projectId: 'p1', start: '2026-11-21T09:00:00Z', end: '2026-11-21T10:00:00Z' }),
        entry({ projectId: 'p1', start: '2026-11-21T10:30:00Z', end: '2026-11-21T11:00:00Z' }),
        entry({ projectId: 'p2', start: '2026-11-21T08:00:00Z', end: '2026-11-21T08:30:00Z' }),
      ],
      [project, archived],
      DAY.rangeStart,
      DAY.rangeEnd,
      NOW,
    )
    expect(totals).toEqual([
      { projectId: 'p1', name: 'Проект', minutes: 90 },
      { projectId: 'p2', name: 'Архив', minutes: 30 },
    ])
  })

  it('блоки без проекта — отдельной строкой', () => {
    const totals = totalsForRange(
      [entry({ start: '2026-11-21T09:00:00Z', end: '2026-11-21T09:45:00Z' })],
      [],
      DAY.rangeStart,
      DAY.rangeEnd,
      NOW,
    )
    expect(totals).toEqual([{ projectId: null, name: NO_PROJECT_LABEL, minutes: 45 }])
  })

  it('пересекающий границу периода блока учитывается по отсечке', () => {
    // Блок с 23:00 вчера по 01:00 сегодня: в «сегодня» попадает ровно час.
    const totals = totalsForRange(
      [entry({ projectId: 'p1', start: '2026-11-20T23:00:00Z', end: '2026-11-21T01:00:00Z' })],
      [project],
      DAY.rangeStart,
      DAY.rangeEnd,
      NOW,
    )
    expect(totals[0]?.minutes).toBe(60)
  })

  it('будущие и planned блоки не считаются; незавершённый текущий — только прошедшая часть', () => {
    const totals = totalsForRange(
      [
        entry({ projectId: 'p1', planned: true, start: '2026-11-21T09:00:00Z', end: '2026-11-21T10:00:00Z' }),
        entry({ projectId: 'p1', start: '2026-11-21T11:30:00Z', end: '2026-11-21T13:00:00Z' }), // конец в будущем: не весь блок
      ],
      [project],
      DAY.rangeStart,
      DAY.rangeEnd,
      NOW,
    )
    // end > now — по правилу ТЗ блок не входит в сумму целиком
    expect(totals).toEqual([])
  })

  it('несуществующий проект не роняет расчёт (имя — заглушка)', () => {
    const totals = totalsForRange(
      [entry({ projectId: 'ghost', start: '2026-11-21T09:00:00Z', end: '2026-11-21T09:30:00Z' })],
      [],
      DAY.rangeStart,
      DAY.rangeEnd,
      NOW,
    )
    expect(totals[0]).toEqual({ projectId: 'ghost', name: NO_PROJECT_LABEL, minutes: 30 })
  })
})

// Экспорт отчёта в CSV (ТЗ §4 M4): UTF-8 с BOM, разделитель ';', CRLF — Excel
// открывает русские символы и колонки без плясок. Раздел «блоки» и раздел «ИТОГО»
// в одном файле (решение — DECISIONS.md): блоки дают проверяемые строки, сводка — ответ ТЗ.
// В экспорт идут только фактические блоки (end <= now) — та же семантика отчёта, planned не трата.
import type { Entry, Project } from './db'
import { isoToLocalInput } from './calendar'
import { totalsForRange, NO_PROJECT_LABEL } from './sums'

export const CSV_BOM = '\uFEFF'
export const CSV_SEP = ';'

export function csvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function csvRows(rows: readonly (readonly string[])[]): string {
  return CSV_BOM + rows.map((r) => r.map(csvCell).join(CSV_SEP)).join('\r\n') + '\r\n'
}

// '2026-11-21T09:00' -> { date: '21.11.2026', time: '09:00' } (локальная зона, ТЗ §4).
function localParts(iso: string): { date: string; time: string } {
  const [d = '', t = '00:00'] = isoToLocalInput(iso).split('T')
  const [y, m, dd] = d.split('-')
  return { date: `${dd}.${m}.${y}`, time: t.slice(0, 5) }
}

export function reportCsv(
  entries: readonly Entry[],
  projects: readonly Project[],
  rangeStartIso: string,
  rangeEndIso: string,
  nowIso: string,
): string {
  const rangeStart = Date.parse(rangeStartIso)
  const rangeEnd = Date.parse(rangeEndIso)
  const now = Date.parse(nowIso)
  const nameOf = new Map(projects.map((p) => [p.id, p.name]))
  const rows: string[][] = [['Проект', 'Дата', 'Начало', 'Конец', 'Минуты', 'Задача']]
  const clipped = entries
    .filter((e) => Date.parse(e.end) <= now)
    .map((e) => {
      const from = Math.max(Date.parse(e.start), rangeStart)
      const to = Math.min(Date.parse(e.end), rangeEnd)
      return { e, from, to, minutes: Math.floor(Math.max(0, to - from) / 60_000) }
    })
    .filter((c) => c.minutes > 0)
    .sort((a, b) => a.from - b.from)
  for (const c of clipped) {
    const s = localParts(new Date(c.from).toISOString())
    const t = localParts(new Date(c.to).toISOString())
    rows.push([
      c.e.projectId === null ? NO_PROJECT_LABEL : nameOf.get(c.e.projectId) ?? NO_PROJECT_LABEL,
      s.date,
      s.time,
      t.time,
      String(c.minutes),
      c.e.title,
    ])
  }
  rows.push([])
  rows.push(['ИТОГО по проектам'])
  const totals = totalsForRange(entries, projects, rangeStartIso, rangeEndIso, nowIso)
  let all = 0
  for (const t of totals) {
    rows.push([t.name, '', '', '', String(t.minutes), ''])
    all += t.minutes
  }
  rows.push(['ВСЕГО', '', '', '', String(all), ''])
  return csvRows(rows)
}

export function reportFileName(rangeStartIso: string, rangeEndIso: string): string {
  return `time-tracker-${rangeStartIso.slice(0, 10)}_${rangeEndIso.slice(0, 10)}.csv`
}

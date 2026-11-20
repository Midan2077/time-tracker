// Чистая логика планирования (ТЗ §3, §4 M2.5). Статус блока определяется сравнением с now,
// который передаётся снаружи (детерминированные тесты, единый источник времени в UI).
// Флаг planned фиксирует намерение пользователя; при наступлении start блок НЕ меняет флаг
// автоматически (ТЗ §3), но для отображения он уже не «запланированный».
import type { Entry } from './db'
import type { UtcRange } from './calendar'

export type EntryStatus = 'past' | 'running' | 'planned'

export function entryStatus(entry: Entry, nowMs: number): EntryStatus {
  const start = Date.parse(entry.start)
  const end = Date.parse(entry.end)
  if (start > nowMs) return 'planned'
  if (end > nowMs) return 'running'
  return 'past'
}

// Отображать как запланированный: флаг выставлен И начало ещё не наступило.
// Переход «будущее → настоящее» (ТЗ §4 M2.5): стили и суммы пересчитываются по now,
// флаг в файле остаётся до явной правки блока.
export function isPlanned(entry: Entry, nowMs: number): boolean {
  return entry.planned === true && Date.parse(entry.start) > nowMs
}

// Запланированные блоки, пересекающие период (селектор «запланированные на период», ТЗ §5).
// Касание границей (end == start периода) пересечением не считается.
export function plannedForRange(
  entries: readonly Entry[],
  range: UtcRange,
  nowMs: number,
): Entry[] {
  const from = Date.parse(range.start)
  const to = Date.parse(range.end)
  return entries.filter(
    (e) => isPlanned(e, nowMs) && Date.parse(e.start) < to && Date.parse(e.end) > from,
  )
}

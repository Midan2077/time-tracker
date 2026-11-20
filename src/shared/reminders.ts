// Чистая логика напоминаний (ТЗ §3, §4 M3.5). Планировщик живёт в слое платформы,
// файл пишет UI-store — здесь только функции-решатели с явным now (детерминированные тесты).
import { REMINDER_OFFSETS, type Entry } from './db'

// Офсет напоминания: целое число минут из белого списка (или null — снять напоминание).
export function validateReminderOffset(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && REMINDER_OFFSETS.includes(value))
  )
}

// Момент сигнала: старт блока минус офсет. null — напоминания нет.
export function reminderDueAtMs(entry: Entry): number | null {
  if (entry.reminder === undefined || entry.reminder === null) return null
  return Date.parse(entry.start) - entry.reminder * 60_000
}

export function isReminderFired(entry: Entry): boolean {
  return entry.reminderFiredAt !== undefined && entry.reminderFiredAt !== null
}

// Созревшие (время сигнала <= now) и ещё не показанные:
// show — не старше cutoff (показываем), cleanup — просрочены дальше cutoff
// (не показываем, но помечаем, чтобы не копить — ТЗ §4 M3.5).
export function dueReminders(
  entries: readonly Entry[],
  nowMs: number,
  cutoffMs: number,
): { show: Entry[]; cleanup: Entry[] } {
  const show: Entry[] = []
  const cleanup: Entry[] = []
  for (const e of entries) {
    const at = reminderDueAtMs(e)
    if (at === null || isReminderFired(e)) continue
    if (at <= nowMs) {
      if (nowMs - at <= cutoffMs) show.push(e)
      else cleanup.push(e)
    }
  }
  return { show, cleanup }
}

// Ближайший непоказанный сигнал строго в будущем (null — планировать нечего).
export function nextReminderAt(
  entries: readonly Entry[],
  nowMs: number,
): { entryId: string; atMs: number } | null {
  let best: { entryId: string; atMs: number } | null = null
  for (const e of entries) {
    const at = reminderDueAtMs(e)
    if (at === null || isReminderFired(e) || at <= nowMs) continue
    if (best === null || at < best.atMs) best = { entryId: e.id, atMs: at }
  }
  return best
}

// Перенос блока меняет время напоминания: снимаем отметку «уже показан»,
// чтобы по новому времени он сработал заново (ТЗ §4 M3.5).
export function resetReminderOnTimeChange(oldEntry: Entry, newEntry: Entry): Entry {
  if (oldEntry.start === newEntry.start) return newEntry
  if (newEntry.reminderFiredAt === undefined) return newEntry
  const next: Entry = { ...newEntry }
  delete next.reminderFiredAt
  return next
}

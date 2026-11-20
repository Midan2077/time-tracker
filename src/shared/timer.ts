// Чистая логика таймера (ТЗ §4 M3). Единственное неочевидное правило — Stop сразу после
// Start (или после перевода системных часов назад): валидатор Entry требует end > start,
// поэтому минимальная длина созданного блока — один шаг сетки.
import { GRID_MINUTES, toZ } from './calendar'
import type { RunningTimer } from './db'

export type TimerStopRange = { start: string; end: string }

export function timerStopRange(timer: RunningTimer, nowMs: number): TimerStopRange | null {
  if (timer === null) return null
  const start = Date.parse(timer.startedAt)
  const end = Math.max(nowMs, start + GRID_MINUTES * 60_000)
  return { start: timer.startedAt, end: toZ(end) }
}

// «Растущий» блок на сегодня: end = now, но не раньше начала (системные часы могли отстать).
export function timerLiveRange(timer: RunningTimer, nowMs: number): TimerStopRange | null {
  if (timer === null) return null
  const start = Date.parse(timer.startedAt)
  return { start: timer.startedAt, end: toZ(Math.max(nowMs, start)) }
}

export function timerElapsedMs(timer: RunningTimer, nowMs: number): number {
  if (timer === null) return 0
  return Math.max(0, nowMs - Date.parse(timer.startedAt))
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const p = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`
}

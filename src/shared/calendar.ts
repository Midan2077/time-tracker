// Чистые календарные утилиты (ТЗ §4 M2): сетка выделения, преобразования datetime-local.
// Никаких electron/node/DOM-импортов.

export const GRID_MINUTES = 15 // шаг сетки и минимальная длительность (ТЗ §4 «например, 15»)
const MS_MIN = 60_000

export function toZ(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export type UtcRange = { start: string; end: string }

// Округление выделения к сетке: начало вниз, конец вверх до шага GRID_MINUTES;
// слишком короткое выделение удлиняется до minMinutes (ТЗ §4).
// Выравнивание по UTC-полуночи (эпоха кратна суткам); для локальных полуночей в
// часовых поясах с нецелочасовым смещением сетка может «дышать» — пояса вида ±5:30 вне целей ТЗ.
export function snapRangeUtc(startIso: string, endIso: string, gridMinutes = GRID_MINUTES, minMinutes = GRID_MINUTES): UtcRange {
  const step = gridMinutes * MS_MIN
  const s = Date.parse(startIso)
  const e = Date.parse(endIso)
  if (Number.isNaN(s) || Number.isNaN(e)) throw new Error('snapRangeUtc: invalid ISO instant')
  let start = Math.floor(s / step) * step
  let end = Math.ceil(e / step) * step
  if (end - start < minMinutes * MS_MIN) end = start + minMinutes * MS_MIN
  if (end === start) end = start + step // совпало полностью (клик без протяжки)
  return { start: toZ(start), end: toZ(end) }
}

const pad = (n: number): string => String(n).padStart(2, '0')

// Значение для <input type="datetime-local"> в ЛОКАЛЬНОЙ зоне браузера (хостовой).
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`isoToLocalInput: ${iso}`)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// datetime-local парсится как локальное время -> нормализуем в UTC ISO с Z.
export function localInputToIso(value: string): string {
  const t = Date.parse(value)
  if (Number.isNaN(t)) throw new Error(`localInputToIso: ${value}`)
  return toZ(t)
}

// Метка «hh:mm» для заголовков/подписей.
export function formatLocalTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

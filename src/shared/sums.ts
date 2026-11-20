// Расчёт сумм потраченного времени (ТЗ §4 «Отчёт», используется и шапкой M2).
// Правила (ТЗ §3): в сумму входят только фактически прошедшие блоки — end <= now.
// Флаг planned отдельно не проверяется: у блока в будущем end > now, поэтому он
// отсекается временным условием; запланированный блок, чьё время уже прошло,
// — фактически потраченное время и в сумму входит (DECISIONS.md M2.5).
// Пересечение с периодом — отсечка границами (НЕ целиком).
import type { Entry, Project } from './db'
import { isPlanned } from './planning'

export type ProjectTotal = {
  projectId: string | null
  name: string
  minutes: number
}

export const NO_PROJECT_LABEL = 'Без проекта'

function clipMs(entryStartMs: number, entryEndMs: number, rangeStartMs: number, rangeEndMs: number): number {
  const from = Math.max(entryStartMs, rangeStartMs)
  const to = Math.min(entryEndMs, rangeEndMs)
  return Math.max(0, to - from)
}

export function totalsForRange(
  entries: readonly Entry[],
  projects: readonly Project[],
  rangeStartIso: string,
  rangeEndIso: string,
  nowIso: string,
): ProjectTotal[] {
  const rangeStart = Date.parse(rangeStartIso)
  const rangeEnd = Date.parse(rangeEndIso)
  const now = Date.parse(nowIso)
  const byProject = new Map<string, number>() // '' = без проекта
  let nullMs = 0
  for (const e of entries) {
    const end = Date.parse(e.end)
    if (end > now) continue
    const ms = clipMs(Date.parse(e.start), end, rangeStart, rangeEnd)
    if (ms === 0) continue
    if (e.projectId === null) {
      nullMs += ms
    } else {
      byProject.set(e.projectId, (byProject.get(e.projectId) ?? 0) + ms)
    }
  }
  const nameOf = new Map(projects.map((p) => [p.id, p.name]))
  const out: ProjectTotal[] = []
  for (const [projectId, ms] of byProject) {
    out.push({ projectId, name: nameOf.get(projectId) ?? NO_PROJECT_LABEL, minutes: Math.floor(ms / 60_000) })
  }
  if (nullMs > 0) {
    out.push({ projectId: null, name: NO_PROJECT_LABEL, minutes: Math.floor(nullMs / 60_000) })
  }
  out.sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'ru'))
  return out
}

// Минуты запланированного времени в периоде (индикатор «план», ТЗ §4 M2.5):
// только ещё не наступившие блоки (isPlanned), длительность отсечена границами периода.
export function plannedMinutesForRange(
  entries: readonly Entry[],
  rangeStartIso: string,
  rangeEndIso: string,
  nowIso: string,
): number {
  const rangeStart = Date.parse(rangeStartIso)
  const rangeEnd = Date.parse(rangeEndIso)
  const now = Date.parse(nowIso)
  let ms = 0
  for (const e of entries) {
    if (!isPlanned(e, now)) continue
    ms += clipMs(Date.parse(e.start), Date.parse(e.end), rangeStart, rangeEnd)
  }
  return Math.floor(ms / 60_000)
}

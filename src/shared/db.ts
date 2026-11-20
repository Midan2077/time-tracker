// Модель данных и валидация (ТЗ §3). Чистый модуль: без Electron, node- и DOM-импортов.
// Используется и слоем платформы, и UI, и тестами.

import { runMigrations, MIGRATIONS, type MigrationChain } from './migrations'

export type Project = {
  id: string
  name: string
  color: string // #RRGGBB
  archived: boolean
}

export type Entry = {
  id: string
  projectId: string | null
  title: string
  start: string // ISO 8601 UTC (суффикс Z)
  end: string // ISO 8601 UTC, end > start
  note?: string
  planned?: boolean
  reminder?: number | null
  reminderFiredAt?: string | null
}

export type RunningTimer = {
  projectId: string | null
  title: string
  startedAt: string // ISO 8601 UTC
} | null

export type Settings = {
  weekStartsOn: 0 | 1
  notificationsEnabled: boolean
  defaultReminder?: number | null
}

export type DbFile = {
  schemaVersion: number
  projects: Project[]
  entries: Entry[]
  timer: RunningTimer
  settings: Settings
}

export const CURRENT_SCHEMA_VERSION = 1

// Белый список смещений напоминаний, минут (ТЗ §3).
export const REMINDER_OFFSETS: readonly number[] = [0, 5, 10, 15, 30, 60, 120, 1440]

export const MAX_NAME_LENGTH = 200
export const MAX_NOTE_LENGTH = 5000

const COLOR_RE = /^#[0-9a-fA-F]{6}$/
// ISO 8601 UTC: обязательный суффикс Z, необязательные мс.
const ISO_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

export class DbValidationError extends Error {
  constructor(readonly reason: string) {
    super(`invalid db: ${reason}`)
    this.name = 'DbValidationError'
  }
}

export function isIsoUtcInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_Z_RE.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

function fail(reason: string): never {
  throw new DbValidationError(reason)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimmedString(value: unknown, field: string, maxLen: number, allowEmpty: false): string {
  if (typeof value !== 'string') fail(`${field}: expected string`)
  const s = value.trim()
  if (s.length === 0) fail(`${field}: empty after trim`)
  if (s.length > maxLen) fail(`${field}: longer than ${maxLen}`)
  void allowEmpty
  return s
}

function optionalTrimmedString(value: unknown, field: string, maxLen: number): string | undefined {
  if (value === undefined || value === null) return undefined
  return trimmedString(value, field, maxLen, false)
}

function idString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${field}: expected non-empty string id`)
  if (value.length > 100) fail(`${field}: id longer than 100`)
  return value
}

function projectIdValue(value: unknown, field: string): string | null {
  if (value === null) return null
  return idString(value, field)
}

function parseProject(raw: unknown, index: number): Project {
  if (!isRecord(raw)) fail(`projects[${index}]: expected object`)
  const color = raw['color']
  if (typeof color !== 'string' || !COLOR_RE.test(color)) {
    fail(`projects[${index}].color: expected #RRGGBB`)
  }
  return {
    id: idString(raw['id'], `projects[${index}].id`),
    name: trimmedString(raw['name'], `projects[${index}].name`, MAX_NAME_LENGTH, false),
    color,
    archived: raw['archived'] === true,
  }
}

function reminderValue(value: unknown, field: string): number | null | undefined {
  if (value === undefined || value === null) return value === null ? null : undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(`${field}: expected integer minutes`)
  if (!REMINDER_OFFSETS.includes(value)) fail(`${field}: ${value} not in whitelist`)
  return value
}

function parseEntry(raw: unknown, index: number): Entry {
  if (!isRecord(raw)) fail(`entries[${index}]: expected object`)
  const start = raw['start']
  const end = raw['end']
  if (!isIsoUtcInstant(start)) fail(`entries[${index}].start: expected ISO 8601 UTC with Z`)
  if (!isIsoUtcInstant(end)) fail(`entries[${index}].end: expected ISO 8601 UTC with Z`)
  if (Date.parse(end) <= Date.parse(start)) fail(`entries[${index}]: end must be after start`)

  const entry: Entry = {
    id: idString(raw['id'], `entries[${index}].id`),
    projectId: projectIdValue(raw['projectId'], `entries[${index}].projectId`),
    title: trimmedString(raw['title'], `entries[${index}].title`, MAX_NAME_LENGTH, false),
    start,
    end,
  }
  const note = optionalTrimmedString(raw['note'], `entries[${index}].note`, MAX_NOTE_LENGTH)
  if (note !== undefined) entry.note = note
  if (raw['planned'] === true) entry.planned = true
  const reminder = reminderValue(raw['reminder'], `entries[${index}].reminder`)
  if (reminder !== undefined) entry.reminder = reminder
  const fired = raw['reminderFiredAt']
  if (fired !== undefined) {
    if (fired === null) {
      entry.reminderFiredAt = null
    } else if (isIsoUtcInstant(fired)) {
      entry.reminderFiredAt = fired
    } else {
      fail(`entries[${index}].reminderFiredAt: expected ISO 8601 UTC or null`)
    }
  }
  return entry
}

function parseTimer(raw: unknown): RunningTimer {
  if (raw === null || raw === undefined) return null
  if (!isRecord(raw)) fail('timer: expected object or null')
  const startedAt = raw['startedAt']
  if (!isIsoUtcInstant(startedAt)) fail('timer.startedAt: expected ISO 8601 UTC with Z')
  return {
    projectId: projectIdValue(raw['projectId'], 'timer.projectId'),
    title: trimmedString(raw['title'], 'timer.title', MAX_NAME_LENGTH, false),
    startedAt,
  }
}

function parseSettings(raw: unknown): Settings {
  if (!isRecord(raw)) fail('settings: expected object')
  const weekStartsOn = raw['weekStartsOn']
  if (weekStartsOn !== 0 && weekStartsOn !== 1) fail('settings.weekStartsOn: expected 0 or 1')
  const notificationsEnabled = raw['notificationsEnabled']
  if (typeof notificationsEnabled !== 'boolean') fail('settings.notificationsEnabled: expected boolean')
  const settings: Settings = {
    weekStartsOn,
    notificationsEnabled,
  }
  const defaultReminder = reminderValue(raw['defaultReminder'], 'settings.defaultReminder')
  if (defaultReminder !== undefined) settings.defaultReminder = defaultReminder
  return settings
}

// Runtime-валидация данных, пришедших с границы (IPC / localStorage).
// Возвращает нормализованный DbFile; лишние ключи отбрасываются.
// Бросает DbValidationError с понятной причиной.
// target — версия схемы, которой должен соответствовать результат (после миграций).
export function validateDb(raw: unknown, target: number = CURRENT_SCHEMA_VERSION): DbFile {
  if (!isRecord(raw)) fail('root: expected object')
  const schemaVersion = raw['schemaVersion']
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    fail('schemaVersion: expected integer')
  }
  if (schemaVersion > target) {
    fail(`schemaVersion ${schemaVersion} is newer than supported ${target}`)
  }
  if (schemaVersion !== target) {
    fail(`schemaVersion ${schemaVersion} cannot be read without a migration`)
  }
  if (!Array.isArray(raw['projects'])) fail('projects: expected array')
  if (!Array.isArray(raw['entries'])) fail('entries: expected array')
  return {
    schemaVersion: target,
    projects: raw['projects'].map(parseProject),
    entries: raw['entries'].map(parseEntry),
    timer: parseTimer(raw['timer']),
    settings: parseSettings(raw['settings']),
  }
}

export type DbParseResult =
  | { kind: 'ok'; db: DbFile; migrated: boolean }
  | { kind: 'too-new'; version: number }
  | { kind: 'corrupt'; reason: string }

export type { DbParseResult as ParseDbTextResult } // совместимость имён (M0)

// Разбор текста файла/хранилища: миграции -> валидация.
// Отличает «схема новее» (файл не перезаписывать!) от повреждения (см. ТЗ §3, M1).
// chain/target параметризуются для тестов синтетическими цепочками.
export function parseDbText(
  text: string,
  chain: MigrationChain = MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): DbParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    return { kind: 'corrupt', reason: 'not valid JSON' }
  }
  if (!isRecord(raw)) return { kind: 'corrupt', reason: 'root is not an object' }
  const result = runMigrations(raw, chain, target)
  switch (result.kind) {
    case 'too-new':
      return result
    case 'no-path':
      return { kind: 'corrupt', reason: result.reason }
    case 'current':
      break
  }
  try {
    return { kind: 'ok', db: validateDb(result.db, target), migrated: result.migratedFrom !== null }
  } catch (e) {
    const reason = e instanceof DbValidationError ? e.reason : String(e)
    return { kind: 'corrupt', reason }
  }
}

export function emptyDb(): DbFile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projects: [],
    entries: [],
    timer: null,
    settings: { weekStartsOn: 1, notificationsEnabled: true },
  }
}

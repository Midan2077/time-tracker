// Механизм миграций схемы (ТЗ §2, §3, M1). Чистый модуль: цепочку шагов передаёт вызывающий,
// чтобы тесты могли прогонять синтетические цепочки без изменения кода приложения.
//
// Формат записи: шаг { from, to, migrate } получает объект (схемы `from`, JSON уже распарсен,
// валидация по схеме `from` — на совести шага), возвращает объект схемы `to`.
// Поле schemaVersion результата подставляется принудительно = step.to.
//
// Текущая версия — 1, поля планирования (planned/reminder/reminderFiredAt) в v1 опциональны
// и читаются со значениями по умолчанию, поэтому цепочка пуста. При изменении структуры:
// повысить CURRENT_SCHEMA_VERSION, добавить шаг в MIGRATIONS, описать в DECISIONS.md.

export type MigrationStep = {
  from: number
  to: number
  migrate: (db: Record<string, unknown>) => Record<string, unknown>
}

export type MigrationChain = readonly MigrationStep[]

export type MigrationResult =
  | { kind: 'current'; db: Record<string, unknown>; migratedFrom: number | null }
  | { kind: 'too-new'; version: number }
  | { kind: 'no-path'; version: number; reason: string }

const MAX_STEPS = 16 // защита от цикла в цепочке

export function runMigrations(
  raw: Record<string, unknown>,
  chain: MigrationChain,
  target: number,
): MigrationResult {
  const declared = raw['schemaVersion']
  if (typeof declared !== 'number' || !Number.isInteger(declared)) {
    return { kind: 'no-path', version: NaN, reason: 'schemaVersion missing or not an integer' }
  }
  let version = declared
  let db = raw
  let migratedFrom: number | null = null
  for (let guard = 0; guard < MAX_STEPS; guard++) {
    if (version === target) {
      return { kind: 'current', db: { ...db, schemaVersion: version }, migratedFrom }
    }
    if (version > target) {
      return { kind: 'too-new', version }
    }
    const step = chain.find((s) => s.from === version)
    if (step === undefined) {
      return { kind: 'no-path', version, reason: `no migration path from schemaVersion ${version} to ${target}` }
    }
    db = step.migrate(db)
    db = { ...db, schemaVersion: step.to }
    if (step.to <= version) {
      return { kind: 'no-path', version, reason: `migration step ${step.from}->${step.to} does not increase version` }
    }
    version = step.to
    if (migratedFrom === null) migratedFrom = declared
  }
  return { kind: 'no-path', version, reason: 'migration chain too long (cycle?)' }
}

// Боевая цепочка. Пуста, пока текущая версия = 1.
export const MIGRATIONS: MigrationChain = []

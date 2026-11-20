// Контракт между UI и слоем платформы (ТЗ §5). Никаких electron/node-типов здесь.

import type { DbFile } from '../shared/db'

export type PlatformKind = 'electron' | 'browser'

// Флаги платформенных возможностей: UI не должен предполагать их наличие.
export type PlatformFlags = {
  hasTray: boolean
  hasHotkeys: boolean
}

// Итог загрузки хранилища (ТЗ §3, M1): приложение стартует в любом случае,
// данные не теряются безвозвратно (восстановление из бэкапа или чистая БД с сообщением).
export type LoadOutcome =
  | { kind: 'ok'; db: DbFile; migrated: boolean }
  | { kind: 'empty' }
  // Основной файл повреждён, данные восстановлены из бэкапа; копия битого файла сохранена.
  | { kind: 'restored'; db: DbFile; reason: string }
  // Файл повреждён, бэкап недоступен: стартуем с чистой БД; копия битого файла сохранена.
  | { kind: 'corrupt-clean'; reason: string }
  | { kind: 'too-new'; version: number }

// Узкий типизированный интерфейс платформы. Реализации:
// src/platform/electron (preload+main) и src/platform/browser.
export interface PlatformApi {
  readonly kind: PlatformKind
  readonly flags: PlatformFlags
  loadDb(): Promise<LoadOutcome>
  // Бросает Error с человекочитаемым сообщением; файл при ошибке не трогается.
  saveDb(db: DbFile): Promise<void>
}

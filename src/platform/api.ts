// Контракт между UI и слоем платформы (ТЗ §5). Никаких electron/node-типов здесь.

import type { DbFile } from '../shared/db'

export type PlatformKind = 'electron' | 'browser'

// Флаги платформенных возможностей: UI не должен предполагать их наличие.
export type PlatformFlags = {
  hasTray: boolean
  hasHotkeys: boolean
}

export type LoadOutcome =
  | { kind: 'ok'; db: DbFile }
  | { kind: 'empty' }
  | { kind: 'too-new'; version: number }
  | { kind: 'corrupt'; reason: string }

// Узкий типизированный интерфейс платформы. Реализации:
// src/platform/electron (preload+main) и src/platform/browser.
export interface PlatformApi {
  readonly kind: PlatformKind
  readonly flags: PlatformFlags
  loadDb(): Promise<LoadOutcome>
  // Бросает Error с человекочитаемым сообщением; файл при ошибке не трогается.
  saveDb(db: DbFile): Promise<void>
}

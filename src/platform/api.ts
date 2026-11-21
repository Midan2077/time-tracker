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
  // --- M3: трей знает про таймер, но не владеет им (единый писатель БД — store UI). ---
  // UI сообщает активен ли таймер — трей перекрашивает пункт «Старт/Стоп таймера».
  // No-op на платформах без трея.
  setTimerActive(active: boolean): void
  // Клик по пункту трея «Старт/Стоп таймера»: платформа просит UI переключить таймер.
  // Без трея колбэк не вызывается никогда.
  onTimerCommand(cb: (cmd: 'toggle') => void): void
  // --- M3.5: планировщик напоминаний живёт в слое платформы (main). ---
  // Сигнал наступил: UI обязан пометить reminderFiredAt (единый писатель файла — store).
  // show=false — просрочено дальше cutoff: не показываем, только помечаем (ТЗ §4).
  onReminderFired(cb: (payload: { entryId: string; firedAt: string; show: boolean }) => void): void
  // --- M4: экспорт CSV. Готовое содержимое формирует shared/csv (UI не знает про ФС):
  // десктоп — системный диалог сохранения (ТЗ §6), браузер — download-ссылка (ТЗ §5). ---
  exportCsv(job: { suggestedName: string; content: string }): Promise<{ kind: 'saved'; path: string } | { kind: 'cancelled' }>
}

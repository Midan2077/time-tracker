import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { emptyDb } from '../shared/db'
import type { LoadOutcome, PlatformApi } from '../platform/api'

type UiState = { phase: 'loading' } | { phase: 'ipc-error'; message: string } | LoadOutcome

type Tone = 'muted' | 'ok' | 'warn'

function describe(state: UiState): { label: string; tone: Tone } {
  if ('phase' in state) {
    if (state.phase === 'loading') return { label: 'загрузка данных…', tone: 'muted' }
    return { label: `ошибка платформы: ${state.message}`, tone: 'warn' }
  }
  switch (state.kind) {
    case 'ok':
      return {
        label:
          `файл данных прочитан (projects: ${state.db.projects.length}, entries: ${state.db.entries.length})` +
          (state.migrated ? ' — схема обновлена миграцией' : ''),
        tone: 'ok',
      }
    case 'empty':
      return { label: 'файл данных ещё не создан', tone: 'muted' }
    case 'restored':
      return {
        label: `основной файл был повреждён (${state.reason}) — данные восстановлены из бэкапа, копия сохранена в db.corrupt.json`,
        tone: 'warn',
      }
    case 'corrupt-clean':
      return {
        label: `данные повреждены (${state.reason}) — старт с чистой БД, копия сохранена в db.corrupt.json`,
        tone: 'warn',
      }
    case 'too-new':
      return { label: `схема БД новее поддерживаемой (v${state.version}) — запись отключена`, tone: 'warn' }
  }
}

export function App({ platform }: { platform: PlatformApi }): JSX.Element {
  const [state, setState] = useState<UiState>({ phase: 'loading' })
  const [saveError, setSaveError] = useState<string | null>(null)

  const reload = (): void => {
    setState({ phase: 'loading' })
    platform
      .loadDb()
      .then(setState)
      .catch((e: unknown) => setState({ phase: 'ipc-error', message: String(e) }))
  }

  useEffect(reload, [platform])

  const status = describe(state)
  const canInit = 'kind' in state && (state.kind === 'empty' || state.kind === 'corrupt-clean')
  const initLabel =
    'kind' in state && state.kind === 'corrupt-clean' ? 'Начать с чистой БД' : 'Создать файл данных'

  const initDb = (): void => {
    setSaveError(null)
    platform
      .saveDb(emptyDb())
      .then(reload)
      .catch((e: unknown) => setSaveError(String(e)))
  }

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Тайм-трекер</h1>
        <div className="badges">
          <span className="badge">платформа: {platform.kind}</span>
          <span className="badge">трей: {platform.flags.hasTray ? 'да' : 'нет'}</span>
          <span className="badge">хоткеи: {platform.flags.hasHotkeys ? 'да' : 'нет'}</span>
        </div>
      </header>
      <main className="card">
        <p className={`status tone-${status.tone}`}>{status.label}</p>
        {canInit && (
          <button type="button" onClick={initDb}>
            {initLabel}
          </button>
        )}
        {saveError !== null && <p className="status tone-warn">{saveError}</p>}
        <p className="hint">Каркас M0: окно, безопасность и PlatformApi. Календарь — на этапе M2.</p>
      </main>
    </div>
  )
}

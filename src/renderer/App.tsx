import { useState } from 'react'
import type { JSX } from 'react'
import { useStore } from './store'
import { CalendarView } from './components/CalendarView'
import { EntryDialog } from './components/EntryDialog'
import { ProjectsPanel } from './components/ProjectsPanel'
import type { UtcRange } from '../shared/calendar'
import { formatLocalTime } from '../shared/calendar'
import type { PlatformApi } from '../platform/api'
import { totalsForRange } from '../shared/sums'

type Dialog =
  | { kind: 'none' }
  | { kind: 'projects' }
  | { kind: 'create'; range: UtcRange }
  | { kind: 'edit'; entryId: string }

function statusTone(phase: string, banner: string | null, saveError: string | null): string {
  if (saveError !== null || banner !== null) return 'tone-warn'
  if (phase === 'ready') return 'tone-ok'
  return 'tone-muted'
}

export function App({ platform }: { platform: PlatformApi }): JSX.Element {
  const phase = useStore((s) => s.phase)
  const db = useStore((s) => s.db)
  const statusText = useStore((s) => s.statusText)
  const banner = useStore((s) => s.banner)
  const saveError = useStore((s) => s.saveError)
  const dismissBanner = useStore((s) => s.dismissBanner)
  const dismissSaveError = useStore((s) => s.dismissSaveError)
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })

  const readonly = phase === 'readonly'
  const editingEntry =
    dialog.kind === 'edit' ? db.entries.find((e) => e.id === dialog.entryId) ?? null : null

  // Итог за сегодня — витрина расчёта сумм (полный отчёт: M4).
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
  const todayMinutes = totalsForRange(db.entries, db.projects, dayStart, dayEnd, now.toISOString())
    .reduce((acc, t) => acc + t.minutes, 0)

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Тайм-трекер</h1>
        <div className="badges">
          <span className="badge" data-testid="today-total">
            сегодня: {Math.floor(todayMinutes / 60)}ч {todayMinutes % 60}м
          </span>
          <span className="badge">платформа: {platform.kind}</span>
          <button type="button" className="ghost" onClick={() => setDialog({ kind: 'projects' })}>
            Проекты
          </button>
        </div>
      </header>

      <p className={`status ${statusTone(phase, banner, saveError)}`} data-testid="status">
        {statusText}
      </p>
      {banner !== null && (
        <div className="banner tone-warn">
          <span>{banner}</span>
          <button type="button" className="ghost" onClick={dismissBanner} aria-label="Скрыть">✕</button>
        </div>
      )}
      {saveError !== null && (
        <div className="banner tone-warn">
          <span>{saveError}</span>
          <button type="button" className="ghost" onClick={dismissSaveError} aria-label="Скрыть">✕</button>
        </div>
      )}

      {phase !== 'loading' && (
        <main className="card calendar-card">
          <CalendarView
            readonly={readonly}
            onPickRange={(range) => setDialog({ kind: 'create', range })}
            onOpenEntry={(entryId) => setDialog({ kind: 'edit', entryId })}
          />
        </main>
      )}

      {dialog.kind === 'projects' && <ProjectsPanel onClose={() => setDialog({ kind: 'none' })} />}
      {dialog.kind === 'create' && (
        <EntryDialog entry={null} initial={dialog.range} onClose={() => setDialog({ kind: 'none' })} />
      )}
      {dialog.kind === 'edit' && editingEntry !== null && (
        <EntryDialog entry={editingEntry} initial={null} onClose={() => setDialog({ kind: 'none' })} />
      )}

      <footer className="hint">
        Выделите время в сетке, чтобы создать блок; перетаскивание и край блока меняют время с
        немедленным сохранением. Мутации применяются к файлу данных сразу, ошибки показываются
        баннером. Часовой пояс — системный ({formatLocalTime(new Date().toISOString())} сейчас).
      </footer>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from './store'
import { CalendarView } from './components/CalendarView'
import { EntryDialog } from './components/EntryDialog'
import { ProjectsPanel } from './components/ProjectsPanel'
import { TimerPanel } from './components/TimerPanel'
import { ReportDialog } from './components/ReportDialog'
import type { UtcRange } from '../shared/calendar'
import { formatLocalTime, snapRangeUtc, toZ } from '../shared/calendar'
import type { PlatformApi } from '../platform/api'
import { totalsForRange, plannedMinutesForRange } from '../shared/sums'
import { weekRangeUtc } from '../shared/calendar'
import { plannedForRange } from '../shared/planning'

type Dialog =
  | { kind: 'none' }
  | { kind: 'projects' }
  | { kind: 'report' }
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
  const updateSettings = useStore((s) => s.updateSettings)
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })

  const readonly = phase === 'readonly'
  const editingEntry =
    dialog.kind === 'edit' ? db.entries.find((e) => e.id === dialog.entryId) ?? null : null

  // Итог за сегодня и план на неделю — витрина расчётов (полный отчёт: M4).
  // now берём из store: тик 30 с превращает «запланированное» в «прошедшее» без перезапуска (M2.5).
  const nowMs = useStore((s) => s.now)
  const now = new Date(nowMs)
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
  const todayMinutes = totalsForRange(db.entries, db.projects, dayStart, dayEnd, now.toISOString())
    .reduce((acc, t) => acc + t.minutes, 0)
  const week = weekRangeUtc(nowMs, db.settings.weekStartsOn)
  const plannedCount = plannedForRange(db.entries, week, nowMs).length
  const plannedMinutes = plannedMinutesForRange(db.entries, week.start, week.end, now.toISOString())

  // Горячие клавиши (ТЗ §4 M3, только десктоп — флаг hasHotkeys): Cmd/Ctrl+N — новый блок
  // на час от текущего момента, Space — переключение таймера (в поле ввода не перехватываем),
  // Cmd/Ctrl+E — задел: экспорт подключим на M4, клавиша уже перехватывается.
  useEffect(() => {
    if (platform === null || !platform.flags.hasHotkeys) return
    const onKey = (e: KeyboardEvent): void => {
      const t: EventTarget | null = e.target
      const inField =
        t instanceof HTMLElement && (t.closest('input, textarea, select') !== null || t.isContentEditable)
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault() // Cmd+N не должен рождать окно Electron
        const anchor = Date.now()
        setDialog({ kind: 'create', range: snapRangeUtc(toZ(anchor), toZ(anchor + 3_600_000)) })
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setDialog({ kind: 'report' }) // M4: экспорт — кнопкой в отчёте (без неожиданных записей на диск)
      } else if (e.key === ' ' && !mod && !e.repeat && !inField) {
        e.preventDefault() // Space не должен скроллить страницу, когда он горячая клавиша
        useStore.getState().toggleTimer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [platform])

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Тайм-трекер</h1>
        <div className="badges">
          <span className="badge" data-testid="today-total">
            сегодня: {Math.floor(todayMinutes / 60)}ч {todayMinutes % 60}м
          </span>
          <span className="badge" data-testid="planned-total">
            план недели: {plannedCount} на {Math.floor(plannedMinutes / 60)}ч {plannedMinutes % 60}м
          </span>
          <span className="badge">платформа: {platform.kind}</span>
          <button type="button" className="ghost" onClick={() => setDialog({ kind: 'projects' })}>
            Проекты
          </button>
          <button type="button" className="ghost" data-testid="open-report" onClick={() => setDialog({ kind: 'report' })}>
            Отчёт
          </button>
          <label className="field-inline">
            <input
              type="checkbox"
              data-testid="notify-toggle"
              checked={db.settings.notificationsEnabled}
              onChange={(e) => updateSettings({ notificationsEnabled: e.target.checked })}
            />
            напоминания
          </label>
          <TimerPanel />
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
      {dialog.kind === 'report' && <ReportDialog onClose={() => setDialog({ kind: 'none' })} />}
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

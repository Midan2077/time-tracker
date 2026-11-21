import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Modal } from './Modal'
import { totalsForRange } from '../../shared/sums'
import { isoToLocalInput, weekRangeUtc, type UtcRange } from '../../shared/calendar'
import { useStore } from '../store'

// Отчёт за период (ТЗ §4 M4): произвольные даты включительно, по умолчанию — текущая
// неделя; сумма по проектам только по завершившимся блокам (end <= now, ТЗ §3),
// пересечение с периодом — отсечкой. Архивные проекты в таблице (по существующим блокам).
export function ReportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const db = useStore((s) => s.db)
  const nowMs = useStore((s) => s.now)
  const exportReport = useStore((s) => s.exportReport)
  const week = weekRangeUtc(nowMs, db.settings.weekStartsOn)
  const [from, setFrom] = useState(isoToLocalInput(week.start).slice(0, 10))
  const [to, setTo] = useState(isoToLocalInput(new Date(Date.parse(week.end) - 1).toISOString()).slice(0, 10))

  const range: UtcRange | null = useMemo(() => {
    const s = new Date(`${from}T00:00:00`)
    const e0 = new Date(`${to}T00:00:00`)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e0.getTime())) return null
    const end = new Date(e0.getFullYear(), e0.getMonth(), e0.getDate() + 1) // «включительно»
    if (end.getTime() <= s.getTime()) return null
    return { start: s.toISOString(), end: end.toISOString() }
  }, [from, to])

  const totals = range === null
    ? []
    : totalsForRange(db.entries, db.projects, range.start, range.end, new Date(nowMs).toISOString())
  const total = totals.reduce((acc, t) => acc + t.minutes, 0)
  const hm = (m: number): string => `${Math.floor(m / 60)}ч ${m % 60}м`

  return (
    <Modal title="Отчёт по проектам" onClose={onClose}>
      <div className="field-row">
        <label className="field">
          <span>С даты</span>
          <input data-testid="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>По дату</span>
          <input data-testid="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {range === null ? (
        <p className="form-error">Некорректный период</p>
      ) : (
        <table className="report-table" data-testid="report-table">
          <thead>
            <tr>
              <th>Проект</th>
              <th>Потрачено</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.projectId ?? 'none'}>
                <td>{t.name}</td>
                <td>{hm(t.minutes)}</td>
              </tr>
            ))}
            {totals.length === 0 && (
              <tr>
                <td colSpan={2}>Нет завершившихся блоков за период</td>
              </tr>
            )}
            <tr className="total-row">
              <td>ВСЕГО</td>
              <td>{hm(total)}</td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="hint">
        Учтены только завершившиеся блоки; запланированные и текущий таймер — не потраченное
        время. Границы периода режут блоки по пересечению.
      </p>
      <div className="dialog-actions">
        <span className="spacer" />
        <button type="button" className="ghost" onClick={onClose}>
          Закрыть
        </button>
        <button
          type="button"
          className="primary"
          data-testid="report-export"
          disabled={range === null}
          onClick={() => {
            if (range !== null) void exportReport(range)
          }}
        >
          Экспорт CSV
        </button>
      </div>
    </Modal>
  )
}

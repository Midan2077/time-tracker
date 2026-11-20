import { useState } from 'react'
import type { JSX } from 'react'
import { Modal } from './Modal'
import { isoToLocalInput, localInputToIso } from '../../shared/calendar'
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH, type Entry } from '../../shared/db'
import { selectActiveProjects, useStore } from '../store'
import type { UtcRange } from '../../shared/calendar'

type Props = {
  // create: задан initial (снимок выделения); edit: задан entry.
  entry: Entry | null
  initial: UtcRange | null
  onClose: () => void
}

function validate(title: string, startIso: string, endIso: string, note: string): string | null {
  if (title.trim().length === 0) return 'Название не может быть пустым'
  if (title.trim().length > MAX_NAME_LENGTH) return `Название длиннее ${MAX_NAME_LENGTH} символов`
  if (note.length > MAX_NOTE_LENGTH) return `Заметка длиннее ${MAX_NOTE_LENGTH} символов`
  if (Date.parse(endIso) <= Date.parse(startIso)) return 'Конец должен быть позже начала'
  return null
}

export function EntryDialog({ entry, initial, onClose }: Props): JSX.Element {
  const db = useStore((s) => s.db)
  const addEntry = useStore((s) => s.addEntry)
  const updateEntry = useStore((s) => s.updateEntry)
  const deleteEntry = useStore((s) => s.deleteEntry)

  const start0 = entry?.start ?? initial?.start
  const end0 = entry?.end ?? initial?.end
  if (start0 === undefined || end0 === undefined) throw new Error('EntryDialog: no time source')

  const active = selectActiveProjects(db)
  const currentProject = entry !== null && entry.projectId !== null
    ? db.projects.find((p) => p.id === entry.projectId)
    : undefined
  // Архивный проект текущего блока остаётся в списке, чтобы правка не «съела» его.
  const projectOptions =
    currentProject !== undefined && currentProject.archived && !active.some((p) => p.id === currentProject.id)
      ? [...active, currentProject]
      : active

  const [title, setTitle] = useState(entry?.title ?? '')
  const [projectId, setProjectId] = useState<string>(entry?.projectId ?? '')
  const [startVal, setStartVal] = useState(isoToLocalInput(start0))
  const [endVal, setEndVal] = useState(isoToLocalInput(end0))
  const [note, setNote] = useState(entry?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    let startIso: string
    let endIso: string
    try {
      startIso = localInputToIso(startVal)
      endIso = localInputToIso(endVal)
    } catch {
      setError('Некорректная дата или время')
      return
    }
    const err = validate(title, startIso, endIso, note)
    if (err !== null) {
      setError(err)
      return
    }
    if (entry === null) {
      addEntry({
        title: title.trim(),
        projectId: projectId === '' ? null : projectId,
        start: startIso,
        end: endIso,
        ...(note.trim().length > 0 ? { note: note.trim() } : {}),
      })
    } else {
      updateEntry(entry.id, {
        title: title.trim(),
        projectId: projectId === '' ? null : projectId,
        start: startIso,
        end: endIso,
        note: note.trim().length > 0 ? note.trim() : null,
      })
    }
    onClose()
  }

  return (
    <Modal title={entry === null ? 'Новый блок' : 'Блок'} onClose={onClose}>
      <label className="field">
        <span>Название</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_NAME_LENGTH} autoFocus />
      </label>
      <label className="field">
        <span>Проект</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">— без проекта —</option>
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.archived ? ' (архив)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="field-row">
        <label className="field">
          <span>Начало</span>
          <input type="datetime-local" value={startVal} onChange={(e) => setStartVal(e.target.value)} />
        </label>
        <label className="field">
          <span>Конец</span>
          <input type="datetime-local" value={endVal} onChange={(e) => setEndVal(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Заметка</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={MAX_NOTE_LENGTH} />
      </label>
      {error !== null && <p className="form-error">{error}</p>}
      <div className="dialog-actions">
        {entry !== null && (
          <button type="button" className="danger" onClick={() => { deleteEntry(entry.id); onClose() }}>
            Удалить
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="primary" onClick={submit}>
          Сохранить
        </button>
      </div>
    </Modal>
  )
}

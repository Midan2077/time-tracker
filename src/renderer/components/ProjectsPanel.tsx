import { useState } from 'react'
import type { JSX } from 'react'
import { Modal } from './Modal'
import { useStore, selectActiveProjects, selectArchivedProjects } from '../store'
import { MAX_NAME_LENGTH, type Project } from '../../shared/db'

const COLOR_RE = /^#[0-9a-fA-F]{6}$/
const DEFAULT_COLOR = '#2f6fed'

function ProjectRow({ project }: { project: Project }): JSX.Element {
  const renameProject = useStore((s) => s.renameProject)
  const setProjectColor = useStore((s) => s.setProjectColor)
  const setProjectArchived = useStore((s) => s.setProjectArchived)
  return (
    <li className="project-row">
      <input
        type="color"
        value={project.color}
        onChange={(e) => {
          if (COLOR_RE.test(e.target.value)) setProjectColor(project.id, e.target.value)
        }}
        aria-label={`Цвет проекта ${project.name}`}
      />
      <input
        className="project-name"
        defaultValue={project.name}
        maxLength={MAX_NAME_LENGTH}
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (v.length > 0 && v !== project.name) renameProject(project.id, v)
          else e.target.value = project.name
        }}
        aria-label={`Название проекта ${project.name}`}
      />
      <button type="button" className="ghost" onClick={() => setProjectArchived(project.id, !project.archived)}>
        {project.archived ? 'Вернуть' : 'В архив'}
      </button>
    </li>
  )
}

export function ProjectsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const db = useStore((s) => s.db)
  const createProject = useStore((s) => s.createProject)
  const updateSettings = useStore((s) => s.updateSettings)

  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [error, setError] = useState<string | null>(null)

  const create = (): void => {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setError('Название не может быть пустым')
      return
    }
    if (!COLOR_RE.test(color)) {
      setError('Некорректный цвет')
      return
    }
    createProject(trimmed, color)
    setName('')
    setError(null)
  }

  return (
    <Modal title="Проекты и настройки" onClose={onClose}>
      <div className="project-create">
        <input
          placeholder="Новый проект"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create()
          }}
        />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Цвет нового проекта" />
        <button type="button" className="primary" onClick={create}>
          Создать
        </button>
      </div>
      {error !== null && <p className="form-error">{error}</p>}

      <h3>Активные</h3>
      <ul className="project-list">
        {selectActiveProjects(db).map((p) => (
          <ProjectRow key={p.id} project={p} />
        ))}
        {selectActiveProjects(db).length === 0 && <li className="empty">Пока нет проектов</li>}
      </ul>

      {selectArchivedProjects(db).length > 0 && (
        <>
          <h3>Архив</h3>
          <ul className="project-list">
            {selectArchivedProjects(db).map((p) => (
              <ProjectRow key={p.id} project={p} />
            ))}
          </ul>
        </>
      )}

      <h3>Неделя начинается</h3>
      <div className="field-row">
        <label>
          <input
            type="radio"
            name="weekStartsOn"
            checked={db.settings.weekStartsOn === 1}
            onChange={() => updateSettings({ weekStartsOn: 1 })}
          />{' '}
          Понедельник
        </label>
        <label>
          <input
            type="radio"
            name="weekStartsOn"
            checked={db.settings.weekStartsOn === 0}
            onChange={() => updateSettings({ weekStartsOn: 0 })}
          />{' '}
          Воскресенье
        </label>
      </div>
    </Modal>
  )
}

import { useState } from 'react'
import type { JSX } from 'react'
import { selectActiveProjects, useStore } from '../store'
import { formatElapsed, timerElapsedMs } from '../../shared/timer'
import { MAX_NAME_LENGTH } from '../../shared/db'

// Панель таймера в шапке (ТЗ §4 M3). Логика целиком в store — панель лишь отражает
// db.timer; на платформах без трея и хоткеев работает так же.
export function TimerPanel(): JSX.Element {
  const db = useStore((s) => s.db)
  const nowMs = useStore((s) => s.now)
  const startTimer = useStore((s) => s.startTimer)
  const stopTimer = useStore((s) => s.stopTimer)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const active = selectActiveProjects(db)
  const timer = db.timer

  if (timer !== null) {
    const project = timer.projectId === null ? undefined : db.projects.find((p) => p.id === timer.projectId)
    return (
      <div className="timer-panel running" data-testid="timer-active">
        <span className="timer-dot" aria-hidden />
        <span className="timer-name">
          {timer.title}
          {project !== undefined ? ` · ${project.name}` : ''}
        </span>
        <span className="timer-elapsed" data-testid="timer-elapsed">
          {formatElapsed(timerElapsedMs(timer, nowMs))}
        </span>
        <button type="button" className="primary" data-testid="timer-stop" onClick={stopTimer}>
          Стоп
        </button>
      </div>
    )
  }
  return (
    <div className="timer-panel">
      <input
        data-testid="timer-title"
        className="timer-title"
        placeholder="Задача"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={MAX_NAME_LENGTH}
      />
      <select data-testid="timer-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">— без проекта —</option>
        {active.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="primary"
        data-testid="timer-start"
        onClick={() => startTimer({ projectId: projectId === '' ? null : projectId, title: title.trim().length > 0 ? title.trim() : 'Задача' })}
      >
        Старт
      </button>
    </div>
  )
}

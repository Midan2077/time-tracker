import { useMemo } from 'react'
import type { JSX } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { DateSelectArg, EventClickArg, EventDropArg } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import ruLocale from '@fullcalendar/core/locales/ru'
import { snapRangeUtc, type UtcRange } from '../../shared/calendar'
import { selectProjectById, useStore } from '../store'
import type { DbFile } from '../../shared/db'

type Props = {
  onPickRange: (range: UtcRange) => void
  onOpenEntry: (entryId: string) => void
  readonly: boolean
}

function eventsFrom(db: DbFile) {
  return db.entries.map((e) => {
    const project = selectProjectById(db, e.projectId)
    return {
      id: e.id,
      start: e.start,
      end: e.end,
      title: e.title,
      backgroundColor: project?.color ?? '#5b6472',
      classNames: [
        'tz-event',
        ...(project?.archived ? ['tz-event--archived'] : []),
        ...(e.planned ? ['tz-event--planned'] : []),
      ],
    }
  })
}

export function CalendarView({ onPickRange, onOpenEntry, readonly }: Props): JSX.Element {
  const db = useStore((s) => s.db)
  const updateEntry = useStore((s) => s.updateEntry)
  const events = useMemo(() => eventsFrom(db), [db])

  const applyRange = (id: string, startIso: string, endIso: string, revert: () => void): void => {
    const before = useStore.getState().db.entries.find((e) => e.id === id)
    updateEntry(id, { start: startIso, end: endIso })
    // Если валидация/сохранение отклонят правку — store вернёт своё состояние;
    // синхронный отказ (например, readonly) определяем по отсутствию изменений.
    const after = useStore.getState().db.entries.find((e) => e.id === id)
    if (before !== undefined && after !== undefined && after.start === before.start && after.end === before.end) {
      revert()
    }
  }

  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
      initialView="timeGridWeek"
      locale={ruLocale}
      firstDay={db.settings.weekStartsOn}
      headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
      buttonText={{ today: 'сегодня', month: 'месяц', week: 'неделя', day: 'день' }}
      height="auto"
      slotDuration="00:15:00"
      slotMinTime="00:00:00"
      slotMaxTime="24:00:00"
      allDaySlot={false}
      nowIndicator
      selectable={!readonly}
      selectMirror
      editable={!readonly}
      eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
      slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
      events={events}
      select={(arg: DateSelectArg) => {
        if (arg.start === null || arg.end === null) return
        onPickRange(snapRangeUtc(arg.start.toISOString(), arg.end.toISOString()))
      }}
      eventClick={(arg: EventClickArg) => onOpenEntry(arg.event.id)}
      eventDrop={(arg: EventDropArg) => {
        const { start, end } = arg.event
        if (start !== null && end !== null) applyRange(arg.event.id, start.toISOString(), end.toISOString(), () => arg.revert())
      }}
      eventResize={(arg: EventResizeDoneArg) => {
        const { start, end } = arg.event
        if (start !== null && end !== null) applyRange(arg.event.id, start.toISOString(), end.toISOString(), () => arg.revert())
      }}
    />
  )
}

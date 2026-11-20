import { useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { DateSelectArg, EventClickArg, EventDropArg } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import ruLocale from '@fullcalendar/core/locales/ru'
import { snapRangeUtc, type UtcRange } from '../../shared/calendar'
import { isPlanned } from '../../shared/planning'
import { timerLiveRange } from '../../shared/timer'
import { selectProjectById, useStore } from '../store'
import type { DbFile, RunningTimer } from '../../shared/db'

type Props = {
  onPickRange: (range: UtcRange) => void
  onOpenEntry: (entryId: string) => void
  readonly: boolean
}

// nowMsInside — текущий момент из store: planned-стиль по факту времени, а не по флагу (M2.5).
function eventsFrom(db: DbFile, nowMs: number) {
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
        ...(isPlanned(e, nowMs) ? ['tz-event--planned'] : []),
      ],
    }
  })
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Виртуальный «растущий» блок таймера (ТЗ §4 M3): не Entry, в БД не пишется;
// клик и перетаскивание по нему не работают.
function timerEventInput(db: DbFile, timer: RunningTimer, nowMs: number) {
  const range = timerLiveRange(timer, nowMs)
  if (timer === null || range === null || Date.parse(range.end) <= Date.parse(range.start)) return []
  const project = selectProjectById(db, timer.projectId)
  return [
    {
      id: '@timer',
      start: range.start,
      end: range.end,
      title: `⏱ ${timer.title}`,
      backgroundColor: project?.color ?? '#3d7ea6',
      classNames: ['tz-event', 'tz-event--timer'],
      startEditable: false,
      durationEditable: false,
    },
  ]
}

export function CalendarView({ onPickRange, onOpenEntry, readonly }: Props): JSX.Element {
  const db = useStore((s) => s.db)
  const nowMs = useStore((s) => s.now)
  const updateEntry = useStore((s) => s.updateEntry)
  const calRef = useRef<FullCalendar>(null)
  const [pickedDate, setPickedDate] = useState('')
  const events = useMemo(
    () => [...eventsFrom(db, nowMs), ...timerEventInput(db, db.timer, nowMs)],
    [db, nowMs],
  )

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
    <div className="cal-wrap">
      <div className="cal-nav">
        <label className="field-inline">
          <span>к дате</span>
          <input
            type="date"
            value={pickedDate}
            onChange={(e) => {
              const v = e.target.value
              setPickedDate(v)
              // Полдень локальный: дата выбрана пользователем как день, время не важно;
              // полдень защищён от сдвига суток на границах поясов.
              if (DATE_RE.test(v)) calRef.current?.getApi().gotoDate(`${v}T12:00:00`)
            }}
          />
        </label>
      </div>
      <FullCalendar
        ref={calRef}
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
        eventClick={(arg: EventClickArg) => {
          if (arg.event.id === '@timer') return
          onOpenEntry(arg.event.id)
        }}
        eventDrop={(arg: EventDropArg) => {
          const { start, end } = arg.event
          if (start !== null && end !== null) applyRange(arg.event.id, start.toISOString(), end.toISOString(), () => arg.revert())
        }}
        eventResize={(arg: EventResizeDoneArg) => {
          const { start, end } = arg.event
          if (start !== null && end !== null) applyRange(arg.event.id, start.toISOString(), end.toISOString(), () => arg.revert())
        }}
      />
    </div>
  )
}

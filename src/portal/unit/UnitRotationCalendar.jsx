// src/portal/unit/UnitRotationCalendar.jsx
//
// Unit Leader rotation activity calendar.
//
// THIS IS A RECORD, NOT A SCHEDULE. ASPIRE has no scheduled-shift data: a shift
// row is created when a student checks in, and a future shift_date is rejected by
// the submit endpoint. The UI says "Rotation activity", never "Schedule".
//
// PROPS ONLY. This component fetches nothing and knows no authorization. Shifts
// arrive already scoped and already field-filtered by api/portal/unit-shift-activity.js.
//
// DATES ARE STRINGS. shift_date is TEXT in YYYY-MM-DD, written in Pacific time
// at check-in. All comparison and grouping here is string-based against Pacific
// "today", so a Unit Leader in any timezone sees the same day boundaries the
// student did.

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  CanonicalCalendarLayout,
  CanonicalCalendarSidebar,
  CanonicalCalendarTodayPanel,
} from '../../components/shared/CanonicalCalendarFoundation'
import { pacificToday, monthGrid, monthLabel, groupByDay } from './rotationCalendarDates'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function fmtClock(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatLongDate(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number)
  if (!y || !m || !d) return 'Selected day'
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function UnitMiniCalendar({ cells, byDay, selectedDate, today, onSelectDate }) {
  return (
    <div>
      <div className="canonical-calendar-kicker">Mini Calendar</div>
      <div className="ptl-cal-mini-grid" role="grid" aria-label="Mini rotation activity calendar">
        {DOW.map(day => <div key={day} className="ptl-cal-mini-dow" role="columnheader">{day[0]}</div>)}
        {cells.map(({ ymd, inMonth }) => {
          const day = byDay.get(ymd) || []
          const selected = ymd === selectedDate
          const isToday = ymd === today
          return (
            <button
              key={ymd}
              type="button"
              role="gridcell"
              className={[
                'ptl-cal-mini-cell',
                inMonth ? '' : 'ptl-cal-mini-out',
                isToday ? 'ptl-cal-mini-today' : '',
                selected ? 'ptl-cal-mini-selected' : '',
              ].filter(Boolean).join(' ')}
              aria-label={`${ymd}${day.length ? `, ${day.length} student activit${day.length === 1 ? 'y' : 'ies'}` : ', no student activity recorded'}`}
              onClick={() => onSelectDate(ymd)}
            >
              <span>{Number(ymd.slice(8, 10))}</span>
              {day.length > 0 && <i aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SelectedDayActivity({ shifts }) {
  if (shifts.length === 0) return null
  return (
    <ul className="ptl-cal-today-list">
      {shifts.map(shift => (
        <li key={shift.id}>
          <span className={`ptl-cal-chip${shift.state === 'in_progress' ? ' ptl-cal-chip-live' : ''}`} aria-hidden="true">
            {initials(shift.student_name)}
          </span>
          <span>
            <b>{shift.student_name || 'Student'}</b>
            <small>
              {shift.unit_key ? `${shift.unit_key} · ` : ''}
              {shift.state === 'in_progress' ? 'On shift now' : 'Completed shift'}
              {shift.checked_in_at ? ` · checked in ${fmtClock(shift.checked_in_at)}` : ''}
            </small>
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function UnitRotationCalendar({ shifts = [], windowStart, onSelectDay, loading = false }) {
  const today = pacificToday()
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))
  const [selectedDate, setSelectedDate] = useState(today)

  const byDay = useMemo(() => groupByDay(shifts), [shifts])
  const cells = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor])
  const selectedShifts = byDay.get(selectedDate) || []

  const monthStart = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-01`
  const canGoBack = !windowStart || monthStart > windowStart
  const canGoForward = monthStart < today.slice(0, 8) + '01'
  const monthHasActivity = cells.some(c => c.inMonth && byDay.has(c.ymd))

  const step = (delta) => {
    const d = new Date(Date.UTC(cursor.y, cursor.m + delta, 1))
    setCursor({ y: d.getUTCFullYear(), m: d.getUTCMonth() })
  }

  const goToday = () => {
    setSelectedDate(today)
    setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })
  }

  const selectDate = (ymd, day = byDay.get(ymd) || []) => {
    setSelectedDate(ymd)
    if (day.length > 0) onSelectDay?.(ymd, day)
  }

  const sidebar = (
    <CanonicalCalendarSidebar>
      <UnitMiniCalendar cells={cells} byDay={byDay} selectedDate={selectedDate} today={today} onSelectDate={setSelectedDate} />
      <CanonicalCalendarTodayPanel
        dateLabel={formatLongDate(selectedDate)}
        summary={`${selectedShifts.length} student activit${selectedShifts.length === 1 ? 'y' : 'ies'} recorded`}
        emptyLabel="No student activity recorded for this day."
      >
        {selectedShifts.length > 0 && <SelectedDayActivity shifts={selectedShifts} />}
      </CanonicalCalendarTodayPanel>
    </CanonicalCalendarSidebar>
  )

  const toolbar = (
    <div className="ptl-cal-nav">
      <button type="button" className="ptl-btn ptl-btn-small" disabled={!canGoBack}
        onClick={() => step(-1)} aria-label="Previous month">
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <span className="ptl-cal-month" aria-live="polite">{monthLabel(cursor.y, cursor.m)}</span>
      <button type="button" className="ptl-btn ptl-btn-small" disabled={!canGoForward}
        onClick={() => step(1)} aria-label="Next month">
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      <button type="button" className="ptl-btn ptl-btn-small" onClick={goToday}>Today</button>
    </div>
  )

  return (
    <CanonicalCalendarLayout
      title="Rotation activity"
      description="Logged student shift activity from authorized Unit Leader scopes."
      labelledBy="ul-cal-title"
      sidebar={sidebar}
      toolbar={toolbar}
      footer={(
        <p className="ptl-muted" style={{ marginTop: 8, fontSize: 11.5 }}>
          This shows shifts your students have actually logged, over the last 90 days.
          ASPIRE does not hold a forward schedule, so upcoming shifts do not appear here.
        </p>
      )}
    >
      {loading ? (
        <p className="ptl-muted" role="status">Loading rotation activity</p>
      ) : (
        <>
          <div className="ptl-cal-grid" role="grid" aria-label={`Rotation activity for ${monthLabel(cursor.y, cursor.m)}`}>
            {DOW.map(day => (
              <div key={day} className="ptl-cal-dow" role="columnheader">{day}</div>
            ))}
            {cells.map(({ ymd, inMonth }) => {
              const day = byDay.get(ymd) || []
              const isToday = ymd === today
              const selected = ymd === selectedDate
              const future = ymd > today
              const live = day.some(s => s.state === 'in_progress')
              const label = day.length === 0
                ? `${ymd}, no activity`
                : `${ymd}, ${day.length} shift${day.length === 1 ? '' : 's'}${live ? ', on shift now' : ''}`
              return (
                <button
                  key={ymd}
                  type="button"
                  role="gridcell"
                  className={[
                    'ptl-cal-cell',
                    inMonth ? '' : 'ptl-cal-out',
                    isToday ? 'ptl-cal-today' : '',
                    selected ? 'ptl-cal-selected' : '',
                    future ? 'ptl-cal-future' : '',
                    day.length > 0 ? 'ptl-cal-has' : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={label}
                  onClick={() => selectDate(ymd, day)}
                >
                  <span className="ptl-cal-num">{Number(ymd.slice(8, 10))}</span>
                  {day.slice(0, 3).map(shift => (
                    <span
                      key={shift.id}
                      className={`ptl-cal-chip${shift.state === 'in_progress' ? ' ptl-cal-chip-live' : ''}`}
                    >
                      {initials(shift.student_name)}
                    </span>
                  ))}
                  {day.length > 3 && <span className="ptl-cal-more">+{day.length - 3}</span>}
                </button>
              )
            })}
          </div>

          {!monthHasActivity && (
            <p className="ptl-muted" style={{ marginTop: 10 }}>
              No rotation activity recorded in {monthLabel(cursor.y, cursor.m)}.
            </p>
          )}

          <div className="ptl-cal-legend">
            <span><span className="ptl-cal-chip" aria-hidden="true">AR</span> Completed shift</span>
            <span><span className="ptl-cal-chip ptl-cal-chip-live" aria-hidden="true">AR</span> On shift now</span>
          </div>
        </>
      )}
    </CanonicalCalendarLayout>
  )
}

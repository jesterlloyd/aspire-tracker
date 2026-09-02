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
//
// VISUAL PARITY. The toolbar, weekday header, and month grid are the shared
// CanonicalCalendar* primitives the main-app Interviews calendar uses, so this
// calendar and that one are one visual system, not two look-alikes. What differs is
// only the content inside a cell (activity chips, never staff capacity controls) and
// the toolbar's right side (empty, because a Unit Leader adds no events).

import { useMemo, useState } from 'react'
import {
  CanonicalCalendarLayout,
  CanonicalCalendarSidebar,
  CanonicalCalendarTodayPanel,
  CanonicalCalendarNav,
  CanonicalCalendarMonthTitle,
  CanonicalWeekdayHeader,
  CanonicalMonthCell,
  CanonicalHolidayChip,
  CanonicalActivityChip,
} from '../../components/shared/CanonicalCalendarFoundation'
import { pacificToday, monthGrid, monthLabel, groupByDay } from '../../lib/rotationCalendarDates'
// CALENDAR-HOLIDAY-CANON: pure client-side date math, no fetch and no persistence, so the
// props-only contract above still holds. Context, never a record.
import { getUsHolidaysForRange } from '../../lib/usHolidays'
import { firstNameOf } from '../../lib/masthead'
import { ordinalWord } from '../../lib/ordinalWord'

// Sunday-first, matching the main-app Interviews calendar week start. The main grid
// uses the three-letter labels; the mini calendar uses the first letter of each.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

// The extra chip content for one shift: "with <preceptor first name>" and the chronological
// ordinal, plus a full accessible label. The preceptor's first name only (never a last name)
// is shown; a missing preceptor drops the "with" clause (the safe fallback). The ordinal is
// server-computed from full history (shift.ordinal).
function chipExtras(shift) {
  const pFirst = firstNameOf(shift.preceptor_name) || null
  const ordinal = Number.isInteger(shift.ordinal) ? shift.ordinal : null
  const secondary = pFirst ? `with ${pFirst}` : null
  const nameForLabel = shift.student_name || 'Student'
  let ariaLabel = pFirst ? `${nameForLabel} with ${pFirst}` : nameForLabel
  if (ordinal) ariaLabel += `, ${ordinalWord(ordinal)} logged shift`
  return { secondary, ordinal, ariaLabel }
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
              {firstNameOf(shift.preceptor_name) ? `with ${firstNameOf(shift.preceptor_name)} · ` : ''}
              {shift.state === 'in_progress' ? 'On shift now' : 'Completed shift'}
              {Number.isInteger(shift.ordinal) ? ` · ${ordinalWord(shift.ordinal)} logged shift` : ''}
              {shift.checked_in_at ? ` · checked in ${fmtClock(shift.checked_in_at)}` : ''}
            </small>
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function UnitRotationCalendar({ shifts = [], onSelectDay, loading = false }) {
  const today = pacificToday()
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))
  const [selectedDate, setSelectedDate] = useState(today)

  const byDay = useMemo(() => groupByDay(shifts), [shifts])
  const cells = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor])
  const holidaysByDay = useMemo(() => {
    if (!cells.length) return new Map()
    const list = getUsHolidaysForRange(cells[0].ymd, cells[cells.length - 1].ymd)
    const map = new Map()
    for (const h of list) map.set(h.date, [...(map.get(h.date) || []), h])
    return map
  }, [cells])
  const selectedShifts = byDay.get(selectedDate) || []

  // Navigation is unbounded in both directions, matching the main-app Interviews
  // calendar. The 90-day activity window bounds what DATA exists, never where the
  // user may look: paging to an empty past or future month simply renders an empty
  // grid with the honest "no activity" note. No month change triggers a server
  // request, because all authorized activity for the window arrives in one fetch, so
  // there is no unbounded historical read and no fabricated forward schedule.
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

  // Toolbar matches the main-app Interviews layout: previous and next grouped with
  // Today on the left, the month/year centered, and an empty right side (a Unit
  // Leader adds no events, so nothing lives where staff controls would).
  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start' }}>
        <CanonicalCalendarNav
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onToday={goToday}
          prevAriaLabel="Previous month"
          nextAriaLabel="Next month"
        />
      </div>
      <CanonicalCalendarMonthTitle ariaLive="polite">{monthLabel(cursor.y, cursor.m)}</CanonicalCalendarMonthTitle>
      <div style={{ flex: 1 }} aria-hidden="true" />
    </div>
  )

  return (
    <CanonicalCalendarLayout
      title="Rotation activity"
      titleVisuallyHidden
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
          <div role="grid" aria-label={`Rotation activity for ${monthLabel(cursor.y, cursor.m)}`}>
            <CanonicalWeekdayHeader days={DOW} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {cells.map(({ ymd, inMonth }) => {
                const day = byDay.get(ymd) || []
                const isToday = ymd === today
                const selected = ymd === selectedDate
                const future = ymd > today
                const live = day.some(s => s.state === 'in_progress')
                const dayHolidays = holidaysByDay.get(ymd) || []
                const base = day.length === 0
                  ? `${ymd}, no activity`
                  : `${ymd}, ${day.length} shift${day.length === 1 ? '' : 's'}${live ? ', on shift now' : ''}`
                const label = dayHolidays.length ? `${base}, ${dayHolidays.map(h => h.name).join(', ')}` : base
                if (!inMonth) {
                  return <CanonicalMonthCell key={ymd} isOtherMonth />
                }
                return (
                  <CanonicalMonthCell
                    key={ymd}
                    day={Number(ymd.slice(8, 10))}
                    isToday={isToday}
                    isSelected={selected}
                    isFuture={future}
                    ariaLabel={label}
                    onClick={() => selectDate(ymd, day)}
                  >
                    {dayHolidays.slice(0, 1).map(h => (
                      <CanonicalHolidayChip key={h.name} name={h.name} observed={h.observed} />
                    ))}
                    {day.slice(0, 3).map(shift => (
                      <CanonicalActivityChip
                        key={shift.id}
                        label={initials(shift.student_name)}
                        live={shift.state === 'in_progress'}
                        {...chipExtras(shift)}
                      />
                    ))}
                    {day.length > 3 && <span className="ptl-cal-more">+{day.length - 3}</span>}
                  </CanonicalMonthCell>
                )
              })}
            </div>
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

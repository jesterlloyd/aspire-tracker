// src/components/rotation/RotationActivityCalendar.jsx
//
// ROTATION-ACTIVITY-CALENDAR-1: the staff Rotation > Activity calendar.
//
// THIS IS A RECORD, NOT A SCHEDULE. ASPIRE holds no scheduled-shift data at all: a
// shift row is created when a student checks in, and api/shift-log/submit-past-shift.js
// refuses a future date outright. Every cell here is activity that already happened or
// is happening now. The UI must never imply an upcoming shift is booked.
//
// PROPS ONLY. Fetches nothing, knows no authorization. The caller supplies shifts it
// has already scoped to the cohort (and, when the unit filter is on, to one unit).
//
// DATES ARE STRINGS. shift_date is TEXT in YYYY-MM-DD, stamped in Pacific time at
// check-in. All grouping and comparison is string-based against Pacific "today", via
// the shared helpers in src/lib/rotationCalendarDates.js, so staff in any timezone see
// the same day boundaries the student did. Passing these through new Date() would slide
// a shift into the previous column for anyone east of Pacific.
//
// RELATIONSHIP TO THE UNIT LEADER CALENDAR. Both render the same shift shape through the
// same CanonicalCalendar* primitives that the main-app Interviews calendar uses, so all
// three are one visual system rather than three look-alikes. This is a SEPARATE component
// rather than an import of src/portal/unit/UnitRotationCalendar.jsx for one concrete
// reason: that component's mini grid, day list, legend and overflow marker are styled with
// ptl-* classes defined in src/portal/portal.css, which is not reliably present in the
// staff bundle. Those few pieces are inline-styled here instead. The shared parts, the
// canonical primitives and the date helpers, are genuinely shared, not copied.
//
// WHAT THIS ADDS OVER THE PORTAL'S. A unit filter (staff see a whole cohort, not one
// leader's units) and onSelectShift, so a staff reader can open a logged shift's details
// and review it. A Unit Leader has no review authority, so the portal has no equivalent.

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
} from '../shared/CanonicalCalendarFoundation'
import { pacificToday, monthGrid, monthLabel, groupByDay } from '../../lib/rotationCalendarDates'
// CALENDAR-HOLIDAY-CANON: US federal holidays are pure client-side date math - no fetch,
// no persistence - so computing them here does not violate this component's props-only
// contract. They are context, never records: a holiday chip is not a shift.
import { getUsHolidaysForRange } from '../../lib/usHolidays'
import { firstNameOf } from '../../lib/masthead'
import { ordinalWord } from '../../lib/ordinalWord'

const F = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'
const MUTED = '#6b7280'

// Sunday-first, matching the Interviews calendar week start. The main grid uses the
// three-letter labels; the mini calendar uses the first letter of each.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Chips are limited so a busy cohort day cannot make one row of the grid tall enough
// to push the rest of the month off screen. The remainder is never hidden: it is
// counted in the "+N" marker and listed in full in the selected-day panel.
const MAX_CHIPS_PER_DAY = 3

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

// The month-cell chip names the student by FIRST name (the preferred name when one is
// set), so a reader sees "Victoria with Romelyn" instead of decoding "VM". The feed sends
// student_first_name from the student record; the first token of student_name (already
// preferred-first + last) covers any older payload, and "Student" is the honest fallback.
// Initials survive only as the state marker beside the full name in the day list.
function chipName(shift) {
  return shift.student_first_name || firstNameOf(shift.student_name) || 'Student'
}

// The extra chip content for one shift: "with <preceptor first name>" and the
// chronological ordinal, plus a full accessible label. The preceptor's FIRST name only,
// never a last name; a missing preceptor drops the "with" clause rather than inventing
// one. The ordinal counts that student's logged shifts and is computed by the caller
// from their complete history (src/lib/shiftOrdinals.js), not from what is on screen.
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
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

// ── Mini calendar ────────────────────────────────────────────────────────────
// Inline-styled counterpart of the portal's .ptl-cal-mini-* block. Same markup shape,
// same aria labels, same dot-on-activity behavior.

const miniCellStyle = ({ inMonth, isToday, selected }) => ({
  position: 'relative', appearance: 'none', cursor: 'pointer', fontFamily: F,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  aspectRatio: '1 / 1', padding: 0, borderRadius: 7, fontSize: 11, lineHeight: 1,
  fontWeight: isToday || selected ? 700 : 500,
  color: selected ? '#fff' : inMonth ? '#374151' : '#d1d5db',
  background: selected ? NAVY : isToday ? 'rgba(29,37,103,0.08)' : 'transparent',
  border: isToday && !selected ? `1px solid ${NAVY}` : '1px solid transparent',
})

function MiniCalendar({ cells, byDay, selectedDate, today, onSelectDate }) {
  return (
    <div>
      <div className="canonical-calendar-kicker">Mini Calendar</div>
      <div role="grid" aria-label="Mini rotation activity calendar"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2 }}>
        {DOW.map(day => (
          <div key={day} role="columnheader"
            style={{ fontSize: 9, fontWeight: 700, color: '#d1d5db', textAlign: 'center', paddingBottom: 3, fontFamily: F }}>
            {day[0]}
          </div>
        ))}
        {cells.map(({ ymd, inMonth }) => {
          const day = byDay.get(ymd) || []
          const selected = ymd === selectedDate
          const isToday = ymd === today
          return (
            <button
              key={ymd}
              type="button"
              role="gridcell"
              style={miniCellStyle({ inMonth, isToday, selected })}
              aria-label={`${ymd}${day.length ? `, ${day.length} student activit${day.length === 1 ? 'y' : 'ies'}` : ', no student activity recorded'}`}
              onClick={() => onSelectDate(ymd)}
            >
              <span>{Number(ymd.slice(8, 10))}</span>
              {day.length > 0 && (
                <i aria-hidden="true" style={{
                  position: 'absolute', bottom: 3, width: 3, height: 3, borderRadius: '50%',
                  background: selected ? '#fff' : NAVY,
                }} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Selected-day list ────────────────────────────────────────────────────────
// The complete list for the selected day, including anything the grid's chip cap
// elided. When onSelectShift is supplied each entry is a button into that shift's
// details, which is where a staff reader reviews it.

function SelectedDayActivity({ shifts, onSelectShift }) {
  if (shifts.length === 0) return null
  return (
    <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
      {shifts.map(shift => {
        const live = shift.state === 'in_progress'
        const detail = [
          shift.unit_key || null,
          firstNameOf(shift.preceptor_name) ? `with ${firstNameOf(shift.preceptor_name)}` : null,
          live ? 'On shift now' : 'Completed shift',
          Number.isInteger(shift.ordinal) ? `${ordinalWord(shift.ordinal)} logged shift` : null,
          shift.checked_in_at ? `checked in ${fmtClock(shift.checked_in_at)}` : null,
        ].filter(Boolean).join(' · ')
        const body = (
          <>
            <span aria-hidden="true" style={{
              display: 'inline-block', flexShrink: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.02em',
              padding: '1px 5px', borderRadius: 4, whiteSpace: 'nowrap',
              background: live ? '#dcfce7' : '#e8eaf6', color: live ? '#166534' : NAVY,
              boxShadow: live ? 'inset 0 0 0 1px #86efac' : 'none',
            }}>{initials(shift.student_name)}</span>
            <span style={{ minWidth: 0 }}>
              <b style={{ display: 'block', fontSize: 12.5, color: '#191919', fontWeight: 700 }}>
                {shift.student_name || 'Student'}
              </b>
              <small style={{ display: 'block', fontSize: 11, color: MUTED, marginTop: 1 }}>{detail}</small>
            </span>
          </>
        )
        return (
          <li key={shift.id}>
            {onSelectShift ? (
              <button
                type="button"
                onClick={() => onSelectShift(shift)}
                aria-label={`Open shift details for ${shift.student_name || 'student'}`}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 7, width: '100%', textAlign: 'left',
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: F,
                }}
              >{body}</button>
            ) : (
              <span style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontFamily: F }}>{body}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * @param shifts         [{ id, shift_date, student_name, student_first_name, preceptor_name, unit_key,
 *                          state: 'in_progress'|'completed', ordinal, checked_in_at }]
 * @param onSelectDay    (ymd, dayShifts) when a day WITH activity is chosen in the grid
 * @param onSelectShift  (shift) from the selected-day list; omit to render it read-only
 * @param loading        renders the status line instead of the grid
 * @param toolbarRight   staff controls for the toolbar's right side (the unit filter)
 * @param footNote       overrides the default "record, not a schedule" footer
 */
export default function RotationActivityCalendar({
  shifts = [],
  onSelectDay,
  onSelectShift = null,
  loading = false,
  toolbarRight = null,
  footNote = null,
}) {
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

  // Navigation is unbounded in both directions, matching the Interviews calendar. What
  // data EXISTS bounds the content, never where the reader may look: paging to an empty
  // month renders an empty grid with an honest note. No month change triggers a request,
  // because the cohort's activity arrives in one query.
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
      <MiniCalendar cells={cells} byDay={byDay} selectedDate={selectedDate} today={today} onSelectDate={setSelectedDate} />
      <CanonicalCalendarTodayPanel
        dateLabel={formatLongDate(selectedDate)}
        summary={`${selectedShifts.length} student activit${selectedShifts.length === 1 ? 'y' : 'ies'} recorded`}
        emptyLabel="No student activity recorded for this day."
      >
        {selectedShifts.length > 0 && <SelectedDayActivity shifts={selectedShifts} onSelectShift={onSelectShift} />}
      </CanonicalCalendarTodayPanel>
    </CanonicalCalendarSidebar>
  )

  // Toolbar matches the Interviews layout: prev/next grouped with Today on the left, the
  // month centered, and staff controls on the right where the portal leaves an empty slot.
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
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>{toolbarRight}</div>
    </div>
  )

  return (
    <CanonicalCalendarLayout
      title="Rotation Activity"
      titleVisuallyHidden
      labelledBy="rotation-activity-cal-title"
      sidebar={sidebar}
      toolbar={toolbar}
      footer={(
        <p style={{ marginTop: 8, fontSize: 11.5, color: MUTED, fontFamily: F }}>
          {footNote || 'This shows shifts students have actually logged. ASPIRE does not hold a forward schedule, so upcoming shifts do not appear here.'}
        </p>
      )}
    >
      {loading ? (
        <p role="status" style={{ color: MUTED, fontSize: 12.5, fontFamily: F }}>Loading rotation activity</p>
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
                // The holiday is announced too: a screen reader user gets the same context
                // the amber chip gives a sighted one.
                const label = dayHolidays.length ? `${base}, ${dayHolidays.map(h => h.name).join(', ')}` : base
                if (!inMonth) return <CanonicalMonthCell key={ymd} isOtherMonth />
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
                    {day.slice(0, MAX_CHIPS_PER_DAY).map(shift => (
                      <CanonicalActivityChip
                        key={shift.id}
                        label={chipName(shift)}
                        live={shift.state === 'in_progress'}
                        {...chipExtras(shift)}
                      />
                    ))}
                    {day.length > MAX_CHIPS_PER_DAY && (
                      <span style={{ fontSize: 9.5, color: '#9ca3af', fontFamily: F }}>
                        +{day.length - MAX_CHIPS_PER_DAY}
                      </span>
                    )}
                  </CanonicalMonthCell>
                )
              })}
            </div>
          </div>

          {!monthHasActivity && (
            <p style={{ marginTop: 10, fontSize: 12, color: MUTED, fontFamily: F }}>
              No rotation activity recorded in {monthLabel(cursor.y, cursor.m)}.
            </p>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: MUTED, alignItems: 'center', fontFamily: F }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <CanonicalActivityChip label="Student" /> Completed shift
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <CanonicalActivityChip label="Student" live /> On shift now
            </span>
          </div>
        </>
      )}
    </CanonicalCalendarLayout>
  )
}

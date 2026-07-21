// src/portal/unit/UnitRotationCalendar.jsx
//
// UL-PHASE1: the Rotation Activity Calendar.
//
// THIS IS A RECORD, NOT A SCHEDULE. ASPIRE has no scheduled-shift data: a shift row is
// created when a student checks in, and a future shift_date is rejected outright by the
// submit endpoint. So every mark here is something that already happened or is happening
// right now. The UI says "Rotation activity", never "Schedule", future days are visibly
// inert, and the footer states the limitation rather than leaving a Unit Leader to infer
// that an empty Friday means nobody is coming.
//
// PROPS ONLY. This component fetches nothing and knows no authorization. Shifts arrive
// already scoped and already field-filtered by api/portal/unit-shift-activity.js. That is
// deliberate: the staff Interviews calendar is unusable here precisely because it queries
// is_staff()-gated tables itself, so a Unit Leader would render an empty grid rather than
// a refusal. Keeping this presentational means it cannot repeat that mistake.
//
// DATES ARE STRINGS. shift_date is TEXT in YYYY-MM-DD, written in Pacific time at
// check-in. All comparison and grouping here is string-based against a Pacific "today",
// so a Unit Leader in any timezone sees the same day boundaries the student did. Never
// pass these through new Date() for comparison.

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { pacificToday, monthGrid, monthLabel, groupByDay } from './rotationCalendarDates'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Initials for a compact day chip. */
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export default function UnitRotationCalendar({ shifts = [], windowStart, onSelectDay, loading = false }) {
  const today = pacificToday()
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))

  const byDay = useMemo(() => groupByDay(shifts), [shifts])

  const cells = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor])

  // Navigation is bounded by the same window the server enforces, so the arrows cannot
  // walk a Unit Leader into a month the endpoint would refuse.
  const monthStart = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-01`
  const canGoBack = !windowStart || monthStart > windowStart
  const canGoForward = monthStart < today.slice(0, 8) + '01'

  const step = (delta) => {
    const d = new Date(Date.UTC(cursor.y, cursor.m + delta, 1))
    setCursor({ y: d.getUTCFullYear(), m: d.getUTCMonth() })
  }

  const monthHasActivity = cells.some(c => c.inMonth && byDay.has(c.ymd))

  return (
    <section className="ptl-card" aria-labelledby="ul-cal-title">
      <div className="ptl-cal-head">
        <h3 id="ul-cal-title" className="ptl-card-title" style={{ margin: 0 }}>Rotation activity</h3>
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
        </div>
      </div>

      {loading ? (
        <p className="ptl-muted" role="status">Loading rotation activity</p>
      ) : (
        <>
          <div className="ptl-cal-grid" role="grid" aria-label={`Rotation activity for ${monthLabel(cursor.y, cursor.m)}`}>
            {DOW.map(d => (
              <div key={d} className="ptl-cal-dow" role="columnheader">{d}</div>
            ))}
            {cells.map(({ ymd, inMonth }) => {
              const day = byDay.get(ymd) || []
              const isToday = ymd === today
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
                    future ? 'ptl-cal-future' : '',
                    day.length > 0 ? 'ptl-cal-has' : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={label}
                  disabled={day.length === 0}
                  onClick={() => day.length > 0 && onSelectDay?.(ymd, day)}
                >
                  <span className="ptl-cal-num">{Number(ymd.slice(8, 10))}</span>
                  {day.slice(0, 3).map(s => (
                    <span
                      key={s.id}
                      className={`ptl-cal-chip${s.state === 'in_progress' ? ' ptl-cal-chip-live' : ''}`}
                    >
                      {initials(s.student_name)}
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
          {/* Stating the limitation is the honest thing to do: without it, an empty
              upcoming week reads as "nobody is scheduled" rather than "we do not know". */}
          <p className="ptl-muted" style={{ marginTop: 8, fontSize: 11.5 }}>
            This shows shifts your students have actually logged, over the last 90 days.
            ASPIRE does not hold a forward schedule, so upcoming shifts do not appear here.
          </p>
        </>
      )}
    </section>
  )
}

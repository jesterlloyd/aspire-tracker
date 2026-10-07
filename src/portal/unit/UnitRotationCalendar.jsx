// src/portal/unit/UnitRotationCalendar.jsx
//
// The Unit Leader's one calendar, on At a Glance.
//
// ONE-CALENDAR-1 (Owner, 2026-10-06: one calendar per portal). `mode` is the host's choice (At a
// Glance's Internship | Residency picker, ONE-CALENDAR-2). Internship is the rotation activity it always showed: the shifts
// the unit's students logged, over the last 90 days. Residency is the unit's residency
// interviews: the times the unit opened, the applicants Talent Acquisition booked into them, and
// blocked times, with Open Times, Block, Reopen and Remove in the day panel. The Interviews tab
// keeps the tiles, the results and the rubric, and no calendar of its own.
//
// THE INTERNSHIP VIEW IS A RECORD, NOT A SCHEDULE. ASPIRE has no scheduled-shift data: a shift
// row is created when a student checks in, and a future shift_date is rejected by the submit
// endpoint. The UI says "Rotation Activity", never "Schedule". The Residency view is a schedule.
//
// PROPS ONLY. This component fetches nothing and knows no authorization. Shifts arrive already
// scoped and field-filtered by api/portal/unit-shift-activity.js; interview times by
// api/portal/unit-interviews.js, and the writes the host hands in are that endpoint's.
//
// DATES ARE STRINGS. shift_date is TEXT in YYYY-MM-DD, written in Pacific time at check-in;
// an interview time is a timestamp placed on its Pacific date. All grouping is string-based
// against Pacific "today", so a Unit Leader in any timezone sees the same day boundaries.
//
// VISUAL PARITY. The toolbar, weekday header, month grid and Week view are the shared
// CanonicalCalendar* primitives the main-app calendars use, so this calendar and those are one
// visual system. What differs is only the content inside a cell.

import { useEffect, useMemo, useState } from 'react'
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
import CanonicalWeekView from '../../components/shared/CanonicalWeekView'
import SegmentedPicker from '../../components/shared/SegmentedPicker'
import { confirmDialog } from '../../components/shared/confirmDialog'
import {
  OpenTimesModal, OpenTimesButton, DayAction, InterviewSlotRow, RemoveTimesAction, InterviewDayChips, InterviewLegend,
} from '../../components/ngrp/InterviewTimesControls'
import { pacificToday, monthGrid, monthLabel, groupByDay } from '../../lib/rotationCalendarDates'
import { weekStartOf, weekTitle, addDaysYmd, pacificParts, hhmmOf, minutesOf } from '../../lib/calendarWeek'
import { dayOf, slotWeekItem, longDate as longDateOf, cycleDateItems, KEY_DATE_COLOR } from '../../lib/ngrp/interviewScheduleModel'
import { eventOnDate, eventColor, eventTypeLabel, formatEventWhen } from '../../lib/aspireEvents'
// CALENDAR-HOLIDAY-CANON: pure client-side date math, no fetch and no persistence, so the
// props-only contract above still holds. Context, never a record.
import { getUsHolidaysForRange } from '../../lib/usHolidays'
import { firstNameOf } from '../../lib/greeting'
import { ordinalWord } from '../../lib/ordinalWord'

// Sunday-first, matching the main-app Interviews calendar week start. The main grid
// uses the three-letter labels; the mini calendar uses the first letter of each.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHIFT_COLORS = { done: '#1d2567', live: '#166534' }

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

function UnitMiniCalendar({ cells, byDay, selectedDate, today, onSelectDate, noun, residency }) {
  return (
    <div>
      <div className="canonical-calendar-kicker">Mini Calendar</div>
      <div className="ptl-cal-mini-grid" role="grid" aria-label={residency ? 'Mini interview calendar' : 'Mini rotation activity calendar'}>
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
              aria-label={`${ymd}${day.length ? `, ${day.length} ${noun}${day.length === 1 ? '' : 's'}` : `, no ${noun}s`}`}
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

/**
 * `interviews` is the Interviews endpoint's overview ({ slots, blocks, cycles, rankedFirst,
 * rubricsProvisioned, preview, loading }) or null before it loads. `interviewActions` is
 * { open(form), remove(block), toggle(slot) }, each resolving { ok, ... }, or null when the
 * viewer may not write (an Owner/Admin preview).
 */
/**
 * `events` are the ASPIRE events delivered to unit leaders for the visible range (the host fetches
 * them; `onRangeChange(from, to)` tells it the range), drawn in the Residency view beside the
 * cohort's key dates (`interviews.cycles`).
 */
export default function UnitRotationCalendar({ shifts = [], onSelectDay, loading = false, interviews = null, interviewActions = null, mode = 'internship', events = [], onRangeChange = null }) {
  const today = pacificToday()
  const [view, setView] = useState('month')
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))
  const [selectedDate, setSelectedDate] = useState(today)
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today))
  const [opening, setOpening] = useState(false)
  const [notice, setNotice] = useState(null)
  const residency = mode === 'residency'

  const byDay = useMemo(() => groupByDay(shifts), [shifts])
  const slots = useMemo(() => interviews?.slots || [], [interviews])
  const blocks = useMemo(() => interviews?.blocks || [], [interviews])
  const slotsByDay = useMemo(() => {
    const map = new Map()
    for (const s of slots) { const d = dayOf(s.slot_at); map.set(d, [...(map.get(d) || []), s]) }
    return map
  }, [slots])
  const cells = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor])
  const range = view === 'week' ? [weekStart, addDaysYmd(weekStart, 6)] : [cells[0].ymd, cells[cells.length - 1].ymd]
  const holidaysByDay = useMemo(() => {
    const list = getUsHolidaysForRange(range[0], range[1])
    const map = new Map()
    for (const h of list) map.set(h.date, [...(map.get(h.date) || [])], h)
    for (const h of list) map.set(h.date, [...(map.get(h.date) || []), h])
    return map
  }, [range[0], range[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  // ONE-CALENDAR-3: the cohort's key dates and the unit leader's ASPIRE events, by day.
  const keyDates = useMemo(() => cycleDateItems(interviews?.cycles || []), [interviews])
  const keyDatesOn = ymd => keyDates.filter(k => k.date === ymd)
  const eventsOn = ymd => (events || []).filter(ev => eventOnDate(ev, ymd))
  const residencyByDay = useMemo(() => {
    const map = new Map()
    const add = (d, x) => map.set(d, [...(map.get(d) || []), x])
    for (const [d, list] of slotsByDay) for (const x of list) add(d, x)
    for (const k of keyDates) add(k.date, k)
    for (const ev of events || []) { const d = String(ev.start_at || '').slice(0, 10); if (d) add(d, ev) }
    return map
  }, [slotsByDay, keyDates, events])
  useEffect(() => { onRangeChange?.(range[0], range[1]) }, [range[0], range[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  const selectedShifts = byDay.get(selectedDate) || []
  const selectedSlots = slotsByDay.get(selectedDate) || []
  const selectedBlocks = blocks.filter(b => b.block_date === selectedDate)
  const units = useMemo(() => [...new Set((interviews?.rankedFirst || []).map(r => r.unit))], [interviews])
  const canOpen = Boolean(interviewActions) && interviews?.rubricsProvisioned !== false && (interviews?.cycles || []).length > 0

  // Navigation is unbounded in both directions, matching the main-app Interviews
  // calendar. The 90-day activity window bounds what DATA exists, never where the
  // user may look: paging to an empty past or future month simply renders an empty
  // grid with the honest "no activity" note. No month change triggers a server
  // request, because all authorized activity for the window arrives in one fetch, so
  // there is no unbounded historical read and no fabricated forward schedule.
  const monthHasActivity = cells.some(c => c.inMonth && (residency ? residencyByDay.has(c.ymd) : byDay.has(c.ymd)))

  const step = (delta) => {
    if (view === 'week') {
      const next = addDaysYmd(weekStart, 7 * delta)
      setWeekStart(next)
      setCursor({ y: Number(next.slice(0, 4)), m: Number(next.slice(5, 7)) - 1 })
      return
    }
    const d = new Date(Date.UTC(cursor.y, cursor.m + delta, 1))
    setCursor({ y: d.getUTCFullYear(), m: d.getUTCMonth() })
  }
  const goTo = (ymd) => {
    setSelectedDate(ymd)
    setWeekStart(weekStartOf(ymd))
    setCursor({ y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)) - 1 })
  }
  const goToday = () => {
    setSelectedDate(today)
    setWeekStart(weekStartOf(today))
    setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })
  }
  const selectDate = (ymd, day = byDay.get(ymd) || []) => {
    setSelectedDate(ymd)
    if (!residency && day.length > 0) onSelectDay?.(ymd, day)
  }

  // The day panel's interview actions: what this viewer may do to a time.
  const act = async (label, fn) => {
    setNotice(null)
    const r = await fn()
    if (!r?.ok) setNotice(r?.error === 'has_bookings' ? 'Someone is booked into these times. Ask Talent Acquisition to move the booking first.' : r?.error === 'booked' ? 'That time is booked.' : `${label} did not go through. Try again in a moment.`)
    return r
  }
  const slotActions = !interviewActions ? null : s => (s.booked ? null : (
    <DayAction onClick={() => act('The change', () => interviewActions.toggle(s))}>{s.status === 'blocked' ? 'Reopen' : 'Block'}</DayAction>
  ))
  const removeBlock = async (b) => {
    if (!(await confirmDialog(`Remove the open times on ${longDateOf(b.block_date)}?`, { confirmLabel: 'Remove Times', danger: true }))) return
    act('The removal', () => interviewActions.remove(b))
  }

  // The Week view's rows. Internship: a shift from its check-in clock to its check-out (or
  // its hours), and in the all-day row when it has no clock. Residency: the interview times.
  const holidayItems = ymd => (holidaysByDay.get(ymd) || []).map(h => ({ id: `h-${h.name}`, label: h.name, color: '#D97706', title: `${h.name} · US Holiday` }))
  const allDayOn = ymd => [
    ...holidayItems(ymd),
    ...(residency ? [
      ...keyDatesOn(ymd).map(k => ({ id: k.id, label: k.label, color: k.color, title: `${k.label} · ${k.cycle}` })),
      ...eventsOn(ymd).map(ev => ({ id: `e-${ev.id}`, label: ev.title, color: eventColor(ev), title: `${eventTypeLabel(ev.event_type)} · ${formatEventWhen(ev)}` })),
    ] : (byDay.get(ymd) || []).filter(s => !pacificParts(s.checked_in_at)).map(s => ({ id: s.id, label: chipName(s), color: s.state === 'in_progress' ? SHIFT_COLORS.live : SHIFT_COLORS.done, title: chipExtras(s).ariaLabel }))),
  ]
  const timedOn = ymd => (residency
    ? (slotsByDay.get(ymd) || []).map(s => slotWeekItem(s, { onClick: () => goTo(ymd) })).filter(Boolean)
    : (byDay.get(ymd) || []).map(s => {
      const start = pacificParts(s.checked_in_at)
      if (!start) return null
      const out = pacificParts(s.checked_out_at)
      const end = out && out.date === start.date ? out.time : hhmmOf(minutesOf(start.time) + Math.round((Number(s.total_hours) || Number(s.expected_hours) || 8) * 60))
      const live = s.state === 'in_progress'
      return { id: s.id, start: start.time, end, label: chipName(s), sublabel: chipExtras(s).secondary || (live ? 'On shift now' : 'Completed shift'), color: live ? SHIFT_COLORS.live : SHIFT_COLORS.done, title: chipExtras(s).ariaLabel, onClick: () => goTo(ymd) }
    }).filter(Boolean))

  const sidebar = (
    <CanonicalCalendarSidebar>
      <UnitMiniCalendar cells={cells} byDay={residency ? residencyByDay : byDay} selectedDate={selectedDate} today={today} onSelectDate={goTo} noun={residency ? 'interview time' : 'student activity'} residency={residency} />
      <CanonicalCalendarTodayPanel
        kicker={selectedDate === today ? 'Today' : 'Selected day'}
        dateLabel={formatLongDate(selectedDate)}
        summary={residency
          ? (selectedSlots.length ? `${selectedSlots.filter(x => x.booked).length} scheduled · ${selectedSlots.filter(x => x.status === 'available').length} open` : null)
          : `${selectedShifts.length} student activit${selectedShifts.length === 1 ? 'y' : 'ies'} recorded`}
        emptyLabel={residency ? 'Nothing on this day.' : 'No student activity recorded for this day.'}
      >
        {!residency && selectedShifts.length > 0 && <SelectedDayActivity shifts={selectedShifts} />}
        {residency && keyDatesOn(selectedDate).map(k => (
          <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0', fontSize: 13 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: k.color }} aria-hidden="true" />
            <span style={{ fontWeight: 600, color: 'var(--paper-ink)' }}>{k.label}</span>
            <span style={{ color: 'var(--paper-muted)' }}>{k.cycle}</span>
          </div>
        ))}
        {residency && eventsOn(selectedDate).map(ev => (
          <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0', fontSize: 13 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: eventColor(ev) }} aria-hidden="true" />
            <span style={{ fontWeight: 600, color: 'var(--paper-ink)' }}>{ev.title}</span>
            <span style={{ color: 'var(--paper-muted)' }}>{eventTypeLabel(ev.event_type)} · {formatEventWhen(ev)}</span>
          </div>
        ))}
        {residency && selectedSlots.map(s => <InterviewSlotRow key={s.id} slot={s} actions={slotActions ? slotActions(s) : null} />)}
        {residency && interviewActions && selectedBlocks.map(b => <RemoveTimesAction key={b.id} block={b} onClick={() => removeBlock(b)} />)}
        {residency && notice && <p role="alert" className="ptl-muted" style={{ margin: '8px 0 0', fontSize: 12 }}>{notice}</p>}
      </CanonicalCalendarTodayPanel>
      {/* The notepad closes with this surface's kinds, as the staff Rotation Activity
          planner does, and in the same words: the two calendars read the same records. */}
      <div className="pl-legend">
        {residency ? (
          <>
            <InterviewLegend />
            <span><i aria-hidden="true" style={{ background: 'rgba(71,85,105,0.14)', borderLeft: `3px solid ${KEY_DATE_COLOR}` }} />Key date or event</span>
          </>
        ) : (
          <>
            <span><i aria-hidden="true" style={{ background: '#e8eaf6', borderLeft: '3px solid #1d2567' }} />Completed shift</span>
            <span><i aria-hidden="true" style={{ background: '#dcfce7', borderLeft: '3px solid #166534' }} />On shift now</span>
          </>
        )}
        <span><i aria-hidden="true" style={{ background: '#FEF3C7', borderLeft: '3px solid #D97706' }} />US holiday</span>
      </div>
    </CanonicalCalendarSidebar>
  )

  // Toolbar matches the main-app Interviews layout: previous and next grouped with Today on
  // the left, the month or week centered, and the switches on the right.
  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start' }}>
        <CanonicalCalendarNav
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onToday={goToday}
          prevAriaLabel={view === 'week' ? 'Previous week' : 'Previous month'}
          nextAriaLabel={view === 'week' ? 'Next week' : 'Next month'}
        />
      </div>
      <CanonicalCalendarMonthTitle ariaLive="polite">{view === 'week' ? weekTitle(weekStart) : monthLabel(cursor.y, cursor.m)}</CanonicalCalendarMonthTitle>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {residency && canOpen && <OpenTimesButton onClick={() => setOpening(true)} />}
        <SegmentedPicker paper ariaLabel="Calendar view" value={view} onChange={v => { if (v === 'week') setWeekStart(weekStartOf(selectedDate)); setView(v) }}
          options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]} />
      </div>
    </div>
  )

  const busy = residency ? Boolean(interviews?.loading) && !interviews?.slots : loading
  const gridLabel = `${residency ? 'Residency interviews' : 'Rotation Activity'} for ${view === 'week' ? weekTitle(weekStart) : monthLabel(cursor.y, cursor.m)}`

  return (
    <>
    <CanonicalCalendarLayout
      // PLANNER-CALENDAR-1: paper follows the subject. Tan is the shift paper, the same the
      // staff Rotation > Shift Log calendar wears; slate is the interview paper.
      paper={residency ? 'slate' : 'tan'}
      appearance="modern"
      title={residency ? 'Residency Interviews' : 'Rotation Activity'}
      titleVisuallyHidden
      labelledBy="ul-cal-title"
      sidebar={sidebar}
      toolbar={toolbar}
      footer={(
        <p className="ptl-muted" style={{ marginTop: 8, fontSize: 11.5 }}>
          {residency
            ? "The residency cohort's key dates and events, the interview times your unit opened, and the applicants Talent Acquisition booked into them. Score each interview on the Interviews tab."
            : 'This shows shifts your students have actually logged, over the last 90 days. ASPIRE does not hold a forward schedule, so upcoming shifts do not appear here.'}
        </p>
      )}
    >
      {busy ? (
        <p className="ptl-muted" role="status">{residency ? 'Loading interview times' : 'Loading rotation activity'}</p>
      ) : view === 'week' ? (
        // Shifts run 7 to 7, days and nights, so the Internship week shows 6 AM to midnight; the
        // Residency week keeps the interview day.
        <CanonicalWeekView weekStart={weekStart} today={today} selectedDate={selectedDate} allDayOn={allDayOn} timedOn={timedOn} onDayClick={goTo} ariaLabel={gridLabel}
          startHour={residency ? 7 : 6} endHour={residency ? 20 : 24} />
      ) : (
        <>
          <div className="pl-calbox" role="grid" aria-label={gridLabel}>
            <CanonicalWeekdayHeader days={DOW} />
            <div className="pl-monthgrid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', '--weeks': Math.ceil(cells.length / 7) }}>
              {cells.map(({ ymd, inMonth }) => {
                const day = byDay.get(ymd) || []
                const daySlots = slotsByDay.get(ymd) || []
                const isToday = ymd === today
                const selected = ymd === selectedDate
                const future = ymd > today
                const live = day.some(s => s.state === 'in_progress')
                const dayHolidays = holidaysByDay.get(ymd) || []
                const base = residency
                  ? `${ymd}, ${daySlots.filter(s => s.booked).length} interviews, ${daySlots.filter(s => s.status === 'available').length} open${[...keyDatesOn(ymd).map(k => k.label), ...eventsOn(ymd).map(ev => ev.title)].map(x => `, ${x}`).join('')}`
                  : day.length === 0 ? `${ymd}, no activity` : `${ymd}, ${day.length} shift${day.length === 1 ? '' : 's'}${live ? ', on shift now' : ''}`
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
                    isFuture={!residency && future}
                    ariaLabel={label}
                    onClick={() => selectDate(ymd, day)}
                  >
                    {dayHolidays.slice(0, 1).map(h => (
                      <CanonicalHolidayChip key={h.name} name={h.name} observed={h.observed} />
                    ))}
                    {residency ? (
                      <>
                        {keyDatesOn(ymd).map(k => <CanonicalActivityChip key={k.id} label={k.label} color={k.color} ink="var(--paper-ink)" />)}
                        {eventsOn(ymd).slice(0, 2).map(ev => <CanonicalActivityChip key={ev.id} label={ev.title} color={eventColor(ev)} ink="var(--paper-ink)" />)}
                        <InterviewDayChips slots={daySlots} />
                      </>
                    ) : (
                      <>
                        {day.slice(0, 3).map(shift => (
                          <CanonicalActivityChip
                            key={shift.id}
                            label={chipName(shift)}
                            live={shift.state === 'in_progress'}
                            {...chipExtras(shift)}
                          />
                        ))}
                        {day.length > 3 && <span className="ptl-cal-more">+{day.length - 3}</span>}
                      </>
                    )}
                  </CanonicalMonthCell>
                )
              })}
            </div>
          </div>

          {!monthHasActivity && (
            <p className="ptl-muted" style={{ marginTop: 10 }}>
              {residency ? `Nothing in ${monthLabel(cursor.y, cursor.m)}.` : `No rotation activity recorded in ${monthLabel(cursor.y, cursor.m)}.`}
            </p>
          )}
        </>
      )}
    </CanonicalCalendarLayout>

    {opening && interviewActions && (
      <OpenTimesModal cycles={interviews?.cycles || []} units={units} defaultDate={selectedDate}
        note="The span is cut into interview times. Talent Acquisition books the applicants into them."
        save={interviewActions.open}
        onClose={() => setOpening(false)}
        onSaved={() => { setOpening(false) }} />
    )}
    </>
  )
}

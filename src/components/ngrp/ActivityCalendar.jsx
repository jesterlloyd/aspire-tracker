// NGRP-WORKSPACE-2 / NGRP-ACTIVITY-PARITY-1: Residency > Calendar.
//
// The cohort's calendar of workshops, town halls and bootcamps, built to MATCH
// the Interviews calendar rather than to resemble it (Owner): the same mini
// calendar in the sidebar, the same hover-to-add affordance on a day, the same
// paper event action, US holidays alongside, and a day modal on click.
//
// ONE-CALENDAR-1 (Owner, 2026-10-06: "why did you not use the Calendar in Calendar tab as the
// calendar for Interview scheduling... one calendar"). This is ALSO the interview schedule: every
// unit's open times, bookings and blocked times sit on it beside the events, holidays and
// residents' working days. The day panel is where HR opens times, books a paired applicant,
// blocks a time or cancels; a unit filter and the Paired Applicants table sit under the
// calendar. Month | Week is the planner's shared Week view (CanonicalWeekView).
//
// SHARED, NOT COPIED. The month grid, weekday header, nav and day panel are the
// canonical calendar foundation that Rotation Activity and the interview
// calendar already use. MiniCalendar is imported from CalendarSidebar (it grew
// an export for this, and its interview inputs default to empty). The event
// controls use the same shared paper classes as Interviews. Events come through
// the SAME gated /api/aspire-events list and are
// written through the SAME AspireEventModal, so an NGRP workshop added here is
// an ASPIRE event like any other.
//
// SCOPED BY DISPLAY, NOT BY FETCH. There is no cycle_id on an event, and
// inventing one would fork the events model for this tab alone.
import Tooltip from '../ui/Tooltip'
import { useState, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { useNgrpSurface } from '../../lib/ngrp/ngrpSurface'
import { supabase } from '../../lib/supabase'
import { toLocalDateStr } from '../../lib/designTokens'
import { eventOnDate, eventColor, eventTypeLabel, formatEventWhen, portalCanSeeEvent, localDateStr } from '../../lib/aspireEvents'
import { getUsHolidaysForRange } from '../../lib/usHolidays'
import AspireEventModal from '../AspireEventModal'
import EmptyState from '../EmptyState'
import { MiniCalendar } from '../CalendarSidebar'
import {
  CanonicalCalendarLayout, CanonicalCalendarSidebar, CanonicalCalendarTodayPanel,
  CanonicalCalendarNav, CanonicalCalendarMonthTitle, CanonicalWeekdayHeader,
  CanonicalMonthCell, CanonicalActivityChip, CanonicalHolidayChip,
} from '../shared/CanonicalCalendarFoundation'
import CanonicalWeekView from '../shared/CanonicalWeekView'
import SegmentedPicker from '../shared/SegmentedPicker'
import StudentAvatar from '../StudentAvatar'
import { FilterKPICard } from '../KPIBand'
import { confirmDialog } from '../shared/confirmDialog'
import { F, inputStyle } from '../../lib/ngrp/ngrpCohortForm'
import {
  initialActivityMonth, monthRange, HOLIDAY_COLOR, shiftColor,
} from '../../lib/ngrp/ngrpActivity'
import { ModalShell } from './NgrpFormUi'
// RESIDENCY-REFLECTION-2: residents' marked working days, from their own
// reflection calendars, shown here for the team.
import { useNgrpApplicants, postNgrpSupport, useInterviewSchedule, postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { deriveApplicantRows, INTERVIEW_MODE_LABELS } from '../../lib/ngrp/ngrpStates'
import { recommendationLabel } from '../../lib/ngrp/ngrpRubric'
import { shiftBadge } from '../../lib/shiftStatus'
import { displayName } from '../../lib/utils'
import { firstNameOf } from '../../lib/greeting'
import { weekStartOf, weekTitle, addDaysYmd, hhmmOf, minutesOf } from '../../lib/calendarWeek'
import {
  bookingChoices, scheduleCounts, noticeSummary, nameOf, slotWhen, longDate as longDateOf, dayOf,
  slotWeekItem,
} from '../../lib/ngrp/interviewScheduleModel'
import {
  OpenTimesModal, OpenTimesButton, DayAction, InterviewSlotRow, RemoveTimesAction, InterviewDayChips, InterviewLegend, BookDialog,
} from './InterviewTimesControls'

const MONTH_FMT = { month: 'long', year: 'numeric' }
const longDate = d => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const pad = n => String(n).padStart(2, '0')
const localHHMM = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const ALL = ''
// The internship card's pill pairs (fixed ink on a fixed ground, both themes).
const REC_PILL = { recommend: ['#dcfce7', '#166534'], recommend_with_reservations: ['#fef3c7', '#92400e'], do_not_recommend: ['#fee2e2', '#991b1b'] }
// An interview that happened, by the binder's own vocabulary.
const HELD = new Set(['completed', 'decision_recorded'])
const ERRORS = {
  slot_taken: 'Someone else just took that time. Choose another.',
  slot_blocked: 'That time is blocked. Reopen it first.',
  has_bookings: 'Someone is booked into these times. Cancel or move the booking first.',
  not_enabled: 'Interview scheduling is not switched on yet.',
}

function AddEventButton({ onClick, style }) {
  return (
    <Tooltip label="Add a custom ASPIRE event" applyAriaLabel={false}>
    <button
      type="button"
      onClick={onClick}
      className="pl-ghost pl-ghost-event"
      style={{
        height: 32, padding: '0 14px', borderRadius: 9,
        cursor: 'pointer', fontFamily: 'Plus Jakarta Sans', fontWeight: 600, fontSize: 12,
        display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease', ...style,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      Add Event
    </button>
    </Tooltip>
  )
}

// One day's events and holidays, opened by clicking a date. The interview
// calendar opens its Day Manager the same way; this is the events-only version.
// One resident's marked day, as a chip: first name and the shift glyph, in the
// shift's colour. The full name and shift on hover.
function ShiftMark({ mark }) {
  const color = shiftColor(mark.shift)
  const badge = shiftBadge(mark.shift)
  return (
    <Tooltip label={`${mark.name} · ${mark.shift ? badge.label : 'shift not recorded'}`} applyAriaLabel={false}>
    <span
      className="ngrp-shift-mark"
      // The shift's colour is the EDGE, and the words are the paper's ink. Colouring the
      // text the same hue as its own 10% tint can only ever be low contrast: measured
      // 3.73:1 on forest paper. The event chips beside it already work this way.
      style={{ background: `${color}1a`, color: 'var(--paper-ink, #374151)', borderLeft: `3px solid ${color}` }}
    >
      {firstNameOf(mark.name) || mark.name} {mark.shift ? badge.label.split(' ')[0] : ''}
    </span>
    </Tooltip>
  )
}

function DayModal({ date, events, holidays, marks = [], slotRows = null, canManage, onAdd, onEdit, onClose }) {
  return (
    <ModalShell label={`Calendar for ${longDate(date)}`} onClose={onClose} width={560}>
      <div style={{ flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--paper-muted, #8B8F99)' }}>Calendar</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1D2567', marginTop: 2 }}>{longDate(date)}</div>
        </div>
        {canManage && <AddEventButton onClick={onAdd} style={{ marginLeft: 'auto' }} />}
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '14px 20px 20px', overflowY: 'auto', fontFamily: F }}>
        {holidays.map(h => (
          <div key={h.name} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 0', borderBottom: '1px solid #F3F4F6' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: HOLIDAY_COLOR, flexShrink: 0 }} aria-hidden="true" />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--paper-ink, #374151)' }}>{h.name}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--paper-muted, #8B8F99)' }}>US Holiday</span>
          </div>
        ))}
        {events.map(ev => (
          <button
            key={ev.id}
            type="button"
            onClick={() => canManage && onEdit(ev)}
            style={{
              display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
              border: 'none', borderBottom: '1px solid #F3F4F6', background: 'none',
              padding: '9px 0', cursor: canManage ? 'pointer' : 'default', fontFamily: F,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: eventColor(ev), flexShrink: 0 }} aria-hidden="true" />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--paper-ink, #374151)' }}>{ev.title}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--paper-muted, #6B7785)' }}>{eventTypeLabel(ev.event_type)} · {formatEventWhen(ev)}</span>
            </span>
          </button>
        ))}
        {marks.map(m => (
          <div key={m.candidate_id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 0', borderBottom: '1px solid #F3F4F6' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: shiftColor(m.shift), flexShrink: 0 }} aria-hidden="true" />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--paper-ink, #374151)' }}>{m.name}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--paper-muted, #8B8F99)' }}>{m.shift ? `${shiftBadge(m.shift).label} shift` : 'Working, shift not recorded'}</span>
          </div>
        ))}
        {slotRows}
        {!events.length && !holidays.length && !marks.length && !slotRows && (
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--paper-muted, #9CA3AF)' }}>Nothing scheduled.</p>
        )}
      </div>
    </ModalShell>
  )
}

export default function ActivityCalendar({ cycle, canManage: canManageCohort, toast = null }) {
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const { base, canEditEvents, eventAudience } = useNgrpSurface()
  // Managing the cohort is not authoring ASPIRE events: the surface decides the latter, so
  // Talent Acquisition sees no Add Event and cannot open an event for editing. Interview
  // times are the cohort's: Talent Acquisition opens, books and cancels them (Owner).
  const canManage = canManageCohort && canEditEvents
  const canSchedule = Boolean(canManageCohort)
  const today = toLocalDateStr()
  const [cursor, setCursor] = useState(() => initialActivityMonth(cycle, today))
  const [selected, setSelected] = useState(today)
  const [view, setView] = useState('month')
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today))
  const [dayOpen, setDayOpen] = useState(null)
  const [editing, setEditing] = useState(null)
  const [unit, setUnit] = useState(ALL)
  const [opening, setOpening] = useState(false)
  const [bookSlot, setBookSlot] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [listFilter, setListFilter] = useState(null)

  const onThisTab = location.pathname.startsWith(`${base}/residency/activity`)
  const { from, to } = view === 'week' ? { from: weekStart, to: addDaysYmd(weekStart, 6) } : monthRange(cursor)

  const { data: fetchedEvents } = useQuery({
    queryKey: ['ngrp_activity_events', from, to],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/aspire-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'list', from, to }),
      })
      if (!res.ok) return []
      const json = await res.json().catch(() => ({}))
      return json.events || []
    },
    // Only the visible Calendar sub-tab fetches; the workspace keeps tabs mounted.
    enabled: onThisTab,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  // A portal surface shows only the events its audience may see. The server already narrows
  // a portal user's list; this also makes a staff preview show exactly what they would see.
  const events = useMemo(() => {
    const all = fetchedEvents || []
    return eventAudience ? all.filter(ev => portalCanSeeEvent(ev, eventAudience)) : all
  }, [fetchedEvents, eventAudience])

  // US holidays are client-computed, read-only, and never persisted - the same
  // contract the masthead and the interview calendar use.
  const holidays = useMemo(() => getUsHolidaysForRange(from, to), [from, to])

  // RESIDENCY-REFLECTION-2: residents' marked working days for the visible
  // range. Names come from the roster rows this workspace already holds; the
  // schedule endpoint returns ids and dates only.
  const applicants = useNgrpApplicants(cycle?.id)
  const rowByCandidate = useMemo(() => {
    const rows = deriveApplicantRows(applicants.payload?.students, applicants.payload?.candidates)
    return new Map(rows.filter(r => r.candidate_id).map(r => [r.candidate_id, r]))
  }, [applicants.payload])
  const nameByCandidate = useMemo(() => new Map([...rowByCandidate].map(([id, r]) => [id, displayName(r.student)])), [rowByCandidate])
  const { data: schedule } = useQuery({
    queryKey: ['ngrp_activity_schedule', cycle?.id, from, to],
    queryFn: () => postNgrpSupport('schedule', { cycle_id: cycle.id, from, to }),
    enabled: Boolean(cycle?.id) && onThisTab,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const marksByDate = useMemo(() => {
    const map = new Map()
    for (const m of schedule?.marks || []) {
      const item = {
        candidate_id: m.candidate_id, on_date: m.on_date,
        name: nameByCandidate.get(m.candidate_id) || 'Resident',
        // A Variable resident names the shift per day; everyone else's mark
        // reads the hire record.
        shift: m.shift || schedule?.shifts?.[m.candidate_id] || null,
      }
      map.set(m.on_date, [...(map.get(m.on_date) || []), item])
    }
    return map
  }, [schedule, nameByCandidate])
  const marksOn = useCallback(date => marksByDate.get(date) || [], [marksByDate])

  // ONE-CALENDAR-1: the interview schedule, every unit's times and bookings for this cohort.
  const sched = useInterviewSchedule(onThisTab ? cycle?.id : null)
  const interviewsOn = sched.data?.provisioned === true
  const interviewees = useMemo(() => sched.data?.interviewees || [], [sched.data])
  const allSlots = useMemo(() => (sched.data?.slots || []), [sched.data])
  const units = sched.data?.units || []
  const slots = useMemo(() => (unit ? allSlots.filter(s => s.unit_key === unit) : allSlots), [allSlots, unit])
  const blocks = useMemo(() => (unit ? (sched.data?.blocks || []).filter(b => b.unit_key === unit) : (sched.data?.blocks || [])), [sched.data, unit])
  const slotsOn = useCallback(date => slots.filter(s => dayOf(s.slot_at) === date), [slots])
  const blocksOn = useCallback(date => blocks.filter(b => b.block_date === date), [blocks])
  const counts = scheduleCounts(interviewees, allSlots, unit || null)
  const refreshSchedule = () => {
    queryClient.invalidateQueries({ queryKey: ['ngrp_workspace', 'schedule', cycle?.id] })
    queryClient.invalidateQueries({ queryKey: ['ngrp_workspace', 'applicants', cycle?.id] })
  }
  const fail = (title, r) => toast?.error?.(title, r.message || ERRORS[r.error] || 'Try again in a moment.')
  const write = (action, payload) => postNgrpManage(action, { cycle_id: cycle.id, ...payload })
  const book = async (choice) => {
    setBusyId(choice.candidate_id)
    const r = await write('schedule_book', { slot_id: bookSlot.id, candidate_id: choice.candidate_id })
    setBusyId(null)
    if (!r.ok) { fail('Not booked', r); refreshSchedule(); return }
    toast?.success?.(r.kind === 'moved' ? 'Interview moved' : 'Interview booked', `${nameOf(choice)}, ${slotWhen(r.slot.slot_at)}. ${noticeSummary(r.notices)}`.trim())
    setBookSlot(null); refreshSchedule()
  }
  const cancelBooking = async (s) => {
    if (!(await confirmDialog(`Cancel ${s.booked_name || 'this'} interview on ${slotWhen(s.slot_at)}? The applicant and the unit's leaders are emailed, and the time opens again.`, { confirmLabel: 'Cancel Interview', cancelLabel: 'Keep Interview', danger: true }))) return
    const r = await write('schedule_cancel', { slot_id: s.id })
    if (!r.ok) { fail('Not cancelled', r); return }
    toast?.success?.('Interview cancelled', noticeSummary(r.notices))
    refreshSchedule()
  }
  const toggleSlot = async (s) => {
    const r = await write('schedule_slot_block', { slot_id: s.id, blocked: s.status !== 'blocked' })
    if (!r.ok) { fail('Not changed', r); return }
    refreshSchedule()
  }
  const removeBlock = async (b) => {
    if (!(await confirmDialog(`Remove ${b.unit_key}'s open times on ${longDateOf(b.block_date)}?`, { confirmLabel: 'Remove Times', danger: true }))) return
    const r = await write('schedule_remove_times', { block_id: b.id })
    if (!r.ok) { fail('Not removed', r); return }
    refreshSchedule()
  }
  const slotActions = !canSchedule ? null : s => {
    if (s.booked) return <DayAction onClick={() => cancelBooking(s)}>Cancel</DayAction>
    if (s.status === 'blocked') return <DayAction onClick={() => toggleSlot(s)}>Reopen</DayAction>
    return (
      <>
        <DayAction onClick={() => setBookSlot(s)}>Book</DayAction>
        <DayAction onClick={() => toggleSlot(s)}>Block</DayAction>
      </>
    )
  }
  // The day's interview rows, drawn the same way in the day panel and the day modal.
  const slotRowsFor = date => {
    const day = slotsOn(date)
    const spans = canSchedule ? blocksOn(date) : []
    if (!day.length && !spans.length) return null
    return (
      <div>
        {day.map(s => <InterviewSlotRow key={s.id} slot={s} showUnit={!unit} actions={slotActions ? slotActions(s) : null} />)}
        {spans.map(b => <RemoveTimesAction key={b.id} block={b} showUnit={!unit} onClick={() => removeBlock(b)} />)}
      </div>
    )
  }

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ngrp_activity_events'] })
    queryClient.invalidateQueries({ queryKey: ['aggregate_welcome_events'] })
  }, [queryClient])

  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-US', MONTH_FMT)
  const title = view === 'week' ? weekTitle(weekStart) : monthName

  const cells = useMemo(() => {
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
    const lead = new Date(cursor.year, cursor.month, 1).getDay()
    const out = Array.from({ length: lead }, () => null)
    for (let d = 1; d <= daysInMonth; d += 1) out.push(toLocalDateStr(new Date(cursor.year, cursor.month, d)))
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [cursor])

  const eventsOn = useCallback(date => events.filter(ev => eventOnDate(ev, date)), [events])
  const holidaysOn = useCallback(date => holidays.filter(h => h.date === date), [holidays])

  const step = delta => {
    if (view === 'week') {
      const next = addDaysYmd(weekStart, 7 * delta)
      setWeekStart(next)
      const [y, m] = next.split('-').map(Number)
      setCursor({ year: y, month: m - 1 })
      return
    }
    setCursor(c => {
      const d = new Date(c.year, c.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }
  const goTo = date => {
    setSelected(date)
    setWeekStart(weekStartOf(date))
    const [y, m] = date.split('-').map(Number)
    setCursor(c => ((y === c.year && m - 1 === c.month) ? c : { year: y, month: m - 1 }))
  }
  const openDay = date => { setSelected(date); setDayOpen(date) }

  // The Week view's rows: dated things in the all-day row, timed things on the hour grid.
  const allDayOn = date => [
    ...holidaysOn(date).map(h => ({ id: `h-${h.name}`, label: h.name, color: HOLIDAY_COLOR, title: `${h.name} · US Holiday` })),
    ...eventsOn(date).filter(ev => ev.all_day || !ev.start_at).map(ev => ({ id: `e-${ev.id}`, label: ev.title, color: eventColor(ev), title: `${eventTypeLabel(ev.event_type)} · ${formatEventWhen(ev)}`, onClick: canManage ? () => setEditing(ev) : null })),
    ...marksOn(date).map(m => ({ id: `m-${m.candidate_id}`, label: `${firstNameOf(m.name) || m.name}${m.shift ? ` ${shiftBadge(m.shift).label.split(' ')[0]}` : ''}`, color: shiftColor(m.shift), title: `${m.name} · ${m.shift ? shiftBadge(m.shift).label : 'shift not recorded'}` })),
  ]
  const timedOn = date => [
    ...eventsOn(date).filter(ev => !ev.all_day && ev.start_at && localDateStr(ev.start_at) === date).map(ev => {
      const start = localHHMM(ev.start_at)
      const end = ev.end_at && localDateStr(ev.end_at) === date ? localHHMM(ev.end_at) : hhmmOf(minutesOf(start) + 60)
      return { id: `e-${ev.id}`, start, end, label: ev.title, sublabel: eventTypeLabel(ev.event_type), color: eventColor(ev), onClick: canManage ? () => setEditing(ev) : () => goTo(date) }
    }),
    ...slotsOn(date).map(s => slotWeekItem(s, { showUnit: !unit, onClick: () => goTo(date) })).filter(Boolean),
  ]

  // ONE-CALENDAR-2 (Owner, 2026-10-06: "match the table below the internship calendar"): the
  // internship Interviews tab's KPI cards and `ir-worklist` rows. A row opens the applicant in
  // Profiles & Interest; the panel column reads the binder's interview_panel.
  const held = new Map(allSlots.filter(s => s.booked).map(s => [s.booked_candidate_id, s]))
  const apptOf = i => held.get(i.candidate_id)?.slot_at || i.interview_at || null
  const paired = interviewees.filter(i => !unit || i.unit === unit)
  const listCounts = {
    total: paired.length,
    booked: paired.filter(i => !!apptOf(i)).length,
    notBooked: paired.filter(i => !apptOf(i)).length,
    held: paired.filter(i => HELD.has(i.interview_status)).length,
  }
  const listRows = paired
    .filter(i => !listFilter || (listFilter === 'booked' ? !!apptOf(i) : listFilter === 'not_booked' ? !apptOf(i) : HELD.has(i.interview_status)))
    .sort((a, b) => String(apptOf(a) || '9').localeCompare(String(apptOf(b) || '9')) || nameOf(a).localeCompare(nameOf(b)))
  const toggleList = key => setListFilter(listFilter === key ? null : key)
  const openApplicant = i => { const r = rowByCandidate.get(i.candidate_id); if (r?.student?.id) navigate(`${base}/profiles?student=${encodeURIComponent(r.student.id)}`) }

  return (
    <>
      <CanonicalCalendarLayout
        // Classic uses the same approved slate planner as Interviews and Rotation.
        paper="slate"
        title="Residency Calendar"
        description={cycle?.name ? `Interviews, workshops, town halls, bootcamps and residents' working days across ${cycle.name}.` : "Interviews, workshops, town halls, bootcamps and residents' working days."}
        labelledBy="ngrp-activity-title"
        toolbar={
          /* CALENDAR-NAV-CANON: the three-slot toolbar every other ASPIRE calendar uses
             (Rotation Activity, Unit Leader, Academics, Student Portal): nav pinned left,
             month CENTERED between two equal flex slots, controls right. The two flex:1
             flanks absorb the title's width, so nothing moves when the month changes. */
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start' }}>
              <CanonicalCalendarNav
                onPrev={() => step(-1)}
                onNext={() => step(1)}
                onToday={() => goTo(today)}
                prevAriaLabel={view === 'week' ? 'Previous week' : 'Previous month'}
                nextAriaLabel={view === 'week' ? 'Next week' : 'Next month'}
              />
            </div>
            <CanonicalCalendarMonthTitle ariaLive="polite">{title}</CanonicalCalendarMonthTitle>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
              {canSchedule && interviewsOn && units.length > 0 && <OpenTimesButton onClick={() => setOpening(true)} />}
              {canManage && <AddEventButton onClick={() => setEditing({ isNew: true })} />}
              <SegmentedPicker paper ariaLabel="Calendar view" value={view} onChange={v => { if (v === 'week') setWeekStart(weekStartOf(selected || today)); setView(v) }}
                options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]} />
            </div>
          </div>
        }
        sidebar={
          <CanonicalCalendarSidebar>
            {/* The same mini calendar the Interviews sidebar shows, with the
                interview half left empty. */}
            <MiniCalendar
              aspireEvents={events}
              selectedDate={selected}
              onSelectDate={goTo}
            />
            <CanonicalCalendarTodayPanel
              kicker={selected === today ? 'Today' : 'Selected day'}
              dateLabel={longDate(selected)}
              summary={(() => {
                const n = eventsOn(selected).length + holidaysOn(selected).length + marksOn(selected).length + slotsOn(selected).length
                return n ? `${n} item${n === 1 ? '' : 's'}` : null
              })()}
              emptyLabel="Nothing scheduled."
            >
              {holidaysOn(selected).map(h => (
                <div key={h.name} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0', fontFamily: F }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: HOLIDAY_COLOR, flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--paper-ink, #374151)' }}>{h.name}</span>
                </div>
              ))}
              {eventsOn(selected).map(ev => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => canManage && setEditing(ev)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none',
                    padding: '6px 0', cursor: canManage ? 'pointer' : 'default', fontFamily: F,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--paper-ink, #374151)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: eventColor(ev), flexShrink: 0 }} aria-hidden="true" />
                    {ev.title}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--paper-muted, #6B7785)', marginLeft: 15 }}>
                    {eventTypeLabel(ev.event_type)} · {formatEventWhen(ev)}
                  </span>
                </button>
              ))}
              {marksOn(selected).map(m => (
                <div key={m.candidate_id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0', fontFamily: F, fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: shiftColor(m.shift), flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ fontWeight: 600, color: 'var(--paper-ink, #374151)' }}>{m.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--paper-muted, #6B7785)' }}>{m.shift ? shiftBadge(m.shift).label : 'Working'}</span>
                </div>
              ))}
              {slotRowsFor(selected)}
            </CanonicalCalendarTodayPanel>
            <div className="pl-legend">
              <Tooltip label="An event is coloured by its type: Workshop, Town Hall, Bootcamp and the rest." applyAriaLabel={false}>
                <span>
                  <i aria-hidden="true" style={{ background: 'rgba(71,85,105,0.14)', borderLeft: '3px solid #475569' }} />Residency event
                </span>
              </Tooltip>
              <span><i aria-hidden="true" style={{ background: 'rgba(29,37,103,0.10)', borderLeft: '3px solid #1D2567' }} />Resident working</span>
              <span><i aria-hidden="true" style={{ background: '#FEF3C7', borderLeft: '3px solid #D97706' }} />US holiday</span>
              {interviewsOn && <InterviewLegend />}
            </div>
          </CanonicalCalendarSidebar>
        }
      >
        {view === 'week' ? (
          <CanonicalWeekView weekStart={weekStart} today={today} selectedDate={selected} allDayOn={allDayOn} timedOn={timedOn}
            onDayClick={goTo} ariaLabel={`${weekTitle(weekStart)} residency calendar`} />
        ) : (
        <div className="pl-calbox">
        <CanonicalWeekdayHeader />
        <div className="pl-monthgrid" role="grid" aria-label={`${monthName} activity`} style={{ gridTemplateColumns: 'repeat(7, 1fr)', '--weeks': Math.ceil(cells.length / 7) }}>
          {cells.map((date, i) => date === null
            ? <CanonicalMonthCell key={`pad-${i}`} isOtherMonth />
            : (
              // The pill is a SIBLING of the day button, not a child: nesting one
              // button inside another is invalid and costs the pill its keyboard
              // reachability. The wrapper positions it and drives the hover.
              <div key={date} className="ngrp-daycell">
                <CanonicalMonthCell
                  day={Number(date.slice(-2))}
                  isToday={date === today}
                  isSelected={date === selected}
                  isFuture={date > today}
                  ariaLabel={`${longDate(date)}, ${eventsOn(date).length} events, ${marksOn(date).length} residents working, ${slotsOn(date).filter(s => s.booked).length} interviews`}
                  onClick={() => openDay(date)}
                >
                  {/* Holidays are AMBER, as they are on the Interviews calendar:
                      they are context nobody scheduled, and reading as another
                      event is exactly the confusion the colour prevents. */}
                  {/* ONE-CALENDAR-1: the shared holiday chip (a fixed amber pair in both themes); the
                      ngrp-holiday-chip span read black on the dark paper. */}
                  {holidaysOn(date).map(h => <CanonicalHolidayChip key={h.name} name={h.name} observed={h.observed} />)}
                  <InterviewDayChips slots={slotsOn(date)} />
                  {marksOn(date).slice(0, 3).map(m => <ShiftMark key={m.candidate_id} mark={m} />)}
                  {marksOn(date).length > 3 && (
                    <span className="ngrp-shift-mark" style={{ background: 'rgba(30,42,110,0.06)', color: 'var(--paper-muted, #6B7785)' }}>+{marksOn(date).length - 3} working</span>
                  )}
                  {/* Tinted by the event's own type, the way the Interviews calendar
                      draws one. A workshop, a town hall and a bootcamp are three of the
                      eleven ASPIRE event types, not a taxonomy of their own, so the chip
                      reads the type rather than inventing a kind. */}
                  {eventsOn(date).slice(0, 2).map(ev => (
                    <CanonicalActivityChip key={ev.id} label={ev.title} color={eventColor(ev)} ink="var(--paper-ink)" />
                  ))}
                  {eventsOn(date).length > 2 && (
                    <CanonicalActivityChip label={`+${eventsOn(date).length - 2} more`} secondary />
                  )}
                </CanonicalMonthCell>
                {canManage && (
                  <button
                    type="button"
                    className="ngrp-dayadd pl-ghost pl-ghost-event pl-ghost-mini"
                    aria-label={`Add an event on ${longDate(date)}`}
                    onClick={() => { setSelected(date); setEditing({ isNew: true, on: date }) }}
                  >
                    + Event
                  </button>
                )}
              </div>
            ))}
        </div>
        </div>
        )}
      </CanonicalCalendarLayout>

      {interviewsOn && (
        /* CALENDAR-TABLE-1 (Owner, 2026-10-07: "still looks buggy"): the internship Interviews
           tab puts its KPI cards and worklist straight on the page, and the worklist IS the card.
           This section used to wrap them in a `.snap` card that has no padding of its own, so the
           heading, the cards and the muted sentence sat flush against a second card's edge, 20px
           inside the calendar's. Now it is laid out as that tab is: a heading row, the cards, the
           worklist, all on the page and as wide as the calendar above them. */
        <section aria-label="Paired applicants" style={{ marginTop: 'var(--aspire-gap-card, 16px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '0 2px' }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-heading)' }}>Paired Applicants</h3>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-heading)' }}>
              Unit
              <select style={{ ...inputStyle, width: 200, height: 30 }} value={unit} onChange={e => setUnit(e.target.value)}>
                <option value={ALL}>All units</option>
                {units.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <span style={{ fontSize: 12.5, color: 'var(--text-caption)' }}>
              {counts.open} open time{counts.open === 1 ? '' : 's'}. Unit leaders open times on their own calendar; times opened here show there too.
            </span>
          </div>
          <div className="ir-kpis" style={{ display: 'grid', gap: 10, padding: '10px 0 12px', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <FilterKPICard value={listCounts.total} label="Paired" accent="nightfall" active={!listFilter} onClick={() => setListFilter(null)} />
            <FilterKPICard value={listCounts.booked} label="Booked" accent="marina" active={listFilter === 'booked'} onClick={() => toggleList('booked')} />
            <FilterKPICard value={listCounts.notBooked} label="Not Booked" accent="dawn" active={listFilter === 'not_booked'} onClick={() => toggleList('not_booked')} />
            <FilterKPICard value={listCounts.held} label="Interviewed" accent="sage" active={listFilter === 'held'} onClick={() => toggleList('held')} />
          </div>
          {paired.length === 0 ? (
            <EmptyState compact heading={interviewees.length ? 'No one is paired with this unit yet' : 'No one is paired with a unit yet'}
              subtext="Pair applicants with hiring units on the Interview Board; they appear here when you do." />
          ) : (
            <div className="ir-worklist">
              <div className="ir-wl-thead">
                <div style={{ width: 6, flexShrink: 0 }} />
                <div className="ir-wl-th ir-wl-col-student">Applicant</div>
                <div className="ir-wl-th ir-wl-col-appt">Appointment</div>
                <div className="ir-wl-th ir-wl-col-workflow">Their Choice</div>
                <div className="ir-wl-th ir-wl-col-outcome">Panel</div>
                <div className="ir-wl-th ir-wl-col-action">Action</div>
              </div>
              {listRows.map(i => {
                const row = rowByCandidate.get(i.candidate_id)
                const appt = apptOf(i)
                const panel = row?.interview_panel || null
                const pill = panel?.recommendation && REC_PILL[panel.recommendation]
                return (
                  <div key={i.candidate_id} className="ir-wl-row" role="button" tabIndex={0} aria-label={`Open ${nameOf(i)} in Profiles & Interest`}
                    onClick={() => openApplicant(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openApplicant(i) } }}>
                    <div className="ir-wl-flag-strip" style={{ background: 'transparent' }} />
                    <div className="ir-wl-cell ir-wl-col-student">
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {row?.student ? <StudentAvatar student={row.student} size={40} /> : null}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>{nameOf(i)}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{[row?.student?.school, row?.student?.program_type].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                    </div>
                    <div className="ir-wl-cell ir-wl-col-appt">
                      {appt ? (
                        <>
                          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-accent-primary)', whiteSpace: 'nowrap' }}>{slotWhen(appt)}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>{INTERVIEW_MODE_LABELS[i.interview_mode] || 'Format not recorded'}</div>
                        </>
                      ) : <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Not Booked</span>}
                    </div>
                    <div className="ir-wl-cell ir-wl-col-workflow">{i.choice_rank ? `#${i.choice_rank} choice` : 'Not ranked'}<div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{i.unit}</div></div>
                    <div className="ir-wl-cell ir-wl-col-outcome">
                      {panel?.completed ? (
                        <>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-text-primary)' }}>{panel.average != null ? Number(panel.average).toFixed(1) : '–'}<span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 11 }}> / 15 · {panel.completed} rubric{panel.completed === 1 ? '' : 's'}</span></div>
                          {pill && <span style={{ alignSelf: 'flex-start', display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 4, background: pill[0], color: pill[1] }}>{recommendationLabel(panel.recommendation)}</span>}
                        </>
                      ) : <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{panel?.in_progress ? 'Rubric in progress' : 'No rubric yet'}</span>}
                    </div>
                    <div className="ir-wl-cell ir-wl-col-action">
                      {/* The internship worklist's own row action: a theme-token pill, readable in both themes. */}
                      <button type="button" onClick={e => { e.stopPropagation(); openApplicant(i) }}
                        style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 14px', borderRadius: 999, border: '1px solid var(--color-border-default)', background: 'var(--color-bg-surface)', fontFamily: 'Plus Jakarta Sans,sans-serif', fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                        Open Applicant
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {dayOpen && (
        <DayModal
          date={dayOpen}
          events={eventsOn(dayOpen)}
          holidays={holidaysOn(dayOpen)}
          marks={marksOn(dayOpen)}
          slotRows={slotRowsFor(dayOpen)}
          canManage={canManage}
          onAdd={() => { setEditing({ isNew: true, on: dayOpen }); setDayOpen(null) }}
          onEdit={ev => { setEditing(ev); setDayOpen(null) }}
          onClose={() => setDayOpen(null)}
        />
      )}

      {editing && (
        <AspireEventModal
          event={editing.isNew ? null : editing}
          canManage={canManage}
          defaultDate={editing.on || selected}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}

      {opening && (
        <OpenTimesModal units={unit ? [unit, ...units.filter(u => u !== unit)] : units} defaultDate={selected}
          note="The span is cut into interview times for the unit. Its leaders see them on their own calendar."
          save={async f => { const r = await write('schedule_open_times', f); return r.ok ? { ok: true, data: r } : { ok: false, errors: r.errors?.length ? r.errors : [{ message: r.message || ERRORS[r.error] || 'The times could not be opened.' }] } }}
          onClose={() => setOpening(false)}
          onSaved={(r, f) => { toast?.success?.('Times opened', `${r.data.slot_count} interview time${r.data.slot_count === 1 ? '' : 's'} for ${f.unit} on ${longDateOf(f.block_date)}.`); setOpening(false); refreshSchedule() }} />
      )}
      {bookSlot && (
        <BookDialog slot={bookSlot} choices={bookingChoices(interviewees, allSlots, bookSlot)} busyId={busyId}
          onClose={() => setBookSlot(null)} onBook={book} />
      )}
    </>
  )
}

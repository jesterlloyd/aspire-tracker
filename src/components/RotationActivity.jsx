// ROTATION-ACTIVITY-OVERSIGHT - Rotation > Activity is a three-section oversight board:
//   1. On Campus Now      - live presence, as the shared StaffOnCampusStrip cards. Clicking a
//                           card opens that student's profile drawer.
//   2. Rotation activity  - a month calendar of shifts students have ACTUALLY LOGGED, with a
//                           unit filter. Selecting a day lists it; selecting a shift there
//                           opens its details, where a staff reader reviews it.
//   3. Rotation Progress  - every student who is Placed or in Active Rotation, with hours
//                           progress, follow-up indicators, and View Hours.
//
// Read-only. Owner/Admin-only (canEdit). No writes/email/cron/RPC of its own; the only writes
// reachable from here are the review decisions inside ClinicalHoursPanel. Progress math mirrors
// the Student Profile (approved_hours / hours_required); no-recent-log mirrors Action Center act15.
//
// ROTATION-ACTIVITY-CALENDAR-1 changed all three sections:
//   - On Campus Now was the OpenShiftReview detector (overdue / emailable / no-email
//     classification). That component is now UNMOUNTED at the Owner's direction, not deleted:
//     it is the standing spec for a future CLOCKOUT-NUDGE-1 cron, and src/components/
//     OpenShiftReview.jsx is where that spec lives. Nothing else in the app renders it.
//   - The calendar is new.
//   - The progress list widened from Active Rotation only to Placed AND Active Rotation, so a
//     student who was placed but has never logged a shift is visible rather than absent, and
//     became a table (RotationStudentTable) instead of stacked cards.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import StaffOnCampusStrip from './oncampus/StaffOnCampusStrip'
import RotationActivityCalendar from './rotation/RotationActivityCalendar'
import RotationStudentTable from './rotation/RotationStudentTable'
import { buildStudentShiftOrdinals } from '../lib/shiftOrdinals'
import ClinicalHoursPanel from './ClinicalHoursPanel'
import { useSupportRequestReads } from '../lib/support/useSupportRequestReads'
import { unreadCountByStudent, unreadSupportShifts } from '../lib/support/supportRequests'
import { getStudentPreferredFullName, getStudentPreferredFirstName } from '../lib/studentNameFormatters'
import { resolvePreceptor } from '../lib/preceptor'
import { canonicalRotationWindow } from '../lib/rotationWindow'
import { hoursProgress } from '../lib/clinicalHours'
import { shiftDrivesState } from '../lib/shiftLifecycle'
import {
  ROTATION_SORT_OPTIONS, DEFAULT_ROTATION_SORT, rotationComparator, rotationSortFeedback,
} from '../lib/rotationSort'

// Compact canonical rotation range for a card: "Mon D – Mon D" from the linked
// cohort_school_rotations row, else legacy students.term_dates, else '' (omit).
const fmtRangeDate = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function resolveRotationRange(student, rotationRow) {
  const win = canonicalRotationWindow(rotationRow)
  if (win) return `${fmtRangeDate(win.start)} – ${fmtRangeDate(win.end)}`
  return (student.term_dates || '').trim()
}

const F = 'Plus Jakarta Sans, sans-serif'
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000

// Who appears in the Rotation Progress list. 'Placed' is included so a student who has been
// placed but has never logged a shift is VISIBLE with zero hours, rather than absent from the
// one board meant to show rotation progress. Order matters only for readability; sorting is
// the SortControl's job.
const PROGRESS_STATUSES = ['Placed', 'Active Rotation']

// Sentinel for "no unit filter". A real unit is identified by NAME here; see calendarUnit.
const UNIT_ALL = '__all__'

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ margin: '18px 2px 8px' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#191919', fontFamily: F }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, fontFamily: F }}>{subtitle}</div>}
    </div>
  )
}

function SortControl({ value, onChange, feedback }) {
  // React's change event is the primary path. input is retained as a fallback
  // for embedded Chromium shells that open the native picker but do not always
  // deliver a change event when the menu closes.
  const commitSelection = e => onChange(e.currentTarget.value)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280', fontFamily: F, whiteSpace: 'nowrap' }}>
        Sort by
        <select
          aria-label="Sort active rotation progress"
          value={value}
          onInput={commitSelection}
          onChange={commitSelection}
          style={{
            fontFamily: F, fontSize: 13, padding: '6px 9px', borderRadius: 8,
            border: '1px solid #e0ddd3', background: '#fff', color: '#191919', cursor: 'pointer',
          }}>
          {ROTATION_SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
      {feedback && (
        <span role="status" aria-live="polite" style={{ fontSize: 10.5, color: '#6b7280', fontFamily: F }}>
          {feedback}
        </span>
      )}
    </div>
  )
}

function EmptyCard({ children }) {
  return (
    <div style={{
      margin: '8px 0', padding: '24px 20px', textAlign: 'center',
      background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14,
      color: '#6b7280', fontSize: 13.5, fontFamily: F,
    }}>{children}</div>
  )
}

// Expanded clinical-hours detail for one student. Fetches the SAME per-student shift-log
// query as the Student Profile (shared React Query cache key) and renders the shared
// ClinicalHoursPanel - same totals, table, and Shift Details modal.
function ActiveRotationHours({ student, autoOpenShiftLogId, onAutoOpenConsumed, onReviewDecided }) {
  const { data: shiftLogs = [], isLoading } = useQuery({
    queryKey: ['student_shift_logs', student.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_shift_logs')
        .select('*').eq('student_id', student.id)
        .order('shift_date', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!student.id,
  })
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, fontFamily: F }}>
        Clinical Hours
      </div>
      {isLoading
        ? <div style={{ fontSize: 12.5, color: '#9ca3af', fontFamily: F }}>Loading hours…</div>
        : <ClinicalHoursPanel student={student} shiftLogs={shiftLogs} autoOpenShiftLogId={autoOpenShiftLogId} onAutoOpenConsumed={onAutoOpenConsumed} onReviewDecided={onReviewDecided} />}
    </div>
  )
}

export default function RotationActivity({ students = [], units = [], cohortId, onNavigateToStudent, onReviewDecided, focusStudentId, onFocusConsumed, focusShiftLogId = null, onFocusShiftConsumed }) {
  const { canEdit, userProfile } = useAuth()
  const profileId = userProfile?.id
  const { receipts: supportReceipts } = useSupportRequestReads(profileId)
  // ASPIRE-CHART performance: polling pauses while this always-mounted pane
  // is not the visible route; data refreshes on return.
  const onActivityRoute = useLocation().pathname === '/rotation/activity'
  const [expandedId, setExpandedId] = useState(null)
  // ASPIRE-CHART: the in-page Support badge now opens the EXACT flagged shift
  // (same one-click behavior the Action Center path already had) instead of
  // only expanding the card and leaving the reader to hunt the table.
  // ROTATION-ACTIVITY-CALENDAR-1: renamed from localSupportOpen. It is no longer only the
  // support path: selecting a shift in the calendar's day panel targets that exact shift the
  // same way, so one piece of state now serves both entry points.
  const [localShiftOpen, setLocalShiftOpen] = useState(null) // { studentId, shiftLogId }
  const [sortMode, setSortMode] = useState(DEFAULT_ROTATION_SORT)
  // SHIFT-LOG-REVIEW-1: the Pending Review queue filter.
  const [pendingOnly, setPendingOnly] = useState(false)
  // The calendar's unit filter. UNIT_ALL means every unit in the cohort; otherwise a unit
  // NAME, because a shift log records unit_name as text and may name a unit the student is
  // not formally assigned to (a float shift). Filtering on the id would silently drop those.
  const [calendarUnit, setCalendarUnit] = useState(UNIT_ALL)
  const [highlightId, setHighlightId] = useState(null)
  const cardRefs = useRef({})   // { [studentId]: row element } - for scroll-into-view
  const focusTimers = useRef([]) // pending scroll/highlight cancelers - cleared on new focus / unmount

  // Expand + scroll + highlight the matching Rotation Progress row. Shared by the Aggregate
  // handoff (focusStudentId prop), the in-page On Campus Now card click, and the calendar's
  // day panel. No-op if the student is not in the list below. The scroll is deferred past the
  // route/subtab (display:none→block) AND the expanded-row layout pass - a short timeout +
  // double rAF - so it lands on the row's final position. Pending handles are tracked in a ref
  // so a NEW focus cancels the previous, and the unmount effect clears any pending.
  const focusOnStudent = useCallback((id) => {
    if (!id) return
    // Widened with the list itself: it used to require 'Active Rotation', which silently
    // no-opped for a Placed student even though the handoff had a real target.
    const listed = students.some(s => s.id === id && PROGRESS_STATUSES.includes(s.status))
    if (!listed) return // safe no-op fallback
    focusTimers.current.forEach(fn => fn()); focusTimers.current = []
    setExpandedId(id)
    const t = setTimeout(() => {
      const r1 = requestAnimationFrame(() => {
        const r2 = requestAnimationFrame(() => {
          cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          setHighlightId(id)
          const h = setTimeout(() => setHighlightId(prev => (prev === id ? null : prev)), 1800)
          focusTimers.current.push(() => clearTimeout(h))
        })
        focusTimers.current.push(() => cancelAnimationFrame(r2))
      })
      focusTimers.current.push(() => cancelAnimationFrame(r1))
    }, 80)
    focusTimers.current.push(() => clearTimeout(t))
  }, [students])

  // Aggregate > On Campus Now handoff: consume the one-time target.
  useEffect(() => {
    if (!focusStudentId) return
    focusOnStudent(focusStudentId) // eslint-disable-line react-hooks/set-state-in-effect
    onFocusConsumed?.()
  }, [focusStudentId, focusOnStudent, onFocusConsumed])

  // Clear any pending scroll/highlight timers if the component unmounts mid-sequence.
  useEffect(() => () => { focusTimers.current.forEach(fn => fn()); focusTimers.current = [] }, [])

  // Full open-shift population (in_progress) for the cohort - read-only SELECT, unchanged.
  const { data: openLogs = [] } = useQuery({
    queryKey: ['rotation_open_shifts', cohortId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_shift_logs')
        .select('id, student_id, checked_in_at, lifecycle_state, planned_shift_type, planned_unit_name, planned_preceptor_name, unit_name, preceptor_name')
        .eq('cohort_id', cohortId)
        .eq('lifecycle_state', 'in_progress')
        .order('checked_in_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!cohortId && canEdit,
    refetchInterval: onActivityRoute ? 60 * 1000 : false,
  })

  // Per-student last-log summary for the Active Rotation Progress section. Computed in the
  // async query (not during render) so the board stays free of impure render-time Date calls.
  // "No recent log" = no submitted shift in the last 7 days (mirrors Action Center act15).
  const { data: logSummary = { summary: {}, supportLogs: [], pendingByStudent: {}, shiftRows: [] } } = useQuery({
    queryKey: ['rotation_log_summary', cohortId],
    queryFn: async () => {
      // SUPPORT-REQUEST-ACTION-CENTER-2: also read support_needed WITH the shift id (same table/rows,
      // no schema/RLS change) so the per-student badge can count UNREAD requests (derived in render
      // against the current user's receipts). id is required to match receipts per exact shift.
      // SHIFT-LOG-REVIEW-1: status + lifecycle_state added to the SAME read (no
      // new query, no RLS change) so the queue can count stranded Pending
      // Review shifts per student across the whole cohort.
      // ROTATION-ACTIVITY-CALENDAR-1: the calendar's columns join this SAME read rather than
      // adding a second query. This one already returns every shift row in the cohort, which is
      // also exactly what the ordinal needs: a student's shift number is counted from their FULL
      // history, so computing it from a windowed subset would renumber shifts as months change.
      const { data, error } = await supabase
        .from('student_shift_logs')
        .select([
          'id', 'student_id', 'submitted_at', 'support_needed', 'status', 'lifecycle_state',
          'shift_date', 'checked_in_at', 'unit_name', 'preceptor_name',
          'planned_unit_name', 'planned_preceptor_name',
        ].join(', '))
        .eq('cohort_id', cohortId)
      if (error) throw error
      const now = Date.now()
      const latest = {}
      const supportLogs = []
      const pendingByStudent = {}
      const shiftRows = []
      for (const l of (data || [])) {
        // STUDENT-SHIFT-LOG-MANAGEMENT-1: a withdrawn entry drives nothing -
        // no support alert, it can never be someone's latest shift, and it must not
        // appear on the calendar as a shift that happened.
        if (!shiftDrivesState(l)) continue
        // A row with no shift_date cannot be placed on a day, so it is not calendar data.
        if (l.shift_date) shiftRows.push(l)
        // A support entry exists when the textbox is non-empty after trimming (null/blank = none).
        if ((l.support_needed || '').trim()) supportLogs.push({ id: l.id, student_id: l.student_id, support_needed: l.support_needed })
        // Only COMPLETED pending-review shifts hold stranded hours (open shifts
        // have null status; 'needs_review' is the legacy spelling).
        if (l.lifecycle_state === 'completed' && (l.status === 'Pending Review' || l.status === 'needs_review')) {
          pendingByStudent[l.student_id] = (pendingByStudent[l.student_id] || 0) + 1
        }
        if (!l.submitted_at) continue
        const t = new Date(l.submitted_at).getTime()
        if (!latest[l.student_id] || t > latest[l.student_id].t) latest[l.student_id] = { t, iso: l.submitted_at }
      }
      const summary = {}
      for (const sid of Object.keys(latest)) {
        const v = latest[sid]
        summary[sid] = {
          lastLog: v.iso,
          daysSince: Math.floor((now - v.t) / (24 * 3600 * 1000)),
          noRecentLog: (now - v.t) > SEVEN_DAYS_MS,
        }
      }
      return { summary, supportLogs, pendingByStudent, shiftRows }
    },
    enabled: !!cohortId && canEdit,
    refetchInterval: onActivityRoute ? 60 * 1000 : false,
  })

  // Canonical rotation date windows (coordinator-owned cohort_school_rotations) for the cohort,
  // mapped by row id. Students link via students.cohort_school_rotation_id. Read-only SELECT on
  // the same table other surfaces already query client-side. Rotation dates change rarely.
  const { data: rotationById = {} } = useQuery({
    queryKey: ['rotation_ranges', cohortId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cohort_school_rotations')
        .select('id, rotation_start_date, rotation_end_date')
        .eq('cohort_id', cohortId)
      if (error) throw error
      return Object.fromEntries((data || []).map(r => [r.id, r]))
    },
    enabled: !!cohortId && canEdit,
    staleTime: 5 * 60_000,
  })

  // Per-student count of UNREAD support requests for the current user (drives the "Support needed"
  // badge). Recomputes when the receipts query invalidates after a modal marks a request read.
  const unreadSupportByStudent = useMemo(
    () => unreadCountByStudent(logSummary.supportLogs || [], profileId, supportReceipts),
    [logSummary, profileId, supportReceipts]
  )

  // ── Calendar rows ───────────────────────────────────────────────────────────
  // Built from the cohort-wide shift rows the summary query already fetched. The shape
  // matches what the Unit Leader calendar consumes, so both render through identical logic:
  //   { id, shift_date, student_name, student_first_name, preceptor_name, unit_key, state, ordinal, checked_in_at }
  //
  // An in-progress shift has not recorded its final unit or preceptor yet, so it reads the
  // PLANNED values; a completed one reads the actual. This mirrors api/portal/unit-shift-
  // activity.js exactly, so a shift does not appear to change unit when it closes.
  const calendarShifts = useMemo(() => {
    const rows = logSummary.shiftRows || []
    // Ordinals come from the shared rule (src/lib/shiftOrdinals.js) over the student's FULL
    // history, which is what these rows are: every shift in the cohort, unwindowed.
    const ordinalById = buildStudentShiftOrdinals(rows)
    const nameById = new Map(students.map(s => [s.id, getStudentPreferredFullName(s)]))
    // The chip label: preferred first name when set, through the same formatter the Unit
    // Leader feed uses, so the two calendars name a student identically.
    const firstById = new Map(students.map(s => [s.id, getStudentPreferredFirstName(s)]))
    return rows.map(l => {
      const inProgress = l.lifecycle_state === 'in_progress'
      return {
        id: l.id,
        student_id: l.student_id,
        shift_date: l.shift_date,
        student_name: nameById.get(l.student_id) || null,
        student_first_name: firstById.get(l.student_id) || null,
        preceptor_name: (inProgress ? l.planned_preceptor_name : l.preceptor_name) || null,
        unit_key: (inProgress ? l.planned_unit_name : l.unit_name) || null,
        state: inProgress ? 'in_progress' : 'completed',
        ordinal: ordinalById.get(l.id) ?? null,
        checked_in_at: l.checked_in_at || null,
      }
    })
  }, [logSummary, students])

  // Every unit that actually appears in this cohort's logged shifts, plus any unit a listed
  // student is assigned to. Derived from the DATA rather than from the full units table, so
  // the filter never offers a unit with nothing behind it. A float shift to an unassigned
  // unit still shows up, because unit_key comes from the shift row itself.
  const calendarUnitOptions = useMemo(() => {
    const names = new Set()
    for (const s of calendarShifts) if (s.unit_key) names.add(s.unit_key)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [calendarShifts])

  const visibleCalendarShifts = useMemo(
    () => (calendarUnit === UNIT_ALL
      ? calendarShifts
      : calendarShifts.filter(s => s.unit_key === calendarUnit)),
    [calendarShifts, calendarUnit]
  )

  if (!canEdit) return null // Owner/Admin-only, carried over from CLOCKOUT-DETECT-1.

  // Expand the student's row and target one exact shift, so its Details modal opens instead
  // of leaving the reader to find it in the table. Shared by the Support badge and by the
  // calendar's day panel.
  const openShiftForStudent = (studentId, shiftLogId) => {
    setExpandedId(studentId)
    setLocalShiftOpen({ studentId, shiftLogId })
  }

  // The Support badge's target: the first UNREAD support shift, falling back to the first
  // when all are read. The receipt is still written only by the Details modal after the
  // text renders.
  const openSupportShift = (studentId) => {
    const mine = (logSummary.supportLogs || []).filter(l => l.student_id === studentId)
    const unread = unreadSupportShifts(mine, profileId, supportReceipts)
    const target = unread[0] || mine[0]
    if (!target) return
    openShiftForStudent(studentId, target.id)
  }

  // Selecting a shift in the calendar's day panel. The student must be in the list below for
  // the expansion to have somewhere to happen; when they are not (a Completed student's older
  // shift), fall back to their profile rather than doing nothing silently.
  const openCalendarShift = (shift) => {
    if (!shift?.student_id) return
    const listed = students.some(s => s.id === shift.student_id && PROGRESS_STATUSES.includes(s.status))
    if (!listed) { onNavigateToStudent?.(shift.student_id); return }
    openShiftForStudent(shift.student_id, shift.id)
    focusOnStudent(shift.student_id)
  }

  const onCampusIds = new Set(openLogs.map(l => l.student_id))

  const cards = students
    .filter(s => PROGRESS_STATUSES.includes(s.status))
    .map(s => {
      // HOURS-COMPLETE-1: the badge's own arithmetic, now named and shared so
      // the Action Center's weekly-logging monitor consumes the SAME
      // determination instead of a second formula.
      const { required: req, approved: apv, pct, complete, nearComplete } = hoursProgress(s)
      const log = logSummary.summary?.[s.id] || null
      const prec = resolvePreceptor(s)
      const unit = units.find(u => u.id === s.matched_unit_id)
      return {
        s, req, apv, pct,
        lastLog: log?.lastLog || null,
        daysSince: log?.daysSince ?? null,
        noRecentLog: !log || log.noRecentLog,
        missingPreceptor: !s.preceptor_id && !(s.matched_preceptor || '').trim(),
        onCampus: onCampusIds.has(s.id),
        precName: prec.name,
        unitName: unit?.unit_name || '',
        shift: s.shift_assigned || '',
        school: s.school || '',
        range: resolveRotationRange(s, rotationById[s.cohort_school_rotation_id]),
        complete,
        nearComplete,
        supportNeeded: unreadSupportByStudent[s.id] || 0,
        pendingReview: (logSummary.pendingByStudent || {})[s.id] || 0,
      }
    })

  // Sort only the Active Rotation Progress list (never On Campus Now). Expansion is keyed by
  // student id, so re-sorting preserves the expanded card. ROTATION-SORT-2: the comparators live
  // in lib/rotationSort.js, pure and unit-tested, and every completion sort runs on the same
  // percentage the card displays rather than raw approved hours.
  const visibleCards = pendingOnly ? cards.filter(c => c.pendingReview > 0) : cards
  const sortedCards = [...visibleCards].sort(
    rotationComparator(sortMode, c => getStudentPreferredFullName(c.s)))
  const sortFeedback = rotationSortFeedback(sortMode, visibleCards)

  // SHIFT-LOG-REVIEW-1: the Pending Review queue. The filter narrows the
  // progress list to students with stranded shifts; the ledger of students who
  // hold pending shifts but are NOT in the list (Completed, Not Proceeding, …)
  // is named explicitly - a queue that silently drops them would recreate the
  // original stranding. Widening the list to include Placed shrank this ledger
  // rather than removing the need for it.
  const pendingByStudent = logSummary.pendingByStudent || {}
  const totalPendingShifts = Object.values(pendingByStudent).reduce((a, b) => a + b, 0)
  const visiblePendingIds = new Set(cards.filter(c => c.pendingReview > 0).map(c => c.s.id))
  const offListPending = Object.keys(pendingByStudent)
    .filter(sid => !visiblePendingIds.has(sid))
    .map(sid => ({ student: students.find(s => s.id === sid), count: pendingByStudent[sid] }))
    .filter(x => x.student)
  const shownCards = sortedCards

  return (
    <div style={{ padding: '4px 20px 24px', fontFamily: F }}>
      {/* ── Section 1: On Campus Now ──────────────────────────────────────────
          The SAME StaffOnCampusStrip the At a Glance dashboard renders, so the two
          staff surfaces cannot disagree on badge, duration, or the hedged overdue
          wording. Clicking a card opens that student's profile drawer, which is what
          the Unit Leader portal's equivalent card does. */}
      <SectionHeader title="On Campus Now" subtitle="Students checked in or active on campus right now." />
      <StaffOnCampusStrip
        logs={openLogs}
        students={students}
        units={units}
        onSelectStudent={onNavigateToStudent}
        emptyText="No students are on shift right now."
        flush
      />

      {/* ── Section 2: Rotation activity calendar ─────────────────────────────
          A record of shifts already logged, never a forward schedule. The unit filter
          sits where the portal leaves an empty toolbar slot. */}
      <SectionHeader
        title="Rotation Activity"
        subtitle="Shifts students have logged, by day. Select a day to list it, then a shift to open its details."
      />
      <RotationActivityCalendar
        shifts={visibleCalendarShifts}
        onSelectShift={openCalendarShift}
        toolbarRight={calendarUnitOptions.length > 1 ? (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280', fontFamily: F, whiteSpace: 'nowrap' }}>
            Unit
            <select
              aria-label="Filter rotation activity by unit"
              value={calendarUnit}
              onChange={e => setCalendarUnit(e.currentTarget.value)}
              style={{
                fontFamily: F, fontSize: 13, padding: '6px 9px', borderRadius: 8,
                border: '1px solid #e0ddd3', background: '#fff', color: '#191919', cursor: 'pointer',
              }}>
              <option value={UNIT_ALL}>All units</option>
              {calendarUnitOptions.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        ) : null}
      />

      {/* ── Section 3: Rotation Progress ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <SectionHeader
          title="Rotation Progress"
          subtitle="Students placed or in active rotation, including those not on campus today."
        />
        {cards.length > 0 && (
          <div style={{ margin: '0 2px 8px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {totalPendingShifts > 0 && (
              <button
                data-testid="pending-review-filter"
                onClick={() => setPendingOnly(v => !v)}
                aria-pressed={pendingOnly}
                title="Show only students with shifts awaiting an Owner/Admin review decision"
                style={{
                  fontSize: 12, fontWeight: 700, fontFamily: F, padding: '6px 11px', borderRadius: 8,
                  border: `1.5px solid ${pendingOnly ? '#78350F' : '#f0c9b0'}`, cursor: 'pointer',
                  background: pendingOnly ? '#78350F' : '#FEF3C7', color: pendingOnly ? '#fff' : '#78350F',
                }}>
                Pending review · {totalPendingShifts}
              </button>
            )}
            <SortControl value={sortMode} onChange={setSortMode} feedback={sortFeedback} />
          </div>
        )}
      </div>

      {/* Students holding pending shifts who are NOT in the list below (neither
          Placed nor Active Rotation). Named so no stranded shift hides behind the filter. */}
      {offListPending.length > 0 && (
        <div data-testid="pending-offlist" style={{
          margin: '0 0 8px', padding: '9px 12px', borderRadius: 10, fontFamily: F,
          background: '#FBF5E8', border: '1px solid #f0c9b0', fontSize: 12.5, color: '#8B5E1A',
        }}>
          Also awaiting review (not in active rotation):{' '}
          {offListPending.map(({ student: s, count }, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <button onClick={() => onNavigateToStudent?.(s.id)} style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 12.5, fontWeight: 700, color: '#78350F', fontFamily: F, textDecoration: 'underline',
              }}>
                {getStudentPreferredFullName(s)}
              </button>
              {` (${count})`}
            </span>
          ))}
        </div>
      )}
      {shownCards.length === 0 ? (
        <EmptyCard>
          {pendingOnly
            ? 'No students in this list have shifts pending review.'
            : 'No students are placed or in active rotation right now.'}
        </EmptyCard>
      ) : (
        <RotationStudentTable
          cards={shownCards}
          expandedId={expandedId}
          highlightId={highlightId}
          onToggle={id => setExpandedId(prev => (prev === id ? null : id))}
          onOpenProfile={onNavigateToStudent}
          onSupportOpen={openSupportShift}
          rowRef={(id, el) => { if (el) cardRefs.current[id] = el; else delete cardRefs.current[id] }}
          renderHours={card => (
            <ActiveRotationHours
              student={card.s}
              /* SUPPORT-REQUEST-ACTION-CENTER-2: only the expanded row receives the exact shift
                 id, so its ClinicalHoursPanel auto-opens that shift's Details modal. Three
                 entry points feed it: the Action Center deep link (focusShiftLogId), the
                 Support badge, and the calendar's day panel. */
              autoOpenShiftLogId={focusShiftLogId
                || (localShiftOpen?.studentId === card.s.id ? localShiftOpen.shiftLogId : null)}
              onAutoOpenConsumed={() => { onFocusShiftConsumed?.(); setLocalShiftOpen(null) }}
              onReviewDecided={onReviewDecided}
            />
          )}
        />
      )}
    </div>
  )
}

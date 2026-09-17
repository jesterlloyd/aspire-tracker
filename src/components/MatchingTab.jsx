import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Tooltip from './ui/Tooltip'
import EmbedUnitCard from './EmbedUnitCard'
import StudentMatchingCard from './StudentMatchingCard'
import { UNIT_DIVISION_MAP, ASPIRE_STATUS_SORT_ORDER } from '../lib/constants'
import StatusLegendPopover from './StatusLegendPopover'
import EmptyState from './EmptyState'
import { Users, MapPin, Info } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import RestrictedAccessOverlay from './RestrictedAccessOverlay'
import { canPerformMatching } from '../lib/permissions'
import { KPICell } from './KPIBand'
import { unitOpenSlots, totalOpenSlots, derivePrefCounts, studentsMatchedToUnit } from '../lib/placementDisplay'
import {
  READINESS_MODES, DEFAULT_READINESS_MODE, filterPoolByReadiness,
  needsPlacementException, exceptionCount, isPoolEligible,
} from '../lib/placementReadiness'
import {
  notificationStateIndex, NOTIFICATION_TARGETS,
  CONFIRMED_TYPE, CORRECTED_TYPE, LEGACY_MANUAL_TYPE,
} from '../lib/placementNotificationState'
import { supabase as supabaseClient } from '../lib/supabase'
import { planUnmatch } from '../lib/unmatchPlan'
import { createPendingUnmatch, UNDO_WINDOW_MS } from '../lib/pendingUnmatch'
import { orderUnitsForStudent, groupPoolForUnit, RANK_WORD } from '../lib/placementBoardView'
import { getStudentPreferredFullName } from '../lib/studentNameFormatters'
import { TAB_TO_PATH } from '../lib/staffRoutes'
import './placement/placementBoard.css'

// PLACEMENT-BOARD-FELT-1 (2026-09-17): the board is felt, leather and paper.
// Student Pool on the left (about 40%), Unit Pool on the right (about 60%).
// Every write still goes through the same handlers as before: onMatch (App's
// createMatch) and onUnmatch (App's unmatch), behind the same dialogs. What is
// new is how a placement is made (drag a note, or select then click a board)
// and that an unmatch is HELD for UNDO_WINDOW_MS before it is written
// (src/lib/pendingUnmatch.js explains why an undo cannot be a re-placement).

// ── Placement at a Glance ─────────────────────────────────────────────────────
// Owner decision (2026-09-17): the KPI cards stand alone, no title row. The band
// is the shared .snap card with the shared .glance-kpis grid, so it matches At a
// Glance's Placement Snapshot cell for cell.

function PlacementOverview({ studentsCount, matchedCount, unmatchedCount, prefCounts, totalSlots, slotsRemaining, poolSchools }) {
  const schools = poolSchools?.length ?? 0
  // ASPIRE-CHART honest match rank: the headline claims a percentage only
  // over placements with a RECORDED rank; absent data is shown as absent,
  // never as "0% top choice".
  const recorded = prefCounts.top + prefCounts.second + prefCounts.third + prefCounts.other
  const topPct = recorded > 0 ? Math.round((prefCounts.top / recorded) * 100) : null

  const matchedSub = (() => {
    const parts = []
    if (prefCounts.top    > 0) parts.push(`${prefCounts.top} top choice`)
    if (prefCounts.second > 0) parts.push(`${prefCounts.second} 2nd choice`)
    if (prefCounts.third  > 0) parts.push(`${prefCounts.third} 3rd choice`)
    if (prefCounts.other  > 0) parts.push(`${prefCounts.other} other`)
    if (prefCounts.notRecorded > 0) parts.push(`${prefCounts.notRecorded} rank not recorded`)
    return parts.length > 0 ? parts.join(' · ') : 'Pending placement'
  })()

  return (
    <section className="snap pb-glance" aria-label="Placement at a Glance">
      <div className="glance-kpis snap-kpis">
        <KPICell value={studentsCount}  label="Students"   sub={`${schools} school${schools !== 1 ? 's' : ''}`} />
        <KPICell value={matchedCount}   label="Matched"    sub={matchedSub} accent="sage" />
        <KPICell value={unmatchedCount} label="Unmatched"  sub="Pending placement" accent={unmatchedCount > 0 ? 'warning' : null} />
        <KPICell value={slotsRemaining} label="Open Slots" sub={`of ${totalSlots} total`} />
        <KPICell
          value={topPct !== null ? `${topPct}%` : '-'}
          label="Top Choice"
          sub={topPct !== null
            ? `of ${recorded} ranked placement${recorded !== 1 ? 's' : ''}`
            : matchedCount > 0 ? 'Match rank not recorded' : 'No placements yet'}
        />
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export const getInterviewStatus = (s) => {
  if (s.auto_recommendation === 'Recommend')
    return { label: 'Recommended',     color: '#166534', bg: '#f0fdf4' }
  if (s.auto_recommendation === 'Do Not Recommend')
    return { label: 'Not Recommended', color: '#991b1b', bg: '#fef2f2' }
  if (parseFloat(s.avg_composite_score) > 0)
    return { label: 'Rubric Submitted',color: '#1e40af', bg: '#eff6ff' }
  if (s.interview_scheduled_date)
    return { label: 'Scheduled',       color: '#92400e', bg: '#fffbeb' }
  return null
}

// (MATCH_QUALITY_CONFIG removed: match-rank display now comes from the
// stored-rank config in lib/placementDisplay.js - one source, no duplicate.)

// PLACEMENT-POOL-READINESS-1: pool membership and readiness now live in
// src/lib/placementReadiness.js so they are unit-testable against every status
// and cannot drift from the createMatch guard.

export default function MatchingTab({
  students, units, matches, cohortId, cohort,
  onMatch, onUnmatch, onUpdateMatch, highlightUnitId,
  focusMatchStudentId, onFocusMatchConsumed,
  onPreceptorAssigned,
  onMatchLocalSync,
  toast,
}) {
  const queryClient = useQueryClient()
  // PLACEMENT-NOTIFICATION-CONTROL-1: correcting a recorded notification rewrites
  // what the board says about a real person, so the affordance is Owner/Admin
  // only. The endpoint enforces the same rule - this decides visibility, not
  // authority, and hiding it is not what makes it safe.
  const { userProfile: notifyActor } = useAuth()
  const canCorrectNotifications = notifyActor?.is_owner === true
    || ['owner', 'admin'].includes(notifyActor?.role)
  const [selectedStudent,   setSelectedStudent]   = useState(null)
  const cardRefs = useRef({})

  // ASPIRE-CHART interview-to-placement handoff: when Interviews routes here
  // with a student, pre-select them in the pool (the existing selection
  // mechanic; the scroll effect below brings the card into view). A student
  // who is not pool-eligible fails closed to no selection.
  useEffect(() => {
    if (!focusMatchStudentId) return
    const s = students.find(x => x.id === focusMatchStudentId)
    // Interviews only routes 'Interviewed' students here, so they are visible
    // in the default mode; anything else fails closed to no selection.
    if (s && isPoolEligible(s)) setSelectedStudent(s)
    onFocusMatchConsumed?.()
  }, [focusMatchStudentId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [poolSearch,        setPoolSearch]        = useState('')
  const [poolSchool,        setPoolSchool]        = useState('')
  const [poolSort,          setPoolSort]          = useState('last_name_asc')
  // Readiness is a FILTER, deliberately separate from the sort above.
  const [readiness,         setReadiness]         = useState(DEFAULT_READINESS_MODE)
  // Pending approved-exception placement: { student, unit } awaiting confirmation.
  const [exceptionPlacement, setExceptionPlacement] = useState(null)

  // PLACEMENT-POOL-READINESS-1: a cohort switch returns the pool to the safe
  // default. The broader exception view is a deliberate, per-cohort choice and
  // must never silently persist into a different cohort's placement work; any
  // half-finished exception confirmation is dropped with it.
  //
  // Adjusted during render (React's documented pattern for resetting state when
  // a prop changes) rather than in an effect, so the pool never paints one
  // frame of the previous cohort's mode.
  const [readinessCohort, setReadinessCohort] = useState(cohortId)
  if (cohortId !== readinessCohort) {
    setReadinessCohort(cohortId)
    setReadiness(DEFAULT_READINESS_MODE)
    setExceptionPlacement(null)
  }
  const [divFilter,         setDivFilter]         = useState('')
  const [sortMode,          setSortMode]          = useState('alpha')
  const [fadingStudentIds,  setFadingStudentIds]  = useState(new Set())
  const [fadeInStudentIds,  setFadeInStudentIds]  = useState(new Set())
  // Focused unit drives Student Pool tier-sort without affecting placement logic
  const [focusedUnit,       setFocusedUnit]       = useState(null)


  const participating   = units.filter(u => u.is_participating)
  const totalSlots      = participating.reduce((s, u) => s + (u.total_slots || 0), 0)
  // ASPIRE-CHART one capacity source: live match count vs configured totals,
  // the same calculation the placement guard uses. The stored slots_remaining
  // field is no longer a display source (its write path is unchanged).
  const slotsRemaining  = totalOpenSlots(participating, matches)
  const unitsWithOpen   = participating.filter(u => (unitOpenSlots(u, matches) ?? 0) > 0).length
  // AVAILABILITY-CANON-1D: read-only coordinator availability for the readiness badge.
  // Only the fields the badge/readiness helper needs; mapped by rotation id and passed to each
  // StudentMatchingCard. Skips safely when there is no cohort. No writes.
  //
  // PLACEMENT-COMMUNICATION-HANDOFF-1 additionally selects school_name and the
  // coordinator-owned rotation_start_date / rotation_end_date. These are the
  // AUTHORITATIVE placement window (see src/lib/placementCommunication.js for the
  // full source audit); the unit-leader notice used to quote the retired free-text
  // students.term_dates instead, which is the term-date defect this closes.
  const { data: rotationRows = [] } = useQuery({
    queryKey: ['cohort_rotation_avail', cohortId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cohort_school_rotations')
        .select('id, school_name, rotation_start_date, rotation_end_date, unavailable_weekdays, min_days_per_week, weekends_allowed, nights_allowed, blackout_dates')
        .eq('cohort_id', cohortId)
      if (error) throw error
      return data || []
    },
    enabled: !!cohortId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const rotationById = useMemo(() => {
    const m = {}
    for (const r of rotationRows) m[r.id] = r
    return m
  }, [rotationRows])

  // Read-only preceptor roster (global, not cohort-scoped; RLS authenticated read).
  // Supplies the canonical NAME, EMAIL and SHIFT for whichever preceptor a
  // placement row resolves to - the board itself only carries projected free text.
  const { data: preceptorRows = [] } = useQuery({
    queryKey: ['placement_preceptor_directory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('preceptors')
        .select('id, full_name, email, shift_type, unit_name, is_active')
      if (error) throw error
      return data || []
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const preceptorsById = useMemo(() => {
    const m = new Map()
    for (const p of preceptorRows) if (p?.id) m.set(String(p.id), p)
    return m
  }, [preceptorRows])

  // PLACEMENT-NOTIFICATION-CONTROL-1: the human-confirmation ledger.
  //
  // NOT provider delivery history. Every row here exists because a member of
  // staff confirmed, in a dialog, that a unit leader or a preceptor was notified
  // about one specific placement - or corrected such a confirmation, with a
  // stated reason. Delivery history keeps its own rows and never lands here, so
  // an email that was sent, edited, misaddressed or bounced cannot quietly
  // become a claim that somebody was notified.
  //
  // Read-only, under notification_log's existing owners_admins_read policy, and
  // scoped to the open cohort. No schema change: the endpoint stamps the
  // placement identity into the metadata jsonb this filters on.
  const { data: notificationRows = [] } = useQuery({
    queryKey: ['placement_notification_state', cohortId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_log')
        .select('id, notification_type, status, sent_at, created_at, metadata')
        .in('notification_type', [CONFIRMED_TYPE, CORRECTED_TYPE, LEGACY_MANUAL_TYPE])
        .eq('metadata->>placement_cohort_id', cohortId)
        .order('sent_at', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: !!cohortId,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
  const notificationIndex = useMemo(() => notificationStateIndex(notificationRows), [notificationRows])

  // ── PLACEMENT-NOTIFICATION-CONTROL-1: the two writers ─────────────────────
  //
  // One path in, for both targets and both directions. Every call is a person
  // acting on a dialog they have just read; nothing here can be triggered by
  // opening, sending, or abandoning an email. The server re-proves the whole
  // placement before recording, so a stale tab or a replaced preceptor is
  // refused rather than mis-recorded - and on any failure the board keeps
  // saying exactly what it said before.
  const writeNotification = async ({ target, action, student, match, placement, reason }) => {
    if (!match?.id || !student?.id) throw new Error('This placement is incomplete. Reopen it from the Placement Board.')
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session?.access_token) throw new Error('Your session has expired. Please refresh and try again.')
    const res = await fetch('/api/placement-notification-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        target,
        action,
        match_id: match.id,
        student_id: student.id,
        unit_id: match.unit_id,
        cohort_id: cohortId,
        ...(target === 'preceptor' ? { preceptor_id: placement?.preceptorId || '' } : {}),
        ...(reason ? { reason } : {}),
      }),
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Nothing was recorded. Please try again.')
    // The ledger is the single source for the board AND for the Action Center's
    // outstanding-task predicate, so both refresh from this one signal.
    queryClient.invalidateQueries({ queryKey: ['placement_notification_state'] })
    // matches live in App state, not in a query. The server has already written
    // the projection; this only stops the Action Center's task and the board's
    // counters disagreeing until the next full load.
    if (target === NOTIFICATION_TARGETS.UNIT_LEADER) {
      onMatchLocalSync?.(match.id, action === 'confirm'
        ? { notification_sent: true, notified_at: new Date().toISOString() }
        : { notification_sent: false, notified_at: null })
    }
    return payload
  }

  const studentNameOf = (s) => getStudentPreferredFullName(s) || 'this student'

  const handleConfirmNotified = async (args) => {
    try {
      const r = await writeNotification({ ...args, action: 'confirm' })
      toast?.success?.('Recorded', r?.already
        ? 'This was already recorded as notified.'
        : 'Marked as notified.')
    } catch (e) {
      toast?.error?.('Not recorded', e.message || 'Nothing was changed. You can try again.')
      throw e
    }
  }

  // UNIT-POOL-REFINEMENT-1: the batch writer behind the consolidated unit-leader
  // confirmation. The SAME writeNotification per placement - same endpoint, same
  // server re-proof, same idempotency-by-effect - just N of them with ONE
  // summary instead of N toasts. Sequential, never atomic (the endpoint is
  // per-match), so the summary is honest: ok lists what was recorded, failed
  // names each placement that was not, with the server's reason. A retry posts
  // the same set; already-recorded placements answer already:true and are
  // counted as ok without a second row.
  const handleBatchConfirmNotified = async (rows) => {
    const ok = []
    const failed = []
    for (const { student, match } of rows) {
      try {
        await writeNotification({
          target: NOTIFICATION_TARGETS.UNIT_LEADER, action: 'confirm', student, match,
        })
        ok.push(studentNameOf(student))
      } catch (e) {
        failed.push({ name: studentNameOf(student), reason: e.message || 'Nothing was recorded.' })
      }
    }
    if (failed.length === 0) {
      toast?.success?.('Recorded', ok.length === 1
        ? 'The placement is marked as unit-leader notified.'
        : `All ${ok.length} placements are marked as unit-leader notified.`)
    } else if (ok.length === 0) {
      toast?.error?.('Not recorded', `No placement could be recorded. ${failed[0].reason}`)
    } else {
      toast?.error?.('Partially recorded',
        `${ok.length} of ${rows.length} placements were recorded. Not recorded: ${failed.map(f => f.name).join(', ')}.`)
    }
    return { ok, failed }
  }

  const handleCorrectNotified = async (args) => {
    try {
      await writeNotification({ ...args, action: 'correct' })
      toast?.success?.('Correction recorded', 'The original confirmation is kept as history.')
    } catch (e) {
      toast?.error?.('Not corrected', e.message || 'Nothing was changed. You can try again.')
      throw e
    }
  }


  // Active unit leaders, for the ONE thing the placement notice needs from them:
  // a reliable greeting name (preferred_name first). Recipient addressing is
  // unchanged - the notice still bccs units.contact_email.
  const { data: unitLeaderRows = [] } = useQuery({
    queryKey: ['placement_unit_leaders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unit_leaders')
        .select('unit_name, full_name, preferred_name, email, is_primary_lead, is_active')
        .eq('is_active', true)
      if (error) throw error
      return data || []
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const matchedStudents = students.filter(s =>  s.matched_unit_id)
  // PLACEMENT-POOL-READINESS-1: 'Ready to place' (the default) is exactly the
  // set createMatch accepts; 'All eligible students' restores the previous
  // contents for approved pre-interview exceptions. Neither mode can include a
  // Not Proceeding, Placed, Active Rotation, Completed, or Declined student.
  const unmatchedAll    = filterPoolByReadiness(students, readiness)
  const eligibleAll     = students.filter(isPoolEligible)
  const hiddenExceptions = readiness === 'ready' ? exceptionCount(students) : 0
  const poolSchools     = [...new Set(students.map(s => s.school).filter(Boolean))].sort()

  // ASPIRE-CHART: counts come from STORED match ranks (shared module), never
  // from unit-name comparison - renaming a unit no longer rewrites history.
  const prefCounts = derivePrefCounts(matchedStudents, matches)

  const { userProfile } = useAuth()
  const canMatch = canPerformMatching(userProfile)
  const navigate = useNavigate()

  // ── PLACEMENT-BOARD-FELT-1: the Undo window, the latest props, announcements ──
  //
  // `latest` always holds the props from the most recent commit. Handlers that
  // await (commit a held unmatch, then place) read it AFTER the await, so they
  // act on the placements as they now are, not as they were when clicked.
  const latest = useRef({ students, units, matches, onMatch, onUnmatch, toast })
  useLayoutEffect(() => {
    latest.current = { students, units, matches, onMatch, onUnmatch, toast }
  })
  const commitWaiters = useRef([])
  const [, setRenderTick] = useState(0)
  useEffect(() => {
    if (!commitWaiters.current.length) return
    const waiting = commitWaiters.current.splice(0)
    waiting.forEach(resolve => resolve())
  })
  const afterNextCommit = () => new Promise(resolve => {
    commitWaiters.current.push(resolve)
    setRenderTick(n => n + 1)
  })

  const [pending, setPending] = useState(null)
  const [scheduler] = useState(() => createPendingUnmatch({ onChange: next => setPending(next) }))
  const undoToastId = useRef(null)

  // A held unmatch is written before the board does anything else, and never
  // carried into another cohort or left behind when the board unmounts: the
  // captured handler still names the cohort and placement it was confirmed for.
  const flushPending = async () => {
    const flushed = await scheduler.flush()
    if (flushed) await afterNextCommit()
    return flushed
  }
  useEffect(() => () => { scheduler.flush() }, [cohortId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if ((!pending || pending.phase === 'committing') && undoToastId.current != null) {
      latest.current.toast?.dismiss?.(undoToastId.current)
      undoToastId.current = null
    }
  }, [pending])

  const [announcement, setAnnouncement] = useState('')
  const announce = (message) => {
    setAnnouncement('')
    requestAnimationFrame(() => setAnnouncement(message))
  }

  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [pullingMatchId, setPullingMatchId] = useState(null)
  const [pinningStudentIds, setPinningStudentIds] = useState(new Set())

  // What the BOARD shows while an unmatch is held: that placement is gone from
  // its board, and (when the student leaves placed state) the student is back
  // in the pool, inert until the write lands. Nothing else reads this list; the
  // KPIs and every write keep reading `matches`, which is what is stored.
  const heldMatchId = pending?.matchId || null
  const boardMatches = heldMatchId ? matches.filter(m => m.id !== heldMatchId) : matches
  const returningStudentId = pending?.planKind === 'final' ? pending.studentId : null

  // Filter + sort units
  let displayUnits = [...participating]
  if (divFilter) {
    displayUnits = displayUnits.filter(u =>
      (u.division || UNIT_DIVISION_MAP[u.unit_name] || 'Medical') === divFilter
    )
  }
  if (sortMode === 'alpha') {
    displayUnits.sort((a, b) => a.unit_name.localeCompare(b.unit_name))
  } else if (sortMode === 'division') {
    displayUnits.sort((a, b) => {
      const da = a.division || UNIT_DIVISION_MAP[a.unit_name] || 'Medical'
      const db = b.division || UNIT_DIVISION_MAP[b.unit_name] || 'Medical'
      return da.localeCompare(db) || a.unit_name.localeCompare(b.unit_name)
    })
  } else if (sortMode === 'most-available') {
    displayUnits.sort((a, b) => (unitOpenSlots(b, matches) ?? 0) - (unitOpenSlots(a, matches) ?? 0))
  }

  // Pool: include fading-out students temporarily for exit animation, and a
  // student whose unmatch is held (shown, not actionable).
  const poolIds = new Set()
  const poolBase = [
    ...unmatchedAll,
    ...students.filter(s => fadingStudentIds.has(s.id) && s.matched_unit_id),
    ...students.filter(s => s.id === returningStudentId),
  ].filter(s => (poolIds.has(s.id) ? false : poolIds.add(s.id)))
  const filteredPool = poolBase.filter(s => {
    if (fadingStudentIds.has(s.id)) return true // always show during exit animation
    if (poolSearch && !`${s.first_name||''} ${s.preferred_first_name||''} ${s.last_name||''} ${s.name||''}`.toLowerCase().includes(poolSearch.toLowerCase())) return false
    if (poolSchool && s.school !== poolSchool) return false
    return true
  })

  // Choice tier for the currently focused unit (1–3 = preference rank, 4 = not picked)
  const tierOf = (student) => {
    if (!focusedUnit) return 4
    if (student.unit_preference_1 === focusedUnit.unit_name) return 1
    if (student.unit_preference_2 === focusedUnit.unit_name) return 2
    if (student.unit_preference_3 === focusedUnit.unit_name) return 3
    return 4
  }

  // Baseline sort (existing logic, unchanged)
  const baselinePool = [...filteredPool].sort((a, b) => {
    // Fading students stay sorted normally (they vanish in <300ms anyway)
    const la = (a.last_name || a.name || '').toLowerCase()
    const lb = (b.last_name || b.name || '').toLowerCase()
    switch (poolSort) {
      case 'last_name_desc': return lb.localeCompare(la)
      case 'school_asc':     return (a.school||'').localeCompare(b.school||'') || la.localeCompare(lb)
      case 'gpa_desc': {
        const ga = parseFloat(a.cumulative_gpa)||0, gb = parseFloat(b.cumulative_gpa)||0
        return gb - ga || la.localeCompare(lb)
      }
      case 'score_desc': {
        const sa = parseFloat(a.avg_composite_score)||0, sb = parseFloat(b.avg_composite_score)||0
        return sb - sa || la.localeCompare(lb)
      }
      case 'status': {
        const ia = ASPIRE_STATUS_SORT_ORDER.indexOf(a.status)
        const ib = ASPIRE_STATUS_SORT_ORDER.indexOf(b.status)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || la.localeCompare(lb)
      }
      default: return la.localeCompare(lb) // last_name_asc
    }
  })

  // When a unit is focused, stable-sort by tier on top of the baseline
  // (tier first, then baseline index preserves the existing sort within each tier)
  const sortedPool = focusedUnit
    ? baselinePool
        .map((s, i) => ({ s, tier: tierOf(s), i }))
        .sort((a, b) => a.tier - b.tier || a.i - b.i)
        .map(({ s }) => s)
    : baselinePool

  // Groups for a focused unit: picked it 1st, picked it 2nd or 3rd, everyone else
  // (dimmed). The sort above already ranks them; grouping only adds the labels.
  const poolGroups = groupPoolForUnit(sortedPool, focusedUnit)

  const selectedIndex = sortedPool.findIndex(s => s.id === selectedStudent?.id)

  useEffect(() => {
    if (selectedStudent?.id && cardRefs.current[selectedStudent.id]) {
      cardRefs.current[selectedStudent.id].scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block:'nearest' })
    }
  }, [selectedStudent?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStudentSelect = s => {
    if (s.id === returningStudentId) return
    const next = selectedStudent?.id === s.id ? null : s
    setSelectedStudent(next)
    if (!next) { announce('Selection cleared.'); return }
    const picks = [1, 2, 3]
      .map(r => next[`unit_preference_${r}`] ? `${RANK_WORD[r]} ${next[`unit_preference_${r}`]}` : null)
      .filter(Boolean)
    announce(`${getStudentPreferredFullName(next)} selected.${picks.length ? ` Top choices: ${picks.join(', ')}. Their boards are listed first.` : ''}`)
  }

  const handlePrevStudent = () => {
    if (selectedIndex > 0) handleStudentSelect(sortedPool[selectedIndex - 1])
  }
  const handleNextStudent = () => {
    if (selectedIndex < sortedPool.length - 1) handleStudentSelect(sortedPool[selectedIndex + 1])
  }

  const handleUnitFocus = (unit) => {
    const next = focusedUnit?.id === unit.id ? null : unit
    setFocusedUnit(next)
    if (!next) { announce('Showing every student.'); return }
    const first = sortedPool.filter(s => s.unit_preference_1 === unit.unit_name).length
    const lower = sortedPool.filter(s => s.unit_preference_2 === unit.unit_name || s.unit_preference_3 === unit.unit_name).length
    announce(`Showing students for ${unit.unit_name}: ${first} picked it 1st, ${lower} picked it 2nd or 3rd.`)
  }

  // A student selection reorders the boards: their 1st, 2nd and 3rd choice
  // boards first, ribboned; every other board keeps its order and dims.
  const { ordered: orderedUnits, highlights } = orderUnitsForStudent(displayUnits, selectedStudent)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (selectedStudent) { setSelectedStudent(null); announce('Selection cleared.') }
        else if (focusedUnit) { setFocusedUnit(null); announce('Showing every student.') }
        return
      }
      if (!selectedStudent) return
      // Arrow keys step through the pool, but never steal them from a field.
      if (e.target?.closest?.('input, select, textarea')) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (selectedIndex < sortedPool.length - 1) handleStudentSelect(sortedPool[selectedIndex + 1])
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        if (selectedIndex > 0) handleStudentSelect(sortedPool[selectedIndex - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedStudent?.id, focusedUnit?.id, selectedIndex, sortedPool]) // eslint-disable-line

  // The single placement commit path, shared by the normal and exception flows.
  const commitPlacement = (student, unit, isException) => {
    const id = student.id
    // Start exit animation
    setFadingStudentIds(prev => new Set([...prev, id]))
    setTimeout(() => {
      setFadingStudentIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }, 280)
    // The note drops onto its board when the placement lands.
    setPinningStudentIds(prev => new Set([...prev, id]))
    const placed = latest.current.onMatch(student, unit, { placementException: isException })
    Promise.resolve(placed).finally(() => {
      setTimeout(() => setPinningStudentIds(prev => { const n = new Set(prev); n.delete(id); return n }), 800)
    })
    setSelectedStudent(null)
    announce(`Placing ${getStudentPreferredFullName(student)} on ${unit.unit_name}.`)
  }

  // Every way of placing arrives here: click a board, Enter on a board, or a
  // drop. A held unmatch is written first, then the guard reads live counts.
  const requestPlacement = async (student, unit) => {
    if (!student || !canMatch) return
    await flushPending()
    const live = latest.current
    student = live.students.find(s => s.id === student.id) || student
    unit = live.units.find(u => u.id === unit.id) || unit
    // Use actual match count as the canonical capacity check so the guard
    // stays in sync with the EmbedUnitCard display (which also uses match count,
    // not the slots_remaining field). slots_remaining can drift if it was
    // initialised incorrectly or not updated atomically.
    const unitMatchCount = live.matches.filter(m => m.unit_id === unit.id).length
    if (unitMatchCount >= unit.total_slots) {
      live.toast?.warning?.(`${unit.unit_name} is full.`, 'Pull a pin to free a slot.')
      announce(`${unit.unit_name} is full. Pull a pin to free a slot.`)
      return
    }
    // PLACEMENT-POOL-READINESS-1: placing a student who has not been
    // interviewed is an approved EXCEPTION, never a routine action. Ask first;
    // commitPlacement runs only after an explicit confirmation.
    if (needsPlacementException(student)) {
      setExceptionPlacement({ student, unit })
      return
    }
    commitPlacement(student, unit, false)
  }

  const handleSlotClick = unit => requestPlacement(selectedStudent, unit)

  const handleBoardActivate = unit => {
    if (selectedStudent) { handleSlotClick(unit); return }
    handleUnitFocus(unit)
  }

  // Called by a board's unmatch dialog after "Unmatch Student". The pull is
  // animated, then HELD: the write happens when the Undo window closes.
  const handleUnmatch = async (student, unit) => {
    if (!canMatch) return
    await flushPending()
    const live = latest.current
    const match = live.matches.find(m => m.student_id === student.id && m.unit_id === unit.id)
    if (!match) return
    const plan = planUnmatch({ student, match, matches: live.matches })
    const name = getStudentPreferredFullName(student)

    setPullingMatchId(match.id)
    if (!reducedMotion) await new Promise(resolve => setTimeout(resolve, 300))
    setPullingMatchId(null)

    const commitUnmatch = live.onUnmatch
    scheduler.hold(
      { matchId: match.id, studentId: student.id, unitId: unit.id, planKind: plan.kind, name, unitName: unit.unit_name },
      () => commitUnmatch(student, unit),
    )
    if (plan.kind === 'final') {
      // Fade-in when student returns to pool
      const id = student.id
      setFadeInStudentIds(prev => new Set([...prev, id]))
      setTimeout(() => {
        setFadeInStudentIds(prev => { const n = new Set(prev); n.delete(id); return n })
      }, 450)
    }
    const title = plan.kind === 'final'
      ? `${name} returned to the Student Pool.`
      : `${name} removed from ${unit.unit_name}.`
    const message = plan.kind === 'final' ? null : 'Their other placement is unchanged.'
    undoToastId.current = live.toast?.info?.(title, message, {
      duration: UNDO_WINDOW_MS,
      action: { label: 'Undo', onClick: handleUndo },
    }) ?? null
    announce(`${title} Undo is available for ${UNDO_WINDOW_MS / 1000} seconds.`)
  }

  const handleUndo = () => {
    const held = scheduler.current()
    if (scheduler.undo()) announce(`Undone. ${held.name} stays on ${held.unitName}.`)
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────
  // A pool note dropped on a board places (same path as click). A pinned note
  // dropped on the Student Pool opens that board's unmatch dialog (same path as
  // the pin). Touch and keyboard use select-then-board instead.
  const dragRef = useRef(null)
  const [dragKind, setDragKind] = useState(null)
  const [dropUnitId, setDropUnitId] = useState(null)
  const [poolDropActive, setPoolDropActive] = useState(false)
  const [pullRequest, setPullRequest] = useState(null)

  const startDrag = (e, payload) => {
    dragRef.current = payload
    setDragKind(payload.kind)
    try {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', payload.name)
    } catch { /* some browsers restrict dataTransfer; the ref carries the payload */ }
  }
  const endDrag = () => {
    dragRef.current = null
    setDragKind(null)
    setDropUnitId(null)
    setPoolDropActive(false)
  }
  const handlePoolNoteDragStart = (e, student) => startDrag(e, {
    kind: 'pool', studentId: student.id, name: getStudentPreferredFullName(student),
  })
  const handlePinnedNoteDragStart = (e, student, match, unit) => {
    e.stopPropagation()
    startDrag(e, {
      kind: 'board', studentId: student.id, unitId: unit.id, matchId: match?.id || null,
      name: getStudentPreferredFullName(student),
    })
  }
  const boardDragHandlers = (unit) => ({
    onBoardDragOver: (e) => {
      if (dragRef.current?.kind !== 'pool') return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropUnitId(unit.id)
    },
    onBoardDragLeave: (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return
      setDropUnitId(prev => (prev === unit.id ? null : prev))
    },
    onBoardDrop: (e) => {
      const drag = dragRef.current
      if (drag?.kind !== 'pool') return
      e.preventDefault()
      endDrag()
      const student = latest.current.students.find(s => s.id === drag.studentId)
      if (student) requestPlacement(student, unit)
    },
  })
  const poolDropHandlers = {
    onDragOver: (e) => {
      if (dragRef.current?.kind !== 'board') return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setPoolDropActive(true)
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return
      setPoolDropActive(false)
    },
    onDrop: (e) => {
      const drag = dragRef.current
      if (drag?.kind !== 'board') return
      e.preventDefault()
      endDrag()
      setPullRequest({ studentId: drag.studentId, unitId: drag.unitId })
    },
  }

  // Clicking empty space (not a note, board, control or dialog) clears the
  // selection and the unit focus.
  const handleEmptySpaceClick = (e) => {
    if (!e.currentTarget.contains(e.target)) return
    if (e.target.closest('button, a, input, select, textarea, label, [role="button"], [data-pb-board], [data-pb-note], [role="dialog"], .modal-overlay')) return
    if (selectedStudent) { setSelectedStudent(null); announce('Selection cleared.') }
    if (focusedUnit) setFocusedUnit(null)
  }

  const exportCSV = () => {
    const headers = ['Student Name','School','School Email','Personal Email','Phone','Matched Unit','Match Quality','Preceptor Assigned','Shift Assigned','Unit Contact','Notes']
    const rows = matchedStudents.map(s => {
      const unit  = units.find(u => u.id === s.matched_unit_id)
      const match = matches.find(m => m.student_id === s.id)
      return [s.name, s.school, s.school_email, s.personal_email, s.phone,
        unit?.unit_name || '', match?.match_quality || s.match_quality || '',
        match?.preceptor_assigned || '', match?.shift_assigned || '',
        unit?.contact_person || '', match?.notes || '']
    })
    const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download=`aspire-matches-${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const studentMap = (() => {
    const map = {}
    ;(students || []).forEach(s => { map[s.id] = s })
    return map
  })()

  // Unit names for the branched unmatch dialog (naming the successor placement).
  const unitNameById = (() => {
    const map = {}
    ;(units || []).forEach(u => { map[u.id] = u.unit_name })
    return map
  })()

  const studentsCount  = students.length
  const matchedCount   = matchedStudents.length
  const unmatchedCount = unmatchedAll.length

  const renderPoolNote = (s) => (
    <div key={s.id} ref={el => { cardRefs.current[s.id] = el }} className="pb-note-slot">
      <StudentMatchingCard
        student={s}
        /* PLACEMENT-POOL-READINESS-1: in the broader mode a
           student who has not been interviewed is labelled, so
           an exception is never made by accident. */
        needsException={needsPlacementException(s)}
        isSelected={selectedStudent?.id === s.id}
        onSelect={handleStudentSelect}
        isReadOnly={!canMatch}
        isPending={s.id === returningStudentId}
        isFading={fadingStudentIds.has(s.id)}
        isFadingIn={fadeInStudentIds.has(s.id)}
        units={participating}
        matches={boardMatches}
        focusedUnit={focusedUnit}
        rotation={rotationById[s.cohort_school_rotation_id]}
        onDragStart={canMatch ? handlePoolNoteDragStart : undefined}
        onDragEnd={endDrag}
      />
    </div>
  )

  return (
    <div className="matching-tab embed-tab pb-tab" style={{ position: 'relative' }}>

      {/* Access overlay for non-matching roles - sits above everything (shared with Evaluation). */}
      {!canMatch && (
        <RestrictedAccessOverlay
          title="Placement decisions are made by the program leads."
          body="If you have a unit recommendation for a student, please include it in the interview rubric notes section. The program leads will review your recommendation during the matching process."
        />
      )}

      <PlacementOverview
        studentsCount={studentsCount}
        matchedCount={matchedCount}
        unmatchedCount={unmatchedCount}
        prefCounts={prefCounts}
        totalSlots={totalSlots}
        slotsRemaining={slotsRemaining}
        poolSchools={poolSchools}
      />

      {/* Screen-reader announcements for selections, placements and unmatches. */}
      <div className="sr-only" role="status" aria-live="polite" data-testid="board-announcer">{announcement}</div>

      {/* ── The board: Student Pool left, Unit Pool right ── */}
      <div className={`pb-board${dragKind ? ` pb-dragging-${dragKind}` : ''}`} onClick={handleEmptySpaceClick}>

          {/* Left: Student pool */}
          <section
            className={`pb-pool pb-pool-students${poolDropActive ? ' pb-pool-drop' : ''}`}
            aria-label="Student Pool"
            {...poolDropHandlers}
          >
            <header className="material-leather-navy pb-pool-hdr">
              <h2 className="pb-pool-title">Student Pool</h2>
              <input
                className="pb-search"
                value={poolSearch}
                onChange={e => setPoolSearch(e.target.value)}
                placeholder="Search…"
                aria-label="Search students"
              />
              <select value={poolSchool} onChange={e => setPoolSchool(e.target.value)} className="pb-select" aria-label="School">
                <option value="">All Schools</option>
                {poolSchools.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <Tooltip label="Which students to show" placement="bottom">
              <select
                value={readiness}
                onChange={e => setReadiness(e.target.value)}
                className="pb-select"
                aria-label="Placement readiness"
                data-testid="pool-readiness"
              >
                {READINESS_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              </Tooltip>
              <Tooltip label="Sort students" placement="bottom">
              <select value={poolSort} onChange={e => setPoolSort(e.target.value)} className="pb-select" aria-label="Sort students">
                <option value="last_name_asc">Last Name A–Z</option>
                <option value="last_name_desc">Last Name Z–A</option>
                <option value="school_asc">School A–Z</option>
                <option value="gpa_desc">GPA High–Low</option>
                <option value="score_desc">Score High–Low</option>
                <option value="status">ASPIRE Status</option>
              </select>
              </Tooltip>
              <span className="pb-hdr-spacer" />
              <span className="pb-count material-soft">
                {selectedStudent
                  ? `${selectedIndex + 1} of ${sortedPool.length}`
                  : `${sortedPool.length} student${sortedPool.length !== 1 ? 's' : ''}`}
                {!selectedStudent && hiddenExceptions > 0 && (
                  <span data-testid="pool-hidden-note" className="pb-hidden-note">
                    · {hiddenExceptions} not yet interviewed
                  </span>
                )}
              </span>
              <StatusLegendPopover position="bottom-right" dark />
              {sortedPool.length > 0 && (
                <div className="pb-stepper">
                  <Tooltip label="Previous student" placement="top">
                  <button type="button" className="pb-step material-inlay" onClick={handlePrevStudent} disabled={!selectedStudent || selectedIndex <= 0} aria-label="Previous student">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  </Tooltip>
                  <Tooltip label="Next student" placement="top">
                  <button type="button" className="pb-step material-inlay" onClick={handleNextStudent} disabled={!selectedStudent || selectedIndex >= sortedPool.length - 1} aria-label="Next student">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                  </Tooltip>
                  {selectedStudent && <span className="pb-keys material-soft">↑↓·Esc</span>}
                </div>
              )}
            </header>

            <div className="pb-helper">
              <Info size={14} aria-hidden="true" />
              <span>Click a student to see their top 3 units. Drag a note onto a board, or click a student and then a board.</span>
            </div>

            <div className="material-leather-cream pb-pool-body">
              {focusedUnit && (
                <div className="pb-banner" data-testid="pool-unit-banner">
                  <span>Showing students for <strong>{focusedUnit.unit_name}</strong></span>
                  <button type="button" className="pb-banner-clear" onClick={() => { setFocusedUnit(null); announce('Showing every student.') }}>
                    Clear
                  </button>
                </div>
              )}

              {filteredPool.length === 0 ? (
                /* "All students matched" must mean genuinely NOBODY is left to
                   place - measured against every eligible student, not just the
                   ones the current readiness mode shows. */
                eligibleAll.length === 0
                  ? (
                    <div className="pb-empty" data-testid="pool-all-placed">
                      <div className="pb-pinned pb-tilt-a">
                        <span className="pb-pin-anchor">
                          <span className="material-pin material-rank-first pb-pin pb-pin-static" aria-hidden="true">✓</span>
                        </span>
                        <div className="paper-note pb-note pb-empty-note">
                          <div className="pb-empty-title">All students placed.</div>
                          <p className="pb-empty-text material-soft">Pull a pin on any board to return a student here.</p>
                          <button type="button" className="pb-link" onClick={() => navigate(TAB_TO_PATH.profiles)}>
                            Review placements in Student Profiles
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                  : (
                    <div className="paper-note pb-note pb-empty-note">
                      <EmptyState icon={<Users />}
                        heading={readiness === 'ready' ? 'No students ready to place' : 'No students match this search'}
                        subtext={readiness === 'ready'
                          ? (hiddenExceptions > 0
                              ? `Students appear here after completing their interview. ${hiddenExceptions} eligible student${hiddenExceptions !== 1 ? 's have' : ' has'} not been interviewed yet - switch to "All eligible students" to place one as an approved exception.`
                              : 'Students appear here after completing their interview and being recommended for placement.')
                          : 'No eligible students match the current search or school filter.'} />
                    </div>
                  )
              ) : (
                poolGroups.map(group => (
                  <div key={group.key} className={`pb-group${group.dimmed ? ' pb-group-dimmed' : ''}`}>
                    {group.label && (
                      <div className="material-cream-label pb-group-label" data-testid={`pool-group-${group.key}`}>
                        {group.label} · {group.students.length}
                      </div>
                    )}
                    <div className="pb-note-list">
                      {group.students.map(renderPoolNote)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Right: Units panel */}
          <section className="pb-pool pb-pool-units" aria-label="Unit Pool">
            <header className="material-leather-navy pb-pool-hdr">
              <h2 className="pb-pool-title">Unit Pool</h2>
              <select value={divFilter} onChange={e => setDivFilter(e.target.value)} className="pb-select" aria-label="Division">
                <option value="">All Divisions</option>
                <option value="Surgical">Surgical</option>
                <option value="Medical">Medical</option>
                <option value="Critical Care">Critical Care</option>
                <option value="Specialty">Specialty</option>
              </select>
              <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="pb-select" aria-label="Sort units">
                <option value="alpha">A–Z</option>
                <option value="division">By Division</option>
                <option value="most-available">Most Available</option>
              </select>
              {(selectedStudent || focusedUnit) && (
                <span className="pb-hdr-hint material-soft">
                  {selectedStudent ? 'Reordered by preference' : `By preference for ${focusedUnit?.unit_name}`}
                </span>
              )}
              <span className="pb-hdr-spacer" />
              {/* UNIT-POOL-REFINEMENT-1: unit setup left this surface. The board
                  is where placements are worked, not where hosting units are
                  configured - Set Up Units now lives beside the hosting
                  decisions it belongs to, in At a Glance → Placement Capacity. */}
              <button type="button" className="pb-btn material-inlay" onClick={exportCSV}>↓ Export CSV</button>
            </header>

            <div className="pb-legend" aria-label="Pin colours show the match rank">
              <span><i className="pb-dot material-rank-first" aria-hidden="true" />1st choice</span>
              <span><i className="pb-dot material-rank-second" aria-hidden="true" />2nd choice</span>
              <span><i className="pb-dot material-rank-third" aria-hidden="true" />3rd choice</span>
              <span><i className="pb-dot material-rank-other" aria-hidden="true" />Other</span>
            </div>
            <div className="pb-helper">
              <Info size={14} aria-hidden="true" />
              <span>Click a unit to surface students who picked it as their top choice, ranked by preference.</span>
            </div>

            <div className="pb-units-body">
              {participating.length === 0 ? (
                <EmptyState icon={<MapPin />}
                  heading="No units in the pool"
                  subtext="Add participating units and their slots from At a Glance → Placement Capacity → Set Up Units." />
              ) : (
                <div className="pb-unit-grid">
                  {orderedUnits.map(unit => (
                    <EmbedUnitCard
                      key={unit.id}
                      unit={unit}
                      matchedStudents={studentsMatchedToUnit(unit, boardMatches, studentMap, cohortId)}
                      onPreceptorAssigned={onPreceptorAssigned}
                      matches={boardMatches}
                      studentMap={studentMap}
                      unitNameById={unitNameById}
                      rotationRows={rotationRows}
                      preceptorsById={preceptorsById}
                      unitLeaders={unitLeaderRows}
                      notificationIndex={notificationIndex}
                      canCorrectNotifications={canCorrectNotifications}
                      onConfirmNotified={handleConfirmNotified}
                      onCorrectNotified={handleCorrectNotified}
                      onBatchConfirmNotified={handleBatchConfirmNotified}
                      cohortId={cohortId}
                      cohortName={cohort?.name || ''}
                      selectedStudent={selectedStudent}
                      onActivate={() => handleBoardActivate(unit)}
                      highlightRank={highlights.get(unit.id) || null}
                      isDimmed={!!selectedStudent && !highlights.has(unit.id)}
                      isDropTarget={dropUnitId === unit.id}
                      canDrag={canMatch}
                      onNoteDragStart={handlePinnedNoteDragStart}
                      onNoteDragEnd={endDrag}
                      {...boardDragHandlers(unit)}
                      pullingMatchId={pullingMatchId}
                      pinningStudentIds={pinningStudentIds}
                      pullRequest={pullRequest}
                      onPullRequestConsumed={() => setPullRequest(null)}
                      onUnmatch={student => handleUnmatch(student, unit)}
                      onUpdateMatch={onUpdateMatch}
                      isHighlighted={highlightUnitId === unit.id}
                      isFocusedUnit={focusedUnit?.id === unit.id}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

      </div>{/* end matching board */}


      {/* PRECEPTOR-DRAFT-CONTINUITY-1's post-draft prompt is GONE.
          It asked "were you able to send it?" after a draft was opened, which
          tied a confirmation to the act of opening a draft and could only ever
          ask about the preceptor. Both targets now confirm the same way, from
          the row itself, whenever staff actually know: see NotificationControl. */}
      {/* PLACEMENT-POOL-READINESS-1: approved pre-interview placement exception.
          Nothing is written until this is explicitly confirmed. */}
      {exceptionPlacement && (
        <div className="modal-overlay" onMouseDown={() => setExceptionPlacement(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div role="dialog" aria-modal="true" aria-label="Confirm placement exception"
            data-testid="placement-exception-dialog"
            onMouseDown={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, maxWidth: 520, width: '92vw', padding: 20,
              fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, color: '#1D2567' }}>
              Placement exception: not yet interviewed
            </h3>
            <p style={{ fontSize: 13.5, lineHeight: 1.55, color: '#4b5563', margin: '0 0 10px' }}>
              <b>{[exceptionPlacement.student.first_name, exceptionPlacement.student.last_name].filter(Boolean).join(' ') || exceptionPlacement.student.name}</b>
              {' '}has the ASPIRE status <b>{exceptionPlacement.student.status || 'not set'}</b>, not
              {' '}<b>Interviewed</b>. Placing them into <b>{exceptionPlacement.unit.unit_name}</b> is
              an exception to the normal interview-first rule.
            </p>
            <p style={{ fontSize: 13, lineHeight: 1.55, color: '#4b5563', margin: '0 0 14px' }}>
              Continue only if this placement has been approved. The student will be set to
              <b> Placed</b>, and the exception will be recorded in the activity log with your name.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setExceptionPlacement(null)}
                style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                data-testid="placement-exception-confirm"
                onClick={() => {
                  const { student, unit } = exceptionPlacement
                  setExceptionPlacement(null)
                  commitPlacement(student, unit, true)
                }}
                style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  border: 'none', background: '#92400e', color: '#fff', cursor: 'pointer' }}>
                Confirm approved exception
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

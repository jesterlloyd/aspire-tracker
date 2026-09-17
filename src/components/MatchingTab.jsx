import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import EmbedUnitCard from './EmbedUnitCard'
import StudentMatchingCard from './StudentMatchingCard'
import { UNIT_DIVISION_MAP } from '../lib/constants'
import StatusLegendPopover from './StatusLegendPopover'
import EmptyState from './EmptyState'
import { Users, MapPin, Info } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import RestrictedAccessOverlay from './RestrictedAccessOverlay'
import { canPerformMatching } from '../lib/permissions'
import { KPICell } from './KPIBand'
import { unitOpenSlots, totalOpenSlots, derivePrefCounts, studentsMatchedToUnit } from '../lib/placementDisplay'
import { filterPoolByReadiness, needsPlacementException, isPoolEligible } from '../lib/placementReadiness'
import {
  notificationStateIndex, NOTIFICATION_TARGETS,
  CONFIRMED_TYPE, CORRECTED_TYPE, LEGACY_MANUAL_TYPE,
} from '../lib/placementNotificationState'
import { supabase as supabaseClient } from '../lib/supabase'
import { planUnmatch } from '../lib/unmatchPlan'
import { createPendingUnmatch, UNDO_WINDOW_MS } from '../lib/pendingUnmatch'
import { orderUnitsForStudent, groupPoolForUnit, orderPool, RANK_WORD } from '../lib/placementBoardView'
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
  const [poolSchool,        setPoolSchool]        = useState('')
  // Pending approved-exception placement: { student, unit } awaiting confirmation.
  const [exceptionPlacement, setExceptionPlacement] = useState(null)

  // PLACEMENT-POOL-READINESS-1: a cohort switch drops any half-finished exception
  // confirmation. It is a per-cohort, per-student decision and must never carry into
  // a different cohort's placement work.
  //
  // Adjusted during render (React's documented pattern for resetting state when a prop
  // changes) rather than in an effect, so the board never paints one frame of it.
  const [exceptionCohort, setExceptionCohort] = useState(cohortId)
  if (cohortId !== exceptionCohort) {
    setExceptionCohort(cohortId)
    setExceptionPlacement(null)
  }
  const [divFilter,         setDivFilter]         = useState('')
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
  // The pool is every ELIGIBLE student (Owner, 2026-09-17): the readiness filter is
  // gone, so a student who has not interviewed yet is visible here, at the bottom of
  // the list, wearing their ASPIRE Status pill. Placing one is still an approved
  // exception and still asks first. No mode can include a Not Proceeding, Placed,
  // Active Rotation, Completed or Declined student.
  const eligibleAll     = filterPoolByReadiness(students, 'all')
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

  // Filter, then alphabetical. The sort control is gone (Owner, 2026-09-17); a
  // selected student still reorders the boards by their preferences below.
  let displayUnits = [...participating]
  if (divFilter) {
    displayUnits = displayUnits.filter(u =>
      (u.division || UNIT_DIVISION_MAP[u.unit_name] || 'Medical') === divFilter
    )
  }
  displayUnits.sort((a, b) => a.unit_name.localeCompare(b.unit_name))

  // Pool: include fading-out students temporarily for exit animation, and a
  // student whose unmatch is held (shown, not actionable).
  const poolIds = new Set()
  const poolBase = [
    ...eligibleAll,
    ...students.filter(s => fadingStudentIds.has(s.id) && s.matched_unit_id),
    ...students.filter(s => s.id === returningStudentId),
  ].filter(s => (poolIds.has(s.id) ? false : poolIds.add(s.id)))
  const filteredPool = poolBase.filter(s => {
    if (fadingStudentIds.has(s.id)) return true // always show during exit animation
    if (poolSchool && s.school !== poolSchool) return false
    return true
  })

  // One order for the pool, and it lives in lib/placementBoardView.js: preference for
  // the focused unit, then interviewed before not-yet-interviewed, then last name A-Z.
  const sortedPool = orderPool(filteredPool, focusedUnit)

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
  const [draggingStudentId, setDraggingStudentId] = useState(null)
  const [pullRequest, setPullRequest] = useState(null)

  const badgeRef = useRef(null)
  const badgeWanted = useRef(false)
  // A 1x1 transparent GIF, built once: it replaces the browser's own drag image,
  // which is a translucent copy of the note and used to cover the badge.
  const [dragGhost] = useState(() => {
    if (typeof Image === 'undefined') return null
    const img = new Image()
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    return img
  })
  const showBadgeAt = (e) => {
    badgeWanted.current = true
    const badge = badgeRef.current
    if (!badge) return
    badge.style.transform = `translate3d(${e.clientX + 14}px, ${e.clientY + 14}px, 0)`
    badge.style.opacity = '1'
  }
  const hideBadge = () => {
    const badge = badgeRef.current
    if (badge) badge.style.opacity = '0'
  }

  // Runs last (document is the end of the bubble path), so it sees whether any board
  // asked for the badge during THIS dragover and hides it when none did.
  const onDocumentDragOver = () => {
    if (!badgeWanted.current) hideBadge()
    badgeWanted.current = false
  }

  const startDrag = (e, payload) => {
    document.addEventListener('dragover', onDocumentDragOver)
    dragRef.current = payload
    setDragKind(payload.kind)
    setDraggingStudentId(payload.studentId)
    try {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', payload.name)
      if (dragGhost) e.dataTransfer.setDragImage(dragGhost, 0, 0)
    } catch { /* some browsers restrict dataTransfer; the ref carries the payload */ }
  }
  const endDrag = () => {
    setDraggingStudentId(null)
    document.removeEventListener('dragover', onDocumentDragOver)
    badgeWanted.current = false
    hideBadge()
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
      const live = latest.current
      const room = live.matches.filter(m => m.unit_id === unit.id).length < unit.total_slots
      e.dataTransfer.dropEffect = room ? 'move' : 'none'
      // The badge says "this slot will take them", so it appears only where that is
      // true. Over a full board there is no badge, and the drop is refused with the
      // same message the click path gives.
      if (room) showBadgeAt(e); else hideBadge()
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
  const unmatchedCount = eligibleAll.length

  const renderPoolNote = (s) => (
    <div key={s.id} ref={el => { cardRefs.current[s.id] = el }} className="pb-note-slot">
      <StudentMatchingCard
        student={s}
        isSelected={selectedStudent?.id === s.id}
        onSelect={handleStudentSelect}
        isReadOnly={!canMatch}
        isPending={s.id === returningStudentId}
        isDragging={s.id === draggingStudentId}
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

      {/* The drag badge. Hidden until a dragged note is over a board with an open
          slot; moved by the dragover handler, never by a re-render. */}
      <span ref={badgeRef} className="pb-drag-badge material-pin material-rank-first" aria-hidden="true">+</span>

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
            <header className="material-navy-flat pb-pool-hdr">
              <h2 className="pb-pool-title">Student Pool</h2>
              <span className="pb-count material-soft">
                {selectedStudent
                  ? `${selectedIndex + 1} of ${sortedPool.length}`
                  : `${sortedPool.length} student${sortedPool.length !== 1 ? 's' : ''}`}
              </span>
              {/* The legend explains the ASPIRE Status pills, which are now the pool's
                  only readiness indicator. */}
              <StatusLegendPopover position="bottom-right" dark />
              <span className="pb-hdr-spacer" />
              <select value={poolSchool} onChange={e => setPoolSchool(e.target.value)} className="pb-select" aria-label="School">
                <option value="">All Schools</option>
                {poolSchools.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
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
                        heading={poolSchool ? 'No students match this filter' : 'No students to place'}
                        subtext={poolSchool
                          ? 'No eligible students from this school are waiting for a placement.'
                          : 'Students appear here once their form is in and they have not been placed yet.'} />
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
            <header className="material-navy-flat pb-pool-hdr">
              <h2 className="pb-pool-title">Unit Pool</h2>
              {(selectedStudent || focusedUnit) && (
                <span className="pb-hdr-hint material-soft">
                  {selectedStudent ? 'Reordered by preference' : `By preference for ${focusedUnit?.unit_name}`}
                </span>
              )}
              <span className="pb-hdr-spacer" />
              <select value={divFilter} onChange={e => setDivFilter(e.target.value)} className="pb-select" aria-label="Division">
                <option value="">All Divisions</option>
                <option value="Surgical">Surgical</option>
                <option value="Medical">Medical</option>
                <option value="Critical Care">Critical Care</option>
                <option value="Specialty">Specialty</option>
              </select>
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
                      draggingStudentId={draggingStudentId}
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

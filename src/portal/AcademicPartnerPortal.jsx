// PHASE4-SCHOOL-PORTAL / AP Phase 1: Academic Partner portal.
//
// The Students workspace is the default landing: the shared greeting + weather masthead, a school
// picker (only when the caller has more than one authorized school), a cohort picker, school- and
// cohort-scoped summary filters (All Students / Currently Rotating / Completed), and the
// school-scoped roster. On Campus Now, Needs Attention, the student drawer, and Hours & Shifts
// detail are later phases and are not rendered here (no placeholder data).
//
// Reads: GET /api/portal/school-students (JWT endpoint, column allowlist; no scores, content,
// narratives, or compliance flags). Writes: none. School scope is ALWAYS server-derived from
// user_school_scopes; no browser value influences authorization.
//
// Released reports (portal_my_school_reports) were shown by the previous flat roster page. They are
// a published-outcomes concern, not roster context, so they are intentionally NOT in the
// first-release Students workspace; they belong with the later Reports / NGRP surface.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import GreetingMasthead from '../components/masthead/GreetingMasthead'
import { FilterKPICard } from '../components/KPIBand'
import StatusPill from '../components/StatusPill'
import StatusLegendPopover from '../components/StatusLegendPopover'
import SortHeader from '../components/shared/SortHeader'
import { useRegisterPortalRefresh } from './PortalRefresh'
import PlacementRequestsView from './ap/PlacementRequestsView'
import PortalMessagesWorkspace from './messages/PortalMessagesWorkspace'
import { PortalHeaderScope, PortalHeaderControls } from './PortalHeaderSlots'
import { deriveClinicalHours } from '../lib/portalProgress'
import UnitStudentAvatar from './unit/UnitStudentAvatar'
import { LoadingState, EmptyState, ErrorState, DeniedState } from './unit/UnitLeaderChrome'
import { cohortOptions, inCohortScope, sortRoster } from './ap/academicPartnerRoster'
import { computeStatusCounts } from '../lib/derivations/cohortStatus'
import { useSchoolStudentPhotos } from './ap/useSchoolStudentPhotos'
import { useReportPortalFailure, ACCESS_FAILURE } from './portalAccessSignal'

// A stable empty roster reference so the photo-prefetch effect does not re-run every render while
// the roster is still loading (a fresh [] each render would look like a new dependency).
const EMPTY_ROSTER = []

const fmtDate = (d) => {
  if (!d) return ''
  try {
    return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return String(d) }
}

const rotationText = (s) =>
  s.term_dates || (s.cohort?.start_date ? `${fmtDate(s.cohort.start_date)} to ${fmtDate(s.cohort.end_date)}` : '')

const displayName = (s) => `${s.preferred_first_name || s.first_name || ''} ${s.last_name || ''}`.trim()

// Hours cell reusing the canonical .ptl-mini-progress bar + deriveClinicalHours (pct capped at 100,
// never a misleading bar when required is missing/zero). The exact numbers are duplicated in text
// for the accessible equivalent. Pending is shown but never counted as approved.
function ApHoursCell({ hours }) {
  const h = deriveClinicalHours({ required: hours.required, approved: hours.approved, pending: hours.pending })
  if (!h.reliable) return <span className="ptl-muted ptl-small">Not set</span>
  const pending = Number(hours.pending) > 0 ? Number(hours.pending) : 0
  const pendingText = pending > 0 ? `, ${pending} pending review` : ''
  const complete = h.completed >= h.required
  return (
    <span className="ptl-hours-cell">
      <span className="ptl-mini-progress" role="img"
        aria-label={`${h.completed} of ${h.required} required hours approved${complete ? '. Hours complete' : ''}${pendingText}`}>
        <i style={{ width: `${h.pct}%` }} />
      </span>
      <span className="ptl-hours-text">{h.completed} of {h.required}{pending > 0 ? ` (+${pending})` : ''}</span>
      {complete && <span className="ptl-hours-complete">Hours complete</span>}
    </span>
  )
}

// Messages reuses the SAME canonical PortalMessagesWorkspace the Student and Unit Leader portals use
// (variant='academic_partner'): thread list, unread, open conversation, compose to the ASPIRE Team,
// reply, and Refresh integration. Enablement is the SERVER capability passed as messagesEnabled (env
// flag AND applied DB migration), never a client constant; until the server reports enabled, Messages
// shows an honest prepared state (no workspace, no polling) and no lower-right launcher mounts.
export default function AcademicPartnerPortal({ view = 'students', onNavigate, messagesEnabled = false, threadId, onSelectThread, onBackToList }) {
  if (view === 'placement-requests') {
    return <PlacementRequestsView onNavigate={onNavigate} />
  }
  if (view === 'messages') {
    if (!messagesEnabled) {
      return (
        <EmptyState
          title="Messages"
          detail="Secure messaging with the ASPIRE Team will live here. This section is being prepared and is not active yet."
        />
      )
    }
    return (
      <PortalMessagesWorkspace
        active
        variant="academic_partner"
        threadId={threadId}
        onSelectThread={onSelectThread}
        onBackToList={onBackToList}
      />
    )
  }
  return <StudentsView />
}

function StudentsView() {
  const { userProfile } = useAuth()
  const [schools, setSchools] = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  // Roster scope. Null means "use the default" (derived from the loaded data), so no effect is
  // needed to seed the selection: the newest school and its default cohort resolve at render time.
  const [selectedSchoolKey, setSelectedSchoolKey] = useState(null)
  const [selectedCohortId, setSelectedCohortId]   = useState(null)
  const [statusFilter, setStatusFilter]           = useState(null)   // canonical status payload; null = all
  const [sort, setSort]                           = useState({ column: null, direction: 'asc' })

  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  )

  const reload = useCallback(() => setReloadKey(k => k + 1), [])
  const reportFailure = useReportPortalFailure()

  // The shared portal Refresh re-fetches the school roster (and, through has_photo, re-primes secure
  // photos). StudentsView is mounted only for the Students section, so registering on mount is enough.
  useRegisterPortalRefresh(reload)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData?.session?.access_token
        if (!token) {
          if (!cancelled) { setError('Your session expired. Please sign in again.'); setLoading(false) }
          return
        }
        const res = await fetch('/api/portal/school-students', { headers: { Authorization: `Bearer ${token}` } })
        if (cancelled) return
        let payload = null
        try { payload = await res.json() } catch { payload = null }
        if (!res.ok) {
          // A refusal because this person's access ended is not a failure to load.
          // The shell owns that answer, so hand it up and stop: it replaces this
          // whole view with the no-access card rather than offering a Try again
          // that could never succeed.
          const kind = reportFailure({ status: res.status, error: payload?.error })
          if (kind === ACCESS_FAILURE.ACCESS_ENDED) { setLoading(false); return }
          if (kind === ACCESS_FAILURE.SIGNED_OUT) {
            setError('Your session expired. Please sign in again.'); setLoading(false); return
          }
          setError('We could not load your students right now. Please try again shortly.')
          setLoading(false); return
        }
        if (!payload) { setError('We could not load your students right now. Please try again shortly.'); setLoading(false); return }
        setSchools(payload.schools || [])
      } catch {
        if (!cancelled) setError('We could not load your students right now. Please try again shortly.')
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [reloadKey, reportFailure])

  // The roster in view, derived defensively so the photo hook can run unconditionally (rules of
  // hooks) before the loading/error/denied early returns below.
  const activeSchool = schools && schools.length > 0
    ? (schools.find(s => s.school_key === selectedSchoolKey) || schools[0])
    : null
  const roster = activeSchool?.students || EMPTY_ROSTER
  // Prime secure, short-lived signed photo URLs for this school's roster into the shared cache, and
  // only for students the endpoint flagged has_photo. Authorization is server-side; initials remain
  // the fallback whenever a photo is absent or not yet resolved.
  const photos = useSchoolStudentPhotos(roster)

  if (loading) return <LoadingState label="Loading your students" />
  if (error)   return <ErrorState detail={error} onRetry={reload} />
  if (!schools || schools.length === 0) {
    return (
      <DeniedState
        title="No school linked yet"
        detail="Your account is active, but no school is connected to it yet. The ASPIRE team connects your school, and your roster will appear here once it is in place."
      />
    )
  }

  const school = activeSchool
  const students = roster
  const { options, defaultId, currentIds } = cohortOptions(school.cohorts || [])
  const cohortId = options.some(o => o.id === selectedCohortId) ? selectedCohortId : defaultId
  const cohortLabel = options.find(o => o.id === cohortId)?.label || 'All Cohorts'

  const scoped = students.filter(s => inCohortScope(s, cohortId, currentIds))
  // Canonical status grouping, shared with the main-app Student Profiles band (never a parallel AP
  // grouping). Filter, then sort, entirely client-side from the already-scoped response (no new
  // request). The sort selection is independent of filter/cohort/school, so changing sort never
  // re-scopes; the filter payload matches the main app (a status string or a status-array bucket).
  const counts = computeStatusCounts(scoped)
  const matchesStatus = (s, f) => f === null || (Array.isArray(f) ? f.includes(s.status) : s.status === f)
  const filtered = scoped.filter(s => matchesStatus(s, statusFilter))
  const rows = sortRoster(filtered, sort.column, sort.direction)

  const onSchoolChange = (key) => { setSelectedSchoolKey(key); setSelectedCohortId(null); setStatusFilter(null) }
  const onSort = (col) => setSort(s => (
    s.column === col ? { column: col, direction: s.direction === 'asc' ? 'desc' : 'asc' } : { column: col, direction: 'asc' }
  ))
  const sameFilter = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const toggleStatus = (payload) => setStatusFilter(prev => sameFilter(prev, payload) ? null : payload)

  // The full canonical Student Profiles KPI band (same order, grouping, and accents as the main app).
  // The Not Proceeding subtitle is privacy-safe for the Academic Partner (no disposition detail).
  const FILTERS = [
    { label: 'Total',             sub: 'All students',              n: counts.total,             accent: 'nightfall',  payload: null },
    { label: 'Needs Outreach',    sub: 'Pending + Form Sent',       n: counts.needsOutreach,     accent: 'dawn',       payload: ['Pending Outreach', 'Form Sent'] },
    { label: 'Awaiting Interview', sub: 'Form Received + Scheduled', n: counts.awaitingInterview, accent: 'periwinkle', payload: ['Form Received', 'Interview Scheduled'] },
    { label: 'Interviewed',       sub: 'Ready to place',            n: counts.interviewed,       accent: 'lavender',   payload: 'Interviewed' },
    { label: 'Placed',            sub: 'Unit assigned',             n: counts.placed,            accent: 'sage',       payload: 'Placed' },
    { label: 'Active Rotation',   sub: 'In rotation',               n: counts.activeRotation,    accent: 'marina',     payload: 'Active Rotation' },
    { label: 'Completed',         sub: 'Program done',              n: counts.completed,         accent: 'sage',       payload: 'Completed' },
    { label: 'Not Proceeding',    sub: 'No longer moving forward',  n: counts.notProceeding,     accent: 'chroma',     payload: ['Not Proceeding', 'Declined'] },
  ]

  return (
    <div className="ptl-page ptl-ap-page">
      <h1 className="ptl-visually-hidden">Academic Partner Students</h1>
      <GreetingMasthead
        fullName={userProfile?.full_name}
        dateLabel={dateLabel}
        contextLabel={cohortLabel}
      />

      {/* School scope + cohort picker live in the persistent Nightfall header (no page-level context
          row). The single-school case shows the school in the header subtitle; multi-school shows an
          authorized-school selector. The cohort picker drives KPIs and the roster. */}
      <PortalHeaderScope>{schools.length === 1 ? <> · {school.school_key}</> : null}</PortalHeaderScope>
      <PortalHeaderControls>
        {schools.length > 1 && (
          <span className="ptl-header-ctl">
            <span className="ptl-header-ctl-label">School</span>
            <select aria-label="School" value={school.school_key} onChange={e => onSchoolChange(e.target.value)}>
              {schools.map(s => <option key={s.school_key} value={s.school_key}>{s.school_key}</option>)}
            </select>
          </span>
        )}
        <span className="ptl-header-ctl" data-portal-cohort-picker="true">
          <span className="ptl-header-ctl-label">Cohort</span>
          <select aria-label="Cohort" value={cohortId} onChange={e => setSelectedCohortId(e.target.value)}>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </span>
      </PortalHeaderControls>

      <div className="ptl-ap-kpis" role="group" aria-label="Filter students by pathway status">
        {FILTERS.map(f => (
          <FilterKPICard
            key={f.label}
            value={f.n}
            label={f.label}
            sub={f.sub}
            accent={f.accent}
            active={sameFilter(statusFilter, f.payload)}
            onClick={() => toggleStatus(f.payload)}
          />
        ))}
      </div>

      {students.length === 0 ? (
        <EmptyState title="No students in this school yet" detail="When your school's students enter the ASPIRE pathway, they will appear here." />
      ) : scoped.length === 0 ? (
        <EmptyState title={`No students in ${cohortLabel}`} detail="Choose a different cohort to see more of your school's students." />
      ) : rows.length === 0 ? (
        <EmptyState title="No students match this filter" detail="Clear the filter to see every student in this cohort." />
      ) : (
        <div className="ptl-card ptl-ap-roster">
          <div className="ptl-table-wrap">
            <table className="ptl-table ptl-ap-table">
              <thead>
                <tr>
                  {/* Canonical sort headers (shared with the staff roster): ↑/↓ arrows, aria-sort,
                      dynamic aria-label. thClassName="" keeps the portal table cell styling; the sort
                      logic, school/cohort scope, and KPI filter are untouched. */}
                  <SortHeader sortKey="student" sortBy={sort.column} sortDir={sort.direction} onSort={onSort} thClassName="">Student</SortHeader>
                  <th scope="col">Cohort</th>
                  {/* The status header pairs the canonical sort button with the ASPIRE Status Legend
                      (staff disposition detail hidden) via the shared after= slot. */}
                  <SortHeader
                    sortKey="status" sortBy={sort.column} sortDir={sort.direction} onSort={onSort} thClassName=""
                    after={<StatusLegendPopover audience="academic_partner" />}
                  >
                    ASPIRE status
                  </SortHeader>
                  <th scope="col">Confirmed unit</th>
                  <th scope="col">Primary preceptor</th>
                  <th scope="col">Rotation</th>
                  <SortHeader sortKey="hours" sortBy={sort.column} sortDir={sort.direction} onSort={onSort} thClassName="">Hours</SortHeader>
                </tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.id}>
                    <td>
                      <span className="ptl-ap-student">
                        <UnitStudentAvatar url={photos.peek(s.id)} name={displayName(s)} size={34} />
                        <span className="ptl-ap-student-name">{displayName(s)}</span>
                      </span>
                    </td>
                    <td>{s.cohort?.name || ''}</td>
                    <td><StatusPill status={s.status} /></td>
                    <td>{s.unit_name || <span className="ptl-muted">Not yet confirmed</span>}</td>
                    <td>{s.preceptor_name || ''}</td>
                    <td>{rotationText(s)}</td>
                    <td><ApHoursCell hours={s.hours} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ptl-muted ptl-small">
            Hours show approved of required (plus pending review). Confirmed unit and preceptor
            appear once a placement is set. Status content and evaluation responses stay with the
            ASPIRE team.
          </p>
        </div>
      )}
    </div>
  )
}

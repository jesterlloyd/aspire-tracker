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
import { useLastVisitLabel } from '../lib/lastVisit'
import { FilterKPICard } from '../components/KPIBand'
import StatusPill from '../components/StatusPill'
import StatusLegendPopover from '../components/StatusLegendPopover'
import SortHeader from '../components/shared/SortHeader'
import { useRegisterPortalRefresh } from './PortalRefresh'
import PlacementRequestsView from './ap/PlacementRequestsView'
import { PortalHeaderScope, PortalHeaderControls } from './PortalHeaderSlots'
import { deriveClinicalHours } from '../lib/portalProgress'
import UnitStudentAvatar from './unit/UnitStudentAvatar'
import { LoadingState, EmptyState, ErrorState, DeniedState } from './unit/UnitLeaderChrome'
import { cohortOptions, inCohortScope, summaryCounts, applyFilter, sortRoster } from './ap/academicPartnerRoster'
import { useSchoolStudentPhotos } from './ap/useSchoolStudentPhotos'

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
  return (
    <span className="ptl-hours-cell">
      <span className="ptl-mini-progress" role="img"
        aria-label={`${h.completed} of ${h.required} required hours approved${pendingText}`}>
        <i style={{ width: `${h.pct}%` }} />
      </span>
      <span className="ptl-hours-text">{h.completed} of {h.required}{pending > 0 ? ` (+${pending})` : ''}</span>
    </span>
  )
}

// Placement Requests and Messages have stable routes now but no active backend in this phase, so
// each renders an honest prepared state (shared .ptl-state language, no controls, no API calls).
export default function AcademicPartnerPortal({ view = 'students' }) {
  if (view === 'placement-requests') {
    return <PlacementRequestsView />
  }
  if (view === 'messages') {
    return (
      <EmptyState
        title="Messages"
        detail="Secure messaging with the ASPIRE team will live here. This section is being prepared and is not active yet."
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
  const [filter, setFilter]                       = useState('all')
  const [sort, setSort]                           = useState({ column: null, direction: 'asc' })

  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  )
  const lastVisitLine = useLastVisitLabel(userProfile?.id ? `aspire:lastVisit:portal:ap:${userProfile.id}` : null)

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

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
        const data = res.ok ? await res.json() : null
        if (!data) { setError('We could not load your students right now. Please try again shortly.'); setLoading(false); return }
        setSchools(data.schools || [])
      } catch {
        if (!cancelled) setError('We could not load your students right now. Please try again shortly.')
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [reloadKey])

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
  const { options, defaultId, currentIds } = cohortOptions(students)
  const cohortId = options.some(o => o.id === selectedCohortId) ? selectedCohortId : defaultId
  const cohortLabel = options.find(o => o.id === cohortId)?.label || 'All Cohorts'

  const scoped = students.filter(s => inCohortScope(s, cohortId, currentIds))
  const counts = summaryCounts(scoped)
  // Filter, then sort, entirely client-side from the already-scoped response (no new request). The
  // sort selection is independent of filter/cohort/school, so changing sort never re-scopes.
  const rows = sortRoster(applyFilter(scoped, filter), sort.column, sort.direction)

  const onSchoolChange = (key) => { setSelectedSchoolKey(key); setSelectedCohortId(null); setFilter('all') }
  const onSort = (col) => setSort(s => (
    s.column === col ? { column: col, direction: s.direction === 'asc' ? 'desc' : 'asc' } : { column: col, direction: 'asc' }
  ))

  const FILTERS = [
    { key: 'all',       label: 'All Students',       n: counts.all,       accent: 'nightfall' },
    { key: 'rotating',  label: 'Currently Rotating', n: counts.rotating,  accent: 'marina' },
    { key: 'completed', label: 'Completed',          n: counts.completed, accent: 'sage' },
  ]

  return (
    <div className="ptl-page ptl-ap-page">
      <h1 className="ptl-visually-hidden">Academic Partner students</h1>
      <GreetingMasthead
        fullName={userProfile?.full_name}
        dateLabel={dateLabel}
        contextLabel={cohortLabel}
        lastVisitLine={lastVisitLine}
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
        <span className="ptl-header-ctl">
          <span className="ptl-header-ctl-label">Cohort</span>
          <select aria-label="Cohort" value={cohortId} onChange={e => setSelectedCohortId(e.target.value)}>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </span>
      </PortalHeaderControls>

      <div className="ptl-ap-kpis" role="group" aria-label="Filter students by status">
        {FILTERS.map(f => (
          <FilterKPICard
            key={f.key}
            value={f.n}
            label={f.label}
            accent={f.accent}
            active={filter === f.key}
            onClick={() => setFilter(f.key)}
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
                    after={<StatusLegendPopover showStaffDetail={false} />}
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

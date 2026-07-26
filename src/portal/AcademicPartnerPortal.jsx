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
import { LoadingState, EmptyState, ErrorState, DeniedState } from './unit/UnitLeaderChrome'
import { cohortOptions, inCohortScope, summaryCounts, applyFilter } from './ap/academicPartnerRoster'

const fmtDate = (d) => {
  if (!d) return ''
  try {
    return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return String(d) }
}

const rotationText = (s) =>
  s.term_dates || (s.cohort?.start_date ? `${fmtDate(s.cohort.start_date)} to ${fmtDate(s.cohort.end_date)}` : '')

// Placement Requests and Messages have stable routes now but no active backend in this phase, so
// each renders an honest prepared state (shared .ptl-state language, no controls, no API calls).
export default function AcademicPartnerPortal({ view = 'students' }) {
  if (view === 'placement-requests') {
    return (
      <EmptyState
        title="Placement Requests"
        detail="You will be able to submit and track your school's placement requests here. This section is being prepared and is not active yet."
      />
    )
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

  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  )
  const lastVisitLine = useLastVisitLabel(userProfile?.id ? `aspire:lastVisit:portal:ap:${userProfile.id}` : null)

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

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

  const school = schools.find(s => s.school_key === selectedSchoolKey) || schools[0]
  const students = school.students || []
  const { options, defaultId, currentIds } = cohortOptions(students)
  const cohortId = options.some(o => o.id === selectedCohortId) ? selectedCohortId : defaultId
  const cohortLabel = options.find(o => o.id === cohortId)?.label || 'All Cohorts'

  const scoped = students.filter(s => inCohortScope(s, cohortId, currentIds))
  const counts = summaryCounts(scoped)
  const rows = applyFilter(scoped, filter)

  const onSchoolChange = (key) => { setSelectedSchoolKey(key); setSelectedCohortId(null); setFilter('all') }

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

      {/* One control row: the canonical pastel KPI filter cards on the left, the school (only when
          more than one) and cohort pickers aligned right on desktop. Wraps cleanly on narrow. */}
      <section className="ptl-ap-controls">
        {schools.length === 1 && <p className="ptl-unit-context ptl-ap-schoolline">School · <b>{school.school_key}</b></p>}
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
        <div className="ptl-ap-pickers">
          {schools.length > 1 && (
            <div className="ptl-ap-field">
              <label className="ptl-label" htmlFor="ap-school">School</label>
              <select id="ap-school" className="ptl-select" value={school.school_key} onChange={e => onSchoolChange(e.target.value)}>
                {schools.map(s => <option key={s.school_key} value={s.school_key}>{s.school_key}</option>)}
              </select>
            </div>
          )}
          <div className="ptl-ap-field">
            <label className="ptl-label" htmlFor="ap-cohort">Cohort</label>
            <select id="ap-cohort" className="ptl-select" value={cohortId} onChange={e => setSelectedCohortId(e.target.value)}>
              {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </section>

      {students.length === 0 ? (
        <EmptyState title="No students in this school yet" detail="When your school's students enter the ASPIRE pathway, they will appear here." />
      ) : scoped.length === 0 ? (
        <EmptyState title={`No students in ${cohortLabel}`} detail="Choose a different cohort to see more of your school's students." />
      ) : rows.length === 0 ? (
        <EmptyState title="No students match this filter" detail="Clear the filter to see every student in this cohort." />
      ) : (
        <div className="ptl-card ptl-ap-roster">
          <div className="ptl-table-wrap">
            <table className="ptl-table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Cohort</th>
                  <th scope="col">ASPIRE status</th>
                  <th scope="col">Confirmed unit</th>
                  <th scope="col">Primary preceptor</th>
                  <th scope="col">Rotation</th>
                  <th scope="col">Hours</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.id}>
                    <td>{(s.preferred_first_name || s.first_name)} {s.last_name}</td>
                    <td>{s.cohort?.name || ''}</td>
                    <td><span className="ptl-chip ptl-chip-soft">{s.status}</span></td>
                    <td>{s.unit_name || <span className="ptl-muted">Not yet confirmed</span>}</td>
                    <td>{s.preceptor_name || ''}</td>
                    <td>{rotationText(s)}</td>
                    <td>
                      {s.hours.required
                        ? `${s.hours.approved} of ${s.hours.required} approved${s.hours.pending ? `, ${s.hours.pending} pending` : ''}`
                        : ''}
                    </td>
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

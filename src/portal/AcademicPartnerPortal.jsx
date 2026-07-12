// PHASE4-SCHOOL-PORTAL: academic partner portal home.
//
// Reads:
//   - School roster with pipeline stage, placement, hours, evaluation
//     completion counts: GET /api/portal/school-students (JWT endpoint,
//     column allowlist; no scores, content, narratives, or compliance flags)
//   - Released reports: portal_my_school_reports (scoped view)
// Writes: none.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const fmtDate = (d) => {
  if (!d) return ''
  try {
    return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return String(d) }
}

const STAGE_ORDER = [
  'Pending Outreach', 'Form Sent', 'Form Received', 'Interview Scheduled',
  'Interviewed', 'Placed', 'Active Rotation', 'Completed', 'Declined', 'Not Proceeding',
]

export default function AcademicPartnerPortal() {
  const [schools, setSchools] = useState(null)
  const [reports, setReports] = useState([])
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData?.session?.access_token
        if (!token) {
          if (!cancelled) { setError('Your session expired. Please sign in again.'); setLoading(false) }
          return
        }
        const [rosterRes, repRes] = await Promise.all([
          fetch('/api/portal/school-students', { headers: { Authorization: `Bearer ${token}` } }),
          supabase.from('portal_my_school_reports').select('*').order('published_at', { ascending: false }),
        ])
        if (cancelled) return
        const rosterData = rosterRes.ok ? await rosterRes.json() : { schools: [] }
        setSchools(rosterData.schools || [])
        setReports(repRes.data || [])
      } catch {
        if (!cancelled) setError('We could not load your portal right now. Please try again shortly.')
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className="ptl-muted">Loading your students...</div>
  if (error)   return <div className="ptl-card ptl-error">{error}</div>

  if (!schools || schools.length === 0) {
    return (
      <div className="ptl-card ptl-center-card">
        <div className="ptl-card-title">No school is linked yet</div>
        <p className="ptl-muted">
          Your account is active, but no school is connected to it. Please
          contact the ASPIRE team.
        </p>
      </div>
    )
  }

  return (
    <div className="ptl-grid">
      {schools.map(sch => (
        <SchoolSection
          key={sch.school_key}
          school={sch}
          reports={reports.filter(r => r.school_key === sch.school_key)}
        />
      ))}
    </div>
  )
}

function SchoolSection({ school, reports }) {
  const students = [...school.students].sort((a, b) =>
    STAGE_ORDER.indexOf(a.status) - STAGE_ORDER.indexOf(b.status) ||
    (a.last_name || '').localeCompare(b.last_name || '')
  )
  const active = students.filter(s => s.status === 'Active Rotation').length
  const placed = students.filter(s => s.status === 'Placed').length
  const completed = students.filter(s => s.status === 'Completed').length

  return (
    <>
      <div className="ptl-card ptl-span2">
        <div className="ptl-welcome">{school.school_key}</div>
        <div className="ptl-status-row">
          <span className="ptl-chip ptl-chip-soft">{students.length} students</span>
          <span className="ptl-chip ptl-chip-soft">{active} in rotation</span>
          <span className="ptl-chip ptl-chip-soft">{placed} placed</span>
          <span className="ptl-chip ptl-chip-soft">{completed} completed</span>
        </div>
      </div>

      <div className="ptl-card ptl-span2">
        <div className="ptl-card-title">Students</div>
        {students.length === 0 ? (
          <div className="ptl-muted">No students in the current pathway.</div>
        ) : (
          <div className="ptl-table-wrap">
            <table className="ptl-table">
              <thead>
                <tr><th>Student</th><th>Stage</th><th>Cohort</th><th>Unit</th><th>Preceptor</th><th>Rotation</th><th>Hours</th><th>Evaluations</th></tr>
              </thead>
              <tbody>
                {students.map(s => (
                  <tr key={s.id}>
                    <td>{(s.preferred_first_name || s.first_name)} {s.last_name}</td>
                    <td><span className="ptl-chip ptl-chip-soft">{s.status}</span></td>
                    <td>{s.cohort?.name || ''}</td>
                    <td>{s.unit_name || ''}</td>
                    <td>{s.preceptor_name || ''}</td>
                    <td>{s.term_dates || (s.cohort ? `${fmtDate(s.cohort.start_date)} to ${fmtDate(s.cohort.end_date)}` : '')}</td>
                    <td>
                      {s.hours.required
                        ? `${s.hours.approved}/${s.hours.required}${s.hours.pending ? ` (+${s.hours.pending})` : ''}`
                        : ''}
                    </td>
                    <td>
                      {s.evaluations.completed + s.evaluations.pending > 0
                        ? `${s.evaluations.completed} done${s.evaluations.pending ? `, ${s.evaluations.pending} pending` : ''}`
                        : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="ptl-muted ptl-small">
          Hours show approved of required (plus pending review). Evaluation
          columns show completion status only; content stays with the ASPIRE
          team.
        </div>
      </div>

      <div className="ptl-card ptl-span2">
        <div className="ptl-card-title">Released reports</div>
        {reports.length === 0 ? (
          <div className="ptl-muted">
            Nothing released yet. Curated cohort reports and outcomes appear
            here once the ASPIRE team publishes them.
          </div>
        ) : (
          <ul className="ptl-list">
            {reports.map(r => (
              <li key={r.id}>
                <span>{r.title}</span>
                <span className="ptl-muted">{fmtDate(r.published_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

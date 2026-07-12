// PHASE2-PORTAL: student portal home.
//
// Reads (all server-authorized, see amendment 4 pattern choices):
//   - Summary (profile, placement, cohort, hours): GET /api/portal/student-summary
//     (JWT-verified endpoint, column allowlist)
//   - Shift logs / evaluation statuses / certificate: scoped definer views
//     portal_my_shift_logs, portal_my_evaluation_assignments,
//     portal_my_certificates (empty for anyone without an active student grant)
// Writes: none. Shift logging stays on the public /shift-log flow; evaluations
// stay on their tokenized links.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { deriveNextSteps } from '../lib/portalNextSteps'

const fmtDate = (d) => {
  if (!d) return ''
  try {
    return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return String(d) }
}

const EVAL_STATUS_LABELS = {
  draft: 'Not yet sent', sent: 'Waiting for you', opened: 'In progress',
  completed: 'Completed', reminder_due: 'Waiting for you',
  non_responder: 'Window closed', expired: 'Window closed', revoked: 'Withdrawn',
}

export default function StudentPortal() {
  const [summary, setSummary]   = useState(null)
  const [logs, setLogs]         = useState([])
  const [evals, setEvals]       = useState([])
  const [certs, setCerts]       = useState([])
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [activeId, setActiveId] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const token = sessionData?.session?.access_token
        if (!token) { setError('Your session expired. Please sign in again.'); setLoading(false); return }

        const [summaryRes, logsRes, evalsRes, certsRes] = await Promise.all([
          fetch('/api/portal/student-summary', { headers: { Authorization: `Bearer ${token}` } }),
          supabase.from('portal_my_shift_logs').select('*').order('shift_date', { ascending: false }),
          supabase.from('portal_my_evaluation_assignments').select('*').order('sent_at', { ascending: false }),
          supabase.from('portal_my_certificates').select('*'),
        ])

        if (cancelled) return
        const summaryData = summaryRes.ok ? await summaryRes.json() : { students: [] }
        setSummary(summaryData)
        setActiveId(summaryData.students?.[0]?.id || null)
        setLogs(logsRes.data || [])
        setEvals(evalsRes.data || [])
        setCerts(certsRes.data || [])
      } catch {
        if (!cancelled) setError('We could not load your portal right now. Please try again shortly.')
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className="ptl-muted">Loading your information...</div>
  if (error)   return <div className="ptl-card ptl-error">{error}</div>

  const students = summary?.students || []
  if (students.length === 0) {
    return (
      <div className="ptl-card ptl-center-card">
        <div className="ptl-card-title">No student record is linked yet</div>
        <p className="ptl-muted">
          Your account is active, but no student record is connected to it.
          Please contact the ASPIRE team.
        </p>
      </div>
    )
  }

  const student = students.find(s => s.id === activeId) || students[0]
  const myLogs  = logs.filter(l => l.student_id === student.id)
  const myEvals = evals.filter(e => e.student_id === student.id)
  const myCert  = certs.find(c => c.student_id === student.id) || null
  const supportItems = myLogs.filter(l => (l.support_needed || '').trim().length > 0)

  const required = student.hours.required
  const approved = student.hours.approved || 0
  const pending  = student.hours.pending || 0
  const pct = required ? Math.min(100, Math.round((approved / required) * 100)) : null

  const steps = deriveNextSteps({
    status: student.status,
    hours: { approved, required },
    evaluations: myEvals,
    certificate: myCert,
  })

  const displayName = student.preferred_first_name || student.first_name

  return (
    <div className="ptl-grid">
      {students.length > 1 && (
        <div className="ptl-card ptl-span2">
          <label className="ptl-label" htmlFor="ptl-rotation-pick">Rotation</label>
          <select
            id="ptl-rotation-pick"
            className="ptl-select"
            value={student.id}
            onChange={e => setActiveId(e.target.value)}
          >
            {students.map(s => (
              <option key={s.id} value={s.id}>
                {s.cohort?.name || 'Rotation'} ({s.status})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="ptl-card ptl-span2">
        <div className="ptl-welcome">Welcome, {displayName}</div>
        <div className="ptl-status-row">
          <span className="ptl-chip">{student.status}</span>
          {student.cohort?.name ? <span className="ptl-chip ptl-chip-soft">{student.cohort.name}</span> : null}
        </div>
      </div>

      <div className="ptl-card">
        <div className="ptl-card-title">Your placement</div>
        <dl className="ptl-dl">
          <div><dt>Unit</dt><dd>{student.unit_name || 'To be confirmed'}</dd></div>
          <div><dt>Preceptor</dt><dd>{student.preceptor_name || 'To be confirmed'}</dd></div>
          <div><dt>Rotation window</dt><dd>
            {student.term_dates
              || (student.cohort?.start_date ? `${fmtDate(student.cohort.start_date)} to ${fmtDate(student.cohort.end_date)}` : 'To be confirmed')}
          </dd></div>
          <div><dt>School</dt><dd>{student.school || ''}</dd></div>
        </dl>
      </div>

      <div className="ptl-card">
        <div className="ptl-card-title">Clinical hours</div>
        {required ? (
          <>
            <div className="ptl-hours-line">
              <span className="ptl-hours-big">{approved}</span>
              <span className="ptl-muted"> of {required} hours approved</span>
            </div>
            <div className="ptl-progress"><div className="ptl-progress-fill" style={{ width: `${pct}%` }} /></div>
            <div className="ptl-muted ptl-small">
              {pending > 0 ? `${pending} hours pending review. ` : ''}
              {Math.max(0, required - approved)} hours remaining.
            </div>
          </>
        ) : (
          <div className="ptl-muted">Your required hours will appear once your rotation is set up.</div>
        )}
      </div>

      <div className="ptl-card ptl-span2">
        <div className="ptl-card-title">Next steps</div>
        <ul className="ptl-steps">
          {steps.map(s => (
            <li key={s.key} className={s.done ? 'ptl-step-done' : ''}>
              <span className="ptl-step-mark">{s.done ? '✓' : '•'}</span> {s.label}
            </li>
          ))}
        </ul>
        {student.status === 'Active Rotation' && (
          <a className="ptl-btn" href="/shift-log">Log a shift</a>
        )}
      </div>

      <div className="ptl-card">
        <div className="ptl-card-title">Evaluations</div>
        {myEvals.length === 0 ? (
          <div className="ptl-muted">No evaluations yet. Links arrive by email when one opens.</div>
        ) : (
          <ul className="ptl-list">
            {myEvals.map(e => (
              <li key={e.id}>
                <span>{e.instrument_title || e.instrument_slug}</span>
                <span className={`ptl-chip ptl-chip-soft ptl-chip-${e.status === 'completed' ? 'ok' : 'wait'}`}>
                  {EVAL_STATUS_LABELS[e.status] || e.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        {myCert?.certificate_unlocked_at && (
          <div className="ptl-cert">
            Certificate <strong>{myCert.certificate_number}</strong> issued.
            Use the download link from your certificate email.
          </div>
        )}
      </div>

      <div className="ptl-card">
        <div className="ptl-card-title">Recent shift logs</div>
        {myLogs.length === 0 ? (
          <div className="ptl-muted">
            No shifts logged yet. Check in at <a href="/shift-log">aspireintelligence.app/shift-log</a>.
          </div>
        ) : (
          <ul className="ptl-list">
            {myLogs.slice(0, 8).map(l => (
              <li key={l.id}>
                <span>{fmtDate(l.shift_date)} · {l.unit_name}{l.total_hours != null ? ` · ${l.total_hours}h` : ''}</span>
                <span className={`ptl-chip ptl-chip-soft ptl-chip-${l.status === 'approved' ? 'ok' : 'wait'}`}>{l.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {supportItems.length > 0 && (
        <div className="ptl-card ptl-span2">
          <div className="ptl-card-title">Your support requests</div>
          <ul className="ptl-list">
            {supportItems.slice(0, 5).map(l => (
              <li key={l.id}>
                <span>{fmtDate(l.shift_date)}: {l.support_needed}</span>
              </li>
            ))}
          </ul>
          <div className="ptl-muted ptl-small">
            The ASPIRE team reviews every support note. For anything urgent, contact your NPD practitioner directly.
          </div>
        </div>
      )}
    </div>
  )
}

// PHASE3-UNIT-PORTAL: unit leader portal home.
//
// Reads:
//   - Roster (students, preceptors per student, hours, support flags):
//     GET /api/portal/unit-roster (JWT endpoint, column allowlist; support
//     text is never returned, only a count)
//   - Own participation submissions: portal_my_unit_responses (scoped view)
//   - Unit preceptor roster: portal_my_unit_preceptors (scoped view)
//   - Released feedback: portal_my_unit_reports (scoped view)
// Writes:
//   - Participation form: POST /api/portal/unit-participation-submit
//     (identity from the verified profile; unit must be in scope)

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const fmtDate = (d) => {
  if (!d) return ''
  try {
    return new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return String(d) }
}

const ROLE_OPTIONS = [
  'Associate Director', 'Acting Associate Director', 'Executive Director',
  'Assistant Nurse Manager', 'NPD Practitioner', 'Clinical Nurse Specialist',
  'Charge Nurse', 'Other',
]

export default function UnitLeaderPortal() {
  const [roster, setRoster]     = useState(null)
  const [responses, setResponses] = useState([])
  const [preceptors, setPreceptors] = useState([])
  const [reports, setReports]   = useState([])
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

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

        const [rosterRes, respRes, precRes, repRes] = await Promise.all([
          fetch('/api/portal/unit-roster', { headers: { Authorization: `Bearer ${token}` } }),
          supabase.from('portal_my_unit_responses').select('*').order('last_updated_at', { ascending: false }),
          supabase.from('portal_my_unit_preceptors').select('*').order('full_name'),
          supabase.from('portal_my_unit_reports').select('*').order('published_at', { ascending: false }),
        ])
        if (cancelled) return
        const rosterData = rosterRes.ok ? await rosterRes.json() : { units: [], accepting_cohort: null }
        setRoster(rosterData)
        setResponses(respRes.data || [])
        setPreceptors(precRes.data || [])
        setReports(repRes.data || [])
      } catch {
        if (!cancelled) setError('We could not load your portal right now. Please try again shortly.')
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [refreshKey])

  if (loading) return <div className="ptl-muted">Loading your units...</div>
  if (error)   return <div className="ptl-card ptl-error">{error}</div>

  const units = roster?.units || []
  const acceptingCohort = roster?.accepting_cohort || null

  if (units.length === 0) {
    return (
      <div className="ptl-card ptl-center-card">
        <div className="ptl-card-title">No unit is linked yet</div>
        <p className="ptl-muted">
          Your account is active, but no unit is connected to it. Please
          contact the ASPIRE team.
        </p>
      </div>
    )
  }

  return (
    <div className="ptl-grid">
      {units.map(u => (
        <UnitSection
          key={u.unit_key}
          unit={u}
          acceptingCohort={acceptingCohort}
          responses={responses.filter(r => r.unit_name === u.unit_key)}
          preceptors={preceptors.filter(p => p.unit_name === u.unit_key)}
          reports={reports.filter(r => r.unit_key === u.unit_key)}
          onSubmitted={() => setRefreshKey(k => k + 1)}
        />
      ))}
    </div>
  )
}

function UnitSection({ unit, acceptingCohort, responses, preceptors, reports, onSubmitted }) {
  const current = unit.students.filter(s => s.status === 'Active Rotation')
  const upcoming = unit.students.filter(s => s.status === 'Placed')
  const completed = unit.students.filter(s => s.status === 'Completed')
  const currentResponse = acceptingCohort
    ? responses.find(r => r.cohort_id === acceptingCohort.id)
    : null

  return (
    <>
      <div className="ptl-card ptl-span2">
        <div className="ptl-welcome">{unit.unit_key}</div>
        <div className="ptl-status-row">
          <span className="ptl-chip ptl-chip-soft">{current.length} in rotation</span>
          <span className="ptl-chip ptl-chip-soft">{upcoming.length} upcoming</span>
          <span className="ptl-chip ptl-chip-soft">{completed.length} completed</span>
        </div>
      </div>

      <div className="ptl-card ptl-span2">
        <div className="ptl-card-title">ASPIRE students in {unit.unit_key}</div>
        {unit.students.length === 0 ? (
          <div className="ptl-muted">No current or upcoming ASPIRE students.</div>
        ) : (
          <div className="ptl-table-wrap">
            <table className="ptl-table">
              <thead>
                <tr><th>Student</th><th>School</th><th>Rotation</th><th>Preceptor</th><th>Hours</th><th>Support</th></tr>
              </thead>
              <tbody>
                {unit.students.map(s => (
                  <tr key={s.id}>
                    <td>
                      {(s.preferred_first_name || s.first_name)} {s.last_name}
                      <span className="ptl-chip ptl-chip-soft ptl-chip-inline">{s.status}</span>
                    </td>
                    <td>{s.school}</td>
                    <td>{s.term_dates || (s.cohort ? `${fmtDate(s.cohort.start_date)} to ${fmtDate(s.cohort.end_date)}` : '')}</td>
                    <td>{s.preceptor_name || 'To be assigned'}</td>
                    <td>
                      {s.hours.required
                        ? `${s.hours.approved}/${s.hours.required}${s.hours.pending ? ` (+${s.hours.pending} pending)` : ''}`
                        : ''}
                    </td>
                    <td>
                      {s.support.open_count > 0
                        ? <span className="ptl-chip ptl-chip-wait">Support noted ({s.support.open_count})</span>
                        : <span className="ptl-muted">None</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="ptl-muted ptl-small">
          Support flags show that a student asked for help on a recent shift
          log. The ASPIRE team handles the details and will coordinate with you
          directly when unit action is needed.
        </div>
      </div>

      <div className="ptl-card">
        <div className="ptl-card-title">Preceptors</div>
        {preceptors.length === 0 ? (
          <div className="ptl-muted">No active preceptors on file for this unit.</div>
        ) : (
          <ul className="ptl-list">
            {preceptors.map(p => (
              <li key={p.id}>
                <span>{p.full_name}</span>
                {p.last_active_cohort ? <span className="ptl-muted">{p.last_active_cohort}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ptl-card">
        <div className="ptl-card-title">Released feedback and reports</div>
        {reports.length === 0 ? (
          <div className="ptl-muted">
            Nothing released yet. Curated unit feedback appears here once the
            ASPIRE team publishes it.
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

      <ParticipationCard
        unitKey={unit.unit_key}
        acceptingCohort={acceptingCohort}
        currentResponse={currentResponse}
        onSubmitted={onSubmitted}
      />
    </>
  )
}

function ParticipationCard({ unitKey, acceptingCohort, currentResponse, onSubmitted }) {
  const [open, setOpen]           = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage]     = useState(null)
  const [form, setForm] = useState(() => ({
    submitter_role:        currentResponse?.submitted_by_role || '',
    slots_offered:         currentResponse?.slots_offered != null ? String(currentResponse.slots_offered) : '',
    shift_preference:      currentResponse?.shift_preference || '',
    preferred_preceptors:  currentResponse?.preferred_preceptors || '',
    considerations:        currentResponse?.considerations || '',
    reason_for_zero:       currentResponse?.reason_for_zero || '',
    hiring_ngrp:           null,
    hiring_ngrp_reason:    '',
  }))
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  if (!acceptingCohort) {
    return (
      <div className="ptl-card ptl-span2">
        <div className="ptl-card-title">Upcoming cohort participation</div>
        <div className="ptl-muted">
          No cohort is collecting unit availability right now. This card opens
          when the next collection window starts.
        </div>
      </div>
    )
  }

  const slotsNum = Number.parseInt(form.slots_offered, 10) || 0
  const isHosting = slotsNum > 0

  const submit = async (e) => {
    e.preventDefault()
    setMessage(null)
    if (!form.submitter_role) { setMessage({ error: true, text: 'Please select your role.' }); return }
    if (form.slots_offered === '') { setMessage({ error: true, text: 'Please enter the number of slots (0 if not hosting).' }); return }
    if (form.hiring_ngrp === null) { setMessage({ error: true, text: 'Please answer the NGRP hiring question.' }); return }

    setSubmitting(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      const res = await fetch('/api/portal/unit-participation-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          unit_name:            unitKey,
          submitter_role:       form.submitter_role,
          slots_offered:        slotsNum,
          shift_preference:     form.shift_preference,
          preferred_preceptors: form.preferred_preceptors.trim(),
          considerations:       form.considerations.trim(),
          reason_for_zero:      !isHosting ? form.reason_for_zero.trim() : '',
          hiring_ngrp:          form.hiring_ngrp,
          hiring_ngrp_reason:   form.hiring_ngrp === false ? form.hiring_ngrp_reason.trim() : '',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ error: true, text: data.message || 'Something went wrong. Please try again.' })
      } else {
        setMessage({ error: false, text: `Response recorded for ${acceptingCohort.name}. Thank you.` })
        setOpen(false)
        onSubmitted()
      }
    } catch {
      setMessage({ error: true, text: 'Something went wrong. Please try again.' })
    }
    setSubmitting(false)
  }

  return (
    <div className="ptl-card ptl-span2">
      <div className="ptl-card-title">Participation for {acceptingCohort.name}</div>
      {currentResponse ? (
        <div className="ptl-muted ptl-small">
          Current response: <strong>{currentResponse.response_status === 'submitted_hosting'
            ? `hosting, ${currentResponse.slots_offered} slot${currentResponse.slots_offered === 1 ? '' : 's'}`
            : 'not hosting this cohort'}</strong>
          {currentResponse.last_updated_at ? ` (updated ${fmtDate(currentResponse.last_updated_at)})` : ''}.
          You can update it below.
        </div>
      ) : (
        <div className="ptl-muted ptl-small">No response recorded yet for this cohort.</div>
      )}

      {message && (
        <div className={message.error ? 'ptl-form-error' : 'ptl-form-ok'}>{message.text}</div>
      )}

      {!open ? (
        <button className="ptl-btn" onClick={() => setOpen(true)}>
          {currentResponse ? 'Update response' : 'Respond now'}
        </button>
      ) : (
        <form className="ptl-form" onSubmit={submit}>
          <div className="ptl-form-row">
            <label>Your role
              <select className="ptl-select" value={form.submitter_role} onChange={e => set('submitter_role', e.target.value)}>
                <option value="">Select your role...</option>
                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>Slots offered (0 if not hosting)
              <input className="ptl-input" type="number" min="0" max="99" value={form.slots_offered}
                onChange={e => set('slots_offered', e.target.value)} />
            </label>
          </div>

          {isHosting ? (
            <div className="ptl-form-row">
              <label>Shift preference
                <select className="ptl-select" value={form.shift_preference} onChange={e => set('shift_preference', e.target.value)}>
                  <option value="">No preference</option>
                  <option value="Days">Days</option>
                  <option value="Nights">Nights</option>
                  <option value="Either">Either</option>
                </select>
              </label>
              <label>Preferred preceptors
                <input className="ptl-input" value={form.preferred_preceptors}
                  onChange={e => set('preferred_preceptors', e.target.value)} placeholder="Names, if known" />
              </label>
            </div>
          ) : (
            <label>Reason for not hosting this cohort
              <input className="ptl-input" value={form.reason_for_zero}
                onChange={e => set('reason_for_zero', e.target.value)} />
            </label>
          )}

          <label>Considerations for the ASPIRE team
            <textarea className="ptl-input" rows="2" value={form.considerations}
              onChange={e => set('considerations', e.target.value)} />
          </label>

          <div className="ptl-form-row">
            <span className="ptl-label">Is your unit hiring new graduate RNs through NGRP?</span>
            <div className="ptl-radio-row">
              <label><input type="radio" checked={form.hiring_ngrp === true} onChange={() => set('hiring_ngrp', true)} /> Yes</label>
              <label><input type="radio" checked={form.hiring_ngrp === false} onChange={() => set('hiring_ngrp', false)} /> No</label>
            </div>
          </div>
          {form.hiring_ngrp === false && (
            <label>Reason
              <input className="ptl-input" value={form.hiring_ngrp_reason}
                onChange={e => set('hiring_ngrp_reason', e.target.value)} />
            </label>
          )}

          <div className="ptl-form-actions">
            <button className="ptl-btn" type="submit" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit response'}
            </button>
            <button className="ptl-btn-outline" type="button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}

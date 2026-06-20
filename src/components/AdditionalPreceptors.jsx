// PRECEPTOR-MODEL-3 (Part B): Additional (secondary / coverage) preceptors for a student.
//
// Read-only-by-default display of a student's ACTIVE secondary/coverage assignments from
// student_preceptor_assignments (read via the table's Owner/Admin SELECT RLS — non-admins get an
// empty set and see nothing here), plus an Owner/Admin "assign additional preceptor" flow that POSTs
// to the server-verified /api/preceptor-assignments endpoint. The PRIMARY preceptor is rendered
// separately by StudentSidePanel from students.preceptor_id (authoritative, unchanged) — this
// component never touches primary, never writes the table directly, and never changes survey routing.
//
// PLANNED/STANDING coverage only. Single-shift substitution is a future shift-log concern.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

const ROLE_LABELS  = { secondary: 'Secondary', coverage: 'Coverage' }
const ROLE_OPTIONS = ['secondary', 'coverage']

export default function AdditionalPreceptors({ student, preceptors = [], canEdit = false }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [preceptorId, setPreceptorId] = useState('')
  const [role, setRole]       = useState('secondary')
  const [startDate, setStart] = useState('')
  const [endDate, setEnd]     = useState('')
  const [notes, setNotes]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [msg, setMsg]         = useState(null) // { type: 'error'|'success', text }

  const precById = useMemo(() => new Map(preceptors.map(p => [p.id, p])), [preceptors])
  const studentId = student?.id
  const cohortId  = student?.cohort_id

  const load = useCallback(async () => {
    // The assignment invariant is cohort-scoped (student_id + cohort_id + preceptor_id), so scope the
    // read to this student AND cohort — avoids cross-cohort display confusion if the same student/
    // preceptor relationship recurs in a later cohort.
    if (!studentId || !cohortId) { setRows([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('student_preceptor_assignments')
      .select('id, preceptor_id, role, status, start_date, end_date, notes')
      .eq('student_id', studentId)
      .eq('cohort_id', cohortId)
      .eq('status', 'active')
      .in('role', ROLE_OPTIONS)
    setRows(data || [])
    setLoading(false)
  }, [studentId, cohortId])

  useEffect(() => { load() }, [load])

  async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }
      : null
  }

  const submit = async () => {
    if (!preceptorId) { setMsg({ type: 'error', text: 'Select a preceptor.' }); return }
    setBusy(true); setMsg(null)
    const headers = await authHeaders()
    if (!headers) { setBusy(false); setMsg({ type: 'error', text: 'Session expired. Refresh and try again.' }); return }
    try {
      const res = await fetch('/api/preceptor-assignments', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          studentId, preceptorId, role,
          startDate: startDate || undefined,
          endDate:   endDate || undefined,
          notes:     notes || undefined,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (res.ok) {
        setMsg({ type: 'success', text: 'Additional preceptor assigned.' })
        setFormOpen(false); setPreceptorId(''); setRole('secondary'); setStart(''); setEnd(''); setNotes('')
        await load()
      } else {
        setMsg({ type: 'error', text: payload?.error || 'Could not assign preceptor.' })
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error. Check your connection.' })
    } finally {
      setBusy(false)
    }
  }

  const endAssignment = async (row) => {
    if (!window.confirm('End this additional preceptor assignment? This will remove it from the active assignment list.')) return
    setBusy(true); setMsg(null)
    const headers = await authHeaders()
    if (!headers) { setBusy(false); setMsg({ type: 'error', text: 'Session expired. Refresh and try again.' }); return }
    try {
      const res = await fetch('/api/preceptor-assignments', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ assignmentId: row.id, status: 'ended' }),
      })
      const payload = await res.json().catch(() => null)
      if (res.ok) { await load() }
      else setMsg({ type: 'error', text: payload?.error || 'Could not end assignment.' })
    } catch {
      setMsg({ type: 'error', text: 'Network error. Check your connection.' })
    } finally {
      setBusy(false)
    }
  }

  // Non-admins (RLS returns no rows) with nothing to show: render nothing.
  if (!canEdit && rows.length === 0) return null

  const link = { fontSize: 11, color: '#1D2567', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontFamily: 'DM Sans,sans-serif' }
  const input = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #e5e7eb', fontFamily: 'DM Sans,sans-serif', width: '100%' }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #ececec' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: '#9ca3af', marginBottom: 6 }}>
        Additional preceptors
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: '#9ca3af' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, color: '#9ca3af' }}>No additional preceptors.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {rows.map(r => {
            const p = precById.get(r.preceptor_id)
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{p?.full_name || '(preceptor)'}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#3730a3', background: '#eef2ff', padding: '1px 6px', borderRadius: 4 }}>
                  {ROLE_LABELS[r.role] || r.role}
                </span>
                {canEdit && (
                  <button onClick={() => endAssignment(r)} disabled={busy} style={{ ...link, color: '#9A3412' }}>
                    End
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {msg && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: msg.type === 'error' ? '#dc2626' : '#2f6b34' }}>
          {msg.text}
        </div>
      )}

      {canEdit && !formOpen && (
        <button onClick={() => { setFormOpen(true); setMsg(null) }} style={{ ...link, marginTop: 8 }}>
          + Assign additional preceptor
        </button>
      )}

      {canEdit && formOpen && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320 }}>
          <select value={preceptorId} onChange={e => setPreceptorId(e.target.value)} style={input}>
            <option value="">Select preceptor…</option>
            {[...preceptors]
              .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
              .map(p => <option key={p.id} value={p.id}>{p.full_name}{p.unit_name ? ` — ${p.unit_name}` : ''}</option>)}
          </select>
          <select value={role} onChange={e => setRole(e.target.value)} style={input}>
            {ROLE_OPTIONS.map(rk => <option key={rk} value={rk}>{ROLE_LABELS[rk]}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="date" value={startDate} onChange={e => setStart(e.target.value)} style={input} aria-label="Start date" />
            <input type="date" value={endDate} onChange={e => setEnd(e.target.value)} style={input} aria-label="End date" />
          </div>
          <input value={notes} onChange={e => setNotes(e.target.value.slice(0, 500))} placeholder="Notes (optional)" style={input} />
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button onClick={submit} disabled={busy}
              style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: busy ? '#9ca3af' : '#1D2567', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans,sans-serif' }}>
              {busy ? 'Saving…' : 'Assign'}
            </button>
            <button onClick={() => { setFormOpen(false); setMsg(null) }} disabled={busy}
              style={{ fontSize: 12, fontWeight: 600, color: '#374151', background: '#f3f4f6', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontFamily: 'DM Sans,sans-serif' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { resolvePreceptor } from '../../lib/preceptor'
import { getStudentPreferredFullName } from '../../lib/studentNameFormatters'

// Owner/Admin-only manual send flow for the ASPIRE Preceptor Student Progress &
// Readiness Feedback survey. Evaluation-specific - NOT the Connect/Outreach bulk path.
// Select up to 5 students, pick a feedback period, review each resolved preceptor, and
// send. The endpoint resolves recipients server-side and enforces idempotency.

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'
const MAX_BATCH = 5
const CONFIRMATION = 'SEND FEEDBACK REQUESTS'

const PERIOD_OPTIONS = [
  { value: 'midpoint',        label: 'Midpoint' },
  { value: 'end_of_rotation', label: 'End of Rotation' },
  { value: 'other_interim',   label: 'Other / Interim Check-In' },
]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function emailIsSafe(v) {
  return typeof v === 'string' && EMAIL_PATTERN.test(v.trim())
}

// Determine the recipient state for a resolved preceptor.
function recipientState(resolved) {
  if (!resolved || (!resolved.name && !resolved.email)) {
    return { ok: false, tone: 'missing', text: 'No preceptor on file' }
  }
  if (resolved.source === 'normalized' && resolved.record?.is_active === false) {
    return { ok: false, tone: 'inactive', text: 'Preceptor is inactive' }
  }
  if (!emailIsSafe(resolved.email || '')) {
    return { ok: false, tone: 'invalid', text: 'Preceptor email missing or invalid' }
  }
  return { ok: true, tone: 'ok', text: resolved.email }
}

const toneColor = {
  ok:       { fg: '#166534', bg: '#EDF7F0' },
  missing:  { fg: '#92400e', bg: '#FBF5E8' },
  inactive: { fg: '#92400e', bg: '#FBF5E8' },
  invalid:  { fg: '#991b1b', bg: '#FEECEC' },
}

export default function PreceptorFeedbackPanel({ cohortId }) {
  const { isOwner, isAdmin } = useAuth()
  const canSend = isOwner || isAdmin

  const [students, setStudents] = useState([])
  const [preceptors, setPreceptors] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)

  const [period, setPeriod] = useState('midpoint')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [confirmPhrase, setConfirmPhrase] = useState('')
  const [sending, setSending] = useState(false)
  // PRECEPTOR-ROUTE-1: active secondary/coverage assignments for the cohort's students
  // (studentId -> [{ id, role, name, email }]) and the Owner's per-student selection
  // ('' / absent = primary). Canonical rows only; the server re-validates every selection.
  const [alternatesByStudent, setAlternatesByStudent] = useState(new Map())
  const [redirects, setRedirects] = useState(new Map())
  const [result, setResult] = useState(null)
  const [sendError, setSendError] = useState(null)

  useEffect(() => {
    if (!cohortId || !canSend) return
    let cancelled = false
    setLoading(true); setLoadError(null)
    Promise.all([
      supabase
        .from('students')
        .select('id, first_name, last_name, status, preceptor_id, preceptor_email, matched_preceptor')
        .eq('cohort_id', cohortId)
        .order('last_name').order('first_name'),
      supabase
        .from('preceptors')
        .select('id, full_name, email, unit_name, shift_type, is_active'),
      supabase
        .from('student_preceptor_assignments')
        .select('student_id, preceptor_id, role')
        .eq('cohort_id', cohortId)
        .eq('status', 'active')
        .in('role', ['secondary', 'coverage']),
    ]).then(([sRes, pRes, aRes]) => {
      if (cancelled) return
      if (sRes.error) setLoadError(sRes.error)
      setStudents(sRes.data || [])
      setPreceptors(pRes.data || [])
      // PRECEPTOR-ROUTE-1: sendable canonical alternates per student (active
      // secondary/coverage with a live preceptor record and an email on file).
      const precById = new Map((pRes.data || []).map(pr => [pr.id, pr]))
      const alts = new Map()
      for (const row of aRes.data || []) {
        const prec = precById.get(row.preceptor_id)
        if (!prec || prec.is_active === false || !(prec.email || '').trim()) continue
        if (!alts.has(row.student_id)) alts.set(row.student_id, [])
        alts.get(row.student_id).push({ id: row.preceptor_id, role: row.role, name: prec.full_name, email: prec.email })
      }
      setAlternatesByStudent(alts)
      setLoading(false)
    }).catch(e => { if (!cancelled) { setLoadError(e); setLoading(false) } })
    return () => { cancelled = true }
  }, [cohortId, canSend])

  // Reset transient state when the period changes.
  useEffect(() => { setResult(null); setSendError(null); setConfirmPhrase(''); setRedirects(new Map()) }, [period])

  const rows = useMemo(() => students.map(s => {
    const resolved = resolvePreceptor(s, preceptors)
    return { student: s, resolved, state: recipientState(resolved) }
  }), [students, preceptors])

  const selectedRows = rows.filter(r => selectedIds.has(r.student.id))
  const sendableCount = selectedRows.filter(r => r.state.ok).length
  const blockedCount = selectedRows.length - sendableCount

  const toggle = useCallback((id) => {
    setResult(null); setSendError(null)
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < MAX_BATCH) next.add(id)
      return next
    })
  }, [])

  const phraseOk = confirmPhrase === CONFIRMATION
  const canSubmit = canSend && !sending && selectedRows.length > 0 && phraseOk

  const handleSend = useCallback(async () => {
    if (!canSubmit) return
    setSending(true); setResult(null); setSendError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setSendError('Your session expired. Please sign in again.'); setSending(false); return }
      const items = selectedRows.map(r => {
        const redirect = redirects.get(r.student.id)
        return { student_id: r.student.id, ...(redirect ? { redirect_preceptor_id: redirect } : {}) }
      })
      const res = await fetch('/api/evaluation-send-preceptor-invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ items, period, confirmation_phrase: CONFIRMATION }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.success) {
        setSendError(body.error || `Send failed (HTTP ${res.status}).`)
      } else {
        setResult(body)
        setSelectedIds(new Set())
        setConfirmPhrase('')
      }
    } catch {
      setSendError('Network error. Please try again.')
    } finally {
      setSending(false)
    }
  }, [canSubmit, selectedRows, period, redirects])

  if (!canSend) {
    return (
      <div style={{ padding: '32px 20px', color: '#9ca3af', fontSize: 14, fontFamily: F }}>
        Preceptor feedback requests can only be sent by an Owner or Admin.
      </div>
    )
  }

  const sel = {
    fontSize: 13, padding: '7px 12px', borderRadius: 6,
    border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontFamily: F,
  }

  return (
    <div style={{ padding: '4px 20px 32px', maxWidth: 1100, fontFamily: F }}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#191919', margin: '0 0 4px' }}>
          Preceptor Feedback Requests
        </h2>
        <p style={{ fontSize: 13, color: '#9ca3af', margin: 0, lineHeight: 1.6 }}>
          Send the Preceptor Student Readiness Assessment to each
          selected student&rsquo;s preceptor. This is developmental and readiness feedback, not a
          hiring tool. Up to {MAX_BATCH} students per send.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Feedback period</label>
        <select value={period} onChange={e => setPeriod(e.target.value)} style={sel}>
          {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span style={{ fontSize: 12.5, color: '#6b7280' }}>
          {selectedRows.length} selected{selectedRows.length >= MAX_BATCH ? ` (max ${MAX_BATCH})` : ''}
          {blockedCount > 0 && ` · ${blockedCount} will be skipped`}
        </span>
      </div>

      {loading && <div style={{ padding: '32px 0', color: '#9ca3af', fontSize: 14 }}>Loading students…</div>}
      {loadError && <div style={{ padding: '16px 0', color: '#dc2626', fontSize: 14 }}>Error loading students: {loadError.message}</div>}

      {!loading && !loadError && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: F }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '10px 14px', width: 44 }}></th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280' }}>STUDENT</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280' }}>RESOLVED PRECEPTOR</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280' }}>RECIPIENT</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={4} style={{ padding: '28px', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No students in this cohort.</td></tr>
              )}
              {rows.map(({ student, resolved, state }, idx) => {
                const checked = selectedIds.has(student.id)
                const disabled = !checked && selectedIds.size >= MAX_BATCH
                const tc = toneColor[state.tone] || toneColor.invalid
                return (
                  <tr key={student.id} style={{ background: idx % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(student.id)}
                        style={{ width: 17, height: 17, accentColor: NAVY, cursor: disabled ? 'not-allowed' : 'pointer' }}
                        aria-label={`Select ${student.first_name} ${student.last_name}`}
                      />
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: '#191919', fontWeight: 600 }}>
                      {getStudentPreferredFullName(student)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: '#374151' }}>
                      {resolved.name || <span style={{ color: '#9ca3af' }}>-</span>}
                      {resolved.unit_name && <span style={{ color: '#9ca3af', fontSize: 12 }}> · {resolved.unit_name}</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 8,
                        background: tc.bg, color: tc.fg, display: 'inline-block',
                      }}>
                        {state.text}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation + send */}
      {selectedRows.length > 0 && (
        <div style={{ marginTop: 20, padding: 18, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 10, lineHeight: 1.6 }}>
            Sending <strong>{PERIOD_OPTIONS.find(o => o.value === period)?.label}</strong> feedback requests for{' '}
            <strong>{sendableCount}</strong> preceptor{sendableCount === 1 ? '' : 's'}.
            {blockedCount > 0 && <> {blockedCount} selected student{blockedCount === 1 ? '' : 's'} will be skipped (missing/inactive/invalid preceptor).</>}
          </div>

          {/* PRECEPTOR-ROUTE-1: recipient selection for students with active canonical
              alternates. Primary is always the default; the server re-validates every
              selection against the same active-assignment rows before sending. */}
          {selectedRows.some(r => r.state.ok && (alternatesByStudent.get(r.student.id) || []).length > 0) && (
            <div style={{ margin: '0 0 12px', padding: '10px 12px', background: '#f8f9fc', borderRadius: 10, border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Recipient per student
              </div>
              {selectedRows.filter(r => r.state.ok && (alternatesByStudent.get(r.student.id) || []).length > 0).map(r => {
                const alts = alternatesByStudent.get(r.student.id) || []
                const chosen = redirects.get(r.student.id) || ''
                return (
                  <div key={r.student.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, color: '#191919', fontWeight: 600, minWidth: 160 }}>
                      {r.student.last_name}, {r.student.first_name}
                    </span>
                    <select
                      value={chosen}
                      onChange={e => {
                        const v = e.target.value
                        setRedirects(prev => {
                          const next = new Map(prev)
                          if (v) next.set(r.student.id, v); else next.delete(r.student.id)
                          return next
                        })
                      }}
                      aria-label={`Assessment recipient for ${r.student.first_name} ${r.student.last_name}`}
                      style={{ ...sel, minWidth: 240 }}
                    >
                      <option value="">{`${r.resolved.name || '-'} — Primary`}</option>
                      {alts.map(a => (
                        <option key={a.id} value={a.id}>{`${a.name} — ${a.role === 'coverage' ? 'Coverage' : 'Secondary'}`}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: '#6b7280' }}>Type <strong>{CONFIRMATION}</strong> to confirm:</span>
            <input
              value={confirmPhrase}
              onChange={e => setConfirmPhrase(e.target.value)}
              placeholder={CONFIRMATION}
              style={{ ...sel, minWidth: 230 }}
            />
            <button
              onClick={handleSend}
              disabled={!canSubmit}
              style={{
                padding: '9px 20px', background: canSubmit ? NAVY : '#c7cbd9', color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
                fontFamily: F, cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {sending ? 'Sending…' : `Send ${sendableCount} request${sendableCount === 1 ? '' : 's'}`}
            </button>
          </div>
          {sendError && <div style={{ marginTop: 10, color: '#dc2626', fontSize: 13 }}>{sendError}</div>}
        </div>
      )}

      {/* Result summary */}
      {result && (
        <div style={{ marginTop: 18, padding: 18, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#191919', marginBottom: 8 }}>
            Sent {result.summary.total_sent} · Skipped {result.summary.total_skipped} · Failed {result.summary.total_failed}
          </div>
          {result.sent?.length > 0 && (
            <div style={{ fontSize: 12.5, color: '#166534', marginBottom: 6 }}>
              ✓ Sent: {result.sent.map(s => s.student_name).join(', ')}
            </div>
          )}
          {result.skipped?.length > 0 && (
            <div style={{ fontSize: 12.5, color: '#92400e', marginBottom: 6 }}>
              ⊘ Skipped: {result.skipped.map(s => `${s.student_name || s.student_id} (${s.reason})`).join('; ')}
            </div>
          )}
          {result.failed?.length > 0 && (
            <div style={{ fontSize: 12.5, color: '#991b1b' }}>
              ✕ Failed: {result.failed.map(s => `${s.student_name || s.student_id} (${s.reason})`).join('; ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { classifyStudentEvalCohort } from '../../lib/evaluation/studentEvalDueDetection'

// SR-2b-1 — READ-ONLY due-detection queue for the Student Evaluation of Preceptor/Unit
// Experience survey (slug: student_preceptor_eval). Recipient is the STUDENT.
//
// Detection is live-computed by the pure studentEvalDueDetection module (students,
// preceptors, student_preceptor_eval assignments via the existing Owner/Admin RLS SELECT
// policies). This phase is EVIDENCE ONLY: NO release/send button, NO assignment/token
// creation, NO Resend, NO notification_log, NO cron. "Ready to release" is status text.

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

const GROUPS = [
  { key: 'due_sendable',        label: 'Ready to release',      fg: '#166534', bg: '#EDF7F0' },
  { key: 'due_unsendable',      label: 'Needs attention',       fg: '#991b1b', bg: '#FEECEC' },
  { key: 'suppressed_existing', label: 'Suppressed (existing)', fg: '#1D2567', bg: '#EEF1FB' },
  { key: 'ineligible_hours',    label: 'Ineligible hours',      fg: '#92400e', bg: '#FBF5E8' },
  { key: 'not_due',             label: 'Not due',               fg: '#4A5560', bg: '#F4F3F1' },
]

function fmtHours(n) {
  if (n == null) return '—'
  return Number.isInteger(n) ? String(n) : Number(n).toFixed(2)
}

export default function StudentEvalAutomationPanel({ cohortId }) {
  const { isOwner, isAdmin } = useAuth()
  const canView = isOwner || isAdmin

  const [students, setStudents] = useState([])
  const [preceptors, setPreceptors] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [detectedAtMs, setDetectedAtMs] = useState(0)

  const load = useCallback(async () => {
    if (!cohortId || !canView) return
    setLoading(true); setError(null)
    try {
      const [sRes, pRes, aRes] = await Promise.all([
        supabase
          .from('students')
          .select('id, first_name, last_name, school, program_type, approved_hours, hours_required, personal_email, school_email, preceptor_id, matched_preceptor')
          .eq('cohort_id', cohortId)
          .order('last_name').order('first_name'),
        supabase
          .from('preceptors')
          .select('id, full_name, unit_name'),
        // student_preceptor_eval assignments for this cohort only. Filter by instrument slug
        // (client-side) so this never counts preceptor_progress or Casey-Fink assignments.
        // READ-ONLY select.
        supabase
          .from('evaluation_assignments')
          .select(`
            id, student_id, status, revoked_at, completed_at, expires_at, sent_at, created_at,
            evaluation_instruments!inner ( slug )
          `)
          .eq('cohort_id', cohortId),
      ])
      if (sRes.error) throw sRes.error
      if (pRes.error) throw pRes.error
      if (aRes.error) throw aRes.error
      setStudents(sRes.data || [])
      setPreceptors(pRes.data || [])
      const slugFor = (a) => {
        const inst = a.evaluation_instruments
        const i = Array.isArray(inst) ? inst[0] : inst
        return i?.slug
      }
      setAssignments((aRes.data || []).filter(a => slugFor(a) === 'student_preceptor_eval'))
      setDetectedAtMs(Date.now())
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [cohortId, canView])

  useEffect(() => { load() }, [load])

  const { rows, summary } = useMemo(
    () => classifyStudentEvalCohort({ students, preceptors, assignments, nowMs: detectedAtMs || Date.now() }),
    [students, preceptors, assignments, detectedAtMs]
  )

  const grouped = useMemo(() => {
    const g = {}
    for (const grp of GROUPS) g[grp.key] = []
    for (const r of rows) (g[r.classification] ||= []).push(r)
    return g
  }, [rows])

  if (!canView) {
    return (
      <div style={{ padding: '32px 20px', color: '#9ca3af', fontSize: 14, fontFamily: F }}>
        Student survey automation detection is visible to Owner/Admin only.
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 20px 32px', maxWidth: 1200, fontFamily: F }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#191919', margin: '0 0 4px' }}>
          Student Evaluation of Preceptor/Unit — Recipient: Student
        </h2>
        <p style={{ fontSize: 13, color: '#9ca3af', margin: 0, lineHeight: 1.6 }}>
          Read-only detection of students due for the post-rotation Student Evaluation of
          Preceptor/Unit Experience survey. Due at ≥ 100% of required hours. The recipient is
          the student; the preceptor/unit is the evaluated target (context only).
        </p>
      </div>

      {/* Read-only banner — this surface never sends, releases, or writes */}
      <div style={{
        fontSize: 12.5, color: '#1D2567', background: '#EEF1FB', border: '1px solid #d7ddf5',
        borderRadius: 8, padding: '10px 14px', marginBottom: 18, lineHeight: 1.55,
      }}>
        <strong>Read-only.</strong> Detection evidence only (SR-2b-1). Nothing is sent, queued,
        or written — no assignments, tokens, emails, or schedules are created here. "Ready to
        release" is a status label, not an action.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '7px 14px', background: NAVY, color: '#fff', border: 'none', borderRadius: 7,
            fontSize: 12.5, fontWeight: 600, fontFamily: F, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Detecting…' : 'Re-run detection'}
        </button>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>
          {detectedAtMs ? `Detected ${new Date(detectedAtMs).toLocaleString('en-US')}` : ''}
        </span>
      </div>

      {error && (
        <div style={{ padding: '14px 0', color: '#dc2626', fontSize: 14 }}>
          Error running detection: {error.message}
        </div>
      )}

      {!error && (
        <>
          {/* Summary counts */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
            {GROUPS.map(g => (
              <div key={g.key} style={{
                background: g.bg, borderRadius: 10, padding: '10px 16px', minWidth: 120,
                border: '1px solid rgba(29,37,103,0.06)',
              }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: g.fg, lineHeight: 1 }}>
                  {summary[g.key] ?? 0}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: g.fg, marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {g.label}
                </div>
              </div>
            ))}
          </div>

          {/* Grouped read-only tables (no release/send action in SR-2b-1) */}
          {GROUPS.map(g => {
            const list = grouped[g.key] || []
            return (
              <div key={g.key} style={{ marginBottom: 26 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: g.fg, marginBottom: 8 }}>
                  {g.label} <span style={{ color: '#9ca3af', fontWeight: 500 }}>({list.length})</span>
                </div>
                {list.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: '#9ca3af', padding: '4px 0' }}>None.</div>
                ) : (
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: F }}>
                      <thead>
                        <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          {['Student', 'Approved / Required', 'Recipient (student)', 'Evaluated target', 'Reason'].map(h => (
                            <th key={h} style={{ padding: '9px 13px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((r, idx) => (
                          <tr key={r.studentId} style={{ background: idx % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '9px 13px', fontSize: 13, color: '#191919', fontWeight: 600 }}>
                              {r.studentName}
                              {(r.school || r.programType) && (
                                <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
                                  {[r.school, r.programType].filter(Boolean).join(' · ')}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>
                              {fmtHours(r.approvedHours)} / {fmtHours(r.hoursRequired)}
                            </td>
                            <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151' }}>
                              {r.studentEmail || <span style={{ color: '#991b1b' }}>— none on file</span>}
                            </td>
                            <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151' }}>
                              {r.evaluatedTarget?.available ? (
                                <>
                                  {r.evaluatedTarget.preceptor_name || '—'}
                                  {r.evaluatedTarget.unit && <span style={{ color: '#9ca3af', fontSize: 12 }}> · {r.evaluatedTarget.unit}</span>}
                                </>
                              ) : (
                                <span style={{ color: '#9ca3af' }}>target unavailable (context only)</span>
                              )}
                            </td>
                            <td style={{ padding: '9px 13px', fontSize: 12, color: '#4b5563', lineHeight: 1.5 }}>
                              {r.reason}
                              {r.suppressing && (
                                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                                  ↳ {r.suppressing.state}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}

          {!loading && students.length === 0 && (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
              No students in this cohort.
            </div>
          )}
        </>
      )}
    </div>
  )
}

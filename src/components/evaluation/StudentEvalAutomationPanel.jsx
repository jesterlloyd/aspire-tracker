import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { classifyStudentEvalCohort } from '../../lib/evaluation/studentEvalDueDetection'
import { RELEASE_ROUTES } from '../../lib/evaluation/releaseRouting'

// ROUTING-HOTFIX-1: this panel releases ONLY the Student Feedback workflow, via its own explicit
// route entry. It can never call another workflow's endpoint.
const ROUTE = RELEASE_ROUTES.student

// SR-2b-1 - READ-ONLY due-detection queue for the Student Evaluation of Preceptor/Unit
// Experience survey (slug: student_preceptor_eval). Recipient is the STUDENT.
//
// Detection is live-computed by the pure studentEvalDueDetection module (students,
// preceptors, student_preceptor_eval assignments via the existing Owner/Admin RLS SELECT
// policies). This phase is EVIDENCE ONLY: NO release/send button, NO assignment/token
// creation, NO Resend, NO notification_log, NO cron. "Ready to release" is status text.

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

const GROUPS = [
  { key: 'due_sendable',        label: 'Ready to release',      fg: '#166534', bg: '#EDF7F0', releasable: true },
  { key: 'due_unsendable',      label: 'Needs attention',       fg: '#991b1b', bg: '#FEECEC' },
  { key: 'suppressed_existing', label: 'Suppressed (existing)', fg: '#1D2567', bg: '#EEF1FB' },
  { key: 'ineligible_hours',    label: 'Ineligible hours',      fg: '#92400e', bg: '#FBF5E8' },
  { key: 'not_due',             label: 'Not due',               fg: '#4A5560', bg: '#F4F3F1' },
]

function fmtHours(n) {
  if (n == null) return '-'
  return Number.isInteger(n) ? String(n) : Number(n).toFixed(2)
}

export default function StudentEvalAutomationPanel({ cohortId, onCounts, active }) {
  const { isOwner, isAdmin } = useAuth()
  const canView = isOwner || isAdmin

  const [students, setStudents] = useState([])
  const [preceptors, setPreceptors] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [detectedAtMs, setDetectedAtMs] = useState(0)

  // Release state (SR-2b-2)
  const [confirm, setConfirm] = useState(null)        // row pending release confirmation
  const [releasing, setReleasing] = useState(false)
  const [releaseMsg, setReleaseMsg] = useState(null)  // { tone:'ok'|'err', text }
  // ROUTING-HOTFIX-1B: set true only when the post-send identity tripwire fires. A tripwire failure
  // means a release may already have completed against an unexpected workflow, so we HALT further
  // release actions in this panel until the operator re-runs detection and verifies. This prevents a
  // blind retry from sending a duplicate.
  const [identityHold, setIdentityHold] = useState(false)

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

  // SR-2b-2: release one due_sendable item. Sends only { student_id } - the server
  // re-validates (SR-2b-1 detector) and resolves the student recipient. No recipient override.
  const doRelease = useCallback(async (row) => {
    setReleasing(true); setReleaseMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setReleaseMsg({ tone: 'err', text: 'Your session expired. Please sign in again.' })
        setReleasing(false); return
      }
      const res = await fetch(ROUTE.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        // Pre-send workflow guard: the server refuses if its instrument is not Student Feedback.
        body: JSON.stringify({ student_id: row.studentId, expected_instrument_slug: ROUTE.instrumentSlug }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.released) {
        // Post-send tripwire: the released workflow identity must match this panel's workflow.
        if (body.instrument_slug !== ROUTE.instrumentSlug || body.timepoint !== ROUTE.timepoint) {
          setIdentityHold(true)
          setReleaseMsg({ tone: 'err', text: `Release identity mismatch for ${row.studentName}. The server reported ${body.instrument_slug}/${body.timepoint}, not the expected ${ROUTE.instrumentSlug}/${ROUTE.timepoint}. This release may have completed and an email may have been sent. Do NOT retry: verify in the send log first, since retrying could send a duplicate. Re-run detection to confirm the current state.` })
        } else {
          setReleaseMsg({ tone: 'ok', text: `Released, survey sent to ${body.student_email || 'the student'} for ${row.studentName}.` })
        }
      } else {
        setReleaseMsg({ tone: 'err', text: `Release refused for ${row.studentName}: ${body.reason || body.error || 'no longer sendable'}` })
      }
    } catch {
      setReleaseMsg({ tone: 'err', text: 'Network error. Please try again.' })
    } finally {
      setReleasing(false)
      setConfirm(null)
      await load() // refresh detection - a released item moves to suppressed_existing
    }
  }, [load])

  const grouped = useMemo(() => {
    const g = {}
    for (const grp of GROUPS) g[grp.key] = []
    for (const r of rows) (g[r.classification] ||= []).push(r)
    return g
  }, [rows])

  // SURVEY-UX-2 - report this survey's already-computed counts up to the dashboard status
  // band (presentational rollup only; no detection change). summary is memoized, so this
  // fires only when detection actually changes.
  useEffect(() => { onCounts?.(summary) }, [onCounts, summary])

  // SURVEY-UX-3 - render the full-width detail body only when this is the selected workflow.
  // Detection + count reporting hooks above still run regardless, so the summary card and
  // status band stay live even while this workflow's detail is not shown.
  if (!active) return null

  if (!canView) {
    return (
      <div style={{ padding: '32px 20px', color: '#9ca3af', fontSize: 14, fontFamily: F }}>
        Student survey automation detection is visible to Owner/Admin only.
      </div>
    )
  }

  return (
    <>
      <div style={{ fontFamily: F }}>
      {/* Workspace header - restates the selected workflow + recipient. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#191919', margin: 0 }}>Student Feedback: Preceptor & Unit</h2>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#1D2567', background: '#EEF1FB',
          border: '1px solid #d7ddf5', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap',
        }}>
          Recipient: Student
        </span>
      </div>
      <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 16px', lineHeight: 1.6 }}>
        Read-only detection of students due for the post-rotation Student Evaluation of
        Preceptor/Unit Experience survey. Due at ≥ 100% of required hours. The recipient is
        the student; the preceptor/unit is the evaluated target (context only).
      </p>

      {/* Banner - human-approved per-student release; no auto-send/cron/bulk */}
      <div style={{
        fontSize: 12.5, color: '#1D2567', background: '#EEF1FB', border: '1px solid #d7ddf5',
        borderRadius: 8, padding: '10px 14px', marginBottom: 18, lineHeight: 1.55,
      }}>
        <strong>Human-approved sends only.</strong> Releasing re-checks eligibility on the
        server and emails the student the survey. The recipient is resolved server-side from
        the student record, there is no recipient field, no auto-send, and no bulk release.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => { setIdentityHold(false); load() }}
          disabled={loading || releasing}
          style={{
            padding: '7px 14px', background: NAVY, color: '#fff', border: 'none', borderRadius: 7,
            fontSize: 12.5, fontWeight: 600, fontFamily: F, cursor: (loading || releasing) ? 'default' : 'pointer', opacity: (loading || releasing) ? 0.6 : 1,
          }}
        >
          {loading ? 'Detecting…' : 'Re-run detection'}
        </button>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>
          {detectedAtMs ? `Detected ${new Date(detectedAtMs).toLocaleString('en-US')}` : ''}
        </span>
      </div>

      {releaseMsg && (
        <div style={{
          fontSize: 13, borderRadius: 8, padding: '10px 14px', marginBottom: 16, lineHeight: 1.5,
          background: releaseMsg.tone === 'ok' ? '#EDF7F0' : '#FEECEC',
          color: releaseMsg.tone === 'ok' ? '#166534' : '#991b1b',
          border: `1px solid ${releaseMsg.tone === 'ok' ? '#c6e7d0' : '#f3c6c6'}`,
        }}>
          {releaseMsg.text}
        </div>
      )}

      {error && (
        <div style={{ padding: '14px 0', color: '#dc2626', fontSize: 14 }}>
          Error running detection: {error.message}
        </div>
      )}

      {!error && (
        <>
          {/* Grouped tables. Only the releasable group (due_sendable) shows a Release action. */}
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
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: F }}>
                      <thead>
                        <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          {['Student', 'Approved / Required', 'Recipient (student)', 'Evaluated target', 'Reason'].map(h => (
                            <th key={h} style={{ padding: '9px 13px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280' }}>{h}</th>
                          ))}
                          {g.releasable && <th style={{ padding: '9px 13px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#6b7280' }}>Action</th>}
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
                              {r.studentEmail || <span style={{ color: '#991b1b' }}>- none on file</span>}
                            </td>
                            <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151' }}>
                              {r.evaluatedTarget?.available ? (
                                <>
                                  {r.evaluatedTarget.preceptor_name || '-'}
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
                            {g.releasable && (
                              <td style={{ padding: '9px 13px', textAlign: 'right' }}>
                                <button
                                  onClick={() => { setReleaseMsg(null); setConfirm(r) }}
                                  disabled={releasing || identityHold}
                                  style={{
                                    padding: '6px 14px', background: '#166534', color: '#fff', border: 'none',
                                    borderRadius: 7, fontSize: 12, fontWeight: 600, fontFamily: F,
                                    cursor: (releasing || identityHold) ? 'default' : 'pointer', opacity: (releasing || identityHold) ? 0.6 : 1, whiteSpace: 'nowrap',
                                  }}
                                >
                                  Release
                                </button>
                              </td>
                            )}
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

      {/* Release confirmation - shows the server-resolved STUDENT recipient; no editable field. */}
      {confirm && (
        <div className="modal-overlay" onMouseDown={() => !releasing && setConfirm(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 460, fontFamily: F }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1D2567', fontFamily: F }}>
                Send student survey?
              </h2>
            </div>
            <div style={{ padding: '16px 20px', fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '6px 12px', marginBottom: 14 }}>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>Student</span><span style={{ fontWeight: 600, color: '#191919' }}>{confirm.studentName}</span>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>Recipient email</span><span>{confirm.studentEmail || '-'}</span>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>Hours</span><span>{fmtHours(confirm.approvedHours)} / {fmtHours(confirm.hoursRequired)}</span>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>Evaluated target</span>
                <span>{confirm.evaluatedTarget?.available
                  ? [confirm.evaluatedTarget.preceptor_name, confirm.evaluatedTarget.unit].filter(Boolean).join(' · ')
                  : 'unavailable (context only)'}</span>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: '#6b7280' }}>
                This emails the Student Feedback: Preceptor & Unit survey to the
                student above (Resend). Eligibility is re-checked on the server before sending.
              </p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn-outline-modal" onClick={() => setConfirm(null)} disabled={releasing}>Cancel</button>
              <button
                onClick={() => doRelease(confirm)}
                disabled={releasing}
                style={{
                  padding: '8px 18px', background: '#166534', color: '#fff', border: 'none',
                  borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: F,
                  cursor: releasing ? 'default' : 'pointer', opacity: releasing ? 0.6 : 1,
                }}
              >
                {releasing ? 'Sending…' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { classifyCohort, PERIOD_LABELS } from '../../lib/evaluation/preceptorDueDetection'
import SurveyAutomationCard from './SurveyAutomationCard'

// PS-3a/PS-3b — Survey Automation due-detection + Owner/Admin per-item RELEASE.
//
// Detection is READ-ONLY and live-computed by the pure preceptorDueDetection module
// (students, preceptors, preceptor_progress assignments via the existing Owner/Admin RLS
// SELECT policies). PS-3b adds a per-item Release control on due_sendable rows that calls
// the release endpoint (student_id + period only — no recipient override). The endpoint
// re-runs detection server-side and sends through the SAME shared core as the PS-2b manual
// send. There is NO queue table, NO cron, NO auto-send, and NO bulk/Release-All.

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
  if (n == null) return '—'
  return Number.isInteger(n) ? String(n) : Number(n).toFixed(2)
}

export default function PreceptorAutomationPanel({ cohortId }) {
  const { isOwner, isAdmin } = useAuth()
  const canView = isOwner || isAdmin

  const [students, setStudents] = useState([])
  const [preceptors, setPreceptors] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [detectedAtMs, setDetectedAtMs] = useState(0)

  // PS-3b release state
  const [confirm, setConfirm] = useState(null)        // row pending release confirmation
  const [releasing, setReleasing] = useState(false)
  const [releaseMsg, setReleaseMsg] = useState(null)  // { tone:'ok'|'err', text }

  // SURVEY-UX-1 — accordion expand/collapse (presentation only). Default collapsed;
  // the actionability effect below force-expands when there is anything actionable.
  const [expanded, setExpanded] = useState(false)
  const lastActionableDetectRef = useRef(0)

  const load = useCallback(async () => {
    if (!cohortId || !canView) return
    setLoading(true); setError(null)
    try {
      const [sRes, pRes, aRes] = await Promise.all([
        supabase
          .from('students')
          .select('id, first_name, last_name, approved_hours, hours_required, preceptor_id, preceptor_email, matched_preceptor')
          .eq('cohort_id', cohortId)
          .order('last_name').order('first_name'),
        supabase
          .from('preceptors')
          .select('id, full_name, email, unit_name, is_active'),
        // Preceptor assignments for this cohort. respondent_type filters to preceptor rows;
        // instrument slug is confirmed client-side. READ-ONLY select.
        supabase
          .from('evaluation_assignments')
          .select(`
            id, student_id, timepoint, status, revoked_at, completed_at, expires_at,
            notes, sent_at, created_at, respondent_type,
            evaluation_instruments!inner ( slug )
          `)
          .eq('cohort_id', cohortId)
          .eq('respondent_type', 'preceptor'),
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
      setAssignments((aRes.data || []).filter(a => slugFor(a) === 'preceptor_progress'))
      setDetectedAtMs(Date.now())
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [cohortId, canView])

  useEffect(() => { load() }, [load])

  const { rows, summary } = useMemo(
    () => classifyCohort({ students, preceptors, assignments, nowMs: detectedAtMs || Date.now() }),
    [students, preceptors, assignments, detectedAtMs]
  )

  const grouped = useMemo(() => {
    const g = {}
    for (const grp of GROUPS) g[grp.key] = []
    for (const r of rows) (g[r.classification] ||= []).push(r)
    return g
  }, [rows])

  // SURVEY-UX-1 — re-apply actionability on each fresh detection so a newly actionable
  // survey is never hidden. Force-expand (never force-collapse) when this detection has
  // anything Ready to release or Needs attention; manual collapse otherwise persists.
  const actionable = (summary.due_sendable || 0) > 0 || (summary.due_unsendable || 0) > 0
  useEffect(() => {
    if (detectedAtMs && detectedAtMs !== lastActionableDetectRef.current) {
      lastActionableDetectRef.current = detectedAtMs
      if (actionable) setExpanded(true)
    }
  }, [detectedAtMs, actionable])

  // PS-3b: release one due_sendable item. Sends only { student_id, period } — the server
  // re-validates and resolves the recipient. No recipient is ever sent from the client.
  const doRelease = useCallback(async (row) => {
    setReleasing(true); setReleaseMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setReleaseMsg({ tone: 'err', text: 'Your session expired. Please sign in again.' })
        setReleasing(false); return
      }
      // expected_preceptor_email is the recipient the Owner saw — sent for a server-side
      // mismatch check ONLY. The server still resolves the actual recipient from the student.
      const res = await fetch('/api/evaluation-release-preceptor-survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          student_id: row.studentId,
          period: row.period,
          ...(row.preceptorEmail ? { expected_preceptor_email: row.preceptorEmail } : {}),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.released) {
        setReleaseMsg({ tone: 'ok', text: `Released — survey sent to ${body.preceptor_name || body.preceptor_email || 'the preceptor'} for ${row.studentName} (${PERIOD_LABELS[row.period]}).` })
      } else {
        setReleaseMsg({ tone: 'err', text: `Release refused for ${row.studentName} (${PERIOD_LABELS[row.period]}): ${body.reason || body.error || 'no longer sendable'}` })
      }
    } catch {
      setReleaseMsg({ tone: 'err', text: 'Network error. Please try again.' })
    } finally {
      setReleasing(false)
      setConfirm(null)
      await load() // refresh detection — a released item moves to suppressed_existing
    }
  }, [load])

  if (!canView) {
    return (
      <div style={{ padding: '32px 20px', color: '#9ca3af', fontSize: 14, fontFamily: F }}>
        Survey automation detection is visible to Owner/Admin only.
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 20px 32px', maxWidth: 1200, fontFamily: F }}>
      <SurveyAutomationCard
        title="Preceptor Progress Feedback"
        recipientLabel="Preceptor"
        counts={summary}
        expanded={expanded}
        onToggle={() => setExpanded(e => !e)}
      >
      <div style={{ padding: '16px 18px' }}>
      <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 16px', lineHeight: 1.6 }}>
        Live-computed queue of students due for an automated preceptor survey. Midpoint is
        due at ≥ 50% of required hours; End of Rotation at ≥ 100%. Release is per-item and
        human-approved — there is no auto-send.
      </p>

      {/* Banner — no cron / no auto-send / no recipient override */}
      <div style={{
        fontSize: 12.5, color: '#1D2567', background: '#EEF1FB', border: '1px solid #d7ddf5',
        borderRadius: 8, padding: '10px 14px', marginBottom: 18, lineHeight: 1.55,
      }}>
        <strong>Human-approved sends only.</strong> Releasing re-checks eligibility on the
        server and sends the preceptor survey through the same path as a manual send. The
        recipient is resolved server-side from the student — there is no recipient field.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          onClick={load}
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
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: F }}>
                      <thead>
                        <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          {['Student', 'Period', 'Approved / Required', 'Preceptor', 'Reason'].map(h => (
                            <th key={h} style={{ padding: '9px 13px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280' }}>{h}</th>
                          ))}
                          {g.releasable && <th style={{ padding: '9px 13px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#6b7280' }}>Action</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((r, idx) => (
                          <tr key={`${r.studentId}-${r.period || 'na'}`} style={{ background: idx % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '9px 13px', fontSize: 13, color: '#191919', fontWeight: 600 }}>{r.studentName}</td>
                            <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151' }}>
                              {r.period ? PERIOD_LABELS[r.period] : '—'}
                            </td>
                            <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>
                              {fmtHours(r.approvedHours)} / {fmtHours(r.hoursRequired)}
                              {r.period && (
                                <span style={{ color: '#9ca3af' }}>
                                  {' '}· thr {fmtHours(r.period === 'midpoint' ? r.midpointThreshold : r.endThreshold)}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151' }}>
                              {r.preceptorName || <span style={{ color: '#9ca3af' }}>—</span>}
                              {r.preceptorEmail && <div style={{ fontSize: 11, color: '#9ca3af' }}>{r.preceptorEmail}</div>}
                            </td>
                            <td style={{ padding: '9px 13px', fontSize: 12, color: '#4b5563', lineHeight: 1.5 }}>
                              {r.reason}
                              {r.suppressing && (
                                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                                  ↳ {r.suppressing.state} · {r.suppressing.timepoint}
                                  {r.suppressing.notes ? ` · ${r.suppressing.notes}` : ''}
                                </div>
                              )}
                            </td>
                            {g.releasable && (
                              <td style={{ padding: '9px 13px', textAlign: 'right' }}>
                                <button
                                  onClick={() => { setReleaseMsg(null); setConfirm(r) }}
                                  disabled={releasing}
                                  style={{
                                    padding: '6px 14px', background: '#166534', color: '#fff', border: 'none',
                                    borderRadius: 7, fontSize: 12, fontWeight: 600, fontFamily: F,
                                    cursor: releasing ? 'default' : 'pointer', opacity: releasing ? 0.6 : 1, whiteSpace: 'nowrap',
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
      </SurveyAutomationCard>

      {/* Release confirmation — no editable recipient field. */}
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
                Release preceptor survey?
              </h2>
            </div>
            <div style={{ padding: '16px 20px', fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', marginBottom: 14 }}>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>Student</span><span style={{ fontWeight: 600, color: '#191919' }}>{confirm.studentName}</span>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>Period</span><span>{PERIOD_LABELS[confirm.period]}</span>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>Hours</span><span>{fmtHours(confirm.approvedHours)} / {fmtHours(confirm.hoursRequired)}</span>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>Preceptor</span>
                <span>
                  {confirm.preceptorName || '—'}
                  {confirm.preceptorEmail && <div style={{ fontSize: 12, color: '#6b7280' }}>{confirm.preceptorEmail}</div>}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: '#6b7280' }}>
                This will send the ASPIRE Preceptor Student Progress &amp; Readiness Feedback
                survey to the resolved preceptor via email (Resend). Eligibility is re-checked
                on the server before sending.
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
                {releasing ? 'Releasing…' : 'Confirm & Release'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

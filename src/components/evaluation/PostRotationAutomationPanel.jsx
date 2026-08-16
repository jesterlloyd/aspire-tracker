import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { RELEASE_ROUTES } from '../../lib/evaluation/releaseRouting'
import { classifyPostRotationCohort } from '../../lib/evaluation/postRotationCertDueDetection'
import { getStudentPreferredFullName } from '../../lib/studentNameFormatters'
import { shiftDrivesState } from '../../lib/shiftLifecycle'

// READ-ONLY eligible / in-flow queue for the ASPIRE Post-Rotation Evaluation workflow (slug:
// post_rotation_evaluation). Recipient is the STUDENT. This is NON-GATING experience feedback and
// is fully decoupled from certificate issuance: migration 20260710000000 replaced its RPC so it
// cannot issue one. Release is ACTIVE and human-approved, mirroring the Casey-Fink panel,
// creates tokens/assignments, issues certificates, or generates PDFs.
//
// Reads (Owner/Admin RLS SELECT policies): students + post_rotation_evaluation assignments.
// student_shift_logs powers the optional Last Shift column and the support-needed warning; it
// degrades gracefully if unavailable. Data loading uses react-query (the repo pattern).

const ROUTE = RELEASE_ROUTES.postRotation
const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

const STATUS_STYLE = {
  eligible_for_review:  { label: 'Eligible for Review',  fg: '#166534', bg: '#EDF7F0' },
  evaluation_released:  { label: 'Evaluation Released',  fg: '#1D2567', bg: '#EEF1FB' },
  evaluation_completed: { label: 'Evaluation Completed', fg: '#7c3aed', bg: '#F3EEFC' },
}

const COLS = ['Student', 'School', 'Unit', 'Approved', 'Required', 'Last Shift', 'Evaluation Status', 'Warnings', 'Action']

function fmtHours(n) {
  if (n == null) return '-'
  return Number.isInteger(n) ? String(n) : Number(n).toFixed(2)
}

function fmtDate(d) {
  if (!d) return '-'
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return '-'
  return t.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const EMPTY_SUMMARY = {
  due_sendable: 0, due_unsendable: 0, suppressed_existing: 0,
  ineligible_hours: 0, not_due: 0, eligible_for_review: 0, in_flow: 0,
}

// Read-only load of everything the queue needs, in the repo's react-query pattern.
// The captured detectedAtMs is taken here (event/async context, never during render).
async function loadPostRotationQueue(cohortId) {
  // Wave 1 (fatal): students + post_rotation_evaluation assignments + units for this cohort. The
  // unit NAME is resolved from the units table via students.matched_unit_id (the app-wide pattern);
  // there is no students.unit / students.matched_unit column.
  const [sRes, aRes, uRes] = await Promise.all([
    supabase
      .from('students')
      .select('id, first_name, last_name, preferred_first_name, school, program_type, matched_unit_id, approved_hours, hours_required, pending_hours, personal_email, school_email')
      .eq('cohort_id', cohortId)
      .order('last_name').order('first_name'),
    supabase
      .from('evaluation_assignments')
      .select(`
        id, student_id, status, revoked_at, completed_at, expires_at, sent_at, created_at,
        evaluation_instruments!inner ( slug )
      `)
      .eq('cohort_id', cohortId),
    supabase
      .from('units')
      .select('id, unit_name'),
  ])
  if (sRes.error) throw sRes.error
  if (aRes.error) throw aRes.error
  if (uRes.error) throw uRes.error

  const unitNameById = new Map((uRes.data || []).map(u => [u.id, u.unit_name]))
  const students = (sRes.data || []).map(s => ({
    ...s,
    matched_unit_name: unitNameById.get(s.matched_unit_id) || '',
  }))
  const slugFor = (a) => {
    const inst = a.evaluation_instruments
    const i = Array.isArray(inst) ? inst[0] : inst
    return i?.slug
  }
  const assignments = (aRes.data || []).filter(a => slugFor(a) === 'post_rotation_evaluation')

  // Last shift date + support-needed flag (non-fatal). Optional; degrades to '-'.
  const shiftMeta = new Map()
  let shiftNote = null
  try {
    const shRes = await supabase
      .from('student_shift_logs')
      .select('student_id, shift_date, support_needed, lifecycle_state')
      .eq('cohort_id', cohortId)
    if (shRes.error) throw shRes.error
    for (const log of (shRes.data || [])) {
      // STUDENT-SHIFT-LOG-MANAGEMENT-1: a withdrawn entry is not the student's
      // last shift and raises no support flag.
      if (!shiftDrivesState(log)) continue
      const cur = shiftMeta.get(log.student_id) || { lastShiftDate: null, supportNeeded: false }
      if (log.shift_date && (!cur.lastShiftDate || new Date(log.shift_date) > new Date(cur.lastShiftDate))) {
        cur.lastShiftDate = log.shift_date
      }
      if ((log.support_needed || '').trim()) cur.supportNeeded = true
      shiftMeta.set(log.student_id, cur)
    }
  } catch {
    shiftNote = 'Last shift dates and support-needed flags are unavailable right now.'
  }

  return { students, assignments, shiftMeta, shiftNote, detectedAtMs: Date.now() }
}

export default function PostRotationAutomationPanel({ cohortId, onCounts, active }) {
  const { isOwner, isAdmin } = useAuth()
  const canView = isOwner || isAdmin

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['post_rotation_cert_queue', cohortId],
    queryFn: () => loadPostRotationQueue(cohortId),
    enabled: !!cohortId && canView,
    refetchOnWindowFocus: false,
  })

  const students = data?.students || []
  const detectedAtMs = data?.detectedAtMs || 0

  const { rows, summary } = useMemo(
    () => {
      if (!data) return { rows: [], summary: EMPTY_SUMMARY }
      return classifyPostRotationCohort({
        students: data.students,
        assignments: data.assignments,
        shiftMeta: data.shiftMeta,
        displayName: getStudentPreferredFullName,
        nowMs: data.detectedAtMs,
      })
    },
    [data]
  )

  // Report the standard summary up to the shared status band + summary card.
  useEffect(() => { onCounts?.(summary) }, [onCounts, summary])

  // Release flow ported verbatim in shape from CaseyFinkPostRotationAutomationPanel so both
  // post-rotation workflows behave identically: human confirmation, server-resolved recipient,
  // pre-send workflow guard, and a post-send identity tripwire that HALTS rather than retries.
  const [confirm, setConfirm] = useState(null)
  const [releasing, setReleasing] = useState(false)
  const [releaseMsg, setReleaseMsg] = useState(null)
  const [identityHold, setIdentityHold] = useState(false)

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
        // Pre-send workflow guard: the server refuses if its instrument is not this one.
        body: JSON.stringify({ student_id: row.studentId, expected_instrument_slug: ROUTE.instrumentSlug }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.released) {
        if (body.instrument_slug !== ROUTE.instrumentSlug || body.timepoint !== ROUTE.timepoint) {
          setIdentityHold(true)
          setReleaseMsg({ tone: 'err', text: `Release identity mismatch for ${row.studentName}. The server reported ${body.instrument_slug}/${body.timepoint}, not the expected ${ROUTE.instrumentSlug}/${ROUTE.timepoint}. This release may have completed and an email may have been sent. Do NOT retry: verify in the send log first, since retrying could send a duplicate. Re-run detection to confirm the current state.` })
        } else {
          setReleaseMsg({ tone: 'ok', text: `Released. Post-rotation evaluation sent to ${body.student_email || 'the student'} for ${row.studentName}.` })
        }
      } else {
        setReleaseMsg({ tone: 'err', text: `Release refused for ${row.studentName}: ${body.reason || body.error || 'no longer eligible'}` })
      }
    } catch {
      setReleaseMsg({ tone: 'err', text: 'Network error. Please try again.' })
    } finally {
      setReleasing(false)
      setConfirm(null)
      await refetch()
    }
  }, [refetch])

  // Release is PAUSED for this non-gating workflow, so there is no client release action, no
  // confirmation flow, and no call to the (retained but UI-unreachable) release API.

  // Render the detail body only when this workflow is selected (the query above still runs).
  if (!active) return null

  if (!canView) {
    return (
      <div style={{ padding: '32px 20px', color: '#9ca3af', fontSize: 14, fontFamily: F }}>
        Post-rotation evaluation detection is visible to Owner/Admin only.
      </div>
    )
  }

  return (
    <div style={{ fontFamily: F }}>
      {/* Workspace header. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#191919', margin: 0 }}>ASPIRE Post-Rotation Evaluation</h2>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#1D2567', background: '#EEF1FB',
          border: '1px solid #d7ddf5', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap',
        }}>
          Recipient: Student
        </span>
      </div>
      <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 16px', lineHeight: 1.6 }}>
        Collect student feedback about the ASPIRE rotation experience, unit learning environment, and
        preceptor support. Students appear here at or above their required hours.
      </p>

      {releaseMsg && (
        <div role="status" style={{
          fontSize: 12.5, marginBottom: 14, borderRadius: 8, padding: '10px 14px', lineHeight: 1.55,
          color: releaseMsg.tone === 'ok' ? '#166534' : '#991b1b',
          background: releaseMsg.tone === 'ok' ? '#dcfce7' : '#fff1f2',
          border: `1px solid ${releaseMsg.tone === 'ok' ? '#86efac' : '#fca5a5'}`,
        }}>{releaseMsg.text}</div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{
            padding: '7px 14px', background: NAVY, color: '#fff', border: 'none', borderRadius: 7,
            fontSize: 12.5, fontWeight: 600, fontFamily: F, cursor: isFetching ? 'default' : 'pointer', opacity: isFetching ? 0.6 : 1,
          }}
        >
          {isFetching ? 'Detecting…' : 'Re-run detection'}
        </button>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>
          {detectedAtMs ? `Detected ${new Date(detectedAtMs).toLocaleString('en-US')}` : ''}
        </span>
        <span style={{
          fontSize: 12, fontWeight: 600, color: '#166534', background: '#EDF7F0',
          border: '1px solid #c6e7d0', borderRadius: 999, padding: '3px 10px',
        }}>
          {summary.eligible_for_review} eligible for review
        </span>
        <span style={{
          fontSize: 12, fontWeight: 600, color: '#1D2567', background: '#EEF1FB',
          border: '1px solid #d7ddf5', borderRadius: 999, padding: '3px 10px',
        }}>
          {summary.in_flow} in evaluation flow
        </span>
      </div>

      {data?.shiftNote && (
        <div style={{ fontSize: 12.5, color: '#6b7280', marginBottom: 14 }}>{data.shiftNote}</div>
      )}

      {error && (
        <div style={{ padding: '14px 0', color: '#dc2626', fontSize: 14 }}>
          Error running detection: {error.message}
        </div>
      )}

      {!error && (
        <>
          {isLoading ? (
            <div style={{ padding: '24px 0', color: '#9ca3af', fontSize: 14 }}>Detecting eligible students…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14, lineHeight: 1.6 }}>
              {students.length === 0
                ? 'No students in this cohort.'
                : 'No students are eligible for post-rotation review yet. Students appear here once their approved hours reach the required total, or once they enter the evaluation flow.'}
            </div>
          ) : (
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: F }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    {COLS.map(h => (
                      <th key={h} style={{
                        padding: '9px 13px', textAlign: h === 'Action' ? 'right' : 'left',
                        fontSize: 11, fontWeight: 700, color: '#6b7280', whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const st = STATUS_STYLE[r.status] || { label: r.status, fg: '#4A5560', bg: '#F4F3F1' }
                    return (
                      <tr key={r.studentId} style={{ background: idx % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '9px 13px', fontSize: 13, color: '#191919', fontWeight: 600 }}>
                          {r.studentName}
                          {r.programType && (
                            <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>{r.programType}</div>
                          )}
                        </td>
                        <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151' }}>{r.school || '-'}</td>
                        <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151' }}>{r.unit || '-'}</td>
                        <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>{fmtHours(r.approvedHours)}</td>
                        <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>{fmtHours(r.hoursRequired)}</td>
                        <td style={{ padding: '9px 13px', fontSize: 12.5, color: '#374151', whiteSpace: 'nowrap' }}>{fmtDate(r.lastShiftDate)}</td>
                        <td style={{ padding: '9px 13px' }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: st.fg, background: st.bg,
                            borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap',
                          }}>{st.label}</span>
                        </td>
                        <td style={{ padding: '9px 13px', fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
                          {r.warnings.length ? r.warnings.join(' · ') : <span style={{ color: '#9ca3af' }}>-</span>}
                        </td>
                        <td style={{ padding: '9px 13px', textAlign: 'right' }}>
                          {r.status === 'eligible_for_review' ? (
                            <button
                              type="button"
                              onClick={() => { setReleaseMsg(null); setConfirm(r) }}
                              disabled={releasing || identityHold}
                              style={{
                                padding: '6px 14px', background: '#166534', color: '#fff', border: 'none',
                                borderRadius: 7, fontSize: 12, fontWeight: 600, fontFamily: F,
                                cursor: (releasing || identityHold) ? 'default' : 'pointer',
                                opacity: (releasing || identityHold) ? 0.6 : 1, whiteSpace: 'nowrap',
                              }}
                            >
                              Release Survey
                            </button>
                          ) : (
                            <span style={{ color: '#9ca3af', fontSize: 12 }}>-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {/* Human approval. Shows the SERVER-RESOLVED recipient with no editable field, so an
          operator can confirm who receives it but cannot redirect it. */}
      {confirm && (
        <div className="modal-overlay" onMouseDown={() => !releasing && setConfirm(null)}>
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 480, fontFamily: F }} onMouseDown={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1D2567', fontFamily: F }}>
                Release ASPIRE Post-Rotation Evaluation?
              </h2>
            </div>
            <div style={{ padding: '16px 20px', fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '6px 12px', marginBottom: 14 }}>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>Workflow</span><span style={{ fontWeight: 600, color: '#1D2567' }}>{ROUTE.workflowTitle}</span>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>Student</span><span style={{ fontWeight: 600, color: '#191919' }}>{confirm.studentName}</span>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>Recipient email</span><span>{confirm.studentEmail || '-'}</span>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: '#6b7280' }}>
                This sends the ASPIRE Post-Rotation Evaluation to the student. Eligibility and the
                recipient are re-checked on the server before sending.
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

    </div>
  )
}

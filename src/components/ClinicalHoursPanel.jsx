// ClinicalHoursPanel - shared, read-only clinical-hours summary + shift-log table extracted
// verbatim from StudentSidePanel so Student Profiles and Rotation > Activity render the SAME
// totals, table, and Shift Details modal (no duplicated math, no second modal).
//
// Totals (Required / Approved / Pending / Remaining) come from the student record fields
// (hours_required / approved_hours / pending_hours) - the canonical source the profile uses.
// The caller supplies `shiftLogs` (cached per student via React Query, queryKey
// ['student_shift_logs', student.id]) so each surface controls its own fetch + side effects.
import { useState, useEffect } from 'react'
import { Info } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import ShiftDetailsModal from './ShiftDetailsModal'
import ShiftReviewModal from './ShiftReviewModal'
import { useAuth } from '../contexts/AuthContext'
import { useSupportRequestReads } from '../lib/support/useSupportRequestReads'
import { isShiftSupportUnread } from '../lib/support/supportRequests'
import { shiftStatusChip, isPendingReview } from '../lib/shiftStatusChips'
import { buildStudentShiftOrdinals } from '../lib/shiftOrdinals'
import ShiftNumberBadge from './ShiftNumberBadge'

export default function ClinicalHoursPanel({ student, shiftLogs = [], autoOpenShiftLogId = null, onAutoOpenConsumed, onReviewDecided }) {
  const [selectedShift, setSelectedShift] = useState(null)
  const [reviewShift, setReviewShift] = useState(null)
  const queryClient = useQueryClient()
  // SHIFT-SEQUENCE-1: the SAME ordinal rule the Unit Leader calendar uses
  // (src/lib/shiftOrdinals.js): per student, chronological over their whole
  // history, shift_date then checked_in_at then id, so the number for a given
  // record matches on every surface. Derived, never stored, so a late-entered
  // older shift renumbers the ones after it automatically.
  const ordinalById = buildStudentShiftOrdinals(shiftLogs)
  const { userProfile } = useAuth()
  const profileId = userProfile?.id
  const { receipts } = useSupportRequestReads(profileId)
  const data = student || {}

  // SUPPORT-REQUEST-ACTION-CENTER-2: when the Action Center focuses an exact shift, open its Details
  // modal automatically once the shift is present in this student's loaded logs. The modal (not this
  // effect) writes the read receipt after the support text renders.
  useEffect(() => {
    if (!autoOpenShiftLogId) return
    const target = shiftLogs.find(l => l.id === autoOpenShiftLogId)
    if (!target) return
    setSelectedShift(target)
    onAutoOpenConsumed?.()
  }, [autoOpenShiftLogId, shiftLogs, onAutoOpenConsumed])

  const req = parseFloat(data.hours_required || 0)
  const apv = parseFloat(data.approved_hours || 0)
  const pnd = parseFloat(data.pending_hours || 0)
  const rem = Math.max(0, req - apv)
  const pct = req > 0 ? Math.min(100, (apv / req) * 100) : 0

  return (
    <>
      {/* Summary numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 10 }}>
        {[['Required', req], ['Approved', apv], ['Pending', pnd], ['Remaining', rem]].map(([lbl, val]) => (
          <div key={lbl} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--nightfall)', lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{lbl}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 10, borderRadius: 12, background: '#f3f4f6', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ height: '100%', borderRadius: 12, width: `${pct}%`,
          background: pct >= 100 ? '#166534' : pct >= 80 ? '#166534' : 'var(--nightfall)',
          transition: 'width 600ms ease' }}>
          {pct >= 100 && <span style={{ fontSize: 9, color: '#fff', paddingLeft: 4 }}>✓</span>}
        </div>
      </div>

      {/* Shift log table */}
      {shiftLogs.length === 0 ? (
        <p style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic', margin: 0 }}>No shifts logged yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--sand)' }}>
                {['Shift #', 'Date', 'Hrs', 'Unit', 'Preceptor', 'Type', 'Status', 'Details', ''].map(h => (
                  <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 700, color: '#6b7280', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shiftLogs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--border-lt)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <ShiftNumberBadge ordinal={ordinalById.get(log.id)} />
                  </td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {log.shift_date ? new Date(log.shift_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
                  </td>
                  <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--nightfall)' }}>{log.total_hours}</td>
                  <td style={{ padding: '6px 8px', color: '#6b7280', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.unit_name || '-'}</td>
                  <td style={{ padding: '6px 8px', color: '#6b7280', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.preceptor_name || '-'}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: log.shift_type === 'Night' ? '#1d2567' : '#eff6ff',
                      color: log.shift_type === 'Night' ? '#fff' : '#1d4ed8' }}>{log.shift_type || 'Day'}</span>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {(() => {
                      const s = shiftStatusChip(log.status)
                      return (
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: s.bg, color: s.text, fontWeight: 600, fontFamily: 'Plus Jakarta Sans, sans-serif', whiteSpace: 'nowrap' }}>
                          {s.label}
                        </span>
                      )
                    })()}
                  </td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {/* SUPPORT-REQUEST-ACTION-CENTER-2: amber dot flags a shift whose support request
                        is UNREAD for the current user (no matching receipt for this exact version). It
                        clears after the Details modal marks it read and re-arms if the text is
                        meaningfully edited. The full text always stays in the Details modal. */}
                    {isShiftSupportUnread(log, profileId, receipts) && (
                      <span
                        aria-label="Support needed"
                        title="This shift has a support-needed note, open Details"
                        style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#d97706', marginRight: 6, verticalAlign: 'middle' }}
                      />
                    )}
                    <button
                      onClick={() => setSelectedShift(log)}
                      aria-label="View shift details"
                      title="View shift details"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2, verticalAlign: 'middle' }}
                    >
                      <Info size={16} />
                    </button>
                  </td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {/* SHIFT-LOG-REVIEW-1: the WS1e-A4 rule stands - aggregate hours are never
                        edited directly. What replaced the disabled controls is a full review
                        workflow: an Owner/Admin decision (approve / adjust / reject) through a
                        service-role transactional RPC that recomputes both totals from the
                        authoritative completed rows. Other staff roles still see read-only text. */}
                    {isPendingReview(log.status) && (
                      ['owner', 'admin'].includes(userProfile?.role || '') ? (
                        <button
                          data-testid="review-shift-button"
                          onClick={() => setReviewShift(log)}
                          title="Review this shift: approve, adjust, or reject"
                          style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            border: '1px solid #78350F', background: '#FEF3C7', color: '#78350F',
                            cursor: 'pointer', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                          Review
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}
                          title="Awaiting an Owner/Admin review decision.">
                          Pending review
                        </span>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Read-only Shift Details modal (shared component) */}
      <ShiftDetailsModal shift={selectedShift} onClose={() => setSelectedShift(null)} />

      {/* SHIFT-LOG-REVIEW-1: Owner/Admin decision surface. After a decision:
          the shift list and the pending-review queue re-read via their React
          Query keys, and the student's new AUTHORITATIVE totals go up through
          onReviewDecided to the ACTUAL owners of student state (App useState +
          the side panel's local copy). Invalidating a ['students'] query key
          would refresh nothing - no query holds that key; the canonical
          students collection is App state. */}
      {reviewShift && (
        <ShiftReviewModal
          shift={reviewShift}
          student={data}
          allLogs={shiftLogs}
          onClose={() => setReviewShift(null)}
          onDecided={(result) => {
            queryClient.invalidateQueries({ queryKey: ['student_shift_logs', data.id] })
            queryClient.invalidateQueries({ queryKey: ['rotation_log_summary'] })
            onReviewDecided?.(result)
          }}
        />
      )}
    </>
  )
}

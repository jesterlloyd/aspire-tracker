// src/components/ShiftDetailsModal.jsx
// Phase S.1 - read-only Shift Details modal for the Clinical Hours table.
// Surfaces shift data already fetched by StudentSidePanel's select('*') query
// that is otherwise not shown: learning highlight, support needed, submission
// time, override reasons, review reason / admin notes / exception flags.
// Purely presentational: no edits, no mutations, no action buttons except Close.

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Info, X, AlertTriangle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { hasSupportRequest } from '../lib/support/supportRequests'
import { markSupportRequestRead } from '../lib/support/useSupportRequestReads'

const F = 'DM Sans, sans-serif'

// Mirrors the Status badge styling used in StudentSidePanel's Clinical Hours table.
const STATUS_STYLES = {
  'Auto-Accepted':  { bg: '#D1FAE5', text: '#065F46', label: 'Auto-Accepted' },
  'Pending Review': { bg: '#FEF3C7', text: '#78350F', label: 'Pending Review' },
  'Approved':       { bg: '#DBEAFE', text: '#1E40AF', label: 'Approved' },
  'Rejected':       { bg: '#FEE2E2', text: '#7F1D1D', label: 'Rejected' },
  'Edited':         { bg: '#E0E7FF', text: '#3730A3', label: 'Edited' },
  // legacy (pre-migration) values
  'approved':       { bg: '#D1FAE5', text: '#065F46', label: 'Approved' },
  'needs_review':   { bg: '#FEF3C7', text: '#78350F', label: 'Pending Review' },
  'rejected':       { bg: '#FEE2E2', text: '#7F1D1D', label: 'Rejected' },
}

// shift_date is a 'YYYY-MM-DD' text column - anchor at noon to avoid tz rollover.
function fmtShiftDate(s) {
  if (!s) return '-'
  const d = new Date(`${s}T12:00:00`)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
// timestamptz columns (submitted_at, reviewed_at) - show local date + time.
function fmtTimestamp(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 13, lineHeight: 1.5 }}>
      <span style={{ color: '#9ca3af', minWidth: 110, flexShrink: 0, fontFamily: F }}>{label}</span>
      <span style={{ color: '#374151', fontFamily: F, wordBreak: 'break-word' }}>{children}</span>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase',
      letterSpacing: '0.06em', fontFamily: F, marginTop: 6, marginBottom: 2,
      borderTop: '1px solid #f3f4f6', paddingTop: 12,
    }}>
      {children}
    </div>
  )
}

export default function ShiftDetailsModal({ shift, onClose }) {
  const closeRef = useRef(null)
  const { userProfile, isOwner, isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const profileId = userProfile?.id

  // Escape closes; focus the close button on open.
  useEffect(() => {
    if (!shift) return
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [shift, onClose])

  // SUPPORT-REQUEST-ACTION-CENTER-2: mark the exact support request read for the current Owner/Admin
  // AFTER this modal has rendered a NONBLANK support note. This is the ONLY mark-as-read trigger: it
  // fires on real display of the text, never on hover, student expansion, row/badge visibility, the
  // Action Center opening, navigation, a failed load, or blank text. The write is idempotent (upsert
  // ON CONFLICT DO NOTHING) so a re-open of the same version is a no-op; a failure keeps the request
  // unread and still fully viewable. Support text is never logged. If the profile id is unavailable,
  // no receipt is written and indicators stay unread.
  useEffect(() => {
    if (!shift || !profileId || !(isOwner || isAdmin)) return
    if (!hasSupportRequest(shift.support_needed)) return
    let cancelled = false
    markSupportRequestRead(queryClient, profileId, shift).then((res) => {
      if (cancelled) return
      void res // success clears indicators via the shared invalidation; failure leaves them unread
    })
    return () => { cancelled = true }
  }, [shift, profileId, isOwner, isAdmin, queryClient])

  if (!shift) return null

  const s = STATUS_STYLES[shift.status] || { bg: '#F3F4F6', text: '#6B7280', label: shift.status || '-' }
  const submitted = fmtTimestamp(shift.submitted_at)
  const reviewedAt = fmtTimestamp(shift.reviewed_at)

  const unitOverride = shift.is_assigned_unit === false || (shift.unit_override_reason || '').trim()
  const preceptorOverride = shift.is_assigned_preceptor === false || (shift.preceptor_override_note || '').trim()

  const flags = Array.isArray(shift.exception_flags) ? shift.exception_flags.filter(Boolean) : []
  const hasReviewDetails = !!(
    (shift.review_reason || '').trim() ||
    (shift.admin_notes || '').trim() ||
    (shift.reviewed_by || '').trim() ||
    reviewedAt ||
    flags.length > 0
  )

  const highlight = (shift.learning_highlight || '').trim()
  const support = (shift.support_needed || '').trim()

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Shift details"
        style={{ maxWidth: 640, width: '90vw', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="modal-header">
          <h2 style={{ fontFamily: F }}>Shift Details</h2>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="modal-body">
          {/* ── Shift Information ─────────────────────────────────────────── */}
          <SectionLabel>Shift Information</SectionLabel>
          <Row label="Date">{fmtShiftDate(shift.shift_date)}</Row>
          <Row label="Hours">{shift.total_hours ?? '-'}</Row>
          <Row label="Shift Type">{shift.shift_type || 'Day'}</Row>
          <Row label="Unit">
            {shift.unit_name || '-'}
            {unitOverride && (shift.unit_override_reason || '').trim() && (
              <div style={{ fontSize: 12, fontStyle: 'italic', color: '#6b7280', marginTop: 2 }}>
                Override reason: {shift.unit_override_reason.trim()}
              </div>
            )}
          </Row>
          <Row label="Preceptor">
            {shift.preceptor_name || '-'}
            {preceptorOverride && (shift.preceptor_override_note || '').trim() && (
              <div style={{ fontSize: 12, fontStyle: 'italic', color: '#6b7280', marginTop: 2 }}>
                Override note: {shift.preceptor_override_note.trim()}
              </div>
            )}
          </Row>
          <Row label="Status">
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: s.bg, color: s.text, fontWeight: 600, fontFamily: F, whiteSpace: 'nowrap' }}>
              {s.label}
            </span>
          </Row>
          {submitted && <Row label="Submitted">{submitted}</Row>}

          {/* ── Learning Highlight ────────────────────────────────────────── */}
          <SectionLabel>Learning Highlight</SectionLabel>
          {highlight ? (
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, fontFamily: F, whiteSpace: 'pre-wrap' }}>{highlight}</div>
          ) : (
            <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', fontFamily: F }}>No learning highlight recorded</div>
          )}

          {/* ── Support Needed ────────────────────────────────────────────── */}
          <SectionLabel>Support Needed</SectionLabel>
          {support ? (
            <div style={{ background: '#FBF5E8', border: '1px solid #f0c9b0', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#8B5E1A', fontFamily: F, marginBottom: 4 }}>
                <AlertTriangle size={13} /> Support requested
              </div>
              <div style={{ fontSize: 13, color: '#5b4a2e', lineHeight: 1.6, fontFamily: F, whiteSpace: 'pre-wrap' }}>{support}</div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', fontFamily: F }}>No support requested</div>
          )}

          {/* ── Review Details (conditional) ──────────────────────────────── */}
          {hasReviewDetails && (
            <>
              <SectionLabel>Review Details</SectionLabel>
              {(shift.review_reason || '').trim() && <Row label="Review Reason">{shift.review_reason.trim()}</Row>}
              {(shift.admin_notes || '').trim() && <Row label="Admin Notes">{shift.admin_notes.trim()}</Row>}
              {(shift.reviewed_by || '').trim() && <Row label="Reviewed By">{shift.reviewed_by.trim()}</Row>}
              {reviewedAt && <Row label="Reviewed At">{reviewedAt}</Row>}
              {flags.length > 0 && (
                <Row label="Exception Flags">
                  <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                    {flags.map((f, i) => (
                      <span key={i} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#FEF3C7', color: '#78350F', border: '1px solid #fde68a', whiteSpace: 'nowrap' }}>
                        {f}
                      </span>
                    ))}
                  </span>
                </Row>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Small re-export so the trigger icon stays consistent with this modal.
export { Info as ShiftDetailsIcon }

// src/lib/shiftStatusChips.js
//
// The single source of truth for shift-log status chip styling and labels, so the staff
// Clinical Hours table and the Unit Leader Clinical Hours section cannot disagree on how a
// status reads. Extracted from ClinicalHoursPanel's previously-inline map. Pure data +
// a lookup; no React, no fetching.

export const SHIFT_STATUS_STYLES = Object.freeze({
  'Auto-Accepted':  { bg: '#D1FAE5', text: '#065F46', label: 'Auto-Accepted' },
  'Pending Review': { bg: '#FEF3C7', text: '#78350F', label: 'Pending Review' },
  'Approved':       { bg: '#DBEAFE', text: '#1E40AF', label: 'Approved' },
  'Rejected':       { bg: '#FEE2E2', text: '#7F1D1D', label: 'Rejected' },
  'Edited':         { bg: '#E0E7FF', text: '#3730A3', label: 'Edited' },
  // legacy values (pre-migration rows)
  'approved':       { bg: '#D1FAE5', text: '#065F46', label: 'Approved' },
  'needs_review':   { bg: '#FEF3C7', text: '#78350F', label: 'Pending Review' },
  'rejected':       { bg: '#FEE2E2', text: '#7F1D1D', label: 'Rejected' },
})

/** { bg, text, label } for a status, with a neutral fallback that echoes the raw value. */
export function shiftStatusChip(status) {
  return SHIFT_STATUS_STYLES[status] || { bg: '#F3F4F6', text: '#6B7280', label: status || '-' }
}

/** Shifts that carry a read-only "Pending review" note in the Details column. */
export function isPendingReview(status) {
  return status === 'Pending Review' || status === 'needs_review'
}

// src/lib/portalShiftStatus.js
//
// STUDENT-SHIFT-LOG-MANAGEMENT-1: the student-facing reading of a shift's
// state. It wraps the canonical staff vocabulary (src/lib/shiftStatusChips.js)
// rather than restating it, so the portal can never drift from the values the
// database actually stores.
//
// This replaces a comparison against the lowercase literal 'approved', which
// NO stored value has ever equalled - every shift therefore read as "Awaiting
// review" in the portal, including approved ones.
//
// Withdrawn entries are a LIFECYCLE state, not a status: lifecycle_state
// 'voided' outranks whatever status the row carried when it was withdrawn.

import { shiftStatusChip } from './shiftStatusChips.js'

/** True when the entry has been withdrawn by the student. */
export function isVoided(log) {
  return (log?.lifecycle_state || '') === 'voided'
}

/** True when the entry still counts toward a total. */
export function countsTowardTotals(log) {
  if (isVoided(log)) return false
  return (log?.lifecycle_state || 'completed') === 'completed'
}

/**
 * Student-facing label + portal chip tone for one shift log.
 * @returns { label, tone } where tone ∈ 'ok' | 'wait' | 'soft'
 */
export function portalShiftStatus(log) {
  if (isVoided(log)) return { label: 'Withdrawn', tone: 'soft' }
  if ((log?.lifecycle_state || '') === 'in_progress') return { label: 'In progress', tone: 'wait' }

  const status = log?.status || ''
  const canonical = shiftStatusChip(status).label

  switch (status) {
    case 'Auto-Accepted':
    case 'approved':
      // Students are not shown the internal distinction between an
      // automatically accepted shift and a staff-approved one; both are
      // simply counted.
      return { label: 'Accepted', tone: 'ok' }
    case 'Approved':
      return { label: 'Approved', tone: 'ok' }
    case 'Rejected':
    case 'rejected':
      return { label: 'Not counted', tone: 'soft' }
    case 'Pending Review':
    case 'needs_review':
      return { label: 'Awaiting review', tone: 'wait' }
    default:
      return { label: canonical, tone: 'soft' }
  }
}

/** Counts for the portal's own attention line, using canonical values. */
export function countAwaitingReview(logs) {
  return (logs || []).filter(l =>
    countsTowardTotals(l) && (l.status === 'Pending Review' || l.status === 'needs_review')
  ).length
}

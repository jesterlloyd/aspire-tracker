// src/lib/evaluationLabels.js
//
// EVALUATION-DASHBOARD-INTELLIGENCE-POLISH: DISPLAY-ONLY labels + canonical sort orders for
// the Evaluation dashboard. The instrument SLUGS are functional keys (survey-naming canon) - never
// rename them, and never change the DB display_name here. These maps are purely for presentation.
//
// RESPONSES-PACKET-1 (2026-09-19): the Responses tab names INSTRUMENTS; Review & Release names
// release WORKFLOWS (src/lib/evaluation/surveyCatalog.js). They are not the same list, and that
// is deliberate: Casey-Fink is one instrument given at two timepoints, so it is one entry here
// and two workflows there. Splitting it here would break the pre-to-post comparison.

// Slug → instrument name shown on the packet tabs and in the roster.
export const INSTRUMENT_COMPACT_LABELS = {
  casey_fink_readiness_2024: 'Casey-Fink Readiness for Practice',
  preceptor_progress:        "Preceptor's Assessment of Student Readiness",
  student_preceptor_eval:    "Student's Feedback on Unit and Preceptor",
  post_rotation_evaluation:  "Student's Feedback on ASPIRE",
}

// Compact label for a slug, falling back to the provided display_name, then '-'.
export function instrumentCompactLabel(slug, fallbackDisplayName) {
  return INSTRUMENT_COMPACT_LABELS[slug] || fallbackDisplayName || '-'
}

// Canonical instrument order (for sorting + the packet's file tabs). Student's Feedback on
// ASPIRE (post_rotation_evaluation) has a single timepoint and gates nothing; it is fourth.
export const INSTRUMENT_ORDER = ['casey_fink_readiness_2024', 'preceptor_progress', 'student_preceptor_eval', 'post_rotation_evaluation']
export function instrumentSortIndex(slug) {
  const i = INSTRUMENT_ORDER.indexOf(slug)
  return i === -1 ? 99 : i
}

// Logical timepoint order: baseline → midpoint → post-rotation → custom/other.
export const TIMEPOINT_ORDER = ['baseline', 'early_rotation_baseline', 'midpoint', 'mid_rotation', 'post_rotation', 'custom']
export function timepointSortIndex(tp) {
  const i = TIMEPOINT_ORDER.indexOf(tp)
  return i === -1 ? 99 : i
}

// Workflow status order: sent → opened → completed → … → revoked.
export const STATUS_ORDER = ['sent', 'opened', 'completed', 'reminder_due', 'non_responder', 'expired', 'revoked', 'draft']
export function statusSortIndex(status) {
  const i = STATUS_ORDER.indexOf(status)
  return i === -1 ? 99 : i
}

// "Completed By" display: who actually responded (student self vs the named preceptor).
export function completedByLabel(respondentType, respondentName) {
  if (respondentType === 'student') return 'Student (self)'
  if (respondentType === 'preceptor') {
    const n = (respondentName || '').trim()
    return n || 'Preceptor'
  }
  return '-'
}

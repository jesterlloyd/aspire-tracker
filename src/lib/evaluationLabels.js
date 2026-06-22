// src/lib/evaluationLabels.js
//
// EVALUATION-DASHBOARD-INTELLIGENCE-POLISH: DISPLAY-ONLY compact labels + canonical sort orders for
// the Evaluation dashboard. The instrument SLUGS are functional keys (survey-naming canon) — never
// rename them, and never change the DB display_name here. These maps are purely for presentation.

// Slug → compact label shown in the table, filter, and instrument cards.
export const INSTRUMENT_COMPACT_LABELS = {
  casey_fink_readiness_2024: 'Casey-Fink',
  preceptor_progress:        'Preceptor Readiness Assessment',
  student_preceptor_eval:    'Preceptor & Unit Feedback',
}

// Compact label for a slug, falling back to the provided display_name, then '—'.
export function instrumentCompactLabel(slug, fallbackDisplayName) {
  return INSTRUMENT_COMPACT_LABELS[slug] || fallbackDisplayName || '—'
}

// Canonical instrument order (for sorting + the instrument-card row). Program Experience is NOT
// included — that instrument does not exist yet.
export const INSTRUMENT_ORDER = ['casey_fink_readiness_2024', 'preceptor_progress', 'student_preceptor_eval']
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
  return '—'
}

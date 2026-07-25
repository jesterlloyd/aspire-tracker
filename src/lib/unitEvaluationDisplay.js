// src/lib/unitEvaluationDisplay.js
//
// DISPLAY-ONLY presentation metadata for the Unit Leader evaluations surface. Labels and
// scale meaning for the five approved quantitative paths, and the two approved instruments.
// No composite score is ever invented, and no metric is assumed to be "higher is better" —
// each path carries an explicit kind ('outcome' vs 'context'). The server + database are the
// source of truth for WHAT is exposed; this only names it.

export const APPROVED_UL_INSTRUMENTS = Object.freeze([
  { slug: 'student_preceptor_eval', label: 'Preceptor & Unit Feedback' },
  { slug: 'preceptor_progress', label: 'Preceptor Readiness Assessment' },
])

export const UL_TIMEPOINTS = Object.freeze([
  ['midpoint', 'Midpoint'],
  ['post_rotation', 'Post-rotation'],
])

// path → { label, kind }. kind 'context' means descriptive (never framed as a score/outcome).
export const QUANT_METRIC_META = Object.freeze({
  'overall_experience.overall_rating': { label: 'Overall Experience', kind: 'outcome' },
  'developmental_feedback.context.shifts_observed': { label: 'Shifts Observed', kind: 'context' },
  'readiness_endorsement.transition_readiness': { label: 'Transition Readiness', kind: 'outcome' },
  'readiness_endorsement.unit_endorsement_consideration': { label: 'Unit Endorsement Consideration', kind: 'outcome' },
  'readiness_endorsement.cedars_consideration_recommendation': { label: 'Cedars Consideration Recommendation', kind: 'outcome' },
})

export function metricLabel(path) {
  return QUANT_METRIC_META[path]?.label || path
}
export function metricKind(path) {
  return QUANT_METRIC_META[path]?.kind || 'outcome'
}
export function instrumentLabel(slug) {
  return APPROVED_UL_INSTRUMENTS.find(i => i.slug === slug)?.label || slug
}

export const NO_APPROVED_METRICS_MESSAGE =
  'Released responses are available, but no approved quantitative metrics are configured for display.'

// Format a metric value for display: integers plain, others to 2 decimals.
export function fmtMetric(v) {
  if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

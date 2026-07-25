// lib/server/unitEvaluations/config.js
//
// UL-EVAL-API: first-release constants for the Unit Leader evaluations surface.
// Pure data only. The database is the source of truth (the release gate migration
// 20260725000000 + the evaluation_unit_quantitative_keys allowlist table). These
// mirrors exist so the server can validate inputs and shape/assert outputs without a
// round trip, and so the client can render safe labels.

// The two approved instruments for the first release. Casey-Fink and the post-rotation
// program evaluation are excluded and must never appear.
export const APPROVED_INSTRUMENTS = Object.freeze(['student_preceptor_eval', 'preceptor_progress'])

// Valid assignment timepoints (matches the DB CHECK on evaluation_assignments.timepoint).
export const TIMEPOINTS = Object.freeze([
  'baseline', 'early_rotation_baseline', 'midpoint', 'post_rotation', 'custom',
])

// The EXACT quantitative JSON paths that may reach a Unit Leader, per instrument. This
// mirrors the seeded rows in public.evaluation_unit_quantitative_keys. The database
// allowlist is authoritative; this list is the server-side defense-in-depth filter. Do
// NOT add paths here without a matching Owner-reviewed DB curation pass.
export const QUANTITATIVE_PATHS = Object.freeze({
  student_preceptor_eval: Object.freeze([
    'overall_experience.overall_rating',
  ]),
  preceptor_progress: Object.freeze([
    'developmental_feedback.context.shifts_observed',
    'readiness_endorsement.transition_readiness',
    'readiness_endorsement.unit_endorsement_consideration',
    'readiness_endorsement.cedars_consideration_recommendation',
  ]),
})

export const ALL_QUANTITATIVE_PATHS = Object.freeze(
  Object.values(QUANTITATIVE_PATHS).flat(),
)

// Presentation metadata for each quantitative path. kind='context' means the value is
// descriptive context, not an outcome score (never framed as "higher is better").
export const QUANTITATIVE_PATH_META = Object.freeze({
  'overall_experience.overall_rating':
    { label: 'Overall Experience', kind: 'outcome' },
  'developmental_feedback.context.shifts_observed':
    { label: 'Shifts Observed', kind: 'context' },
  'readiness_endorsement.transition_readiness':
    { label: 'Transition Readiness', kind: 'outcome' },
  'readiness_endorsement.unit_endorsement_consideration':
    { label: 'Unit Endorsement Consideration', kind: 'outcome' },
  'readiness_endorsement.cedars_consideration_recommendation':
    { label: 'Cedars Consideration Recommendation', kind: 'outcome' },
})

// Owner/Admin lifecycle actions → the database RPC each one calls. Unit Leaders can
// never invoke any of these (the RPCs gate on is_active_owner_or_admin()).
export const LIFECYCLE_ACTIONS = Object.freeze({
  moderate: 'ul_eval_moderate_response',
  release: 'ul_eval_release_response',
  revoke: 'ul_eval_revoke_response',
  rerelease: 'ul_eval_rerelease_response',
})

// RPC "status" string → { http, ok }. Every status the lifecycle RPCs can return is
// mapped explicitly so nothing falls through to an opaque 500.
export const RPC_STATUS = Object.freeze({
  success:                             { http: 200, ok: true },
  no_change:                           { http: 200, ok: true },
  not_authorized:                      { http: 403, ok: false },
  not_found:                           { http: 404, ok: false },
  invalid_decision:                    { http: 400, ok: false },
  already_released:                    { http: 409, ok: false },
  already_revoked:                     { http: 409, ok: false },
  not_revoked:                         { http: 409, ok: false },
  not_releasable_state:                { http: 409, ok: false },
  revoked_requires_explicit_rerelease: { http: 409, ok: false },
  snapshot_unverified:                 { http: 409, ok: false },
  snapshot_incomplete:                 { http: 409, ok: false },
  not_yet_eligible:                    { http: 409, ok: false },
  not_moderated:                       { http: 409, ok: false },
})

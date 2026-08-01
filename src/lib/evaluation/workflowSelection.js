// src/lib/evaluation/workflowSelection.js
//
// ASPIRE-CASEYFINK-RELEASE-ROUTING-HOTFIX-1B - the single, pure resolver for which Review & Release
// workflow is operational. SurveyAutomationDashboard imports and calls this exact function; the
// logic is NOT duplicated inside the component, so the regression harness exercises the real
// production path.
//
// Resolution is DETERMINISTIC: the user's explicit selection when it is a known workflow, otherwise
// the fixed default (the Casey-Fink certificate gate). It deliberately takes NO detection counts,
// so the operational workflow can never silently follow whichever workflow's async counts arrive
// first. The dashboard derives the navigator highlight, the active panel, and the email preview from
// this one value, so the visible workflow and the releasing workflow can never diverge.

// Ordered to match SurveyAutomationDashboard WORKFLOWS keys.
export const WORKFLOW_KEYS = Object.freeze([
  'preceptor',
  'student',
  'caseyFinkPostRotation',
  'postRotation',
])

// The fallback when there is no URL key and no stored selection. This is now the FIRST
// workflow in displayed order, not a hardcoded favourite: opening Review and Release used
// to land on Casey-Fink even though Preceptor Readiness is listed first, which reads as a
// bug every time. Kept as a derived constant so it cannot drift from the display order.
export const DEFAULT_WORKFLOW_KEY = WORKFLOW_KEYS[0]

export function isWorkflowKey(key) {
  return WORKFLOW_KEYS.includes(key)
}

// selected: the user's explicit choice (a workflow key) or null/undefined for "no explicit choice".
// Returns the operational workflow key. Counts are intentionally not a parameter.
export function resolveEffectiveWorkflow(selected) {
  return isWorkflowKey(selected) ? selected : DEFAULT_WORKFLOW_KEY
}

/**
 * The workflow to open on arrival, in strict precedence:
 *   1. a valid workflow key in the URL, so a deep link always wins
 *   2. the most recently opened workflow for this user, when still valid
 *   3. the first workflow in displayed order
 *
 * COUNTS ARE STILL NOT AN INPUT. The 1B regression this module exists to prevent was a
 * resolver that followed whichever workflow's async counts arrived first, which silently
 * moved the operational workflow under the operator. Adding URL and stored-selection
 * precedence does not reintroduce that: neither input is derived from detection, and a
 * ready count still cannot change what is selected.
 *
 * `order` defaults to WORKFLOW_KEYS but is a parameter so the caller can pass the actual
 * displayed order if it ever diverges.
 */
export function resolveInitialWorkflow({ urlKey, storedKey, order = WORKFLOW_KEYS } = {}) {
  if (isWorkflowKey(urlKey)) return urlKey
  if (isWorkflowKey(storedKey)) return storedKey
  return order.find(k => isWorkflowKey(k)) || DEFAULT_WORKFLOW_KEY
}

/** localStorage key for the last opened workflow. Per browser profile, not per cohort. */
export const LAST_WORKFLOW_STORAGE_KEY = 'aspire.evaluation.lastWorkflow'

// ── EVAL-RR-UNIFIED-NAV-1: the Review & Release navigator's key space ────────────────
//
// The navigator now carries TWO sections: the four survey workflows above, and the
// Unit Leader Release console. The console is NOT a survey workflow - it has no
// detection counts, no panels, and must never participate in resolveEffectiveWorkflow
// (which the release routing regression harness pins to survey keys only). These
// nav-key helpers are therefore a SUPERSET layered on top; the survey-only functions
// above are untouched and keep their exact semantics.
export const UNIT_LEADER_RELEASE_KEY = 'unitLeaderRelease'

export function isReviewReleaseNavKey(key) {
  return isWorkflowKey(key) || key === UNIT_LEADER_RELEASE_KEY
}

// The operational navigator selection: a valid nav key as-is, else the survey default.
export function resolveEffectiveNavKey(selected) {
  return isReviewReleaseNavKey(selected) ? selected : DEFAULT_WORKFLOW_KEY
}

// Arrival precedence identical to resolveInitialWorkflow (URL, then stored, then first
// in order), evaluated over the nav-key superset so a deep link or a remembered visit
// to Release to Unit Leaders restores exactly like a survey workflow. Counts are still
// not an input.
export function resolveInitialNavKey({ urlKey, storedKey, order = WORKFLOW_KEYS } = {}) {
  if (isReviewReleaseNavKey(urlKey)) return urlKey
  if (isReviewReleaseNavKey(storedKey)) return storedKey
  return order.find(k => isReviewReleaseNavKey(k)) || DEFAULT_WORKFLOW_KEY
}

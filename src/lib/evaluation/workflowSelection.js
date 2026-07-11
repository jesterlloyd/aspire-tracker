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

export const DEFAULT_WORKFLOW_KEY = 'caseyFinkPostRotation'

export function isWorkflowKey(key) {
  return WORKFLOW_KEYS.includes(key)
}

// selected: the user's explicit choice (a workflow key) or null/undefined for "no explicit choice".
// Returns the operational workflow key. Counts are intentionally not a parameter.
export function resolveEffectiveWorkflow(selected) {
  return isWorkflowKey(selected) ? selected : DEFAULT_WORKFLOW_KEY
}

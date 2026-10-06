// lib/server/ngrpTalentAcquisition.js
//
// RESIDENCY-PORTAL-2: what the Residency Portal's audience (Cedars-Sinai
// Talent Acquisition) may see of a residency cohort. Owner decisions,
// 2026-09-10:
//   - the roster is limited to alumni who SUBMITTED the Transition Form,
//     regardless of eligibility;
//   - At a Glance still shows the cohort-wide counts, because a number names
//     no one.
// Pure and db-free, so the rule is testable and both Residency endpoints read
// the same one. It lives in its own module because ngrpStates.js already
// imports from ngrpApplicants.js; putting this there would make a cycle.
import { deriveApplicantRows, effectiveEligibility } from '../../src/lib/ngrp/ngrpStates.js'
import { pipelineStages } from '../../src/lib/ngrp/ngrpPlanningView.js'

export const TALENT_ACQUISITION = 'talent_acquisition'

// A submitted form is one with at least one immutable revision: first
// submission, or any later revision.
export const SUBMITTED_FORM_STATUSES = Object.freeze(['submitted', 'revised'])

export function hasSubmittedForm(status) {
  return SUBMITTED_FORM_STATUSES.includes(status)
}

// What Talent Acquisition sees of an applicants payload. RESIDENCY-TA-1 (Owner, 2026-10-05):
// EVERY alumnus, as the ASPIRE team sees them (it was form submitters only), because support
// and flags start before the Transition Form goes out. The pipeline counts are added as before.
export function narrowPayloadForTalentAcquisition(payload) {
  const students = payload?.students || []
  const candidates = payload?.candidates || []
  const pipeline = pipelineStages(deriveApplicantRows(students, candidates), { effectiveEligibility })
    .map(({ key, label, count, hint }) => ({ key, label, count, hint }))
  return { ...payload, students, candidates, pipeline }
}

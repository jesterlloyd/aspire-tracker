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

// Narrow an applicants payload to what Talent Acquisition may see. The
// pipeline is computed over the FULL cohort before narrowing, and carries
// counts only.
export function narrowPayloadForTalentAcquisition(payload) {
  const students = payload?.students || []
  const candidates = payload?.candidates || []
  const pipeline = pipelineStages(deriveApplicantRows(students, candidates), { effectiveEligibility })
    .map(({ key, label, count, hint }) => ({ key, label, count, hint }))
  const submitted = new Set(
    candidates.filter(c => hasSubmittedForm(c.form_status)).map(c => c.student_id),
  )
  return {
    ...payload,
    students: students.filter(s => submitted.has(s.id)),
    candidates: candidates.filter(c => submitted.has(c.student_id)),
    pipeline,
  }
}

// src/lib/ngrp/interestEligibilityModel.js
//
// INTEREST-ELIGIBILITY-1 (Owner, 2026-10-29): Residency > Profiles & Interest > Interest &
// Eligibility. The words and sort order for the roster's columns, pure and tested.
//
// Licensure and Cedars-Sinai employment are what the alumnus reported on their latest
// submitted Transition Form (composeCandidateLifecycle attaches them); before a form is
// submitted there is nothing to show, which reads "Not reported". GPA is the student record's
// cumulative GPA, which the roster carries for the ASPIRE team only.

import { gpaBand } from '../constants.js'

// NgrpStatusPill's config shape.
export const LICENSE_LABELS = Object.freeze({
  active:  { label: 'Licensed',    family: 'ok',   icon: 'check' },
  pending: { label: 'NCLEX Ahead', family: 'wait', icon: 'clock' },
  none:    { label: 'Not Yet',     family: 'mute', icon: 'dash' },
})

// Any Cedars-Sinai position (per diem, part time, full time) makes an internal applicant.
export const EMPLOYMENT_LABELS = Object.freeze({
  per_diem:     { label: 'Internal', detail: 'Per diem' },
  part_time:    { label: 'Internal', detail: 'Part time' },
  full_time:    { label: 'Internal', detail: 'Full time' },
  not_employed: { label: 'External', detail: null },
  other:        { label: 'Other',    detail: null },
})

export const NOT_REPORTED = 'Not reported'

export function licenseOf(row) {
  return LICENSE_LABELS[row?.form_rn_status] || null
}

export function employmentOf(row) {
  return EMPLOYMENT_LABELS[row?.form_cs_employment] || null
}

export function gpaOf(row) {
  const n = Number(row?.student?.cumulative_gpa)
  return row?.student?.cumulative_gpa == null || row?.student?.cumulative_gpa === '' || !Number.isFinite(n) ? null : n
}

export { gpaBand }

// Sort ranks: the order a column reads in ascending, best-known first where it matters.
const FORM_RANK = { not_sent: 0, sent: 1, opened: 2, in_progress: 3, submitted: 4, revised: 4 }
const LICENSE_RANK = { active: 0, pending: 1, none: 2 }
const EMPLOYMENT_RANK = { per_diem: 0, part_time: 0, full_time: 0, not_employed: 1, other: 2 }
const ELIGIBILITY_RANK = { eligible: 0, conditionally_eligible: 1, pending: 2, not_eligible: 3 }

const lastFirst = s => `${s?.last_name || ''} ${s?.preferred_first_name || s?.first_name || ''}`.trim().toLowerCase()

// Columns that sort. A null sorts last in both directions (dataSheetSort's rule).
export function interestColumns({ effectiveEligibility, rosterStatus, statusOrder = [] }) {
  return [
    { key: 'alumnus', sortValue: r => lastFirst(r.student) },
    { key: 'form', sortValue: r => FORM_RANK[r.form_status] ?? null },
    { key: 'license', sortValue: r => LICENSE_RANK[r.form_rn_status] ?? null },
    { key: 'employment', sortValue: r => EMPLOYMENT_RANK[r.form_cs_employment] ?? null },
    { key: 'gpa', sortValue: r => gpaOf(r) },
    { key: 'eligibility', sortValue: r => ELIGIBILITY_RANK[effectiveEligibility(r)] ?? null },
    { key: 'choices', sortValue: r => (r.unit_preference_1 || '').toLowerCase() || null },
    { key: 'status', sortValue: r => { const i = statusOrder.indexOf(rosterStatus(r)); return i < 0 ? null : i } },
  ]
}

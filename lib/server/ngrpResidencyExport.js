// lib/server/ngrpResidencyExport.js
//
// RESIDENCY-PORTAL-3: the Alumni Roster as a CSV (Owner decision 8, modeled on
// the Nursing Education & Leadership Community Benefit export). As there, the
// file is built HERE, on the server, from the roster the caller is already
// allowed to see: the endpoint narrows Talent Acquisition to alumni who
// submitted the Transition Form BEFORE calling this, so the CSV can never hold
// a row the portal would not show.
//
// Columns: who the alumnus is, where they stand in this residency cohort, and
// every answer on their latest Transition Form submission (Owner: "show all";
// the form's consent line covers sharing these responses with Talent
// Acquisition). Deliberately NOT included: the alumnus's school and personal
// emails from the student record (not form responses), record ids, and
// preceptor feedback, which is released one applicant at a time by request.
import { getStudentPreferredFullName } from '../../src/lib/studentNameFormatters.js'
import { effectiveEligibility } from '../../src/lib/ngrp/ngrpStates.js'
import { validateApplicationChecklist } from './ngrpEligibility.js'

// The Community Benefit export's rule (lib/server/communityBenefit/compute.js):
// text that begins like a formula is prefixed so a spreadsheet shows it
// instead of evaluating it.
export function csvEscape(value) {
  const raw = value == null ? '' : String(value)
  const s = /^[=+\-@\t]/.test(raw) ? `'${raw}` : raw
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const words = v => (typeof v === 'string' && v ? v.replace(/_/g, ' ') : '')
const yesNo = v => (v === true ? 'Yes' : v === false ? 'No' : '')
const day = v => (typeof v === 'string' && v ? v.slice(0, 10) : '')

// The latest submitted revision per assignment, in one bounded read.
export async function fetchLatestRevisions(db, candidates) {
  const wanted = new Map((candidates || [])
    .filter(c => c.assignment_id && (c.form_revision_count || 0) > 0)
    .map(c => [c.assignment_id, c.form_revision_count]))
  if (wanted.size === 0) return { byAssignment: new Map() }
  const { data, error } = await db.from('ngrp_transition_revisions')
    .select('assignment_id, revision_number, payload')
    .in('assignment_id', [...wanted.keys()])
  if (error) return { error }
  const byAssignment = new Map()
  for (const row of data || []) {
    if (wanted.get(row.assignment_id) === row.revision_number) byAssignment.set(row.assignment_id, row.payload || {})
  }
  return { byAssignment }
}

// [header, (ctx) => value]. ctx = { student, candidate, form }.
const BASE_COLUMNS = [
  ['Student', ({ student }) => getStudentPreferredFullName(student)],
  ['School', ({ student }) => student.school],
  ['Program', ({ student }) => student.program_type],
  ['ASPIRE Cohort', ({ student }) => student.aspire_cohort],
  ['Transition Form', ({ candidate }) => words(candidate?.form_status || 'not_sent')],
  ['Submitted', ({ candidate }) => day(candidate?.form_submitted_at)],
  ['Last Revised', ({ candidate }) => day(candidate?.form_revised_at)],
  ['Revisions', ({ candidate }) => candidate?.form_revision_count || ''],
  ['Eligibility', ({ candidate }) => (candidate ? words(effectiveEligibility(candidate)) : '')],
  ['Application', ({ candidate }) => words(candidate?.application_status)],
  ['Preferred Email', ({ form }) => form.identity?.preferred_email],
  ['Preferred Phone', ({ form }) => form.identity?.preferred_phone],
  ['Cedars-Sinai Employment', ({ form }) => words(form.identity?.cs_employment_status)],
  ['Form School', ({ form }) => form.education?.school],
  ['Form Program', ({ form }) => form.education?.program],
  ['Degree', ({ form }) => form.education?.degree_type],
  ['Completion Date', ({ form }) => form.education?.completion_date],
  ['GPA', ({ form }) => form.education?.gpa],
  ['US Accredited', ({ form }) => yesNo(form.education?.us_accredited)],
  ['Precepted Unit', ({ form }) => form.aspire?.precepted_unit],
  ['Precepted Unit (Other)', ({ form }) => form.aspire?.precepted_unit_other],
  ['ASPIRE Shifts', ({ form }) => form.aspire?.rotation_shifts],
  ['Prior NGRP Application', ({ form }) => yesNo(form.aspire?.prior_ngrp_applied)],
  ['Prior NGRP Details', ({ form }) => form.aspire?.prior_ngrp_details],
  ['CA RN License', ({ form }) => words(form.licensure?.ca_rn_status)],
  ['License Number', ({ form }) => form.licensure?.license_number],
  ['NCLEX Scheduled', ({ form }) => form.licensure?.nclex_scheduled_date],
  ['Paid RN Months', ({ form }) => form.licensure?.paid_rn_months],
  ['BLS Status', ({ form }) => words(form.licensure?.bls_status)],
  ['BLS Issuer', ({ form }) => form.licensure?.bls_issuer],
  ['BLS Expiration', ({ form }) => form.licensure?.bls_expiration],
  ['ACLS Required', ({ form }) => (form.licensure ? yesNo(form.licensure.acls_required === true) : '')],
  ['ACLS Status', ({ form }) => words(form.licensure?.acls_status)],
  ['ACLS Issuer', ({ form }) => form.licensure?.acls_issuer],
  ['ACLS Expiration', ({ form }) => form.licensure?.acls_expiration],
  ['Residency Interest', ({ form }) => words(form.residency_interest?.interest)],
  ['Unit Preference 1', ({ form }) => form.residency_interest?.unit_preferences?.[0]],
  ['Unit Preference 2', ({ form }) => form.residency_interest?.unit_preferences?.[1]],
  ['Unit Preference 3', ({ form }) => form.residency_interest?.unit_preferences?.[2]],
  ['Interest Statement', ({ form }) => form.residency_interest?.interest_statement],
  ['Strengths Statement', ({ form }) => form.residency_interest?.strengths_statement],
]
const ATTESTATION_COLUMNS = [
  ['Attested Accurate', ({ form }) => (form.attestation ? yesNo(form.attestation.accurate === true) : '')],
  ['Consent to Follow-Up', ({ form }) => (form.attestation ? yesNo(form.attestation.consent_followup === true) : '')],
  ['Consent to Share with Talent Acquisition', ({ form }) => (form.attestation ? yesNo(form.attestation.consent_hr_share === true) : '')],
]

function slug(name) {
  return String(name || 'cohort').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cohort'
}

// One row per student on the (already narrowed) roster, in roster name order.
export function buildResidencyCsv({ cycle, students = [], candidates = [], revisionsByAssignment = new Map() }) {
  // The cohort's own readiness checklist, one Yes/No column per item.
  const checklist = validateApplicationChecklist(cycle?.application_checklist)
  const columns = [
    ...BASE_COLUMNS,
    ...checklist.map(item => [
      `Readiness: ${item.label}`,
      ({ form }) => (form.readiness ? yesNo(form.readiness[item.key] === true) : ''),
    ]),
    ...ATTESTATION_COLUMNS,
  ]
  const candidateByStudent = new Map(candidates.map(c => [c.student_id, c]))
  const ordered = [...students].sort((a, b) =>
    getStudentPreferredFullName(a).localeCompare(getStudentPreferredFullName(b)))
  const lines = [columns.map(([h]) => csvEscape(h)).join(',')]
  for (const student of ordered) {
    const candidate = candidateByStudent.get(student.id) || null
    const form = (candidate?.assignment_id && revisionsByAssignment.get(candidate.assignment_id)) || {}
    lines.push(columns.map(([, get]) => csvEscape(get({ student, candidate, form }))).join(','))
  }
  return {
    csv: lines.join('\n') + '\n',
    filename: `aspire-residency-${slug(cycle?.name)}.csv`,
  }
}

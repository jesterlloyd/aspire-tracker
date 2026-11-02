// lib/server/ngrpResidencyExport.js
//
// TRANSITION-EXCEL-1 (Owner, 2026-11-01): the Transition Form answers as an Excel workbook, shaped
// like the Microsoft Forms export Talent Acquisition already works from. It replaced the roster CSV
// (RESIDENCY-PORTAL-3), which held every answer and every roster field and was less useful to them.
// Built HERE, on the server, from the roster the caller may already see.
//
// One row per alumnus who has SUBMITTED, from their latest revision, oldest response first. The
// form's consent line covers sharing these answers with Talent Acquisition, GPA included (Owner,
// 2026-11-01). The GPA is the one they wrote on the form, never the student record's.
//
// Where a column of the old form has no question on this one (CS unit and role, program completed,
// expected rotation end, license issue date, the one-interview acknowledgment, interim permit), it
// is left out rather than left blank. This form ranks three units, so Third Choice is added.
//
// Every text cell is an inline string (lib/server/sheet/xlsx.js), so an answer cannot run as a
// formula. Deliberately NOT included: the student record's emails, record ids, preceptor feedback
// itself (its points in the Fit columns are the score's, which both audiences already see).
import { xlsxFor } from './sheet/xlsx.js'
import { csEmploymentText, formPreceptedUnits } from '../../src/lib/ngrp/preceptedUnits.js'
import { FACTORS } from '../../src/lib/ngrp/candidateScoreModel.js'

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

const yesNo = v => (v === true ? 'Yes' : v === false ? 'No' : '')
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
const usDate = v => {
  if (!isDate(v)) return ''
  const [y, m, d] = v.slice(0, 10).split('-').map(Number)
  return `${m}/${d}/${y}`
}
const pacificTime = v => {
  const t = new Date(v || NaN)
  if (Number.isNaN(t.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(t).replace(',', '')
}
const EMPLOYMENT = { not_employed: 'No', per_diem: 'Yes, per diem', part_time: 'Yes, part time', full_time: 'Yes, full time', other: 'Other' }
const number = v => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? { n } : ''
}
const fitWords = s => (!s ? '' : s.score == null ? s.label : `${s.label}${s.provisional ? ' (provisional)' : ''}`)
const basedOnCell = s => (s?.basedOn != null ? `${s.basedOn} of ${FACTORS.length} factors${s.provisional ? ', provisional' : ''}` : '')
const factorCell = (s, key) => {
  const f = s?.factors?.find(x => x.key === key)
  if (!f) return ''
  return f.points == null ? 'Not counted' : { n: f.points }
}
const prepared = (form, key) => (form.readiness ? yesNo(form.readiness[key] === true) : '')
const submittedAt = c => c?.form_revised_at || c?.form_submitted_at || ''

// The sample's headers, in the sample's order: [header, (ctx) => cell, width in pixels].
const PREPARED = 'Have you prepared the following required application materials?'
const COLUMNS = [
  ['Id', ({ index }) => ({ n: index + 1 }), 50],
  ['Completion time', ({ candidate }) => pacificTime(submittedAt(candidate)), 140],
  ['Full Legal Name (Last Name, First Name)', ({ student }) => [student.last_name, student.first_name].filter(Boolean).join(', '), 220],
  ['Phone Number', ({ form }) => form.identity?.preferred_phone, 130],
  ['Email Address', ({ form }) => form.identity?.preferred_email, 220],
  ['Are you currently employed at Cedars-Sinai?', ({ form }) => (form.identity?.cs_employment_status === 'other' ? csEmploymentText(form.identity) : EMPLOYMENT[form.identity?.cs_employment_status] || ''), 150],
  ['School', ({ form }) => form.education?.school, 220],
  ['Program Type', ({ form }) => form.education?.program, 110],
  ['Date of Graduation', ({ form }) => usDate(form.education?.completion_date), 110],
  ['Cumulative GPA', ({ form }) => number(form.education?.gpa), 90],
  ['Did you complete your senior bedside rotation through ASPIRE?', ({ student }) => (student.status === 'Completed' ? 'Yes' : ''), 170],
  ['Unit where you completed your ASPIRE rotation', ({ form }) => formPreceptedUnits(form.aspire).join(', '), 170],
  ['ASPIRE shifts completed to date', ({ form }) => number(form.aspire?.rotation_shifts), 110],
  ['Have you previously applied to the Cedars-Sinai New Graduate RN Residency Program?', ({ form }) => yesNo(form.aspire?.prior_ngrp_applied), 170],
  ['If previously applied, which cohort(s)?', ({ form }) => form.aspire?.prior_ngrp_details, 170],
  ['Have you passed the NCLEX-RN?', ({ form }) => (form.licensure ? yesNo(form.licensure.ca_rn_status === 'active') : ''), 110],
  ['RN License Number', ({ form }) => form.licensure?.license_number, 120],
  ['Have you scheduled your NCLEX?', ({ form }) => (form.licensure?.ca_rn_status === 'active' ? 'N/A' : form.licensure ? yesNo(isDate(form.licensure.nclex_scheduled_date)) : ''), 110],
  ['Scheduled Test Date', ({ form }) => usDate(form.licensure?.nclex_scheduled_date), 110],
  ['First Choice Unit', ({ form }) => form.residency_interest?.unit_preferences?.[0], 150],
  ['Second Choice Unit', ({ form }) => form.residency_interest?.unit_preferences?.[1], 150],
  ['Third Choice Unit', ({ form }) => form.residency_interest?.unit_preferences?.[2], 150],
  ['Why are you interested in your first-choice unit?', ({ form }) => form.residency_interest?.interest_statement, 320],
  ['What clinical strengths do you bring to this unit?', ({ form }) => form.residency_interest?.strengths_statement, 320],
  [`${PREPARED} Updated professional résumé (within the last 3 months)`, ({ form }) => prepared(form, 'resume'), 150],
  [`${PREPARED} At least two letters of recommendation`, ({ form }) => prepared(form, 'recommendation_letters'), 150],
  [`${PREPARED} Personal statement tailored to Cedars-Sinai`, ({ form }) => prepared(form, 'personal_statement'), 150],
  [`${PREPARED} Unofficial or official transcript`, ({ form }) => prepared(form, 'transcript'), 150],
  [`${PREPARED} Current BLS certification`, ({ form }) => (form.licensure ? yesNo(form.licensure.bls_status === 'active') : ''), 150],
  [`${PREPARED} RN license (if applicable)`, ({ form }) => (form.licensure ? (form.licensure.ca_rn_status === 'active' ? 'Yes' : 'N/A') : ''), 150],
  [`${PREPARED} Your cumulative GPA 3.0 or above`, ({ form }) => { const g = number(form.education?.gpa); return g ? yesNo(g.n >= 3) : '' }, 150],
  // FIT-RULES-2 (Owner, 2026-11-02): the candidate score, after the form's own columns so the
  // Microsoft Forms shape is unchanged. Each factor is its points, or "Not counted".
  ['Fit Score', ({ candidate }) => (candidate.candidate_score?.score != null ? { n: candidate.candidate_score.score } : ''), 80],
  ['Fit', ({ candidate }) => fitWords(candidate.candidate_score), 150],
  ['Fit Based On', ({ candidate }) => basedOnCell(candidate.candidate_score), 140],
  ...FACTORS.map(f => [`Fit: ${f.label} (of ${f.max})`, ({ candidate }) => factorCell(candidate.candidate_score, f.key), 120]),
]
export const FROZEN_COLUMNS = 3   // Id, Completion time and the name stay put, as in the sample

const fileSafe = name => String(name || 'Cohort').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Cohort'

/** The rows of the workbook: { header, rows, widths }. Pure. */
export function transitionWorkbookRows({ students = [], candidates = [], revisionsByAssignment = new Map(), withIds = false }) {
  const studentById = new Map(students.map(s => [s.id, s]))
  const responses = candidates
    .map(candidate => ({ candidate, student: studentById.get(candidate.student_id), form: candidate.assignment_id && revisionsByAssignment.get(candidate.assignment_id) }))
    .filter(r => r.student && r.form)
    .sort((a, b) => String(submittedAt(a.candidate)).localeCompare(String(submittedAt(b.candidate))))
  return {
    header: COLUMNS.map(([h]) => h),
    widths: COLUMNS.map(([, , w]) => w),
    rows: responses.map((r, index) => COLUMNS.map(([, get]) => get({ ...r, index }) ?? '')),
    // APPLICANT-SHEET-1: the Sheet keys its marks to the candidate; the file never carries ids.
    ...(withIds ? { ids: responses.map(r => r.candidate.id) } : {}),
  }
}

// { bytes, fileName }: the .xlsx, built from the (already narrowed) roster.
export function buildTransitionWorkbook({ cycle, students, candidates, revisionsByAssignment }) {
  const { header, rows, widths } = transitionWorkbookRows({ students, candidates, revisionsByAssignment })
  return {
    bytes: xlsxFor({ sheetName: 'Responses', header, rows, widths, freezeCols: FROZEN_COLUMNS }),
    fileName: `ASPIRE to NGRP Transition Form - ${fileSafe(cycle?.name)}.xlsx`,
  }
}

// NGRP-WORKSPACE-1: single source of truth for every NGRP workflow vocabulary,
// its display metadata, and the Applicants roster derivation.
//
// The roster is DERIVED, never duplicated: a completed ASPIRE student IS a
// prospective NGRP candidate. A cycle-specific ngrp_candidates row exists only
// once an NGRP action has occurred (form sent, interest recorded, eligibility
// calculated, application confirmed, unit assigned, interview recorded). A
// student with no candidate row therefore renders the neutral defaults below -
// Not Sent / No Response / Pending / Not Confirmed - which are baseline
// states, not failures.
//
// Color families follow the app-wide status language:
//   ok   (green check)  - eligible, submitted, confirmed, completed
//   wait (amber clock)  - conditional, in progress, scheduled, pending review
//   info (blue info)    - sent, opened, interested, assigned
//   err  (red alert)    - not eligible, failed delivery, no show
//   mute (gray dash)    - no action yet, no response, not confirmed (NEUTRAL)
// Color is never the only signal: every pill renders an icon + text label.
import { cycleChronoKey } from '../../../lib/server/ngrpApplicants.js'

// ── Color families (hexes shared with ASPIRE_STATUS_CONFIG families) ─────────
export const PILL_FAMILIES = {
  ok:   { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  wait: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  info: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  err:  { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  mute: { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db' },
}

// ── Transition Form ──────────────────────────────────────────────────────────
export const FORM_STATES = {
  not_sent:    { label: 'Not Sent',    family: 'mute', icon: 'dash' },
  sent:        { label: 'Sent',        family: 'info', icon: 'info' },
  opened:      { label: 'Opened',      family: 'info', icon: 'info' },
  in_progress: { label: 'In Progress', family: 'wait', icon: 'clock' },
  submitted:   { label: 'Submitted',   family: 'ok',   icon: 'check' },
  revised:     { label: 'Revised',     family: 'ok',   icon: 'check' },
}
export const FORM_ORDER = ['not_sent', 'sent', 'opened', 'in_progress', 'submitted', 'revised']

// ── Residency interest ───────────────────────────────────────────────────────
export const INTEREST_STATES = {
  interested:     { label: 'Interested',     family: 'info', icon: 'info' },
  undecided:      { label: 'Undecided',      family: 'wait', icon: 'clock' },
  not_interested: { label: 'Not Interested', family: 'mute', icon: 'dash' },
  no_response:    { label: 'No Response',    family: 'mute', icon: 'dash' },
}

// ── Calculated eligibility ───────────────────────────────────────────────────
export const ELIGIBILITY_STATES = {
  pending:                { label: 'Pending',                family: 'mute', icon: 'dash' },
  eligible:               { label: 'Eligible',               family: 'ok',   icon: 'check' },
  conditionally_eligible: { label: 'Conditionally Eligible', family: 'wait', icon: 'clock' },
  not_eligible:           { label: 'Not Eligible',           family: 'err',  icon: 'alert' },
}

// ── Official NGRP application ────────────────────────────────────────────────
// A submitted Transition Form and an eligible result are NOT an application.
// Only 'confirmed' means the alumnus appears on the official NGRP applicant
// list. 'not_confirmed' is a neutral state, styled accordingly.
export const APPLICATION_STATES = {
  not_confirmed: { label: 'Not Confirmed', family: 'mute', icon: 'dash' },
  confirmed:     { label: 'Confirmed',     family: 'ok',   icon: 'check' },
  withdrawn:     { label: 'Withdrawn',     family: 'mute', icon: 'dash' },
}

// ── Interview ────────────────────────────────────────────────────────────────
export const INTERVIEW_STATES = {
  not_scheduled:      { label: 'Not Scheduled',      family: 'mute', icon: 'dash' },
  scheduled:          { label: 'Scheduled',          family: 'wait', icon: 'clock' },
  completed:          { label: 'Completed',          family: 'ok',   icon: 'check' },
  decision_recorded:  { label: 'Decision Recorded',  family: 'ok',   icon: 'check' },
  cancelled:          { label: 'Cancelled',          family: 'mute', icon: 'dash' },
  applicant_withdrew: { label: 'Applicant Withdrew', family: 'mute', icon: 'dash' },
  no_interview:       { label: 'No Interview',       family: 'mute', icon: 'dash' },
  no_show:            { label: 'No Show',            family: 'err',  icon: 'alert' },
}

// ── Cycle status vocabulary (ngrp_cycles.status; plan section 10.1) ──────────
export const CYCLE_STATUSES = [
  'Planning', 'Accepting Interest', 'Application Open', 'Application Closed',
  'Interviews', 'Offers', 'Residency Active', 'Completed', 'Archived',
]

// ── Selector ordering (plan §3.2) ────────────────────────────────────────────
// Current active cycle first; other planned/open/in-progress cycles next in
// chronological order; Completed/Archived afterward. Chronology ties break by
// application opening date, then residency start date (cycleChronoKey - the
// same authoritative comparison the prior-hire exclusion uses).
export const CYCLE_CLOSED_STATUSES = ['Completed', 'Archived']

export function orderCyclesForSelector(cycles) {
  const group = c => (c.is_active ? 0 : CYCLE_CLOSED_STATUSES.includes(c.status) ? 2 : 1)
  return [...(cycles || [])].sort((a, b) => {
    const g = group(a) - group(b)
    if (g !== 0) return g
    return cycleChronoKey(a) < cycleChronoKey(b) ? -1 : cycleChronoKey(a) > cycleChronoKey(b) ? 1 : 0
  })
}

// The effective selection: a still-valid saved selection is preserved; else
// the active cycle; else the first of the ordered list. Pure, so the
// preference restore is unit-testable.
export function resolveSelectedCycle(cycles, preferredId) {
  const ordered = orderCyclesForSelector(cycles)
  return ordered.find(c => c.id === preferredId)
    || ordered.find(c => c.is_active)
    || ordered[0]
    || null
}

const CANDIDATE_DEFAULTS = {
  form_status: 'not_sent',
  interest: 'no_response',
  eligibility_calculated: 'pending',
  eligibility_effective: null,
  eligibility_reasons: [],
  application_status: 'not_confirmed',
  assigned_unit: null,
  interview_status: 'not_scheduled',
}

// The staff override, when present, is the effective result; the calculated
// result is always retained and shown alongside it in the drawer.
export function effectiveEligibility(row) {
  return row.eligibility_effective || row.eligibility_calculated || 'pending'
}

// ── Roster derivation ────────────────────────────────────────────────────────
// students: the cohort-scoped canonical rows already loaded by App.jsx.
// candidates: cycle-scoped ngrp_candidates rows (empty until provisioned /
// until an action occurs). The join key is the canonical student id.
export function deriveApplicantRows(students, candidates) {
  const byStudent = new Map((candidates || []).map(c => [c.student_id, c]))
  return (students || [])
    .filter(s => s.status === 'Completed')
    .map(s => {
      const c = byStudent.get(s.id) || null
      return {
        student: s,
        candidate: c,
        ...CANDIDATE_DEFAULTS,
        ...(c || {}),
        // Identity always comes from the canonical student row, never the
        // candidate row - candidate rows carry workflow state only.
        id: s.id,
        candidate_id: c?.id || null,
        last_activity_at: c?.updated_at || s.updated_at || null,
      }
    })
}

// ── KPI cards (each card is a roster filter) ─────────────────────────────────
export const KPI_DEFS = [
  { key: 'all',        label: 'Completed Alumni',       sub: 'Prospective candidates', accent: 'nightfall',
    match: () => true },
  { key: 'not_sent',   label: 'Form Not Sent',          sub: 'Awaiting outreach',      accent: 'dawn',
    match: r => r.form_status === 'not_sent' && r.application_status !== 'withdrawn' },
  { key: 'submitted',  label: 'Form Submitted',         sub: 'Includes revisions',     accent: 'periwinkle',
    match: r => r.form_status === 'submitted' || r.form_status === 'revised' },
  { key: 'eligible',   label: 'Eligible',               sub: 'Effective result',       accent: 'sage',
    match: r => effectiveEligibility(r) === 'eligible' },
  { key: 'cond',       label: 'Conditionally Eligible', sub: 'Requirement pending',    accent: 'lavender',
    match: r => effectiveEligibility(r) === 'conditionally_eligible' },
  { key: 'confirmed',  label: 'Application Confirmed',  sub: 'Official NGRP list',     accent: 'marina',
    match: r => r.application_status === 'confirmed' },
]

// ── Sorting ──────────────────────────────────────────────────────────────────
// Default operational priority (lower rank = higher on the roster):
//   1 application confirmed
//   2 interested and eligible
//   3 interested and conditionally eligible
//   4 form submitted but pending review (incl. a Not Eligible result awaiting
//     staff review/override - it needs the same staff attention)
//   5 form sent but incomplete (sent / opened / in progress)
//   6 form not sent
//   7 not interested or withdrawn (neutral, parked at the bottom - never a
//     demerit, just not actionable)
export function operationalRank(r) {
  const elig = effectiveEligibility(r)
  if (r.application_status === 'withdrawn' || r.interest === 'not_interested') return 7
  if (r.application_status === 'confirmed') return 1
  const formDone = r.form_status === 'submitted' || r.form_status === 'revised'
  if (formDone && r.interest === 'interested' && elig === 'eligible') return 2
  if (formDone && r.interest === 'interested' && elig === 'conditionally_eligible') return 3
  if (formDone) return 4
  if (['sent', 'opened', 'in_progress'].includes(r.form_status)) return 5
  return 6
}

const ELIG_SORT = { eligible: 0, conditionally_eligible: 1, pending: 2, not_eligible: 3 }

export const SORT_OPTIONS = [
  { key: 'priority', label: 'Operational priority' },
  { key: 'name',     label: 'Student A–Z' },
  { key: 'cohort',   label: 'ASPIRE cohort timeline' },
  { key: 'school',   label: 'School' },
  { key: 'elig',     label: 'Eligibility' },
  { key: 'recent',   label: 'Most recently updated' },
]

// cohortOrder: cohort name -> position, built by the caller from the cohorts
// table (ordered by start_date) so cohort timeline sorting follows real dates,
// not string order.
export function sortApplicantRows(rows, sortKey, { cohortOrder = {} } = {}) {
  const byName = (a, b) =>
    `${a.student.last_name || ''} ${a.student.first_name || ''}`
      .localeCompare(`${b.student.last_name || ''} ${b.student.first_name || ''}`)
  const sorted = [...rows]
  switch (sortKey) {
    case 'name':
      return sorted.sort(byName)
    case 'cohort':
      return sorted.sort((a, b) =>
        (cohortOrder[a.student.aspire_cohort] ?? 99) - (cohortOrder[b.student.aspire_cohort] ?? 99) || byName(a, b))
    case 'school':
      return sorted.sort((a, b) =>
        (a.student.school || '').localeCompare(b.student.school || '') || byName(a, b))
    case 'elig':
      return sorted.sort((a, b) =>
        (ELIG_SORT[effectiveEligibility(a)] ?? 9) - (ELIG_SORT[effectiveEligibility(b)] ?? 9) || byName(a, b))
    case 'recent':
      return sorted.sort((a, b) =>
        (b.last_activity_at || '').localeCompare(a.last_activity_at || '') || byName(a, b))
    case 'priority':
    default:
      return sorted.sort((a, b) => operationalRank(a) - operationalRank(b) || byName(a, b))
  }
}

// Most recent relevant Transition Form timestamp for the roster cell.
export function formTimestamp(row) {
  switch (row.form_status) {
    case 'revised':     return row.form_revised_at || row.form_submitted_at
    case 'submitted':   return row.form_submitted_at
    case 'in_progress': return row.form_last_saved_at || row.form_opened_at
    case 'opened':      return row.form_opened_at
    case 'sent':        return row.form_sent_at
    default:            return null
  }
}

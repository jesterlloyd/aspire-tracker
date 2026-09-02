// lib/server/ngrpPlanning.js
//
// NGRP-RELEASE-2: pure validation for Planning writes. Every Planning
// endpoint validates through these before touching the database, and the
// database CHECKs (migration 20260903000000 + 20260904000000) back the same
// rules, so a bad payload is rejected twice.
import {
  validateQualificationRules, validateApplicationChecklist, validateRetentionBenchmarks,
} from './ngrpEligibility.js'

// NGRP-CYCLE-STATUS-CANON: the vocabulary lives in ONE place. This module and the
// picker previously each declared the list, so the validator and the dropdown could
// disagree about what a legal status was and nothing would have caught it. Re-exported
// rather than redeclared; src/lib/ngrp/ngrpStates.js is pure and node-safe, and the
// ngrp_cycles CHECK constraint remains the runtime authority over both.
export { CYCLE_STATUSES, FORM_ACTIVE_STATUSES } from '../../src/lib/ngrp/ngrpStates.js'
import { CYCLE_STATUSES, FORM_ACTIVE_STATUSES } from '../../src/lib/ngrp/ngrpStates.js'

const isDateStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const optDate = v => (v === null || v === undefined || v === '' ? null : (isDateStr(v) ? v : undefined))

// Validate a cycle create/update payload. Returns { ok:true, cycle } with a
// normalized row patch, or { ok:false, errors:[{field, message}] }.
// Date-order rules mirror the DB CHECKs so the user sees a named field, not
// a constraint violation.
export function validateCyclePayload(input) {
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {}
  const errors = []
  const name = typeof src.name === 'string' ? src.name.trim() : ''
  if (!name) errors.push({ field: 'name', message: 'Name is required.' })
  if (name.length > 120) errors.push({ field: 'name', message: 'Name must be 120 characters or fewer.' })

  const status = src.status === undefined ? 'Planning' : src.status
  if (!CYCLE_STATUSES.includes(status)) errors.push({ field: 'status', message: 'Status is not in the approved vocabulary.' })

  const dates = {}
  for (const field of ['application_open_date', 'application_deadline', 'interview_window_start', 'interview_window_end', 'licensure_deadline', 'residency_start_date']) {
    const v = optDate(src[field])
    if (v === undefined) errors.push({ field, message: 'Enter a date as YYYY-MM-DD.' })
    else dates[field] = v
  }
  if (dates.application_open_date && dates.application_deadline && dates.application_deadline < dates.application_open_date) {
    errors.push({ field: 'application_deadline', message: 'Application closing date cannot precede the opening date.' })
  }
  if (dates.interview_window_start && dates.interview_window_end && dates.interview_window_end < dates.interview_window_start) {
    errors.push({ field: 'interview_window_end', message: 'Interview window cannot end before it starts.' })
  }

  const notes = typeof src.notes === 'string' ? src.notes : (src.notes == null ? null : undefined)
  if (notes === undefined) errors.push({ field: 'notes', message: 'Notes must be text.' })

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    cycle: {
      name,
      status,
      ...dates,
      notes: notes || null,
      qualification_rules: validateQualificationRules(src.qualification_rules),
      application_checklist: validateApplicationChecklist(src.application_checklist),
      retention_benchmarks: validateRetentionBenchmarks(src.retention_benchmarks),
    },
  }
}

// Source-cohort mapping payload: an array of ASPIRE cohort uuids, deduped.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function validateSourceCohortIds(input) {
  if (!Array.isArray(input)) return { ok: false, errors: [{ field: 'cohort_ids', message: 'Send a list of ASPIRE cohort ids.' }] }
  const ids = [...new Set(input.filter(v => typeof v === 'string'))]
  if (ids.length !== input.length) {
    // duplicates are silently deduped rather than rejected - the mapping is a set
  }
  if (ids.some(id => !UUID.test(id))) return { ok: false, errors: [{ field: 'cohort_ids', message: 'One of the cohort ids is not valid.' }] }
  return { ok: true, ids }
}

// Participating-unit payload for a full replace: [{ unit_name, is_active,
// display_order, capacity }]. Names must be nonblank and unique.
export function validateCycleUnits(input) {
  if (!Array.isArray(input)) return { ok: false, errors: [{ field: 'units', message: 'Send a list of units.' }] }
  const errors = []
  const seen = new Set()
  const units = []
  input.forEach((u, i) => {
    const src = (u && typeof u === 'object') ? u : {}
    const unit_name = typeof src.unit_name === 'string' ? src.unit_name.trim() : ''
    if (!unit_name) { errors.push({ field: `units[${i}].unit_name`, message: 'Unit name is required.' }); return }
    const key = unit_name.toLowerCase()
    if (seen.has(key)) { errors.push({ field: `units[${i}].unit_name`, message: `"${unit_name}" is listed twice.` }); return }
    seen.add(key)
    let capacity = null
    if (src.capacity !== null && src.capacity !== undefined && src.capacity !== '') {
      const n = Number(src.capacity)
      if (!Number.isInteger(n) || n <= 0) { errors.push({ field: `units[${i}].capacity`, message: 'Capacity must be a positive whole number (or blank).' }); return }
      capacity = n
    }
    units.push({
      unit_name,
      is_active: src.is_active !== false,
      display_order: Number.isInteger(src.display_order) ? src.display_order : units.length,
      capacity,
    })
  })
  if (errors.length) return { ok: false, errors }
  return { ok: true, units }
}

// Why a cycle can or cannot host Transition Form activity. Sending forms and
// opening a form-active status both require ok:true; the reasons are shown
// verbatim in Planning ("why can't this open?").
export function openReadiness({ cycle, sourceCohortCount, activeUnitCount }) {
  const reasons = []
  if (!cycle) return { ok: false, reasons: ['No residency cohort is selected.'] }
  if (!isDateStr(cycle.application_deadline)) {
    reasons.push('No application closing date is set - the Transition Form has no effective close, so sending is disabled until one is set in Edit Cohort.')
  }
  if (!sourceCohortCount) {
    reasons.push('No ASPIRE cohorts are participating, so there is no alumni scope to draw applicants from.')
  }
  if (!activeUnitCount) {
    reasons.push('No active participating units are configured, so the form cannot offer ranked unit preferences.')
  }
  return { ok: reasons.length === 0, reasons }
}

// Guard used when saving a cycle INTO a form-active status.
export function validateStatusTransition({ nextStatus, readiness }) {
  if (!FORM_ACTIVE_STATUSES.includes(nextStatus)) return { ok: true }
  if (readiness.ok) return { ok: true }
  return {
    ok: false,
    errors: readiness.reasons.map(message => ({ field: 'status', message })),
  }
}

// ── NGRP-INTERVIEW-HIRE-1 ───────────────────────────────────────────────────
//
// The interview record. Same vocabulary as INTERVIEW_STATES and as the
// ngrp_candidates CHECK; validated here so the caller sees a named field rather
// than a constraint violation.
export const INTERVIEW_STATUSES = [
  'not_scheduled', 'scheduled', 'completed', 'decision_recorded',
  'cancelled', 'applicant_withdrew', 'no_interview', 'no_show',
]

const isTimestamp = v => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const optTimestamp = v => (v === null || v === undefined || v === '' ? null : (isTimestamp(v) ? v : undefined))

export function validateInterviewPayload(input) {
  const src = (input && typeof input === 'object') ? input : {}
  const errors = []
  const status = typeof src.status === 'string' ? src.status : ''
  if (!INTERVIEW_STATUSES.includes(status)) {
    errors.push({ field: 'status', message: 'Choose an interview state.' })
  }
  const at = optTimestamp(src.interview_at)
  if (at === undefined) errors.push({ field: 'interview_at', message: 'That interview date is not a valid date and time.' })
  // A scheduled interview has a time; the DB enforces this too, but a named
  // field beats a constraint violation.
  if (status === 'scheduled' && !at) {
    errors.push({ field: 'interview_at', message: 'A scheduled interview needs a date and time.' })
  }
  if (errors.length) return { ok: false, errors }
  // Only 'scheduled' REQUIRES a time. Everything past it may keep the time it
  // was held at, and the states that mean it never happened drop it.
  const keepsTime = ['scheduled', 'completed', 'decision_recorded', 'no_show'].includes(status)
  return { ok: true, interview: { interview_status: status, interview_at: keepsTime ? at : null } }
}

// The durable employment record. Every field is optional: this is a record that
// accumulates over months, not a form submitted once.
export function validateOutcomePayload(input) {
  const src = (input && typeof input === 'object') ? input : {}
  const errors = []
  const out = {}
  for (const [key, field] of [
    ['offer_extended_at', 'offer_extended_at'],
    ['offer_accepted_at', 'offer_accepted_at'],
    ['hired_at', 'hired_at'],
  ]) {
    const v = optTimestamp(src[key])
    if (v === undefined) errors.push({ field, message: 'That is not a valid date and time.' })
    else out[key] = v
  }
  const start = src.residency_start_date
  if (start === null || start === undefined || start === '') out.residency_start_date = null
  else if (typeof start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(start)) out.residency_start_date = start
  else errors.push({ field: 'residency_start_date', message: 'Use a calendar date for the residency start.' })

  const unit = typeof src.hired_unit === 'string' ? src.hired_unit.trim() : ''
  out.hired_unit = unit || null

  // The DB enforces these two; naming the field is friendlier than a violation.
  if (out.offer_accepted_at && !out.offer_extended_at) {
    errors.push({ field: 'offer_accepted_at', message: 'Record the offer before recording that it was accepted.' })
  }
  // A hire without an accepted offer is possible in principle but is almost
  // always a mis-entry, so it is refused with a reason rather than stored.
  if (out.hired_at && !out.offer_accepted_at) {
    errors.push({ field: 'hired_at', message: 'Record the accepted offer before recording the hire.' })
  }
  if (out.hired_at && !out.hired_unit) {
    errors.push({ field: 'hired_unit', message: 'A hire needs the unit they were hired into.' })
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, outcome: out }
}

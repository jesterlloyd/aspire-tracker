// lib/server/ngrpPlanning.js
//
// NGRP-RELEASE-2: pure validation for Planning writes. Every Planning
// endpoint validates through these before touching the database, and the
// database CHECKs (migration 20260903000000 + 20260904000000) back the same
// rules, so a bad payload is rejected twice.
import {
  validateQualificationRules, validateApplicationChecklist, validateRetentionBenchmarks,
} from './ngrpEligibility.js'

export const CYCLE_STATUSES = [
  'Planning', 'Accepting Interest', 'Application Open', 'Application Closed',
  'Interviews', 'Offers', 'Residency Active', 'Completed', 'Archived',
]

// Statuses in which alumni-facing form activity is expected: opening one of
// these requires a form-ready configuration (see openReadiness).
export const FORM_ACTIVE_STATUSES = ['Accepting Interest', 'Application Open']

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
    reasons.push('No application closing date is set - the Transition Form has no effective close, so sending is disabled until Planning sets one.')
  }
  if (!sourceCohortCount) {
    reasons.push('No source ASPIRE cohorts are mapped, so there is no alumni scope to draw applicants from.')
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

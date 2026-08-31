// lib/server/ngrpEligibility.js
//
// NGRP-RELEASE-2: the explainable eligibility engine. Pure and node-safe -
// no db, no env, no dates from the clock (the caller passes every fact), so
// each rule and every boundary is unit-testable.
//
// CONTRACT (plan §7):
// - The engine returns a RESULT plus explicit per-requirement rows with
//   codes, user-readable reasons, and deadlines. Never an unexplained score.
// - Result vocabulary: 'pending' | 'eligible' | 'conditionally_eligible' |
//   'not_eligible'.
// - Resolution order: any hard failure → not_eligible; else any unknown
//   fact or unconfigured input → pending; else any conditional →
//   conditionally_eligible (a conditional result can therefore only exist
//   when every OTHER hard rule passes, exactly as approved); else eligible.
// - Support participation is not an input and can never affect the result.
//
// CANONICAL qualification_rules SHAPE (stored in
// ngrp_cycles.qualification_rules; validated by validateQualificationRules):
//   {
//     version: 1,
//     gpa_min: 3.0,
//     max_paid_rn_months: 9,          // strictly-less-than: 9 months fails
//     completion_window_months: 12,
//     require_accreditation: false,   // external degree/accreditation rule
//     nclex_exception_enabled: true,
//     conditional: {
//       license: { enabled: true,  deadline: null },  // null → default rule
//       bls:     { enabled: false, deadline: null },
//       acls:    { enabled: false, deadline: null },
//     },
//   }
// The default licensure deadline, when none is configured anywhere, is 21
// days before the interview window opens (plan §7.3).
//
// "The application date" for as-of comparisons is the cycle's application
// DEADLINE (the date by which the person applies), falling back to the
// opening date; with neither configured the date-dependent rules are
// 'unknown' and the result is pending (incomplete Planning configuration).

export const ELIGIBILITY_RESULTS = ['pending', 'eligible', 'conditionally_eligible', 'not_eligible']
export const REQUIREMENT_CODES = [
  'license', 'experience', 'gpa', 'completion_window', 'bls', 'acls', 'accreditation',
]
export const REQUIREMENT_STATUSES = ['met', 'not_met', 'conditional', 'unknown']

const DEFAULT_RULES = Object.freeze({
  version: 1,
  gpa_min: 3.0,
  max_paid_rn_months: 9,
  completion_window_months: 12,
  require_accreditation: false,
  nclex_exception_enabled: true,
  conditional: {
    license: { enabled: true, deadline: null },
    bls: { enabled: false, deadline: null },
    acls: { enabled: false, deadline: null },
  },
})

const isFiniteNum = v => typeof v === 'number' && Number.isFinite(v)
const isDateStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

// Normalize any stored/submitted rules object into the canonical shape.
// Unknown keys are dropped; wrong types fall back to defaults. Never throws.
export function validateQualificationRules(input) {
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {}
  const condSrc = (src.conditional && typeof src.conditional === 'object') ? src.conditional : {}
  const cond = key => {
    const c = (condSrc[key] && typeof condSrc[key] === 'object') ? condSrc[key] : {}
    return {
      enabled: c.enabled === true || (c.enabled === undefined && DEFAULT_RULES.conditional[key].enabled),
      deadline: isDateStr(c.deadline) ? c.deadline : null,
    }
  }
  return {
    version: 1,
    gpa_min: isFiniteNum(src.gpa_min) && src.gpa_min >= 0 && src.gpa_min <= 4 ? src.gpa_min : DEFAULT_RULES.gpa_min,
    max_paid_rn_months: Number.isInteger(src.max_paid_rn_months) && src.max_paid_rn_months > 0 ? src.max_paid_rn_months : DEFAULT_RULES.max_paid_rn_months,
    completion_window_months: Number.isInteger(src.completion_window_months) && src.completion_window_months > 0 ? src.completion_window_months : DEFAULT_RULES.completion_window_months,
    require_accreditation: src.require_accreditation === true,
    nclex_exception_enabled: src.nclex_exception_enabled !== false,
    conditional: { license: cond('license'), bls: cond('bls'), acls: cond('acls') },
  }
}

// The five approved checklist items, as structured data (plan §6.2 item 6).
export const DEFAULT_APPLICATION_CHECKLIST = Object.freeze([
  { key: 'online_application', label: 'Online application', required: true },
  { key: 'resume', label: 'Resume with facility, unit, and clinical hours', required: true },
  { key: 'personal_statement', label: 'Personal statement (maximum two pages)', required: true },
  { key: 'transcript', label: 'Transcript with completion or graduation date', required: true },
  { key: 'recommendation_letters', label: 'Two recommendation letters', required: true },
])

export function validateApplicationChecklist(input) {
  if (!Array.isArray(input)) return [...DEFAULT_APPLICATION_CHECKLIST]
  const items = input
    .filter(it => it && typeof it === 'object' && typeof it.label === 'string' && it.label.trim())
    .map((it, i) => ({
      key: typeof it.key === 'string' && it.key.trim() ? it.key.trim() : `item_${i + 1}`,
      label: it.label.trim(),
      required: it.required !== false,
    }))
  return items.length ? items : [...DEFAULT_APPLICATION_CHECKLIST]
}

export function validateRetentionBenchmarks(input) {
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {}
  const pct = v => (isFiniteNum(v) && v >= 0 && v <= 100 ? v : null)
  return { traditional_pct: pct(src.traditional_pct), organization_pct: pct(src.organization_pct) }
}

// ── Date helpers (string dates, no clock) ────────────────────────────────────
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, d))
  return dt.toISOString().slice(0, 10)
}

// The date by which a licensure condition must be satisfied:
// explicit per-rule deadline → the cycle's licensure_deadline → 21 days
// before the interview window opens → null (unresolvable).
export function resolveLicensureDeadline(cycle, rules) {
  if (rules?.conditional?.license?.deadline) return rules.conditional.license.deadline
  if (isDateStr(cycle?.licensure_deadline)) return cycle.licensure_deadline
  if (isDateStr(cycle?.interview_window_start)) return addDays(cycle.interview_window_start, -21)
  return null
}

export function resolveApplicationDate(cycle) {
  if (isDateStr(cycle?.application_deadline)) return cycle.application_deadline
  if (isDateStr(cycle?.application_open_date)) return cycle.application_open_date
  return null
}

// ── The engine ───────────────────────────────────────────────────────────────
// facts: the flattened, already-extracted answers from the latest submitted
// revision (see extractEligibilityFacts). Missing/undefined fact → 'unknown'.
export function computeEligibility({ cycle, rules: rawRules, facts }) {
  const rules = validateQualificationRules(rawRules)
  const f = facts || {}
  const asOf = resolveApplicationDate(cycle)
  const licenseDeadline = resolveLicensureDeadline(cycle, rules)
  const rows = []
  const add = (code, status, label, detail, deadline = null) =>
    rows.push({ code, status, label, detail, deadline })

  // license — active CA RN by the application date, unless the NCLEX
  // exception grants a conditional pass.
  if (f.ca_rn_status === 'active') {
    add('license', 'met', 'Active California RN license', 'License reported active.')
  } else if (f.ca_rn_status === undefined || f.ca_rn_status === null) {
    add('license', 'unknown', 'Active California RN license', 'License status not provided yet.')
  } else if (rules.nclex_exception_enabled && rules.conditional.license.enabled) {
    if (!licenseDeadline) {
      add('license', 'unknown', 'Active California RN license',
        'NCLEX exception is enabled but no licensure deadline is configured (set one in Planning, or set the interview window).')
    } else if (isDateStr(f.nclex_scheduled_date) && f.nclex_scheduled_date <= licenseDeadline) {
      add('license', 'conditional', 'Active California RN license',
        `NCLEX scheduled ${f.nclex_scheduled_date}; license must be active by the deadline.`, licenseDeadline)
    } else if (isDateStr(f.nclex_scheduled_date)) {
      add('license', 'not_met', 'Active California RN license',
        `NCLEX is scheduled after the licensure deadline (${licenseDeadline}).`, licenseDeadline)
    } else {
      add('license', 'not_met', 'Active California RN license',
        'License is not active and no NCLEX date is scheduled.', licenseDeadline)
    }
  } else {
    add('license', 'not_met', 'Active California RN license', 'License is not active by the application date.')
  }

  // experience — strictly fewer than max_paid_rn_months on the application date.
  if (isFiniteNum(f.paid_rn_months)) {
    if (f.paid_rn_months < rules.max_paid_rn_months) {
      add('experience', 'met', `Fewer than ${rules.max_paid_rn_months} months paid RN experience`,
        `${f.paid_rn_months} month(s) reported.`)
    } else {
      add('experience', 'not_met', `Fewer than ${rules.max_paid_rn_months} months paid RN experience`,
        `${f.paid_rn_months} month(s) reported - at or over the limit.`)
    }
  } else {
    add('experience', 'unknown', `Fewer than ${rules.max_paid_rn_months} months paid RN experience`,
      'Paid RN experience not provided yet.')
  }

  // gpa — at least gpa_min (3.00 passes, 2.99 fails).
  if (isFiniteNum(f.gpa)) {
    if (f.gpa >= rules.gpa_min) add('gpa', 'met', `Nursing GPA at least ${rules.gpa_min.toFixed(2)}`, `GPA ${f.gpa} reported.`)
    else add('gpa', 'not_met', `Nursing GPA at least ${rules.gpa_min.toFixed(2)}`, `GPA ${f.gpa} is below the minimum.`)
  } else {
    add('gpa', 'unknown', `Nursing GPA at least ${rules.gpa_min.toFixed(2)}`, 'GPA not provided yet.')
  }

  // completion_window — program completed within N months before the
  // application date (exactly N months ago still passes).
  if (!asOf) {
    add('completion_window', 'unknown', `Program completed within ${rules.completion_window_months} months`,
      'The residency cohort has no application date configured yet (set it in Planning).')
  } else if (isDateStr(f.completion_date)) {
    const windowStart = addMonths(asOf, -rules.completion_window_months)
    if (f.completion_date >= windowStart) {
      add('completion_window', 'met', `Program completed within ${rules.completion_window_months} months`,
        `Completed ${f.completion_date}.`)
    } else {
      add('completion_window', 'not_met', `Program completed within ${rules.completion_window_months} months`,
        `Completed ${f.completion_date}, more than ${rules.completion_window_months} months before ${asOf}.`)
    }
  } else {
    add('completion_window', 'unknown', `Program completed within ${rules.completion_window_months} months`,
      'Completion date not provided yet.')
  }

  // bls — active, from a reported issuer, not expired before the as-of date.
  const blsDeadline = rules.conditional.bls.deadline || asOf
  if (f.bls_status === 'active' && (!isDateStr(f.bls_expiration) || !blsDeadline || f.bls_expiration >= blsDeadline)) {
    add('bls', 'met', 'Active BLS from an accepted issuer', `BLS active${f.bls_issuer ? ` (${f.bls_issuer})` : ''}.`)
  } else if (f.bls_status === undefined || f.bls_status === null) {
    add('bls', 'unknown', 'Active BLS from an accepted issuer', 'BLS status not provided yet.')
  } else if (rules.conditional.bls.enabled && rules.conditional.bls.deadline) {
    add('bls', 'conditional', 'Active BLS from an accepted issuer',
      'BLS must be active by the configured deadline.', rules.conditional.bls.deadline)
  } else {
    add('bls', 'not_met', 'Active BLS from an accepted issuer', 'BLS is not active (or expires before the application date).')
  }

  // acls — applies only when the submission reports an ACLS-requiring
  // preference; otherwise it is satisfied as not-applicable.
  if (f.acls_required !== true) {
    add('acls', 'met', 'ACLS when a preferred unit requires it', 'Not applicable to the selected preferences.')
  } else if (f.acls_status === 'active') {
    add('acls', 'met', 'ACLS when a preferred unit requires it', `ACLS active${f.acls_issuer ? ` (${f.acls_issuer})` : ''}.`)
  } else if (f.acls_status === undefined || f.acls_status === null) {
    add('acls', 'unknown', 'ACLS when a preferred unit requires it', 'ACLS status not provided yet.')
  } else if (rules.conditional.acls.enabled && rules.conditional.acls.deadline) {
    add('acls', 'conditional', 'ACLS when a preferred unit requires it',
      'ACLS must be active by the configured deadline.', rules.conditional.acls.deadline)
  } else {
    add('acls', 'not_met', 'ACLS when a preferred unit requires it', 'ACLS is required by a preferred unit and is not active.')
  }

  // accreditation — only when the rule is enabled.
  if (!rules.require_accreditation) {
    add('accreditation', 'met', 'Accredited US nursing program', 'Not required for this cohort.')
  } else if (f.us_accredited === true) {
    add('accreditation', 'met', 'Accredited US nursing program', 'Confirmed by the applicant.')
  } else if (f.us_accredited === undefined || f.us_accredited === null) {
    add('accreditation', 'unknown', 'Accredited US nursing program', 'Accreditation confirmation not provided yet.')
  } else {
    add('accreditation', 'not_met', 'Accredited US nursing program', 'The program does not meet the accreditation requirement.')
  }

  let result = 'eligible'
  if (rows.some(r => r.status === 'not_met')) result = 'not_eligible'
  else if (rows.some(r => r.status === 'unknown')) result = 'pending'
  else if (rows.some(r => r.status === 'conditional')) result = 'conditionally_eligible'

  // The stored summary (ngrp_candidates.eligibility_reasons): user-readable,
  // deadline-carrying, never a score.
  const reasons = rows.map(r => ({
    code: r.code, label: r.label, met: r.status === 'met',
    status: r.status, detail: r.detail, deadline: r.deadline || undefined,
  }))
  return { result, requirements: rows, reasons }
}

// Flatten a submitted Transition Form revision payload into engine facts.
// Tolerates missing sections (each absent answer becomes 'unknown').
export function extractEligibilityFacts(payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const lic = p.licensure || {}
  const edu = p.education || {}
  const num = v => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
    return isFiniteNum(n) ? n : undefined
  }
  return {
    ca_rn_status: lic.ca_rn_status ?? undefined,
    nclex_scheduled_date: isDateStr(lic.nclex_scheduled_date) ? lic.nclex_scheduled_date : undefined,
    paid_rn_months: num(lic.paid_rn_months),
    bls_status: lic.bls_status ?? undefined,
    bls_issuer: lic.bls_issuer ?? undefined,
    bls_expiration: isDateStr(lic.bls_expiration) ? lic.bls_expiration : undefined,
    acls_required: lic.acls_required === true,
    acls_status: lic.acls_status ?? undefined,
    acls_issuer: lic.acls_issuer ?? undefined,
    gpa: num(edu.gpa),
    completion_date: isDateStr(edu.completion_date) ? edu.completion_date : undefined,
    us_accredited: edu.us_accredited ?? undefined,
  }
}

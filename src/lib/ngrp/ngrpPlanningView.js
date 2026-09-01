// NGRP-PLANNING-2: the pure derivations behind the Planning tab.
//
// Planning stopped being a settings form when cohort configuration moved to the
// header's Edit Cohort (see components/ngrp/CohortSettingsModal.jsx). What it
// answers now is operational: where is this cohort in its own calendar, can it
// send forms yet, and does the demand it is generating fit the seats it has.
//
// Everything here is pure and date-string based. Cohort dates are date-only
// 'YYYY-MM-DD' values, so they are compared as STRINGS against today's local
// date string - no Date parsing, and therefore no timezone day-shift.

// The cycle's milestones in calendar order. `end` is set only for the interview
// window, which is a span rather than a moment.
export const MILESTONE_DEFS = [
  { key: 'application_open_date',  label: 'Applications open' },
  { key: 'application_deadline',   label: 'Applications close' },
  { key: 'licensure_deadline',     label: 'Licensure deadline' },
  { key: 'interview_window_start', label: 'Interviews', endKey: 'interview_window_end' },
  { key: 'residency_start_date',   label: 'Residency starts' },
]

const dayStr = d => (typeof d === 'string' ? d.split('T')[0] : '')

export function daysBetweenDateStrings(fromStr, toStr) {
  if (!fromStr || !toStr) return null
  const a = new Date(`${fromStr}T00:00:00`)
  const b = new Date(`${toStr}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/**
 * The cohort's milestones, each classified against today.
 *
 * state: 'past' | 'today' | 'future' for the milestone's own date. A milestone
 * with a span is 'today' for every day INSIDE the span, so an open interview
 * window reads as happening now rather than as already past.
 * `isNext` marks the single soonest milestone that has not happened yet - the
 * one thing the tab is telling you to get ready for.
 * Unset dates are returned too (state 'unset'), because a missing residency
 * start is information, not an absence.
 */
export function cycleTimeline(cycle, todayStr) {
  const items = MILESTONE_DEFS.map(def => {
    const start = dayStr(cycle?.[def.key])
    const end = def.endKey ? dayStr(cycle?.[def.endKey]) : ''
    if (!start) return { key: def.key, label: def.label, state: 'unset', start: '', end: '', daysAway: null }
    const closesOn = end || start
    let state
    if (todayStr < start) state = 'future'
    else if (todayStr > closesOn) state = 'past'
    else state = 'today'
    return {
      key: def.key,
      label: def.label,
      start,
      end,
      state,
      daysAway: daysBetweenDateStrings(todayStr, start),
    }
  })
  const nextIdx = items.findIndex(i => i.state === 'future')
  return items.map((i, idx) => ({ ...i, isNext: idx === nextIdx }))
}

// Human phrasing for a milestone's distance from today. Null for unset dates.
export function milestoneWhen(item) {
  if (item.state === 'unset') return null
  if (item.state === 'today') return item.end && item.end !== item.start ? 'Open now' : 'Today'
  const d = item.daysAway
  if (d == null) return null
  if (d > 0) return d === 1 ? 'Tomorrow' : `In ${d} days`
  return d === -1 ? 'Yesterday' : `${Math.abs(d)} days ago`
}

/**
 * Seats. Only ACTIVE units are offered by the Transition Form, so only active
 * units count toward capacity; an inactive unit with a capacity is not a seat.
 * `unpriced` is the count of active units with no capacity set - the reason a
 * seat total can be an understatement, said out loud rather than hidden.
 */
export function capacitySummary(units) {
  const active = (units || []).filter(u => u.is_active)
  const seats = active.reduce((sum, u) => sum + (Number(u.capacity) > 0 ? Number(u.capacity) : 0), 0)
  return {
    activeCount: active.length,
    inactiveCount: (units || []).length - active.length,
    seats,
    unpriced: active.filter(u => !(Number(u.capacity) > 0)).length,
    exact: active.length > 0 && active.every(u => Number(u.capacity) > 0),
  }
}

/**
 * The cohort's funnel, in the order the pipeline actually runs. Counts come
 * from the SAME derived applicant rows the Applicants roster renders, so the
 * two surfaces can never disagree; this module only groups them.
 */
export function pipelineStages(rows, { effectiveEligibility }) {
  const list = rows || []
  const submitted = list.filter(r => r.form_status === 'submitted' || r.form_status === 'revised')
  return [
    { key: 'alumni',    label: 'Completed alumni',      count: list.length,
      hint: 'Prospective candidates in scope' },
    { key: 'sent',      label: 'Transition Form sent',  count: list.filter(r => r.form_status !== 'not_sent').length,
      hint: 'Reached, at any stage' },
    { key: 'submitted', label: 'Form submitted',        count: submitted.length,
      hint: 'Includes revisions' },
    { key: 'eligible',  label: 'Eligible',              count: list.filter(r => effectiveEligibility(r) === 'eligible').length,
      hint: 'Effective result' },
    { key: 'cond',      label: 'Conditionally eligible', count: list.filter(r => effectiveEligibility(r) === 'conditionally_eligible').length,
      hint: 'Requirement pending' },
    { key: 'confirmed', label: 'Application confirmed', count: list.filter(r => r.application_status === 'confirmed').length,
      hint: 'Official NGRP list' },
  ]
}

/**
 * Seats against the applicants who have actually reached the official list.
 * Returns null when there is nothing honest to say - no seats configured, or
 * capacity is only partially entered, in which case a ratio would be a lie.
 */
export function seatPressure(capacity, confirmedCount) {
  if (!capacity?.exact || capacity.seats <= 0) return null
  return {
    seats: capacity.seats,
    confirmed: confirmedCount,
    remaining: capacity.seats - confirmedCount,
    over: confirmedCount > capacity.seats,
    pct: Math.min(100, Math.round((confirmedCount / capacity.seats) * 100)),
  }
}

// One-line summaries of the rule set, for the read-only configuration card.
// A GPA is written with a decimal place even when it is a round number: "3.0"
// is how the rule is stated everywhere else, and "3" reads like a typo.
const fmtGpa = n => (Number.isFinite(Number(n)) && !String(n).includes('.') ? Number(n).toFixed(1) : String(n))

export function ruleSummaryLines(rules) {
  if (!rules) return []
  const lines = [
    `Minimum nursing GPA ${fmtGpa(rules.gpa_min)}`,
    `Paid RN experience under ${rules.max_paid_rn_months} months`,
    `Program completed within ${rules.completion_window_months} months`,
  ]
  lines.push(rules.nclex_exception_enabled
    ? 'NCLEX exception on (a scheduled NCLEX yields Conditionally Eligible)'
    : 'NCLEX exception off')
  if (rules.require_accreditation) lines.push('External applicants must confirm an accredited US program')
  return lines
}

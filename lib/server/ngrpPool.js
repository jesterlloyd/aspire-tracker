// lib/server/ngrpPool.js
//
// RESIDENCY-ROSTER-1: who is in the Applicant Pool, why they are not, and the
// one Status a roster row shows. Owner decisions, 2026-09-12.
//
// AUTO-CONFIRM. Confirmation used to be a human step: a staff member pressed
// "Confirm Application" and only then did the alumnus reach the placement
// board. The Owner replaced that with option C, "keep confirmation but make it
// automatic": anyone who submitted the Transition Form, is eligible OR
// conditionally eligible, and said they are interested is in the pool. Nobody
// presses anything. The people who stay out are the ones who said they are not
// interested, the ones who never answered (no submitted form is no answer, and
// the deadline reminder is a cron, not a state), and anyone the ASPIRE team has
// recorded as Not Proceeding.
//
// PAIRING IS NOT A HIRE (Owner, in as many words). Matching an applicant to a
// unit on the placement board means that unit will INTERVIEW them. The hire is
// recorded separately, when Talent Acquisition confirms the person accepted and
// started. Everything in this module keeps those two apart, the same way
// ngrpPlacement.js keeps a ranked preference apart from an assignment.
//
// "NOT PROCEEDING" replaced "Reject" (Owner). It is the word ASPIRE already
// uses for a student who is no longer moving through the pathway
// (src/lib/constants.js), it states a fact without blaming anyone, and it reads
// correctly whether the alumnus withdrew, missed the deadline, or the team
// decided not to advance them. The reason says which. The submitted form and
// the eligibility result stay on record either way: removal from the pool is
// not erasure.
//
// Pure and db-free, so the same rule runs in the browser (roster, board, At a
// Glance) and on the server (every write that must not trust the browser).
//
// THIS MODULE IS THE LOWER LAYER and imports nothing from the NGRP vocabulary.
// effectiveEligibility lives here rather than in src/lib/ngrp/ngrpStates.js
// because the pool rule needs it and ngrpStates needs the pool rule (its KPI
// cards and its default sort are both "who is in the pool"), which would be an
// import cycle the other way round. ngrpStates re-exports it, so every existing
// call site is unchanged.

// The staff override, when present, is the effective result; the calculated
// result is always retained and shown beside it in the drawer.
export function effectiveEligibility(row) {
  return row?.eligibility_effective || row?.eligibility_calculated || 'pending'
}

// Both eligible results reach the pool. A conditional result means a
// requirement is still outstanding (usually NCLEX), not that the person is
// unqualified, and the Owner was explicit that they belong in the pool.
export const POOL_ELIGIBILITY = Object.freeze(['eligible', 'conditionally_eligible'])

export const SUBMITTED_FORM_STATUSES = Object.freeze(['submitted', 'revised'])

// Why someone left the pool. Drawn from the vocabulary the app already uses for
// ASPIRE dispositions (src/lib/dispositions.js) so the two lists read as one
// program rather than two. 'other' is the only one that requires a note.
export const NOT_PROCEEDING_REASONS = Object.freeze({
  withdrew:                { label: 'Withdrew',                  hint: 'They told us they are stepping back' },
  not_interested:          { label: 'Not Interested',            hint: 'They are not applying to the residency' },
  no_longer_eligible:      { label: 'No Longer Eligible',        hint: 'A requirement can no longer be met' },
  no_response_by_deadline: { label: 'No Response by Deadline',   hint: 'The form was never completed in time' },
  position_elsewhere:      { label: 'Took a Position Elsewhere', hint: 'Hired outside this residency' },
  other:                   { label: 'Other',                     hint: 'Say what happened in the note' },
})
export const NOT_PROCEEDING_REASON_KEYS = Object.freeze(Object.keys(NOT_PROCEEDING_REASONS))
export const REASON_REQUIRING_NOTE = 'other'

// ── The one Status a roster row shows ────────────────────────────────────────
// Left to right, this is the arc: not in the pool, in the pool, paired with the
// unit that will interview them, then whatever came of that interview. The
// Owner asked for these five results by name (Awaiting Decision, Offered,
// Hired, Not Selected, Declined Offer); the two resting states before them are
// what makes the column readable for everyone else on the roster.
export const ROSTER_STATUSES = Object.freeze({
  not_in_pool:       { label: 'Not in Pool',       family: 'mute', icon: 'dash' },
  in_pool:           { label: 'In Pool',           family: 'info', icon: 'info' },
  awaiting_decision: { label: 'Awaiting Decision', family: 'wait', icon: 'clock' },
  offered:           { label: 'Offered',           family: 'info', icon: 'info' },
  hired:             { label: 'Hired',             family: 'ok',   icon: 'check' },
  not_selected:      { label: 'Not Selected',      family: 'mute', icon: 'dash' },
  declined_offer:    { label: 'Declined Offer',    family: 'mute', icon: 'dash' },
  not_proceeding:    { label: 'Not Proceeding',    family: 'mute', icon: 'dash' },
})

// The order At a Glance counts them in. 'not_in_pool' is deliberately absent:
// the snapshot's Applicants number already says how many submitted, and a band
// counting everyone who did not apply would drown the seven that matter.
export const ROSTER_STATUS_BAND = Object.freeze([
  'in_pool', 'awaiting_decision', 'offered', 'hired', 'not_selected', 'declined_offer', 'not_proceeding',
])

export const NOT_PROCEEDING = 'not_proceeding'

export function hasSubmittedForm(row) {
  return SUBMITTED_FORM_STATUSES.includes(row?.form_status)
}

/**
 * Pool membership, with the reasons. The reasons are what the drawer shows when
 * someone asks why an alumnus is not on the board, so they are written as
 * statements about the record rather than as errors.
 */
export function poolDecision(row) {
  const reasons = []
  if (!row) return { inPool: false, reasons: ['There is no record for this alumnus in this cohort.'] }
  // A recorded removal is the answer on its own; the rest would only repeat it.
  if (row.application_status === NOT_PROCEEDING || row.application_status === 'withdrawn') {
    const reason = NOT_PROCEEDING_REASONS[row.not_proceeding_reason]?.label
    return { inPool: false, reasons: [reason ? `Recorded as Not Proceeding (${reason}).` : 'Recorded as Not Proceeding.'] }
  }
  if (!hasSubmittedForm(row)) reasons.push('The Transition Form has not been submitted.')
  if (row.interest !== 'interested') reasons.push('They have not said they are interested in applying.')
  const elig = effectiveEligibility(row)
  if (!POOL_ELIGIBILITY.includes(elig)) {
    reasons.push(elig === 'not_eligible'
      ? 'The eligibility result is Not Eligible.'
      : 'Eligibility has not been calculated yet.')
  }
  return { inPool: reasons.length === 0, reasons }
}

export function isInApplicantPool(row) {
  return poolDecision(row).inPool
}

/**
 * The one Status. A recorded HIRE is checked first and outranks everything,
 * including a removal: it is durable employment history, and no later workflow
 * state may hide it. After that a removal outranks the workflow, because
 * someone who is not proceeding is not waiting for anything.
 *
 * 'awaiting_decision' is what a pairing means. The unit will interview them and
 * the result is not known yet; it is NOT an offer, and it is NOT a hire.
 */
export function rosterStatus(row) {
  const o = row?.outcome || {}
  if (o.hired_at) return 'hired'
  if (row?.application_status === NOT_PROCEEDING || row?.application_status === 'withdrawn') return NOT_PROCEEDING
  if (o.offer_declined_at) return 'declined_offer'
  if (o.not_selected_at) return 'not_selected'
  if (o.offer_extended_at) return 'offered'
  if (!isInApplicantPool(row)) return 'not_in_pool'
  return row.assigned_unit ? 'awaiting_decision' : 'in_pool'
}

export function rosterStatusLabel(row) {
  return ROSTER_STATUSES[rosterStatus(row)]?.label || 'Not in Pool'
}

// Counts per Status, in band order, over whatever rows the caller passes.
export function statusCounts(rows) {
  const tally = Object.fromEntries(ROSTER_STATUS_BAND.map(k => [k, 0]))
  for (const r of rows || []) {
    const k = rosterStatus(r)
    if (k in tally) tally[k] += 1
  }
  return ROSTER_STATUS_BAND.map(key => ({ key, label: ROSTER_STATUSES[key].label, count: tally[key] }))
}

// ── Ranked unit choices ──────────────────────────────────────────────────────
//
// The alumnus's own ranking arrives with the submitted form and lives in the
// revision payload, which is immutable. The Owner asked staff to be able to
// change the choices, so a staff ranking is stored BESIDE the submitted one
// (ngrp_candidates.staff_unit_preferences) and becomes the effective one. The
// submitted answer is never overwritten, exactly as an eligibility override
// never overwrites the calculated result.
const clean = v => (typeof v === 'string' ? v.trim() : '')

// Compacted and de-duplicated in rank order, blanks dropped rather than
// rendered as empty slots. The de-duplication is CASE-INSENSITIVE: an alumnus
// who typed "5 SCCT" and "5 scct" ranked one unit, not two, and the board would
// otherwise show them a phantom second choice.
export function formPreferences(row) {
  return normalizePreferences([row?.unit_preference_1, row?.unit_preference_2, row?.unit_preference_3])
}

export function effectivePreferences(row) {
  const staff = Array.isArray(row?.staff_unit_preferences) ? normalizePreferences(row.staff_unit_preferences) : []
  if (staff.length) return { preferences: staff, source: 'staff' }
  return { preferences: formPreferences(row), source: 'form' }
}

export function preferencesOf(row) {
  return effectivePreferences(row).preferences
}

// Normalize a staff ranking for storage: trimmed, blanks dropped, duplicates
// dropped case-insensitively, at most three. An empty result means "clear the
// override and go back to what they asked for", which is a legitimate save.
export function normalizePreferences(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []
  for (const raw of input) {
    const name = clean(raw)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
    if (out.length === 3) break
  }
  return out
}

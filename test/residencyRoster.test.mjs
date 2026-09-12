// RESIDENCY-ROSTER-1: the Alumni Roster revamp. Owner decisions, 2026-09-12.
//
//   - Confirmation is automatic (option C): submitted + eligible or
//     conditionally eligible + interested lands in the Applicant Pool.
//   - "Reject" is called Not Proceeding, with a reason, and never erases the
//     submitted form or the eligibility result.
//   - Pairing means the unit will INTERVIEW them. It is not a hire.
//   - One trimmed six-column table in BOTH surfaces.
//
// Run: node --test test/residencyRoster.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  poolDecision, isInApplicantPool, rosterStatus, statusCounts,
  effectivePreferences, preferencesOf, normalizePreferences,
  NOT_PROCEEDING_REASON_KEYS, ROSTER_STATUS_BAND, effectiveEligibility,
} from '../lib/server/ngrpPool.js'
import { placeableRows, placementSummary } from '../src/lib/ngrp/ngrpPlacement.js'
import { validateNotProceedingPayload, validateUnitPreferencesPayload, validateOutcomePayload } from '../lib/server/ngrpPlanning.js'
import { buildResidencyCsv } from '../lib/server/ngrpResidencyExport.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const code = src => src.split('\n').filter(l => !/^\s*(--|\/\/)/.test(l)).join('\n')

// A submitted, interested, eligible alumnus: the ordinary case.
const ready = (o = {}) => ({
  id: 'a1', form_status: 'submitted', interest: 'interested',
  eligibility_calculated: 'eligible', application_status: 'not_confirmed',
  assigned_unit: null, unit_preference_1: '5 SCCT', unit_preference_2: '6 South', ...o,
})

test('auto-confirm: who lands in the Applicant Pool, and who does not', () => {
  assert.equal(isInApplicantPool(ready()), true, 'submitted + interested + eligible')
  assert.equal(isInApplicantPool(ready({ eligibility_calculated: 'conditionally_eligible' })), true,
    'the Owner put conditional in the pool too')
  assert.equal(isInApplicantPool(ready({ form_status: 'revised' })), true, 'a revision is still a submission')
  // Nobody has to press anything: nothing reads application_status to get in.
  assert.equal(isInApplicantPool(ready({ application_status: 'confirmed' })), true)

  // The three ways to stay out, each with its own reason.
  assert.deepEqual(poolDecision(ready({ form_status: 'sent' })).reasons, ['The Transition Form has not been submitted.'])
  assert.deepEqual(poolDecision(ready({ interest: 'not_interested' })).reasons, ['They have not said they are interested in applying.'])
  assert.deepEqual(poolDecision(ready({ interest: 'no_response' })).reasons, ['They have not said they are interested in applying.'])
  assert.deepEqual(poolDecision(ready({ eligibility_calculated: 'not_eligible' })).reasons, ['The eligibility result is Not Eligible.'])
  assert.deepEqual(poolDecision(ready({ eligibility_calculated: 'pending' })).reasons, ['Eligibility has not been calculated yet.'])
  // A staff override is the effective result, so it decides the pool too.
  assert.equal(isInApplicantPool(ready({ eligibility_calculated: 'not_eligible', eligibility_effective: 'eligible' })), true)
  assert.equal(effectiveEligibility({ eligibility_calculated: 'pending', eligibility_effective: 'eligible' }), 'eligible')
})

test('Not Proceeding removes them from the pool and erases nothing', () => {
  const removed = ready({ application_status: 'not_proceeding', not_proceeding_reason: 'not_interested' })
  assert.equal(isInApplicantPool(removed), false)
  assert.deepEqual(poolDecision(removed).reasons, ['Recorded as Not Proceeding (Not Interested).'])
  // The record they arrived with is untouched: the removal is a state, not a delete.
  assert.equal(removed.form_status, 'submitted')
  assert.equal(effectiveEligibility(removed), 'eligible')
  // The legacy value behaves identically until the migration rewrites it.
  assert.equal(isInApplicantPool(ready({ application_status: 'withdrawn' })), false)
  assert.equal(rosterStatus(ready({ application_status: 'withdrawn' })), 'not_proceeding')
})

test('Status: the arc from not in the pool to a result, and a hire outranks everything', () => {
  assert.equal(rosterStatus(ready({ form_status: 'not_sent' })), 'not_in_pool')
  assert.equal(rosterStatus(ready()), 'in_pool')
  // PAIRING IS NOT A HIRE: matched to a unit means that unit will interview them.
  assert.equal(rosterStatus(ready({ assigned_unit: '5 SCCT' })), 'awaiting_decision')
  assert.equal(rosterStatus(ready({ assigned_unit: '5 SCCT', outcome: { offer_extended_at: '2027-01-02' } })), 'offered')
  assert.equal(rosterStatus(ready({ outcome: { offer_extended_at: '2027-01-02', offer_declined_at: '2027-01-09' } })), 'declined_offer')
  assert.equal(rosterStatus(ready({ outcome: { not_selected_at: '2027-01-09' } })), 'not_selected')
  assert.equal(rosterStatus(ready({ outcome: { hired_at: '2027-01-20' } })), 'hired')
  // Durable employment history is never masked by a later workflow state.
  assert.equal(rosterStatus(ready({ application_status: 'not_proceeding', not_proceeding_reason: 'withdrew', outcome: { hired_at: '2027-01-20' } })), 'hired')

  const band = statusCounts([ready(), ready({ assigned_unit: '5 SCCT' }), ready({ outcome: { hired_at: 'x' } }), ready({ form_status: 'not_sent' })])
  assert.deepEqual(band.map(s => s.key), ROSTER_STATUS_BAND)
  assert.deepEqual(band.filter(s => s.count > 0).map(s => [s.key, s.count]),
    [['in_pool', 1], ['awaiting_decision', 1], ['hired', 1]])
  assert.ok(!band.some(s => s.key === 'not_in_pool'), 'the band does not count people who never applied')
})

test('the placement board is the pool, and its summary says so', () => {
  const rows = [ready(), ready({ id: 'a2', assigned_unit: '5 SCCT' }), ready({ id: 'a3', interest: 'not_interested' })]
  assert.deepEqual(placeableRows(rows).map(r => r.id), ['a1', 'a2'])
  const s = placementSummary([{ unit_name: '5 SCCT', is_active: true, capacity: 2 }], rows)
  assert.equal(s.inPool, 2)
  assert.equal(s.placed, 1)
  assert.equal(s.unplaced, 1)
  assert.equal(s.confirmed, undefined, 'the retired name is gone, not aliased')
})

test('staff can change the ranked choices, and the alumnus keeps their own answer', () => {
  const row = ready({ staff_unit_preferences: ['7 North', '5 SCCT'] })
  assert.deepEqual(effectivePreferences(row), { preferences: ['7 North', '5 SCCT'], source: 'staff' })
  assert.deepEqual(preferencesOf(ready()), ['5 SCCT', '6 South'])
  assert.equal(effectivePreferences(ready()).source, 'form')
  // The submitted ranking is still there underneath, unchanged.
  assert.equal(row.unit_preference_1, '5 SCCT')
  // An empty staff list is not a staff ranking: their own answer comes back.
  assert.equal(effectivePreferences(ready({ staff_unit_preferences: [] })).source, 'form')
  assert.deepEqual(normalizePreferences([' 7 North ', '7 north', '', null, '5 SCCT', '6 South', '4 West']),
    ['7 North', '5 SCCT', '6 South'], 'trimmed, de-duplicated case-insensitively, capped at three')
})

test('the validators refuse what the database would refuse', () => {
  assert.deepEqual(validateNotProceedingPayload({ reason: 'nope' }).errors,
    [{ field: 'reason', message: 'Choose why this alumnus is not proceeding.' }])
  assert.deepEqual(validateNotProceedingPayload({ reason: 'other' }).errors,
    [{ field: 'note', message: 'Say what happened, since the reason is Other.' }])
  assert.deepEqual(validateNotProceedingPayload({ reason: 'withdrew', note: '  ' }), { ok: true, reason: 'withdrew', note: null })
  assert.deepEqual(NOT_PROCEEDING_REASON_KEYS,
    ['withdrew', 'not_interested', 'no_longer_eligible', 'no_response_by_deadline', 'position_elsewhere', 'other'])

  assert.deepEqual(validateUnitPreferencesPayload({ preferences: ['A', 'A', 'B', 'C', 'D'] }), { ok: true, preferences: ['A', 'B', 'C'] })
  assert.deepEqual(validateUnitPreferencesPayload({ preferences: [] }), { ok: true, preferences: [] })
  assert.equal(validateUnitPreferencesPayload({ preferences: 'A' }).ok, false)

  // One final result per attempt.
  const base = { offer_extended_at: '2027-01-02T00:00:00Z' }
  assert.equal(validateOutcomePayload({ ...base, not_selected_at: '2027-01-09T00:00:00Z' }).ok, true)
  assert.equal(validateOutcomePayload({ ...base, offer_declined_at: '2027-01-09T00:00:00Z' }).ok, true)
  assert.equal(validateOutcomePayload({ offer_declined_at: '2027-01-09T00:00:00Z' }).errors[0].field, 'offer_declined_at')
  const both = validateOutcomePayload({
    ...base, offer_accepted_at: '2027-01-05T00:00:00Z', hired_at: '2027-01-20T00:00:00Z',
    hired_unit: '5 SCCT', not_selected_at: '2027-01-09T00:00:00Z',
  })
  assert.equal(both.ok, false)
  assert.ok(both.errors.some(e => /cannot be both Hired and Not Selected/.test(e.message)))
})

test('DEFECT: assign_unit, interview_set and outcome_set were unreachable', () => {
  // They have handler blocks but were never in the ACTIONS allowlist, so since
  // 6035a370 every assignment and every interview or hire save answered 400
  // invalid_action before reaching its block. An action must be in BOTH places.
  const api = read('api/ngrp-manage.js')
  const allowlist = api.slice(api.indexOf('const ACTIONS = new Set('), api.indexOf('const ELIGIBILITY_VOCAB'))
  const handled = [...api.matchAll(/action === '([a-z_]+)'/g)].map(m => m[1])
  for (const a of ['assign_unit', 'interview_set', 'outcome_set', 'not_proceeding_set', 'application_reinstate', 'unit_preferences_set']) {
    assert.ok(handled.includes(a), `${a} has a handler block`)
    assert.ok(allowlist.includes(`'${a}'`), `${a} is in the ACTIONS allowlist`)
  }
})

test('the server asks the pool rule instead of reading a confirmed status', () => {
  const api = read('api/ngrp-manage.js')
  assert.doesNotMatch(api, /candidate\.application_status !== 'confirmed'/, 'the confirmed-only guards are gone')
  // Pairing is refused for anyone the rule does not admit, and the refusal says why.
  assert.match(api, /if \(unit\) \{[\s\S]{0,400}poolDecision\(composed\.row\)/)
  assert.match(api, /not in the Applicant Pool, so they cannot be paired with a unit/)
  // An outcome that already exists stays correctable.
  assert.match(api, /if \(!existing\.data\) \{[\s\S]{0,400}poolDecision\(composed\.row\)/)
  // The form's lifecycle is composed server-side; a pending send is not a form.
  assert.match(api, /async function poolRowFor[\s\S]{0,400}status === 'pending'\) \? 'not_sent'/)
  for (const ev of ['not_proceeding_recorded', 'application_reinstated', 'unit_preferences_set', 'offer_declined', 'not_selected']) {
    assert.match(api, new RegExp(`eventType: '${ev}'|\\['${ev.replace(/_at$/, '')}`), ev)
  }
})

test('ONE trimmed table, rendered by ONE component, in both surfaces', () => {
  const roster = read('src/components/ngrp/ProfilesTab.jsx')
  const headers = [...roster.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map(m => m[1])
  assert.deepEqual(headers, ['Alumnus', 'Form', 'Interest', 'Eligibility', 'Top Choices', 'Status'])
  // Matched as RENDERED HEADERS, not as bare words: the comment above the table
  // names the retired columns to say why they went, and a looser regex would
  // match that prose and pass or fail for the wrong reason.
  for (const gone of ['Assigned Unit', 'Interview', 'Last Updated', 'Transition Form', 'Application']) {
    assert.ok(!new RegExp(`<th[^>]*>${gone}</th>`).test(roster), `${gone} is gone from the roster`)
  }
  // The portal and the staff app render the SAME component, which is what makes
  // the two tables identical rather than merely similar.
  assert.match(read('src/components/ngrp/NgrpWorkspace.jsx'), /<ProfilesTab/)
  // Informational: the actions live in the drawer, not on the row.
  assert.match(roster, /setNotProceeding: \(r, fields\)/)
  assert.match(roster, /setPreferences: \(r, preferences\)/)
  assert.ok(!roster.includes('confirmApplication'), 'nothing confirms an application any more')
})

test('the drawer owns the actions, and Confirm Application is retired', () => {
  const drawer = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(drawer, /<Section\s+title="Applicant Pool"/)
  assert.match(drawer, /title="Unit Choices"/)
  // The BUTTON is gone; the comment explaining why it went is not the button.
  assert.doesNotMatch(drawer, /<button[^>]*>\s*\n?\s*Confirm Application/, 'confirmation is automatic, so the button would be theatre')
  assert.ok(!drawer.includes('confirmApplication'), 'and nothing calls the action any more')
  // Both labels sit inside a busy/idle ternary, so they are quoted strings in
  // the source rather than raw JSX text.
  assert.ok(drawer.includes("'Record Not Proceeding'"))
  assert.ok(drawer.includes("'Put back in consideration'"))
  assert.match(drawer, /Clearing every box restores the ranking the alumnus submitted/)
  // The four results a pairing can lead to.
  for (const label of ['Offer extended', 'Offer accepted', 'Hired', 'Not selected', 'Declined the offer']) {
    assert.ok(drawer.includes(`'${label}'`), label)
  }
  assert.match(drawer, /const inPlay = isInApplicantPool\(row\) \|\| Boolean\(row\.outcome\)/)
})

test('At a Glance shows the same states, counted', () => {
  const glance = read('src/components/ngrp/AtAGlanceTab.jsx')
  assert.match(glance, /className="ngrp-statusband" aria-label="Applicants by status"/)
  assert.match(glance, /const band = useMemo\(\(\) => statusCounts\(rows\), \[rows\]\)/)
  assert.match(glance, /<KPICell value=\{snap\.inPool\} label="In the Pool"/)
  assert.match(glance, /<KPICell value=\{snap\.paired\} label="Paired" sub="A unit will interview them"/)
  assert.ok(!glance.includes('label="Confirmed"'), 'nothing is confirmed by hand any more')
  assert.match(glance, /rosterStatus\(row\)/, 'the roster Status, not a second vocabulary')
})

test('the CSV says what the screen says', () => {
  const { csv } = buildResidencyCsv({
    cycle: { name: 'January 2027', application_checklist: [] },
    students: [{ id: 's1', first_name: 'Maya', last_name: 'Lin', school: 'CSUN' }],
    candidates: [{ student_id: 's1', ...ready({ assigned_unit: '5 SCCT', staff_unit_preferences: ['7 North'] }) }],
  })
  const [header, row] = csv.split('\n')
  assert.ok(header.includes('Status'), 'the roster Status column')
  assert.ok(header.includes('Choice 1') && header.includes('Choice 3'))
  assert.ok(header.includes('Paired Unit (Interviewing)'))
  assert.ok(!header.includes(',Application,'), 'the retired Application column is gone')
  assert.ok(row.includes('Awaiting Decision'), row)
  assert.ok(row.includes('7 North') && row.includes('ASPIRE team'), 'the choices in force, and who set them')
})

test('the migration is additive, transactional, and rewrites exactly one thing', () => {
  const sql = code(read('supabase/migrations/20260916000000_ngrp_not_proceeding_choices_outcome.sql'))
  assert.match(sql, /^BEGIN;$/m)
  assert.match(sql, /^COMMIT;$/m)
  // Every column is added, never replaced.
  for (const col of ['not_proceeding_reason', 'not_proceeding_note', 'not_proceeding_at',
    'not_proceeding_by_profile_id', 'staff_unit_preferences', 'unit_preferences_set_by_profile_id',
    'unit_preferences_set_at', 'not_selected_at', 'offer_declined_at']) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`), col)
  }
  assert.doesNotMatch(sql, /DROP COLUMN|DROP TABLE|DELETE FROM|TRUNCATE/)
  // Exactly one UPDATE, and it is the withdrawn rewrite, keeping the original moment.
  const updates = sql.match(/^UPDATE /gm) || []
  assert.equal(updates.length, 1)
  assert.match(sql, /SET application_status = 'not_proceeding',\s+not_proceeding_reason = 'withdrew',\s+not_proceeding_at = application_withdrawn_at\s+WHERE application_status = 'withdrawn'/)
  // 'withdrawn' stays legal so nothing older can fail.
  assert.match(sql, /CHECK \(application_status IN \('not_confirmed','confirmed','withdrawn','not_proceeding'\)\)/)
  // The audit widening CARRIES every earlier value (20260906000000 once dropped four by re-creating an older list).
  const audit = sql.slice(sql.indexOf('ngrp_audit_events_event_type_check'))
  for (const ev of ['hire_recorded', 'offer_accepted', 'interview_recorded', 'unit_assigned',
    'not_proceeding_recorded', 'application_reinstated', 'unit_preferences_set', 'offer_declined', 'not_selected']) {
    assert.ok(audit.includes(`'${ev}'`), ev)
  }
})

test('the roster degrades honestly while the migration is unapplied', () => {
  const src = read('lib/server/ngrpApplicants.js')
  assert.match(src, /const ROSTER_FIELDS =\s*\n\s*'not_proceeding_reason/)
  // Widest first, then one group at a time: each fallback is a real deploy state.
  assert.match(src, /const full = await read\(`\$\{CANDIDATE_FIELDS\}, \$\{PLACEMENT_FIELDS\}, \$\{ROSTER_FIELDS\}`\)/)
  assert.match(src, /const placement = await read\(`\$\{CANDIDATE_FIELDS\}, \$\{PLACEMENT_FIELDS\}`\)/)
  assert.match(src, /const full = await read\(`\$\{OUTCOME_FIELDS\}, cs_email, not_selected_at, offer_declined_at`\)/)
})

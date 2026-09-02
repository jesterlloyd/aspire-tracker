// NGRP-INTERVIEW-HIRE-1: recording who was interviewed and who was hired.
//
// THE OWNER'S RULE, stated in as many words: this program records who gets
// interviewed and who gets hired, NOT how anyone was graded. No rubric and no
// score is stored anywhere, and nothing here ranks people against each other.
//
// THE SCHEMA LINE THE TABLES ALREADY DREW. ngrp_candidates is "workflow state,
// not durable employment history"; ngrp_residency_outcomes is "the minimal
// DURABLE employment facts", with RESTRICT foreign keys and DELETE revoked even
// from service_role. An interview is workflow, a hire is durable, and this
// change writes each to the side it belongs on.
//
// Run: node --test test/ngrpInterviewHire.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { validateInterviewPayload, validateOutcomePayload, INTERVIEW_STATUSES } from '../lib/server/ngrpPlanning.js'
import { NGRP_AUDIT_EVENTS, sanitizeAuditMetadata } from '../lib/server/ngrpAudit.js'
import { INTERVIEW_STATES } from '../src/lib/ngrp/ngrpStates.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const manageApi = read('api/ngrp-manage.js')
const drawer = read('src/components/ngrp/ApplicantDrawer.jsx')
const board = read('src/components/ngrp/PlacementBoard.jsx')
const profiles = read('src/components/ngrp/ProfilesTab.jsx')
const applicantsLib = read('lib/server/ngrpApplicants.js')
const migration = read('supabase/migrations/20260907000000_ngrp_interview_hire_events.sql')

// ── The interview record ─────────────────────────────────────────────────────

test('the interview vocabulary is one list, shared by client, server and DB', () => {
  assert.deepEqual(INTERVIEW_STATUSES, Object.keys(INTERVIEW_STATES))
  // The DB CHECK was written in the assignment migration; it must still agree.
  const columns = read('supabase/migrations/20260906000000_ngrp_assignment_interview.sql')
  for (const k of INTERVIEW_STATUSES) assert.match(columns, new RegExp(`'${k}'`), k)
})

test('a scheduled interview must say when; the states that mean it never happened drop the time', () => {
  const at = '2027-01-06T17:00:00.000Z'
  assert.equal(validateInterviewPayload({ status: 'scheduled' }).errors[0].field, 'interview_at')
  assert.ok(validateInterviewPayload({ status: 'scheduled', interview_at: at }).ok)
  // Completed and no-show KEEP the time it was held at.
  for (const s of ['completed', 'decision_recorded', 'no_show']) {
    assert.equal(validateInterviewPayload({ status: s, interview_at: at }).interview.interview_at, at, s)
  }
  // Cancelled, withdrawn and never-happening drop it rather than leaving a
  // time against an interview that did not occur.
  for (const s of ['not_scheduled', 'cancelled', 'applicant_withdrew', 'no_interview']) {
    assert.equal(validateInterviewPayload({ status: s, interview_at: at }).interview.interview_at, null, s)
  }
  assert.equal(validateInterviewPayload({ status: 'nonsense' }).errors[0].field, 'status')
  assert.equal(validateInterviewPayload({ status: 'completed', interview_at: 'not a date' }).errors[0].field, 'interview_at')
})

// ── The durable outcome ──────────────────────────────────────────────────────

test('an outcome cannot claim a later step without the earlier one', () => {
  const t = s => `2027-01-${s}T00:00:00.000Z`
  assert.equal(validateOutcomePayload({ offer_accepted_at: t('10') }).errors[0].field, 'offer_accepted_at')
  assert.equal(validateOutcomePayload({ offer_extended_at: t('08'), hired_at: t('12') }).errors[0].field, 'hired_at')
  // A hire needs the unit it was into, or the record cannot say where.
  assert.equal(validateOutcomePayload({
    offer_extended_at: t('08'), offer_accepted_at: t('10'), hired_at: t('12'),
  }).errors[0].field, 'hired_unit')
  const ok = validateOutcomePayload({
    offer_extended_at: t('08'), offer_accepted_at: t('10'), hired_at: t('12'),
    hired_unit: ' 5 SCCT ', residency_start_date: '2027-02-02',
  })
  assert.ok(ok.ok)
  assert.equal(ok.outcome.hired_unit, '5 SCCT', 'trimmed')
  assert.equal(ok.outcome.residency_start_date, '2027-02-02')
  // The DB enforces accept-requires-offer too; the validator names the field
  // instead of letting a constraint violation surface.
  assert.match(read('supabase/migrations/20260903000000_ngrp_foundation.sql'), /ngrp_outcomes_accept_requires_offer/)
})

test('an empty outcome is valid, because the record accumulates over months', () => {
  const v = validateOutcomePayload({})
  assert.ok(v.ok)
  assert.deepEqual(v.outcome, {
    offer_extended_at: null, offer_accepted_at: null, hired_at: null,
    residency_start_date: null, hired_unit: null,
  })
  // A residency start must be a calendar date, not a timestamp.
  assert.equal(validateOutcomePayload({ residency_start_date: '2027-02-02T00:00:00Z' }).errors[0].field, 'residency_start_date')
})

// ── Where each side is written ───────────────────────────────────────────────

test('the interview writes to candidates, the outcome to its own durable table', () => {
  const iv = manageApi.slice(manageApi.indexOf("action === 'interview_set'"), manageApi.indexOf("action === 'outcome_set'"))
  assert.match(iv, /from\('ngrp_candidates'\)/)
  assert.doesNotMatch(iv, /from\('ngrp_residency_outcomes'\)/, 'workflow state does not write the durable table')
  assert.match(iv, /interview_recorded_by_profile_id: actorId/)
  assert.match(iv, /idempotent: true/, 're-saving the same state is not a new audit row')

  const oc = manageApi.slice(manageApi.indexOf("action === 'outcome_set'"), manageApi.indexOf("action === 'assign_unit'"))
  assert.match(oc, /from\('ngrp_residency_outcomes'\)/)
  // Only someone on the official NGRP list can carry an offer or a hire.
  assert.match(oc, /candidate\.application_status !== 'confirmed'/)
  // One row per candidate attempt: update when it exists, insert when it does not.
  assert.match(oc, /existing\.data\s*\n?\s*\? await db\.from\('ngrp_residency_outcomes'\)\.update/)
  assert.match(oc, /: await db\.from\('ngrp_residency_outcomes'\)\.insert/)
  assert.match(oc, /recorded_by_profile_id: actorId/)
  // Nothing deletes an outcome: DELETE is revoked even from service_role.
  assert.doesNotMatch(oc, /\.delete\(/)
})

test('the audit records the step that CHANGED, not every save', () => {
  const oc = manageApi.slice(manageApi.indexOf("action === 'outcome_set'"), manageApi.indexOf("action === 'assign_unit'"))
  assert.match(oc, /if \(v\.outcome\[field\] && !before\[field\]\)/)
  for (const [f, ev] of [['offer_extended_at', 'offer_extended'], ['offer_accepted_at', 'offer_accepted'], ['hired_at', 'hire_recorded']]) {
    assert.match(oc, new RegExp(`'${f}', '${ev}'`))
  }
})

test('every new event type passes BOTH gates', () => {
  // The JS allowlist and the DB CHECK. Adding to one alone lets the endpoint
  // report success while Postgres silently refuses the audit row.
  for (const ev of ['interview_recorded', 'offer_extended', 'offer_accepted', 'hire_recorded']) {
    assert.ok(NGRP_AUDIT_EVENTS.includes(ev), `${ev} allowlisted in JS`)
    assert.match(migration, new RegExp(`'${ev}'`), `${ev} allowed by the DB CHECK`)
  }
  // Widened, never narrowed.
  for (const ev of ['cycle_created', 'application_confirmed', 'unit_assigned']) {
    assert.match(migration, new RegExp(`'${ev}'`), `${ev} survives the widening`)
  }
  // The metadata that travels is allowlisted and carries nothing personal.
  const meta = sanitizeAuditMetadata({ interview_status: 'completed', hired_unit: '5 SCCT', student_name: 'Real Person' })
  assert.deepEqual(Object.keys(meta).sort(), ['hired_unit', 'interview_status'])
})

test('the migration adds no columns, because both homes already existed', () => {
  assert.doesNotMatch(migration, /ADD COLUMN/)
  assert.doesNotMatch(migration, /CREATE TABLE/)
  // Its only DROP is of the constraint it immediately re-adds, which is how a
  // CHECK is widened.
  assert.match(migration, /DROP CONSTRAINT IF EXISTS ngrp_audit_events_event_type_check/)
  assert.match(migration, /ADD CONSTRAINT ngrp_audit_events_event_type_check/)
  assert.match(migration, /-- {3}SELECT/, 'a verification query ships with it')
})

// ── One drawer, two surfaces ─────────────────────────────────────────────────

test('both surfaces open the SAME drawer, so a record has one place it is edited', () => {
  for (const [name, src] of [['profiles', profiles], ['board', board]]) {
    assert.match(src, /import ApplicantDrawer from '\.\/ApplicantDrawer'/, name)
    assert.match(src, /setInterview: \(r, fields\) =>/, name)
    assert.match(src, /setOutcome: \(r, fields\) =>/, name)
  }
  // The board resolves the open row from LIVE data each render, so a save is
  // reflected rather than leaving a stale snapshot on screen.
  assert.match(board, /const drawerRow = drawerId \? rows\.find\(r => r\.id === drawerId\) \|\| null : null/)
  // The board routes through the endpoint like every other surface; it never
  // reaches for the database itself.
  assert.doesNotMatch(board, /from\(['\"]ngrp_/, 'no direct table access')
  assert.doesNotMatch(board, /supabase/, 'no direct client')
  assert.match(board, /postNgrpManage\(action, \{ candidate_id: row\.candidate_id, \.\.\.fields \}\)/)
})

test('the outcome reaches the client, scoped to the selected cohort', () => {
  // Outcomes live in their own table, so the roster payload has to carry them
  // or the drawer would render an empty record over real data.
  assert.match(applicantsLib, /from\('ngrp_residency_outcomes'\)/)
  assert.match(applicantsLib, /\.in\('candidate_id', candidates\.map\(c => c\.id\)\)/)
  assert.match(applicantsLib, /outcomeByCandidate/)
  // A candidate with no row simply has no outcome yet, the normal state.
  assert.match(applicantsLib, /outcomeByCandidate\.get\(c\.id\) \|\| null/)
})

test('no rubric and no score, anywhere', () => {
  for (const [name, src] of [['drawer', drawer], ['board', board], ['api', manageApi], ['migration', migration]]) {
    assert.doesNotMatch(src, /(score|rubric)\s*[:=]/i, name)
  }
  // And the drawer says so where someone would look for the field.
  assert.match(drawer, /No interview rubric or score is stored anywhere in ASPIRE/)
  // A hire is durable and is said to be.
  assert.match(drawer, /can never be deleted, only corrected/)
})

test('the datetime round trip does not slide by the timezone offset', () => {
  // datetime-local reads and writes LOCAL wall time; a stored timestamptz is
  // UTC. Formatting with toISOString().slice(0,16) would show the UTC hour and
  // silently move every interview by the offset.
  assert.match(drawer, /function toLocalInput\(ts\)/)
  assert.doesNotMatch(drawer, /toISOString\(\)\.slice\(0, ?16\)/)
  assert.match(drawer, /const fromLocalInput = v => \(v \? new Date\(v\)\.toISOString\(\) : null\)/)
})

test('no em dash in anything this change added', () => {
  assert.doesNotMatch(read('supabase/migrations/20260907000000_ngrp_interview_hire_events.sql'), /—/)
  // The drawer predates this change and carries its own em dashes in older
  // sections, so only the two sections added here are checked.
  const added = drawer.slice(drawer.indexOf('// ── NGRP-INTERVIEW-HIRE-1 sections'), drawer.indexOf('export default function ApplicantDrawer'))
  assert.ok(added.length > 500, 'the added sections were found')
  assert.doesNotMatch(added, /—/, 'the sections this change added must not contain an em dash')
  void readdirSync
})

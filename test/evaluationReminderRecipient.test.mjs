// EVALUATION-REMINDERS-1: who a reminder is allowed to reach.
//
// Runs the REAL resolver against a substituted database and auth admin. Nothing
// is sent; no network call is made. Every rule fails CLOSED - the assertions
// below are as much about what is NOT sent as about what is.
//
// Run: node --test test/evaluationReminderRecipient.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  resolveReminderRecipient, resolveHiredCedarsRecipient, isCedarsEmail, isVerifiedAuthUser,
  RECIPIENT_REASONS, ACTIVE_ROTATION_STATUS, HIRED_OUTCOME, CEDARS_EMAIL_DOMAIN,
} from '../lib/server/evaluation/reminderRecipient.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

// ── Substituted database + auth admin ───────────────────────────────────────
/**
 * @param {object} o
 * @param {Array}  o.links     user_student_links rows (already filtered conceptually)
 * @param {object} o.profile   user_profiles row, or null
 * @param {object} o.authUser  auth user, or null
 */
function makeDb({ links = [], profile = null, authUser = null, linkError = null, profileError = null } = {}) {
  const queries = []
  const db = {
    from(table) {
      const q = { table, filters: [] }
      queries.push(q)
      const api = {
        select() { return api },
        eq(f, v) { q.filters.push([f, v]); return api },
        is(f, v) { q.filters.push([f, v]); return api },
        limit() { return Promise.resolve({ data: linkError ? null : links, error: linkError }) },
        single() { return Promise.resolve({ data: profileError ? null : profile, error: profileError }) },
      }
      return api
    },
  }
  const authAdmin = {
    calls: 0,
    getUserById: async (id) => {
      authAdmin.calls++
      authAdmin.lastId = id
      return { data: { user: authUser }, error: null }
    },
  }
  return { db, authAdmin, queries }
}

const student = (over = {}) => ({
  id: 's-1', first_name: 'Ava', last_name: 'Wong',
  school_email: 'ava.wong@school.example.edu',
  personal_email: 'ava.personal@example.com',
  status: 'Completed', ngrp_outcome: 'Pending', ...over,
})
const assignment = (over = {}) => ({
  id: 'a-1', respondent_type: 'student', respondent_email: null, respondent_name: null, ...over,
})

// ── Student lifecycle routing ───────────────────────────────────────────────

test('a student CURRENTLY ON ROTATION receives the school email', async () => {
  const { db, authAdmin } = makeDb()
  const r = await resolveReminderRecipient({
    db, authAdmin, assignment: assignment(), student: student({ status: ACTIVE_ROTATION_STATUS }),
  })
  assert.equal(r.ok, true)
  assert.equal(r.email, 'ava.wong@school.example.edu')
  assert.equal(r.route, 'school')
  assert.equal(authAdmin.calls, 0, 'no portal lookup for a non-hired student')
})

test('a student AFTER ROTATION receives the personal email', async () => {
  const { db, authAdmin } = makeDb()
  for (const status of ['Completed', 'Placed', 'Interviewed']) {
    const r = await resolveReminderRecipient({ db, authAdmin, assignment: assignment(), student: student({ status }) })
    assert.equal(r.ok, true, status)
    assert.equal(r.email, 'ava.personal@example.com', status)
    assert.equal(r.route, 'personal', status)
  }
})

test('THERE IS NO FALLBACK between the two addresses, in either direction', async () => {
  const { db, authAdmin } = makeDb()
  // On rotation with no school email: personal exists, and is NOT used.
  const onRotation = await resolveReminderRecipient({
    db, authAdmin, assignment: assignment(),
    student: student({ status: ACTIVE_ROTATION_STATUS, school_email: '' }),
  })
  assert.equal(onRotation.ok, false)
  assert.equal(onRotation.reason, RECIPIENT_REASONS.MISSING_SCHOOL_EMAIL)

  // After rotation with no personal email: school exists, and is NOT used.
  const afterRotation = await resolveReminderRecipient({
    db, authAdmin, assignment: assignment(), student: student({ personal_email: null }),
  })
  assert.equal(afterRotation.ok, false)
  assert.equal(afterRotation.reason, RECIPIENT_REASONS.MISSING_PERSONAL_EMAIL)
})

test('a malformed address is rejected rather than sent to', async () => {
  const { db, authAdmin } = makeDb()
  const r = await resolveReminderRecipient({
    db, authAdmin, assignment: assignment(), student: student({ personal_email: 'not-an-email' }),
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, RECIPIENT_REASONS.MISSING_PERSONAL_EMAIL)
})

test('a missing student record sends nothing', async () => {
  const { db, authAdmin } = makeDb()
  const r = await resolveReminderRecipient({ db, authAdmin, assignment: assignment(), student: null })
  assert.equal(r.ok, false)
  assert.equal(r.reason, RECIPIENT_REASONS.STUDENT_NOT_FOUND)
})

// ── Hired: Cedars-Sinai only, and it fails closed ───────────────────────────

const hired = () => student({ ngrp_outcome: HIRED_OUTCOME, status: 'Completed' })

test('a HIRED student receives only a verified, active, linked Cedars address', async () => {
  const { db, authAdmin } = makeDb({
    links: [{ user_profile_id: 'p-1' }],
    profile: { id: 'p-1', auth_user_id: 'au-1', email: 'ava.wong@cshs.org', is_active: true },
    authUser: { email_confirmed_at: '2026-07-01T00:00:00Z' },
  })
  const r = await resolveReminderRecipient({ db, authAdmin, assignment: assignment(), student: hired() })
  assert.equal(r.ok, true)
  assert.equal(r.email, 'ava.wong@cshs.org')
  assert.equal(r.route, 'cedars')
  assert.equal(authAdmin.calls, 1, 'verification is checked against auth, not assumed')
})

test('MISSING VERIFIED CEDARS EMAIL FAILS CLOSED - never a silent fallback', async () => {
  const cases = [
    ['no active link', { links: [], profile: null }],
    ['ambiguous links', { links: [{ user_profile_id: 'p-1' }, { user_profile_id: 'p-2' }] }],
    ['inactive profile', {
      links: [{ user_profile_id: 'p-1' }],
      profile: { id: 'p-1', auth_user_id: 'au-1', email: 'ava@cshs.org', is_active: false },
      authUser: { email_confirmed_at: '2026-07-01T00:00:00Z' },
    }],
    ['non-Cedars address', {
      links: [{ user_profile_id: 'p-1' }],
      profile: { id: 'p-1', auth_user_id: 'au-1', email: 'ava@gmail.com', is_active: true },
      authUser: { email_confirmed_at: '2026-07-01T00:00:00Z' },
    }],
    ['unverified account', {
      links: [{ user_profile_id: 'p-1' }],
      profile: { id: 'p-1', auth_user_id: 'au-1', email: 'ava@cshs.org', is_active: true },
      authUser: {},
    }],
    ['no auth user id', {
      links: [{ user_profile_id: 'p-1' }],
      profile: { id: 'p-1', auth_user_id: null, email: 'ava@cshs.org', is_active: true },
    }],
    ['link query error', { linkError: { message: 'boom' } }],
    ['profile query error', { links: [{ user_profile_id: 'p-1' }], profileError: { message: 'boom' } }],
  ]

  for (const [label, cfg] of cases) {
    const { db, authAdmin } = makeDb(cfg)
    const r = await resolveReminderRecipient({ db, authAdmin, assignment: assignment(), student: hired() })
    assert.equal(r.ok, false, label)
    assert.equal(r.reason, RECIPIENT_REASONS.MISSING_VERIFIED_CEDARS_EMAIL, label)
    assert.equal(r.email, null, `${label}: no address may be returned`)
  }
})

test('a hired student NEVER falls back to their school or personal address', async () => {
  const { db, authAdmin } = makeDb({ links: [] })   // no portal account at all
  const s = hired()   // both school_email and personal_email are present and valid
  const r = await resolveReminderRecipient({ db, authAdmin, assignment: assignment(), student: s })
  assert.equal(r.ok, false)
  assert.notEqual(r.email, s.school_email)
  assert.notEqual(r.email, s.personal_email)
})

test('the hired rule beats the on-rotation rule', async () => {
  const { db, authAdmin } = makeDb({ links: [] })
  const r = await resolveReminderRecipient({
    db, authAdmin, assignment: assignment(),
    student: student({ ngrp_outcome: HIRED_OUTCOME, status: ACTIVE_ROTATION_STATUS }),
  })
  assert.equal(r.reason, RECIPIENT_REASONS.MISSING_VERIFIED_CEDARS_EMAIL,
    'a hired student is not routed to school just because they are on rotation')
})

test('Cedars detection is domain-exact and case/whitespace tolerant', () => {
  assert.equal(CEDARS_EMAIL_DOMAIN, '@cshs.org')
  assert.equal(isCedarsEmail('  Ava.Wong@CSHS.ORG '), true)
  assert.equal(isCedarsEmail('ava@cshs.org.evil.com'), false)
  assert.equal(isCedarsEmail('ava@notcshs.org'), false, 'suffix matching must not accept a lookalike domain')
  assert.equal(isCedarsEmail(''), false)
})

test('verification accepts confirmation OR a prior sign-in, and nothing else', () => {
  assert.equal(isVerifiedAuthUser({ email_confirmed_at: 'x' }), true)
  assert.equal(isVerifiedAuthUser({ confirmed_at: 'x' }), true)
  assert.equal(isVerifiedAuthUser({ last_sign_in_at: 'x' }), true)
  assert.equal(isVerifiedAuthUser({ invited_at: 'x' }), false, 'invited is not accepted')
  assert.equal(isVerifiedAuthUser({}), false)
  assert.equal(isVerifiedAuthUser(null), false)
})

test('an auth lookup that throws fails closed', async () => {
  const { db } = makeDb({
    links: [{ user_profile_id: 'p-1' }],
    profile: { id: 'p-1', auth_user_id: 'au-1', email: 'ava@cshs.org', is_active: true },
  })
  const throwingAdmin = { getUserById: async () => { throw new Error('auth down') } }
  const r = await resolveHiredCedarsRecipient({ db, authAdmin: throwingAdmin, studentId: 's-1', studentName: 'Ava Wong' })
  assert.equal(r.ok, false)
  assert.equal(r.reason, RECIPIENT_REASONS.MISSING_VERIFIED_CEDARS_EMAIL)
})

// ── Preceptor identity cannot drift ─────────────────────────────────────────

test('a preceptor reminder goes to the ASSIGNMENT SNAPSHOT, not the current preceptor', async () => {
  const { db, authAdmin, queries } = makeDb()
  const r = await resolveReminderRecipient({
    db, authAdmin,
    assignment: assignment({
      respondent_type: 'preceptor',
      respondent_email: 'asked.preceptor@example.org',
      respondent_name: 'Dana Whitfield',
    }),
    // A different preceptor is now on file for this student. It must be ignored.
    student: student({ preceptor_email: 'new.preceptor@example.org', preceptor_id: 'p-999' }),
  })
  assert.equal(r.ok, true)
  assert.equal(r.email, 'asked.preceptor@example.org')
  assert.equal(r.name, 'Dana Whitfield')
  assert.equal(r.route, 'preceptor_snapshot')
  const tables = queries.map(q => q.table)
  assert.ok(!tables.includes('preceptors'), 'the preceptors table must not be consulted')
  assert.ok(!tables.includes('student_preceptor_assignments'), 'nor the assignment table')
})

test('a preceptor snapshot without a usable address sends nothing', async () => {
  const { db, authAdmin } = makeDb()
  for (const email of [null, '', '   ', 'not-an-email']) {
    const r = await resolveReminderRecipient({
      db, authAdmin, assignment: assignment({ respondent_type: 'preceptor', respondent_email: email }), student: null,
    })
    assert.equal(r.ok, false, String(email))
    assert.equal(r.reason, RECIPIENT_REASONS.MISSING_PRECEPTOR_SNAPSHOT_EMAIL, String(email))
  }
})

// ── No unit-leader fan-out is invented ──────────────────────────────────────

test('NO UNIT-LEADER AUDIENCE EXISTS: an unknown respondent type is refused', async () => {
  const { db, authAdmin, queries } = makeDb()
  for (const respondent_type of ['unit_leader', 'staff', '', null, undefined]) {
    const r = await resolveReminderRecipient({
      db, authAdmin, assignment: assignment({ respondent_type }), student: student(),
    })
    assert.equal(r.ok, false, String(respondent_type))
    assert.equal(r.reason, RECIPIENT_REASONS.UNSUPPORTED_RESPONDENT_TYPE, String(respondent_type))
  }
  assert.equal(queries.length, 0, 'no lookup of any kind is attempted for an unsupported respondent')
})

test('the reminder modules never read unit membership to build an audience', () => {
  for (const f of [
    'lib/server/evaluation/reminderRecipient.js',
    'lib/server/evaluation/reminderSend.js',
    'api/cron/evaluation-reminders.js',
  ]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const table of ['user_unit_scopes', 'units', 'unit_leaders']) {
      assert.doesNotMatch(code, new RegExp(`from\\('${table}'\\)`),
        `${f} must not query ${table} - a unit-leader audience would be invented, not found`)
    }
  }
})

test('the schema itself cannot express a unit-leader respondent', () => {
  const sql = read('supabase/migrations/20260613000000_ps2a_add_evaluation_assignment_respondent_identity.sql')
  assert.match(sql, /respondent_type IN \('student', ?'preceptor'\)/,
    'respondent_type is CHECK-constrained to student|preceptor, so no such assignment can exist')
})

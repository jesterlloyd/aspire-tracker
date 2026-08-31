// test/publicEndpointHardening.test.mjs
//
// S-08 through S-11: the unauthenticated surface.
//
// These endpoints exist so a student, coordinator, or unit leader can do their
// own work without going through the ASPIRE team, so the test that matters most
// is not "is it locked down" but "is it locked down WITHOUT breaking a real
// submission". Both are asserted here.
//
// Pure unit and source assertions. Nothing opens a network connection, touches a
// live database, or sends email. No fixture carries a real student.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')

// EVALUATION_RATE_LIMIT_PEPPER is required at import by the rate-limit helper,
// which is deliberate and fail-closed. A fixed non-secret value lets the module
// load here; it is never a real pepper and never leaves this process.
process.env.EVALUATION_RATE_LIMIT_PEPPER = 'test-pepper-not-a-secret'
const rl = await import('../api/lib/publicRateLimit.js')

const PUBLIC_ENDPOINTS = [
  'api/student-intake-lookup.js',
  'api/student-intake-submit.js',
  'api/unit-form-lookup.js',
  'api/unit-form-submit.js',
  'api/school-form-submit.js',
  'api/shift-log/lookup-student.js',
  'api/shift-log/check-in.js',
  'api/shift-log/check-out.js',
  'api/shift-log/submit-past-shift.js',
]

// ── S-11: every public endpoint is throttled ─────────────────────────────────

test('S-11: every public endpoint consumes a rate limit', () => {
  const missing = PUBLIC_ENDPOINTS.filter((f) => !/consumePublicRateLimit\(/.test(read(f)))
  assert.deepEqual(missing, [], 'these public endpoints have no throttle')
})

test('S-11: every endpoint uses two buckets, a burst and a sustained one', () => {
  // One per-minute cap alone leaves a patient caller free to walk an address
  // space all day just under the ceiling.
  for (const [name, limits] of Object.entries(rl).filter(([k]) => k.endsWith('_LIMITS'))) {
    assert.equal(limits.length, 2, `${name} must have exactly two buckets`)
    const [burst, sustained] = limits
    assert.equal(burst.windowSeconds, 60, `${name} burst bucket is per minute`)
    assert.equal(sustained.windowSeconds, 3600, `${name} sustained bucket is per hour`)
    assert.ok(sustained.maxPerWindow > burst.maxPerWindow, `${name} sustained ceiling must exceed the burst ceiling`)
    // A sustained ceiling at or above burst x 60 would make the second bucket
    // decorative, since the burst bucket alone would always bind first.
    assert.ok(sustained.maxPerWindow < burst.maxPerWindow * 60, `${name} sustained bucket does nothing`)
    assert.notEqual(burst.prefix, sustained.prefix, `${name} buckets must not share a key`)
  }
})

test('S-11: bucket prefixes are unique across every endpoint', () => {
  const prefixes = Object.entries(rl)
    .filter(([k]) => k.endsWith('_LIMITS'))
    .flatMap(([, v]) => v.map((b) => b.prefix))
  assert.equal(new Set(prefixes).size, prefixes.length, 'two endpoints sharing a bucket would throttle each other')
})

test('S-11: the limiter fails closed on an RPC error, a throw, and a non-true answer', async () => {
  const limits = [{ prefix: 'p', windowSeconds: 60, maxPerWindow: 5 }]
  const req = { headers: {}, socket: {} }
  assert.equal(await rl.consumePublicRateLimit({ rpc: async () => ({ data: null, error: { message: 'boom' } }) }, req, limits), false)
  assert.equal(await rl.consumePublicRateLimit({ rpc: async () => { throw new Error('down') } }, req, limits), false)
  assert.equal(await rl.consumePublicRateLimit({ rpc: async () => ({ data: false, error: null }) }, req, limits), false)
  assert.equal(await rl.consumePublicRateLimit({ rpc: async () => ({ data: null, error: null }) }, req, limits), false)
  // And allows a caller under budget.
  assert.equal(await rl.consumePublicRateLimit({ rpc: async () => ({ data: true, error: null }) }, req, limits), true)
})

test('S-11: every bucket must pass, not just the first', async () => {
  const calls = []
  const db = { rpc: async (_n, args) => { calls.push(args.p_bucket_key); return { data: calls.length === 1, error: null } } }
  const ok = await rl.consumePublicRateLimit(db, { headers: {}, socket: {} }, [
    { prefix: 'a', windowSeconds: 60, maxPerWindow: 1 },
    { prefix: 'b', windowSeconds: 3600, maxPerWindow: 2 },
  ])
  assert.equal(ok, false, 'a second bucket refusing must refuse the request')
  assert.equal(calls.length, 2)
})

test('S-11: the bucket key is a hash, never the raw client IP', async () => {
  let key = null
  const db = { rpc: async (_n, args) => { key = args.p_bucket_key; return { data: true, error: null } } }
  await rl.consumePublicRateLimit(db, { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, socket: {} },
    [{ prefix: 'probe', windowSeconds: 60, maxPerWindow: 5 }])
  assert.ok(key.startsWith('probe:'))
  assert.doesNotMatch(key, /203\.0\.113\.9/, 'the limiter must not store the caller IP')
  assert.match(key, /^probe:[0-9a-f]{64}$/)
})

test('S-11: a refused caller is told to wait, and nothing else', () => {
  assert.match(rl.TOO_MANY_REQUESTS, /Too many requests/)
  assert.doesNotMatch(rl.TOO_MANY_REQUESTS, /bucket|limit of|\d+ per|IP|address/i)
  for (const f of PUBLIC_ENDPOINTS) {
    assert.match(read(f), /res\.status\(429\)/, `${f} must answer 429 when throttled`)
  }
})

// ── S-11: the intake lookup is no longer an email oracle ─────────────────────

const intakeLookup = read('api/student-intake-lookup.js')

test('S-11: the intake lookup answers every failure identically', () => {
  const code = strip(intakeLookup)
  // One refusal constant, used for every failure path.
  assert.match(code, /const CANNOT_START = \{\s*status: 404,/)
  const distinct = code.match(/res\.status\((?!CANNOT_START|429|405|500|200)/g) || []
  assert.deepEqual(distinct, [], 'no failure may answer with its own status')
  // The states that used to be distinguishable are gone from the response path.
  for (const leak of ['not_found', 'ambiguous_student', 'ambiguous_cohort', 'not_accepting']) {
    assert.doesNotMatch(code, new RegExp(`error: '${leak}'`), `${leak} must not be reported to the caller`)
  }
  // Every failure returns the SAME body object, not a copy that could drift.
  assert.equal((code.match(/CANNOT_START\.body/g) || []).length, (code.match(/CANNOT_START\.status/g) || []).length)
  assert.ok((code.match(/CANNOT_START\.body/g) || []).length >= 4, 'all four failure paths must use it')
})

test('S-11: the intake lookup requires a second factor the applicant already typed', () => {
  assert.match(intakeLookup, /body\.last_name/)
  assert.match(intakeLookup, /storedLast !== normalizeForMatch\(lastName\)/)
  // And the form supplies it.
  const form = read('src/components/StudentIntakeFormPage.jsx')
  assert.match(form, /last_name: form\.last_name\.trim\(\)/)
  // It is genuinely already required before the lookup runs, so this is free.
  const requireIdx = form.indexOf("!form.last_name.trim()")
  const lookupIdx = form.indexOf('student-intake-lookup')
  assert.ok(requireIdx > 0 && requireIdx < lookupIdx, 'last name must already be required before the lookup')
})

test('S-11: the intake lookup returns no identifier at all', () => {
  const code = strip(intakeLookup)
  assert.doesNotMatch(code, /student_id/, 'the student primary key must not reach an anonymous caller')
  assert.doesNotMatch(code, /cohort_id:/)
  assert.match(code, /res\.status\(200\)\.json\(\{ verified: true \}\)/)
  // Nothing consumed them: the form reads only ok.
  assert.doesNotMatch(read('src/components/StudentIntakeFormPage.jsx'), /lookupData\.student_id|lookupData\.cohort_id/)
})

// ── S-10: the unit form lookup discloses nothing identifying ─────────────────

const unitLookup = read('api/unit-form-lookup.js')

test('S-10: a unit name alone returns no person and no prose', () => {
  const openOnly = ['submitted_by_name', 'submitted_by_email', 'submitted_by_role',
    'preferred_preceptors', 'considerations', 'reason_for_zero',
    'hiring_new_grads_reason', 'aspire_alumni_notes']
  const projectOpen = unitLookup.slice(unitLookup.indexOf('export function projectOpen'))
    .slice(0, unitLookup.slice(unitLookup.indexOf('export function projectOpen')).indexOf('\n}') + 2)
  for (const field of openOnly) {
    assert.doesNotMatch(projectOpen, new RegExp(field), `${field} must not be returned without the submitter email`)
  }
})

test('S-10: identifying fields require the submitter email to match', () => {
  assert.match(unitLookup, /const matched = !!stored && !!supplied && stored === supplied/)
  assert.match(unitLookup, /response: matched\s*\n\s*\? \{ \.\.\.projectOpen\(responseRow\), \.\.\.projectGuarded\(responseRow\) \}\s*\n\s*: projectOpen\(responseRow\)/)
})

test('S-10: the guarded half is exactly the identifying and free-text fields', async () => {
  const mod = await import('../api/unit-form-lookup.js')
  const row = Object.fromEntries([
    'response_status', 'slots_offered', 'shift_preference', 'hiring_new_grads_ngrp',
    'has_hired_aspire_alumni', 'aspire_alumni_outcome', 'would_consider_aspire_alumni',
    'submitted_by_name', 'submitted_by_email', 'submitted_by_role', 'preferred_preceptors',
    'considerations', 'reason_for_zero', 'hiring_new_grads_reason', 'aspire_alumni_notes',
  ].map((k) => [k, `v_${k}`]))
  const open = mod.projectOpen(row)
  const guarded = mod.projectGuarded(row)
  assert.deepEqual(Object.keys(open).sort(), [
    'aspire_alumni_outcome', 'has_hired_aspire_alumni', 'hiring_new_grads_ngrp',
    'response_status', 'shift_preference', 'slots_offered', 'would_consider_aspire_alumni'].sort())
  assert.deepEqual(Object.keys(guarded).sort(), [
    'aspire_alumni_notes', 'considerations', 'hiring_new_grads_reason', 'preferred_preceptors',
    'reason_for_zero', 'submitted_by_email', 'submitted_by_name', 'submitted_by_role'].sort())
  // A projection, so a column added to unit_cohort_responses cannot leak by default.
  assert.equal(Object.keys({ ...open, ...guarded }).length, 15)
})

test('S-10: a returning coordinator still gets their own answers back', () => {
  // The form re-looks-up on blur with the address they typed, so the prefill they
  // had before still arrives; it just arrives one field later.
  const page = read('src/components/UnitFormPage.jsx')
  assert.match(page, /onBlur=\{e => \{ const v = e\.target\.value\.trim\(\); if \(v && form\.unit_name\) runPrefill\(form\.unit_name, v\) \}\}/)
  assert.match(page, /submitter_email: submitterEmail \|\| ''/)
  // And the second call must not wipe what they have already typed.
  assert.match(page, /setForm\(prev => \{/)
  assert.match(page, /next\.considerations\s+= prev\.considerations\s+\|\| responseRow\.considerations/)
})

// ── S-09: shift log ──────────────────────────────────────────────────────────

test('S-09: the public shift-log path is NOT retired, because nothing replaces it', () => {
  // The signed-in portal links students straight here, and the portal endpoint
  // cannot create a shift log at all.
  assert.match(read('src/portal/StudentPortal.jsx'), /href="\/shift-log"/)
  const portalManage = read('api/portal/my-shift-log-manage.js')
  assert.match(portalManage, /const ACTIONS = \['edit', 'void', 'eligibility'\]/)
  assert.doesNotMatch(portalManage, /'create'/)
})

test('S-09: an ineligible answer carries no student fields', () => {
  const helper = read('api/lib/shiftLogLookup.js')
  assert.match(helper, /return \{ found: true, eligible: false, ineligible_reason: 'cohort_archived' \}/)
  assert.match(helper, /return \{ found: true, eligible: false, ineligible_reason: 'not_active_rotation' \}/)
  // The consumer no longer expects one.
  assert.doesNotMatch(read('src/components/shift-log-lifecycle/ShiftLogLifecycle.jsx'),
    /setErrorInfo\(\{ type: r\.ineligible_reason \}\); setStudentData\(r\.student\)/)
})

test('S-09: the three ineligible reasons stay distinguishable, because the advice differs', () => {
  // Collapsing these would tell a student whose rotation ended to check their
  // spelling. The rate limit is the enumeration control here, not a generic reply.
  const view = read('src/components/shift-log-lifecycle/LifecycleResultView.jsx')
  for (const v of ['ineligible_not_found', 'ineligible_not_active_rotation', 'ineligible_cohort_archived']) {
    assert.match(view, new RegExp(`variant === '${v}'`), `${v} must keep its own screen`)
  }
})

// ── S-08: the school form password is verified server-side ───────────────────

const schoolSubmit = read('api/school-form-submit.js')

test('S-08: the password is verified on the server, before any write', () => {
  assert.match(schoolSubmit, /school_form_requires_password/)
  assert.match(schoolSubmit, /verify_school_form_password/)
  const check = schoolSubmit.indexOf('verify_school_form_password')
  const write = schoolSubmit.indexOf('performSchoolPlacementUpsert(db')
  assert.ok(check > 0 && write > 0 && check < write, 'the password must be checked before the upsert')
})

test('S-08: a missing password and a wrong one are refused identically', () => {
  assert.match(schoolSubmit, /const refuse = \(\) => res\.status\(403\)/)
  assert.equal((schoolSubmit.match(/return refuse\(\)/g) || []).length, 2)
})

test('S-08: a failure to determine the requirement is refused, not waved through', () => {
  const section = schoolSubmit.slice(schoolSubmit.indexOf('let requiresPassword'))
  assert.match(section, /catch \{\s*\n\s*return res\.status\(500\)/)
  assert.doesNotMatch(section, /requiresPassword = false/)
})

test('S-08: the password never reaches a write, a log, or a response', () => {
  // Comment-stripped: the note recording this promise necessarily says the word,
  // so the promise is asserted against executable code only.
  const after = strip(schoolSubmit.slice(schoolSubmit.indexOf('// The password has served')))
  assert.doesNotMatch(after, /password/i, 'nothing after the gate may carry the password')
  // And the VALUE is never logged or echoed. The refusal message says the word
  // "password", which is correct and is not what this guards against; what must
  // never appear is the variable holding what the caller typed.
  const code = strip(schoolSubmit)
  assert.doesNotMatch(code, /console\.[a-z]+\([^)]*\bentered\b/i, 'the entered password must never be logged')
  assert.doesNotMatch(code, /json\([^)]*\bentered\b/i, 'the entered password must never be echoed')
  assert.doesNotMatch(code, /body\.password[^)\n]*(?:insert|update|upsert)/i)
  // It is read exactly once, into one local.
  assert.equal((code.match(/req\.body\?\.password/g) || []).length, 1)
})

test('S-08: the client sends what it already holds, so nothing new is asked', () => {
  const page = read('src/components/SchoolFormPage.jsx')
  assert.match(page, /password: pwdInput\.trim\(\)/)
  // The coordinator already typed it to get past the access screen.
  assert.ok(page.indexOf('p_entered_password: pwdInput.trim()') > 0)
})

test('S-08: hashing is recorded as the next step, not silently skipped', () => {
  const audit = read('db/audit/public_endpoint_hardening_checks.sql')
  assert.match(audit, /A PLAN, NOT A MIGRATION/)
  assert.match(audit, /DO NOT RUN ANYTHING IN THIS SECTION/)
  assert.match(audit, /pg_get_functiondef/)
  assert.match(audit, /NewCohortModal\.jsx and src\/components\/ManageCohortModal\.jsx/)
  assert.match(schoolSubmit, /STILL OUTSTANDING: cohorts\.school_form_password is plaintext/)
})

test('S-08: the roster cap already exists and still applies', () => {
  // Reported rather than re-fixed: S-06 bounded this at 100.
  assert.match(read('api/lib/fieldLimits.js'), /MAX_STUDENTS_PER_PLACEMENT_REQUEST = 100/)
  assert.match(read('api/lib/schoolPlacementUpsert.js'), /roster\.length > MAX_STUDENTS_PER_PLACEMENT_REQUEST/)
  assert.match(schoolSubmit, /validatePlacementRequestInput\(\{ coordinator, students, availability \}\)/)
})

// ── Nothing legitimate got harder, and nothing leaks ─────────────────────────

test('no endpoint returns a raw database or provider error string', () => {
  for (const f of PUBLIC_ENDPOINTS) {
    const code = strip(read(f))
    assert.doesNotMatch(code, /json\(\{[^}]*error:\s*\w*[Ee]rror\.message/, `${f} may leak a driver message`)
  }
})

test('the throttle runs before the work on every endpoint', () => {
  for (const f of PUBLIC_ENDPOINTS) {
    const code = read(f)
    const limit = code.indexOf('consumePublicRateLimit')
    for (const work of ['lookupStudentByEmail(', 'performSchoolPlacementUpsert(', 'resolveStudentByEmail(']) {
      const at = code.indexOf(work)
      if (at > 0) assert.ok(limit < at, `${f} does work before throttling (${work})`)
    }
  }
})

test('no test fixture in this file carries a real student', () => {
  const self = read('test/publicEndpointHardening.test.mjs')
  assert.doesNotMatch(self, /@cshs\.org|@students\.|cedars-sinai\.edu/i)
  assert.match(self, /203\.0\.113\.9/, 'the only address used is the reserved documentation range')
})

test('house style: no em dash in anything this pass added', () => {
  // — written as an escape so this file contains none either.
  for (const f of ['api/lib/publicRateLimit.js', 'db/audit/public_endpoint_hardening_checks.sql']) {
    assert.doesNotMatch(read(f), /—/, `${f} contains an em dash`)
  }
})

test('ASPIRE is never written as "ASPIRE Program" in the changed files', () => {
  // --diff-filter=d: a file DELETED since the baseline has no content to scan
  // (reading it would ENOENT, failing the test for the wrong reason).
  const changed = execSync('git diff --name-only --diff-filter=d 762adfb -- "*.js" "*.jsx" "*.sql"', { cwd: root, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
  for (const f of changed) {
    assert.doesNotMatch(read(f), /ASPIRE Program/, `${f} uses "ASPIRE Program"`)
  }
})

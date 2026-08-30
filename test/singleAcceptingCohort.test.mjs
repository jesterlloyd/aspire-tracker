// test/singleAcceptingCohort.test.mjs
//
// The single-accepting-cohort invariant.
//
// accepting_submissions is not only an open/closed switch. On every anonymous
// surface it is also the COHORT ROUTER: the server decides which cohort a
// submission belongs to by finding the single row where the flag is true. That
// routing was moved server-side deliberately (S-06, S-07) so a client could no
// longer submit into an arbitrary cohort.
//
// The rule that keeps exactly one such row existed ONLY in the browser. Two
// endpoints then resolved the cohort with `.limit(1).maybeSingle()`, which does
// not refuse an ambiguous state, it silently returns whichever row Postgres
// ordered first. So a broken invariant would have routed a student lookup, and
// a real interview BOOKING, into an arbitrary cohort with no error surfaced.
//
// THE SWEEP IS THE POINT, exactly as in test/cronSecretFailClosed.test.mjs.
// What stops the next endpoint from reintroducing this is not "the resolver
// works", it is "no endpoint resolves the accepting cohort any other way".
//
// Pure source and unit assertions. No network, no database.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// Comments explain the defect and quote the old code, so every source assertion
// runs against comment-stripped text or it would match the explanation itself.
//
// LINE COMMENTS ARE REMOVED FIRST, and the order is load-bearing. src/App.jsx
// line 99 ends a `//` comment with the path "src/components/Header/*". Stripping
// block comments first reads that trailing "/*" as an opener and swallows
// everything up to the next "*/", which is a JSX comment 1100 lines later. That
// silently ate updateCohort and made this file's App.jsx assertions vacuous.
// Removing whole-line comments first deletes the false opener with its line.
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

// Every .js file under api/, recursively.
function apiFiles(dir = 'api') {
  const out = []
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...apiFiles(rel))
    else if (entry.name.endsWith('.js')) out.push(rel)
  }
  return out.sort()
}
const API_FILES = apiFiles()
const RESOLVER = 'api/lib/intakeStudentLookup.js'

// ── The sweep ────────────────────────────────────────────────────────────────

test('invariant: no endpoint resolves the accepting cohort with limit(1)', () => {
  // The exact defect. `.eq('accepting_submissions', true).limit(1)` cannot
  // distinguish "one" from "several"; it just takes the first row it is handed.
  const offenders = API_FILES.filter((f) => {
    const code = strip(read(f))
    if (!/accepting_submissions/.test(code)) return false
    return /accepting_submissions[\s\S]{0,120}?\.limit\(\s*1\s*\)/.test(code)
  })
  assert.deepEqual(offenders, [], 'these endpoints pick an arbitrary accepting cohort')
})

test('invariant: only the shared resolver reads the flag to CHOOSE a cohort', () => {
  // Reading the flag to VALIDATE a cohort the caller already named is fine and
  // is what school-form-submit and school-placement-requests do: they select it
  // alongside an .eq('id', cohortId). Reading it as a filter is how you choose
  // one, and choosing is the resolver's job alone.
  const offenders = API_FILES.filter((f) => {
    if (f === RESOLVER) return false
    const code = strip(read(f))
    return /\.eq\(\s*['"]accepting_submissions['"]\s*,\s*true\s*\)/.test(code)
  })
  assert.deepEqual(offenders, [], 'these endpoints select a cohort by the flag instead of using resolveAcceptingCohort')
})

test('invariant: the sweep actually covers api/, so a broken matcher cannot pass', () => {
  assert.ok(API_FILES.length >= 40, `expected 40+ api files, found ${API_FILES.length}`)
  const usingResolver = API_FILES.filter((f) => /resolveAcceptingCohort/.test(read(f)))
  // The resolver itself plus every caller that routes by the flag.
  assert.ok(usingResolver.length >= 8, `expected 8+ files on the resolver, found ${usingResolver.length}`)
})

// ── The resolver refuses rather than guesses ─────────────────────────────────

test('invariant: resolveAcceptingCohort never picks a row', async () => {
  process.env.EVALUATION_RATE_LIMIT_PEPPER ||= 'test-pepper-not-a-real-value'
  const { resolveAcceptingCohort } = await import('../api/lib/intakeStudentLookup.js')

  // Minimal stub of the one query the resolver makes.
  const db = (rows) => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) }) })

  const none = await resolveAcceptingCohort(db([]))
  assert.equal(none.failure.error, 'not_accepting')
  assert.equal(none.cohortId, undefined, 'a closed state must not yield a cohort')

  const one = await resolveAcceptingCohort(db([{ id: 'c1', name: 'Fall 2026' }]))
  assert.equal(one.cohortId, 'c1')
  assert.equal(one.failure, undefined)

  const many = await resolveAcceptingCohort(db([{ id: 'c1', name: 'Fall 2026' }, { id: 'c2', name: 'Winter 2027' }]))
  assert.equal(many.failure.error, 'ambiguous_cohort')
  assert.equal(many.cohortId, undefined, 'an ambiguous state must not yield a cohort')
})

// ── The two migrated endpoints keep their student-facing contract ────────────

test('invariant: both interview endpoints refuse through the resolver', () => {
  for (const f of ['api/interview-lookup.js', 'api/interview-book.js']) {
    const code = strip(read(f))
    assert.match(code, /const cohortResult = await resolveAcceptingCohort\(db\)/, f)
    assert.match(code, /if \(cohortResult\.failure\)/, f)
  }
})

test('invariant: the interview error stays a human sentence, not a code', () => {
  // InterviewSchedulePage renders `data.error` verbatim to the student
  // (setError(data.error) on lookup, alert(data.error) on booking). Returning
  // the resolver's failure object here would print "ambiguous_cohort" at a
  // student. The two failure modes are deliberately collapsed into one sentence
  // a student can act on, with the distinction kept in the server log.
  for (const f of ['api/interview-lookup.js', 'api/interview-book.js']) {
    const code = strip(read(f))
    assert.match(code, /error: 'Scheduling is not currently open\. Please contact the ASPIRE team\.'/, f)
    assert.doesNotMatch(code, /json\(\s*cohortResult\.failure\s*\)/, f)
    assert.match(code, /console\.warn\([^)]*cohortResult\.failure\.error/, f)
  }
})

// ── The client no longer proceeds past a failed clear ────────────────────────

test('invariant: updateCohort aborts when the clearing write fails', () => {
  const code = strip(read('src/App.jsx'))
  const start = code.indexOf('const updateCohort =')
  assert.ok(start > 0, 'updateCohort not found')
  const body = code.slice(start, start + 2200)

  // The clearing write's result must be captured and acted on.
  assert.match(body, /const \{ error: clearError \} = await safeWrite/)
  const clearAt = body.indexOf('clearError')
  const guardAt = body.indexOf('if (clearError)')
  const targetWriteAt = body.indexOf("supabase.from('cohorts').update(updates)")
  assert.ok(guardAt > clearAt && guardAt > 0, 'the clear result must be checked')
  assert.ok(guardAt < targetWriteAt, 'the check must come BEFORE the flag is set on the target')

  // And the database-level refusal is translated rather than shown raw.
  assert.match(body, /error\.code === '23505'/)
})

// ── The migration says what it must ──────────────────────────────────────────

test('invariant: the migration index is both UNIQUE and PARTIAL', () => {
  const sql = read('supabase/migrations/20260902000000_one_accepting_cohort.sql')
  // Without UNIQUE it constrains nothing. Without the partial WHERE it would
  // also constrain the `false` rows, permitting only one NON-accepting cohort
  // in the whole table, which would break every ordinary cohort edit.
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS cohorts_one_accepting_submissions/)
  assert.match(sql, /WHERE accepting_submissions = true/)
  assert.match(sql, /^BEGIN;$/m)
  assert.match(sql, /^COMMIT;$/m)
  // The rollback must stay inert (commented out), like every other migration here.
  const rollbackAt = sql.indexOf('DROP INDEX IF EXISTS public.cohorts_one_accepting_submissions')
  const commentOpen = sql.lastIndexOf('/*', rollbackAt)
  const commentClose = sql.indexOf('*/', rollbackAt)
  assert.ok(commentOpen > 0 && commentClose > rollbackAt, 'the rollback must be commented out')
})

// ── House style ──────────────────────────────────────────────────────────────

test('invariant: no em dash in anything this change touched', () => {
  // The character below is the em dash, written as an escape so this file has none.
  const EM = String.fromCharCode(0x2014)
  for (const f of [
    'supabase/migrations/20260902000000_one_accepting_cohort.sql',
    'db/audit/one_accepting_cohort_checks.sql',
    'api/interview-lookup.js',
    'api/interview-book.js',
  ]) {
    assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
  }
})

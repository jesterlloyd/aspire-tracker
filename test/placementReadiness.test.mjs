// PLACEMENT-POOL-READINESS-1: the Student Pool defaults to students who can
// actually be placed, while approved pre-interview exceptions stay reachable.
//
// Behavioral on the pure module (every canonical status), structural for the
// wiring. Every requirement carries a negative control.
//
// Run: node --test test/placementReadiness.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const {
  POOL_INELIGIBLE_STATUSES, READY_STATUS, READINESS_MODES, DEFAULT_READINESS_MODE,
  isPoolEligible, isReadyToPlace, needsPlacementException, filterPoolByReadiness, exceptionCount,
} = await import('../src/lib/placementReadiness.js')

const { ASPIRE_STATUSES } = await import('../src/lib/constants.js')

const student = (status, extra = {}) => ({ id: `s-${status}`, status, ...extra })

// ── Every canonical status, in both modes ──────────────────────────────────

test('the canonical taxonomy is exactly what this module reasons about', () => {
  assert.deepEqual(ASPIRE_STATUSES, [
    'Pending Outreach', 'Form Sent', 'Form Received', 'Interview Scheduled',
    'Interviewed', 'Placed', 'Active Rotation', 'Completed', 'Declined', 'Not Proceeding',
  ], 'if this changes, the readiness rules below must be revisited')
  assert.equal(READY_STATUS, 'Interviewed')
})

test('READY mode admits Interviewed only - one row per canonical status', () => {
  const expected = {
    'Pending Outreach':    false,
    'Form Sent':           false,
    'Form Received':       false,
    'Interview Scheduled': false,
    'Interviewed':         true,
    'Placed':              false,
    'Active Rotation':     false,
    'Completed':           false,
    'Declined':            false,
    'Not Proceeding':      false,
  }
  for (const status of ASPIRE_STATUSES) {
    assert.equal(isReadyToPlace(student(status)), expected[status], `${status} ready?`)
  }
})

test('ALL-ELIGIBLE mode admits the pre-interview statuses and never a terminal one', () => {
  const expected = {
    'Pending Outreach':    true,
    'Form Sent':           true,
    'Form Received':       true,
    'Interview Scheduled': true,
    'Interviewed':         true,
    'Placed':              false,
    'Active Rotation':     false,
    'Completed':           false,
    'Declined':            false,
    'Not Proceeding':      false,
  }
  for (const status of ASPIRE_STATUSES) {
    assert.equal(isPoolEligible(student(status)), expected[status], `${status} eligible?`)
  }
})

test('Not Proceeding is excluded from EVERY mode', () => {
  const np = student('Not Proceeding')
  assert.equal(isPoolEligible(np), false)
  assert.equal(isReadyToPlace(np), false)
  assert.equal(needsPlacementException(np), false, 'never offered as an exception either')
  for (const mode of ['ready', 'all', 'anything-else']) {
    assert.deepEqual(filterPoolByReadiness([np], mode), [], `mode ${mode}`)
  }
  assert.ok(POOL_INELIGIBLE_STATUSES.includes('Not Proceeding'))
})

test('a matched student is never in the pool, whatever their status', () => {
  for (const status of ASPIRE_STATUSES) {
    assert.equal(isPoolEligible(student(status, { matched_unit_id: 'u1' })), false, status)
  }
})

test('an unknown or missing status stays VISIBLE in the broader mode (blacklist, not whitelist)', () => {
  for (const odd of [undefined, null, '', 'Some New Status']) {
    const s = student(odd)
    assert.equal(isPoolEligible(s), true, `status ${JSON.stringify(odd)} still eligible`)
    assert.equal(isReadyToPlace(s), false, 'but never READY')
    assert.equal(needsPlacementException(s), true, 'and placing them is an exception')
  }
})

// ── The exception predicate ────────────────────────────────────────────────

test('needsPlacementException marks exactly the eligible-but-not-interviewed', () => {
  assert.equal(needsPlacementException(student('Form Received')), true)
  assert.equal(needsPlacementException(student('Interview Scheduled')), true)
  assert.equal(needsPlacementException(student('Interviewed')), false, 'the normal path is not an exception')
  assert.equal(needsPlacementException(student('Placed')), false, 'already placed is not in the pool')
  assert.equal(needsPlacementException(student('Form Sent', { matched_unit_id: 'u1' })), false)
})

test('filterPoolByReadiness and exceptionCount agree on the same population', () => {
  const roster = [
    student('Interviewed'), student('Interviewed', { id: 'i2' }),
    student('Form Received'), student('Interview Scheduled'),
    student('Not Proceeding'), student('Placed'), student('Completed'),
    student('Interviewed', { id: 'matched', matched_unit_id: 'u1' }),
  ]
  const ready = filterPoolByReadiness(roster, 'ready')
  const all = filterPoolByReadiness(roster, 'all')
  assert.equal(ready.length, 2, 'two unmatched Interviewed')
  assert.equal(all.length, 4, 'plus Form Received and Interview Scheduled')
  assert.equal(exceptionCount(roster), 2, 'exactly the two the default hides')
  assert.equal(all.length - ready.length, exceptionCount(roster))
  // The default is a strict subset - the broader mode never drops anyone.
  for (const s of ready) assert.ok(all.some(a => a.id === s.id))
})

test('an unknown mode fails safe to the READY default', () => {
  const roster = [student('Interviewed'), student('Form Sent')]
  assert.deepEqual(filterPoolByReadiness(roster, 'bogus').map(s => s.status), ['Interviewed'])
  assert.deepEqual(filterPoolByReadiness(roster, undefined).map(s => s.status), ['Interviewed'])
  assert.equal(DEFAULT_READINESS_MODE, 'ready')
})

test('the module is null-safe', () => {
  assert.equal(isPoolEligible(null), false)
  assert.equal(isReadyToPlace(undefined), false)
  assert.equal(needsPlacementException(null), false)
  assert.deepEqual(filterPoolByReadiness(null, 'all'), [])
  assert.equal(exceptionCount(undefined), 0)
})

// ── READY mode matches the placement guard exactly ─────────────────────────

test("READY is precisely the set createMatch accepts - no student bounces on a toast", () => {
  const app = read('src/App.jsx')
  assert.match(app, /const needsException = !\['Interviewed', 'Placed'\]\.includes\(student\.status\)/,
    'the guard still requires Interviewed (or an already-Placed student)')
  // Every READY student passes that guard; nobody else does (a Placed student
  // is by definition not in the pool).
  for (const status of ASPIRE_STATUSES) {
    const guardAccepts = ['Interviewed', 'Placed'].includes(status)
    const ready = isReadyToPlace(student(status))
    if (ready) assert.ok(guardAccepts, `${status} is READY so the guard must accept it`)
  }
})

// ── The exception path ─────────────────────────────────────────────────────

test('placing a non-interviewed student requires explicit confirmation first', () => {
  const tab = strip(read('src/components/MatchingTab.jsx'))
  // The slot click DIVERTS to a confirmation instead of matching.
  assert.match(tab, /if \(needsPlacementException\(selectedStudent\)\) \{\s*\n?\s*setExceptionPlacement\(\{ student: selectedStudent, unit \}\)\s*\n?\s*return/)
  // Only the confirm button commits, and it is the ONLY place that passes true.
  assert.match(tab, /commitPlacement\(student, unit, true\)/)
  assert.match(tab, /commitPlacement\(selectedStudent, unit, false\)/)
  assert.equal((tab.match(/commitPlacement\([^)]*true\)/g) || []).length, 1,
    'exactly one confirmed-exception commit site')
  assert.match(tab, /data-testid="placement-exception-dialog"/)
  assert.match(tab, /data-testid="placement-exception-confirm"/)
  // NEGATIVE CONTROL: the old unconditional match call must be gone.
  assert.doesNotMatch(tab, /onMatch\(selectedStudent, unit\)\s*\n\s*setSelectedStudent\(null\)/,
    'the slot click can no longer place directly')
})

test('createMatch honours the confirmed exception and records it, without weakening the rule', () => {
  // NOTE: read RAW. App.jsx contains a '/*' sequence inside a literal, so a
  // block-comment stripper would swallow real code here. The patterns below are
  // executable statements that a comment could not satisfy.
  const app = read('src/App.jsx')
  // Strictly true, never a truthy accident, and scoped to students who
  // actually need an exception (see placementExceptionPath.test.mjs, which
  // proves the behavior rather than the spelling).
  assert.match(app, /const isApprovedException = needsException && options\.placementException === true/,
    'strictly true - never a truthy accident')
  // Without the flag the guard still refuses.
  assert.match(app, /if \(needsException && !isApprovedException\) \{[\s\S]{0,260}Interview required/)
  // With it, the placement is recorded in the existing activity log.
  assert.match(app, /actionType: 'placement_exception_confirmed'/)
  assert.match(app, /const statusAtPlacement = student\.status \|\| null/,
    'the original status is captured before any write')
  assert.match(app, /status_at_placement: statusAtPlacement/)
  assert.match(app, /userProfile: currentUserProfile/, 'attributed to the acting staff member')
  // NEGATIVE CONTROL: the exception must never be inferred from anything else.
  // Code lines only - the explanatory comment names those very words.
  const guardBlock = app.slice(app.indexOf('const createMatch'), app.indexOf('const match_quality'))
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(guardBlock, /unit_preference|slots_remaining|total_slots|ngrp_hired|employment/,
    'no preference, slot, or employment signal can grant an exception')
  // The flag reaches createMatch ONLY from the confirmed dialog.
  const tab = read('src/components/MatchingTab.jsx')
  assert.match(tab, /onMatch\(student, unit, \{ placementException: isException \}\)/)
})

// ── The UI wiring ──────────────────────────────────────────────────────────

test('readiness is a FILTER, separate from the existing sort, defaulting to Ready to place', () => {
  const tab = read('src/components/MatchingTab.jsx')
  assert.match(tab, /data-testid="pool-readiness"/)
  assert.match(tab, /useState\(DEFAULT_READINESS_MODE\)/)
  assert.match(tab, /aria-label="Placement readiness"/)
  // The sort control still exists, untouched and independent.
  assert.match(tab, /aria-label="Sort students"/)
  assert.match(tab, /value=\{poolSort\}/)
  for (const opt of ['last_name_asc', 'last_name_desc', 'school_asc', 'gpa_desc', 'score_desc', 'status']) {
    assert.ok(tab.includes(`"${opt}"`), `sort option ${opt} preserved`)
  }
  assert.deepEqual(READINESS_MODES.map(m => m.value), ['ready', 'all'])
})

test('a cohort switch resets to the safe default and drops any pending exception', () => {
  const tab = read('src/components/MatchingTab.jsx')
  assert.match(tab, /if \(cohortId !== readinessCohort\) \{\s*\n?\s*setReadinessCohort\(cohortId\)\s*\n?\s*setReadiness\(DEFAULT_READINESS_MODE\)\s*\n?\s*setExceptionPlacement\(null\)/)
  // NEGATIVE CONTROL: without this, the broader view would persist across
  // cohorts - MatchingTab is never unmounted or re-keyed on a cohort switch.
  const rotationTab = read('src/components/RotationTab.jsx')
  assert.doesNotMatch(rotationTab, /<MatchingTab[^>]*key=/, 'the component is not remounted per cohort')
})

test('non-interviewed students are clearly labelled, and only in the broader mode', () => {
  const tab = read('src/components/MatchingTab.jsx')
  assert.match(tab, /needsException=\{needsPlacementException\(s\)\}/)
  const card = read('src/components/StudentMatchingCard.jsx')
  assert.match(card, /data-testid="card-not-interviewed"/)
  assert.match(card, /Not interviewed · exception required/)
  assert.match(card, /needsException = false/, 'defaults off, so no other caller shows it')
  // In READY mode nothing is labelled, because nothing there needs an exception.
  assert.equal(filterPoolByReadiness([student('Form Sent')], 'ready').length, 0)

  // REGRESSION (found in fixture QC, not by the tests above). The label was
  // first placed inside the `focusedUnit &&` block, which renders the
  // tier/shift chips only once a unit is selected. The warning then vanished
  // in exactly the state staff browse the pool in - no unit picked - so an
  // un-interviewed student looked ordinary. The label must sit OUTSIDE that
  // block. Proven positionally: it must appear before the block opens.
  const labelAt = card.indexOf('data-testid="card-not-interviewed"')
  const unitGateAt = card.indexOf('{focusedUnit && (')
  assert.ok(labelAt > -1 && unitGateAt > -1, 'both anchors still exist')
  assert.ok(
    labelAt < unitGateAt,
    'the exception label must render outside (before) the focusedUnit-only block, ' +
    'so it does not depend on a unit being selected',
  )
})

test('the default never hides students silently, and preserves the existing pool mechanics', () => {
  const tab = read('src/components/MatchingTab.jsx')
  // The count line names what the default is holding back.
  assert.match(tab, /data-testid="pool-hidden-note"/)
  assert.match(tab, /not yet interviewed/)
  // "All students matched" is measured against EVERY eligible student, so an
  // empty ready-list cannot masquerade as a finished cohort.
  assert.match(tab, /eligibleAll\.length === 0/)
  // Preserved: school filter, search, preference tier sort, selection stepper.
  assert.match(tab, /setPoolSchool\(e\.target\.value\)/)
  assert.match(tab, /setPoolSearch\(e\.target\.value\)/)
  assert.match(tab, /const tierOf = \(student\) =>/)
  assert.match(tab, /a\.tier - b\.tier \|\| a\.i - b\.i/, 'preference ranking untouched')
  assert.match(tab, /selectedIndex \+ 1\} of \$\{sortedPool\.length/, 'stepper preserved')
})

test('the interview-to-placement handoff cannot select a student the pool excludes', () => {
  const tab = read('src/components/MatchingTab.jsx')
  assert.match(tab, /if \(s && isPoolEligible\(s\)\) setSelectedStudent\(s\)/)
})

// ── No migration was required ──────────────────────────────────────────────

test('NO schema change: the exception is a per-action decision on existing tables', () => {
  const app = read('src/App.jsx')
  // It is recorded through the pre-existing activity log helper.
  assert.match(app, /import \{ logActivity \} from '\.\/lib\/logActivity'/)
  // Nothing in this feature introduces a migration or a new table.
  const readinessCode = read('src/lib/placementReadiness.js')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(readinessCode, /supabase|\.insert\(|\.update\(|fetch\(/i,
    'the rule module is pure - no I/O of any kind')
  assert.doesNotMatch(readinessCode, /useState|useEffect/, 'and has no React coupling')
})

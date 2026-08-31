// test/scopePicker.test.mjs
//
// SCOPE-PICKER-1: the merged header Scope control.
//
// The Experience pill and the Cohort pill became one. Three things about that are easy
// to undo by accident and are pinned here:
//
//   1. THE FETCH POSTURE. Residency cycles are fetched only inside the residency
//      workspace by an authorized caller (NGRP-WORKSPACE-1). A merged picker is exactly
//      the kind of change that would quietly start loading them everywhere, to render a
//      list the user is not looking at.
//   2. TRUTHFUL COHORT STATES. Loading, unprovisioned, failed, stale and genuinely
//      empty are five different facts, and none of them is a chosen cohort. The pill and
//      the pane now both read one module, so they cannot drift apart about which is true.
//   3. PER-USER SCOPE. The ASPIRE cohort pick moved off a browser-global key onto a
//      per-user one, so a shared workstation stops leaking the previous person's cohort.
//
// Functional tests for the label module, source assertions for the wiring.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  residencyCohortLabel, residencyCohortLive, residencyLabelIsState,
  residencyUnavailable, scopePillValue,
} from '../src/lib/scopePickerLabels.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const exists = (p) => existsSync(join(root, p))

// Line comments first, then block comments: a trailing "/*" inside a line comment
// otherwise opens a false block and swallows the rest of the file.
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const HEADER = 'src/components/Header/Header.jsx'
const SCOPE = 'src/components/Header/scope/ScopePicker.jsx'
const INT_LIST = 'src/components/Header/scope/InternshipCohortList.jsx'
const RES_LIST = 'src/components/Header/scope/ResidencyCohortList.jsx'
const APP = 'src/App.jsx'

// ── 1. The label module, functionally ────────────────────────────────────────

test('every residency cohort state is distinct, and none reads as a chosen cohort', () => {
  const cycle = { id: 'c1', name: 'January 2027', status: 'Application Open' }
  assert.equal(residencyCohortLabel({ status: 'loading', cycles: [] }), 'Loading cohorts…')
  // The three failure shapes all say "unavailable", never "none configured".
  for (const status of ['unprovisioned', 'error', 'stale']) {
    assert.equal(residencyCohortLabel({ status, cycles: [] }), 'Cohorts unavailable', status)
    assert.equal(residencyUnavailable(status), true, status)
  }
  // Genuinely empty is its own fact and must not be confused with a failure.
  assert.equal(residencyCohortLabel({ status: 'ready', cycles: [] }), 'No cohorts configured')
  assert.equal(residencyUnavailable('ready'), false)
  // Ready with cycles but nothing selected still refuses to invent one.
  assert.equal(residencyCohortLabel({ status: 'ready', cycles: [cycle], activeCycle: null }), 'Select cohort')
  assert.equal(residencyCohortLabel({ status: 'ready', cycles: [cycle], activeCycle: cycle }), 'January 2027')
})

test('a failure never shows a live dot, and every non-choice label is dimmed', () => {
  assert.equal(residencyCohortLive({ status: 'Application Open' }), true)
  assert.equal(residencyCohortLive({ status: 'Residency Active' }), true)
  assert.equal(residencyCohortLive({ status: 'Completed' }), false)
  assert.equal(residencyCohortLive(null), false, 'no cycle is never live')
  for (const s of [{ status: 'loading' }, { status: 'error' }, { status: 'ready', cycles: [] }]) {
    assert.equal(residencyLabelIsState(s), true, JSON.stringify(s))
  }
  assert.equal(residencyLabelIsState({ status: 'ready', cycles: [{ id: 'x' }] }), false)
})

test('the pill omits the experience name when there is only one experience', () => {
  assert.equal(scopePillValue({ experienceLabel: 'Internship', cohortLabel: 'Fall 2026', multiExperience: true }),
    'Internship · Fall 2026')
  // A caller without residency access has no second term to contrast with.
  assert.equal(scopePillValue({ experienceLabel: 'Internship', cohortLabel: 'Fall 2026', multiExperience: false }),
    'Fall 2026')
  assert.equal(scopePillValue({ experienceLabel: 'Internship', cohortLabel: '', multiExperience: false }),
    'Select cohort', 'never renders an empty scope')
})

// ── 2. One control, and the old three are gone ───────────────────────────────

test('the two pills became one, and the superseded components are retired', () => {
  for (const f of [
    'src/components/Header/CohortPicker.jsx',
    'src/components/Header/ExperiencePicker.jsx',
    'src/components/Header/ResidencyCohortPicker.jsx',
  ]) {
    assert.equal(exists(f), false, `${f} should be retired`)
  }
  const header = read(HEADER)
  assert.equal((header.match(/<ScopePicker/g) || []).length, 1, 'exactly one scope control')
  assert.match(header, /import ScopePicker from '\.\/scope\/ScopePicker'/)
})

// ── 3. The fetch posture is unchanged ────────────────────────────────────────

test('the picker never loads the other experience’s cohorts', () => {
  // Because choosing an experience navigates immediately, the cohort pane only ever
  // lists where the user already is. There is no preview, so nothing needs fetching
  // for an experience the user is not in.
  const app = read(APP)
  assert.match(app, /useNgrpCycles\(\{ enabled: ngrpAllowed && activeTab === 'ngrp' \}\)/,
    'residency cycles stay gated to the residency workspace')
  assert.match(app, /residencyCohort=\{ngrpAllowed && activeTab === 'ngrp' \?/)
  // The shell itself is presentational: it fetches nothing and knows no NGRP.
  const scope = strip(read(SCOPE))
  assert.doesNotMatch(scope, /supabase|useQuery|fetch\(/)
  assert.doesNotMatch(scope, /ngrp|Ngrp/i)
})

test('the experience choice commits immediately, as the old pill did', () => {
  const scope = read(SCOPE)
  assert.match(scope, /onClick=\{\(\) => \{ if \(!isSel\) onSwitchExperience\(x\.id\); closeAndRefocus\(\) \}\}/)
  // App still navigates and restores that experience's own last tab.
  const app = read(APP)
  const sw = app.slice(app.indexOf('const switchExperience'), app.indexOf('const ngrpSubTab'))
  assert.match(sw, /navigate\(`\/ngrp\//)
  assert.match(sw, /lastNgrpTabKey\(user\.id\)/)
})

// ── 4. Per-user cohort scope ─────────────────────────────────────────────────

test('the ASPIRE cohort pick is per user, and the leaky global key is not adopted', () => {
  const app = read(APP)
  assert.match(app, /const aspireCohortKey = \(userId\) => `aspire:activeCohort:\$\{userId\}`/)
  // Every read and write goes through the per-user key.
  const code = strip(app)
  assert.doesNotMatch(code, /localStorage\.(get|set)Item\('aspire_active_cohort_id'/)
  assert.match(code, /localStorage\.getItem\(aspireCohortKey\(user\.id\)\)/)
  assert.equal((code.match(/localStorage\.setItem\(aspireCohortKey\(user\.id\)/g) || []).length, 2,
    'both the create-cohort and switch-cohort writes')
  // The old value is removed, never carried across: adopting it would preserve exactly
  // the cross-account leak the per-user key exists to stop.
  assert.match(code, /localStorage\.removeItem\(LEGACY_COHORT_KEY\)/)
  assert.doesNotMatch(code, /setItem\([^)]*LEGACY_COHORT_KEY/)
  // Restore waits for the authenticated user, or a saved pick would be skipped and the
  // guard above would stop the effect ever running again.
  assert.match(code, /if \(!user\?\.id\) return\s*\n\s*let saved = null/)
})

test('App no longer owns the cohort dropdown state the picker took over', () => {
  const code = strip(read(APP))
  for (const gone of ['cohortOpen', 'setCohortOpen', 'cohortPickerRef']) {
    assert.doesNotMatch(code, new RegExp(gone), `${gone} must not survive in App`)
  }
  // The search dropdown's own click-outside is untouched.
  assert.match(code, /searchAreaRef\.current && !searchAreaRef\.current\.contains\(e\.target\)/)
})

// ── 5. Behavior carried across from the retired pickers ──────────────────────

test('cohort administration belongs to the Internship pane only', () => {
  // Residency cohorts are created in Planning, not from the header, so Edit/New must
  // not appear beside a residency cohort list.
  const intList = read(INT_LIST)
  assert.match(intList, /\+ New Cohort/)
  assert.match(intList, /Edit Cohort/)
  assert.match(intList, /canEdit &&/, 'still permission-gated')
  const resList = read(RES_LIST)
  assert.doesNotMatch(resList, /New Cohort|Edit Cohort/)
})

test('both cohort lists are keyboard-reachable option buttons', () => {
  // The ASPIRE rows were plain divs with onClick before this change: reachable by
  // mouse only. Merging the pickers was the moment to bring them level.
  for (const f of [INT_LIST, RES_LIST]) {
    assert.match(read(f), /type="button"\s+role="option"/, f)
  }
})

test('the onboarding tour points at the control that now exists', () => {
  const tours = read('src/lib/onboardingTours.js')
  assert.match(tours, /target: '\[data-tour="scope-switcher"\]'/)
  assert.doesNotMatch(tours, /data-tour="cohort-switcher"/)
  assert.match(read(SCOPE), /data-tour="scope-switcher"/)
  // One version for every role: residency access is a capability, not a role, so the
  // copy must be true for a privileged user who does not hold it.
  assert.match(tours, /If your access includes the Residency experience/)
})

// ── 6. Season marks and program naming ───────────────────────────────────────

test('seasonOf reads only what the name actually states', async () => {
  const { seasonOf } = await import('../src/lib/cohortSeason.js')
  assert.equal(seasonOf('Summer 2026'), 'summer')
  assert.equal(seasonOf('Fall 2026'), 'fall')
  assert.equal(seasonOf('Winter 2027'), 'winter')
  assert.equal(seasonOf('Spring 2027'), 'spring')
  assert.equal(seasonOf('Autumn 2026'), 'fall', 'same season, other word')
  // Real shapes in this program: a term split still names one season.
  assert.equal(seasonOf('Fall II 2026'), 'fall')
  assert.equal(seasonOf('fall 2026'), 'fall', 'case insensitive')
  // Ambiguous or absent: no icon rather than a guess dressed as a fact.
  assert.equal(seasonOf('Summer/Fall 2026'), null, 'two seasons is a coin flip')
  assert.equal(seasonOf('January 2027'), null, 'a month is not a season')
  assert.equal(seasonOf('Pilot cohort'), null)
  assert.equal(seasonOf(''), null)
  assert.equal(seasonOf(null), null)
  assert.equal(seasonOf(undefined), null)
  // Never matches inside another word.
  assert.equal(seasonOf('Springfield 2027'), null)
  assert.equal(seasonOf('Winterbourne 2027'), null)
})

test('the season mark is decoration: monochrome, aligned, and never announced', () => {
  const src = read(INT_LIST)
  // One muted color, so it cannot compete with the status pill or the Accepting badge,
  // which are the two things in the row that carry actual state.
  assert.match(src, /color: '#9ca3af'/)
  assert.match(src, /aria-hidden="true"/)
  // Fixed-width slot so a season-less name does not rag the left edge.
  assert.match(src, /width: 15, flexShrink: 0/)
  assert.match(src, /\{Icon \? <Icon size=\{13\} strokeWidth=\{2\} \/> : null\}/)
  // Residency names are months, so that list must not derive a season from them.
  assert.doesNotMatch(read(RES_LIST), /seasonOf|SeasonMark/)
})

test('the residency program is named the one way the app names it everywhere', () => {
  // src/public-site/publicContent.js states the rule: the formal name is always
  // "New Graduate RN Residency Program". A second spelling in the header would be a
  // second name for the same program.
  const header = read(HEADER)
  assert.match(header, /sub: 'New Graduate RN Residency Program \(NGRP\)'/)
  assert.match(header, /sub: 'Senior Clinical Rotation'/)
  assert.doesNotMatch(header, /New Graduate-RN|New-graduate/)
})

// ── House style ──────────────────────────────────────────────────────────────

test('no em dash in anything this change added', () => {
  // The character below is the em dash, written as an escape so this file has none.
  const EM = String.fromCharCode(0x2014)
  for (const f of [SCOPE, INT_LIST, RES_LIST, HEADER, 'src/lib/scopePickerLabels.js', 'src/lib/cohortSeason.js']) {
    assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
  }
})

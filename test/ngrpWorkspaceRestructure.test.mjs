// NGRP-WORKSPACE-2: the Residency workspace restructure.
//
// Six tabs became five, A / S / PI / R / E, matching how the Internship nav
// already spells the mnemonic with multi-letter chips (A / SP / I / R / E).
// Two tabs gained sub-tabs. Nothing was rewritten: Planning became At a Glance
// and Applicants became Profiles & Interest, both moved intact.
//
// THE THING MOST WORTH GUARDING IS THAT NOBODY LANDS ON A DEAD ROUTE. The old
// ids are live URLs people have bookmarked and are also sitting in every
// browser's saved last-tab key, so every one of them has to resolve forward.
//
// Run: node --test test/ngrpWorkspaceRestructure.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  NGRP_TABS, LEGACY_NGRP_TABS, resolveNgrpPath, resolveNgrpEntryPath,
  ngrpPath, ngrpSubTabs, defaultSubTab, isNgrpSubTabId, canonicalNgrpTab,
} from '../src/lib/ngrp/ngrpTabs.js'
import { initialActivityMonth } from '../src/lib/ngrp/ngrpActivity.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const workspace = read('src/components/ngrp/NgrpWorkspace.jsx')
const glance = read('src/components/ngrp/AtAGlanceTab.jsx')
const profiles = read('src/components/ngrp/ProfilesTab.jsx')
const activity = read('src/components/ngrp/ActivityCalendar.jsx')

// ── Structure ────────────────────────────────────────────────────────────────

test('five tabs, and the chips still spell ASPIRE', () => {
  assert.deepEqual(NGRP_TABS.map(t => t.id), ['overview', 'support', 'profiles', 'residency', 'evaluation'])
  assert.deepEqual(NGRP_TABS.map(t => t.chip), ['A', 'S', 'PI', 'R', 'E'])
  assert.equal(NGRP_TABS.map(t => t.chip).join(''), 'ASPIRE')
  assert.deepEqual(NGRP_TABS.map(t => t.label), [
    'At a Glance', 'Support', 'Profiles & Interest', 'Residency', 'Evaluation',
  ])
})

test('only Support and Residency carry sub-tabs, and each has a default', () => {
  assert.deepEqual(ngrpSubTabs('support').map(s => s.id), ['before', 'after'])
  assert.deepEqual(ngrpSubTabs('residency').map(s => s.id), ['board', 'activity'])
  for (const id of ['overview', 'profiles', 'evaluation']) {
    assert.deepEqual(ngrpSubTabs(id), [], `${id} has none`)
    assert.equal(defaultSubTab(id), null)
    assert.equal(ngrpPath(id), `/ngrp/${id}`, 'and its path carries no second segment')
  }
  assert.equal(defaultSubTab('support'), 'before')
  assert.equal(ngrpPath('residency'), '/ngrp/residency/board')
  assert.ok(isNgrpSubTabId('residency', 'activity'))
  assert.ok(!isNgrpSubTabId('residency', 'before'), 'a sub-tab belongs to ONE tab')
})

// ── Nobody lands on a dead route ─────────────────────────────────────────────

test('every retired tab id resolves forward, to a live tab', () => {
  assert.deepEqual(LEGACY_NGRP_TABS, {
    applicants: 'profiles',   // the roster moved there, intact
    planning: 'overview',     // its operating picture IS At a Glance
    interviews: 'residency',  // interviews are recorded beside placement now
  })
  for (const [old, live] of Object.entries(LEGACY_NGRP_TABS)) {
    assert.ok(NGRP_TABS.some(t => t.id === live), `${old} -> ${live} is a live tab`)
    assert.equal(canonicalNgrpTab(old), live)
    const r = resolveNgrpPath(`/ngrp/${old}`)
    assert.equal(r.tab, live)
    assert.equal(r.redirect, ngrpPath(live), `${old} redirects to a canonical path`)
  }
  // A retired id sitting in the saved last-tab key resolves too - that is the
  // half a URL redirect alone would miss.
  assert.equal(resolveNgrpEntryPath('applicants'), '/ngrp/profiles')
  assert.equal(resolveNgrpEntryPath('planning'), '/ngrp/overview')
  assert.equal(resolveNgrpEntryPath('interviews'), '/ngrp/residency/board')
})

test('a bare, unknown, or mismatched path is corrected rather than rendered', () => {
  const cases = [
    ['/ngrp', '/ngrp/overview'],
    ['/ngrp/bogus', '/ngrp/overview'],
    ['/ngrp/support', '/ngrp/support/before'],
    ['/ngrp/support/nope', '/ngrp/support/before'],
    ['/ngrp/residency', '/ngrp/residency/board'],
    // A sub-tab from the WRONG tab is not silently honoured.
    ['/ngrp/support/activity', '/ngrp/support/before'],
    // A tab with no sub-tabs drops a trailing segment.
    ['/ngrp/profiles/anything', '/ngrp/profiles'],
  ]
  for (const [from, to] of cases) assert.equal(resolveNgrpPath(from).redirect, to, from)
  // A canonical path is left alone, or the effect would loop.
  for (const p of ['/ngrp/overview', '/ngrp/profiles', '/ngrp/support/after', '/ngrp/residency/activity', '/ngrp/evaluation']) {
    assert.equal(resolveNgrpPath(p).redirect, null, p)
  }
})

test('the shell redirects exactly once, from the one resolver', () => {
  assert.match(workspace, /const \{ tab, subTab, redirect \} = resolveNgrpPath\(location\.pathname\)/)
  assert.match(workspace, /if \(redirect\) navigate\(redirect, \{ replace: true \}\)/)
  // No second, hand-rolled routing rule survives beside it.
  assert.doesNotMatch(workspace, /navigate\('\/ngrp\//)
  assert.doesNotMatch(workspace, /NGRP_TABS\.some/)
})

// ── The moves were moves ─────────────────────────────────────────────────────

test('At a Glance and Profiles are the old tabs, renamed, not rewritten', () => {
  // The operating picture that was Planning: same four sections, same one way
  // out to the settings modal.
  assert.match(glance, /export default function AtAGlanceTab/)
  for (const section of ['Cohort timeline', 'Pipeline', 'Seats', 'Scope and rules']) {
    assert.match(glance, new RegExp(`title="${section}"`), section)
  }
  assert.match(glance, /onEditCohort/)
  assert.doesNotMatch(glance, /postNgrpManage/, 'still read-only')

  // The roster that was Applicants, carrying both halves of its new name.
  assert.match(profiles, /export default function ProfilesTab/)
  assert.match(profiles, /deriveApplicantRows/)
  assert.match(profiles, /KPI_DEFS/)
  assert.match(workspace, /<ProfilesTab cycle=\{cycle\} canManage=\{canManage\} toast=\{toast\} \/>/)
})

test('At a Glance opens with the same masthead every other home uses', () => {
  assert.match(glance, /import GreetingMasthead from '\.\.\/masthead\/GreetingMasthead'/)
  assert.match(glance, /contextLabel=\{serverCycle\.name\}/, 'named by the residency cohort, not an ASPIRE one')
  // The masthead's milestone is the timeline's own "next", so the card and the
  // list beneath it cannot name different things.
  assert.match(glance, /const nextMilestone = timeline\.find\(i => i\.isNext\)/)
  assert.match(glance, /mastheadMilestone/)
})

// ── Activity ─────────────────────────────────────────────────────────────────

test('Activity is a third caller of the shared calendar, not a third calendar', () => {
  for (const part of [
    'CanonicalCalendarLayout', 'CanonicalCalendarNav', 'CanonicalWeekdayHeader',
    'CanonicalMonthCell', 'CanonicalActivityChip', 'CanonicalCalendarTodayPanel',
  ]) {
    assert.match(activity, new RegExp(part), part)
  }
  // Same gated endpoint and same modal every other event surface uses, so an
  // NGRP workshop added here is an ASPIRE event like any other.
  assert.match(activity, /'\/api\/aspire-events'/)
  assert.match(activity, /action: 'list'/)
  assert.match(activity, /import AspireEventModal from '\.\.\/AspireEventModal'/)
  assert.doesNotMatch(activity, /FullCalendar/, 'no second calendar library')
  // Adding an event is gated on the same manage capability as everything else.
  assert.match(activity, /\{canManage && \(/)
})

test('the activity calendar opens on the cohort year, not on today', () => {
  // A cohort whose applications open in August should not land the reader in
  // whatever month they happen to be reading in.
  assert.deepEqual(initialActivityMonth({ application_open_date: '2026-08-15' }, '2027-03-02'), { year: 2026, month: 7 })
  // Date-only strings are split, never parsed through Date, so the first of a
  // month does not slide into the previous one west of Greenwich.
  assert.deepEqual(initialActivityMonth({ application_open_date: '2026-01-01' }, '2026-06-01'), { year: 2026, month: 0 })
  // No open date set, or a malformed one, falls back to the current month.
  assert.deepEqual(initialActivityMonth({}, '2026-06-15'), { year: 2026, month: 5 })
  assert.deepEqual(initialActivityMonth({ application_open_date: 'TBD' }, '2026-06-15'), { year: 2026, month: 5 })
})

// ── Unbuilt surfaces are honest ──────────────────────────────────────────────

test('a surface that does not exist yet says so, and is never an empty success', () => {
  for (const id of ['support/before', 'support/after', 'residency/board', 'evaluation']) {
    assert.match(workspace, new RegExp(`'${id}':|^  ${id}:`, 'm'), id)
  }
  assert.match(workspace, /This surface ships after the workspace restructure/)
  // The placement board's card says where interviews and hires will be recorded,
  // which is the question the retired Interviews tab used to answer.
  const board = workspace.slice(workspace.indexOf("'residency/board'"), workspace.indexOf('evaluation:'))
  assert.match(board, /who was interviewed and who was hired/)
  // At a Glance stays reachable with no cohorts, because it is where the first
  // one is set up; every other tab explains the requirement.
  assert.match(workspace, /cyclesCount === 0 && tab !== 'overview'/)
})

test('no em dash in anything this change added', () => {
  for (const f of [
    'src/lib/ngrp/ngrpTabs.js', 'src/lib/ngrp/ngrpActivity.js',
    'src/components/ngrp/NgrpWorkspace.jsx', 'src/components/ngrp/NgrpNav.jsx',
    'src/components/ngrp/ActivityCalendar.jsx',
  ]) {
    assert.doesNotMatch(read(f), /—/, `${f} must not contain an em dash`)
  }
})

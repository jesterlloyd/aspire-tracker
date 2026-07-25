// Commit 2: Owner/Admin Review & Release console. Pure availability/gating logic tests plus
// source guards for the console component and its placement in the staff Evaluation Dashboard.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  availableActions, rowIsReadOnly, isEligibleNow, ACTION_API, ACTION_STATUS_MESSAGE,
} from '../src/lib/unitEvaluationReleaseActions.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const NOW = Date.parse('2026-07-20T00:00:00Z')
const PAST = '2026-07-01T00:00:00Z'      // eligible (before NOW)
const FUTURE = '2026-08-01T00:00:00Z'    // not yet eligible (after NOW)
const base = {
  response_id: 'r1', instrument_slug: 'student_preceptor_eval', timepoint: 'post_rotation',
  unit_key: '6 NE', evaluated_preceptor: 'A. Preceptor', rotation_end: '2026-06-24',
  eligible_at: PAST, snapshot_source: 'submission_trigger',
  moderation_state: 'pending', release_state: 'pending',
}
const row = (o) => ({ ...base, ...o })

// ── read-only rules ───────────────────────────────────────────────────────────
test('legacy (unverified) rows are read-only', () => {
  assert.equal(rowIsReadOnly(row({ snapshot_source: 'backfill_unverified' })), true)
  assert.deepEqual(availableActions(row({ snapshot_source: 'backfill_unverified' }), NOW), [])
})
test('ineligible / missing-preceptor / unknown-eligibility rows are read-only', () => {
  assert.equal(rowIsReadOnly(row({ release_state: 'ineligible' })), true)
  assert.equal(rowIsReadOnly(row({ evaluated_preceptor: null })), true)
  assert.equal(rowIsReadOnly(row({ eligible_at: null })), true)
})

// ── action availability ───────────────────────────────────────────────────────
test('a pending, eligible row offers moderation but not release until cleared', () => {
  const a = availableActions(row({ moderation_state: 'pending' }), NOW)
  assert.ok(a.includes('moderate_cleared'))
  assert.ok(a.includes('moderate_blocked'))
  assert.ok(!a.includes('release'))
})
test('release is offered only when cleared AND eligible', () => {
  assert.ok(availableActions(row({ moderation_state: 'cleared', release_state: 'moderated', eligible_at: PAST }), NOW).includes('release'))
  assert.ok(!availableActions(row({ moderation_state: 'cleared', release_state: 'moderated', eligible_at: FUTURE }), NOW).includes('release'))
  assert.ok(!availableActions(row({ moderation_state: 'blocked', release_state: 'moderated', eligible_at: PAST }), NOW).includes('release'))
})
test('released rows can be revoked; revoked rows can only be re-released (explicit)', () => {
  const rel = availableActions(row({ moderation_state: 'cleared', release_state: 'released' }), NOW)
  assert.ok(rel.includes('revoke'))
  assert.ok(!rel.includes('release'))
  const rev = availableActions(row({ moderation_state: 'cleared', release_state: 'revoked' }), NOW)
  assert.ok(rev.includes('rerelease'))
  assert.ok(!rev.includes('release'))
})
test('isEligibleNow honors the eligibility timestamp', () => {
  assert.equal(isEligibleNow(row({ eligible_at: PAST }), NOW), true)
  assert.equal(isEligibleNow(row({ eligible_at: FUTURE }), NOW), false)
  assert.equal(isEligibleNow(row({ eligible_at: null }), NOW), false)
})
test('destructive actions require confirmation; clear does not', () => {
  assert.equal(ACTION_API.moderate_cleared.confirm, false)
  assert.equal(ACTION_API.moderate_blocked.confirm, true)
  assert.equal(ACTION_API.release.confirm, true)
  assert.equal(ACTION_API.revoke.confirm, true)
  assert.equal(ACTION_API.rerelease.confirm, true)
})
test('every server refusal status has a message', () => {
  for (const s of ['success', 'no_change', 'not_authorized', 'not_found', 'invalid_decision',
    'already_released', 'already_revoked', 'not_revoked', 'not_releasable_state',
    'revoked_requires_explicit_rerelease', 'snapshot_unverified', 'snapshot_incomplete',
    'not_yet_eligible', 'not_moderated']) {
    assert.ok(ACTION_STATUS_MESSAGE[s], `message for ${s}`)
  }
})

// ── source guards ──────────────────────────────────────────────────────────────
test('the console calls the review API, refreshes after actions, and shows exact status', () => {
  const c = read('src/components/evaluation/UnitEvaluationReleaseConsole.jsx')
  assert.match(c, /getReviewQueue/)
  assert.match(c, /postReleaseAction/)
  assert.match(c, /ACTION_STATUS_MESSAGE\[status\]/)      // exact server refusal surfaced
  assert.match(c, /if \(res\.ok\) reload\(\)/)             // refresh only the queue after an action
  assert.match(c, /reqId/)                                 // stale-response protection
  // Duplicate submission prevention.
  assert.match(c, /if \(busy\) return/)
  // Must NOT claim anonymity.
  assert.ok(!/fully anonymous|guaranteed anonymous|unidentifiable/i.test(c))
  assert.match(c, /not anonymous/i)
})
test('the Review & Release tab renders the console, gated Owner/Admin, without dropping automation', () => {
  const tab = read('src/components/EvaluationTab.jsx')
  assert.match(tab, /import UnitEvaluationReleaseConsole/)
  assert.match(tab, /activeSubTab === 'automation' && \(isOwner \|\| isAdmin\)[\s\S]*?<UnitEvaluationReleaseConsole \/>[\s\S]*?<SurveyAutomationDashboard/)
  // The Responses tab and its viewer dispatch are unchanged (still present).
  assert.match(tab, /activeSubTab === 'cohort'/)
  assert.match(tab, /EvaluationResponseDetail|PreceptorResponseDetail|StudentEvalResponseDetail/)
})

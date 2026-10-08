// MODERATION-STACKS-1 (Owner, 2026-10-07): moderation on the Unit Leader release is one stack per
// unit, the leader's numbers are shown before release, one action clears and releases a stack,
// Release all leaves single-response units out, and a low rating stays in.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildModerationStacks, releaseAllPlan, leaderSees, isAwaitingModeration, isLowRating } from '../src/lib/evaluation/moderationStacks.js'
import { leaderSeesFromResponses, serializeReviewQueueRow } from '../lib/server/unitEvaluations/serialize.js'
import { adaptUnitLeaderRelease } from '../src/lib/evaluation/reviewQueueAdapters.js'
import { needsStaff, blockerOwner } from '../src/lib/evaluation/reviewQueueShape.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const NOW = Date.parse('2026-10-07T18:00:00Z')
let n = 0
const row = (unit, rating, over = {}) => ({
  response_id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, student_name: `Student ${n}`, unit_key: unit,
  evaluated_preceptor: 'Pat', instrument_slug: 'student_preceptor_eval', timepoint: 'post_rotation', rotation_end: '2026-09-01',
  eligible_at: '2026-09-08', snapshot_source: 'submission_trigger', moderation_state: 'pending', release_state: 'pending',
  leader_sees: rating == null ? {} : { 'overall_experience.overall_rating': rating }, ...over,
})

test('the server reads only the allowlisted numbers a leader would see, never text', () => {
  const responses = { overall_experience: { overall_rating: 4, why: 'free text' }, narrative: { strengths: 'never' } }
  assert.deepEqual(leaderSeesFromResponses('student_preceptor_eval', responses), { 'overall_experience.overall_rating': 4 })
  assert.deepEqual(leaderSeesFromResponses('student_preceptor_eval', { overall_experience: { overall_rating: 'Excellent' } }), {})
  assert.deepEqual(leaderSeesFromResponses('unknown_slug', responses), {})
  const out = serializeReviewQueueRow({ response_id: 'r', instrument_slug: 'student_preceptor_eval' }, 'Ana', null, { 'overall_experience.overall_rating': 5 })
  assert.deepEqual(out.leader_sees, { 'overall_experience.overall_rating': 5 })
  assert.match(read('api/evaluation-unit-release-queue.js'), /select\('id, student_id, responses'\)/)
})

test('one stack per unit, most responses first; a single response stands alone and is left out of Release all', () => {
  const rows = [row('6 NW', 5), row('6 NW', 4), row('6 NW', 2), row('PACU', 5), row('PACU', 5), row('Float Pool', 3)]
  const { items } = adaptUnitLeaderRelease({ rows, nowMs: NOW })
  assert.ok(items.every(isAwaitingModeration))
  const stacks = buildModerationStacks(items)
  assert.deepEqual(stacks.map(s => [s.unit, s.count, s.single]), [['6 NW', 3, false], ['PACU', 2, false], ['Float Pool', 1, true]])
  assert.equal(stacks[0].summary, 'Excellent 1 · Very good 1 · Fair 1')
  assert.equal(stacks[0].low, true, 'a Fair rating is flagged in words')
  const plan = releaseAllPlan(stacks)
  assert.deepEqual(plan.stacks.map(s => s.unit), ['6 NW', 'PACU'], 'a low rating stays in Release all (Owner)')
  assert.equal(plan.responses, 5)
  assert.deepEqual(plan.leftOut, ['Float Pool'])
})

test('a held or never-releasable response is not stacked, and a held one is not counted as work', () => {
  const held = row('6 NE', 4, { moderation_state: 'blocked' })
  const legacy = row('6 NE', 4, { snapshot_source: 'backfill_unverified' })
  const cleared = row('6 NE', 4, { moderation_state: 'cleared', release_state: 'moderated' })
  const { items } = adaptUnitLeaderRelease({ rows: [held, legacy, cleared], nowMs: NOW, withholdsEnabled: true })
  assert.equal(buildModerationStacks(items).length, 0)
  const heldItem = items.find(i => i.responseId === held.response_id)
  assert.equal(blockerOwner(heldItem), 'held')
  assert.equal(needsStaff(heldItem), false)
  assert.equal(items.find(i => i.responseId === cleared.response_id).state, 'ready')
})

test('what the leader sees is worded with the instrument\'s own anchors', () => {
  assert.deepEqual(leaderSees(row('X', 4)).map(m => [m.text, m.tone]), [['Very good', 'ok']])
  assert.deepEqual(leaderSees(row('X', 1)).map(m => [m.text, m.tone]), [['Poor', 'bad']])
  assert.equal(isLowRating(row('X', 2)), true)
  assert.equal(isLowRating(row('X', 3)), false)
  const pp = row('X', null, { instrument_slug: 'preceptor_progress', leader_sees: { 'readiness_endorsement.transition_readiness': 4 } })
  assert.deepEqual(leaderSees(pp).map(m => m.text), ['Transition Readiness 4'])
})

test('the board and dashboard: stacks, Hold, Release all, through the existing per-response RPCs', () => {
  const board = read('src/components/evaluation/ReviewReleaseQueue.jsx')
  assert.match(board, /function ModerationStack/)
  assert.match(board, /Clear and release \$\{n\}/)
  assert.match(board, /Release all \$\{plan\.responses\}/)
  assert.match(board, />Hold</)
  assert.match(board, /Not anonymous/)
  const dash = read('src/components/evaluation/SurveyAutomationDashboard.jsx')
  assert.match(dash, /action: 'moderate', responseId: item\.responseId, decision: 'cleared'/)
  assert.match(dash, /action: 'release', responseId: item\.responseId/)
  assert.match(dash, /decision: 'blocked'/)
  assert.match(dash, /confirmDialog\(`Release \$\{plan\.responses\} responses/)
  const css = read('src/components/evaluation/reviewReleaseClipboard.css')
  assert.match(css, /:root\[data-style="modern"\] \.ms-deck \{ margin-bottom: 0; box-shadow: 0 1px 1px/)
})

test('a response with nothing the leader would see is named plainly in the stack summary', () => {
  const pp = row('PACU', null, { instrument_slug: 'preceptor_progress', leader_sees: {} })
  const { items } = adaptUnitLeaderRelease({ rows: [row('PACU', 5), pp, { ...pp, response_id: '00000000-0000-4000-8000-0000000000ff' }], nowMs: NOW })
  assert.equal(buildModerationStacks(items)[0].summary, 'Excellent 1 · 2 with no numbers')
})

test('a stack row keeps a column for the name, so long answers never squeeze it to a letter a line', () => {
  const css = read('src/components/evaluation/reviewReleaseClipboard.css')
  assert.match(css, /\.ms-row \{ display: grid; grid-template-columns: minmax\(12rem, 1fr\) minmax\(0, 2fr\) auto;/)
  assert.doesNotMatch(css, /\.ms-row-who \{[^}]*overflow-wrap: anywhere/)
  assert.doesNotMatch(css, /\.ms-rating \{[^}]*white-space: nowrap/)
})

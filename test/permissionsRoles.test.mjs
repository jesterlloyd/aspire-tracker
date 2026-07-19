// ASPIRE-CHART: functional tests for the role permission boundary, including
// the co-lead compatibility normalization. Persisted profiles carry BOTH
// 'co-lead' and 'co_lead'; before this fix, the underscore form fell through
// to the viewer fallback in can()/studentDetailLevel() and silently
// under-permissioned a co-lead. Both spellings must resolve to the one
// intended co-lead capability set, no more and no less.
// Run: node --test test/permissionsRoles.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  can, studentDetailLevel, canPerformMatching, normalizeStaffRole,
} from '../src/lib/permissions.js'

const profile = (role, extra = {}) => ({ role, is_owner: false, ...extra })

test('normalizeStaffRole maps only the underscore variant', () => {
  assert.equal(normalizeStaffRole('co_lead'), 'co-lead')
  assert.equal(normalizeStaffRole('co-lead'), 'co-lead')
  for (const r of ['owner', 'admin', 'interviewer', 'viewer', undefined, null]) {
    assert.equal(normalizeStaffRole(r), r)
  }
})

test('both co-lead spellings resolve to the identical capability set', () => {
  const KEYS = ['viewEmbed', 'viewPeopleAccess', 'manageCohorts', 'makePlacements',
    'deleteRecords', 'viewInterviewRubric', 'conductInterviews']
  for (const key of KEYS) {
    assert.equal(
      can(profile('co_lead'), key),
      can(profile('co-lead'), key),
      `can(${key}) must match across spellings`,
    )
  }
  assert.equal(studentDetailLevel(profile('co_lead')), studentDetailLevel(profile('co-lead')))
  assert.equal(canPerformMatching(profile('co_lead')), canPerformMatching(profile('co-lead')))
})

test('co-lead capabilities match the intended ROLE_PERMS entry (not viewer)', () => {
  for (const role of ['co-lead', 'co_lead']) {
    const p = profile(role)
    assert.equal(can(p, 'viewEmbed'), true, `${role} viewEmbed`)
    assert.equal(can(p, 'makePlacements'), true, `${role} makePlacements (viewer would be false)`)
    assert.equal(can(p, 'viewInterviewRubric'), true, `${role} viewInterviewRubric`)
    assert.equal(can(p, 'viewPeopleAccess'), false, `${role} viewPeopleAccess stays denied`)
    assert.equal(can(p, 'manageCohorts'), false, `${role} manageCohorts stays denied`)
    assert.equal(can(p, 'deleteRecords'), false, `${role} deleteRecords stays denied`)
    assert.equal(can(p, 'conductInterviews'), false, `${role} conductInterviews stays denied`)
    assert.equal(studentDetailLevel(p), 'full', `${role} detail level (viewer would be readonly)`)
    assert.equal(canPerformMatching(p), true, `${role} matching`)
  }
})

test('owner, admin, interviewer, and viewer behavior is unchanged', () => {
  // Owner flag bypasses everything regardless of role string.
  const owner = profile('owner', { is_owner: true })
  assert.equal(can(owner, 'deleteRecords'), true)
  assert.equal(studentDetailLevel(owner), 'full')
  assert.equal(canPerformMatching(owner), true)
  // A misconfigured owner flag with a non-owner role still bypasses (existing behavior).
  assert.equal(can(profile('viewer', { is_owner: true }), 'manageCohorts'), true)

  const admin = profile('admin')
  assert.equal(can(admin, 'manageCohorts'), true)
  assert.equal(can(admin, 'conductInterviews'), false)
  assert.equal(canPerformMatching(admin), true)

  const interviewer = profile('interviewer')
  assert.equal(can(interviewer, 'conductInterviews'), true)
  assert.equal(can(interviewer, 'makePlacements'), false)
  assert.equal(studentDetailLevel(interviewer), 'limited')
  assert.equal(canPerformMatching(interviewer), false)

  const viewer = profile('viewer')
  assert.equal(can(viewer, 'makePlacements'), false)
  assert.equal(studentDetailLevel(viewer), 'readonly')
  assert.equal(canPerformMatching(viewer), false)
})

test('unknown roles and missing profiles fail closed to viewer/readonly', () => {
  assert.equal(can(null, 'viewEmbed'), false)
  assert.equal(studentDetailLevel(null), 'readonly')
  assert.equal(canPerformMatching(null), false)
  const unknown = profile('mystery_role')
  assert.equal(can(unknown, 'makePlacements'), false)
  assert.equal(studentDetailLevel(unknown), 'readonly')
  assert.equal(canPerformMatching(unknown), false)
})

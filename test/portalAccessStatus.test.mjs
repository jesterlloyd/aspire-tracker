// ASPIRE-PORTAL-ACCESS-UI: pure-logic tests for portal access status derivation,
// expiring-soon detection, and scope summaries.
// Run: node --test test/portalAccessStatus.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { derivePortalStatus, isExpiringSoon, summarizeScope, PORTAL_STATUS_STYLES } from '../src/lib/portalAccessStatus.js'

const NOW = Date.parse('2026-07-14T00:00:00Z')
const days = (n) => new Date(NOW + n * 86400000).toISOString()

test('derivePortalStatus distinguishes all four states', async (t) => {
  await t.test('revoked wins regardless of window', () => {
    assert.equal(derivePortalStatus({ revoked_at: days(-1), starts_at: days(-10), expires_at: days(10) }, NOW), 'revoked')
  })
  await t.test('scheduled when starts in the future', () => {
    assert.equal(derivePortalStatus({ revoked_at: null, starts_at: days(5), expires_at: null }, NOW), 'scheduled')
  })
  await t.test('expired when past expiry', () => {
    assert.equal(derivePortalStatus({ revoked_at: null, starts_at: days(-10), expires_at: days(-1) }, NOW), 'expired')
  })
  await t.test('active when started and not expired', () => {
    assert.equal(derivePortalStatus({ revoked_at: null, starts_at: days(-1), expires_at: days(30) }, NOW), 'active')
    assert.equal(derivePortalStatus({ revoked_at: null, starts_at: days(-1), expires_at: null }, NOW), 'active')
  })
})

test('isExpiringSoon flags active grants within 30 days only', async (t) => {
  await t.test('active + expiry in 10 days is expiring soon', () => {
    assert.equal(isExpiringSoon({ revoked_at: null, starts_at: days(-1), expires_at: days(10) }, NOW), true)
  })
  await t.test('active + expiry in 40 days is NOT expiring soon', () => {
    assert.equal(isExpiringSoon({ revoked_at: null, starts_at: days(-1), expires_at: days(40) }, NOW), false)
  })
  await t.test('no expiry is never expiring soon', () => {
    assert.equal(isExpiringSoon({ revoked_at: null, starts_at: days(-1), expires_at: null }, NOW), false)
  })
  await t.test('expired/revoked/scheduled are not expiring soon', () => {
    assert.equal(isExpiringSoon({ revoked_at: days(-1), starts_at: days(-1), expires_at: days(5) }, NOW), false)
    assert.equal(isExpiringSoon({ revoked_at: null, starts_at: days(5), expires_at: days(10) }, NOW), false)
  })
})

test('summarizeScope renders per-role scope text', async (t) => {
  await t.test('student shows name, school, cohort', () => {
    const s = summarizeScope({ portal_role: 'student', scope: { students: [{ name: 'Jae Doe', school: 'CSULB', cohort: 'Summer 2026' }] } })
    assert.match(s, /Jae Doe/); assert.match(s, /CSULB/); assert.match(s, /Summer 2026/)
  })
  await t.test('unit leader lists units and overflow', () => {
    const s = summarizeScope({ portal_role: 'unit_leader', scope: { units: [{ unit_key: '4 North' }, { unit_key: 'NICU' }, { unit_key: 'PICU' }] } })
    assert.match(s, /4 North/); assert.match(s, /\+1 more/)
  })
  await t.test('academic partner lists schools', () => {
    const s = summarizeScope({ portal_role: 'academic_partner', scope: { schools: [{ school_key: 'Azusa Pacific University' }] } })
    assert.match(s, /Azusa Pacific University/)
  })
})

test('status styles carry a text label (never color-only)', () => {
  for (const key of ['active', 'scheduled', 'expired', 'revoked']) {
    assert.ok(PORTAL_STATUS_STYLES[key]?.label, `status ${key} must have a text label`)
  }
})

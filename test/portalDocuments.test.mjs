// ASPIRE-STUDENT-HOME: unit tests for the Documents card status derivations
// (ID Badge and Certificate of Completion). No I/O.
// Run: node --test test/portalDocuments.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveBadgeStatus, deriveCertificateStatus } from '../src/lib/portalDocuments.js'

test('deriveBadgeStatus', async (t) => {
  await t.test('badge_created marks the badge Created', () => {
    const b = deriveBadgeStatus({ badgeCreated: true, status: 'Active Rotation' })
    assert.equal(b.state, 'created')
    assert.equal(b.label, 'Created')
  })

  await t.test('placed/active/completed without a created badge shows Processing', () => {
    for (const status of ['Placed', 'Active Rotation', 'Completed']) {
      const b = deriveBadgeStatus({ badgeCreated: false, status })
      assert.equal(b.state, 'processing', `expected processing for ${status}`)
    }
  })

  await t.test('pre-placement shows Not yet available', () => {
    const b = deriveBadgeStatus({ badgeCreated: false, status: 'Form Received' })
    assert.equal(b.state, 'not_yet')
    assert.equal(b.label, 'Not yet available')
  })

  await t.test('the badge is downloadable only once created: rendered in the browser, never a server file', () => {
    assert.equal(deriveBadgeStatus({ badgeCreated: true, status: 'Completed' }).downloadable, true)
    for (const args of [
      { badgeCreated: false, status: 'Placed' },
      { badgeCreated: false, status: 'Form Sent' },
    ]) {
      assert.equal(deriveBadgeStatus(args).downloadable, false)
    }
  })
})

test('deriveCertificateStatus', async (t) => {
  const unlockedCert = { certificate_number: 'ASPIRE-2026-052', certificate_year: 2026, certificate_unlocked_at: '2026-07-01T00:00:00Z' }

  await t.test('an unlocked certificate is Available and downloadable, with number/year/unlockedAt', () => {
    const c = deriveCertificateStatus({ certificate: unlockedCert, status: 'Completed' })
    assert.equal(c.state, 'available')
    assert.equal(c.downloadable, true)
    assert.equal(c.number, 'ASPIRE-2026-052')
    assert.equal(c.year, 2026)
    assert.equal(c.unlockedAt, '2026-07-01T00:00:00Z')
  })

  await t.test('no certificate + rotation not complete: Locked, reason = rotation completion', () => {
    const c = deriveCertificateStatus({ certificate: null, status: 'Active Rotation' })
    assert.equal(c.state, 'locked')
    assert.equal(c.downloadable, false)
    assert.match(c.lockedReason, /rotation is complete/i)
  })

  await t.test('rotation complete + open post-rotation evaluation: Locked, reason = post-rotation survey', () => {
    const c = deriveCertificateStatus({
      certificate: null,
      status: 'Completed',
      evaluations: [{ timepoint: 'post_rotation', status: 'sent' }],
    })
    assert.equal(c.state, 'locked')
    assert.match(c.lockedReason, /post-rotation survey/i)
  })

  await t.test('rotation complete + post-rotation evaluation completed but no cert row yet: eligible/processing', () => {
    const c = deriveCertificateStatus({
      certificate: null,
      status: 'Completed',
      evaluations: [{ timepoint: 'post_rotation', status: 'completed' }],
    })
    assert.equal(c.state, 'eligible')
    assert.equal(c.downloadable, false)
    assert.match(c.lockedReason, /finalized/i)
  })

  await t.test('off-ramp status: Unavailable, not downloadable', () => {
    const c = deriveCertificateStatus({ certificate: null, status: 'Declined' })
    assert.equal(c.state, 'unavailable')
    assert.equal(c.downloadable, false)
  })

  await t.test('downloadable is true ONLY for the available state', () => {
    assert.equal(deriveCertificateStatus({ certificate: unlockedCert, status: 'Completed' }).downloadable, true)
    assert.equal(deriveCertificateStatus({ certificate: null, status: 'Placed' }).downloadable, false)
    // A certificate row missing its unlock timestamp is not treated as available.
    assert.equal(deriveCertificateStatus({ certificate: { certificate_number: 'X', certificate_unlocked_at: null }, status: 'Completed' }).downloadable, false)
  })
})

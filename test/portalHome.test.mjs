// ASPIRE-COMPASS: unit tests for the pure Compass home derivations (primary
// action, attention items). No I/O.
// Run: node --test test/portalHome.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveCompassAction, deriveAttentionItems } from '../src/lib/portalHome.js'

test('deriveCompassAction', async (t) => {
  await t.test('Active Rotation points at the shift log', () => {
    const a = deriveCompassAction({ status: 'Active Rotation' })
    assert.equal(a.kind, 'shift-log')
    assert.equal(a.href, '/shift-log')
  })
  await t.test('Completed with a downloadable certificate points at the download', () => {
    const a = deriveCompassAction({ status: 'Completed', certificateDownloadable: true })
    assert.equal(a.kind, 'certificate')
  })
  await t.test('Completed WITHOUT a downloadable certificate has no false CTA', () => {
    assert.equal(deriveCompassAction({ status: 'Completed', certificateDownloadable: false }), null)
  })
  await t.test('pre-placement stages have no primary action', () => {
    for (const s of ['Pending Outreach', 'Form Sent', 'Form Received', 'Interview Scheduled', 'Interviewed', 'Placed']) {
      assert.equal(deriveCompassAction({ status: s }), null, s)
    }
  })
  await t.test('terminal and unknown statuses have no primary action', () => {
    assert.equal(deriveCompassAction({ status: 'Declined' }), null)
    assert.equal(deriveCompassAction({}), null)
  })
})

test('deriveAttentionItems', async (t) => {
  await t.test('empty inputs produce no items (the band stays quiet)', () => {
    assert.deepEqual(deriveAttentionItems({}), [])
    assert.deepEqual(deriveAttentionItems({ unreadMessages: 0, evaluations: [], shiftLogs: [] }), [])
  })
  await t.test('unread messages come first, with singular and plural labels', () => {
    assert.equal(deriveAttentionItems({ unreadMessages: 1 })[0].label, '1 unread message')
    const items = deriveAttentionItems({ unreadMessages: 3, evaluations: [{ status: 'sent' }] })
    assert.equal(items[0].target, 'messages')
    assert.equal(items[1].target, 'surveys')
  })
  await t.test('only open survey windows count as waiting', () => {
    const evals = [
      { status: 'sent' }, { status: 'opened' }, { status: 'reminder_due' },
      { status: 'completed' }, { status: 'expired' }, { status: 'draft' }, { status: 'revoked' },
    ]
    const items = deriveAttentionItems({ evaluations: evals })
    assert.equal(items.length, 1)
    assert.equal(items[0].count, 3)
  })
  await t.test('non-approved shift logs count as awaiting review', () => {
    const logs = [{ status: 'approved' }, { status: 'submitted' }, { status: 'pending' }, { status: null }]
    const items = deriveAttentionItems({ shiftLogs: logs })
    assert.equal(items.length, 1)
    assert.equal(items[0].count, 2)
    assert.match(items[0].label, /2 shifts awaiting review/)
  })
})

// ASPIRE-STUDENT-HOME: unit tests for the pure portal progress derivations
// (hero current-stage, Next Steps timeline, Clinical Hours). No I/O.
// Run: node --test test/portalProgress.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveHeroStage, derivePortalTimeline, deriveClinicalHours } from '../src/lib/portalProgress.js'

const GUARANTEE_RE = /guarantee|you will be (placed|hired|admitted)|residency admission|guaranteed/i

test('deriveHeroStage', async (t) => {
  await t.test('maps a recognized status to a { current, next } pair', () => {
    const s = deriveHeroStage('Form Received')
    assert.equal(s.current, 'Application received')
    assert.match(s.next, /interview scheduling invitation/i)
  })
  await t.test('Active Rotation and Completed surface progress-appropriate copy', () => {
    assert.equal(deriveHeroStage('Active Rotation').current, 'Rotation in progress')
    assert.equal(deriveHeroStage('Completed').current, 'Rotation completed')
  })
  await t.test('off-ramp and unknown statuses return null (never an invented stage)', () => {
    assert.equal(deriveHeroStage('Declined'), null)
    assert.equal(deriveHeroStage('Not Proceeding'), null)
    assert.equal(deriveHeroStage('Something Else'), null)
    assert.equal(deriveHeroStage(undefined), null)
  })
  await t.test('no stage copy promises or guarantees an outcome', () => {
    for (const status of ['Pending Outreach', 'Form Sent', 'Form Received', 'Interview Scheduled', 'Interviewed', 'Placed', 'Active Rotation', 'Completed']) {
      const s = deriveHeroStage(status)
      assert.doesNotMatch(`${s.current} ${s.next}`, GUARANTEE_RE, `guarantee language in ${status}`)
    }
  })
})

test('derivePortalTimeline', async (t) => {
  await t.test('Form Sent: application is the current step, nothing complete yet', () => {
    const { terminal, steps } = derivePortalTimeline({ status: 'Form Sent' })
    assert.equal(terminal, false)
    assert.equal(steps.length, 7)
    assert.equal(steps[0].key, 'application')
    assert.equal(steps[0].state, 'current')
    assert.ok(steps.every(s => s.state !== 'complete'))
  })

  await t.test('Placed: through placement complete, rotation started is current', () => {
    const { steps } = derivePortalTimeline({ status: 'Placed' })
    const byKey = Object.fromEntries(steps.map(s => [s.key, s.state]))
    assert.equal(byKey.application, 'complete')
    assert.equal(byKey.interview_scheduling, 'complete')
    assert.equal(byKey.interview_completed, 'complete')
    assert.equal(byKey.placement, 'complete')
    assert.equal(byKey.rotation_started, 'current')
    assert.equal(byKey.rotation_completed, 'upcoming')
    assert.equal(byKey.certificate, 'upcoming')
  })

  await t.test('Completed without an unlocked certificate: certificate is the current step', () => {
    const { steps } = derivePortalTimeline({ status: 'Completed', certificateUnlocked: false })
    const cert = steps.find(s => s.key === 'certificate')
    assert.equal(cert.state, 'current')
    assert.equal(steps.find(s => s.key === 'rotation_completed').state, 'complete')
  })

  await t.test('Completed with an unlocked certificate: every step is complete', () => {
    const { steps } = derivePortalTimeline({ status: 'Completed', certificateUnlocked: true })
    assert.ok(steps.every(s => s.state === 'complete'))
  })

  await t.test('off-ramp status: a single neutral step, terminal true, no ladder', () => {
    const { terminal, steps } = derivePortalTimeline({ status: 'Declined' })
    assert.equal(terminal, true)
    assert.equal(steps.length, 1)
    assert.equal(steps[0].state, 'current')
  })

  await t.test('every step carries an accessible text stateLabel', () => {
    const { steps } = derivePortalTimeline({ status: 'Active Rotation' })
    for (const s of steps) {
      assert.ok(['Complete', 'Current', 'Upcoming'].includes(s.stateLabel), `bad stateLabel ${s.stateLabel}`)
    }
  })

  await t.test('no timeline label promises or guarantees an outcome', () => {
    for (const status of ['Form Sent', 'Placed', 'Active Rotation', 'Completed']) {
      const { steps } = derivePortalTimeline({ status })
      for (const s of steps) assert.doesNotMatch(s.label, GUARANTEE_RE)
    }
  })
})

test('deriveClinicalHours', async (t) => {
  await t.test('reliable data yields completed, required, remaining, pct, pending', () => {
    const h = deriveClinicalHours({ required: 90, approved: 45, pending: 6 })
    assert.equal(h.reliable, true)
    assert.equal(h.completed, 45)
    assert.equal(h.required, 90)
    assert.equal(h.remaining, 45)
    assert.equal(h.pct, 50)
    assert.equal(h.pending, 6)
  })

  await t.test('required 0, null, or non-numeric is NOT reliable (no misleading bar)', () => {
    assert.equal(deriveClinicalHours({ required: 0, approved: 10 }).reliable, false)
    assert.equal(deriveClinicalHours({ required: null, approved: 10 }).reliable, false)
    assert.equal(deriveClinicalHours({ required: 'x', approved: 10 }).reliable, false)
    assert.equal(deriveClinicalHours({}).reliable, false)
  })

  await t.test('non-numeric completed is NOT reliable', () => {
    assert.equal(deriveClinicalHours({ required: 90, approved: undefined }).reliable, false)
    assert.equal(deriveClinicalHours({ required: 90, approved: null }).reliable, false)
  })

  await t.test('over-completion clamps remaining to 0 and pct to 100', () => {
    const h = deriveClinicalHours({ required: 90, approved: 120 })
    assert.equal(h.remaining, 0)
    assert.equal(h.pct, 100)
  })

  await t.test('pending normalizes to 0 when missing or non-positive', () => {
    assert.equal(deriveClinicalHours({ required: 90, approved: 10 }).pending, 0)
    assert.equal(deriveClinicalHours({ required: 90, approved: 10, pending: -5 }).pending, 0)
  })
})

// PHASE2-PORTAL: targeted tests for the student next-steps derivation.
// Run: node --test test/portalNextSteps.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveNextSteps } from '../src/lib/portalNextSteps.js'

test('portal next steps derivation', async (t) => {
  await t.test('Active Rotation with remaining hours shows log + hours steps', () => {
    const steps = deriveNextSteps({
      status: 'Active Rotation',
      hours: { approved: 40, required: 90 },
      evaluations: [],
    })
    const keys = steps.map(s => s.key)
    assert.ok(keys.includes('log'), 'includes shift-log step')
    assert.ok(keys.includes('hours'), 'includes hours step')
    const hoursStep = steps.find(s => s.key === 'hours')
    assert.match(hoursStep.label, /50 clinical hours/)
    assert.equal(hoursStep.done, false)
  })

  await t.test('Active Rotation with hours met marks the hours step done', () => {
    const steps = deriveNextSteps({
      status: 'Active Rotation',
      hours: { approved: 92, required: 90 },
      evaluations: [],
    })
    const hoursStep = steps.find(s => s.key === 'hours')
    assert.equal(hoursStep.done, true)
  })

  await t.test('pending evaluations surface a step; completed ones do not', () => {
    const withPending = deriveNextSteps({
      status: 'Active Rotation',
      hours: { approved: 0, required: 90 },
      evaluations: [{ status: 'sent' }, { status: 'completed' }],
    })
    assert.match(withPending.find(s => s.key === 'evals').label, /1 pending evaluation$/)

    const allDone = deriveNextSteps({
      status: 'Active Rotation',
      hours: { approved: 0, required: 90 },
      evaluations: [{ status: 'completed' }],
    })
    assert.equal(allDone.find(s => s.key === 'evals'), undefined)
  })

  await t.test('Completed with unlocked certificate names the certificate', () => {
    const steps = deriveNextSteps({
      status: 'Completed',
      hours: { approved: 90, required: 90 },
      evaluations: [{ status: 'completed' }],
      certificate: { certificate_unlocked_at: '2026-07-01T00:00:00Z', certificate_number: 'ASPIRE-2026-052' },
    })
    const cert = steps.find(s => s.key === 'certificate')
    assert.equal(cert.done, true)
    assert.match(cert.label, /ASPIRE-2026-052/)
    assert.ok(steps.map(s => s.key).includes('ngrp'), 'includes NGRP reminder')
  })

  await t.test('Completed with pending post-rotation survey gates the certificate', () => {
    const steps = deriveNextSteps({
      status: 'Completed',
      hours: { approved: 90, required: 90 },
      evaluations: [{ status: 'sent' }],
      certificate: null,
    })
    assert.match(steps.find(s => s.key === 'evals').label, /post-rotation survey/)
    assert.equal(steps.find(s => s.key === 'certificate'), undefined)
  })

  await t.test('unknown status falls back to a contact step', () => {
    const steps = deriveNextSteps({ status: 'Something Odd', hours: {}, evaluations: [] })
    assert.equal(steps.length, 1)
    assert.equal(steps[0].key, 'contact')
  })
})

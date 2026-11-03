// test/transitionFormDeadline.test.mjs
//
// TRANSITION-DEADLINE-1 (Owner, 2026-11-02): "the transition form is NOT an application."
// The form closes on the cohort's own Transition Form deadline (or a date chosen on the send),
// never on the application deadline. Every send stamps the date on the assignment, so whoever
// has not submitted by it is locked out until Extend Deadline gives them their own.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const code = src => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const { effectiveFormClose, cohortFormClose, pacificEndOfDay } = await import('../lib/server/ngrpTransition.js')
const { validateCyclePayload } = await import('../lib/server/ngrpPlanning.js')

test('the cohort default is the Transition Form deadline, never the application deadline', () => {
  assert.equal(cohortFormClose({ application_deadline: '2026-11-11' }), null)
  assert.equal(cohortFormClose({ application_deadline: '2026-11-11', transition_form_deadline: '2026-11-04' }), pacificEndOfDay('2026-11-04'))
  const own = pacificEndOfDay('2026-11-10')
  assert.equal(effectiveFormClose({ transition_form_deadline: '2026-11-04' }, { deadline_at: own }), own)
})

test('Edit Cohort saves the date, and the planning validator accepts it', () => {
  const ok = validateCyclePayload({ name: 'Winter 2027', transition_form_deadline: '2026-11-04' })
  assert.equal(ok.ok, true)
  assert.equal(ok.cycle.transition_form_deadline, '2026-11-04')
  assert.equal(validateCyclePayload({ name: 'X', transition_form_deadline: 'soon' }).ok, false)
  const modal = read('src/components/ngrp/CohortSettingsModal.jsx')
  assert.match(modal, /label="Transition Form closes"/)
  assert.match(modal, /transition_form_deadline: basics\.transition_form_deadline \|\| null/)
  assert.match(read('src/lib/ngrp/ngrpCohortForm.js'), /transition_form_deadline: c\?\.transition_form_deadline \|\| ''/)
})

test('every send leaves with a close date, and a blank send never takes back an extension', () => {
  const ep = read('api/ngrp-transition-send.js')
  assert.match(ep, /const formCloseAt = closeParsed\.closeAt \|\| cohortFormClose\(cycle\)/)
  assert.match(ep, /if \(!formCloseAt\) return res\.status\(422\)\.json\(\{ error: 'no_form_deadline' \}\)/)
  assert.doesNotMatch(code(ep), /application_deadline: cycle\.application_deadline/)
  const core = read('lib/server/ngrpTransition.js')
  assert.match(core, /formCloseChosen = true \} = ctx/)
  assert.match(core, /new Date\(assignment\.deadline_at\)\.getTime\(\) > new Date\(formCloseAt\)\.getTime\(\)/)
})

test('no screen or rule reads the application deadline as the form close', () => {
  for (const f of ['src/components/ngrp/ApplicantDrawer.jsx', 'src/components/connect/NgrpTransitionSendPanel.jsx', 'src/lib/ngrp/transitionPreviewFixture.js']) {
    assert.doesNotMatch(code(read(f)), /application_deadline/, f)
  }
  const migration = read('supabase/migrations/20261121000000_transition_form_deadline.sql')
  assert.match(migration, /ADD COLUMN IF NOT EXISTS transition_form_deadline date/)
  assert.equal((migration.match(/ngrp_pacific_deadline\(cyc\.transition_form_deadline\)/g) || []).length, 2)
})

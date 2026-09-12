// RESIDENCY-PORTAL-2: Talent Acquisition's access to the residency workspace.
// Joint ownership (Owner): an active talent_acquisition grant passes the
// Residency read and manage checks, the roster is narrowed to alumni who
// submitted the Transition Form, At a Glance keeps the cohort-wide counts, and
// sending and form links stay with the ASPIRE team.
// Run: node --test test/residencyPortalAccess.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  TALENT_ACQUISITION, SUBMITTED_FORM_STATUSES, hasSubmittedForm, narrowPayloadForTalentAcquisition,
} from '../lib/server/ngrpTalentAcquisition.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')

const stu = id => ({ id, first_name: id, last_name: 'Alum', status: 'Completed' })
const PAYLOAD = {
  cycle: { id: 'cy1', name: 'Winter 2027' },
  sourceCohorts: [{ id: 'c1', name: 'Fall 2026' }],
  students: [stu('s-submitted'), stu('s-revised'), stu('s-opened'), stu('s-none')],
  candidates: [
    // RESIDENCY-ROSTER-1: interest is part of the pool rule now, so the fixture
    // has to state it. This row was written when a 'confirmed' status was what
    // put someone at the end of the funnel.
    { id: 'k1', student_id: 's-submitted', form_status: 'submitted', interest: 'interested', application_status: 'confirmed', eligibility_calculated: 'eligible' },
    { id: 'k2', student_id: 's-revised', form_status: 'revised', application_status: 'not_confirmed', eligibility_calculated: 'pending' },
    { id: 'k3', student_id: 's-opened', form_status: 'opened', application_status: 'not_confirmed', eligibility_calculated: 'pending' },
  ],
  excludedPriorHires: 0,
}

test('the roster is narrowed to alumni who submitted the form, regardless of eligibility', () => {
  assert.equal(TALENT_ACQUISITION, 'talent_acquisition')
  assert.deepEqual([...SUBMITTED_FORM_STATUSES], ['submitted', 'revised'])
  assert.equal(hasSubmittedForm('revised'), true)
  assert.equal(hasSubmittedForm('opened'), false)
  assert.equal(hasSubmittedForm(undefined), false)
  const view = narrowPayloadForTalentAcquisition(PAYLOAD)
  assert.deepEqual(view.students.map(s => s.id), ['s-submitted', 's-revised'])
  assert.deepEqual(view.candidates.map(c => c.id), ['k1', 'k2'])
  // everything that is not a person passes through unchanged
  assert.equal(view.cycle, PAYLOAD.cycle)
  assert.equal(view.sourceCohorts, PAYLOAD.sourceCohorts)
  // the input is not mutated
  assert.equal(PAYLOAD.students.length, 4)
})

test('At a Glance keeps the cohort-wide counts, computed before narrowing, as numbers only', () => {
  const { pipeline } = narrowPayloadForTalentAcquisition(PAYLOAD)
  const count = key => pipeline.find(s => s.key === key)?.count
  assert.equal(count('alumni'), 4, 'all four completed alumni, not just the two submitters')
  assert.equal(count('sent'), 3)
  assert.equal(count('submitted'), 2)
  assert.equal(count('pool'), 1, 'the funnel ends at the Applicant Pool, which is derived')
  for (const stage of pipeline) assert.deepEqual(Object.keys(stage).sort(), ['count', 'hint', 'key', 'label'])
  assert.match(read('src/components/ngrp/AtAGlanceTab.jsx'), /applicants\.payload\?\.pipeline \|\| pipelineStages\(rows, \{ effectiveEligibility \}\)/)
})

test('the one Residency access check admits an active Talent Acquisition grant at both levels', () => {
  const auth = read('api/lib/ngrpAuth.js')
  // staff first, by the one capability table (literal kept: other tests pin it)
  assert.match(auth, /can\(caller\.profile, 'ngrp_access'\)/)
  assert.match(auth, /manage \? can\(caller\.profile, 'ngrp_manage'\)/)
  assert.match(auth, /hasActiveRoleGrant\(getServiceDb\(\), caller\.profile\.id, TALENT_ACQUISITION\)/)
  assert.match(auth, /audience: TALENT_ACQUISITION/)
  assert.match(auth, /'talent_acquisition_role_required'/)
  // the management endpoint uses it, not a second copy
  const manage = read('api/ngrp-manage.js')
  assert.match(manage, /return verifyNgrpCaller\(req, \{ manage: true \}\)/)
  assert.doesNotMatch(manage, /can\(caller\.profile, 'ngrp_manage'\)/)
  // sending stays staff-only: the send endpoint does not accept the grant
  assert.doesNotMatch(read('api/ngrp-transition-send.js'), /verifyNgrpCaller|talent_acquisition/)
})

test('endpoints narrow Talent Acquisition: submitted-only roster, 404 for anyone else, no form links', () => {
  const ws = read('api/ngrp-workspace.js')
  assert.match(ws, /caller\.audience === TALENT_ACQUISITION \? narrowPayloadForTalentAcquisition\(payload\) : payload/)
  assert.match(ws, /students: view\.students,\s+candidates: view\.candidates,/)
  const manage = read('api/ngrp-manage.js')
  const gate = manage.indexOf('if (isTalentAcquisition) {')
  assert.ok(gate > manage.indexOf("const { candidate, cycle } = ctx"), 'the gate runs before every candidate action')
  assert.ok(gate < manage.indexOf("if (action === 'candidate_review')"))
  assert.match(manage, /if \(!hasSubmittedForm\(submittedCheck\.assignment\?\.status\)\) return res\.status\(404\)\.json\(\{ error: 'candidate_not_found' \}\)/)
  assert.match(manage, /if \(action === 'token_revoke'\) \{\s+\/\/[^\n]*\n\s+if \(isTalentAcquisition\) return res\.status\(403\)/)
})

test('the portal hides Revoke link the same way it hides Send', () => {
  assert.match(read('src/components/ngrp/ProfilesTab.jsx'), /revokeLink: canSendForms \? \(r => runManage\('token_revoke'/)
  assert.match(read('src/components/ngrp/ApplicantDrawer.jsx'), /right=\{canManage && hasForm && provisioned && actions\.revokeLink \? \(/)
})

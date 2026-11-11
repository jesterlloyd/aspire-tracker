// UNIT-FORM-RESPONDER-1 / UNIT-FORM-CONCERN-1 / UNIT-FORM-WIDE-1 (Owner, 2026-11-11).
// The public Unit Availability Form names its responder from ASPIRE Connect > Contacts, never
// tells a public page an address, and flags the two "would not hire" answers to the team.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  maskEmail, publicResponders, respondersForRole, findResponder, hiringConcerns, responseHiringConcerns, NOT_LISTED,
} from '../src/lib/unitFormResponders.js'
import { unitLeaderRows } from '../src/lib/unitLeadersFromConnect.js'
import { validateParticipation, participationReady, emptyParticipation } from '../src/lib/unitParticipationForm.js'
import { placementGroup } from '../src/lib/home/needsYouModel.js'
import { unitFormReceived } from '../src/lib/notifications/templates/unitFormReceived.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const contacts = [
  { id: 'c1', full_name: 'Jenita Example', email: 'Jenita.Example@cshs.org', role: 'Associate Director', category: 'Unit Leader', unit_name: '8 SCCT', is_active: true },
  { id: 'c2', full_name: 'Ann Manager', email: 'ann.manager@cshs.org', role: 'Assistant Nurse Manager', category: 'Unit Leader', unit_name: '8 SCCT', is_active: true },
  { id: 'c3', full_name: 'Bo Manager', email: 'bo.manager@cshs.org', role: 'Assistant Nurse Manager', category: 'Unit Leader', unit_name: '8 SCCT', is_active: true },
  { id: 'c4', full_name: 'Ivy Interim', email: 'ivy@cshs.org', role: 'Interim Associate Director', category: 'Unit Leader', unit_name: '6 NE', is_active: true },
  { id: 'c5', full_name: 'Gone Leader', email: 'gone@cshs.org', role: 'Associate Director', category: 'Unit Leader', unit_name: '8 SCCT', is_active: false },
]
const leaders = unitLeaderRows(contacts, { unitName: '8 SCCT' })

test('a public responder carries a masked address and never the address', () => {
  const out = publicResponders(leaders)
  assert.equal(out.length, 3)
  for (const r of out) {
    assert.deepEqual(Object.keys(r).sort(), ['email_hint', 'id', 'name', 'role'])
    assert.ok(!JSON.stringify(r).toLowerCase().includes('example@') && !/[a-z]{2,}\.[a-z]+@/i.test(r.email_hint))
  }
  assert.equal(maskEmail('Jenita.Example@cshs.org'), 'J••••••@cshs.org')
  assert.equal(maskEmail('nope'), '')
})

test('the role chooses the names: one is the answer, several are a list, none is free text', () => {
  const pub = publicResponders(leaders)
  assert.deepEqual(respondersForRole(pub, 'Associate Director').map(r => r.name), ['Jenita Example'])
  assert.deepEqual(respondersForRole(pub, 'Assistant Nurse Manager').map(r => r.name), ['Ann Manager', 'Bo Manager'])
  assert.deepEqual(respondersForRole(pub, 'Charge Nurse'), [])
  assert.deepEqual(respondersForRole(pub, 'Other'), [])
  // Connect's Interim is the form's Acting.
  const ne = publicResponders(unitLeaderRows(contacts, { unitName: '6 NE' }))
  assert.deepEqual(respondersForRole(ne, 'Acting Associate Director').map(r => r.name), ['Ivy Interim'])
})

test('a submitted contact id resolves only inside its own unit', () => {
  assert.equal(findResponder(leaders, 'c1').email, 'Jenita.Example@cshs.org')
  assert.equal(findResponder(leaders, 'c4'), null)      // another unit's leader
  assert.equal(findResponder(leaders, 'c5'), null)      // inactive
  assert.equal(findResponder(leaders, ''), null)
  assert.equal(findResponder(leaders, NOT_LISTED), null)
})

test('a picked contact stands in for the typed address, and only for it', () => {
  const base = { ...emptyParticipation(), unit_name: '8 SCCT', submitter_role: 'Associate Director', slots_offered: '2', hiring_ngrp: true }
  assert.equal(validateParticipation({ ...base, submitter_name: 'Jenita Example', submitter_contact_id: 'c1' }), null)
  assert.equal(participationReady({ ...base, submitter_name: 'Jenita Example', submitter_contact_id: 'c1' }), true)
  assert.match(validateParticipation({ ...base, submitter_name: 'Typed Name' }), /email/)
  assert.match(validateParticipation({ ...base, submitter_contact_id: 'c1' }), /name/)
})

test('the two answers the Owner asked about, and nothing else', () => {
  assert.equal(hiringConcerns({ alumniOutcome: 'would_not_hire_again' }).length, 1)
  assert.equal(hiringConcerns({ wouldConsiderAlumni: 'no' }).length, 1)
  for (const ok of [{}, { alumniOutcome: 'mixed' }, { alumniOutcome: 'successful' }, { wouldConsiderAlumni: 'maybe' }, { wouldConsiderAlumni: 'yes' }]) {
    assert.deepEqual(hiringConcerns(ok), [])
  }
  assert.equal(responseHiringConcerns({ aspire_alumni_outcome: 'would_not_hire_again' }).length, 1)
  assert.deepEqual(responseHiringConcerns(null), [])
})

test('the team alert says Follow up in its subject and body; the confirmation never does', () => {
  const ctx = { unitName: '6 NE', cohortName: 'Spring 2027', slotsOffered: 2, submitterName: 'A B', submitterEmail: 'a@cshs.org', hasFiredAlumni: 'yes', alumniOutcome: 'would_not_hire_again' }
  const alert = unitFormReceived.internal_team(ctx)
  assert.match(alert.subject, /^Follow up: Unit response: 6 NE/)
  assert.match(alert.html, /Follow up with this unit/)
  assert.match(alert.html, /would not hire again/)
  const calm = unitFormReceived.internal_team({ ...ctx, alumniOutcome: 'successful' })
  assert.match(calm.subject, /^Unit response: 6 NE/)
  assert.doesNotMatch(calm.html, /Follow up with this unit/)
  assert.doesNotMatch(unitFormReceived.submitter(ctx).html, /Follow up with this unit/)
})

test('Needs you lists a concern once, opens the response, and returns only on a new answer', () => {
  const now = Date.parse('2026-11-11T12:00:00Z')
  const g = placementGroup({
    today: '2026-11-11', now,
    unitResponses: [
      { unit_id: 'u1', unit_name: '6 NE', would_consider_aspire_alumni: 'no', submitted_by_name: 'A B', last_updated_at: '2026-11-10T12:00:00Z' },
      { unit_id: 'u2', unit_name: '5 North', aspire_alumni_outcome: 'successful' },
    ],
  })
  assert.equal(g.count, 1)
  const row = g.allRows.find(r => r.id === 'unitconcern:u1')
  assert.equal(row.to, '/aggregate?unitResponse=6%20NE')
  assert.equal(row.pill.text, 'Follow up')
  assert.ok(row.sig)
  assert.equal(placementGroup({ today: '2026-11-11', now }), null)
})

test('the endpoints: the lookup sends responders, the submit reads the address from Contacts', () => {
  const lookup = read('api/unit-form-lookup.js')
  assert.match(lookup, /publicResponders\(await loadUnitLeaders\(unitName\)\)/)
  assert.match(lookup, /populationDb\(getDb\(\)\)/)
  // S-10 stands: the guarded half is released by a typed address alone, never by a picked name.
  assert.doesNotMatch(lookup, /submitter_contact_id|contact_id/)
  const submit = read('api/unit-form-submit.js')
  assert.match(submit, /'submitter_contact_id'/)
  assert.match(submit, /findResponder\(await loadUnitLeaders\(unitName\), contactId\)/)
  assert.match(submit, /submitterEmail = responder\.email/)
  const portal = read('api/portal/unit-participation-submit.js')
  assert.match(portal, /if \(!demoScopeFromRequest\(req\)\)[\s\S]{0,40}sendUnitFormConcernAlert/)
  assert.match(read('src/lib/notifications/recipients.js'), /if \(!context\.internalOnly\) recipients\.push/)
})

test('the page: unit, role, name, email in that order, wide on desktop only', () => {
  const page = read('src/components/UnitFormPage.jsx')
  const at = (s) => { const i = page.indexOf(s); assert.ok(i > 0, s); return i }
  assert.ok(at('PARTICIPATION_TEXT.unitLabel') < at('PARTICIPATION_TEXT.roleLabel'))
  assert.ok(at('PARTICIPATION_TEXT.roleLabel') < at('PARTICIPATION_TEXT.nameLabel'))
  assert.ok(at('PARTICIPATION_TEXT.nameLabel') < at('PARTICIPATION_TEXT.emailLabel'))
  assert.match(page, /className="uf-card uf-card-wide"/)
  const css = read('src/index.css')
  assert.match(css, /@media \(min-width: 1024px\) \{\s*\.uf-card\.uf-card-wide \{ max-width: 960px/)
  // The other public forms share .uf-card and keep their width.
  assert.match(css, /\.uf-card \{[^}]*max-width: 640px/)
})

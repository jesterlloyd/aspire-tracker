// test/unitLeadersFromConnect.test.mjs
//
// UNIT-LEADERS-RETIRE-1 (Owner, 2026-09-20): unit leadership is read from ASPIRE Connect >
// Contacts and from nowhere else. These tests hold the adapter's rules, the one CC routing
// rule, and the fact that no production file reads the legacy unit_leaders table any more.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  UNIT_LEADER_CONTACT_COLUMNS, UNIT_LEADER_CATEGORY_VALUES, OPERATIONAL_TITLES,
  unitLeaderRows, findPrimaryLead, findOperationalLeaders, selectUnitFormCc, canonicalUnitLeaderTitle,
} from '../src/lib/unitLeadersFromConnect.js'
import { resolveUnitLeaderGreetingName } from '../src/lib/placementCommunication.js'
import { buildCapacityOutreachRows } from '../src/lib/capacityOutreach.js'

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// A unit as Connect holds it: an AD, two ANMs, a multi-unit NPD-P spelled without the space,
// a Director over several units, an inactive ANM, a contact with no usable email, a Preceptor
// on the same unit, and a pre-canon category with a pre-canon title.
const CONTACTS = [
  { id: 'c1', full_name: 'Lorraine Sheffield', preferred_name: 'Lori', category: 'Unit Leader', role: 'Associate Director', email: 'Lorraine.Sheffield@cshs.org', unit_name: '7 SCCT', related_units: [], is_active: true },
  { id: 'c2', full_name: 'Charlotte Guevarra', category: 'Unit Leadership', role: 'Assistant Nurse Manager', email: 'Charlotte.Guevarra@cshs.org', unit_name: '5 SCCT', related_units: ['7 SCCT'], is_active: true },
  { id: 'c3', full_name: 'Ben Ortiz', category: 'Unit Leader', role: 'Assistant Nurse Manager', email: 'ben@cshs.org', unit_name: '7 SCCT', is_active: true },
  { id: 'c4', full_name: 'Jillian Felice', category: 'Unit Leader', role: 'Unit NPD-P', email: 'Jillian.Felice@cshs.org', unit_name: '7SCCT', related_units: ['6 NE'], is_active: true },
  { id: 'c5', full_name: 'Dana Director', category: 'Unit Leader', role: 'Director', email: 'dana@cshs.org', unit_name: '7 SCCT', related_units: ['6 NE', '5 SCCT'], is_active: true },
  { id: 'c6', full_name: 'Old ANM', category: 'Unit Leader', role: 'Assistant Nurse Manager', email: 'old@cshs.org', unit_name: '7 SCCT', is_active: false },
  { id: 'c7', full_name: 'No Email', category: 'Unit Leader', role: 'Associate Director', email: 'not an address', unit_name: '6 NE', is_active: true },
  { id: 'c8', full_name: 'Pat Preceptor', category: 'Preceptor', role: 'CN III', email: 'pat@cshs.org', unit_name: '7 SCCT', is_active: true },
  { id: 'c9', full_name: 'Exec Over Float', category: 'Unit Leader', role: 'Executive Director', email: 'exec@cshs.org', unit_name: 'Float Pool', is_active: true },
]

test('the adapter selects the columns and categories every reader must ask for', () => {
  for (const col of ['id', 'full_name', 'preferred_name', 'email', 'role', 'role_qualifier', 'category', 'unit_name', 'related_units', 'is_active']) {
    assert.ok(UNIT_LEADER_CONTACT_COLUMNS.split(/,\s*/).includes(col), col)
  }
  assert.deepEqual([...UNIT_LEADER_CATEGORY_VALUES], ['Unit Leader', 'Unit Leadership'])
  assert.deepEqual([...OPERATIONAL_TITLES], ['Assistant Nurse Manager', 'NPD Practitioner', 'Clinical Nurse Specialist'])
  assert.equal(canonicalUnitLeaderTitle('Unit NPD-P'), 'NPD Practitioner')
  assert.equal(canonicalUnitLeaderTitle('Associate Director'), 'Associate Director')
})

test('one row per unit per contact, in the old shape, lead first, and the lead is the Associate Director', () => {
  const rows = unitLeaderRows(CONTACTS, { unitName: '7 SCCT' })
  assert.deepEqual(rows.map(r => [r.full_name, r.role, r.is_primary_lead]), [
    ['Lorraine Sheffield', 'Associate Director', true],
    ['Dana Director', 'Director', false],
    ['Ben Ortiz', 'Assistant Nurse Manager', false],
    ['Charlotte Guevarra', 'Assistant Nurse Manager', false],
    ['Jillian Felice', 'NPD Practitioner', false],
  ])
  assert.ok(rows.every(r => r.unit_name === '7 SCCT'), 'rows carry the requested spelling')
  assert.ok(rows.every(r => r.is_active === true))
  assert.equal(rows[0].preferred_name, 'Lori')
  assert.equal(rows[0].contact_id, 'c1')
  assert.equal(rows[1].preferred_name, null)
  assert.ok(!rows.some(r => r.full_name === 'Old ANM'), 'inactive contacts are not leaders')
  assert.ok(!rows.some(r => r.full_name === 'Pat Preceptor'), 'a Preceptor is not unit leadership')
})

test('a unit with no Associate Director falls to its Director, then to an executive; a unit with neither has no lead', () => {
  const six = unitLeaderRows(CONTACTS, { unitName: '6NE' })
  assert.deepEqual(six.map(r => [r.full_name, r.is_primary_lead]), [['Dana Director', true], ['Jillian Felice', false]])
  assert.ok(!six.some(r => r.full_name === 'No Email'), 'a contact without a usable address is never a leader')
  assert.equal(six[0].unit_name, '6NE', 'the caller gets back the spelling it asked with')
  const float = unitLeaderRows(CONTACTS, { unitName: 'Float Pool' })
  assert.equal(findPrimaryLead(float)?.full_name, 'Exec Over Float')
  const five = unitLeaderRows(CONTACTS, { unitName: '5 SCCT' })
  assert.deepEqual(five.map(r => [r.full_name, r.is_primary_lead]), [['Dana Director', true], ['Charlotte Guevarra', false]])
  const onlyOps = unitLeaderRows([CONTACTS[2], CONTACTS[3]], { unitName: '7 SCCT' })
  assert.equal(findPrimaryLead(onlyOps), null, 'an ANM or NPD-P is never promoted to lead')
  assert.deepEqual(findOperationalLeaders(onlyOps).map(r => r.full_name), ['Ben Ortiz', 'Jillian Felice'])
})

test('all units at once: grouped by unit, a multi-unit contact once per unit, deduplicated by email within a unit', () => {
  const all = unitLeaderRows(CONTACTS)
  const units = [...new Set(all.map(r => r.unit_name))]
  assert.deepEqual(units, ['5 SCCT', '6 NE', '7 SCCT', 'Float Pool'])
  assert.equal(all.filter(r => r.full_name === 'Dana Director').length, 3, 'once per unit she holds')
  assert.equal(all.filter(r => r.unit_name === '7 SCCT' && r.is_primary_lead).length, 1)
  const dup = unitLeaderRows([CONTACTS[0], { ...CONTACTS[0], id: 'dup', email: 'LORRAINE.SHEFFIELD@cshs.org' }], { unitName: '7 SCCT' })
  assert.equal(dup.length, 1, 'the same address twice is one leader')
  assert.deepEqual(unitLeaderRows(null), [])
  assert.deepEqual(unitLeaderRows(CONTACTS, { unitName: 'Nowhere' }), [])
})

test('the unit form CC rule is unchanged: the lead submitted it -> the operational team; anyone else -> the lead; never the submitter', () => {
  const leaders = unitLeaderRows(CONTACTS, { unitName: '7 SCCT' })
  assert.deepEqual(selectUnitFormCc({ leaders, submitterEmail: 'lorraine.sheffield@cshs.org' }).map(c => c.email),
    ['ben@cshs.org', 'Charlotte.Guevarra@cshs.org', 'Jillian.Felice@cshs.org'])
  assert.deepEqual(selectUnitFormCc({ leaders, submitterEmail: 'ben@cshs.org' }),
    [{ name: 'Lorraine Sheffield', preferred_name: 'Lori', email: 'Lorraine.Sheffield@cshs.org' }])
  assert.deepEqual(selectUnitFormCc({ leaders, submitterEmail: 'someone@school.edu' }).map(c => c.email), ['Lorraine.Sheffield@cshs.org'])
  assert.deepEqual(selectUnitFormCc({ leaders: unitLeaderRows(CONTACTS, { unitName: 'Nowhere' }), submitterEmail: 'x@y.org' }), [])
  assert.deepEqual(selectUnitFormCc({ leaders, submitterEmail: '' }), [])
})

test('the greeting and the capacity outreach rows read the adapted rows as they read the old table', () => {
  const leaders = unitLeaderRows(CONTACTS)
  const g = resolveUnitLeaderGreetingName({ unit: { unit_name: '7SCCT' }, leaders, recipientEmails: [] })
  assert.deepEqual(g, { name: 'Lori', source: 'unit_leader_primary' }, 'a spelling variant on the unit still finds its lead')
  const byRecipient = resolveUnitLeaderGreetingName({ unit: { unit_name: '7 SCCT' }, leaders, recipientEmails: ['ben@cshs.org'] })
  assert.deepEqual(byRecipient, { name: 'Ben', source: 'unit_leader_recipient' })
  const rows = buildCapacityOutreachRows({ catalog: [{ name: '7 SCCT', division: 'Critical Care' }, { name: '6 NE', division: 'Med-Surg' }, { name: 'Nowhere', division: 'Other' }], leads: leaders, activeTargetCanons: [] })
  assert.deepEqual(rows.map(r => [r.name, r.hasRecipient, r.recipientEmail]),
    [['7 SCCT', true, 'Lorraine.Sheffield@cshs.org'], ['6 NE', true, 'dana@cshs.org'], ['Nowhere', false, '']])
})

// ── The readers ────────────────────────────────────────────────────────────

test('every former reader now reads contacts through the adapter, and none reads unit_leaders', () => {
  const helpers = read('src/lib/unitLeaders.js')
  assert.match(helpers, /\.from\('contacts'\)/)
  assert.match(helpers, /\.select\(UNIT_LEADER_CONTACT_COLUMNS\)/)
  assert.match(helpers, /\.in\('category', \[\.\.\.UNIT_LEADER_CATEGORY_VALUES\]\)/)
  assert.match(helpers, /\.eq\('is_active', true\)/)
  assert.match(helpers, /return unitLeaderRows\(await fetchUnitLeaderContacts\(\)\)/)
  const routing = read('src/lib/notifications/recipients.js')
  assert.match(routing, /\.from\('contacts'\)[\s\S]{0,200}\.select\(UNIT_LEADER_CONTACT_COLUMNS\)/)
  assert.match(routing, /selectUnitFormCc\(\{ leaders: unitLeaderRows\(contacts \|\| \[\], \{ unitName \}\), submitterEmail \}\)/)
  const keith = read('src/lib/keithKnowledge.js')
  assert.match(keith, /export async function getUnitLeadersForKeith\(supabase\) \{[\s\S]{0,600}\.from\('contacts'\)[\s\S]{0,300}return unitLeaderRows\(data \|\| \[\]\)/)
  assert.match(read('src/components/MatchingTab.jsx'), /queryKey: \['unit_leader_contacts'\],\s*queryFn: getAllUnitLeaders/)
  const overview = read('src/components/OverviewTab.jsx')
  assert.match(overview, /queryKey: \['unit_leader_contacts'\],\s*queryFn:\s+getAllUnitLeaders/)
  assert.match(overview, /primaryLeadMap\[unitNameKey\(response\.unit_name\)\]/)
  assert.match(overview, /Add the Associate Director in ASPIRE Connect, Contacts\./)
  assert.doesNotMatch(overview, /Check unit_leaders table/)
  assert.match(read('src/components/CohortResponseTargetsModal.jsx'), /getAllUnitLeaders\(\)/)
})

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(js|jsx)$/.test(entry.name) && !/ \d+\.(js|jsx)$/.test(entry.name)) yield full
  }
}

test('no production file queries the legacy unit_leaders table', () => {
  const hits = []
  for (const top of ['api', 'lib', 'src']) {
    for (const file of walk(path.join(ROOT, top))) {
      const text = fs.readFileSync(file, 'utf8')
      if (/from\(['"]unit_leaders['"]\)/.test(text)) hits.push(path.relative(ROOT, file))
    }
  }
  assert.deepEqual(hits, [], 'still reading unit_leaders:\n' + hits.join('\n'))
})

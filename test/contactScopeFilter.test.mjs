// test/contactScopeFilter.test.mjs
//
// NA-CONTACTS-SCOPE-1: the School / Division / Unit scope filter, the
// category-organized CSV, and the Other (free text) school acceptance.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CONTACT_SCOPE_GROUPS, contactScopeKind, contactMatchesScope } from '../src/lib/contactScopeFilter.js'
import { buildContactsCsv } from '../src/lib/contactsCsv.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('the dropdown groups come from the catalogs: Schools, Divisions, Units', () => {
  assert.deepEqual(CONTACT_SCOPE_GROUPS.map(g => g.label), ['Schools', 'Divisions', 'Units'])
  const [schools, divisions, units] = CONTACT_SCOPE_GROUPS.map(g => g.options)
  assert.ok(schools.includes('Azusa Pacific University'))
  assert.ok(divisions.includes('Critical Care'))
  assert.ok(units.includes('8 SCCT'))
  assert.equal(contactScopeKind('Azusa Pacific University'), 'school')
  assert.equal(contactScopeKind('Critical Care'), 'division')
  assert.equal(contactScopeKind('8 SCCT'), 'unit')
  assert.equal(contactScopeKind(''), null)
  assert.equal(contactScopeKind('Not A Scope'), null)
})

test('school scope matches by resolved identity; unit scope by the unit list', () => {
  const gary = { school_name: 'Azusa Pacific University', category: 'Academic Partner' }
  const susanByAlias = { school_name: 'APU', category: 'Academic Partner' }
  const csula = { school_name: 'Cal State LA', category: 'Academic Partner' }
  assert.equal(contactMatchesScope(gary, 'Azusa Pacific University'), true)
  assert.equal(contactMatchesScope(susanByAlias, 'Azusa Pacific University'), true, 'aliases resolve')
  assert.equal(contactMatchesScope(csula, 'Azusa Pacific University'), false)

  const jenita = { category: 'Unit Leader', unit_name: '8 SCCT' }
  const lorraine = { category: 'Unit Leader', unit_name: '7 SCCT', related_units: ['8 SCCT'] }
  const elsewhere = { category: 'Unit Leader', unit_name: '6 South' }
  assert.equal(contactMatchesScope(jenita, '8 SCCT'), true)
  assert.equal(contactMatchesScope(lorraine, '8 SCCT'), true, 'related units count')
  assert.equal(contactMatchesScope(elsewhere, '8 SCCT'), false)
})

test('division scope: catalog units (3 SCCT included) plus Services-text executives', () => {
  const carol = { category: 'Nursing Executive', role: 'Executive Director', services: 'Critical Care Services' }
  const threeScct = { category: 'Unit Leader', unit_name: '3 SCCT' }
  const sixNw = { category: 'Preceptor', unit_name: '6 NW' }
  const medical = { category: 'Unit Leader', unit_name: '6 South' }
  assert.equal(contactMatchesScope(carol, 'Critical Care'), true, 'Services text mentions the division')
  assert.equal(contactMatchesScope(threeScct, 'Critical Care'), true, '3 SCCT is Critical Care per the catalog')
  assert.equal(contactMatchesScope(sixNw, 'Critical Care'), true)
  assert.equal(contactMatchesScope(medical, 'Critical Care'), false)
  // Empty scope matches everyone.
  assert.equal(contactMatchesScope(medical, ''), true)
})

test('the CSV is organized by category in canonical order, with escaping', () => {
  const csv = buildContactsCsv([
    { full_name: 'Gary Mittelberg', category: 'Academic Partner', role: 'Assistant Professor', school_name: 'Azusa Pacific University', email: 'g@apu.edu' },
    { full_name: 'Margo "M" Minissian', category: 'BNI Team', role: 'Executive Director', organization: 'Cedars-Sinai Medical Center' },
    { full_name: 'Lorraine Sheffield', category: 'Unit Leader', role: 'Associate Director', unit_name: '7 SCCT', related_units: ['8 SCCT'] },
  ])
  const lines = csv.split('\n')
  assert.match(lines[0], /"Category","Name","Preferred Name","Role \/ Title","School \/ Organization","Units","Services \/ Programs","Email","Phone"/)
  // Canonical category order: Academic Partner, then Unit Leader, then BNI Team.
  assert.ok(lines[1].startsWith('"Academic Partner","Gary Mittelberg"'))
  assert.ok(lines[2].startsWith('"Unit Leader","Lorraine Sheffield"'))
  assert.match(lines[2], /"7 SCCT; 8 SCCT"/)
  assert.ok(lines[3].startsWith('"BNI Team","Margo ""M"" Minissian"'), 'inner quotes doubled')
})

test('the view wires the scope into the whole pipeline and the CSV button', () => {
  const view = read('src/portal/na/AcademicsContactsView.jsx')
  // Scope narrows counts, list, and every selection site.
  assert.match(view, /const scopedContacts = useMemo\(\(\) => directoryContacts\.filter\(contact => contactMatchesScope\(contact, scope\)\)/)
  assert.match(view, /scopedContacts\.forEach\(contact => getContactCategories/)
  assert.match(view, /const chooseScope = value =>/)
  // The dropdown sits between search and Add contact, grouped by kind.
  assert.match(view, /ptl-na-scope-filter/)
  assert.match(view, /CONTACT_SCOPE_GROUPS\.map\(group => \(/)
  // The CSV exports the VISIBLE contacts with the Community Benefit button style.
  assert.match(view, /downloadCSV\(buildContactsCsv\(filtered\), 'aspire-contacts\.csv'\)/)
  assert.match(view, /ptl-na-contacts-export/)
  const css = read('src/portal/portal.css')
  assert.match(css, /\.ptl-na-contacts-export \{[\s\S]{0,300}?background: var\(--nightfall, #1D2567\)/)
})

test('Other school: both editors offer it; both servers accept unknown schools as typed', () => {
  const portal = read('src/portal/na/AcademicsContactsView.jsx')
  const staff = read('src/components/connect/ContactsView.jsx')
  for (const src of [portal, staff]) {
    assert.match(src, /CUSTOM_SCHOOL = '__other_school__'/)
    assert.match(src, /<option value=\{CUSTOM_SCHOOL\}>Other<\/option>/)
    assert.match(src, /Type the school name/)
    // The Role/Title escape hatch reads plain "Other" now.
    assert.match(src, /<option value=\{CUSTOM_TITLE\}>Other<\/option>/)
    assert.doesNotMatch(src, /Other \(free text\)</)
  }
  const portalApi = read('api/portal/academics-contacts.js')
  assert.match(portalApi, /resolved\?\.displayName \|\| String\(raw\)\.trim\(\)/)
  assert.doesNotMatch(portalApi, /'invalid_school' \}\s*\n\s*payload\.school_name = school\n\s*payload\.organization = school\n\s*\}\s*else if \(kind === 'csmc'\)[\s\S]*existing\?\.school_name && raw === existing\.school_name/)
  const staffApi = read('api/contacts-upsert.js')
  assert.match(staffApi, /resolved\?\.displayName \|\| String\(raw\)\.trim\(\)/)
  assert.doesNotMatch(staffApi, /Unknown school:/)
})

// ── NA-CONTACTS-SCOPE-2: scoped chain-of-command order, aliases, umbrella ───

test('a unit or division scope leads with NE, UL, Preceptor; school scopes do not', async () => {
  const { scopedCategoryOrder } = await import('../src/lib/contactScopeFilter.js')
  const base = ['Academic Partner', 'Unit Leader', 'Preceptor', 'BNI Team', 'Nursing Executive', 'Other']
  assert.deepEqual(scopedCategoryOrder('8 SCCT', base).slice(0, 3), ['Nursing Executive', 'Unit Leader', 'Preceptor'])
  assert.deepEqual(scopedCategoryOrder('Medical', base).slice(0, 3), ['Nursing Executive', 'Unit Leader', 'Preceptor'])
  assert.deepEqual(scopedCategoryOrder('Azusa Pacific University', base), base)
  assert.deepEqual(scopedCategoryOrder('', base), base)
})

test('division service aliases: Dan Sabin\'s "OR Operations" matches Procedural, word-bounded', () => {
  assert.equal(contactMatchesScope({ services: 'OR Operations' }, 'Procedural'), true)
  assert.equal(contactMatchesScope({ services: 'Perioperative Services' }, 'Procedural'), true)
  // A lowercase word "or" must never match the OR alias.
  assert.equal(contactMatchesScope({ services: 'Medicine or Surgery' }, 'Procedural'), false)
  assert.equal(contactMatchesScope({ services: 'Doctor of Nursing' }, 'Procedural'), false)
})

test('the West Coast University umbrella is hidden from pickers but still resolves', async () => {
  const { SCHOOL_PICKER_OPTIONS, resolveOperativeSchoolName, SCHOOL_IDENTITY_GROUPS } = await import('../src/lib/schoolIdentity.js')
  assert.ok(!SCHOOL_PICKER_OPTIONS.includes('West Coast University'), 'umbrella hidden from pickers')
  assert.ok(SCHOOL_PICKER_OPTIONS.includes('West Coast University North Hollywood'))
  assert.ok(SCHOOL_PICKER_OPTIONS.includes('West Coast University Anaheim'))
  // Legacy resolution keeps working: a stored bare WCU still resolves.
  assert.equal(resolveOperativeSchoolName('WCU')?.displayName, 'West Coast University')
  assert.ok(SCHOOL_IDENTITY_GROUPS.some(g => g.operative === 'West Coast University' && g.legacyOnly === true))
  // The scope dropdown and BOTH editors consume the picker list.
  const schools = CONTACT_SCOPE_GROUPS.find(g => g.label === 'Schools').options
  assert.ok(!schools.includes('West Coast University'))
  assert.match(read('src/portal/na/AcademicsContactsView.jsx'), /SCHOOL_AFFILIATION_OPTIONS = SCHOOL_PICKER_OPTIONS/)
  assert.match(read('src/components/connect/ContactsView.jsx'), /SCHOOL_AFFILIATION_OPTIONS = SCHOOL_PICKER_OPTIONS/)
})

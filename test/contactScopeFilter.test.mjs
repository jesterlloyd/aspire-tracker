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
  // NA-CONTACTS-SCOPE-3: options are { value, label } now (labels are display-only).
  const [schools, divisions, units] = CONTACT_SCOPE_GROUPS.map(g => g.options.map(o => o.value))
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
  assert.match(lines[0], /"Category","Name","Preferred Name","Role \/ Title","School \/ Organization","Units","Divisions","Services \/ Programs","Email","Phone"/)
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
  const schools = CONTACT_SCOPE_GROUPS.find(g => g.label === 'Schools').options.map(o => o.value)
  assert.ok(!schools.includes('West Coast University'))
  assert.match(read('src/portal/na/AcademicsContactsView.jsx'), /SCHOOL_AFFILIATION_OPTIONS = SCHOOL_PICKER_OPTIONS/)
  assert.match(read('src/components/connect/ContactsView.jsx'), /SCHOOL_AFFILIATION_OPTIONS = SCHOOL_PICKER_OPTIONS/)
})

// ── NA-CONTACTS-SCOPE-3: the three ordering rules, and the WCU display label ──

test('Units are straight alphanumeric across the catalog, so floors read together', () => {
  const units = CONTACT_SCOPE_GROUPS.find(g => g.label === 'Units').options.map(o => o.value)
  // The reported complaint: 3 North / 3 SCCT / 3 South Short Stay were split
  // across three division blocks, and 6 NE / 6 NW led the SCCTs.
  assert.deepEqual(units.slice(0, 6), [
    '3 North', '3 SCCT', '3 South Short Stay', '4 North', '4 SCCT', '4 South',
  ])
  assert.deepEqual(units.slice(9, 13), ['6 NE', '6 NW', '6 SCCT', '6 South'])
  // Numbered units sort ahead of named ones; named ones are alphabetical.
  assert.deepEqual(units.slice(-10), [
    'ACU/CDU', 'Emergency Department', 'Float Pool', 'Labor & Delivery', 'NICU',
    'Operating Room', 'PACU', 'Pediatrics', 'PICU', 'Transfer Center',
  ])
  // Numeric-aware, not lexicographic: a hypothetical 10 would follow 9, not 1.
  assert.ok(units.indexOf('8 SCCT') > units.indexOf('7 SCCT'))
})

test('Divisions follow the app-wide DIVISION_ORDER (Procedural before Support)', async () => {
  const { DIVISION_ORDER } = await import('../src/lib/unitCatalog.js')
  const divisions = CONTACT_SCOPE_GROUPS.find(g => g.label === 'Divisions').options.map(o => o.value)
  assert.deepEqual(divisions, DIVISION_ORDER.filter(d => divisions.includes(d)))
  assert.ok(divisions.indexOf('Procedural') < divisions.indexOf('Support'))
})

test('Schools sort alphabetically by their DISPLAY label; WCU reads short but writes long', async () => {
  const { SCHOOL_PICKER_ITEMS, schoolPickerLabel } = await import('../src/lib/schoolIdentity.js')
  assert.deepEqual(SCHOOL_PICKER_ITEMS.map(i => i.label), [
    'Azusa Pacific University', 'Cal State LA', 'Cal State Long Beach',
    'Cal State Northridge', 'UCLA', 'WCU - Anaheim', 'WCU - North Hollywood',
  ])
  // The VALUE is untouched: nothing stored changes, no migration.
  assert.equal(SCHOOL_PICKER_ITEMS.find(i => i.label === 'WCU - Anaheim').value, 'West Coast University Anaheim')
  assert.equal(schoolPickerLabel('West Coast University North Hollywood'), 'WCU - North Hollywood')
  assert.equal(schoolPickerLabel('UCLA'), 'UCLA', 'no pickerLabel = the operative name')
  assert.equal(schoolPickerLabel('Some Unknown School'), 'Some Unknown School')
  // Both editors render the label while still writing the operative value.
  for (const p of ['src/portal/na/AcademicsContactsView.jsx', 'src/components/connect/ContactsView.jsx']) {
    assert.match(read(p), /SCHOOL_AFFILIATION_OPTIONS\.map\(s => <option key=\{s\} value=\{s\}>\{schoolPickerLabel\(s\)\}<\/option>\)/)
  }
})

test('the short WCU labels also resolve, so a pasted "WCU - Anaheim" is not a new school', async () => {
  const { resolveOperativeSchoolName } = await import('../src/lib/schoolIdentity.js')
  assert.equal(resolveOperativeSchoolName('WCU - Anaheim')?.displayName, 'West Coast University Anaheim')
  assert.equal(resolveOperativeSchoolName('WCU - North Hollywood')?.displayName, 'West Coast University North Hollywood')
})

// ── NA-CONTACTS-SCOPE-4: scoped sort key, explicit divisions, new division ──

test('a Unit Leader sorts on the unit IN SCOPE, so the title tier is not shadowed', async () => {
  const { sortContactsForCategory } = await import('../src/lib/contactCategories.js')
  const { scopeUnitSet } = await import('../src/lib/contactScopeFilter.js')
  // The reported case: a multi-unit NPD Practitioner whose PRIMARY unit sorts
  // before the filtered unit was jumping the unit's own Assistant Nurse Manager.
  const weiting = {
    full_name: 'Weiting Chan', category: 'Unit Leader', role: 'NPD Practitioner',
    unit_name: '3 SCCT', related_units: ['4 SCCT', '6 SCCT'],
  }
  const jake = { full_name: 'Jake Cornett', category: 'Unit Leader', role: 'Assistant Nurse Manager', unit_name: '6 SCCT' }

  const unscoped = sortContactsForCategory([jake, weiting], 'Unit Leader').map(c => c.full_name)
  assert.deepEqual(unscoped, ['Weiting Chan', 'Jake Cornett'], 'unfiltered still sorts by primary unit: 3 SCCT before 6 SCCT')

  const scoped = sortContactsForCategory([weiting, jake], 'Unit Leader', { scopeUnits: scopeUnitSet('6 SCCT') })
  assert.deepEqual(scoped.map(c => c.full_name), ['Jake Cornett', 'Weiting Chan'], 'ANM (tier 2) leads NPD-P (tier 3)')

  // 6 NW, the second reported case.
  const omar = { full_name: 'Omar Tinio', category: 'Unit Leader', role: 'NPD Practitioner', unit_name: '6 NE', related_units: ['6 NW'] }
  const joyce = { full_name: 'Joyce Serpas', category: 'Unit Leader', role: 'Assistant Nurse Manager', unit_name: '6 NW' }
  assert.deepEqual(
    sortContactsForCategory([omar, joyce], 'Unit Leader', { scopeUnits: scopeUnitSet('6 NW') }).map(c => c.full_name),
    ['Joyce Serpas', 'Omar Tinio'],
  )
})

test('a division scope keys on a unit inside that division, still grouping by unit', async () => {
  const { sortContactsForCategory } = await import('../src/lib/contactCategories.js')
  const { scopeUnitSet } = await import('../src/lib/contactScopeFilter.js')
  const surgicalUnits = scopeUnitSet('Surgical')
  // Primary unit is Critical Care; the Surgical unit they also cover is what
  // the reader sees under a Surgical filter, so that is the sort key.
  const roving = { full_name: 'Rover NPD', category: 'Unit Leader', role: 'NPD Practitioner', unit_name: '3 SCCT', related_units: ['8 South'] }
  const sevenNorth = { full_name: 'Seven North ANM', category: 'Unit Leader', role: 'Assistant Nurse Manager', unit_name: '7 North' }
  assert.deepEqual(
    sortContactsForCategory([roving, sevenNorth], 'Unit Leader', { scopeUnits: surgicalUnits }).map(c => c.full_name),
    ['Seven North ANM', 'Rover NPD'], '7 North before 8 South, by unit as usual',
  )
  // A school scope contributes no units, so nothing changes.
  assert.equal(scopeUnitSet('UCLA'), null)
  assert.equal(scopeUnitSet(''), null)
})

test('an executive matches a division by the explicit divisions list, not just Services text', () => {
  // Claude Stang: his Services line names his remit, not a division.
  const stang = {
    full_name: 'Claude Stang', category: 'Nursing Executive', role: 'Executive Director',
    services: 'Clinical Operations', divisions: ['Emergency'],
  }
  assert.equal(contactMatchesScope(stang, 'Emergency'), true)
  assert.equal(contactMatchesScope(stang, 'Critical Care'), false, 'only the divisions he actually covers')
  // Nothing that resolved before stops: units and Services text still match.
  assert.equal(contactMatchesScope({ services: 'Critical Care Services' }, 'Critical Care'), true)
  assert.equal(contactMatchesScope({ unit_name: '8 SCCT' }, 'Critical Care'), true)
  // An absent or malformed list is simply no match, never a throw.
  assert.equal(contactMatchesScope({ divisions: null }, 'Emergency'), false)
  assert.equal(contactMatchesScope({ divisions: ['  ', 'Emergency'] }, 'Emergency'), true)
})

test('Capacity Management is a real division with Transfer Center in it', async () => {
  const { CONTACT_DIVISION_OPTIONS, scopeUnitSet } = await import('../src/lib/contactScopeFilter.js')
  const { getUnit, DIVISION_ORDER } = await import('../src/lib/unitCatalog.js')
  assert.ok(CONTACT_DIVISION_OPTIONS.includes('Capacity Management'))
  // Approved slot: after Support, before Emergency.
  assert.equal(DIVISION_ORDER.indexOf('Capacity Management'), DIVISION_ORDER.indexOf('Support') + 1)
  assert.ok(DIVISION_ORDER.indexOf('Capacity Management') < DIVISION_ORDER.indexOf('Emergency'))
  assert.equal(getUnit('Transfer Center')?.division, 'Capacity Management')
  // Directory-only: never offered as an ASPIRE student placement unit.
  assert.equal(getUnit('Transfer Center')?.defaultEligible, false)
  assert.deepEqual([...scopeUnitSet('Capacity Management')], ['Transfer Center'])
  // Heidi High, ED over Capacity Management, resolves through the divisions list.
  const heidi = { category: 'Nursing Executive', role: 'Executive Director', divisions: ['Capacity Management'] }
  assert.equal(contactMatchesScope(heidi, 'Capacity Management'), true)
})

test('the Divisions field is Nursing Executive + Executive Director only, in both editors', async () => {
  const { showsDivisionsField, contactDivisionList } = await import('../src/lib/contactCategories.js')
  assert.equal(showsDivisionsField('Nursing Executive', 'Executive Director'), true)
  assert.equal(showsDivisionsField('Nursing Executive', 'Manager'), false)
  assert.equal(showsDivisionsField('Unit Leader', 'Executive Director'), false)
  assert.equal(showsDivisionsField('BNI Team', 'Executive Director'), false)
  // Shape normalization: trims, de-duplicates, tolerates junk.
  assert.deepEqual(contactDivisionList({ divisions: [' Emergency ', 'Emergency', '', null] }), ['Emergency'])
  assert.deepEqual(contactDivisionList({}), [])
  assert.deepEqual(contactDivisionList({ divisions: 'Emergency' }), [], 'a bare string is not a list')

  for (const p of ['src/portal/na/AcademicsContactsView.jsx', 'src/components/connect/ContactsView.jsx']) {
    const src = read(p)
    assert.match(src, /showDivisions = showsDivisionsField\(cat, /)
    assert.match(src, /DIVISION_PICKER_OPTIONS = CONTACT_DIVISION_OPTIONS\.map/)
    assert.match(src, /selected=\{form(Data)?\.divisions( \|\| \[\])?\}/)
    // Hiding the field clears it rather than leaving a stale division behind.
    assert.match(src, /divisions: showDivisions \? /)
  }
})

test('both write endpoints validate divisions against the catalog and fail closed pre-migration', () => {
  const portalApi = read('api/portal/academics-contacts.js')
  assert.match(portalApi, /GATED_FIELDS = Object\.freeze\(\['services', 'divisions'\]\)/)
  assert.match(portalApi, /if \(payload\.divisions\.some\(d => !CANONICAL_DIVISIONS\.has\(d\)\)\) return \{ error: 'invalid_divisions' \}/)
  assert.match(portalApi, /if \(!showsDivisionsField\(effCat, effRole\)\) return \{ error: 'invalid_divisions' \}/)
  // The readiness guard is generic over the gated columns now.
  assert.match(portalApi, /return `\$\{field\}_unavailable`/)
  const staffApi = read('api/contacts-upsert.js')
  assert.match(staffApi, /Unknown division\(s\)/)
  assert.match(staffApi, /divisions applies only to Nursing Executive contacts with the Executive Director title/)
  assert.match(staffApi, /The divisions field is not available until the contacts divisions migration is applied/)
  // The migration is authored but Owner-gated, and additive only.
  const sql = read('supabase/migrations/20260829000000_contacts_divisions.sql')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS divisions text\[\] NOT NULL DEFAULT '\{\}'::text\[\]/)
  assert.match(sql, /DROP COLUMN IF EXISTS divisions/, 'rollback documented')
})

test('a unit Director outranks the unit\'s own leadership chain, not the unranked tier', async () => {
  const { sortContactsForCategory } = await import('../src/lib/contactCategories.js')
  const { scopeUnitSet } = await import('../src/lib/contactScopeFilter.js')
  // Reported 2026-08-27: "Director" was free text, so it fell to tier 99 and
  // sorted below everyone on its own unit.
  const jeremy = { full_name: 'Jeremy Miller', category: 'Unit Leader', role: 'Director', unit_name: 'Transfer Center' }
  const tom = { full_name: 'Tom Christen', category: 'Unit Leader', role: 'Assistant Nurse Manager', unit_name: 'Transfer Center' }
  for (const scope of ['Transfer Center', 'Capacity Management']) {
    assert.deepEqual(
      sortContactsForCategory([tom, jeremy], 'Unit Leader', { scopeUnits: scopeUnitSet(scope) }).map(c => c.full_name),
      ['Jeremy Miller', 'Tom Christen'], `under the ${scope} scope`,
    )
  }
  // Director sits BELOW an acting Executive Director and ABOVE Associate Director.
  const ranked = sortContactsForCategory([
    { full_name: 'AD', category: 'Unit Leader', role: 'Associate Director', unit_name: 'Transfer Center' },
    { full_name: 'Dir', category: 'Unit Leader', role: 'Director', unit_name: 'Transfer Center' },
    { full_name: 'Exec', category: 'Unit Leader', role: 'Executive Director', unit_name: 'Transfer Center' },
    { full_name: 'Unranked', category: 'Unit Leader', role: 'Coordinator', unit_name: 'Transfer Center' },
  ], 'Unit Leader').map(c => c.full_name)
  assert.deepEqual(ranked, ['Exec', 'Dir', 'AD', 'Unranked'])
})

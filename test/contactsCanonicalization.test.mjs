// CONTACTS-CANON-1: the canonical contacts vocabulary (categories, titles,
// affiliation, multi-unit, services) across the shared module, the migration,
// both write endpoints, and both editors.
// Pure unit and source assertions. No network, no live database, no email.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CONTACT_CATEGORY_ORDER,
  CONTACT_CATEGORY_PLURAL_LABELS,
  categoryPluralLabel,
  LEGACY_CATEGORY_MAP,
  canonicalCategory,
  contactServicesMeta,
  contactListSubline,
  sortContactsForCategory,
  CONTACT_ROLE_TITLES,
  TITLE_FREE_TEXT_CATEGORIES,
  titleOptionsFor,
  titleAllowsFreeText,
  isTitleAllowed,
  LEGACY_TITLE_MAP,
  affiliationKind,
  showsUnitAffiliation,
  showsServicesField,
  contactUnitList,
  splitUnitList,
  CSMC_AFFILIATION,
  categoryChipColors,
  getPrimaryCategory,
  getContactCategories,
} from '../src/lib/contactCategories.js'
import { matchCatalogKeys, contactUnitValues, CONTACT_SEARCH_COLUMNS } from '../src/lib/contactSearchCore.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ||= 'anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'service-key'

const MIGRATION = read('supabase/migrations/20260826000000_contacts_canonicalization.sql')

// ── The canonical vocabulary ─────────────────────────────────────────────────

test('the six canonical categories are singular, in product order', () => {
  assert.deepEqual(CONTACT_CATEGORY_ORDER, [
    'Academic Partner', 'Unit Leader', 'Preceptor', 'BNI Team', 'Nursing Executive', 'Other',
  ])
})

test('legacy stored values resolve to canonical; junk resolves to null', () => {
  assert.equal(canonicalCategory('Academic Partners'), 'Academic Partner')
  assert.equal(canonicalCategory('Unit Leadership'), 'Unit Leader')
  assert.equal(canonicalCategory('Preceptors'), 'Preceptor')
  assert.equal(canonicalCategory('Nursing Executives'), 'Nursing Executive')
  assert.equal(canonicalCategory('BNI Team'), 'BNI Team')
  assert.equal(canonicalCategory('Other'), 'Other')
  assert.equal(canonicalCategory('Unit Leader'), 'Unit Leader')
  assert.equal(canonicalCategory('whatever'), null)
  assert.equal(canonicalCategory(''), null)
  assert.deepEqual(Object.keys(LEGACY_CATEGORY_MAP).sort(), [
    'Academic Partners', 'Nursing Executives', 'Preceptors', 'Unit Leadership',
  ])
})

test('the per-category title lists are exactly the approved canon', () => {
  assert.deepEqual(CONTACT_ROLE_TITLES['Unit Leader'], [
    'Associate Director', 'Interim Associate Director', 'Assistant Nurse Manager',
    'NPD Practitioner', 'Clinical Nurse Specialist',
  ])
  assert.deepEqual(CONTACT_ROLE_TITLES['Academic Partner'], [
    'Program Coordinator', 'Assistant Professor', 'Clinical Placement Coordinator',
    'Manager', 'Clinical Faculty',
  ])
  assert.deepEqual(CONTACT_ROLE_TITLES['BNI Team'], [
    'Executive Director', 'NPD Practitioner', 'Program/Project Coordinator',
    'Lead Administrative Assistant',
  ])
  assert.deepEqual(CONTACT_ROLE_TITLES['Nursing Executive'], [
    'SVP, Chief Nursing Executive', 'VP of Nursing and Therapies', 'Executive Director', 'Manager',
  ])
  assert.deepEqual(CONTACT_ROLE_TITLES['Preceptor'], ['CN II', 'CN III'])
  assert.deepEqual(CONTACT_ROLE_TITLES['Other'], ['Talent Acquisition'])
  // Free text ONLY where the canon allows it.
  assert.deepEqual(TITLE_FREE_TEXT_CATEGORIES, ['Academic Partner', 'Other'])
  assert.equal(titleAllowsFreeText('Unit Leader'), false)
  assert.equal(titleAllowsFreeText('Academic Partners'), true) // legacy input resolves first
})

test('title validation: dropdown, free text where allowed, unchanged legacy passthrough, empty ok', () => {
  assert.equal(isTitleAllowed('Unit Leader', 'NPD Practitioner'), true)
  assert.equal(isTitleAllowed('Unit Leader', 'Wizard'), false)
  assert.equal(isTitleAllowed('Unit Leader', 'Unit NPD-P', 'Unit NPD-P'), true)   // unchanged legacy
  assert.equal(isTitleAllowed('Unit Leader', 'Unit NPD-P', 'Associate Director'), false) // NEW legacy refused
  assert.equal(isTitleAllowed('Academic Partner', 'Dean of Nursing'), true)       // free text allowed
  assert.equal(isTitleAllowed('Other', 'Anything At All'), true)
  assert.equal(isTitleAllowed('Preceptor', ''), true)                             // no title is valid
  assert.equal(isTitleAllowed('Preceptor', 'CN IV'), false)
})

test('the certain legacy title mappings are the JS mirror of the SQL pass', () => {
  assert.equal(LEGACY_TITLE_MAP['Unit Leader']['Unit NPD-P'], 'NPD Practitioner')
  assert.equal(LEGACY_TITLE_MAP['Preceptor']['Preceptor'], '')
  assert.match(MIGRATION, /SET role = 'NPD Practitioner'\s*\nWHERE category = 'Unit Leader' AND role IN \('Unit NPD-P', 'Unit NPD Practitioner'\)/)
  assert.match(MIGRATION, /SET role = NULL\s*\nWHERE category = 'Preceptor' AND role IN \('Preceptor', 'Clinical Preceptor'\)/)
})

test('affiliation kinds: school for Academic Partner, choice for Other, Cedars-Sinai for the rest', () => {
  assert.equal(affiliationKind('Academic Partner'), 'school')
  assert.equal(affiliationKind('Other'), 'choice')
  for (const c of ['Unit Leader', 'Preceptor', 'BNI Team', 'Nursing Executive']) {
    assert.equal(affiliationKind(c), 'csmc', c)
  }
  assert.equal(CSMC_AFFILIATION, 'Cedars-Sinai Medical Center')
})

test('unit affiliation exists ONLY for Unit Leader and Preceptor', () => {
  assert.equal(showsUnitAffiliation('Unit Leader'), true)
  assert.equal(showsUnitAffiliation('Preceptor'), true)
  for (const c of ['Academic Partner', 'BNI Team', 'Nursing Executive', 'Other']) {
    assert.equal(showsUnitAffiliation(c), false, c)
  }
})

test('Services appears only for a Nursing Executive with the Executive Director title', () => {
  assert.equal(showsServicesField('Nursing Executive', 'Executive Director'), true)
  assert.equal(showsServicesField('Nursing Executive', 'Manager'), false)
  assert.equal(showsServicesField('BNI Team', 'Executive Director'), false)
  assert.equal(showsServicesField('Nursing Executives', 'Executive Director'), true) // legacy category input
})

test('the services meta labels the ONE stored field per category: NE Services, BNI Programs', () => {
  assert.deepEqual(contactServicesMeta('Nursing Executive', 'Executive Director'), { label: 'Services' })
  assert.equal(contactServicesMeta('Nursing Executive', 'Manager'), null)
  assert.deepEqual(contactServicesMeta('BNI Team', 'NPD Practitioner'), { label: 'Programs' })
  assert.deepEqual(contactServicesMeta('BNI Team', ''), { label: 'Programs' })
  assert.equal(contactServicesMeta('Unit Leader', 'Associate Director'), null)
})

test('display labels are plural (Others with the s); stored values stay singular', () => {
  assert.deepEqual(CONTACT_CATEGORY_PLURAL_LABELS, {
    'Academic Partner': 'Academic Partners',
    'Unit Leader': 'Unit Leaders',
    'Preceptor': 'Preceptors',
    'BNI Team': 'BNI Team',
    'Nursing Executive': 'Nursing Executives',
    'Other': 'Others',
  })
  assert.equal(categoryPluralLabel('Unit Leadership'), 'Unit Leaders') // legacy input resolves
  assert.deepEqual(CONTACT_CATEGORY_ORDER, [
    'Academic Partner', 'Unit Leader', 'Preceptor', 'BNI Team', 'Nursing Executive', 'Other',
  ])
})

test('the row subline is per-category: school / units / Programs / Services / affiliation', () => {
  assert.equal(contactListSubline({ category: 'Academic Partner', school_name: 'UCLA', organization: 'UCLA' }), 'UCLA')
  assert.equal(contactListSubline({ category: 'Unit Leader', unit_name: '6 NE', related_units: ['6 NW'] }), '6 NE, 6 NW')
  assert.equal(contactListSubline({ category: 'Preceptor', unit_name: '3 SCCT' }), '3 SCCT')
  assert.equal(contactListSubline({ category: 'BNI Team', services: 'ASPIRE, NGRP' }), 'ASPIRE, NGRP')
  // Nursing Executive: Services, with stored units as the fallback (the
  // acting-AD exception is data, never a name-keyed rule).
  assert.equal(contactListSubline({ category: 'Nursing Executive', services: 'Critical Care Services', unit_name: '3 SCCT' }), 'Critical Care Services')
  assert.equal(contactListSubline({ category: 'Nursing Executive', unit_name: 'Float Pool' }), 'Float Pool')
  assert.equal(contactListSubline({ category: 'Other', organization: 'LA County DHS' }), 'LA County DHS')
})

test('the category sort engine follows the approved tiers in both directories', () => {
  // Unit Leaders: unit ascending, then AD/Interim AD > ANM > NPD-P/CNS, then name.
  const ul = sortContactsForCategory([
    { full_name: 'Zoe', category: 'Unit Leader', role: 'Assistant Nurse Manager', unit_name: '3 North' },
    { full_name: 'Amy', category: 'Unit Leader', role: 'NPD Practitioner', unit_name: '3 North' },
    { full_name: 'Bea', category: 'Unit Leader', role: 'Associate Director', unit_name: '3 SCCT' },
    { full_name: 'Cam', category: 'Unit Leader', role: 'Interim Associate Director', unit_name: '3 North' },
    { full_name: 'Dee', category: 'Unit Leader', role: 'Clinical Nurse Specialist', unit_name: '3 North' },
  ], 'Unit Leader').map(c => c.full_name)
  assert.deepEqual(ul, ['Cam', 'Zoe', 'Amy', 'Dee', 'Bea'])

  // BNI: ED > Lead Administrative Assistant > NPD-P (A-Z) > Project Coordinator (A-Z).
  const bni = sortContactsForCategory([
    { full_name: 'Nia', category: 'BNI Team', role: 'NPD Practitioner' },
    { full_name: 'Pat', category: 'BNI Team', role: 'Program/Project Coordinator' },
    { full_name: 'Margo', category: 'BNI Team', role: 'Executive Director' },
    { full_name: 'Abe', category: 'BNI Team', role: 'Lead Administrative Assistant' },
    { full_name: 'Ana', category: 'BNI Team', role: 'NPD Practitioner' },
  ], 'BNI Team').map(c => c.full_name)
  assert.deepEqual(bni, ['Margo', 'Abe', 'Ana', 'Nia', 'Pat'])

  // Nursing Executives: SVP > VP > Executive Directors (A-Z) > Managers.
  const ne = sortContactsForCategory([
    { full_name: 'Mia', category: 'Nursing Executive', role: 'Manager' },
    { full_name: 'Carol', category: 'Nursing Executive', role: 'Executive Director' },
    { full_name: 'David', category: 'Nursing Executive', role: 'SVP, Chief Nursing Executive' },
    { full_name: 'Ann', category: 'Nursing Executive', role: 'Executive Director' },
    { full_name: 'Vera', category: 'Nursing Executive', role: 'VP of Nursing and Therapies' },
  ], 'Nursing Executive').map(c => c.full_name)
  assert.deepEqual(ne, ['David', 'Vera', 'Ann', 'Carol', 'Mia'])

  // Academic Partners: school then name; Preceptors/Others: name.
  const ap = sortContactsForCategory([
    { full_name: 'Zed', category: 'Academic Partner', school_name: 'Cal State LA' },
    { full_name: 'Amy', category: 'Academic Partner', school_name: 'UCLA' },
    { full_name: 'Bob', category: 'Academic Partner', school_name: 'Cal State LA' },
  ], 'Academic Partner').map(c => c.full_name)
  assert.deepEqual(ap, ['Bob', 'Zed', 'Amy'])
  const pre = sortContactsForCategory([
    { full_name: 'Beth', category: 'Preceptor' }, { full_name: 'Al', category: 'Preceptor' },
  ], 'Preceptor').map(c => c.full_name)
  assert.deepEqual(pre, ['Al', 'Beth'])
})

test('alphabetization follows the DISPLAYED name: Jun Bagunu files under J, not A', async () => {
  const { contactDisplayName } = await import('../src/lib/contactCategories.js')
  assert.equal(contactDisplayName({ full_name: 'Adolfo Bagunu', preferred_name: 'Jun' }), 'Jun Bagunu')
  assert.equal(contactDisplayName({ full_name: 'Susan Hunter' }), 'Susan Hunter')
  assert.equal(contactDisplayName({ full_name: 'Sue Hunter', preferred_name: 'Sue' }), 'Sue Hunter')
  const sorted = sortContactsForCategory([
    { full_name: 'Adolfo Bagunu', preferred_name: 'Jun', category: 'Preceptor' },
    { full_name: 'Beth Cruz', category: 'Preceptor' },
  ], 'Preceptor').map(c => c.full_name)
  // Jun (displayed) sorts after Beth, even though Adolfo would sort before.
  assert.deepEqual(sorted, ['Beth Cruz', 'Adolfo Bagunu'])
})

test('an acting executive over a unit joins Unit Leaders and tops that unit', async () => {
  const { getContactCategories: cats, sortContactsForCategory: sortCat } = await import('../src/lib/contactCategories.js')
  const charina = { full_name: 'Charina Emerson', category: 'Nursing Executive', role: 'Executive Director', unit_name: null, related_units: ['Float Pool'] }
  assert.ok(cats(charina).includes('Unit Leader'))
  assert.ok(cats(charina).includes('Nursing Executive'))
  // Within the Float Pool group, the acting executive outranks the AD.
  const sorted = sortCat([
    { full_name: 'Ada Dee', category: 'Unit Leader', role: 'Associate Director', unit_name: 'Float Pool' },
    charina,
    { full_name: 'Ann Em', category: 'Unit Leader', role: 'Assistant Nurse Manager', unit_name: 'Float Pool' },
  ], 'Unit Leader').map(c => c.full_name)
  assert.deepEqual(sorted, ['Charina Emerson', 'Ada Dee', 'Ann Em'])
})

test('the BNI Executive Director is also a Nursing Executive (deterministic, not org-text)', async () => {
  const { getContactCategories: cats } = await import('../src/lib/contactCategories.js')
  const margo = { full_name: 'Margo Minissian', category: 'BNI Team', role: 'Executive Director', organization: CSMC_AFFILIATION }
  const c = cats(margo)
  assert.ok(c.includes('BNI Team'))
  assert.ok(c.includes('Nursing Executive'))
  // A BNI NPD Practitioner is NOT a Nursing Executive.
  assert.ok(!cats({ category: 'BNI Team', role: 'NPD Practitioner' }).includes('Nursing Executive'))
})

test('a unit-named search surfaces that unit leadership chain first, acting executive on top', async () => {
  const { sortContactsForSearch } = await import('../src/lib/contactCategories.js')
  const rows = [
    { full_name: 'Aaron Aardvark', category: 'Other', organization: 'X' },
    { full_name: 'Pia Preceptor', category: 'Preceptor', unit_name: 'Float Pool' },
    { full_name: 'Nina NPD', category: 'Unit Leader', role: 'NPD Practitioner', unit_name: 'Float Pool' },
    { full_name: 'Charina Emerson', category: 'Nursing Executive', role: 'Executive Director', related_units: ['Float Pool'] },
  ]
  const sorted = sortContactsForSearch(rows, 'float pool').map(c => c.full_name)
  assert.deepEqual(sorted, ['Charina Emerson', 'Nina NPD', 'Pia Preceptor', 'Aaron Aardvark'])
  // A query matching no unit: plain displayed-name order.
  const plain = sortContactsForSearch(rows, 'emerson').map(c => c.full_name)
  assert.deepEqual(plain, ['Aaron Aardvark', 'Charina Emerson', 'Nina NPD', 'Pia Preceptor'])
})

test('the portal All Contacts view groups by category with dividers, like the staff list', () => {
  const portal = read('src/portal/na/AcademicsContactsView.jsx')
  assert.match(portal, /ptl-na-contact-divider/)
  assert.match(portal, /categoryPluralLabel\(cat\)/)
  assert.match(portal, /sortContactsForCategory\(group, cat\)/)
  assert.match(portal, /sortContactsForSearch/)
  assert.match(read('src/components/connect/ContactsView.jsx'), /sortContactsForSearch\(filtered, search\)/)
  assert.match(read('src/portal/portal.css'), /\.ptl-na-contact-divider/)
})

test('both directories consume the shared row/sort/label helpers', () => {
  const staff = read('src/components/connect/ContactsView.jsx')
  const portal = read('src/portal/na/AcademicsContactsView.jsx')
  for (const src of [staff, portal]) {
    assert.match(src, /contactListSubline/)
    assert.match(src, /sortContactsForCategory/)
    assert.match(src, /categoryPluralLabel/)
    assert.match(src, /contactServicesMeta/)
  }
  // The staff view's old local Unit Leader rank table is gone.
  assert.doesNotMatch(staff, /UNIT_ROLE_RANK/)
})

test('the multi-unit model maps [primary, ...rest] onto unit_name + related_units, both directions', () => {
  assert.deepEqual(contactUnitList({ unit_name: '6 NE', related_units: ['6 NW', '6 NE', ' '] }), ['6 NE', '6 NW'])
  assert.deepEqual(contactUnitList({ unit_name: '', related_units: null }), [])
  assert.deepEqual(splitUnitList(['6 NE', '6 NW', 'ACU/CDU']), { unit_name: '6 NE', related_units: ['6 NW', 'ACU/CDU'] })
  assert.deepEqual(splitUnitList([]), { unit_name: null, related_units: [] })
})

test('matchCatalogKeys accepts the canonical unit ARRAY without splitting, so ACU/CDU resolves', () => {
  const options = ['6 NE', '6 NW', 'ACU/CDU']
  assert.deepEqual(matchCatalogKeys(['acu/cdu', '6 ne'], options), ['ACU/CDU', '6 NE'])
  // String behavior is unchanged (locked by contactSearch.test.mjs too).
  assert.deepEqual(matchCatalogKeys('6 NE, 6 NW', options), ['6 NE', '6 NW'])
  assert.match(CONTACT_SEARCH_COLUMNS, /related_units/)
  assert.deepEqual(contactUnitValues({ unit_name: '6 NE', related_units: ['6 NW'] }), ['6 NE', '6 NW'])
})

test('read-time categorization returns canonical values for legacy stored rows', () => {
  assert.equal(getPrimaryCategory({ category: 'Unit Leadership' }), 'Unit Leader')
  assert.equal(getPrimaryCategory({ category: null, role: 'CN II' }), 'Preceptor')
  assert.deepEqual(getContactCategories({ category: 'Preceptors', role: '' }), ['Preceptor'])
  // The NPD-with-unit secondary rule uses the full unit list.
  const cats = getContactCategories({ category: 'BNI Team', role: 'NPD Practitioner', unit_name: '', related_units: ['6 NE'] })
  assert.ok(cats.includes('Unit Leader'))
  // Legacy chip lookups still resolve to their color.
  assert.deepEqual(categoryChipColors('Unit Leadership'), categoryChipColors('Unit Leader'))
})

// ── The migration ────────────────────────────────────────────────────────────

test('the migration renames every legacy value, backfills NULL, and locks the CHECK', () => {
  assert.match(MIGRATION, /APPLY MANUALLY \(Owner\/Jester\)/)
  assert.match(MIGRATION, /SET category = 'Academic Partner'\s+WHERE category = 'Academic Partners'/)
  assert.match(MIGRATION, /SET category = 'Unit Leader'\s+WHERE category = 'Unit Leadership'/)
  assert.match(MIGRATION, /SET category = 'Preceptor'\s+WHERE category = 'Preceptors'/)
  assert.match(MIGRATION, /SET category = 'Nursing Executive'\s+WHERE category = 'Nursing Executives'/)
  assert.match(MIGRATION, /WHERE category IS NULL/)
  assert.match(MIGRATION, /ALTER COLUMN category SET NOT NULL/)
  assert.match(MIGRATION, /ADD CONSTRAINT chk_contacts_category\s*\n?\s*CHECK \(category IN \('Academic Partner', 'Unit Leader', 'Preceptor', 'BNI Team', 'Nursing Executive', 'Other'\)\)/)
  assert.match(MIGRATION, /ALTER COLUMN role DROP NOT NULL/)
  assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS services text/)
  assert.match(MIGRATION, /DROP COLUMN IF EXISTS preferred_contact_method/)
  assert.match(MIGRATION, /PREFLIGHT/)
  assert.match(MIGRATION, /VERIFICATION/)
  assert.match(MIGRATION, /ROLLBACK/)
  // The uncertain candidate mappings stay commented for Jester to decide.
  assert.match(MIGRATION, /-- UPDATE public\.contacts SET role = 'SVP, Chief Nursing Executive'/)
})

// ── The staff upsert endpoint ────────────────────────────────────────────────

test('contacts-upsert enforces the canon server-side and retired the preferred method', () => {
  const src = read('api/contacts-upsert.js')
  assert.match(src, /from '\.\.\/src\/lib\/contactCategories\.js'/)
  assert.match(src, /canonicalCategory\(payload\.category\)/)
  assert.match(src, /isTitleAllowed\(effectiveCategory, payload\.role, existing\?\.role\)/)
  assert.match(src, /CANONICAL_UNIT_NAMES/)
  assert.match(src, /affiliationKind\(effectiveCategory\)/)
  assert.match(src, /payload\.organization = CSMC_AFFILIATION/)
  assert.match(src, /resolveOperativeSchoolName/)
  assert.match(src, /contactServicesMeta\(effectiveCategory, effRole\)/)
  assert.match(src, /503/)
  assert.doesNotMatch(src, /preferred_contact_method/)
  assert.doesNotMatch(src, /VALID_CATEGORIES/)
  // 'services' is allowlisted.
  assert.match(src, /'services',/)
})

test('both preceptor sync writers use the canonical category with no invented title', () => {
  const view = read('src/components/connect/ContactsView.jsx')
  const modal = read('src/components/PreceptorFormModal.jsx')
  for (const src of [view, modal]) {
    assert.match(src, /category:\s*'Preceptor',/)
    assert.doesNotMatch(src, /category:\s*'Preceptors'/)
    assert.doesNotMatch(src, /role:\s*'Preceptor'/)
  }
})

// ── The portal endpoint (DI factory, behavioral) ─────────────────────────────

const { createAcademicsContactsHandler } = await import('../api/portal/academics-contacts.js')

function makeRes() {
  const res = {
    headers: {}, statusCode: null, body: null,
    setHeader(k, v) { res.headers[k.toLowerCase()] = v },
    status(c) { res.statusCode = c; return res },
    json(b) { res.body = b; return res },
    end() { return res },
  }
  return res
}
const managerAuth = { ok: true, db: {}, profile: { id: 'p1', full_name: 'Rowena P' }, canManageContacts: true }

function makeHandler(overrides = {}) {
  const created = []
  const patched = []
  const handler = createAcademicsContactsHandler({
    verifyCaller: async () => managerAuth,
    fetchContacts: async () => [],
    fetchContact: async () => overrides.existing ?? null,
    createContact: async (db, payload) => { created.push(payload); return { id: '11111111-1111-4111-8111-111111111111', ...payload, is_active: true } },
    updateContact: async (db, id, payload) => { patched.push(payload); return { id, ...payload } },
    probeServices: async () => overrides.servicesReady !== false,
    audit: async () => {},
    ...overrides.deps,
  })
  return { handler, created, patched }
}

test('portal create normalizes a legacy category to canonical and derives the Cedars-Sinai affiliation', async () => {
  const { handler, created } = makeHandler()
  const res = makeRes()
  await handler({ method: 'POST', body: { full_name: 'Akal Khalsa', category: 'Unit Leadership', role: 'Assistant Nurse Manager', unit_name: '3 North' } }, res)
  assert.equal(res.statusCode, 201)
  assert.equal(created[0].category, 'Unit Leader')
  assert.equal(created[0].organization, CSMC_AFFILIATION)
  assert.equal(created[0].school_name, null)
})

test('portal create refuses a non-canonical title for a fixed category', async () => {
  const { handler } = makeHandler()
  const res = makeRes()
  await handler({ method: 'POST', body: { full_name: 'X', category: 'Unit Leader', role: 'Grand Vizier' } }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'invalid_role')
})

test('portal update lets an UNCHANGED legacy title pass through', async () => {
  const existing = { id: '22222222-2222-4222-8222-222222222222', category: 'Unit Leader', role: 'Unit NPD-P', unit_name: null, related_units: [], school_name: null, organization: CSMC_AFFILIATION }
  const { handler, patched } = makeHandler({ existing })
  const res = makeRes()
  await handler({ method: 'PATCH', body: { id: existing.id, role: 'Unit NPD-P', phone: '310-555-0100' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(patched[0].role, 'Unit NPD-P')
})

test('portal writes validate units against the catalog with stored passthrough', async () => {
  const { handler } = makeHandler()
  const bad = makeRes()
  await handler({ method: 'POST', body: { full_name: 'X', category: 'Preceptor', unit_name: 'Narnia Ward' } }, bad)
  assert.equal(bad.statusCode, 400)
  assert.equal(bad.body.error, 'invalid_unit')

  const existing = { id: '33333333-3333-4333-8333-333333333333', category: 'Preceptor', role: null, unit_name: 'Narnia Ward', related_units: [], school_name: null, organization: CSMC_AFFILIATION }
  const { handler: h2, patched } = makeHandler({ existing })
  const ok = makeRes()
  await h2({ method: 'PATCH', body: { id: existing.id, unit_name: 'Narnia Ward', related_units: ['6 NE'] } }, ok)
  assert.equal(ok.statusCode, 200)
  assert.deepEqual(patched[0].related_units, ['6 NE'])
})

test('an Academic Partner contact requires a catalog school, written to BOTH columns', async () => {
  const { handler, created } = makeHandler()
  const missing = makeRes()
  await handler({ method: 'POST', body: { full_name: 'X', category: 'Academic Partner' } }, missing)
  assert.equal(missing.statusCode, 400)
  assert.equal(missing.body.error, 'school_required')

  const ok = makeRes()
  await handler({ method: 'POST', body: { full_name: 'X', category: 'Academic Partner', school_name: 'CSUN' } }, ok)
  assert.equal(ok.statusCode, 201)
  assert.equal(created[0].school_name, 'Cal State Northridge') // alias resolved to the operative identity
  assert.equal(created[0].organization, 'Cal State Northridge')
})

test('services: allowed only for NE + Executive Director, and 503 until the column exists', async () => {
  const { handler, created } = makeHandler()
  const wrong = makeRes()
  await handler({ method: 'POST', body: { full_name: 'X', category: 'Nursing Executive', role: 'Manager', services: 'BNI' } }, wrong)
  assert.equal(wrong.statusCode, 400)
  assert.equal(wrong.body.error, 'invalid_services')

  const ok = makeRes()
  await handler({ method: 'POST', body: { full_name: 'X', category: 'Nursing Executive', role: 'Executive Director', services: 'Surgical Services' } }, ok)
  assert.equal(ok.statusCode, 201)
  assert.equal(created[0].services, 'Surgical Services')

  const { handler: notReady } = makeHandler({ servicesReady: false })
  const gated = makeRes()
  await notReady({ method: 'POST', body: { full_name: 'X', category: 'Nursing Executive', role: 'Executive Director', services: 'BNI' } }, gated)
  assert.equal(gated.statusCode, 503)
  assert.equal(gated.body.error, 'services_unavailable')
})

test('the portal endpoint no longer reads or writes preferred_contact_method', () => {
  // The header comment may NAME the retirement; code may not touch the column.
  const src = read('api/portal/academics-contacts.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(src, /preferred_contact_method/)
  assert.match(src, /'related_units', 'services'/)
})

// ── Both editors consume the shared canon ────────────────────────────────────

test('both editors drive category, title, affiliation, units, and services from the shared module', () => {
  // Comments may NAME the retirement; code may not carry the field.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const staff = strip(read('src/components/connect/ContactsView.jsx'))
  const portal = strip(read('src/portal/na/AcademicsContactsView.jsx'))
  for (const src of [staff, portal]) {
    assert.match(src, /CONTACT_CATEGORY_ORDER/)
    assert.match(src, /titleOptionsFor/)
    assert.match(src, /titleAllowsFreeText/)
    assert.match(src, /affiliationKind/)
    assert.match(src, /showsUnitAffiliation|showUnits/)
    assert.match(src, /contactServicesMeta/)
    assert.match(src, /splitUnitList/)
    assert.match(src, /MultiScopePicker/)
    assert.doesNotMatch(src, /preferred_contact_method/)
    assert.doesNotMatch(src, /Preferred Contact Method|Preferred contact method/)
  }
  // No local category array survives in either editor.
  assert.doesNotMatch(portal, /const CONTACT_CATEGORIES =/)
  assert.match(staff, /const CATEGORY_ORDER = \['All', \.\.\.CONTACT_CATEGORY_ORDER\]/)
})

test('the shared MultiScopePicker is one extracted component used by grant access and both editors', () => {
  const picker = read('src/components/shared/MultiScopePicker.jsx')
  assert.match(picker, /export default function MultiScopePicker/)
  assert.match(read('src/components/settings/GrantPortalAccessModal.jsx'), /from '\.\.\/shared\/MultiScopePicker'/)
  assert.match(read('src/components/connect/ContactsView.jsx'), /from '\.\.\/shared\/MultiScopePicker'/)
  assert.match(read('src/portal/na/AcademicsContactsView.jsx'), /from '\.\.\/\.\.\/components\/shared\/MultiScopePicker'/)
  // The grant modal no longer defines its own copy.
  assert.doesNotMatch(read('src/components/settings/GrantPortalAccessModal.jsx'), /function MultiScopePicker/)
})

test('grant-access autofill matches the contact FULL unit list (primary + related)', () => {
  const modal = read('src/components/settings/GrantPortalAccessModal.jsx')
  assert.match(modal, /matchCatalogKeys\(contactUnitValues\(c\), UNIT_VALUES\)/)
  assert.doesNotMatch(modal, /matchCatalogKeys\(c\.unit_name/)
})

test('the five palette copies are consolidated onto the shared module', () => {
  for (const p of [
    'src/components/connect/RecipientPicker.jsx',
    'src/components/connect/RecipientProfileCard.jsx',
    'src/components/connect/SentHistory.jsx',
    'src/components/Header/UniversalSearch.jsx',
  ]) {
    const src = read(p)
    assert.match(src, /categoryChipColors/, `${p} uses the shared palette`)
    assert.doesNotMatch(src, /'Academic Partners':\s*\{/, `${p} carries no local palette`)
  }
})

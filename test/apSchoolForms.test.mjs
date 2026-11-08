// AP-SCHOOL-FORMS-1 (Owner, 2026-11-08): an Academic Partner builds its own forms and sends them to
// its own students. These pin the gate (a school touches only its own forms and responses; a staff
// preview reads every school's and writes none), the send resolver (students come from the caller's
// scopes, the address from the record, never the browser), the staff endpoint's refusal to write to
// a school's form, and the reuse of the staff form screens through FormsApiContext.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  gateSchoolAction, refuseSchoolFormWrite, peopleForSend, schoolFormAction, namedIds, sendAddress,
} from '../lib/server/forms/schoolForms.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const F_UCLA = '11111111-1111-4111-8111-111111111111'
const F_CSUN = '22222222-2222-4222-8222-222222222222'
const F_ASPIRE = '33333333-3333-4333-8333-333333333333'
const A_UCLA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const A_CSUN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const S1 = 'c1111111-1111-4111-8111-111111111111'
const S2 = 'c2222222-2222-4222-8222-222222222222'
const S3 = 'c3333333-3333-4333-8333-333333333333'
const S4 = 'c4444444-4444-4444-8444-444444444444'

function fakeDb(tables, { missingOwner = false } = {}) {
  const inserts = []
  const db = {
    inserts,
    from(table) {
      let rows = [...(tables[table] || [])]
      let err = null
      const q = {
        select(cols) { if (missingOwner && table === 'catalog_forms' && /owner_school_key/.test(String(cols))) err = { code: '42703', message: 'column does not exist' }; return q },
        eq(k, v) { rows = rows.filter(r => r[k] === v); return q },
        neq(k, v) { rows = rows.filter(r => r[k] !== v); return q },
        in(k, vs) { rows = rows.filter(r => vs.includes(r[k])); return q },
        not(k, op, v) { if (op === 'is' && v === null) rows = rows.filter(r => r[k] != null); return q },
        order() { return q }, limit() { return q },
        insert(row) { inserts.push({ table, row }); rows = [{ id: 'new-form', ...row }]; return q },
        single() { return Promise.resolve(err ? { data: null, error: err } : { data: rows[0] || null, error: null }) },
        maybeSingle() { return q.single() },
        then(resolve, reject) { return Promise.resolve(err ? { data: null, error: err } : { data: rows, error: null }).then(resolve, reject) },
      }
      return q
    },
  }
  return db
}

const TABLES = {
  catalog_forms: [
    { id: F_UCLA, owner_school_key: 'UCLA', org_id: 'a5f1e000-0000-4000-8000-000000000001', status: 'published', draft: { title: 'UCLA Clearance' }, current_version: 1 },
    { id: F_CSUN, owner_school_key: 'CSUN', org_id: 'a5f1e000-0000-4000-8000-000000000001', status: 'draft', draft: { title: 'CSUN Form' }, current_version: 0 },
    { id: F_ASPIRE, owner_school_key: null, org_id: 'a5f1e000-0000-4000-8000-000000000001', status: 'published', draft: { title: 'ScrubEx' }, current_version: 2 },
  ],
  form_assignments: [
    { id: A_UCLA, form_id: F_UCLA, status: 'sent', is_demo: false },
    { id: A_CSUN, form_id: F_CSUN, status: 'sent', is_demo: false },
  ],
  students: [
    { id: S1, school: 'UCLA', cohort_id: 'k1', first_name: 'Maria', last_name: 'Lopez', preferred_first_name: 'Mia', school_email: 'mlopez@ucla.edu', personal_email: 'mia@example.com' },
    { id: S2, school: 'UCLA', cohort_id: 'k1', first_name: 'Ben', last_name: 'Ng', school_email: '', personal_email: 'ben@example.com' },
    { id: S3, school: 'CSUN', cohort_id: 'k1', first_name: 'Ana', last_name: 'Ruiz', school_email: 'ana@csun.edu' },
    { id: S4, school: 'UCLA', cohort_id: 'k1', first_name: 'No', last_name: 'Email', school_email: null, personal_email: null },
  ],
}
const UCLA_SCOPE = [{ school_key: 'UCLA', cohort_id: null }]
const rejects = (p, code) => assert.rejects(p, (e) => e.code === code)

test('a school reaches its own forms and responses, never another school\'s and never ASPIRE\'s', async () => {
  const db = fakeDb(TABLES)
  await gateSchoolAction(db, { action: 'get', id: F_UCLA }, { scopes: UCLA_SCOPE })
  await gateSchoolAction(db, { action: 'submission', assignment_id: A_UCLA }, { scopes: UCLA_SCOPE })
  await gateSchoolAction(db, { action: 'remind', ids: [A_UCLA] }, { scopes: UCLA_SCOPE })
  await rejects(gateSchoolAction(db, { action: 'get', id: F_CSUN }, { scopes: UCLA_SCOPE }), 'not_found')
  await rejects(gateSchoolAction(db, { action: 'get', id: F_ASPIRE }, { scopes: UCLA_SCOPE }), 'not_found')
  await rejects(gateSchoolAction(db, { action: 'submission', assignment_id: A_CSUN }, { scopes: UCLA_SCOPE }), 'not_found')
  // One foreign id among the caller's own is enough to refuse the whole request.
  await rejects(gateSchoolAction(db, { action: 'void', ids: [A_UCLA, A_CSUN] }, { scopes: UCLA_SCOPE }), 'not_found')
  await rejects(gateSchoolAction(db, { action: 'void', ids: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'] }, { scopes: UCLA_SCOPE }), 'not_found')
  // Staff-only actions are not on the school's list at all.
  for (const action of ['paper_set', 'use_starter', 'starters', 'csv', 'forward', 'tracker', 'people']) {
    await rejects(gateSchoolAction(db, { action, id: F_UCLA }, { scopes: UCLA_SCOPE }), 'invalid')
  }
})

test('a staff preview reads every school\'s forms and writes none', async () => {
  const db = fakeDb(TABLES)
  await gateSchoolAction(db, { action: 'get', id: F_CSUN }, { scopes: UCLA_SCOPE, staffPreview: true })
  await gateSchoolAction(db, { action: 'sheet', id: F_UCLA }, { scopes: [], staffPreview: true })
  await rejects(gateSchoolAction(db, { action: 'get', id: F_ASPIRE }, { scopes: [], staffPreview: true }), 'not_found')
  for (const action of ['create', 'save', 'publish', 'send', 'remind', 'void', 'sheet_cells', 'sheet_correct']) {
    await rejects(gateSchoolAction(db, { action, id: F_UCLA }, { scopes: UCLA_SCOPE, staffPreview: true }), 'preview_read_only')
  }
})

test('before the migration every form-level action says not enabled', async () => {
  const db = fakeDb(TABLES, { missingOwner: true })
  await rejects(gateSchoolAction(db, { action: 'get', id: F_UCLA }, { scopes: UCLA_SCOPE }), 'not_enabled')
})

test('a send goes only to the form\'s own school\'s students, at the address on their record', async () => {
  const db = fakeDb(TABLES)
  const { people, skipped } = await peopleForSend(db, { scopes: UCLA_SCOPE, schoolKey: 'UCLA', studentIds: [S1, S2, S3, S4, 'not-a-uuid'] })
  assert.deepEqual(people.map(p => [p.studentId, p.email]), [[S1, 'mlopez@ucla.edu'], [S2, 'ben@example.com']])
  assert.equal(people[0].name, 'Mia Lopez', 'the preferred name')
  assert.deepEqual(skipped.map(s => [s.id, s.reason]), [[S3, 'not_yours'], [S4, 'no_email']])
  assert.equal(sendAddress({ school_email: ' ', personal_email: 'p@x.org' }), 'p@x.org')
  // The browser cannot slip an address in: people are built from ids alone.
  let handed = null
  const act = async (_db, body) => { handed = body; return { sent: body.send.people.length, created: body.send.people.length, failed: [] } }
  const out = await schoolFormAction(db, { action: 'send', send: { formId: F_UCLA, studentIds: [S1], people: [{ email: 'attacker@example.com' }] } },
    { scopes: UCLA_SCOPE, profile: { id: 'p1' }, act })
  assert.equal(out.sent, 1)
  assert.deepEqual(handed.send.people.map(p => p.email), ['mlopez@ucla.edu'])
  assert.equal(handed.send.audienceLabel, 'UCLA')
})

test('a school creates a form only for one of its schools, with no Catalog item', async () => {
  const db = fakeDb(TABLES)
  await rejects(schoolFormAction(db, { action: 'create', school_key: 'CSUN', title: 'X' }, { scopes: UCLA_SCOPE, profile: { id: 'p1' } }), 'forbidden')
  const out = await schoolFormAction(db, { action: 'create', school_key: 'UCLA', title: 'Clearance Attestation' }, { scopes: UCLA_SCOPE, profile: { id: 'p1' } })
  assert.equal(out.form.owner_school_key, 'UCLA')
  const ins = db.inserts.find(i => i.table === 'catalog_forms')
  assert.equal(ins.row.catalog_resource_id, null)
  assert.equal(ins.row.draft.title, 'Clearance Attestation')
  assert.ok(!db.inserts.some(i => i.table === 'catalog_resources'), 'never written to the Catalog')
})

test('the staff endpoint reads a school\'s form but never writes to one', async () => {
  const db = fakeDb(TABLES)
  await refuseSchoolFormWrite(db, { action: 'get', id: F_UCLA })
  await refuseSchoolFormWrite(db, { action: 'save', id: F_ASPIRE })
  await rejects(refuseSchoolFormWrite(db, { action: 'save', id: F_UCLA }), 'school_form')
  await rejects(refuseSchoolFormWrite(db, { action: 'remind', ids: [A_CSUN] }), 'school_form')
  await rejects(refuseSchoolFormWrite(db, { action: 'send', send: { formId: F_CSUN } }), 'school_form')
  const staff = read('api/form-staff.js')
  assert.match(staff, /await refuseSchoolFormWrite\(db, body\)\n\s+const out = await act\(/)
  assert.deepEqual(namedIds({ id: F_UCLA, assignment_id: A_UCLA, ids: [A_CSUN, 'x'] }), { forms: [F_UCLA], responses: [A_UCLA, A_CSUN] })
})

test('the portal reuses the staff form screens through FormsApiContext, and the Catalog keeps its own trail', () => {
  const api = read('src/components/forms/formsApi.js')
  assert.match(api, /export const FormsApiContext = createContext\(STAFF_API\)/)
  for (const f of ['FormBuilder', 'FormResponses', 'FormSheet', 'FormSummary']) {
    const src = read(`src/components/forms/${f}.jsx`)
    assert.doesNotMatch(src, /import \{[^}]*\bformStaff\b[^}]*\} from '\.\/formsApi'/, `${f} reads its call from the context`)
    assert.match(src, /useFormsApi\(\)/)
  }
  const page = read('src/portal/ap/SchoolForms.jsx')
  assert.match(page, /<FormsApiContext\.Provider value=\{api\}>/)
  assert.match(page, /call: schoolForms, school: true, readOnly/)
  assert.match(read('src/portal/ap/schoolFormsApi.js'), /'\/api\/portal\/school-forms'/)
  assert.match(read('src/portal/PortalApp.jsx'), /\/portal\\\/ap\\\/forms\(\\\/\|\$\)/)
})

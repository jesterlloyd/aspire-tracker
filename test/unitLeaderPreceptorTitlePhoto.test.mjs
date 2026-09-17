// UL-PRECEPTOR-TITLE-PHOTO-1: the Unit Leader portal's Add Preceptor sets the
// preceptor's Role/Title and photo, saved on the ASPIRE Connect contact by the
// server after the scoped create succeeds.
//
// Behavioral tests for api/lib/unitPreceptorContactSync.js against a fake
// database (the guardrails), plus source pins for the endpoint order and the
// modal. No network, no Supabase.
//
// Run: node --test test/unitLeaderPreceptorTitlePhoto.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  readPreceptorTitle, readPreceptorPhoto, syncUnitPreceptorContact, PRECEPTOR_PHOTO_MAX_BYTES,
} from '../api/lib/unitPreceptorContactSync.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const api = read('api/portal/unit-preceptor-manage.js')
const modal = read('src/portal/unit/UnitPreceptorCreateModal.jsx')
const modalCode = stripJs(modal)
const client = read('src/portal/unit/unitLeaderApi.js')

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
const b64 = (buf) => buf.toString('base64')

// ── Fake service-role client ──────────────────────────────────────────────────
function fakeDb({ preceptor, contacts = [], uploadError = null, insertError = null, updateError = null } = {}) {
  const log = { uploads: [], inserts: [], updates: [], contactQuery: null }
  const db = {
    log,
    from(table) {
      const q = { table, filters: [] }
      const chain = {
        select() { return chain },
        eq(col, val) { q.filters.push(['eq', col, val]); return chain },
        ilike(col, val) { q.filters.push(['ilike', col, val]); if (table === 'contacts') log.contactQuery = val; return chain },
        limit() { return Promise.resolve({ data: table === 'contacts' ? contacts : [], error: null }) },
        maybeSingle() { return Promise.resolve({ data: table === 'preceptors' ? (preceptor || null) : null, error: null }) },
        insert(row) { log.inserts.push({ table, row }); return Promise.resolve({ error: insertError }) },
        update(patch) {
          return { eq(col, val) { log.updates.push({ table, patch, id: val }); return Promise.resolve({ error: updateError }) } }
        },
      }
      return chain
    },
    storage: {
      from(bucket) {
        return {
          upload(path, buf, opts) { log.uploads.push({ bucket, path, bytes: buf.length, opts }); return Promise.resolve({ error: uploadError }) },
          getPublicUrl(path) { return { data: { publicUrl: `https://cdn.example/contact-avatars/${path}` } } },
        }
      },
    },
  }
  return db
}

const PRECEPTOR = { id: 'p-1', full_name: 'Fabian Reynoso', email: 'Fabian.Reynoso@cshs.org', phone: '310-423-5555', unit_name: '7 SCCT' }
const photoOk = () => readPreceptorPhoto({ content_type: 'image/jpeg', data_base64: b64(JPEG) }).photo
const now = () => 1700000000000

// ── Request validation ────────────────────────────────────────────────────────

test('title: absent or blank means not set; trimmed; length and type enforced', () => {
  assert.deepEqual(readPreceptorTitle(undefined), { ok: true, role: '' })
  assert.deepEqual(readPreceptorTitle(null), { ok: true, role: '' })
  assert.deepEqual(readPreceptorTitle('  CN III  '), { ok: true, role: 'CN III' })
  assert.deepEqual(readPreceptorTitle('Charge Nurse'), { ok: true, role: 'Charge Nurse' }, 'Other free text is allowed')
  assert.equal(readPreceptorTitle('x'.repeat(121)).error, 'invalid_title')
  assert.equal(readPreceptorTitle(42).error, 'invalid_title')
})

test('photo: absent is fine; type, size, and the magic-byte sniff are enforced', () => {
  assert.deepEqual(readPreceptorPhoto(undefined), { ok: true, photo: null })
  assert.equal(readPreceptorPhoto({ content_type: 'image/gif', data_base64: b64(JPEG) }).status, 422)
  assert.equal(readPreceptorPhoto({ content_type: 'image/png', data_base64: b64(JPEG) }).error, 'image_type_mismatch')
  assert.equal(readPreceptorPhoto({ content_type: 'image/jpeg', data_base64: '' }).error, 'invalid_image_data')
  const big = Buffer.concat([JPEG, Buffer.alloc(PRECEPTOR_PHOTO_MAX_BYTES)])
  assert.equal(readPreceptorPhoto({ content_type: 'image/jpeg', data_base64: b64(big) }).status, 413)
  const ok = readPreceptorPhoto({ content_type: 'IMAGE/PNG', data_base64: b64(PNG) })
  assert.equal(ok.ok, true)
  assert.equal(ok.photo.ext, 'png')
})

// ── Contact sync guardrails ───────────────────────────────────────────────────

test('nothing to save does no reads or writes', async () => {
  const db = fakeDb({ preceptor: PRECEPTOR })
  assert.deepEqual(await syncUnitPreceptorContact(db, { preceptorId: 'p-1', role: '', photo: null }), { status: 'none' })
  assert.equal(db.log.contactQuery, null)
})

test('no contact yet: creates a canonical Preceptor contact from the STORED preceptor row', async () => {
  const db = fakeDb({ preceptor: PRECEPTOR, contacts: [] })
  const r = await syncUnitPreceptorContact(db, { preceptorId: 'p-1', role: 'CN III', photo: photoOk() }, { now })
  assert.equal(r.status, 'created')
  assert.equal(db.log.contactQuery, 'fabian.reynoso@cshs.org')
  assert.equal(db.log.uploads.length, 1)
  assert.equal(db.log.uploads[0].bucket, 'contact-avatars')
  assert.equal(db.log.uploads[0].path, 'unit-portal-new-1700000000000.jpg')
  assert.deepEqual(db.log.inserts[0].row, {
    full_name: 'Fabian Reynoso',
    email: 'fabian.reynoso@cshs.org',
    category: 'Preceptor',
    role: 'CN III',
    organization: 'Cedars-Sinai Medical Center',
    school_name: null,
    is_active: true,
    notes: 'Imported from Unit Leader Portal > Preceptors.',
    avatar_url: 'https://cdn.example/contact-avatars/unit-portal-new-1700000000000.jpg',
    unit_name: '7 SCCT',
    phone: '310-423-5555',
  })
})

test('a new contact with no title stores an empty title, and a non-catalog unit is not written', async () => {
  const db = fakeDb({ preceptor: { ...PRECEPTOR, unit_name: 'Not A Real Unit' }, contacts: [] })
  await syncUnitPreceptorContact(db, { preceptorId: 'p-1', role: '', photo: photoOk() }, { now })
  const row = db.log.inserts[0].row
  assert.equal(row.role, '')
  assert.equal('unit_name' in row, false)
})

test('an existing Preceptor contact gets only the changed title and photo, never a clear', async () => {
  const existing = { id: 'c-9', full_name: 'Fabian R.', email: 'fabian.reynoso@cshs.org', category: 'Preceptors', role: 'CN II', avatar_url: 'https://old/x.jpg' }
  const db = fakeDb({ preceptor: PRECEPTOR, contacts: [existing] })
  const r = await syncUnitPreceptorContact(db, { preceptorId: 'p-1', role: 'CN III', photo: photoOk() }, { now })
  assert.equal(r.status, 'updated')
  assert.deepEqual(db.log.updates[0], {
    table: 'contacts', id: 'c-9',
    patch: { role: 'CN III', avatar_url: 'https://cdn.example/contact-avatars/c-9-1700000000000.jpg' },
  })
  assert.equal(db.log.inserts.length, 0)

  // A blank title with a photo leaves the stored title alone.
  const db2 = fakeDb({ preceptor: PRECEPTOR, contacts: [existing] })
  await syncUnitPreceptorContact(db2, { preceptorId: 'p-1', role: '', photo: photoOk() }, { now })
  assert.equal('role' in db2.log.updates[0].patch, false)
})

test('the same title and no photo is unchanged (no write)', async () => {
  const existing = { id: 'c-9', full_name: 'Fabian', email: 'fabian.reynoso@cshs.org', category: 'Preceptor', role: 'CN III', avatar_url: null }
  const db = fakeDb({ preceptor: PRECEPTOR, contacts: [existing] })
  assert.equal((await syncUnitPreceptorContact(db, { preceptorId: 'p-1', role: 'CN III', photo: null })).status, 'unchanged')
  assert.equal(db.log.updates.length, 0)
})

test('GUARDRAIL: a non-Preceptor contact with that email is never touched (no upload, no write)', async () => {
  for (const category of ['Unit Leader', 'Unit Leadership', 'Nursing Executive', 'BNI Team', 'Academic Partner', 'Other']) {
    const leader = { id: 'c-1', full_name: 'Lori Sheffield', email: 'fabian.reynoso@cshs.org', category, role: 'Associate Director', avatar_url: 'https://old/lori.jpg' }
    const db = fakeDb({ preceptor: PRECEPTOR, contacts: [leader] })
    const r = await syncUnitPreceptorContact(db, { preceptorId: 'p-1', role: 'CN III', photo: photoOk() }, { now })
    assert.equal(r.status, 'skipped', category)
    assert.equal(db.log.uploads.length, 0, category)
    assert.equal(db.log.updates.length + db.log.inserts.length, 0, category)
  }
})

test('the contact match is exact, not the ilike wildcard match', async () => {
  // ilike treats "_" as a wildcard: 'a_b@x.org' also matches 'axb@x.org'.
  const wildcard = { id: 'c-wild', full_name: 'Someone Else', email: 'axb@x.org', category: 'Preceptor', role: 'CN II', avatar_url: null }
  const db = fakeDb({ preceptor: { ...PRECEPTOR, email: 'a_b@x.org' }, contacts: [wildcard] })
  const r = await syncUnitPreceptorContact(db, { preceptorId: 'p-1', role: 'CN III', photo: null })
  assert.equal(r.status, 'created')
  assert.equal(db.log.updates.length, 0, 'the wildcard look-alike is never updated')
})

test('failures are reported as error and write nothing further', async () => {
  const noPrec = fakeDb({ preceptor: null })
  assert.equal((await syncUnitPreceptorContact(noPrec, { preceptorId: 'p-x', role: 'CN III', photo: null })).status, 'error')

  const badUpload = fakeDb({ preceptor: PRECEPTOR, contacts: [], uploadError: { message: 'denied' } })
  assert.equal((await syncUnitPreceptorContact(badUpload, { preceptorId: 'p-1', role: 'CN III', photo: photoOk() }, { now })).status, 'error')
  assert.equal(badUpload.log.inserts.length, 0)

  const badInsert = fakeDb({ preceptor: PRECEPTOR, contacts: [], insertError: { message: 'x' } })
  assert.equal((await syncUnitPreceptorContact(badInsert, { preceptorId: 'p-1', role: 'CN III', photo: null })).status, 'error')
})

// ── Endpoint order ────────────────────────────────────────────────────────────

test('endpoint: validates title/photo before the scoped RPC, syncs only after it succeeds', () => {
  const createBranch = api.slice(api.indexOf("action === 'create_preceptor'"), api.indexOf('} else {'))
  assert.match(createBranch, /readPreceptorTitle\(body\.role\)/)
  assert.match(createBranch, /readPreceptorPhoto\(body\.photo\)/)
  // The RPC arguments are unchanged: title and photo never reach create_unit_preceptor.
  assert.doesNotMatch(createBranch, /p_role|p_photo|p_avatar/)
  const rpcAt = api.indexOf('await db.rpc(rpc, args)')
  const syncAt = api.indexOf('syncUnitPreceptorContact(db, { preceptorId: data.preceptor_id')
  assert.ok(rpcAt > 0 && syncAt > rpcAt, 'the sync runs after the RPC')
  assert.ok(api.indexOf('if (error) {', rpcAt) < syncAt, 'an RPC error returns before any sync')
  assert.match(api, /return res\.status\(200\)\.json\(\{ result: data, contact_sync: sync\.status \}\)/)
})

test('client sends role and photo only when set', () => {
  assert.match(client, /\.\.\.\(role \? \{ role \} : \{\}\)/)
  assert.match(client, /\.\.\.\(photo \? \{ photo \} : \{\}\)/)
})

// ── Modal ─────────────────────────────────────────────────────────────────────

test('modal: the main app photo card and Role/Title, disabled until an email is entered', () => {
  assert.match(modal, /className="preceptor-form-card"/)
  assert.match(modal, /className=\{`preceptor-form-photo-circle\$\{photoPreview \? ' has-photo' : ''\}`\}/)
  assert.match(modal, /<span>Upload Photo<\/span>/)
  assert.match(modal, /accept="image\/jpeg,image\/png,image\/webp"/)
  assert.match(modal, />Change</)
  assert.match(modal, />Remove</)
  assert.match(modal, /'Add an email to set a role\/title or photo\.'/)
  assert.match(modal, /htmlFor="ul-prec-title">Role\/Title</)
  assert.match(modal, /<option value="">Not specified<\/option>/)
  assert.match(modal, /<option value=\{CUSTOM_TITLE\}>Other<\/option>/)
  assert.match(modal, /disabled=\{!emailUsable \|\| saving\}/)
  assert.match(modal, /id="ul-prec-title" className="form-select" disabled=\{!emailUsable\}/)
})

test('modal: Full Name and Role/Title share the first row, as in the main app', () => {
  const nameAt = modal.indexOf('htmlFor="ul-prec-name"')
  const titleAt = modal.indexOf('htmlFor="ul-prec-title"')
  const emailAt = modal.indexOf('htmlFor="ul-prec-email"')
  const rowBetween = modal.slice(nameAt, titleAt)
  assert.ok(nameAt < titleAt && titleAt < emailAt)
  assert.doesNotMatch(rowBetween, /form-grid/, 'no new row starts between Full Name and Role/Title')
})

test('modal: still portal-mediated, no Notes, photo sent with the create, contact outcome shown', () => {
  assert.doesNotMatch(modalCode, /supabase|from\('contacts'\)|contact-avatars/)
  assert.doesNotMatch(modalCode, /Notes|textarea/)
  assert.match(modal, /role: form\.role\.trim\(\) \|\| null,\s*photo,/)
  assert.match(modal, /contactNoteFor\(result\.data\?\.contact_sync\)/)
  assert.match(modal, /URL\.revokeObjectURL\(photoPreview\)/)
})

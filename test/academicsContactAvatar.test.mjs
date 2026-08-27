// test/academicsContactAvatar.test.mjs
//
// CONTACTS-EDITOR-PARITY-1: the portal contact photo upload.
//   - Editor grant required (view grants 403).
//   - Magic-byte sniff: declared type must match the actual bytes.
//   - Size cap, base64 hygiene, uuid check.
//   - Existing contact: uploads AND persists avatar_url; new contact: uploads
//     only and returns the URL for the create payload.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createAcademicsContactAvatarHandler, sniffImageType } from '../api/portal/academics-contact-avatar.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const CONTACT_ID = '11111111-1111-4111-8111-111111111111'

function makeRes() {
  const res = { statusCode: 0, body: null, headers: {} }
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (payload) => { res.body = payload; return res }
  res.end = () => res
  return res
}

function makeDb({ contactExists = true } = {}) {
  const uploads = []
  const updates = []
  const db = {
    from(table) {
      assert.equal(table, 'contacts')
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() { return { data: contactExists ? { id: CONTACT_ID } : null, error: null } },
        update(payload) { updates.push(payload); return { eq: async () => ({ error: null }) } },
      }
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'contact-avatars')
        return {
          async upload(path, buf, opts) { uploads.push({ path, size: buf.length, opts }); return { error: null } },
          getPublicUrl(path) { return { data: { publicUrl: `https://cdn.example/${path}` } } },
        }
      },
    },
  }
  return { db, uploads, updates }
}

const editorAuth = (db) => ({ ok: true, db, canManageContacts: true })

test('view grants cannot upload; the sniff and caps fail closed', async () => {
  const { db } = makeDb()
  const viewer = createAcademicsContactAvatarHandler({ verifyCaller: async () => ({ ok: true, db, canManageContacts: false }) })
  const denied = makeRes()
  await viewer({ method: 'POST', body: {} }, denied)
  assert.equal(denied.statusCode, 403)
  assert.deepEqual(denied.body, { error: 'contacts_editor_required' })

  const handler = createAcademicsContactAvatarHandler({ verifyCaller: async () => editorAuth(db) })
  // Declared png, actual jpeg bytes -> mismatch.
  const mismatch = makeRes()
  await handler({ method: 'POST', body: { content_type: 'image/png', data_base64: JPG.toString('base64') } }, mismatch)
  assert.equal(mismatch.statusCode, 422)
  assert.deepEqual(mismatch.body, { error: 'image_type_mismatch' })
  // Unknown type refused before decode.
  const badType = makeRes()
  await handler({ method: 'POST', body: { content_type: 'image/svg+xml', data_base64: PNG.toString('base64') } }, badType)
  assert.equal(badType.statusCode, 422)
  // Over 2 MB refused.
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])
  const tooBig = makeRes()
  await handler({ method: 'POST', body: { content_type: 'image/png', data_base64: big.toString('base64') } }, tooBig)
  assert.equal(tooBig.statusCode, 413)
  // Bad contact id refused.
  const badId = makeRes()
  await handler({ method: 'POST', body: { contact_id: 'nope', content_type: 'image/png', data_base64: PNG.toString('base64') } }, badId)
  assert.equal(badId.statusCode, 400)
})

test('existing contact: uploads and persists avatar_url; missing contact 404s', async () => {
  const { db, uploads, updates } = makeDb()
  const handler = createAcademicsContactAvatarHandler({ verifyCaller: async () => editorAuth(db) })
  const res = makeRes()
  await handler({ method: 'POST', body: { contact_id: CONTACT_ID, content_type: 'image/png', data_base64: PNG.toString('base64') } }, res)
  assert.equal(res.statusCode, 200)
  assert.match(res.body.avatar_url, /^https:\/\/cdn\.example\/11111111-.*\.png$/)
  assert.equal(uploads.length, 1)
  assert.deepEqual(updates, [{ avatar_url: res.body.avatar_url }])

  const gone = makeDb({ contactExists: false })
  const handler404 = createAcademicsContactAvatarHandler({ verifyCaller: async () => editorAuth(gone.db) })
  const missing = makeRes()
  await handler404({ method: 'POST', body: { contact_id: CONTACT_ID, content_type: 'image/png', data_base64: PNG.toString('base64') } }, missing)
  assert.equal(missing.statusCode, 404)
  assert.equal(gone.uploads.length, 0, 'nothing uploads for a missing contact')
})

test('new contact (no id): uploads only and returns the URL for the create payload', async () => {
  const { db, uploads, updates } = makeDb()
  const handler = createAcademicsContactAvatarHandler({ verifyCaller: async () => editorAuth(db) })
  const res = makeRes()
  await handler({ method: 'POST', body: { content_type: 'image/jpeg', data_base64: JPG.toString('base64') } }, res)
  assert.equal(res.statusCode, 200)
  assert.match(res.body.avatar_url, /portal-new-.*\.jpg$/)
  assert.equal(uploads.length, 1)
  assert.equal(updates.length, 0, 'no row is touched before the contact exists')
})

test('sniff recognizes exactly jpeg/png/webp', () => {
  assert.equal(sniffImageType(PNG), 'image/png')
  assert.equal(sniffImageType(JPG), 'image/jpeg')
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])
  assert.equal(sniffImageType(webp), 'image/webp')
  assert.equal(sniffImageType(Buffer.from('<svg xmlns=')), null)
})

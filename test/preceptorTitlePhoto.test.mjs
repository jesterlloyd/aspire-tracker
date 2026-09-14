// PRECEPTOR-TITLE-PHOTO-1: Rotation > Preceptors sets a preceptor's Role/Title and photo,
// stored on their ASPIRE Connect contact (matched by email), never on the preceptors row.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  pickContactByEmail, contactTitleCategory, titleChoices, buildContactPatch, buildContactMaps,
} from '../src/lib/preceptorContact.js'
import { validateContactAvatar } from '../src/lib/contactAvatarUpload.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const modal = read('src/components/PreceptorFormModal.jsx')
const table = read('src/components/PreceptorsTable.jsx')
const dir = read('src/components/shared/PreceptorDirectoryTable.jsx')
const contacts = read('src/components/connect/ContactsView.jsx')

test('the contact is matched by exact email, not by the ilike wildcard', () => {
  const rows = [{ id: 'a', email: 'jane_smith@cshs.org' }, { id: 'b', email: 'Jane.Smith@CSHS.org' }]
  assert.equal(pickContactByEmail(rows, ' jane.smith@cshs.org ')?.id, 'b')
  assert.equal(pickContactByEmail(rows, 'janexsmith@cshs.org'), null)
  assert.equal(pickContactByEmail(rows, ''), null)
})

test('titles come from the contact category, Preceptor when there is no contact', () => {
  assert.equal(contactTitleCategory(null), 'Preceptor')
  assert.equal(contactTitleCategory({ category: 'Preceptors' }), 'Preceptor')
  assert.equal(contactTitleCategory({ category: 'Unit Leader' }), 'Unit Leader')
  const none = titleChoices(null, '')
  assert.deepEqual(none.options, ['CN II', 'CN III'])
  assert.equal(none.allowsFreeText, true)
  assert.equal(none.legacy, null)
  assert.equal(titleChoices(null, 'Charge RN').legacy, 'Charge RN')
})

test('an existing contact gets only the fields that changed, under its own name', () => {
  const contact = { id: 'c1', full_name: 'Jane A. Smith', role: 'CN II', avatar_url: 'https://x/a.png', category: 'Preceptor' }
  assert.equal(buildContactPatch(contact, { role: 'CN II', avatar_url: 'https://x/a.png' }), null)
  assert.deepEqual(buildContactPatch(contact, { role: 'CN III', avatar_url: 'https://x/a.png' }),
    { id: 'c1', full_name: 'Jane A. Smith', role: 'CN III' })
  assert.deepEqual(buildContactPatch(contact, { role: 'CN II', avatar_url: '' }),
    { id: 'c1', full_name: 'Jane A. Smith', avatar_url: '' })
  assert.deepEqual(buildContactPatch({ ...contact, role: null, avatar_url: null }, { role: '', avatar_url: '' }), null)
  assert.equal(buildContactPatch(null, { role: 'CN II' }), null)
})

test('the table maps read avatar and title by lowercase email, first match wins', () => {
  const { avatars, titles } = buildContactMaps([
    { email: 'A@cshs.org', avatar_url: 'u1', role: 'CN III' },
    { email: 'a@cshs.org', avatar_url: 'u2', role: 'CN II' },
    { email: 'b@cshs.org', avatar_url: null, role: '  ' },
    { email: null, avatar_url: 'u3', role: 'CN II' },
  ])
  assert.deepEqual(avatars, { 'a@cshs.org': 'u1' })
  assert.deepEqual(titles, { 'a@cshs.org': 'CN III' })
})

test('photo limits are the Contacts limits, shared by both forms', () => {
  assert.equal(validateContactAvatar({ type: 'image/png', size: 1000 }), null)
  assert.match(validateContactAvatar({ type: 'image/gif', size: 1000 }), /JPEG, PNG, and WebP/)
  assert.match(validateContactAvatar({ type: 'image/webp', size: 3 * 1024 * 1024 }), /under 2 MB/)
  assert.match(contacts, /uploadContactAvatar\(supabase, file, initialData\?\.id\)/)
  assert.doesNotMatch(contacts, /\.from\('contact-avatars'\)/)
  assert.match(modal, /uploadContactAvatar\(supabase, file, contact\?\.id\)/)
})

test('the form never writes title or photo to the preceptors row', () => {
  const payload = modal.slice(modal.indexOf('const payload = {'), modal.indexOf('let result'))
  assert.ok(payload.length > 0)
  assert.doesNotMatch(payload, /role|avatar_url/)
  assert.match(modal, /syncPreceptorContact\(result\.data, \{ role: form\.role, avatar_url: form\.avatar_url \}\)/)
  assert.match(modal, /queryKey: \['preceptor_contact_details'\]/)
})

test('both fields need an email, and a user edit is never overwritten by a lookup', () => {
  assert.match(modal, /data-testid="preceptor-title-select"[\s\S]{0,200}disabled=\{!emailUsable\}/)
  assert.match(modal, /disabled=\{!emailUsable \|\| uploadingPhoto\}/)
  assert.match(modal, /if \(!contactFieldsTouched\.current\) \{/)
  assert.match(modal, /Add an email to set a role\/title or photo\./)
})

test('the photo leads the form like a contact card, with the upload prompt inside the empty circle', () => {
  const card = modal.indexOf('data-testid="preceptor-photo-card"')
  assert.ok(card > 0 && card < modal.indexOf('Full Name *'), 'photo card comes before Full Name')
  assert.match(modal, /: <><Camera size=\{20\}[^>]*\/><span>Upload Photo<\/span><\/>\)/)
  assert.match(modal, /aria-label=\{form\.avatar_url \? 'Change photo' : 'Upload photo'\}/)
  // Full Name and Role/Title share the first row.
  assert.match(modal, /Full Name \*<\/label>[\s\S]{0,400}htmlFor="preceptor-title-select">Role\/Title/)
})

test('Rotation > Preceptors shows a Role/Title column; other hosts do not', () => {
  assert.match(table, /contactTitleMap=\{contactMaps\.titles\}/)
  assert.match(dir, /contactTitleMap = null,/)
  assert.match(dir, /\{contactTitleMap && <th scope="col" className="am-th">Role\/Title<\/th>\}/)
})

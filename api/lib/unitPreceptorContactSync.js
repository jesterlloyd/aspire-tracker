/* global Buffer */
// api/lib/unitPreceptorContactSync.js
//
// UL-PRECEPTOR-TITLE-PHOTO-1: the Unit Leader portal's Add Preceptor saves a
// Role/Title and photo onto the preceptor's ASPIRE Connect contact, the same
// place Rotation > Preceptors saves them (PRECEPTOR-TITLE-PHOTO-1). A Unit
// Leader has no contacts write and no contact-avatars Storage write, so this
// runs server-side with the service role, and only AFTER the unit-scoped
// create_unit_preceptor RPC has succeeded.
//
// Guardrails (a portal role must not be able to edit arbitrary contacts):
//   - The preceptor is re-read by the id the RPC returned; its stored email,
//     name, unit, and phone are used, never the request body.
//   - An existing contact is changed ONLY when its canonical category is
//     Preceptor. Any other contact with that email (a Unit Leader who
//     precepts, an executive) is left untouched and reported as skipped.
//   - Only values the leader actually set are written; nothing is cleared.
//   - A new contact follows the contacts canon (api/contacts-upsert.js):
//     category Preceptor, Cedars-Sinai affiliation, catalog units only, and
//     an empty title stored as ''.
// Failure is non-blocking: the preceptor already exists.

import { canonicalCategory, CSMC_AFFILIATION } from '../../src/lib/contactCategories.js'
import { getCanonicalUnitNames } from '../../src/lib/unitCatalog.js'
import { sniffImageType } from '../portal/academics-contact-avatar.js'

const BUCKET = 'contact-avatars'
export const PRECEPTOR_PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const PRECEPTOR_TITLE_MAX = 120
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const CANONICAL_UNITS = new Set(getCanonicalUnitNames())

const clean = (v) => (typeof v === 'string' ? v.trim() : '')

// Role/Title from the request. Preceptor titles allow free text (the contacts
// canon), so only type and length are enforced. Absent or blank means "not set".
export function readPreceptorTitle(value) {
  if (value === undefined || value === null) return { ok: true, role: '' }
  if (typeof value !== 'string') return { ok: false, status: 400, error: 'invalid_title' }
  const role = value.trim()
  if (role.length > PRECEPTOR_TITLE_MAX) return { ok: false, status: 400, error: 'invalid_title' }
  return { ok: true, role }
}

// The photo from the request: { content_type, data_base64 } or absent. The
// decoded bytes must be the declared image type (magic-byte sniff), exactly
// as the other contact-avatar endpoints require. Validated BEFORE the create
// so a bad photo never leaves a half-finished preceptor behind.
export function readPreceptorPhoto(photo) {
  if (photo === undefined || photo === null) return { ok: true, photo: null }
  if (typeof photo !== 'object' || Array.isArray(photo)) return { ok: false, status: 400, error: 'invalid_image_data' }
  const contentType = clean(photo.content_type).toLowerCase()
  const ext = EXT_BY_TYPE[contentType]
  if (!ext) return { ok: false, status: 422, error: 'invalid_content_type' }
  let buf
  try {
    buf = Buffer.from(String(photo.data_base64 || ''), 'base64')
  } catch {
    return { ok: false, status: 400, error: 'invalid_image_data' }
  }
  if (!buf || buf.length === 0) return { ok: false, status: 400, error: 'invalid_image_data' }
  if (buf.length > PRECEPTOR_PHOTO_MAX_BYTES) return { ok: false, status: 413, error: 'image_too_large' }
  if (sniffImageType(buf) !== contentType) return { ok: false, status: 422, error: 'image_type_mismatch' }
  return { ok: true, photo: { buf, contentType, ext } }
}

async function uploadPhoto(db, photo, idHint, now) {
  // Unique path per upload, so no other contact's photo can be overwritten.
  const path = `${idHint}-${now()}.${photo.ext}`
  const { error } = await db.storage.from(BUCKET).upload(path, photo.buf, { upsert: true, contentType: photo.contentType })
  if (error) return null
  const { data } = db.storage.from(BUCKET).getPublicUrl(path)
  return data?.publicUrl || null
}

// Returns { status } where status is one of:
//   'none'      nothing to save (no title, no photo)
//   'created'   a new Preceptor contact carries the title/photo
//   'updated'   the existing Preceptor contact was updated
//   'unchanged' the existing Preceptor contact already had these values
//   'skipped'   the email belongs to a non-Preceptor contact; left untouched
//   'error'     something failed (the preceptor is still saved)
export async function syncUnitPreceptorContact(db, { preceptorId, role, photo }, { now = Date.now } = {}) {
  if (!role && !photo) return { status: 'none' }
  try {
    const { data: preceptor, error: pErr } = await db
      .from('preceptors')
      .select('id, full_name, email, phone, unit_name')
      .eq('id', preceptorId)
      .maybeSingle()
    if (pErr || !preceptor) return { status: 'error' }
    const email = clean(preceptor.email).toLowerCase()
    if (!email) return { status: 'error' }

    // ilike treats "_" as a wildcard, so the exact comparison happens here.
    const { data: rows, error: cErr } = await db
      .from('contacts')
      .select('id, full_name, email, category, role, avatar_url')
      .ilike('email', email)
      .limit(5)
    if (cErr) return { status: 'error' }
    const contact = (rows || []).find(r => clean(r.email).toLowerCase() === email) || null

    if (contact && canonicalCategory(contact.category) !== 'Preceptor') return { status: 'skipped' }

    const avatarUrl = photo ? await uploadPhoto(db, photo, contact?.id || 'unit-portal-new', now) : null
    if (photo && !avatarUrl) return { status: 'error' }

    if (!contact) {
      const unitName = clean(preceptor.unit_name)
      const insert = {
        full_name: clean(preceptor.full_name),
        email,
        category: 'Preceptor',
        role: role || '',
        organization: CSMC_AFFILIATION,
        school_name: null,
        is_active: true,
        notes: 'Imported from Unit Leader Portal > Preceptors.',
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        ...(unitName && CANONICAL_UNITS.has(unitName) ? { unit_name: unitName } : {}),
        ...(clean(preceptor.phone) ? { phone: clean(preceptor.phone) } : {}),
      }
      const { error: iErr } = await db.from('contacts').insert(insert)
      return { status: iErr ? 'error' : 'created' }
    }

    const patch = {}
    if (role && role !== clean(contact.role)) patch.role = role
    if (avatarUrl && avatarUrl !== contact.avatar_url) patch.avatar_url = avatarUrl
    if (Object.keys(patch).length === 0) return { status: 'unchanged' }
    const { error: uErr } = await db.from('contacts').update(patch).eq('id', contact.id)
    return { status: uErr ? 'error' : 'updated' }
  } catch {
    return { status: 'error' }
  }
}

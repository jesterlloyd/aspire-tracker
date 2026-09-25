/* global process, Buffer */
// api/lib/avatarImage.js
//
// S-16 (FINDINGS_REGISTER.md): every avatar write goes through the server, and a stored
// avatar_url is only ever a file in ASPIRE's own Storage. This module is the one place the
// rules live, so the four writers cannot drift:
//
//   api/my-avatar.js                   a staff member's own photo         (avatars)
//   api/admin-avatar-upload.js         an Owner/Admin sets another staff photo (avatars)
//   api/portal/my-avatar.js            a portal user's own photo          (avatars)
//   api/contact-avatar-upload.js       a Connect contact's photo          (contact-avatars)
//   api/portal/academics-contact-avatar.js  the same, from the NE&L portal (contact-avatars)
//
// and the three endpoints that accept avatar_url as a VALUE (api/contacts-upsert.js,
// api/portal/academics-contacts.js, api/admin-users.js) validate it with
// validateAvatarUrlChange before writing.
//
// The image rules are the ones api/portal/my-avatar.js established: a fixed
// content-type to extension map (never a client filename), a decoded-size cap, and a
// magic-byte sniff so the bytes must be the declared type.

export const AVATAR_IMAGE_TYPES = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_BUCKETS = Object.freeze(['avatars', 'contact-avatars'])
const MAX_URL_LENGTH = 600

export function sniffImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/**
 * Decode { content_type, data_base64 } from a request body into validated bytes.
 * Returns { ok: true, buf, contentType, ext } or { ok: false, status, error, field? }.
 */
export function decodeImageBody(body, { typeMap = AVATAR_IMAGE_TYPES, maxBytes = AVATAR_MAX_BYTES } = {}) {
  const contentType = typeof body?.content_type === 'string' ? body.content_type.trim().toLowerCase() : ''
  const ext = typeMap[contentType]
  if (!ext) return { ok: false, status: 400, error: 'invalid_request', field: 'content_type' }
  let raw = typeof body?.data_base64 === 'string' ? body.data_base64 : ''
  const comma = raw.indexOf(',')
  if (raw.startsWith('data:') && comma !== -1) raw = raw.slice(comma + 1)
  if (!raw) return { ok: false, status: 400, error: 'invalid_request', field: 'data_base64' }
  let buf
  try { buf = Buffer.from(raw, 'base64') } catch { return { ok: false, status: 400, error: 'invalid_request', field: 'data_base64' } }
  if (!buf.length) return { ok: false, status: 400, error: 'invalid_request', field: 'data_base64' }
  if (buf.length > maxBytes) return { ok: false, status: 413, error: 'file_too_large' }
  if (sniffImageType(buf) !== contentType) return { ok: false, status: 400, error: 'invalid_request', field: 'content_type' }
  return { ok: true, buf, contentType, ext }
}

/** The origin ASPIRE's own Storage serves from, or '' when the environment does not say. */
export function storagePublicOrigin(env = process.env) {
  const raw = env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''
  try { return raw ? new URL(raw).origin : '' } catch { return '' }
}

/**
 * True only for an empty value (clearing the photo) or a public-object URL in one of
 * ASPIRE's own avatar buckets: https, this project's Storage origin, the
 * /storage/v1/object/public/<bucket>/<path> shape, an optional ?v=<digits> cache token,
 * no fragment, no empty or dot path segments. Everything else, including any other
 * host, another bucket, a data: or javascript: value, or a URL when the origin is not
 * configured, is refused.
 */
export function isOwnAvatarStorageUrl(value, { origin = storagePublicOrigin(), buckets = AVATAR_BUCKETS } = {}) {
  if (value === '' || value === null || value === undefined) return true
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false
  if (!origin) return false
  // Refuse traversal in the raw text: new URL() would normalise 'avatars/../x' into a
  // path that looks legitimate, and a stored value must be exactly what the server wrote.
  if (value.includes('..') || value.includes('\\')) return false
  let url
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'https:' || url.origin !== origin) return false
  if (url.hash) return false
  if (url.search && !/^\?v=\d{1,20}$/.test(url.search)) return false
  const m = url.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
  if (!m) return false
  if (!buckets.includes(m[1])) return false
  const segments = m[2].split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false
  return true
}

/**
 * Decide whether an incoming avatar_url may be written.
 *   - undefined or null: no change requested; ok, value undefined.
 *   - equal to the stored value: ok, unchanged (a legacy value keeps rendering; it is
 *     never re-validated, only replaced through an upload or cleared).
 *   - '' : ok, clears the photo.
 *   - anything else must pass isOwnAvatarStorageUrl.
 */
export function validateAvatarUrlChange(next, existing, opts) {
  if (next === undefined || next === null) return { ok: true, value: undefined }
  if (typeof next !== 'string') return { ok: false, reason: 'not_a_string' }
  const trimmed = next.trim()
  if (existing !== undefined && existing !== null && trimmed === String(existing)) return { ok: true, value: trimmed, unchanged: true }
  if (isOwnAvatarStorageUrl(trimmed, opts)) return { ok: true, value: trimmed }
  return { ok: false, reason: 'not_own_storage' }
}

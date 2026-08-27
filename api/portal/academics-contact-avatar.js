/* global Buffer */
// api/portal/academics-contact-avatar.js
//
// CONTACTS-EDITOR-PARITY-1: contact photo upload for the Nursing Education &
// Leadership portal's Contacts Editor grant.
//
// WHY A SERVER PATH. The staff app uploads to the public contact-avatars
// bucket directly because its Storage policies allow role owner/admin; a
// portal editor's profile role is 'portal', so the client path is (correctly)
// denied. This endpoint verifies the ACTIVE nursing_academic grant with
// contacts_access='manage' on every request and uploads with the service
// role - the bucket policies stay untouched.
//
// TRANSPORT mirrors api/admin-avatar-upload.js: base64 JSON (no multipart
// parser dependency; a 2 MB image is ~2.7 MB of base64, under Vercel's body
// limit), with a magic-byte sniff so the decoded bytes must actually be the
// declared image type.
//
// MODES:
//   { contact_id, content_type, data_base64 } -> uploads AND persists
//     contacts.avatar_url; returns { avatar_url }.
//   { content_type, data_base64 }             -> uploads only (a NEW contact
//     not yet created); returns { avatar_url } for the create payload.

import { verifyPortalNursingAcademicCaller } from '../lib/nursingAcademicScope.js'

const BUCKET = 'contact-avatars'
const MAX_BYTES = 2 * 1024 * 1024
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Magic-byte sniff (same contract as admin-avatar-upload): the decoded bytes
// must be the declared type, or the upload is rejected.
export function sniffImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

export function createAcademicsContactAvatarHandler({
  verifyCaller = verifyPortalNursingAcademicCaller,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'method_not_allowed' })
    }

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
    if (auth.canManageContacts !== true) {
      return res.status(403).json({ error: 'contacts_editor_required' })
    }

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
    const contactId = typeof body.contact_id === 'string' && body.contact_id ? body.contact_id : null
    if (contactId && !UUID_RE.test(contactId)) return res.status(400).json({ error: 'invalid_contact_id' })

    const contentType = typeof body.content_type === 'string' ? body.content_type.trim().toLowerCase() : ''
    const ext = EXT_BY_TYPE[contentType]
    if (!ext) return res.status(422).json({ error: 'invalid_content_type' })

    let buf
    try {
      buf = Buffer.from(String(body.data_base64 || ''), 'base64')
    } catch {
      return res.status(400).json({ error: 'invalid_image_data' })
    }
    if (!buf || buf.length === 0) return res.status(400).json({ error: 'invalid_image_data' })
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'image_too_large' })
    if (sniffImageType(buf) !== contentType) return res.status(422).json({ error: 'image_type_mismatch' })

    // The stored contact must exist before its photo persists.
    if (contactId) {
      const { data: existing, error: lookupErr } = await auth.db
        .from('contacts').select('id').eq('id', contactId).maybeSingle()
      if (lookupErr) return res.status(500).json({ error: 'internal_error' })
      if (!existing) return res.status(404).json({ error: 'contact_not_found' })
    }

    // Unique path per upload (the staff app's convention), so no cache busting
    // is needed and no other contact's photo can be overwritten.
    const path = `${contactId || 'portal-new'}-${Date.now()}.${ext}`
    const { error: uploadErr } = await auth.db.storage
      .from(BUCKET)
      .upload(path, buf, { upsert: true, contentType })
    if (uploadErr) return res.status(502).json({ error: 'upload_failed' })

    const { data: pub } = auth.db.storage.from(BUCKET).getPublicUrl(path)
    const avatarUrl = pub?.publicUrl || null
    if (!avatarUrl) return res.status(502).json({ error: 'upload_failed' })

    if (contactId) {
      const { error: updateErr } = await auth.db
        .from('contacts').update({ avatar_url: avatarUrl }).eq('id', contactId)
      if (updateErr) return res.status(500).json({ error: 'internal_error' })
    }

    return res.status(200).json({ avatar_url: avatarUrl })
  }
}

export default createAcademicsContactAvatarHandler()

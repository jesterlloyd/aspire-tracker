/* global process */
// api/contact-avatar-upload.js
//
// S-16: a Connect contact's photo, written by the server. ASPIRE Connect > Contacts and
// Rotation > Preceptors used to upload straight into the public contact-avatars bucket
// from the browser (src/lib/contactAvatarUpload.js), naming the object after the client's
// file extension, and then handed the URL to contacts-upsert, which accepted any string.
// Now the browser sends bytes here; the server validates them the way
// api/portal/my-avatar.js does, uploads with the service role, and, when a contact_id is
// given, persists contacts.avatar_url itself. This is the staff twin of
// api/portal/academics-contact-avatar.js and keeps its two modes:
//
//   { contact_id, content_type, data_base64 }  uploads AND persists avatar_url
//   { content_type, data_base64 }              uploads only (a contact not yet created),
//                                              returns { avatar_url } for the create payload
//
// Owner or Admin only, the same rule api/contacts-upsert.js applies to every contact write.

import { randomUUID } from 'crypto'
import { verifyOwnerAdminCaller, getServiceDb } from './lib/portalAuth.js'
import { decodeImageBody } from './lib/avatarImage.js'

const BUCKET = 'contact-avatars'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createContactAvatarUploadHandler({ verifyCaller = verifyOwnerAdminCaller, getDb = getServiceDb, now = Date.now } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

    const requestId = `req_${randomUUID().slice(0, 8)}`

    const auth = await verifyCaller(req)
    if (!auth.ok) {
      const status = auth.status === 403 ? 403 : 401
      return res.status(status).json({ error: status === 403 ? 'forbidden' : 'unauthorized' })
    }

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
    const contactId = body.contact_id === undefined || body.contact_id === null || body.contact_id === '' ? null : body.contact_id
    if (contactId !== null && (typeof contactId !== 'string' || !UUID_RE.test(contactId))) {
      return res.status(400).json({ error: 'invalid_request', field: 'contact_id' })
    }

    const img = decodeImageBody(body)
    if (!img.ok) return res.status(img.status).json({ error: img.error, ...(img.field ? { field: img.field } : {}) })

    const db = getDb()
    if (contactId) {
      const { data: contact, error: cErr } = await db.from('contacts').select('id').eq('id', contactId).maybeSingle()
      if (cErr) {
        console.log('[contact-avatar-upload] contact lookup failed', { request_id: requestId, errorCode: cErr.code })
        return res.status(500).json({ error: 'internal_error' })
      }
      if (!contact) return res.status(404).json({ error: 'not_found' })
    }

    // Same key shape the browser used to write, so nothing downstream changes: the
    // contact id (or a server-made token for a new contact), a timestamp, and the
    // extension from the server's map, never from a filename.
    const path = `${contactId || `new-${randomUUID()}`}-${now()}.${img.ext}`
    const { error: uploadError } = await db.storage
      .from(BUCKET).upload(path, img.buf, { upsert: true, contentType: img.contentType })
    if (uploadError) {
      console.log('[contact-avatar-upload] upload failed', { request_id: requestId, message: uploadError.message })
      return res.status(502).json({ error: 'upload_failed', message: 'Could not upload the image. Please try again.' })
    }

    const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path)
    const publicUrl = pub.publicUrl

    if (contactId) {
      const { error: updateError } = await db.from('contacts').update({ avatar_url: publicUrl }).eq('id', contactId)
      if (updateError) {
        console.log('[contact-avatar-upload] avatar_url update failed', { request_id: requestId, errorCode: updateError.code })
        return res.status(500).json({ error: 'internal_error' })
      }
    }

    console.log('[contact-avatar-upload] uploaded', { request_id: requestId, persisted: Boolean(contactId) })
    return res.status(200).json({ success: true, avatar_url: publicUrl })
  }
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    res.setHeader('Cache-Control', 'no-store')
    return res.status(500).json({ error: 'internal_error' })
  }
  return createContactAvatarUploadHandler()(req, res)
}

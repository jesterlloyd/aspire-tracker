// api/record-document-open.js
//
// CATALOG-REVAMP-1 (Phase 1). Opens or downloads one file on a student's or school's
// record: a personal file moved out of the Catalog now, filed forms and signed PDFs in
// later phases. The client sends only the record_documents id; the server resolves the
// private object and returns a short-lived signed URL that is used at once and never
// stored, the same contract as /api/catalog-resource-open.
//
// POST { id, mode: 'open' | 'download' } -> { signedUrl, expiresIn }. Owner/Admin only.

import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { verifyOwnerAdmin } from './lib/catalogAuth.js'

const BUCKET = 'record-documents'
const TTL_SECONDS = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await verifyOwnerAdmin(req, supabaseAdmin)
  if (!auth.ok) return res.status(auth.status).json(auth.body)

  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : ''
  if (!UUID.test(id)) return res.status(400).json({ error: 'Missing or invalid id' })
  const mode = req.body?.mode === 'download' ? 'download' : 'open'

  const { data: doc, error } = await supabaseAdmin
    .from('record_documents').select('storage_path, file_name').eq('id', id).maybeSingle()
  if (error) return res.status(500).json({ error: 'Lookup failed' })
  if (!doc?.storage_path) return res.status(404).json({ error: 'Not found' })

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, TTL_SECONDS, mode === 'download' ? { download: doc.file_name || true } : undefined)
  if (signErr || !signed?.signedUrl) return res.status(502).json({ error: 'Could not open file' })

  return res.status(200).json({ signedUrl: signed.signedUrl, expiresIn: TTL_SECONDS, mode })
}

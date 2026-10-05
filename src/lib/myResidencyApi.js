// src/lib/myResidencyApi.js
//
// RESIDENCY-TAB-1: the Student Portal's transport for the Residency tab. Every call carries
// the session token; the server resolves the alumnus from it and never takes a student id.
import { supabase } from './supabase'

const ENDPOINT = '/api/portal/my-residency'
const BUCKET = 'student-documents'

export async function postMyResidency(action, payload = {}) {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return { ok: false, status: 401, error: 'unauthorized' }
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, status: res.status, error: body.error || `http_${res.status}` }
    return { ok: true, ...body }
  } catch {
    return { ok: false, status: 0, error: 'network_error' }
  }
}

// Sign, upload straight to storage, then let the server check and file it.
export async function uploadMyDocument({ docType, file, docDate = null, dateConfirmed = false }) {
  const start = await postMyResidency('upload_start', { doc_type: docType, file_name: file.name, size: file.size })
  if (!start.ok) return start
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(start.path, start.token, file, { contentType: file.type })
  if (error) return { ok: false, status: 502, error: 'upload_failed' }
  return postMyResidency('upload_finish', { doc_type: docType, path: start.path, file_name: file.name, doc_date: docDate, date_confirmed: dateConfirmed })
}

export async function openMyDocument(versionId) {
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null
  const r = await postMyResidency('open', { version_id: versionId })
  if (!r.ok || !r.url) { win?.close(); return r.ok ? { ok: false, error: 'not_found' } : r }
  if (win) { win.opener = null; win.location.href = r.url } else window.location.assign(r.url)
  return { ok: true }
}

export const MY_UPLOAD_ERRORS = {
  same_file: 'That is the same file you already have on file. Nothing changed.',
  date_required: 'Enter the date from the document.',
  date_unconfirmed: 'Check the date against your document, then tick the box.',
  too_large: 'That file is over 10 MB.',
  invalid_type: 'That file type is not accepted for this document.',
  keep_failed: 'Your earlier file could not be kept, so nothing was replaced. Try again.',
  record_update_failed: 'Your new résumé could not be saved. Nothing was replaced. Try again.',
  unprovisioned: 'Uploading opens soon. Your ASPIRE team is finishing the setup.',
  not_alumnus: 'This page is for ASPIRE alumni.',
}
export const myUploadErrorText = r => MY_UPLOAD_ERRORS[r?.error] || 'The upload did not finish. Try again.'

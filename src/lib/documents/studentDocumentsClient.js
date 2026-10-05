// src/lib/documents/studentDocumentsClient.js
//
// STUDENT-DOCUMENTS-1: the browser side of api/student-documents.js. Every call returns
// { ok, ... } or { ok: false, status, error } and never throws, so a screen can say what
// went wrong in one place.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'

const ENDPOINT = '/api/student-documents'
const BUCKET = 'student-documents'

async function post(action, payload = {}) {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return { ok: false, status: 401, error: 'unauthenticated' }
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })
    let body = null
    try { body = await res.json() } catch { /* non-JSON */ }
    if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'request_failed' }
    return { ok: true, ...(body || {}) }
  } catch {
    return { ok: false, status: 0, error: 'network_error' }
  }
}

export const studentDocumentsKey = studentId => ['student_documents', studentId]

export function useStudentDocuments(studentId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: studentDocumentsKey(studentId),
    queryFn: async () => {
      const r = await post('list', { student_id: studentId })
      if (!r.ok) { const e = new Error(r.error); e.status = r.status; throw e }
      return r
    },
    enabled: Boolean(studentId) && enabled,
    staleTime: 15_000,
    retry: 1,
  })
  const data = query.data
  return {
    status: query.isPending ? 'loading' : query.isError ? 'error' : data?.provisioned === false ? 'unprovisioned' : 'ok',
    types: data?.types || [],
    documents: data?.documents || [],
    resumeOnRecord: Boolean(data?.resumeOnRecord),
    canWrite: data?.canWrite === true,
    refetch: query.refetch,
  }
}

// Sign, upload straight to storage, then let the server check and file it.
export async function uploadStudentDocument({ studentId, docType, file, docDate = null, dateConfirmed = false }) {
  const start = await post('upload_start', {
    student_id: studentId, doc_type: docType, file_name: file.name, content_type: file.type, size: file.size,
  })
  if (!start.ok) return start
  if (start.provisioned === false) return { ok: false, status: 409, error: 'unprovisioned' }
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(start.path, start.token, file, { contentType: file.type })
  if (error) return { ok: false, status: 502, error: 'upload_failed' }
  return post('upload_finish', {
    student_id: studentId, doc_type: docType, path: start.path, file_name: file.name,
    doc_date: docDate, date_confirmed: dateConfirmed,
  })
}

export async function openStudentDocumentVersion(versionId) {
  // Open the tab first, inside the click, so a popup blocker does not eat it.
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null
  const r = await post('open', { version_id: versionId })
  if (!r.ok || !r.url) { win?.close(); return r.ok ? { ok: false, error: 'not_found' } : r }
  if (win) { win.opener = null; win.location.href = r.url } else if (typeof window !== 'undefined') window.location.assign(r.url)
  return { ok: true }
}

// The student chart's Replace: keep what is on the record before the chart overwrites it.
// { ok: true } also when the documents migration is not applied yet: there is no history
// to keep, and the chart goes ahead exactly as it always has.
export async function keepRecordResume(studentId) {
  const r = await post('keep_record_resume', { student_id: studentId })
  if (r.ok) return { ok: true, kept: r.kept === true }
  return r
}

export const UPLOAD_ERRORS = {
  same_file: 'That is the same file that is already current. Nothing changed.',
  date_required: 'Enter the date from the document.',
  date_unconfirmed: 'Check the date against the file, then tick the box.',
  too_large: 'That file is over 10 MB.',
  invalid_type: 'That file type is not accepted for this document.',
  keep_failed: 'The current file could not be kept in its history, so nothing was replaced. Try again.',
  record_update_failed: 'The new résumé was not saved to the student record. Nothing was replaced. Try again.',
  forbidden: 'Only the Owner or an Admin can upload documents.',
  unprovisioned: 'Documents switch on once the documents update is applied.',
  no_cohort: 'This student has no cohort on file, so a résumé cannot be saved.',
}
export const uploadErrorText = r => UPLOAD_ERRORS[r?.error] || 'The upload did not finish. Try again.'

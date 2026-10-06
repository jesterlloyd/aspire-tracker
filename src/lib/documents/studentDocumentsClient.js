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

// RESIDENCY-NEEDS-1: alumni's portal uploads and completed files, for Residency's Needs you. The
// same `activity` the staff home reads, without the home's loaders (the portal never needs them).
export async function loadDocumentActivity() {
  const r = await post('activity')
  if (!r.ok) throw new Error(r.error || 'document_activity_failed')
  return { uploads: r.uploads || [], completions: r.completions || [] }
}

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
    // RESUME-REVIEW-1: Keith's reviews (newest first, no résumé text), whether this person may
    // run one now, and how their draft is signed.
    reviews: data?.reviews || [],
    reviewsProvisioned: data?.reviewsProvisioned === true,
    canScore: data?.canScore === true,
    scoringBlocked: data?.scoringBlocked || null,
    sender: data?.sender || null,
    refetch: query.refetch,
  }
}

// ── RESUME-REVIEW-1 ──────────────────────────────────────────────────────────
// Scoring takes up to about a minute. The request carries on if the drawer is closed; the
// review row is written as 'scoring' first, so the Documents tab shows it either way.
export const startResumeReview = ({ studentId, versionId = null }) =>
  post('review_start', { student_id: studentId, ...(versionId ? { version_id: versionId } : {}) })
export const getResumeReview = reviewId => post('review_get', { review_id: reviewId })
export const reviseResumeDraft = (reviewId, style) => post('review_draft', { review_id: reviewId, style })
export const saveResumeDraft = (reviewId, patch) => post('review_save', { review_id: reviewId, ...patch })

export const REVIEW_ERRORS = {
  skill_off: 'Keith’s Review Résumé skill is off. Turn it on in Settings > Keith > Skills.',
  skill_denied: 'Only the Owner or an Admin can run a résumé review.',
  invalid_output: 'Keith’s review did not come back complete, so nothing was saved. Try again.',
  rate_limited: 'Keith is busy right now. Try again in a minute.',
  upstream_timeout: 'The review took too long. Try again.',
  upstream_error: 'Keith could not finish the review. Try again.',
  file_unavailable: 'The résumé file could not be read. Try again.',
  unreadable_no_text_layer: 'That PDF is a scan with no text, so it cannot be scored. Upload a text PDF or a Word file.',
  unreadable_legacy_doc_unsupported: 'Old .doc files cannot be read. Save it as .docx or PDF and upload again.',
  no_resume: 'There is no résumé on file to score.',
  keep_failed: 'The résumé on the record could not be kept as a version, so it was not scored. Try again.',
}
export const reviewErrorText = r => REVIEW_ERRORS[r?.error] || (String(r?.error || '').startsWith('unreadable_') ? 'The résumé text could not be read, so it was not scored.' : 'The review did not finish. Try again.')

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

// APPLICANT-PACKET-1: the list and one file's bytes, for the packet built in the browser. Both go
// through the same `list` and `open` actions as the Documents drawer, so each file is checked
// against this caller exactly as opening it would be. Never throw.
export async function loadStudentDocumentList(studentId) {
  const r = await post('list', { student_id: studentId })
  if (!r.ok) return r
  if (r.provisioned === false) return { ok: true, types: [], documents: [] }
  return { ok: true, types: r.types || [], documents: r.documents || [] }
}

export async function fetchStudentDocumentBytes(versionId) {
  const r = await post('open', { version_id: versionId })
  if (!r.ok || !r.url) return { ok: false, error: r.error || 'not_found' }
  try {
    const res = await fetch(r.url)
    if (!res.ok) return { ok: false, error: 'download_failed' }
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

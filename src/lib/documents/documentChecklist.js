// src/lib/documents/documentChecklist.js
//
// STUDENT-DOCUMENTS-1 (résumé review build, Phase 2): what the Documents checklist says
// about each document type. Pure, so the drawer and its tests read the same rules; nothing
// is decided in JSX. The types come from student_document_types (the server sends them),
// never from a list in this file.

// The files a version may be, by type. A résumé is what the student record already
// accepts; anything else may also be a photo of a card or a letter.
export const RESUME_EXTS = ['pdf', 'doc', 'docx']
export const DOCUMENT_EXTS = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png']
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024
export const extsFor = docType => (docType === 'resume' ? RESUME_EXTS : DOCUMENT_EXTS)
export const acceptFor = docType => extsFor(docType).map(e => `.${e}`).join(',')

export const DATE_KINDS = ['completion_date', 'expiry_date']
export const needsDate = type => DATE_KINDS.includes(type?.check_kind)
export const dateLabel = type => (type?.check_kind === 'completion_date' ? 'Completion date' : 'Expiration date')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function monthYear(day) {
  const [y, m] = String(day || '').split('-').map(Number)
  return y && m ? `${MONTHS[m - 1]} ${y}` : null
}
// A timestamp in the viewer's own calendar (a UTC date would read a day ahead every evening).
export function shortDay(ts) {
  if (!ts) return null
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

// The current version of a document, or null. A résumé whose current file is the one on
// the student record (no version row yet) has no current VERSION but is still on file.
export function currentVersion(doc) {
  if (!doc?.current_version_id) return null
  return (doc.versions || []).find(v => v.id === doc.current_version_id) || null
}

export function isOnFile(type, doc, { resumeOnRecord = false } = {}) {
  if (currentVersion(doc)) return true
  return type?.key === 'resume' && resumeOnRecord
}

// Status is one word in a pill (table canon): On file, Missing (required only), None
// (optional), Not yet (an optional type that cannot exist yet, such as a license before NCLEX).
export function statusFor(type, doc, opts = {}) {
  if (isOnFile(type, doc, opts)) return { key: 'on_file', label: 'On file', tone: 'ok' }
  if (type?.required) return { key: 'missing', label: 'Missing', tone: 'warn' }
  if (type?.not_yet_label) return { key: 'not_yet', label: 'Not yet', tone: 'off', note: type.not_yet_label }
  return { key: 'none', label: 'None', tone: 'off' }
}

// The Detail column: what the check found, in words. `warn` marks a flag (never a block).
export function detailFor(type, doc, { today, resumeOnRecord = false } = {}) {
  const v = currentVersion(doc)
  if (!v) {
    if (type?.key === 'resume' && resumeOnRecord) return { text: 'On the student record', warn: false }
    if (!type?.required && type?.not_yet_label) return { text: type.not_yet_label, warn: false }
    return null
  }
  if (type.check_kind === 'pages') {
    if (v.pages == null) return { text: 'Page count unavailable', warn: false }
    const pages = `${v.pages} ${v.pages === 1 ? 'page' : 'pages'}`
    if (type.max_pages && v.pages > type.max_pages) return { text: `${pages} · over the ${type.max_pages}-page limit`, warn: true }
    return { text: type.max_pages ? `${pages} · within limit` : pages, warn: false }
  }
  if (DATE_KINDS.includes(type.check_kind)) {
    if (!v.doc_date) return { text: type.check_kind === 'completion_date' ? 'No completion date' : 'No expiration date', warn: true }
    const when = monthYear(v.doc_date)
    if (type.check_kind === 'completion_date') return { text: `Completion ${when}`, warn: false }
    if (today && v.doc_date < today) return { text: `Expired ${when}`, warn: true }
    return { text: `Expires ${when}`, warn: false }
  }
  if (v.pages != null) return { text: `${v.pages} ${v.pages === 1 ? 'page' : 'pages'}`, warn: false }
  return null
}

// "[N] of [M] required on file", the bar, and the names of what is missing.
export function checklistSummary(types = [], docs = [], opts = {}) {
  const byType = new Map(docs.map(d => [d.doc_type, d]))
  const required = types.filter(t => t.required)
  const onFile = required.filter(t => isOnFile(t, byType.get(t.key), opts))
  const missing = required.filter(t => !isOnFile(t, byType.get(t.key), opts)).map(t => t.label)
  return {
    required: required.length,
    onFile: onFile.length,
    missing,
    share: required.length ? onFile.length / required.length : 0,
    complete: required.length > 0 && missing.length === 0,
  }
}

// The rows of the checklist, required first, each with everything the sheet shows.
export function checklistRows(types = [], docs = [], opts = {}) {
  const byType = new Map(docs.map(d => [d.doc_type, d]))
  return [...types]
    .sort((a, b) => (Number(b.required) - Number(a.required)) || (a.sort_order - b.sort_order))
    .map((type) => {
      const doc = byType.get(type.key) || null
      const current = currentVersion(doc)
      return {
        type,
        doc,
        current,
        status: statusFor(type, doc, opts),
        detail: detailFor(type, doc, opts),
        updated: current?.uploaded_at || null,
        hasFile: isOnFile(type, doc, opts),
      }
    })
}

// Version history newest first, the current one marked.
export function versionHistory(doc) {
  return [...(doc?.versions || [])]
    .sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)))
    .map(v => ({ ...v, isCurrent: v.id === doc?.current_version_id }))
}

export const VIA_LABEL = { staff: 'Uploaded by staff', portal: 'Uploaded by the student', record: 'Kept from the student record' }

// Client-side gate before asking the server to sign an upload. The server repeats it.
export function validatePick(docType, file) {
  if (!file) return 'Choose a file.'
  const ext = String(file.name || '').split('.').pop().toLowerCase()
  if (!extsFor(docType).includes(ext)) return `That file type is not accepted. Use ${extsFor(docType).map(e => e.toUpperCase()).join(', ')}.`
  if (file.size > DOCUMENT_MAX_BYTES) return 'That file is over 10 MB.'
  return null
}

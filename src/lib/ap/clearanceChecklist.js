// AP-CLEARANCE-1 (Owner, 2026-11-08): a student's clearance files, uploaded by their school.
// "Filed, no review": a file is on file or it is missing; nothing waits for ASPIRE's approval.
// ASPIRE keeps a base list (required); a school may add its own items (optional). Pure.
import { needsDate, dateLabel } from '../documents/documentChecklist.js'

/** One row per checklist item, with the current file and its history. */
export function clearanceRows(types, documents, versions) {
  return types.map(type => {
    const doc = documents.find(d => d.doc_type === type.key) || null
    const history = doc ? versions.filter(v => v.document_id === doc.id) : []
    const current = doc?.current_version_id ? history.find(v => v.id === doc.current_version_id) || history[0] || null : null
    return {
      key: type.key,
      label: type.label,
      qualifier: type.qualifier || null,
      required: type.required === true,
      own: type.school_key != null,
      needsDate: needsDate(type),
      dateLabel: needsDate(type) ? dateLabel(type) : null,
      current: current ? { id: current.id, file_name: current.file_name, uploaded_at: current.uploaded_at, doc_date: current.doc_date || null, by: current.uploaded_via } : null,
      versions: history.map(v => ({ id: v.id, file_name: v.file_name, uploaded_at: v.uploaded_at, doc_date: v.doc_date || null })),
    }
  })
}

/** Counts for the checklist head and the roster: required on file of required. */
export function clearanceSummary(rows) {
  const required = rows.filter(r => r.required)
  const onFile = required.filter(r => r.current)
  return {
    required: required.length,
    onFile: onFile.length,
    missing: required.filter(r => !r.current).map(r => r.label),
    complete: required.length > 0 && onFile.length === required.length,
  }
}

/** An expiration date already past, as of `today` (YYYY-MM-DD). */
export const isExpired = (row, today) => Boolean(row?.current?.doc_date && row.dateLabel === 'Expiration date' && row.current.doc_date < today)

export function cleanItemLabel(label, qualifier) {
  const l = String(label || '').trim().replace(/\s+/g, ' ')
  if (!l) return { error: 'label_required' }
  if (l.length > 80) return { error: 'label_too_long' }
  const q = String(qualifier || '').trim().replace(/\s+/g, ' ')
  if (q.length > 80) return { error: 'qualifier_too_long' }
  return { label: l, qualifier: q || null }
}

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

/**
 * AP-CLEARANCE-2: the roster's Clearance column, for many students at once. Only ASPIRE's REQUIRED
 * base items count; a school's own items are optional and never make a student incomplete.
 * `documents` are { student_id, doc_type, current_version_id }; `versions` are { id, doc_date }.
 * Returns { [studentId]: { required, onFile, missing: [labels], expired: [labels] } }.
 */
export function rosterClearance(studentIds, types, documents, versions, today) {
  const required = types.filter(t => t.required === true && t.school_key == null)
  const versionById = new Map(versions.map(v => [v.id, v]))
  const out = {}
  for (const id of studentIds) {
    const mine = documents.filter(d => d.student_id === id)
    const missing = []
    const expired = []
    let onFile = 0
    for (const t of required) {
      const doc = mine.find(d => d.doc_type === t.key)
      const v = doc?.current_version_id ? versionById.get(doc.current_version_id) : null
      if (!v) { missing.push(t.label); continue }
      onFile += 1
      if (t.check_kind === 'expiry_date' && v.doc_date && String(v.doc_date).slice(0, 10) < today) expired.push(t.label)
    }
    out[id] = { required: required.length, onFile, missing, expired }
  }
  return out
}

/** How the roster cell reads: the words, the pill tone, and a sentence for screen readers. */
export function clearanceCell(s) {
  if (!s || !s.required) return null
  const tone = s.expired.length ? 'warn' : s.onFile === s.required ? 'ok' : s.onFile === 0 ? 'bad' : 'warn'
  const parts = [`${s.onFile} of ${s.required} required clearance documents on file.`]
  if (s.missing.length) parts.push(`Missing: ${s.missing.join(', ')}.`)
  if (s.expired.length) parts.push(`Expired: ${s.expired.join(', ')}.`)
  return {
    text: `${s.onFile} of ${s.required}`,
    note: s.expired.length ? `${s.expired.length} expired` : s.missing.length ? `${s.missing.length} missing` : 'Complete',
    tone,
    label: parts.join(' '),
  }
}

/** Sort weight: fewest on file first, then most expired. */
export const clearanceRank = (s) => (s && s.required ? s.onFile / s.required - s.expired.length / 100 : 2)

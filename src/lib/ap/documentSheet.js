// src/lib/ap/documentSheet.js
//
// AP-DOCUMENTS-TAB-1 (Owner, 2026-11-17): Academic Partner Portal > Documents. One row per student,
// one column per document on the school's list, so a coordinator sees at a glance what is on file
// and uploads the rest from the row. Nothing on the list is "required": a school uploads what it
// has, or what its own program requires, and the ASPIRE team asks for anything Cedars-Sinai needs.
// Pure: the server shapes the cells, the screen draws them, and this module decides the words.
import { needsDate, dateLabel } from '../documents/documentChecklist.js'

/** ASPIRE's list first, then this school's own items, in the order the server sent them. */
export function sheetColumns(types, schoolKey) {
  return (types || [])
    .filter(t => t.school_key == null || t.school_key === schoolKey)
    .map(t => ({
      key: t.key, label: t.label, qualifier: t.qualifier || null, own: t.school_key != null,
      needsDate: needsDate(t), dateLabel: needsDate(t) ? dateLabel(t) : null,
    }))
}

const ymd = (v) => (v ? String(v).slice(0, 10) : null)

/** One cell: 'on_file', 'expired' or 'none', with the date the screen prints. */
export function sheetCell(cell, column, today) {
  if (!cell) return { state: 'none' }
  const docDate = ymd(cell.doc_date)
  const expired = Boolean(docDate && column?.dateLabel === 'Expiration date' && docDate < today)
  return {
    state: expired ? 'expired' : 'on_file',
    versionId: cell.version_id,
    fileName: cell.file_name,
    uploadedOn: ymd(cell.uploaded_at),
    docDate,
    dateWord: docDate ? (column?.dateLabel === 'Expiration date' ? (expired ? 'Expired' : 'Expires') : 'Completed') : null,
  }
}

/** How many students have each document on file (expired counts as on file, and is counted too). */
export function columnCounts(columns, studentIds, cells, today) {
  const out = {}
  for (const c of columns) {
    let onFile = 0, expired = 0
    for (const id of studentIds) {
      const s = sheetCell(cells?.[id]?.[c.key], c, today).state
      if (s !== 'none') onFile += 1
      if (s === 'expired') expired += 1
    }
    out[c.key] = { onFile, expired }
  }
  return out
}

/** Documents not on file for one student (by label), for the "missing something" filter. */
export function gapsFor(columns, studentCells, today) {
  return columns.filter(c => sheetCell(studentCells?.[c.key], c, today).state !== 'on_file').map(c => c.label)
}

/** Students on the sheet: everyone in scope except those no longer moving forward. */
export const SHEET_HIDDEN_STATUSES = ['Not Proceeding', 'Declined']
export const onSheet = (s) => !SHEET_HIDDEN_STATUSES.includes(s?.status)

/** The sentence a coordinator reads first. No document here is called required. */
export const SHEET_GUIDANCE = 'Upload what you have for each student, or what your school requires. Not every student needs every document; the ASPIRE team will let you know if Cedars-Sinai needs one you have not sent.'

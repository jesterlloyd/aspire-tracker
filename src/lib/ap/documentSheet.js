// src/lib/ap/documentSheet.js
//
// AP-DOCUMENTS-TAB-1 (Owner, 2026-11-17): Academic Partner Portal > Documents. One row per student,
// one column per document on the school's list, so a coordinator sees at a glance what is on file
// and uploads the rest from the row. Nothing on the list is "required": a school uploads what it
// has, or what its own program requires, and the ASPIRE team asks for anything Cedars-Sinai needs.
// Pure: the server shapes the cells, the screen draws them, and this module decides the words.
import { needsDate, dateLabel } from '../documents/documentChecklist.js'

/**
 * AP-DOCUMENT-LAYOUT-1: a school's saved order. `types` are ASPIRE's items and this school's own, in
 * their default order; `layout` is [{ key, hidden }] in the school's order. A type the layout does not
 * name keeps its default place after the named ones, so an item added later shows at the end.
 * Returns every type with `hidden` set.
 */
export function applyLayout(types, layout) {
  const list = types || []
  const named = new Map((layout || []).map((l, i) => [l.key, { i, hidden: l.hidden === true }]))
  const rank = (t, i) => (named.has(t.key) ? named.get(t.key).i : 100000 + i)
  return list.map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t, a.i) - rank(b.t, b.i))
    .map(({ t }) => ({ ...t, hidden: t.school_key == null && named.get(t.key)?.hidden === true }))
}

/** Move one key up (-1) or down (+1) in an ordered list of keys. */
export function moveKey(keys, key, by) {
  const i = keys.indexOf(key), j = i + by
  if (i < 0 || j < 0 || j >= keys.length) return keys
  const out = [...keys]; [out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Move one key to sit where another is (a drag). */
export function dropKey(keys, key, onto) {
  if (key === onto || !keys.includes(key) || !keys.includes(onto)) return keys
  const out = keys.filter(k => k !== key)
  const at = out.indexOf(onto) + (keys.indexOf(key) < keys.indexOf(onto) ? 1 : 0)
  out.splice(at, 0, key)
  return out
}

/**
 * The layout a school may save: only keys it can see (ASPIRE's and its own), each once, and only
 * ASPIRE's items can be hidden (a school's own item is removed instead). Returns [{ key, hidden }] or
 * { error }.
 */
export function cleanLayout(order, hidden, allowed) {
  if (!Array.isArray(order)) return { error: 'invalid_layout' }
  const ok = new Map((allowed || []).map(t => [t.key, t]))
  const seen = new Set()
  const hide = new Set(Array.isArray(hidden) ? hidden.map(String) : [])
  const out = []
  for (const raw of order) {
    const key = String(raw)
    if (!ok.has(key) || seen.has(key)) return { error: 'invalid_layout' }
    seen.add(key)
    out.push({ key, hidden: hide.has(key) && ok.get(key).school_key == null })
  }
  return { layout: out }
}

/** The sheet's columns: ASPIRE's list and this school's own items, in its order, hidden ones left out. */
export function sheetColumns(types, schoolKey, layout = null) {
  const mine = (types || []).filter(t => t.school_key == null || t.school_key === schoolKey)
  return applyLayout(mine, layout)
    .filter(t => !t.hidden)
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

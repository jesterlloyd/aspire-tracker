// lib/server/ngrpApplicantSheet.js
//
// APPLICANT-SHEET-1 (Owner, 2026-11-02): Residency > Profiles & Interest > Interest & Eligibility
// opens the Transition Form answers in a Sheet, so Talent Acquisition can sort, highlight, colour
// and classify applicants without downloading. The grid is the Catalog Forms' Answers grid
// (src/components/sheet/EditableSheet.jsx); this file is its residency side.
//
// - The rows and columns are the Download Excel's (transitionWorkbookRows), built from the roster
//   the caller may see, so the Sheet can hold only what the file held.
// - ONE shared sheet per residency cohort: layout in ngrp_sheet_views, highlights and staff values
//   in ngrp_sheet_cells (20261119000000, Owner-gated). A submitted answer is never changed here.
// - Before the migration the Sheet is view-only and says why (editable: false).
// - The Excel export is the view: the rows, columns, order, fills, inks and grouping shown.

import { cleanLayout } from '../../src/lib/forms/formModel.js'
import { cleanFormat, mergeFormat, SHEET_FILLS, SHEET_INKS, displayValue } from '../../src/lib/sheet/sheetModel.js'
import { transitionWorkbookRows } from './ngrpResidencyExport.js'
import { xlsxFor } from './sheet/xlsx.js'
import { isMissingNgrpTable } from './ngrpApplicants.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const LEAD_HEADER = 'Full Legal Name (Last Name, First Name)'

/** A column's key: a short hash of its header, so a key survives a column added beside it. */
export function columnKey(header) {
  let h = 5381
  for (const ch of String(header)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0
  return `t_${h.toString(36)}`
}

/** The Sheet's columns and rows from the workbook's: cells are text, numbers stay findable. */
export function sheetShape(book) {
  const leadAt = book.header.indexOf(LEAD_HEADER)
  const columns = []
  book.header.forEach((label, i) => {
    if (i === leadAt) return
    const numeric = book.rows.some(r => r[i] && typeof r[i] === 'object' && 'n' in r[i])
    columns.push({ key: columnKey(label), label, at: i, ...(numeric ? { type: 'number' } : {}), width: book.widths?.[i] })
  })
  const text = c => (c && typeof c === 'object' && 'n' in c ? String(c.n) : String(c ?? ''))
  const rows = book.rows.map((r, idx) => ({
    id: book.ids[idx],
    name: text(r[leadAt]),
    cells: Object.fromEntries(columns.map(c => [c.key, text(r[c.at])])),
    raw: Object.fromEntries(columns.map(c => [c.key, r[c.at]])),
  }))
  return { columns: columns.map(c => { const out = { ...c }; delete out.at; return out }), rows }
}

async function readEdits(db, cycleId) {
  const view = await db.from('ngrp_sheet_views').select('layout').eq('cycle_id', cycleId).maybeSingle()
  if (view.error) {
    if (isMissingNgrpTable(view.error)) return { editable: false, layout: {}, cells: [] }
    return { error: view.error }
  }
  const cells = await db.from('ngrp_sheet_cells').select('candidate_id, column_key, value, format').eq('cycle_id', cycleId).limit(50000)
  if (cells.error) return { error: cells.error }
  return { editable: true, layout: view.data?.layout || {}, cells: cells.data || [] }
}

/**
 * The Sheet for one cohort. `view` is the roster this caller sees (narrowed for Talent
 * Acquisition); `revisions` the latest Transition Form revisions by assignment.
 */
export async function loadApplicantSheet(db, { cycleId, view, revisions }) {
  const book = transitionWorkbookRows({ students: view.students, candidates: view.candidates, revisionsByAssignment: revisions, withIds: true })
  const { columns, rows } = sheetShape(book)
  const edits = await readEdits(db, cycleId)
  if (edits.error) return { error: edits.error }
  const layout = cleanLayout(edits.layout, columns.map(c => c.key))
  // Default widths are the workbook's, until someone drags one.
  for (const c of columns) if (c.width && !layout.widths[c.key]) layout.widths[c.key] = c.width
  if (!edits.layout?.frozen) layout.frozen = Math.max(layout.frozen, 1)
  const staff = new Set(layout.staffColumns.map(c => c.key))
  const byRow = new Map(rows.map(r => [r.id, r]))
  for (const r of rows) {
    r.format = {}
    for (const sc of layout.staffColumns) r.cells[sc.key] = ''
  }
  for (const c of edits.cells) {
    const r = byRow.get(c.candidate_id)
    if (!r) continue
    if (c.format) r.format[c.column_key] = c.format
    if (staff.has(c.column_key)) r.cells[c.column_key] = c.value ?? ''
  }
  const strip = (o, k) => { const out = { ...o }; delete out[k]; return out }
  return { columns: columns.map(c => strip(c, 'width')), rows: rows.map(r => strip(r, 'raw')), layout, editable: edits.editable, book, shape: { columns, rows } }
}

/** Every column key a cohort's Sheet can have (the headers do not depend on the answers). */
export const sheetColumnKeys = () => transitionWorkbookRows({}).header.filter(h => h !== LEAD_HEADER).map(columnKey)

const notEnabled = { error: 'not_enabled', status: 409 }

/** Save the shared layout. Columns are this cohort's Sheet's; anything else is dropped. */
export async function saveApplicantSheetLayout(db, { cycleId, layout, columnKeys, profileId }) {
  const clean = cleanLayout(layout, columnKeys)
  const { error } = await db.from('ngrp_sheet_views').upsert({ cycle_id: cycleId, layout: clean, updated_by: profileId, updated_at: new Date().toISOString() }, { onConflict: 'cycle_id' })
  if (error) return isMissingNgrpTable(error) ? notEnabled : { error: 'save_failed', status: 500 }
  return { layout: clean }
}

/**
 * Save highlights and staff values: [{ rowId, key, value?, format? }]. A row must be one of this
 * cohort's applicants; a value is kept only for a staff column, a format for any column.
 */
export async function saveApplicantSheetCells(db, { cycleId, updates, profileId }) {
  const list = (Array.isArray(updates) ? updates : []).slice(0, 2000)
  const ids = [...new Set(list.map(u => u?.rowId).filter(x => UUID.test(String(x))))]
  const mine = new Set()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('ngrp_candidates').select('id').eq('cycle_id', cycleId).in('id', ids.slice(i, i + 200))
    if (error) return { error: 'read_failed', status: 500 }
    for (const c of data || []) mine.add(c.id)
  }
  const view = await db.from('ngrp_sheet_views').select('layout').eq('cycle_id', cycleId).maybeSingle()
  if (view.error) return isMissingNgrpTable(view.error) ? notEnabled : { error: 'read_failed', status: 500 }
  const staff = new Set(cleanLayout(view.data?.layout || {}, []).staffColumns.map(c => c.key))
  // A bulk upsert sends every column of every row, so each carries what is stored for the rest.
  const stored = new Map()
  const idList = [...mine]
  for (let i = 0; i < idList.length; i += 200) {
    const { data, error } = await db.from('ngrp_sheet_cells').select('candidate_id, column_key, value, format').in('candidate_id', idList.slice(i, i + 200))
    if (error) return isMissingNgrpTable(error) ? notEnabled : { error: 'read_failed', status: 500 }
    for (const c of data || []) stored.set(`${c.candidate_id}|${c.column_key}`, c)
  }
  const now = new Date().toISOString()
  const byCell = new Map()
  for (const u of list) {
    const key = String(u?.key || '')
    if (!mine.has(u.rowId) || !key || key.length > 60) continue
    const id = `${u.rowId}|${key}`
    const base = byCell.get(id) || stored.get(id) || {}
    const row = { candidate_id: u.rowId, column_key: key, cycle_id: cycleId, updated_by: profileId, updated_at: now, value: base.value ?? null, format: base.format ?? null }
    let changed = false
    if ('format' in u) { row.format = cleanFormat(u.format); changed = true }
    if ('value' in u && staff.has(key)) { row.value = u.value == null || u.value === '' ? null : String(u.value).slice(0, 5000); changed = true }
    if (changed) byCell.set(id, row)
  }
  const rows = [...byCell.values()]
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('ngrp_sheet_cells').upsert(rows.slice(i, i + 500), { onConflict: 'candidate_id,column_key' })
    if (error) return isMissingNgrpTable(error) ? notEnabled : { error: 'save_failed', status: 500 }
  }
  return { saved: rows.length }
}

/**
 * The Sheet as Excel: the rows and columns shown, in that order, with fills, inks, bold and
 * grouping. Answers stay inline strings (never formulas); numbers stay numbers.
 */
export function applicantSheetXlsx(sheet, { rowIds = null, columnKeys = null, groupBy } = {}) {
  const { layout, shape } = sheet
  const all = [...shape.columns, ...layout.staffColumns]
  const byId = new Map(shape.rows.map(r => [r.id, r]))
  const fullRow = new Map(sheet.rows.map(r => [r.id, r]))
  const shownRows = (Array.isArray(rowIds) ? rowIds.map(id => byId.get(id)) : shape.rows).filter(Boolean)
  const savedOrder = new Map((layout.order || []).map((k, i) => [k, i]))
  const hidden = new Set(layout.hidden || [])
  const inLayout = all.map((c, i) => ({ c, at: savedOrder.has(c.key) ? savedOrder.get(c.key) : 1000 + i })).sort((a, b) => a.at - b.at).map(x => x.c).filter(c => !hidden.has(c.key))
  const shownCols = Array.isArray(columnKeys) ? columnKeys.map(k => all.find(c => c.key === k)).filter(Boolean) : inLayout
  if (groupBy === undefined) groupBy = layout.groupBy || null
  const fillHex = new Map(SHEET_FILLS.map(f => [f.key, f.hex])), inkHex = new Map(SHEET_INKS.map(f => [f.key, f.hex]))
  const styled = f => (f ? { ...(f.b ? { b: true } : {}), ...(f.i ? { i: true } : {}), ...(f.u ? { u: true } : {}), ...(f.wrap ? { wrap: true } : {}),
    ...(f.align ? { align: f.align } : {}), ...(f.fill ? { fill: fillHex.get(f.fill) } : {}), ...(f.ink ? { ink: inkHex.get(f.ink) } : {}) } : null)
  const text = (r, key) => fullRow.get(r.id)?.cells?.[key] ?? ''
  const cellFor = (r, c) => {
    const f = styled(mergeFormat(layout.colFormats?.[c.key], fullRow.get(r.id)?.format?.[c.key]))
    const raw = r.raw?.[c.key]
    if (raw && typeof raw === 'object' && 'n' in raw) return { n: raw.n, ...(f ? { f } : {}) }
    return { v: displayValue(text(r, c.key), mergeFormat(layout.colFormats?.[c.key], null)), f }
  }
  const line = r => [{ v: r.name, f: styled(fullRow.get(r.id)?.format?.['@name']) }, ...shownCols.map(c => cellFor(r, c))]
  const key = groupBy && shownCols.some(c => c.key === groupBy) ? groupBy : null
  let body
  if (key) {
    const groups = new Map()
    for (const r of shownRows) { const g = String(text(r, key)).trim() || '(blank)'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r) }
    body = [...groups].flatMap(([g, list]) => [{ group: g, count: list.length }, ...list.map(line)])
  } else body = shownRows.map(line)
  const widths = [layout.widths?.['@name'] || 220, ...shownCols.map(c => layout.widths?.[c.key] || c.width || 0)]
  return xlsxFor({ sheetName: 'Applicants', header: ['Full Legal Name (Last Name, First Name)', ...shownCols.map(c => c.label)], rows: body, widths, freezeCols: 1 })
}

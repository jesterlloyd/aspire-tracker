// src/components/forms/FormSheet.jsx
//
// FORM-SHEET-1 (2026-09-24, Owner: "monitor the results from an excel like or smartsheet like
// view"): Responses > Sheet. One row per submission, one column per question, read live from
// the answers every time it opens: search, filters, sort, show or hide columns, click a name
// for that person's full answers and PDF. The page's Export to Excel exports exactly what
// it shows (EXPORT-ONE-1: the Sheet hands its view up through `viewRef`).
//
// FORM-SHEET-2 (Owner, 2026-09-24: Smartsheet's controls, "also edit their answers"): a
// double-click on an answer records a CORRECTION, which never changes the submission or its
// filed PDF and is tagged Corrected with who, when and the original.
//
// BUDGET-SHEET-0a (2026-09-27): the grid itself (toolbar, selection, formats, grouping, freeze,
// staff columns, the Σ row, the empty sheet) is src/components/sheet/EditableSheet.jsx, shared
// with Program Budget. This file is the forms side of it: it loads the answers, names the
// columns (Name, Email, School, Submitted, then the questions), and owns what only a form has:
// the Name button that opens a person's answers, file links, and corrections.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { CORRECTABLE_TYPES } from '../../lib/forms/formModel'
import { formStaff } from './formsApi'
import EditableSheet from '../sheet/EditableSheet'

const LEAD = { key: '@name', label: 'Name' }
const BASE = [
  { key: '@email', label: 'Email', base: true },
  { key: '@school', label: 'School', base: true },
  { key: '@submitted', label: 'Submitted', base: true },
]
const PLAIN = new Set(['@name', '@submitted'])
const UNGROUPABLE = new Set(['@submitted'])
const DEFAULT_SORT = { key: '@submitted', dir: 'desc' }
const EMPTY_LAYOUT = { order: [], hidden: [], widths: {}, frozen: 0, groupBy: null, staffColumns: [] }
const stamp = (iso) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const valueOf = (row, key) => key === '@name' ? row.name : key === '@email' ? row.email : key === '@school' ? row.school : key === '@submitted' ? row.submittedAt : row.cells[key]
const shown = (row, key) => key === '@submitted' ? stamp(row.submittedAt) : (valueOf(row, key) || '')
const searchValues = (r) => [r.name, r.email, r.school]
const canEditColumn = (col) => !col.base && CORRECTABLE_TYPES.includes(col.type)
const draftOf = (row, col) => row.answers?.[col.key]
const cellClass = (row, col) => [row.corrected?.[col.key] ? 'fs-corrected' : '', col.key === '@submitted' ? 'fs-when' : ''].filter(Boolean).join(' ')
const cellTitle = (row, col) => {
  const corr = row.corrected?.[col.key]
  return corr ? `Corrected by ${corr.by || 'staff'} on ${stamp(corr.at)}. Submitted: ${corr.original == null ? '(blank)' : Array.isArray(corr.original) ? corr.original.join('; ') : corr.original}${corr.reason ? `. Why: ${corr.reason}` : ''}` : undefined
}
const editorLabel = (row, col) => (col.staff ? `Edit ${col.label}` : `Correct ${row.name}'s answer to ${col.label}`)
const saveLabel = (col) => (col.staff ? 'Save' : 'Correct')

const LABELS = {
  notice: 'Formatting, staff columns and corrections need a database update the Owner applies (20260929000000_form_sheet.sql). Until then you can view, filter, sort and export.',
  searchPlaceholder: 'Search names and answers',
  searchLabel: 'Search the answers',
  count: (shownRows, total) => (shownRows === total ? `${shownRows} ${shownRows === 1 ? 'response' : 'responses'}` : `${shownRows} of ${total}`),
  emptyNote: 'No one has submitted this form yet. Answers appear here as they come in; you can set up columns, formats and the Σ row now.',
  noMatch: 'No answers match.',
  frameLabel: 'Answers, one row per person. Arrow keys move, Enter edits.',
  readOnlyEdit: 'Editing needs the database update the Owner applies.',
  newColumnHint: 'A column for your team, like Lot assignment, Fee or Processed. Students never see it.',
  help: "Click a cell, a column header or a row number to select it; Shift-click extends; Cmd/Ctrl+A selects everything. Double-click or Enter edits. Drag a header to move a column and its right edge to resize. The Σ row sums, averages or counts each column over the rows shown. Corrections change Answers and the Excel export; each person's submitted answers and filed PDF stay as they sent them.",
}

export default function FormSheet({ formId, onOpen, notify, viewRef }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const loads = useRef(0)

  // Each load mounts a fresh grid (the grid owns its rows and layout once it has them).
  useEffect(() => {
    let live = true
    formStaff('sheet', { id: formId }).then(r => { if (live) setData({ ...r, load: ++loads.current }) })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [formId])
  const columns = useMemo(() => [...BASE, ...(data?.columns || [])], [data])
  const initialLayout = useMemo(() => ({ colFormats: {}, summaries: {}, ...(data?.layout || EMPTY_LAYOUT) }), [data])

  if (error) return <p className="fm-err" role="alert">{error}</p>
  if (!data) return <p className="fm-hint">Loading the answers…</p>

  const saveLayout = (layout) => formStaff('sheet_layout', { id: formId, layout })
  const saveCells = (updates) => formStaff('sheet_cells', { id: formId, updates: updates.map(({ rowId, ...rest }) => ({ assignmentId: rowId, ...rest })) })

  const openFile = async (row, key) => {
    const f = row.answers?.[key]
    if (!f?.path) return
    try { const r = await formStaff('file_url', { assignment_id: row.id, path: f.path }); if (r.url) window.open(r.url, '_blank', 'noopener') } catch (e) { notify?.(e.message, 'err') }
  }

  // A cell only a form has: the name opens the person, a file opens the file, a correction says so.
  const renderCell = (row, col, text) => {
    if (col.key === '@name') return <button type="button" className="fs-open" title={`Open ${row.name || row.email}'s answers and PDF`} onClick={() => onOpen?.({ id: row.id, name: row.name, email: row.email })}>{row.name || row.email}</button>
    const file = col.type === 'file' ? row.answers?.[col.key] : null
    if (file?.path) return <button type="button" className="fs-file" onClick={() => openFile(row, col.key)} title={`Open ${file.name || 'the file'}`}><Paperclip size={13} aria-hidden="true" />{file.name || 'File'}</button>
    if (row.corrected?.[col.key]) return <>{text}<span className="fs-corrtag">Corrected</span></>
    return undefined
  }

  // A correction to a submitted answer: an append-only record, never the submission itself.
  const commitEdit = async (row, col, editing, { patchRows }) => {
    const r = await formStaff('sheet_correct', { id: formId, assignment_id: row.id, question_id: col.key, value: editing.draft, reason: editing.reason })
    const text = Array.isArray(r.value) ? r.value.join('; ') : col.type === 'date' && r.value ? String(r.value).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2/$3/$1') : String(r.value ?? '')
    const original = row.corrected?.[col.key] ? row.corrected[col.key].original : row.answers?.[col.key]
    const back = JSON.stringify(r.value ?? null) === JSON.stringify(original ?? null)
    patchRows(x => {
      if (x.id !== row.id) return x
      const corrected = { ...x.corrected }
      if (back) delete corrected[col.key]; else corrected[col.key] = { by: 'you', at: new Date().toISOString(), original: original ?? null, reason: editing.reason }
      return { ...x, cells: { ...x.cells, [col.key]: text }, answers: { ...x.answers, [col.key]: r.value }, corrected }
    })
    notify?.(back ? 'Put back to what they submitted.' : 'Corrected in Answers. Their submitted answer and PDF are unchanged.')
  }

  const editorExtras = ({ row, editing, setEditing }) => (keys) => (<>
    <input className="fs-reason" value={editing.reason} maxLength={500} placeholder="Why (optional)" onChange={e => setEditing(x => ({ ...x, reason: e.target.value }))} onKeyDown={keys} />
    <small>Changes Answers only. {row.name}&apos;s submitted answer and PDF stay as sent.</small>
  </>)

  return (
    <EditableSheet
      key={data.load}
      initialRows={data.rows}
      initialLayout={initialLayout}
      lead={LEAD}
      columns={columns}
      editable={!!data.editable}
      valueOf={valueOf} shownOf={shown} plainKeys={PLAIN} searchValues={searchValues} ungroupable={UNGROUPABLE}
      defaultSort={DEFAULT_SORT} defaultFilterKey={data.columns[0]?.key || '@school'}
      saveLayout={saveLayout} saveCells={saveCells}
      canEditColumn={canEditColumn} draftOf={draftOf} commitEdit={commitEdit}
      renderCell={renderCell} cellClass={cellClass} cellTitle={cellTitle}
      editorLabel={editorLabel} editorExtras={editorExtras} saveLabel={saveLabel}
      labels={LABELS} notify={notify} viewRef={viewRef}
    />
  )
}

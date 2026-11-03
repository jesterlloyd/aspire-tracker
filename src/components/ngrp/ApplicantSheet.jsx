// src/components/ngrp/ApplicantSheet.jsx
//
// APPLICANT-SHEET-1 (Owner, 2026-11-02): Interest & Eligibility's Sheet. The submitted Transition
// Form answers, one row per applicant, in the Catalog Forms' Answers grid
// (src/components/sheet/EditableSheet.jsx), so Talent Acquisition can sort, highlight, colour and
// classify applicants without downloading. ONE shared sheet per residency cohort: the ASPIRE team
// and Talent Acquisition mark the same one (lib/server/ngrpApplicantSheet.js). Download Excel lives
// here and exports exactly what the Sheet shows. Staff app and Residency Portal alike.
//
// SHEET-CORRECT-1 (Owner, 2026-11-02): every change saves as it is made and says so in a toast.
// The Owner and Talent Acquisition may correct an answer here: the correction lives in the Sheet
// (and its Excel) only, marked with who and the original; the submitted form, the binder and the
// packet keep what the alumnus wrote. Undo (the toolbar, Cmd/Ctrl+Z, or the toast) puts it back,
// and clearing an answer asks first.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import EditableSheet from '../sheet/EditableSheet'
import { confirmDialog } from '../shared/confirmDialog'
import BackButton from '../BackButton'
import { fetchApplicantSheet, fetchApplicantSheetXlsx, saveApplicantSheet } from '../../lib/ngrp/useNgrpData'
import { saveXlsx } from '../budget/budgetApi'
import '../forms/forms.css'

const LEAD = { key: '@name', label: 'Full Legal Name' }
const PLAIN = new Set(['@name'])
const EMPTY_LAYOUT = { order: [], hidden: [], widths: {}, frozen: 1, groupBy: null, staffColumns: [] }
const valueOf = (row, key) => (key === '@name' ? row.name : row.cells[key])
const shownOf = (row, key) => valueOf(row, key) || ''
const searchValues = r => [r.name]
const stamp = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const cellClass = (row, col) => (row.corrected?.[col.key] ? 'fs-corrected' : '')
const cellTitle = (row, col) => {
  const c = row.corrected?.[col.key]
  return c ? `Corrected by ${c.by || 'the residency team'}${c.at ? ` on ${stamp(c.at)}` : ''}. Submitted: ${c.original === '' ? '(blank)' : c.original}` : undefined
}
const draftOf = (row, col) => row.cells[col.key] ?? ''
const KEPT = 'Kept as it was.'
const SAVED_QUIET_MS = 2500
const unwrap = (fn) => async (...args) => {
  try { return await fn(...args) } catch (e) {
    throw new Error(e.body?.error === 'not_enabled' ? 'Saving needs the database update the Owner applies (20261119000000).' : 'Could not save. Try again.', { cause: e })
  }
}

const LABELS = {
  notice: 'Highlights, colours and your own columns need a database update the Owner applies (20261119000000_ngrp_applicant_sheet.sql). Until then you can view, sort, filter and download.',
  searchPlaceholder: 'Search names and answers',
  searchLabel: 'Search the applicants',
  count: (shown, total) => (shown === total ? `${shown} ${shown === 1 ? 'applicant' : 'applicants'}` : `${shown} of ${total}`),
  emptyNote: 'No one has submitted the Transition Form yet. Rows appear here as forms come in; you can set up columns and highlights now.',
  noMatch: 'No applicants match.',
  frameLabel: 'Transition Form answers, one row per applicant. Arrow keys move, Enter edits.',
  readOnlyEdit: 'Editing needs the database update the Owner applies.',
  newColumnHint: 'A column for your team, like Tier, Pair with or Notes. Alumni never see it.',
  help: 'Click a cell, a column header or a row number to select it; Shift-click extends. Use the fill and text colours to highlight, and add your own columns to classify. Everyone on the residency team sees the same sheet, and every change saves as you make it.',
}
// SHEET-CORRECT-1: the words when this viewer may correct answers.
const CORRECT_HELP = `${LABELS.help} Double-click an answer to correct it: the correction shows here and in the Excel, the original is kept beside it, and the submitted form keeps what the alumnus wrote. Undo puts it back.`

export default function ApplicantSheet({ cycle, onClose, toast }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const viewRef = useRef(null)
  const undoRef = useRef(null)
  const loads = useRef(0)
  const lastSaved = useRef(0)

  useEffect(() => {
    let live = true
    fetchApplicantSheet(cycle.id).then(r => { if (live) setData({ ...r, load: ++loads.current }) })
      .catch(() => { if (live) setError('The Sheet could not be loaded right now. Please try again shortly.') })
    return () => { live = false }
  }, [cycle.id])
  const initialLayout = useMemo(() => ({ colFormats: {}, summaries: {}, ...(data?.layout || EMPTY_LAYOUT) }), [data])

  // Every save says so, once every few seconds at most (a resize saves on every drag).
  async function save(action, body) {
    const r = await unwrap(saveApplicantSheet)(action, { cycle_id: cycle.id, ...body })
    const now = Date.now()
    if (now - lastSaved.current >= SAVED_QUIET_MS) {
      lastSaved.current = now
      toast?.success?.('Saved', 'Changes to the Sheet save automatically.', { duration: 2000 })
    }
    return r
  }
  const saveLayout = layout => save('sheet_layout', { layout })
  const saveCells = updates => save('sheet_cells', { updates })
  const notify = (msg, kind) => {
    if (String(msg).endsWith(KEPT)) return toast?.info?.('Not changed', 'The answer was kept as it was.')
    return kind === 'err' ? toast?.error?.('Sheet', msg) : toast?.success?.(msg)
  }

  // SHEET-CORRECT-1: a correction to an answer, laid over it in the Sheet only.
  const canCorrect = !!data?.canCorrect && !!data?.editable
  const canEditColumn = col => canCorrect && !!col.correctable
  const commitEdit = async (row, col, editing, { patchRows }) => {
    const prior = row.corrected?.[col.key]
    const original = prior ? prior.original : (row.cells[col.key] ?? '')
    const current = row.cells[col.key] ?? ''
    const draft = String(editing.draft ?? '')
    if (draft === current) return
    const back = draft === original
    if (!back && draft.trim() === '' && current.trim() !== '') {
      const ok = await confirmDialog(`Clear ${row.name}'s answer to "${col.label}"?`, {
        message: 'The Sheet will show it blank. The submitted form keeps what they wrote, and Undo puts it back.',
        confirmLabel: 'Clear answer', danger: true,
      })
      if (!ok) throw new Error(KEPT)
    }
    await saveApplicantSheet('sheet_cells', { cycle_id: cycle.id, updates: [{ rowId: row.id, key: col.key, value: back ? null : draft }] })
      .catch(e => { throw new Error(e.body?.error === 'correct_not_allowed' ? 'Only the Owner and Talent Acquisition can correct answers.' : 'Could not save. Try again.', { cause: e }) })
    patchRows(x => {
      if (x.id !== row.id) return x
      const corrected = { ...x.corrected }
      if (back) delete corrected[col.key]; else corrected[col.key] = { by: 'you', at: new Date().toISOString(), original }
      return { ...x, cells: { ...x.cells, [col.key]: draft }, corrected }
    })
    lastSaved.current = Date.now()
    toast?.success?.(back ? 'Put back' : 'Saved', back
      ? `${col.label} shows what ${row.name} submitted again.`
      : `${col.label} corrected for ${row.name}. Their submitted form is unchanged.`,
    { duration: 6000, action: { label: 'Undo', onClick: () => undoRef.current?.() } })
  }

  const onDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try { saveXlsx(await fetchApplicantSheetXlsx(cycle.id, viewRef.current?.())) } catch {
      toast?.error?.('Download failed', 'The Excel file could not be generated right now. Please try again shortly.')
    }
    setDownloading(false)
  }

  return (
    <div className="ngrp-sheet">
      <div className="ngrp-sheet-head">
        <BackButton label="Back to Interest & Eligibility" onClick={onClose} />
        <span className="ngrp-sheet-title">Applicant Sheet <small>{cycle.name}</small></span>
        <button type="button" className="ngrp-sheet-dl" onClick={onDownload} disabled={downloading || !data}>
          <Download size={13} aria-hidden="true" />
          {downloading ? 'Preparing Excel…' : 'Download Excel'}
        </button>
      </div>
      {error ? <p className="ngrp-sheet-msg" role="alert">{error}</p>
        : !data ? <p className="ngrp-sheet-msg">Loading the answers…</p>
          : (
            <EditableSheet
              key={data.load}
              initialRows={data.rows}
              initialLayout={initialLayout}
              lead={LEAD}
              columns={data.columns}
              editable={!!data.editable}
              valueOf={valueOf} shownOf={shownOf} plainKeys={PLAIN} searchValues={searchValues}
              defaultSort={{ key: '@name', dir: 'asc' }} defaultFilterKey={data.columns[0]?.key}
              saveLayout={saveLayout} saveCells={saveCells}
              canEditColumn={canEditColumn} draftOf={draftOf} commitEdit={commitEdit}
              cellClass={cellClass} cellTitle={cellTitle}
              editorLabel={(row, col) => `Correct ${row.name}'s answer to ${col.label}`}
              labels={canCorrect ? { ...LABELS, help: CORRECT_HELP } : LABELS} notify={notify} viewRef={viewRef} undoRef={undoRef}
            />
          )}
    </div>
  )
}

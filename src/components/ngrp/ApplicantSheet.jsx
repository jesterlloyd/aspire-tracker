// src/components/ngrp/ApplicantSheet.jsx
//
// APPLICANT-SHEET-1 (Owner, 2026-11-02): Interest & Eligibility's Sheet. The submitted Transition
// Form answers, one row per applicant, in the Catalog Forms' Answers grid
// (src/components/sheet/EditableSheet.jsx), so Talent Acquisition can sort, highlight, colour and
// classify applicants without downloading. ONE shared sheet per residency cohort: the ASPIRE team
// and Talent Acquisition mark the same one (lib/server/ngrpApplicantSheet.js). Download Excel lives
// here and exports exactly what the Sheet shows. Staff app and Residency Portal alike.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import EditableSheet from '../sheet/EditableSheet'
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
  help: 'Click a cell, a column header or a row number to select it; Shift-click extends. Use the fill and text colours to highlight, and add your own columns to classify. Everyone on the residency team sees the same sheet. Answers are shown as submitted and cannot be changed here.',
}

export default function ApplicantSheet({ cycle, onClose, toast }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const viewRef = useRef(null)
  const loads = useRef(0)

  useEffect(() => {
    let live = true
    fetchApplicantSheet(cycle.id).then(r => { if (live) setData({ ...r, load: ++loads.current }) })
      .catch(() => { if (live) setError('The Sheet could not be loaded right now. Please try again shortly.') })
    return () => { live = false }
  }, [cycle.id])
  const initialLayout = useMemo(() => ({ colFormats: {}, summaries: {}, ...(data?.layout || EMPTY_LAYOUT) }), [data])

  const saveLayout = unwrap(layout => saveApplicantSheet('sheet_layout', { cycle_id: cycle.id, layout }))
  const saveCells = unwrap(updates => saveApplicantSheet('sheet_cells', { cycle_id: cycle.id, updates }))
  const notify = (msg, kind) => (kind === 'err' ? toast?.error?.('Sheet', msg) : toast?.success?.(msg))

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
              canEditColumn={() => false}
              labels={LABELS} notify={notify} viewRef={viewRef}
            />
          )}
    </div>
  )
}

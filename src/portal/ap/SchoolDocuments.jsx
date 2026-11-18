// src/portal/ap/SchoolDocuments.jsx
//
// AP-DOCUMENTS-TAB-1 (Owner, 2026-11-17): Academic Partner Portal > Documents. It replaced Forms in
// the section nav. A coordinator could only see a student's documents by opening each record, and
// the record called all six "required", which Cedars-Sinai does not require of every student. Now:
//
//   Student Documents (the default): one row per student, one column per document on the list,
//     every empty cell an Upload button. The words say "upload what you have, or what your school
//     requires", and nothing is called required or missing. The document list (ASPIRE's items and
//     the school's own) is edited here, through the drawer that used to sit on At a Glance.
//   Forms: the school's own forms (SchoolForms), unchanged, now one tab of Documents.
//
// The sheet reads /api/portal/school-student-records `sheet` and uploads through the same signed
// path as the student drawer (uploadClearanceFile), so a file lands on the same record. An Owner or
// Admin preview reads and uploads nothing. Words and cell states: src/lib/ap/documentSheet.js.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Check, Upload } from 'lucide-react'
import { lazyReload } from '../../lib/lazyReload'
import { useAuth } from '../../contexts/AuthContext'
import PageBar from '../../components/shared/PageBar'
import SegmentedPicker from '../../components/shared/SegmentedPicker'
import { LoadingState, EmptyState, ErrorState, DeniedState } from '../unit/UnitLeaderChrome'
import { PortalHeaderScope, PortalHeaderControls } from '../PortalHeaderSlots'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import UnitStudentAvatar from '../unit/UnitStudentAvatar'
import { useSchoolStudentPhotos } from './useSchoolStudentPhotos'
import { cohortOptions, inCohortScope } from './academicPartnerRoster'
import { readPortalCohort, writePortalCohort } from '../../lib/portalCohortMemory'
import { getDocumentSheet, getSchoolStudents, postSchoolStudentRecord, uploadClearanceFile } from './academicPartnerApi'
import { sheetColumns, sheetCell, columnCounts, gapsFor, onSheet, SHEET_GUIDANCE } from '../../lib/ap/documentSheet'
import { validatePick, acceptFor } from '../../lib/documents/documentChecklist'
import { getStudentPreferredFullName } from '../../lib/studentNameFormatters'
import './schoolDocuments.css'

const SchoolForms = lazyReload(() => import('./SchoolForms'), 'SchoolForms')
const SchoolChecklistDrawer = lazyReload(() => import('./SchoolChecklistDrawer'), 'SchoolChecklistDrawer')

const TABS = [
  { value: 'students', label: 'Student Documents' },
  { value: 'forms', label: 'Forms' },
]
const UPLOAD_ERRORS = {
  invalid_type: 'That file type is not accepted.', too_large: 'That file is over 10 MB.',
  same_file: 'That is the same file already on record.', date_required: 'Enter the date first.',
  date_unconfirmed: 'Confirm the date against the file.', preview_read_only: 'Staff previews are read-only.',
  not_enabled: 'Documents are not set up yet.',
}
const today = () => new Date().toLocaleDateString('en-CA')
function fmtDay(ymd) {
  if (!ymd) return ''
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SchoolDocuments({ tab = 'students', onTab, formId = null, formMode = 'list', onOpenForm, onFormsList }) {
  const formOpen = Boolean(formId)
  const forms = (
    <Suspense fallback={<LoadingState label="Loading your forms" />}>
      <SchoolForms formId={formId} mode={formMode} onOpen={onOpenForm} onList={onFormsList} />
    </Suspense>
  )
  // A form's builder or responses fill the page, as they did under Forms.
  if (formOpen) return forms
  return (
    <div className="ptl-page ptl-ap-page apd-page">
      <div className="apd-tabs">
        <SegmentedPicker ariaLabel="Documents view" options={TABS} value={tab} onChange={v => onTab?.(v)} />
      </div>
      {tab === 'forms' ? forms : <DocumentSheet />}
    </div>
  )
}

function useToast() {
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), toast.kind === 'err' ? 7000 : 4500)
    return () => clearTimeout(t)
  }, [toast])
  const notify = useCallback((text, kind = 'ok') => setToast({ text, kind, at: Date.now() }), [])
  const node = toast ? <div className={`apd-toast${toast.kind === 'err' ? ' apd-toast-err' : ''}`} role={toast.kind === 'err' ? 'alert' : 'status'}>{toast.text}</div> : null
  return [notify, node]
}

const EMPTY = []

function DocumentSheet() {
  const { user } = useAuth()
  const [roster, setRoster] = useState({ status: 'loading', schools: null })
  const [sheet, setSheet] = useState({ forKey: null, status: 'loading', enabled: true, types: [], layouts: {}, cells: {}, readOnly: true })
  const [reloadKey, setReloadKey] = useState(0)
  const [sheetTick, setSheetTick] = useState(0)
  const [schoolKey, setSchoolKey] = useState(null)
  const [cohortPick, setCohortPick] = useState(null)
  const [query, setQuery] = useState('')
  const [gapsOnly, setGapsOnly] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [dated, setDated] = useState(null)   // { student, column } waiting for its date
  const listRef = useRef(null)
  const [notify, toastNode] = useToast()

  const reload = useCallback(() => { setReloadKey(k => k + 1); setSheetTick(t => t + 1) }, [])
  useRegisterPortalRefresh(reload)

  useEffect(() => {
    let live = true
    getSchoolStudents().then(r => {
      if (!live) return
      setRoster(r.ok ? { status: 'ready', schools: r.data?.schools || [] } : { status: 'error', schools: null })
    })
    return () => { live = false }
  }, [reloadKey])

  const schools = roster.schools || EMPTY
  const school = schools.find(s => s.school_key === schoolKey) || schools[0] || null
  const allStudents = school?.students || EMPTY
  const { options, defaultId, currentIds } = cohortOptions(school?.cohorts || [])
  const remembered = school ? readPortalCohort(user?.id, `ap:${school.school_key}`) : null
  const cohortId = [cohortPick, remembered].find(id => id && options.some(o => o.id === id)) || defaultId
  const students = allStudents.filter(s => inCohortScope(s, cohortId, currentIds) && onSheet(s))
    .sort((a, b) => String(a.last_name || '').localeCompare(String(b.last_name || '')) || String(a.first_name || '').localeCompare(String(b.first_name || '')))
  const ids = students.map(s => s.id).join(',')
  const sheetKey = `${ids}#${sheetTick}`

  useEffect(() => {
    if (roster.status !== 'ready' || !ids) return undefined
    let live = true
    getDocumentSheet(ids.split(',')).then(r => {
      if (!live) return
      if (!r.ok) setSheet(s => ({ ...s, forKey: sheetKey, status: 'error' }))
      else setSheet({ forKey: sheetKey, status: 'ready', enabled: r.data?.enabled !== false, types: r.data?.types || [], layouts: r.data?.layouts || {}, cells: r.data?.cells || {}, readOnly: r.data?.readOnly === true })
    })
    return () => { live = false }
  }, [ids, sheetKey, roster.status])

  const photos = useSchoolStudentPhotos(allStudents)
  const t0 = today()
  const columns = sheetColumns(sheet.types, school?.school_key, sheet.layouts?.[school?.school_key])
  const counts = columnCounts(columns, students.map(s => s.id), sheet.cells, t0)
  const shown = students.filter(s => {
    const q = query.trim().toLowerCase()
    if (q && !getStudentPreferredFullName(s).toLowerCase().includes(q)) return false
    if (gapsOnly && !gapsFor(columns, sheet.cells[s.id], t0).length) return false
    return true
  })

  const upload = useCallback(async (student, column, file, docDate = null) => {
    const problem = validatePick(column.key, file)
    if (problem) { notify(problem, 'err'); return false }
    const r = await uploadClearanceFile({ studentId: student.id, docType: column.key, file, docDate, dateConfirmed: Boolean(docDate) })
    if (!r.ok) { notify(UPLOAD_ERRORS[r.error] || 'That file could not be uploaded.', 'err'); return false }
    notify(`${column.label} filed for ${getStudentPreferredFullName(student)}.`)
    setSheetTick(t => t + 1)
    return true
  }, [notify])

  const open = useCallback(async (versionId) => {
    const r = await postSchoolStudentRecord({ action: 'open', version_id: versionId })
    if (r.ok && r.data?.url) window.open(r.data.url, '_blank', 'noopener')
    else notify('That file could not be opened.', 'err')
  }, [notify])

  if (roster.status === 'loading') return <LoadingState label="Loading your students" />
  if (roster.status === 'error') return <ErrorState detail="We could not load your students right now. Please try again shortly." onRetry={reload} />
  if (!schools.length) {
    return <DeniedState title="No school linked yet" detail="Your account is active, but no school is connected to it yet. The ASPIRE team connects your school." />
  }

  const sheetReady = !ids || sheet.forKey === sheetKey
  const readOnly = sheet.readOnly

  return (
    <>
      <PortalHeaderScope>{schools.length === 1 ? <> · {school.school_key}</> : null}</PortalHeaderScope>
      <PortalHeaderControls>
        {schools.length > 1 && (
          <span className="ptl-header-ctl">
            <span className="ptl-header-ctl-label">School</span>
            <select aria-label="School" value={school.school_key} onChange={e => { setSchoolKey(e.target.value); setCohortPick(null) }}>
              {schools.map(s => <option key={s.school_key} value={s.school_key}>{s.school_key}</option>)}
            </select>
          </span>
        )}
        <span className="ptl-header-ctl" data-portal-cohort-picker="true">
          <span className="ptl-header-ctl-label">Cohort</span>
          <select aria-label="Cohort" value={cohortId} onChange={e => { setCohortPick(e.target.value); writePortalCohort(user?.id, `ap:${school.school_key}`, e.target.value) }}>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </span>
      </PortalHeaderControls>

      <PageBar name="Student Documents" as="h2" meta={SHEET_GUIDANCE}
        actions={sheet.enabled ? (
          <button ref={listRef} type="button" className="ptl-btn-outline ptl-btn-sm" onClick={() => setListOpen(true)}>
            {readOnly ? 'Document List' : 'Edit Document List'}
          </button>
        ) : null} />

      {!sheetReady ? <LoadingState label="Loading documents" />
        : sheet.status === 'error' ? <ErrorState detail="The documents could not be loaded just now." onRetry={() => setSheetTick(t => t + 1)} />
        : !sheet.enabled ? <EmptyState title="Documents" detail="Uploading student documents is being prepared and is not active yet." />
        : !students.length ? <EmptyState title="No students in this cohort" detail="Choose a different cohort to see more of your school's students." />
        : (
          <div className="ptl-card apd-card">
            <div className="apd-tools">
              <input type="search" className="apd-search" placeholder="Search students" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search students" />
              <label className="apd-gaps">
                <input type="checkbox" checked={gapsOnly} onChange={e => setGapsOnly(e.target.checked)} />
                Only students with something not on file
              </label>
              <span className="apd-count">{shown.length} of {students.length} students</span>
            </div>
            <div className="apd-frame">
              <table className="apd-table">
                <thead>
                  <tr>
                    <th scope="col" className="aspire-th apd-name-col">Student</th>
                    {columns.map(c => (
                      <th key={c.key} scope="col" className="aspire-th">
                        <span className="apd-col-name">{c.label}{c.own && <span className="apd-own">Your school</span>}</span>
                        <span className="apd-col-count">{counts[c.key].onFile} of {students.length} on file</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!shown.length && (
                    <tr><td colSpan={columns.length + 1} className="apd-none">No students match.</td></tr>
                  )}
                  {shown.map(s => {
                    const name = getStudentPreferredFullName(s)
                    return (
                      <tr key={s.id}>
                        <th scope="row" className="apd-name-col">
                          <span className="apd-who">
                            <UnitStudentAvatar url={photos.peek(s.id)} name={name} size={28} />
                            <span>{name}</span>
                          </span>
                        </th>
                        {columns.map(c => (
                          <td key={c.key}>
                            <SheetCell cell={sheetCell(sheet.cells[s.id]?.[c.key], c, t0)} column={c} student={s}
                              readOnly={readOnly} onOpen={open} onUpload={upload}
                              onNeedDate={() => setDated({ student: s, column: c })} />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="ptl-muted ptl-small apd-foot">
              Files go to each student&apos;s record, where the ASPIRE team can see them. Uploading a file again keeps the earlier one in the record&apos;s history.
              Students who are not proceeding are not listed.
            </p>
          </div>
        )}

      {dated && <DateUpload student={dated.student} column={dated.column} onClose={() => setDated(null)}
        onUpload={async (file, date) => { if (await upload(dated.student, dated.column, file, date)) setDated(null) }} />}
      {listOpen && (
        <Suspense fallback={null}>
          <SchoolChecklistDrawer schoolKey={school.school_key} returnFocusRef={listRef}
            onClose={() => setListOpen(false)} onChanged={() => setSheetTick(t => t + 1)} />
        </Suspense>
      )}
      {toastNode}
    </>
  )
}

function SheetCell({ cell, column, student, readOnly, onOpen, onUpload, onNeedDate }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const pick = () => (column.needsDate ? onNeedDate() : fileRef.current?.click())
  const name = getStudentPreferredFullName(student)
  const input = !readOnly && !column.needsDate && (
    <input ref={fileRef} type="file" hidden accept={acceptFor(column.key)}
      onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); await onUpload(student, column, f); setBusy(false) }} />
  )
  if (cell.state === 'none') {
    if (readOnly) return <span className="apd-empty">Not on file</span>
    return (
      <>
        {input}
        <button type="button" className="apd-upload" disabled={busy} onClick={pick} aria-label={`Upload ${column.label} for ${name}`}>
          <Upload size={13} aria-hidden="true" /> {busy ? 'Uploading' : 'Upload'}
        </button>
      </>
    )
  }
  const expired = cell.state === 'expired'
  return (
    <span className={`apd-file${expired ? ' apd-file-expired' : ''}`}>
      <button type="button" className="apd-open" onClick={() => onOpen(cell.versionId)} title={cell.fileName}
        aria-label={`Open ${column.label} for ${name}${expired ? ', expired' : ''}`}>
        {!expired && <Check size={13} aria-hidden="true" />}
        {expired ? 'Expired' : 'On file'}
      </button>
      <span className="apd-sub">{cell.dateWord && cell.dateWord !== 'Expired' ? `${cell.dateWord} ${fmtDay(cell.docDate)}` : expired ? fmtDay(cell.docDate) : `Added ${fmtDay(cell.uploadedOn)}`}</span>
      {!readOnly && (
        <>
          {input}
          <button type="button" className="apd-replace" disabled={busy} onClick={pick} aria-label={`Replace ${column.label} for ${name}`}>
            {busy ? 'Uploading' : 'Replace'}
          </button>
        </>
      )}
    </span>
  )
}

/** A dated document asks for its date, and for the coordinator to check it against the file. */
function DateUpload({ student, column, onClose, onUpload }) {
  const fileRef = useRef(null)
  const [date, setDate] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const ready = date && confirmed && !busy
  return (
    <div className="ptl-modal-backdrop" onMouseDown={onClose}>
      <div className="ptl-modal apd-modal" role="dialog" aria-modal="true" aria-labelledby="apd-date-h" onMouseDown={e => e.stopPropagation()}>
        <div className="ptl-modal-head"><h2 id="apd-date-h">{column.label} for {getStudentPreferredFullName(student)}</h2></div>
        <div className="ptl-modal-body apd-modal-body">
          {column.qualifier && <p className="ptl-muted">{column.qualifier}</p>}
          <label className="apd-field">
            <span>{column.dateLabel}</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} autoFocus />
          </label>
          <label className="apd-check">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            I checked this date against the file
          </label>
          <input ref={fileRef} type="file" hidden accept={acceptFor(column.key)}
            onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); await onUpload(f, date); setBusy(false) }} />
        </div>
        <div className="ptl-modal-actions">
          <button type="button" className="ptl-btn-outline" onClick={onClose}>Cancel</button>
          <button type="button" className="ptl-btn" disabled={!ready} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading' : 'Choose file'}</button>
        </div>
      </div>
    </div>
  )
}

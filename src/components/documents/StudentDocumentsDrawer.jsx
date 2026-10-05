// src/components/documents/StudentDocumentsDrawer.jsx
//
// STUDENT-DOCUMENTS-1 (résumé review build, Phase 2): an alumnus's Documents, opened from
// Residency (the applicant drawer and Support's By Alumnus), so the staff app's cohort
// never changes to reach someone from a past cohort (Owner, 2026-10-04, option B).
// Reference: docs/mockups/support-resume-review.html, the Documents view.
//
// The résumé card on top, the NGRP application checklist below. Replacing never
// deletes: the old file stays in the version history. Every rule (status, detail, the
// summary line) is src/lib/documents/documentChecklist.js; nothing is decided here.
// Keith's checks and scores arrive in Phase 3, the Request button with Outreach in Phase 4.
import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileText, Upload } from 'lucide-react'
import DetailDrawer from '../ui/DetailDrawer'
import DataSheet, { Pill, Missing } from '../shared/DataSheet'
import { displayName } from '../../lib/utils'
import { openStudentFile } from '../../lib/useStudentFile'
import {
  useStudentDocuments, uploadStudentDocument, openStudentDocumentVersion, uploadErrorText, studentDocumentsKey,
} from '../../lib/documents/studentDocumentsClient'
import {
  checklistRows, checklistSummary, currentVersion, versionHistory, shortDay,
  needsDate, dateLabel, acceptFor, validatePick, VIA_LABEL,
} from '../../lib/documents/documentChecklist'
import './studentDocuments.css'

const firstName = s => s?.preferred_first_name || s?.first_name || displayName(s)
const extBadge = name => String(name || '').split('.').pop().toUpperCase().slice(0, 4) || 'FILE'
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function FileChip({ name, meta, onView, viewLabel, badge }) {
  return (
    <div className="sd-filechip">
      <span className="sd-ficon" aria-hidden="true">{badge || extBadge(name)}</span>
      <div className="sd-fileinfo">
        <div className="sd-filename">{name}</div>
        {meta && <div className="sd-filemeta">{meta}</div>}
      </div>
      {onView && <button type="button" className="sd-btn" onClick={onView} aria-label={viewLabel}>View</button>}
    </div>
  )
}

// A drop zone that is also a real button (the keyboard and screen readers use the button).
function DropZone({ accept, onPick, children, disabled }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)
  return (
    <div
      className={`sd-drop${over ? ' sd-drop-over' : ''}`}
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && e.dataTransfer.files?.[0]) onPick(e.dataTransfer.files[0]) }}
    >
      <Upload size={18} aria-hidden="true" className="sd-drop-icon" />
      <div className="sd-drop-text">{children}</div>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f) }} />
      <button type="button" className="sd-btn sd-btn-pri" disabled={disabled} onClick={() => input.current?.click()}>Choose file</button>
    </div>
  )
}

// ── Upload or replace one document ───────────────────────────────────────────
function UploadPanel({ student, types, rowsByType, initialType, initialFile, onCancel, onSaved, toast }) {
  const [docType, setDocType] = useState(initialType || '')
  const [file, setFile] = useState(initialFile || null)
  const [docDate, setDocDate] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const type = types.find(t => t.key === docType) || null
  const row = docType ? rowsByType.get(docType) : null
  const replacing = Boolean(row?.hasFile)
  const pickError = file && docType ? validatePick(docType, file) : null
  const dated = needsDate(type)
  const ready = type && file && !pickError && (!dated || (docDate && confirmed)) && !busy
  const ordered = useMemo(() => [...types].sort((a, b) => (Number(b.required) - Number(a.required)) || (a.sort_order - b.sort_order)), [types])
  const currentName = row?.current?.file_name || (row?.hasFile ? 'The résumé on the student record' : null)

  const save = async (e) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError('')
    const r = await uploadStudentDocument({ studentId: student.id, docType, file, docDate: dated ? docDate : null, dateConfirmed: dated && confirmed })
    setBusy(false)
    if (!r.ok) { setError(uploadErrorText(r)); return }
    toast?.success?.(`${type.label} ${replacing ? 'replaced' : 'uploaded'}`, `${type.label} ${replacing ? 'replaced in' : 'uploaded to'} ${firstName(student)}'s documents.`)
    if (r.warning === 'record_not_updated') {
      toast?.warning?.('Student record not updated', 'The new résumé is in Documents, but the student record still shows the previous file. Upload it again to update the record.')
    }
    onSaved()
  }

  return (
    <form className="sd-upload" onSubmit={save} aria-labelledby="sd-upload-title">
      <h3 id="sd-upload-title" className="sd-h3">{replacing && type ? `Replace ${firstName(student)}'s ${type.key === 'resume' ? 'current résumé' : type.label}?` : 'Upload Document'}</h3>

      {!initialType && (
        <label className="sd-field">
          <span className="sd-label">Document</span>
          <select className="sd-input" value={docType} onChange={(e) => { setDocType(e.target.value); setDocDate(''); setConfirmed(false) }} required>
            <option value="">Choose…</option>
            {ordered.map(t => <option key={t.key} value={t.key}>{t.label}{t.required ? '' : ' (optional)'}</option>)}
          </select>
        </label>
      )}

      {replacing && file ? (
        <div className="sd-swap">
          <div>
            <div className="sd-mono">Current → history</div>
            <FileChip name={currentName} badge={row?.current ? undefined : 'CV'} meta={row?.current ? `Uploaded ${shortDay(row.current.uploaded_at)}` : 'Kept as an earlier version'} />
          </div>
          <div>
            <div className="sd-mono">New current</div>
            <FileChip name={file.name} meta={`${Math.max(1, Math.round(file.size / 1024))} KB`} />
          </div>
        </div>
      ) : file ? (
        <FileChip name={file.name} meta={`${Math.max(1, Math.round(file.size / 1024))} KB`} />
      ) : null}

      <DropZone accept={docType ? acceptFor(docType) : undefined} onPick={(f) => { setFile(f); setError('') }} disabled={busy}>
        <b>{file ? 'Choose a different file' : 'Drop the file here.'}</b>{' '}
        <span className="sd-muted">PDF or Word{docType && docType !== 'resume' ? ', or a photo (JPG, PNG)' : ''}, up to 10 MB.</span>
      </DropZone>
      {pickError && <p className="sd-error" role="alert">{pickError}</p>}

      {dated && (
        <div className="sd-datecheck">
          <label className="sd-field">
            <span className="sd-label">{dateLabel(type)}</span>
            <input className="sd-input sd-date" type="date" value={docDate} onChange={(e) => { setDocDate(e.target.value); setConfirmed(false) }} required />
          </label>
          <p className="sd-muted">Read this from the file. Check it against the file before you save.</p>
          <label className="sd-check">
            <input type="checkbox" checked={confirmed} disabled={!docDate} onChange={(e) => setConfirmed(e.target.checked)} />
            I checked this date against the file.
          </label>
        </div>
      )}

      {error && <p className="sd-error" role="alert">{error}</p>}
      <div className="sd-upload-foot">
        <span className="sd-muted">Nothing is deleted. Old versions stay in history.</span>
        <span className="sd-actions">
          <button type="button" className="sd-btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="sd-btn sd-btn-pri" disabled={!ready}>
            {busy ? 'Saving…' : replacing ? 'Replace' : 'Upload'}
          </button>
        </span>
      </div>
    </form>
  )
}

// ── The résumé card ──────────────────────────────────────────────────────────
function ResumeCard({ student, doc, resumeOnRecord, canWrite, onPick, toast }) {
  const current = currentVersion(doc)
  const history = versionHistory(doc)
  const onRecordOnly = !current && resumeOnRecord
  const viewCurrent = async () => {
    const r = current ? await openStudentDocumentVersion(current.id) : await openStudentFile({ studentId: student.id, kind: 'resume' })
    if (!r.ok) toast?.error?.('Could not open the résumé', 'Try again in a moment.')
  }
  const openVersion = async (v) => {
    const r = await openStudentDocumentVersion(v.id)
    if (!r.ok) toast?.error?.('Could not open that version', 'Try again in a moment.')
  }
  return (
    <section className="sd-card sd-resume" aria-labelledby="sd-resume-title">
      <div className="sd-resume-main">
        <div className="sd-mono">Résumé · current</div>
        <h3 id="sd-resume-title" className="sd-h2">Résumé</h3>
        {current ? (
          <FileChip name={current.file_name} meta={`Uploaded ${shortDay(current.uploaded_at)}${current.pages != null ? ` · ${current.pages} ${current.pages === 1 ? 'page' : 'pages'}` : ''}`}
            onView={viewCurrent} viewLabel="View the current résumé" />
        ) : onRecordOnly ? (
          <FileChip name="Résumé on the student record" badge="CV" meta="Uploaded before version history" onView={viewCurrent} viewLabel="View the current résumé" />
        ) : (
          <p className="sd-muted sd-none">No résumé on file yet.</p>
        )}
        {canWrite && (
          <DropZone accept={acceptFor('resume')} onPick={onPick}>
            <b>Drop a new résumé here.</b>{' '}
            <span className="sd-muted">PDF or Word, up to 10 MB. The current one moves to its history.</span>
          </DropZone>
        )}
      </div>
      <div className="sd-resume-side">
        <div className="sd-mono">Version history</div>
        {history.length === 0 ? (
          <p className="sd-muted sd-none">{onRecordOnly ? 'The file on the student record becomes version one when it is replaced.' : 'No versions yet.'}</p>
        ) : (
          <ol className="sd-versions">
            {history.map(v => (
              <li key={v.id} className="sd-version">
                <span className="sd-vdate">{shortDay(v.uploaded_at)}</span>
                <span className="sd-vwhat">
                  {v.isCurrent ? <Pill tone="ok">Current</Pill> : <Pill tone="off">Earlier</Pill>}
                  <span className="sd-muted">{VIA_LABEL[v.uploaded_via] || ''}</span>
                </span>
                <button type="button" className="sd-link" onClick={() => openVersion(v)} aria-label={`Open the version from ${shortDay(v.uploaded_at)}`}>Open</button>
              </li>
            ))}
          </ol>
        )}
        <p className="sd-note">Replacing never deletes. The current file moves here, so you can see how it changed across reviews.</p>
      </div>
    </section>
  )
}

// ── The drawer ───────────────────────────────────────────────────────────────
export default function StudentDocumentsDrawer({ open, student, onClose, toast, subline = null }) {
  const queryClient = useQueryClient()
  const docs = useStudentDocuments(student?.id, { enabled: open })
  const [upload, setUpload] = useState(null) // { type, file } | { type: null }
  const { types, documents, resumeOnRecord } = docs
  const rows = useMemo(() => checklistRows(types, documents, { today: localToday(), resumeOnRecord }), [types, documents, resumeOnRecord])
  const summary = useMemo(() => checklistSummary(types, documents, { resumeOnRecord }), [types, documents, resumeOnRecord])
  const rowsByType = useMemo(() => new Map(rows.map(r => [r.type.key, r])), [rows])
  const resumeDoc = docs.documents.find(d => d.doc_type === 'resume') || null

  if (!student) return null
  const close = () => { setUpload(null); onClose() }
  const saved = () => {
    setUpload(null)
    queryClient.invalidateQueries({ queryKey: studentDocumentsKey(student.id) })
  }
  const view = async (row) => {
    const r = row.current ? await openStudentDocumentVersion(row.current.id) : await openStudentFile({ studentId: student.id, kind: 'resume' })
    if (!r.ok) toast?.error?.('Could not open the document', 'Try again in a moment.')
  }

  const columns = [
    { key: 'doc', label: 'Document', min: 150, grow: 2, priority: 1, sortValue: r => r.type.sort_order,
      render: r => (
        <span className="sd-docname">
          <b>{r.type.label}</b>
          {r.type.qualifier && <span className="sd-muted"> · {r.type.qualifier}</span>}
        </span>
      ) },
    { key: 'status', label: 'Status', min: 90, grow: 0.8, priority: 2, sortValue: r => r.status.label,
      render: r => <Pill tone={r.status.tone}>{r.status.label}</Pill> },
    { key: 'updated', label: 'Updated', min: 96, grow: 0.8, align: 'right', priority: 3, sortValue: r => r.updated,
      render: r => (r.updated ? shortDay(r.updated) : <Missing />) },
    { key: 'detail', label: 'Detail', min: 150, grow: 1.4, priority: 2, sortValue: r => r.detail?.text || '',
      render: r => (r.detail ? <span className={r.detail.warn ? 'sd-warn' : undefined}>{r.detail.text}</span> : <Missing />) },
    { key: 'actions', label: '', title: 'Actions', min: 120, grow: 0.9, align: 'right', priority: 1,
      render: r => (
        <span className="sd-rowacts">
          {r.hasFile && <button type="button" className="sd-btn sd-btn-sm" onClick={() => view(r)} aria-label={`View ${r.type.label}`}>View</button>}
          {docs.canWrite && (
            <button type="button" className="sd-btn sd-btn-sm" onClick={() => setUpload({ type: r.type.key })} aria-label={`${r.hasFile ? 'Replace' : 'Upload'} ${r.type.label}`}>
              {r.hasFile ? 'Replace' : 'Upload'}
            </button>
          )}
        </span>
      ) },
  ]

  return (
    <DetailDrawer open={open} onClose={close} title={`Documents · ${displayName(student)}`} width={1040} trapFocus>
      <div className="sd-root">
        <div className="sd-who">
          <FileText size={16} aria-hidden="true" />
          <span>{displayName(student)}</span>
          {subline && <span className="sd-muted">· {subline}</span>}
        </div>

        {docs.status === 'loading' && <p className="sd-muted" aria-live="polite">Loading documents…</p>}
        {docs.status === 'error' && (
          <p className="sd-error" role="alert">
            Documents could not load. <button type="button" className="sd-link" onClick={() => docs.refetch()}>Try again</button>
          </p>
        )}
        {docs.status === 'unprovisioned' && (
          <div className="sd-card sd-pad">
            <h3 className="sd-h3">Documents are almost ready</h3>
            <p className="sd-muted">They switch on once the documents update (migration 20261104000000) is applied. The résumé on the student record is unchanged.</p>
          </div>
        )}

        {docs.status === 'ok' && (upload ? (
          <div className="sd-card sd-pad">
            <UploadPanel student={student} types={docs.types} rowsByType={rowsByType}
              initialType={upload.type} initialFile={upload.file || null}
              onCancel={() => setUpload(null)} onSaved={saved} toast={toast} />
          </div>
        ) : (
          <>
            <ResumeCard student={student} doc={resumeDoc} resumeOnRecord={docs.resumeOnRecord} canWrite={docs.canWrite}
              onPick={file => setUpload({ type: 'resume', file })} toast={toast} />

            <section className="sd-card sd-pad" aria-labelledby="sd-check-title">
              <div className="sd-checkhead">
                <div>
                  <h3 id="sd-check-title" className="sd-h2">Application Documents</h3>
                  <div className="sd-progress">
                    <span><b>{summary.onFile}</b> of {summary.required} required on file</span>
                    <span className="sd-bar" aria-hidden="true"><i style={{ width: `${Math.round(summary.share * 100)}%` }} /></span>
                    {summary.missing.length > 0 && <span className="sd-muted">Missing: {summary.missing.join(', ')}</span>}
                  </div>
                </div>
                {docs.canWrite && (
                  <button type="button" className="sd-btn sd-btn-pri" onClick={() => setUpload({ type: null })}>
                    <Upload size={14} aria-hidden="true" /> Upload Documents
                  </button>
                )}
              </div>
              <DataSheet level="plain" columns={columns} rows={rows} rowKey={r => r.type.key} defaultSort={null}
                aria-label="Application documents" emptyMessage="No document types are set up." />
              <p className="sd-note">Replacing a document moves the old file to its version history. For a transcript or a card, enter the date from the file and confirm it.</p>
            </section>
          </>
        ))}
      </div>
    </DetailDrawer>
  )
}


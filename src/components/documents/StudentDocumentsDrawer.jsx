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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import ResumeReviewDrawer from './ResumeReviewDrawer'
import KeithMark from '../keith/KeithMark'
import { startResumeReview, reviewErrorText } from '../../lib/documents/studentDocumentsClient'
import { reviewState } from '../../lib/documents/resumeReviewModel'
import { detectDocumentDate, readPdfText } from '../../lib/documents/documentDates'
import { writeLaunchContext } from '../../lib/connect/launchContext'
import { documentRequestHandoff, outreachHandoffPath } from '../../lib/documents/supportHandoffModel'
import { confirmDialog } from '../shared/confirmDialog'

const firstName = s => s?.preferred_first_name || s?.first_name || displayName(s)
const extBadge = name => String(name || '').split('.').pop().toUpperCase().slice(0, 4) || 'FILE'
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function FileChip({ name, meta, onView, viewLabel, badge, mark = null }) {
  return (
    <div className="sd-filechip">
      <span className="sd-ficon" aria-hidden="true">{badge || extBadge(name)}</span>
      <div className="sd-fileinfo">
        <div className="sd-filename">{name}</div>
        {meta && <div className="sd-filemeta">{mark}{meta}</div>}
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
function UploadPanel({ student, types, rowsByType, initialType, initialFile, canScore, onCancel, onSaved, toast }) {
  const [docType, setDocType] = useState(initialType || '')
  const [file, setFile] = useState(initialFile || null)
  const [docDate, setDocDate] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [dateFound, setDateFound] = useState(null)
  const [scoreAfter, setScoreAfter] = useState(true)
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

  // RESUME-REVIEW-1: no AI. A PDF with real text is read in this browser for the one date the
  // type needs, and the date is pre-filled; staff still check it and tick the box. Runs when a
  // file is picked or the type changes, never on its own.
  const detectSeq = useRef(0)
  const detectDate = (f, t) => {
    const seq = ++detectSeq.current
    setDateFound(null)
    if (!f || !needsDate(t)) return
    readPdfText(f).then((txt) => {
      if (seq !== detectSeq.current || !txt) return
      const found = detectDocumentDate(txt, t.check_kind)
      if (!found) return
      setDateFound(found)
      setDocDate(found.date)
      setConfirmed(false)
    })
  }
  const pickFile = (f) => { setFile(f); setError(''); detectDate(f, type) }

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
    onSaved({ docType, version: r.version, score: docType === 'resume' && canScore && scoreAfter })
  }

  return (
    <form className="sd-upload" onSubmit={save} aria-labelledby="sd-upload-title">
      <h3 id="sd-upload-title" className="sd-h3">{replacing && type ? `Replace ${firstName(student)}'s ${type.key === 'resume' ? 'current résumé' : type.label}?` : 'Upload Document'}</h3>

      {!initialType && (
        <label className="sd-field">
          <span className="sd-label">Document</span>
          <select className="sd-input" value={docType} onChange={(e) => { setDocType(e.target.value); setDocDate(''); setConfirmed(false); detectDate(file, types.find(t => t.key === e.target.value)) }} required>
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

      <DropZone accept={docType ? acceptFor(docType) : undefined} onPick={pickFile} disabled={busy}>
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
          <p className="sd-muted">
            {dateFound
              ? <>Read from the file: “{dateFound.label} {dateFound.raw}”{dateFound.monthOnly ? ' (a month and year, so the last day of that month)' : ''}. Check it against the file before you save.</>
              : 'Read this from the file. Check it against the file before you save.'}
          </p>
          <label className="sd-check">
            <input type="checkbox" checked={confirmed} disabled={!docDate} onChange={(e) => setConfirmed(e.target.checked)} />
            I checked this date against the file.
          </label>
        </div>
      )}

      {docType === 'resume' && canScore && (
        <label className="sd-check">
          <input type="checkbox" checked={scoreAfter} onChange={e => setScoreAfter(e.target.checked)} />
          Score it with Keith after upload
        </label>
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

// ── Keith at work (RESUME-REVIEW-1) ─────────────────────────────────────────
// One request does all of it, so the steps after the first are an estimate of where Keith
// is, advanced by elapsed time; the panel says so. Closing the drawer does not stop it.
const SCORING_STEPS = [
  { key: 'filed', label: 'Uploaded and filed', at: 0 },
  { key: 'read', label: 'Reading the résumé', at: 0 },
  { key: 'score', label: 'Scoring six categories', at: 7000 },
  { key: 'draft', label: 'Drafting the email', at: 28000 },
]
function ScoringProgress({ startedAt, pages }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const elapsed = now - startedAt
  // The step Keith is on: the last one whose time has come (never the first, which is done).
  const current = Math.max(1, SCORING_STEPS.reduce((acc, st, i) => (elapsed >= st.at ? i : acc), 1))
  return (
    <section className="sd-card sd-pad" aria-labelledby="sd-scoring-title" aria-busy="true">
      <h3 id="sd-scoring-title" className="sd-h3">Keith is scoring the résumé</h3>
      <ol className="rr-steps" aria-live="polite">
        {SCORING_STEPS.map((st, i) => {
          const done = i === 0 || i < current
          const cur = !done && i === current
          const label = st.key === 'read' && pages ? `Reading ${pages} ${pages === 1 ? 'page' : 'pages'}` : st.label
          return (
            <li key={st.key} className={done ? 'rr-done' : cur ? 'rr-cur' : ''} aria-current={cur ? 'step' : undefined}>
              {done ? <span aria-hidden="true">✓</span> : cur ? <span className="rr-spin" aria-hidden="true" /> : <span aria-hidden="true">·</span>}
              {cur ? <b>{label}</b> : label}
            </li>
          )
        })}
      </ol>
      <p className="sd-muted">Usually under a minute. You can close this; the score appears here when it is ready.</p>
    </section>
  )
}

// ── The résumé card ──────────────────────────────────────────────────────────
const REVIEW_PILL = { scored: ['Scored', 'info'], sent: ['Sent', 'ok'], scoring: ['Scoring', 'off'], failed: ['Not scored', 'warn'] }

function ResumeCard({ student, doc, resumeOnRecord, canWrite, onPick, toast, reviewFor, canScore, scoring, onScore, onOpenReview }) {
  const current = currentVersion(doc)
  const history = versionHistory(doc)
  const onRecordOnly = !current && resumeOnRecord
  const currentReview = current ? reviewFor(current.id) : null
  const state = scoring ? 'scoring' : reviewState(currentReview)
  const viewCurrent = async () => {
    const r = current ? await openStudentDocumentVersion(current.id) : await openStudentFile({ studentId: student.id, kind: 'resume' })
    if (!r.ok) toast?.error?.('Could not open the résumé', 'Try again in a moment.')
  }
  const openVersion = async (v) => {
    const r = await openStudentDocumentVersion(v.id)
    if (!r.ok) toast?.error?.('Could not open that version', 'Try again in a moment.')
  }
  const scored = ['scored', 'sent'].includes(state) && currentReview
  const keithMeta = scored ? ` · Keith ${currentReview.score} · ${currentReview.readiness}` : ''
  // The Keith mark (as on receipts and comment themes): drafted, edited or accepted (sent).
  const keithMark = scored && currentReview.provenance_id ? <KeithMark provenanceId={currentReview.provenance_id} /> : null
  return (
    <section className="sd-card sd-resume" aria-labelledby="sd-resume-title">
      <div className="sd-resume-main">
        <div className="sd-mono">Résumé · current</div>
        <div className="sd-titlerow">
          <h3 id="sd-resume-title" className="sd-h2">Résumé</h3>
          {REVIEW_PILL[state] && <Pill tone={REVIEW_PILL[state][1]}>{REVIEW_PILL[state][0]}</Pill>}
        </div>
        {current ? (
          <FileChip name={current.file_name} meta={`Uploaded ${shortDay(current.uploaded_at)}${current.pages != null ? ` · ${current.pages} ${current.pages === 1 ? 'page' : 'pages'}` : ''}${keithMeta}`}
            onView={viewCurrent} viewLabel="View the current résumé" mark={keithMark} />
        ) : onRecordOnly ? (
          <FileChip name="Résumé on the student record" badge="CV" meta="Uploaded before version history" onView={viewCurrent} viewLabel="View the current résumé" />
        ) : (
          <p className="sd-muted sd-none">No résumé on file yet.</p>
        )}
        {(current || onRecordOnly) && (
          <div className="sd-scorerow">
            {scored && <button type="button" className="sd-btn sd-btn-pri" onClick={() => onOpenReview(currentReview.id)}>Open review</button>}
            {/* RESUME-WORKSPACE-1: score the same file again, e.g. after the rubric or the draft
                changed. A new review; the earlier one stays in the review's score history. */}
            {scored && canScore && (
              <button type="button" className="sd-btn" onClick={async () => {
                const ok = await confirmDialog(`Score ${firstName(student)}'s résumé again? Keith reads the same file fresh and writes a new score and draft. The current review stays in its score history.`, { confirmLabel: 'Score again' })
                if (ok) onScore(current?.id || null)
              }}>Score again</button>
            )}
            {!scored && state !== 'scoring' && canScore && (
              <button type="button" className="sd-btn sd-btn-pri" onClick={() => onScore(current?.id || null)}>
                {state === 'failed' ? 'Retry scoring' : 'Score now'}
              </button>
            )}
            {state === 'failed' && currentReview?.error_reason && <span className="sd-muted">{reviewErrorText({ error: currentReview.error_reason })}</span>}
          </div>
        )}
        {canWrite && (
          <DropZone accept={acceptFor('resume')} onPick={onPick}>
            <b>Drop a new résumé here.</b>{' '}
            <span className="sd-muted">PDF or Word, up to 10 MB. The current one moves to its history{canScore ? ', and Keith scores the new one' : ''}.</span>
          </DropZone>
        )}
      </div>
      <div className="sd-resume-side">
        <div className="sd-mono">Version history</div>
        {history.length === 0 ? (
          <p className="sd-muted sd-none">{onRecordOnly ? 'The file on the student record becomes version one when it is scored or replaced.' : 'No versions yet.'}</p>
        ) : (
          <ol className="sd-versions">
            {history.map((v) => {
              const rv = reviewFor(v.id)
              const rvState = reviewState(rv)
              return (
                <li key={v.id} className="sd-version">
                  <span className="sd-vdate">{shortDay(v.uploaded_at)}</span>
                  <span className="sd-vwhat">
                    {['scored', 'sent'].includes(rvState) ? (
                      <>
                        {rv.provenance_id && <KeithMark provenanceId={rv.provenance_id} />}
                        <b className="sd-vscore">{rv.score}</b>
                        <Pill tone={rv.readiness === 'Highly Competitive' ? 'ok' : rv.readiness === 'Competitive' ? 'info' : 'warn'}>{rv.readiness}</Pill>
                        {rvState === 'sent' && <span className="sd-muted">email sent</span>}
                      </>
                    ) : (
                      <>
                        {v.isCurrent ? <Pill tone="ok">Current</Pill> : <Pill tone="off">Earlier</Pill>}
                        <span className="sd-muted">{VIA_LABEL[v.uploaded_via] || ''}{rvState === 'none' ? ', not scored' : ''}</span>
                      </>
                    )}
                  </span>
                  <span className="sd-vacts">
                    {['scored', 'sent'].includes(rvState) && <button type="button" className="sd-link" onClick={() => onOpenReview(rv.id)} aria-label={`Open the review from ${shortDay(v.uploaded_at)}`}>Review</button>}
                    <button type="button" className="sd-link" onClick={() => openVersion(v)} aria-label={`Open the file from ${shortDay(v.uploaded_at)}`}>File</button>
                  </span>
                </li>
              )
            })}
          </ol>
        )}
        <p className="sd-note">Replacing never deletes. The current file moves here with its score, so you can see how it changed across reviews.</p>
      </div>
    </section>
  )
}

// ── The drawer ───────────────────────────────────────────────────────────────
// RESUME-WORKSPACE-1 (Owner, 2026-10-05): `only="resume"` is the résumé screen Support opens:
// the résumé, its versions, Keith's score and the review, and nothing else. The checklist of
// application documents belongs to the applicant (Profiles & Interest), which opens this
// drawer whole.
export default function StudentDocumentsDrawer({ open, student, onClose, toast, subline = null, cycle = null, only = null }) {
  if (!student || !open) return null
  const resumeOnly = only === 'resume'
  return (
    <DetailDrawer open={open} onClose={onClose} title={`${resumeOnly ? 'Résumé' : 'Documents'} · ${displayName(student)}`} width={resumeOnly ? 920 : 1040} trapFocus>
      <StudentDocumentsBody student={student} toast={toast} subline={subline} cycle={cycle} only={only} />
    </DetailDrawer>
  )
}

// APPLICANT-CHART-1: the drawer's body on its own, so the Applicant chart's Documents sheet
// shows the same résumé card and checklist inline (`showWho={false}`: the binder's name plate
// already says whose they are). One body, two hosts; nothing about it is copied.
export function StudentDocumentsBody({ student, toast, subline = null, cycle = null, only = null, showWho = true }) {
  const resumeOnly = only === 'resume'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const docs = useStudentDocuments(student?.id, { enabled: Boolean(student) })
  const [upload, setUpload] = useState(null) // { type, file } | { type: null }
  const [scoring, setScoring] = useState(null) // { startedAt, pages } while Keith works
  const [reviewOpen, setReviewOpen] = useState(null)
  const { types, documents, resumeOnRecord } = docs
  const rows = useMemo(() => checklistRows(types, documents, { today: localToday(), resumeOnRecord }), [types, documents, resumeOnRecord])
  const summary = useMemo(() => checklistSummary(types, documents, { resumeOnRecord }), [types, documents, resumeOnRecord])
  const rowsByType = useMemo(() => new Map(rows.map(r => [r.type.key, r])), [rows])
  const resumeDoc = docs.documents.find(d => d.doc_type === 'resume') || null
  // The newest review of each version (reviews arrive newest first).
  const latestByVersion = useMemo(() => {
    const m = new Map()
    for (const r of docs.reviews) if (!m.has(r.document_version_id)) m.set(r.document_version_id, r)
    return m
  }, [docs.reviews])

  if (!student) return null
  const refresh = () => queryClient.invalidateQueries({ queryKey: studentDocumentsKey(student.id) })
  const score = async (versionId, pages = null) => {
    setScoring({ startedAt: Date.now(), pages })
    const r = await startResumeReview({ studentId: student.id, versionId })
    setScoring(null)
    refresh()
    if (!r.ok) { toast?.error?.('Résumé not scored', reviewErrorText(r)); return }
    toast?.success?.('Résumé scored', `${r.review.score} of 100 · ${r.review.readiness}.`)
    setReviewOpen(r.review.id)
  }
  const saved = (result) => {
    setUpload(null)
    refresh()
    if (result?.score && result.version?.id) score(result.version.id, result.version.pages ?? null)
  }
  // SUPPORT-OUTREACH-1: ask the alumnus for a missing document. Opens an Outreach draft to
  // their personal email; a request never logs support.
  const request = (type) => {
    const ctx = writeLaunchContext(documentRequestHandoff({ type, student, cycle }))
    if (!ctx) { toast?.error?.('Could not open Outreach', 'This browser blocked the hand-off.'); return }
    navigate(outreachHandoffPath(student.id))
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
    { key: 'actions', label: '', title: 'Actions', min: 150, grow: 0.9, align: 'right', priority: 1,
      render: r => (
        <span className="sd-rowacts">
          {r.hasFile && <button type="button" className="sd-btn sd-btn-sm" onClick={() => view(r)} aria-label={`View ${r.type.label}`}>View</button>}
          {!r.hasFile && docs.canWrite && cycle?.id && r.status.key !== 'not_yet' && (
            <button type="button" className="sd-btn sd-btn-sm" onClick={() => request(r.type)} aria-label={`Request ${r.type.label} from ${firstName(student)}`}>Request</button>
          )}
          {docs.canWrite && (
            <button type="button" className="sd-btn sd-btn-sm" onClick={() => setUpload({ type: r.type.key })} aria-label={`${r.hasFile ? 'Replace' : 'Upload'} ${r.type.label}`}>
              {r.hasFile ? 'Replace' : 'Upload'}
            </button>
          )}
        </span>
      ) },
  ]

  return (
    <>
      <div className="sd-root">
        {showWho && <div className="sd-who">
          <FileText size={16} aria-hidden="true" />
          <span>{displayName(student)}</span>
          {subline && <span className="sd-muted">· {subline}</span>}
        </div>}

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
              initialType={upload.type} initialFile={upload.file || null} canScore={docs.canScore && !scoring}
              onCancel={() => setUpload(null)} onSaved={saved} toast={toast} />
          </div>
        ) : (
          <>
            {scoring && <ScoringProgress startedAt={scoring.startedAt} pages={scoring.pages} />}
            <ResumeCard student={student} doc={resumeDoc} resumeOnRecord={docs.resumeOnRecord} canWrite={docs.canWrite}
              onPick={file => setUpload({ type: 'resume', file })} toast={toast}
              reviewFor={id => latestByVersion.get(id) || null} canScore={docs.canScore && !scoring} scoring={Boolean(scoring)}
              onScore={versionId => score(versionId)} onOpenReview={setReviewOpen} />

            {!resumeOnly && <section className="sd-card sd-pad" aria-labelledby="sd-check-title">
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
            </section>}
          </>
        ))}
      </div>
      <ResumeReviewDrawer open={Boolean(reviewOpen)} reviewId={reviewOpen} student={student}
        reviews={docs.reviews.filter(r => (resumeDoc?.versions || []).some(v => v.id === r.document_version_id))}
        versions={resumeDoc?.versions || []} sender={docs.sender} canWrite={docs.canWrite} cycle={cycle}
        onClose={() => setReviewOpen(null)} toast={toast} />
    </>
  )
}


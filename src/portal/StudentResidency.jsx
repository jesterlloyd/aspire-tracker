// src/portal/StudentResidency.jsx
//
// RESIDENCY-TAB-1 (résumé review build, Phase 5): the Student Portal's Residency tab. For ASPIRE
// alumni (Completed students) it takes Shift Log's place in the navigation and is their home
// base for the New Graduate RN Residency Program (Owner, 2026-10-05). Sections, top to bottom:
// a banner for anything the ASPIRE team asked for, Key Dates, Application Documents (upload and
// replace, never deleting; the date on a card or transcript confirmed by them), the Transition
// Form's status, Upcoming Events, and the Support they have had.
//
// The alumnus sees their own records only, and never a Keith score, report, draft or staff
// note: the server sends none (api/portal/my-residency.js), and nothing here asks for one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { postMyResidency, uploadMyDocument, openMyDocument, myUploadErrorText } from '../lib/myResidencyApi'
import { fetchMyCalendarEvents } from '../lib/studentRotationActivity'
import {
  checklistRows, checklistSummary, versionHistory, needsDate, dateLabel, acceptFor, validatePick, shortDay,
} from '../lib/documents/documentChecklist'
import { detectDocumentDate, readPdfText } from '../lib/documents/documentDates'
import { formWords, supportSummary, upcomingResidencyEvents, dayLabel, rangeLabel, localToday } from '../lib/residencyTabModel'
import { useRegisterPortalRefresh } from './PortalRefresh'
import { useReportPortalFailure, ACCESS_FAILURE } from './portalAccessSignal'
import './studentResidency.css'

const CHIP = { ok: 'ptl-chip ptl-chip-ok', warn: 'ptl-chip ptl-chip-wait', off: 'ptl-chip ptl-chip-soft' }

function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number)
  return localToday(new Date(y, m - 1, d + n))
}

// ── Upload or replace one document ───────────────────────────────────────────
function UploadPanel({ type, row, onDone, onCancel }) {
  const [file, setFile] = useState(null)
  const [docDate, setDocDate] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [found, setFound] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  const seq = useRef(0)
  const dated = needsDate(type)
  const replacing = Boolean(row?.hasFile)
  const pickError = file ? validatePick(type.key, file) : null
  const ready = file && !pickError && (!dated || (docDate && confirmed)) && !busy

  const pick = (f) => {
    setFile(f); setError(''); setFound(null)
    const n = ++seq.current
    if (!f || !dated) return
    // No AI: a PDF with real text is read here for the date, and pre-filled for them to check.
    readPdfText(f).then((txt) => {
      if (n !== seq.current || !txt) return
      const hit = detectDocumentDate(txt, type.check_kind)
      if (hit) { setFound(hit); setDocDate(hit.date); setConfirmed(false) }
    })
  }
  const save = async (e) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true); setError('')
    const r = await uploadMyDocument({ docType: type.key, file, docDate: dated ? docDate : null, dateConfirmed: dated && confirmed })
    setBusy(false)
    if (!r.ok) { setError(myUploadErrorText(r)); return }
    onDone(`${type.label} ${replacing ? 'replaced' : 'uploaded'}. Your ASPIRE team can see it now.`)
  }

  return (
    <form className="ptl-card sr-upload" onSubmit={save} aria-labelledby="sr-upload-title">
      <h3 id="sr-upload-title" className="ptl-card-title">{replacing ? `Replace your ${type.label}` : `Upload your ${type.label}`}</h3>
      {replacing && <p className="ptl-muted">Your current file is kept in your history. Nothing is deleted.</p>}
      <div className="sr-drop">
        <span>{file ? file.name : 'Choose a PDF or Word file, or a photo (JPG, PNG), up to 10 MB.'}</span>
        <input ref={input} type="file" accept={acceptFor(type.key)} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f) }} />
        <button type="button" className="ptl-btn ptl-btn-sm" onClick={() => input.current?.click()} disabled={busy}>
          <Upload size={14} aria-hidden="true" /> {file ? 'Choose another' : 'Choose file'}
        </button>
      </div>
      {pickError && <p className="sr-error" role="alert">{pickError}</p>}
      {dated && (
        <div className="sr-datecheck">
          <label className="sr-field">
            <span>{dateLabel(type)}</span>
            <input type="date" value={docDate} onChange={(e) => { setDocDate(e.target.value); setConfirmed(false) }} required />
          </label>
          <p className="ptl-muted">
            {found
              ? <>We read “{found.label} {found.raw}” from your file{found.monthOnly ? ' (a month and year, so the last day of that month)' : ''}. Check it against your document.</>
              : 'Enter the date shown on your document.'}
          </p>
          <label className="sr-check">
            <input type="checkbox" checked={confirmed} disabled={!docDate} onChange={(e) => setConfirmed(e.target.checked)} />
            I checked this date against my document.
          </label>
        </div>
      )}
      {error && <p className="sr-error" role="alert">{error}</p>}
      <div className="sr-actions">
        <button type="button" className="ptl-btn ptl-btn-outline ptl-btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="ptl-btn ptl-btn-sm" disabled={!ready}>{busy ? 'Saving…' : replacing ? 'Replace' : 'Upload'}</button>
      </div>
    </form>
  )
}

export default function StudentResidency({ active }) {
  const [state, setState] = useState({ phase: 'loading', data: null })
  const [events, setEvents] = useState({ loading: true, list: [] })
  const [uploading, setUploading] = useState(null) // type key
  const [historyOpen, setHistoryOpen] = useState(null)
  const [notice, setNotice] = useState('')
  const reportFailure = useReportPortalFailure()
  const today = localToday()

  const load = useCallback(async () => {
    await Promise.resolve()
    const r = await postMyResidency('summary')
    if (!r.ok) {
      const kind = reportFailure({ status: r.status, error: r.error })
      if (kind === ACCESS_FAILURE.ACCESS_ENDED) return
      setState({ phase: r.error === 'not_alumnus' ? 'not_alumnus' : 'error', data: null })
      return
    }
    setState({ phase: 'ready', data: r })
    const ev = await fetchMyCalendarEvents({ from: today, to: addDays(today, 119) })
    setEvents({ loading: false, list: ev.ok ? upcomingResidencyEvents(ev.events || [], today) : [] })
  }, [reportFailure, today])

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) load() })
    return () => { cancelled = true }
  }, [active, load])
  useRegisterPortalRefresh(load, active)

  const data = state.data
  const docs = data?.documents
  const opts = { today, resumeOnRecord: Boolean(docs?.resumeOnRecord) }
  const rows = useMemo(() => (docs ? checklistRows(docs.types, docs.documents, opts) : []), [docs]) // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(() => (docs ? checklistSummary(docs.types, docs.documents, opts) : null), [docs]) // eslint-disable-line react-hooks/exhaustive-deps
  const support = useMemo(() => supportSummary(data?.support || []), [data])

  if (state.phase === 'loading') return <div className="ptl-card" role="status">Loading your residency page…</div>
  if (state.phase === 'not_alumnus') return <div className="ptl-card"><h2 className="ptl-card-title">Residency</h2><p className="ptl-muted">This page opens once you complete ASPIRE.</p></div>
  if (state.phase === 'error') {
    return (
      <div className="ptl-card" role="alert">
        <p className="ptl-muted">Your residency page could not load.</p>
        <button type="button" className="ptl-btn ptl-btn-sm" onClick={() => { setState({ phase: 'loading', data: null }); load() }}>Try again</button>
      </div>
    )
  }

  const form = formWords(data.form?.status)
  const uploadType = uploading ? docs?.types.find(t => t.key === uploading) : null
  const done = (msg) => { setUploading(null); setNotice(msg); load() }
  const view = async (versionId) => { const r = await openMyDocument(versionId); if (!r.ok) setNotice('That file could not be opened. Try again.') }

  return (
    <div className="sr-root">
      <div className="ptl-page-heading">
        <h2>Residency</h2>
        <p>{data.cycle ? `${data.cycle.name} · ` : ''}Your New Graduate RN Residency Program preparation, in one place.</p>
      </div>

      {notice && <div className="ptl-notice ptl-notice-ok" role="status">{notice}</div>}
      {(data.requests || []).map(rq => (
        <div key={rq.doc_type} className="ptl-notice ptl-notice-warn sr-request">
          <span>Your ASPIRE team asked for your <b>{rq.label}</b> on {shortDay(rq.sent_at)}.</span>
          {docs && <button type="button" className="ptl-btn ptl-btn-sm" onClick={() => setUploading(rq.doc_type)}>Upload</button>}
        </div>
      ))}

      {uploadType && (
        <UploadPanel type={uploadType} row={rows.find(r => r.type.key === uploadType.key)} onDone={done} onCancel={() => setUploading(null)} />
      )}

      <section className="ptl-card" aria-labelledby="sr-dates">
        <h3 id="sr-dates" className="ptl-card-title">Key Dates</h3>
        {(data.dates || []).length === 0 ? (
          <p className="ptl-muted">Your residency cohort's dates are not set yet. They will appear here.</p>
        ) : (
          <ul className="sr-dates">
            {data.dates.map(d => (
              <li key={d.key} className={(d.end || d.date) < today ? 'sr-past' : undefined}>
                <span>{d.label}</span><b>{rangeLabel(d.date, d.end)}</b>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ptl-card" aria-labelledby="sr-docs">
        <h3 id="sr-docs" className="ptl-card-title">Application Documents</h3>
        {!data.documentsProvisioned ? (
          <p className="ptl-muted">Uploading opens soon. Your ASPIRE team is finishing the setup.</p>
        ) : (
          <>
            <div className="sr-progress">
              <span><b>{summary.onFile}</b> of {summary.required} required on file</span>
              <span className="sr-bar" aria-hidden="true"><i style={{ width: `${Math.round(summary.share * 100)}%` }} /></span>
              {summary.missing.length > 0 && <span className="ptl-muted">Still needed: {summary.missing.join(', ')}</span>}
            </div>
            <div className="ptl-table-wrap">
              <table className="ptl-table sr-table">
                <thead>
                  <tr>
                    <th className="aspire-th">Document</th>
                    <th className="aspire-th">Status</th>
                    <th className="aspire-th">Updated</th>
                    <th className="aspire-th aspire-th-right"><span className="sr-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.flatMap((r) => {
                    const history = versionHistory(r.doc)
                    const line = (
                      <tr key={r.type.key}>
                        <td>
                          <b>{r.type.label}</b>{r.type.qualifier && <span className="ptl-muted"> · {r.type.qualifier}</span>}
                          {r.detail && <div className={r.detail.warn ? 'sr-warn' : 'ptl-muted'}>{r.detail.text}</div>}
                        </td>
                        <td><span className={CHIP[r.status.tone]}>{r.status.label}</span></td>
                        <td>{r.updated ? shortDay(r.updated) : '–'}</td>
                        <td className="sr-acts">
                          {r.current && <button type="button" className="ptl-btn ptl-btn-outline ptl-btn-sm" onClick={() => view(r.current.id)} aria-label={`View your ${r.type.label}`}>View</button>}
                          <button type="button" className={r.hasFile || r.status.key === 'not_yet' ? 'ptl-btn ptl-btn-outline ptl-btn-sm' : 'ptl-btn ptl-btn-sm'}
                            onClick={() => setUploading(r.type.key)} aria-label={`${r.hasFile ? 'Replace' : 'Upload'} your ${r.type.label}`}>
                            {r.hasFile ? 'Replace' : 'Upload'}
                          </button>
                          {history.length > 1 && (
                            <button type="button" className="sr-link" aria-expanded={historyOpen === r.type.key}
                              onClick={() => setHistoryOpen(h => (h === r.type.key ? null : r.type.key))}>History ({history.length})</button>
                          )}
                        </td>
                      </tr>
                    )
                    if (historyOpen !== r.type.key) return [line]
                    return [line, (
                      <tr key={`${r.type.key}-history`} className="sr-history">
                        <td colSpan={4}>
                          <ul>
                            {history.map(v => (
                              <li key={v.id}>
                                <span>{shortDay(v.uploaded_at)}{v.isCurrent ? ' · current' : ''}</span>
                                <button type="button" className="sr-link" onClick={() => view(v.id)} aria-label={`View the version from ${shortDay(v.uploaded_at)}`}>View</button>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )]
                  })}
                </tbody>
              </table>
            </div>
            <p className="ptl-muted sr-foot">Replacing a document keeps the earlier one in its history. Your ASPIRE team reviews new résumés and sends feedback by email.</p>
          </>
        )}
      </section>

      <section className="ptl-card" aria-labelledby="sr-form">
        <h3 id="sr-form" className="ptl-card-title">Transition Form</h3>
        <p className="sr-formline"><span className={CHIP[form.tone]}>{form.label}</span>
          {data.form?.submitted_at && <span className="ptl-muted">Submitted {shortDay(data.form.submitted_at)}</span>}
          {!data.form?.submitted_at && data.form?.sent_at && <span className="ptl-muted">Sent {shortDay(data.form.sent_at)}</span>}
        </p>
        <p className="ptl-muted">{form.note}</p>
      </section>

      <section className="ptl-card" aria-labelledby="sr-events">
        <h3 id="sr-events" className="ptl-card-title">Upcoming Events</h3>
        {events.loading ? <p className="ptl-muted" role="status">Loading events…</p>
          : events.list.length === 0 ? <p className="ptl-muted">No residency events are scheduled in the next four months.</p>
            : (
              <ul className="sr-events">
                {events.list.map(e => (
                  <li key={e.id}>
                    <b>{e.title}</b>
                    <span className="ptl-muted">{e.all_day ? dayLabel(localToday(new Date(e.start_at))) : new Date(e.start_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}{e.location ? ` · ${e.location}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
      </section>

      <section className="ptl-card" aria-labelledby="sr-support">
        <h3 id="sr-support" className="ptl-card-title">Support You've Had</h3>
        {support.length === 0 ? (
          <p className="ptl-muted">Résumé reviews, Town Halls, Interview Bootcamps and Placement Advising appear here after you take part.</p>
        ) : (
          <ul className="sr-support">
            {support.map(s => (
              <li key={s.activity}><span>{s.label}{s.count > 1 ? ` ×${s.count}` : ''}</span><b>{dayLabel(s.last)}</b></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

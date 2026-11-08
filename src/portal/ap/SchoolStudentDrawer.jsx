// src/portal/ap/SchoolStudentDrawer.jsx
//
// AP-STUDENT-RECORDS-1 (Owner, 2026-11-08): one of the school's own students, opened from the
// roster. The Unit Leader portal's student drawer shell (ptl-drawer, ptl-detail-*), holding:
//   Profile: what the student answered on the intake form, as the server shapes it
//     (src/lib/ap/schoolStudentProfile.js). School email, GPA and expected graduation can be
//     corrected; the student's own answer is kept and shown beside a correction.
//   Clearance Documents: the school uploads the student's clearance files. Filed, no review.
// An Owner/Admin preview reads and never writes.
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { getSchoolStudentRecord, postSchoolStudentRecord, uploadClearanceFile } from './academicPartnerApi'
import { LoadingState, ErrorState } from '../unit/UnitLeaderChrome'
import { CORRECTABLE, CORRECTION_ERRORS } from '../../lib/ap/schoolStudentProfile'
import { clearanceSummary, isExpired } from '../../lib/ap/clearanceChecklist'
import { validatePick, acceptFor } from '../../lib/documents/documentChecklist'
import { confirmDialog } from '../../components/shared/confirmDialog'
import { getStudentPreferredFullName } from '../../lib/studentNameFormatters'
import './schoolStudentDrawer.css'

const DASH = 'Not provided'
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function fmtDay(ymd) {
  if (!ymd) return null
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const today = () => new Date().toLocaleDateString('en-CA')

function Field({ label, children }) {
  return (
    <div className="ptl-detail-field">
      <dt className="ptl-detail-label">{label}</dt>
      <dd className="ptl-detail-value">{children ?? DASH}</dd>
    </div>
  )
}

/** A value the school may correct, with the student's own answer kept beside it. */
function CorrectableField({ field, value, display, correction, readOnly, onSave, inputType = 'text' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const label = CORRECTABLE[field].label
  const start = () => { setDraft(value == null ? '' : String(value)); setErr(null); setEditing(true) }
  const save = async () => {
    setBusy(true); setErr(null)
    const r = await onSave(field, draft)
    setBusy(false)
    if (r?.error) { setErr(CORRECTION_ERRORS[r.error] || 'That change could not be saved.'); return }
    if (r?.cancelled) return
    setEditing(false)
  }
  return (
    <div className="ptl-detail-field">
      <dt className="ptl-detail-label">{label}</dt>
      <dd className="ptl-detail-value">
        {editing ? (
          <span className="apr-edit">
            <input className="apr-input" type={inputType} value={draft} aria-label={label}
              inputMode={field === 'cumulative_gpa' ? 'decimal' : undefined}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }} />
            <button type="button" className="ptl-btn ptl-btn-small" onClick={save} disabled={busy}>{busy ? 'Saving' : 'Save'}</button>
            <button type="button" className="apr-link" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          </span>
        ) : (
          <span className="apr-value">
            <span>{display || DASH}</span>
            {!readOnly && <button type="button" className="apr-link" onClick={start}>Correct</button>}
          </span>
        )}
        {err && <span className="apr-error" role="alert">{err}</span>}
        {correction && (
          <span className="apr-note">
            Student answered: {correction.studentAnswer || 'nothing'}
            {correction.correctedBy ? ` · Corrected by ${correction.correctedBy}` : ''}
            {correction.correctedAt ? `, ${fmtDay(correction.correctedAt)}` : ''}
          </span>
        )}
      </dd>
    </div>
  )
}

function ProfileSection({ p, readOnly, onCorrect }) {
  const name = getStudentPreferredFullName(p)
  const av = p.availability
  const yesno = [av.weekends && `Weekends: ${av.weekends}`, av.nights && `Nights: ${av.nights}`].filter(Boolean).join(' · ')
  return (
    <section className="apr-section" aria-labelledby="apr-profile-h">
      <h3 id="apr-profile-h" className="ptl-detail-heading">Profile</h3>
      <p className="apr-lede">From {name ? `${name.split(' ')[0]}'s` : 'the student\'s'} ASPIRE intake form.</p>
      <dl className="ptl-detail-grid">
        <Field label="Cohort">{p.cohort?.name}</Field>
        <Field label="Assigned unit">{p.assigned_unit || 'Not yet assigned'}</Field>
        <CorrectableField field="school_email" value={p.contact.school_email} display={p.contact.school_email}
          correction={p.corrections.school_email} readOnly={readOnly || !p.correctionsEnabled} onSave={onCorrect} inputType="email" />
        <Field label="Personal email">{p.contact.personal_email && <a className="ptl-detail-link" href={`mailto:${p.contact.personal_email}`}>{p.contact.personal_email}</a>}</Field>
        <Field label="Phone">{p.contact.phone && <a className="ptl-detail-link" href={`tel:${p.contact.phone}`}>{p.contact.phone}</a>}</Field>
        <CorrectableField field="cumulative_gpa" value={p.academics.cumulative_gpa}
          display={p.academics.cumulative_gpa != null ? Number(p.academics.cumulative_gpa).toFixed(2) : null}
          correction={p.corrections.cumulative_gpa} readOnly={readOnly || !p.correctionsEnabled} onSave={onCorrect} />
        {p.graduationEnabled && (
          <CorrectableField field="expected_graduation" value={p.academics.expected_graduation}
            display={fmtDay(p.academics.expected_graduation)} correction={p.corrections.expected_graduation}
            readOnly={readOnly} onSave={onCorrect} inputType="date" />
        )}
      </dl>
      <dl className="apr-stack">
        <Field label="Prior healthcare experience">{p.academics.prior_healthcare_experience}</Field>
        <Field label="Unit preferences">{p.preferences.length ? <ol className="apr-list">{p.preferences.map(u => <li key={u}>{u}</li>)}</ol> : null}</Field>
        <Field label="Availability">
          {(av.shift || yesno || av.preferred_days.length || av.unavailable_weekdays.length || av.blackout_dates.length || av.notes) ? (
            <span className="apr-lines">
              {av.shift && <span>Shift: {av.shift}</span>}
              {yesno && <span>{yesno}</span>}
              {av.preferred_days.length > 0 && <span>Preferred days: {av.preferred_days.join(', ')}</span>}
              {av.unavailable_weekdays.length > 0 && <span>Unavailable: {av.unavailable_weekdays.join(', ')}{av.unavailable_reason ? ` (${av.unavailable_reason})` : ''}</span>}
              {av.blackout_dates.length > 0 && <span>Blackout dates: {av.blackout_dates.join(', ')}</span>}
              {av.notes && <span>{av.notes}</span>}
            </span>
          ) : null}
        </Field>
        <Field label="Interest statement">{p.interest_statement && <span className="apr-prose">{p.interest_statement}</span>}</Field>
      </dl>
    </section>
  )
}

const UPLOAD_ERRORS = {
  invalid_type: 'That file type is not accepted.', too_large: 'That file is over 10 MB.',
  same_file: 'That is the same file already on record.', date_required: 'Enter the date first.',
  date_unconfirmed: 'Confirm the date against the file.', preview_read_only: 'Staff previews are read-only.',
  not_enabled: 'Clearance documents are not set up yet.',
}

function ClearanceRow({ row, studentId, readOnly, onDone }) {
  const fileRef = useRef(null)
  const [date, setDate] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const expired = isExpired(row, today())
  const status = row.current ? (expired ? 'Expired' : 'On file') : (row.required ? 'Missing' : 'Not on file')
  const tone = row.current ? (expired ? 'warn' : 'ok') : (row.required ? 'bad' : 'mute')
  const pick = async (file) => {
    setErr(null)
    const problem = validatePick(row.key, file)
    if (problem) { setErr(problem); return }
    setBusy(true)
    const r = await uploadClearanceFile({ studentId, docType: row.key, file, docDate: row.needsDate ? date : null, dateConfirmed: row.needsDate ? confirmed : false })
    setBusy(false)
    if (!r.ok) { setErr(UPLOAD_ERRORS[r.error] || 'That file could not be uploaded.'); return }
    setDate(''); setConfirmed(false)
    onDone()
  }
  const open = async (versionId) => {
    const r = await postSchoolStudentRecord({ action: 'open', version_id: versionId })
    if (r.ok && r.data?.url) window.open(r.data.url, '_blank', 'noopener')
    else setErr('That file could not be opened.')
  }
  const ready = !row.needsDate || (date && confirmed)
  return (
    <li className="apr-clr-row">
      <div className="apr-clr-main">
        <span className="apr-clr-name">{row.label}{row.own && <span className="apr-own">Your school</span>}</span>
        {row.qualifier && <span className="apr-clr-qual">{row.qualifier}</span>}
        {row.current && (
          <span className="apr-clr-file">
            <button type="button" className="apr-link" onClick={() => open(row.current.id)}>{row.current.file_name}</button>
            {' · '}Uploaded {fmtDay(row.current.uploaded_at)}
            {row.current.doc_date ? ` · ${row.dateLabel === 'Expiration date' ? 'Expires' : 'Completed'} ${fmtDay(row.current.doc_date)}` : ''}
          </span>
        )}
      </div>
      <span className={`apr-pill apr-pill-${tone}`}>{status}</span>
      {!readOnly && (
        <div className="apr-clr-upload">
          {row.needsDate && (
            <>
              <label className="apr-date">
                <span>{row.dateLabel}</span>
                <input type="date" className="apr-input" value={date} onChange={e => setDate(e.target.value)} />
              </label>
              <label className="apr-check">
                <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                <span>I checked this date against the file</span>
              </label>
            </>
          )}
          <input ref={fileRef} type="file" hidden accept={acceptFor(row.key)} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f) }} />
          <button type="button" className="ptl-btn ptl-btn-small" disabled={busy || !ready} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading' : row.current ? 'Replace' : 'Upload'}
          </button>
        </div>
      )}
      {err && <span className="apr-error" role="alert">{err}</span>}
      {row.versions.length > 1 && (
        <details className="apr-history">
          <summary>{row.versions.length - 1} earlier {row.versions.length === 2 ? 'version' : 'versions'}</summary>
          <ul>
            {row.versions.filter(v => v.id !== row.current?.id).map(v => (
              <li key={v.id}><button type="button" className="apr-link" onClick={() => open(v.id)}>{v.file_name}</button> · {fmtDay(v.uploaded_at)}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

function ClearanceSection({ studentId, readOnly }) {
  const [state, setState] = useState({ status: 'loading', rows: [], enabled: true, forId: null })
  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => setReloadKey(k => k + 1), [])
  useEffect(() => {
    let live = true
    getSchoolStudentRecord('clearance', studentId).then(r => {
      if (!live) return
      if (!r.ok) setState({ status: 'error', rows: [], enabled: true, forId: studentId })
      else setState({ status: 'ready', rows: r.data.rows || [], enabled: r.data.enabled !== false, forId: studentId })
    })
    return () => { live = false }
  }, [studentId, reloadKey])
  const sum = clearanceSummary(state.rows)
  return (
    <section className="apr-section" aria-labelledby="apr-clr-h">
      <h3 id="apr-clr-h" className="ptl-detail-heading">Clearance Documents</h3>
      {state.forId !== studentId || state.status === 'loading' ? <LoadingState label="Loading clearance documents" />
        : state.status === 'error' ? <ErrorState detail="The clearance documents could not be loaded just now." />
        : !state.enabled ? <p className="ptl-muted">Clearance documents are not set up yet.</p>
        : (
          <>
            <p className="apr-lede">
              {sum.required ? `${sum.onFile} of ${sum.required} required on file.` : 'No required documents.'}
              {' '}Files you upload are filed on the student's record for the ASPIRE team.
            </p>
            <ul className="apr-clr">
              {state.rows.map(row => <ClearanceRow key={row.key} row={row} studentId={studentId} readOnly={readOnly} onDone={load} />)}
            </ul>
          </>
        )}
    </section>
  )
}

export default function SchoolStudentDrawer({ student, onClose, returnFocusRef, extraSections = null }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const studentId = student?.id
  const [state, setState] = useState({ forId: null, status: 'loading', profile: null, readOnly: true })

  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => setReloadKey(k => k + 1), [])
  useEffect(() => {
    if (!studentId) return undefined
    let live = true
    getSchoolStudentRecord('profile', studentId).then(r => {
      if (!live) return
      if (!r.ok) setState({ forId: studentId, status: r.status === 404 ? 'denied' : 'error', profile: null, readOnly: true })
      else setState({ forId: studentId, status: 'ready', profile: r.data.profile, readOnly: r.data.readOnly === true })
    })
    return () => { live = false }
  }, [studentId, reloadKey])

  useEffect(() => {
    const prev = returnFocusRef?.current || null
    const t = setTimeout(() => closeRef.current?.focus?.(), 20)
    return () => { clearTimeout(t); if (prev?.focus) prev.focus() }
  }, [returnFocusRef])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const els = Array.from(panelRef.current.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null)
      if (!els.length) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const p = state.forId === studentId ? state.profile : null
  const onCorrect = useCallback(async (field, value) => {
    let applyToCohort = false
    if (CORRECTABLE[field].cohortWide && p?.cohort && (p.cohortSize || 0) > 1) {
      const first = getStudentPreferredFullName(p).split(' ')[0] || 'this student'
      applyToCohort = await confirmDialog(
        `Change expected graduation for everyone in ${p.cohort.name}? ${p.cohortSize} students from your school are in this cohort. Only this student changes ${first}'s date alone.`,
        { confirmLabel: 'Change for everyone', cancelLabel: 'Only this student' },
      )
    }
    const r = await postSchoolStudentRecord({ action: 'correct', student_id: studentId, field, value, apply_to_cohort: applyToCohort })
    if (!r.ok) return { error: r.error }
    load()
    return { ok: true }
  }, [p, studentId, load])

  if (!student) return null
  const name = getStudentPreferredFullName(p || student)
  const status = state.forId !== studentId ? 'loading' : state.status

  return (
    <>
      <div className="ptl-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} className="ptl-drawer ptl-detail-drawer apr-drawer" role="dialog" aria-modal="true" aria-label={`Record for ${name}`}>
        <button ref={closeRef} type="button" className="ptl-icon-btn ptl-detail-close" aria-label="Close student record" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="ptl-detail-hero">
          <h2 className="ptl-detail-heroname">{name}</h2>
          {p?.cohort?.name && <p className="ptl-detail-heroschool">{p.cohort.name}</p>}
        </div>
        <div className="ptl-drawer-body">
          {status === 'loading' && <LoadingState label="Loading student record" />}
          {status === 'denied' && <ErrorState detail="This student is not on your roster." />}
          {status === 'error' && <ErrorState detail="This record could not be loaded just now." />}
          {status === 'ready' && p && (
            <>
              {state.readOnly && <p className="apr-preview">Staff preview: read-only.</p>}
              <ProfileSection p={p} readOnly={state.readOnly} onCorrect={onCorrect} />
              <ClearanceSection studentId={studentId} readOnly={state.readOnly} />
              {extraSections ? extraSections({ studentId, readOnly: state.readOnly, profile: p }) : null}
            </>
          )}
        </div>
      </aside>
    </>
  )
}

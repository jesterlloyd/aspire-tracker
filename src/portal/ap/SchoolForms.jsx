// src/portal/ap/SchoolForms.jsx
//
// AP-SCHOOL-FORMS-1 (Owner, 2026-11-08): Academic Partner Portal > Forms. A school builds its own
// forms and sends each of its students a personal link; every submission is filed as a PDF on the
// student's record. The builder, the tracker, Answers and Summary are the staff Catalog's own
// screens (src/components/forms/), pointed at /api/portal/school-forms through FormsApiContext, so
// a school's form is the same object as ASPIRE's, built and read the same way. Only the list and
// the send dialog are drawn here. An Owner/Admin preview sees every school's forms and changes none.
//
// Routes (PortalApp): /portal/ap/forms, /portal/ap/forms/:id/edit, /portal/ap/forms/:id/responses
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FormsApiContext } from '../../components/forms/formsApi'
import FormBuilder from '../../components/forms/FormBuilder'
import FormResponses from '../../components/forms/FormResponses'
import PageBar from '../../components/shared/PageBar'
import { LoadingState, EmptyState, ErrorState } from '../unit/UnitLeaderChrome'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { schoolForms } from './schoolFormsApi'
import { REMINDER_RULES } from '../../lib/forms/formModel'
import '../../components/forms/forms.css'
import './apForms.css'

const UUID = /^[0-9a-f-]{36}$/i
const short = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

function useToast() {
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), toast.kind === 'err' ? 7000 : 4500)
    return () => clearTimeout(t)
  }, [toast])
  const notify = useCallback((text, kind = 'ok') => setToast({ text, kind, at: Date.now() }), [])
  const node = toast ? <div className={`apf-toast${toast.kind === 'err' ? ' apf-toast-err' : ''}`} role={toast.kind === 'err' ? 'alert' : 'status'}>{toast.text}</div> : null
  return [notify, node]
}

export default function SchoolForms({ formId = null, mode = 'list', onOpen, onList }) {
  const [status, setStatus] = useState(null)
  const [statusError, setStatusError] = useState(null)
  const [notify, toastNode] = useToast()
  const [sending, setSending] = useState(false)
  const [sentKey, setSentKey] = useState(0)

  useEffect(() => {
    let live = true
    schoolForms('status').then(r => { if (live) setStatus(r) }).catch(e => { if (live) setStatusError(e.message) })
    return () => { live = false }
  }, [])

  const readOnly = Boolean(status?.readOnly)
  const api = useMemo(() => ({ call: schoolForms, school: true, readOnly, crumbs: { root: 'Forms', list: null } }), [readOnly])

  if (statusError) return <ErrorState title="Forms could not load" detail={statusError} />
  if (!status) return <LoadingState label="Loading your forms" />
  if (!status.enabled) {
    return <EmptyState title="Forms" detail="Your school will build and send its own forms here. This section is being prepared and is not active yet." />
  }

  if (formId && UUID.test(formId) && (mode === 'edit' || mode === 'responses')) {
    return (
      <FormsApiContext.Provider value={api}>
        <div className="ap-forms">
          {mode === 'responses'
            ? <FormResponses formId={formId} notify={notify} onBack={onList} onEdit={() => onOpen(formId, 'edit')}
                onSend={readOnly ? undefined : () => setSending(true)} reloadKey={sentKey} />
            : <FormBuilder formId={formId} notify={notify} onBack={onList} onResponses={() => onOpen(formId, 'responses')} />}
          {sending && <SendDialog formId={formId} notify={notify} onClose={() => setSending(false)} onSent={() => { setSending(false); setSentKey(k => k + 1) }} />}
          {toastNode}
        </div>
      </FormsApiContext.Provider>
    )
  }
  return <FormsList status={status} onOpen={onOpen} notify={notify} toastNode={toastNode} />
}

function FormsList({ status, onOpen, notify, toastNode }) {
  const [forms, setForms] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const readOnly = Boolean(status.readOnly)
  const schools = status.schools || []
  const manySchools = readOnly || schools.length > 1

  useEffect(() => {
    let live = true
    schoolForms('list').then(r => { if (live) { setForms(r.forms || []); setError(null) } }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [reloadKey])
  const reload = useCallback(() => setReloadKey(k => k + 1), [])
  useRegisterPortalRefresh(reload)

  return (
    <div className="ap-forms">
      <PageBar name="Forms"
        meta={readOnly ? "Every school's own forms, read-only. Only the school can change or send one." : 'Build a form, send each of your students a personal link, and every answer is filed to their record.'}
        actions={!readOnly ? <button type="button" className="fm-btn fm-pri" onClick={() => setCreating(true)}>New form</button> : null} />
      {error ? <ErrorState title="Forms could not load" detail={error} />
        : !forms ? <LoadingState label="Loading your forms" />
        : !forms.length ? (
          <div className="ptl-card apf-empty">
            <p className="apf-empty-title">No forms yet</p>
            <p className="ptl-muted">{readOnly ? 'No school has built a form yet.' : 'A form you build here goes only to your own students. Start with New form.'}</p>
          </div>
        ) : (
          <div className="fm-card fm-tablewrap">
            <table className="fm-table apf-table">
              <thead><tr>
                <th scope="col" className="aspire-th">Form</th>
                {manySchools && <th scope="col" className="aspire-th">School</th>}
                <th scope="col" className="aspire-th">Status</th>
                <th scope="col" className="aspire-th">Responses</th>
                <th scope="col" className="aspire-th">Updated</th>
                <th scope="col" className="aspire-th"><span className="fm-sr">Actions</span></th>
              </tr></thead>
              <tbody>
                {forms.map(f => (
                  <tr key={f.id}>
                    <td><button type="button" className="apf-open" onClick={() => onOpen(f.id, f.version > 0 ? 'responses' : 'edit')}>{f.title}</button></td>
                    {manySchools && <td>{f.schoolKey}</td>}
                    <td><span className={`fm-st ${f.status === 'published' ? 'fm-st-submitted' : 'fm-st-sent'}`}>{f.status === 'published' ? `Published, version ${f.version}` : 'Draft'}</span>
                      {f.unpublishedChanges && <small>Edits not yet published</small>}</td>
                    <td>{f.total ? `${f.submitted} of ${f.total} submitted` : 'Not sent yet'}</td>
                    <td>{short(f.updatedAt)}</td>
                    <td className="apf-acts">
                      <button type="button" className="fm-btn fm-sm" onClick={() => onOpen(f.id, 'edit')}>{readOnly ? 'View' : 'Edit'}</button>
                      {f.version > 0 && <button type="button" className="fm-btn fm-sm" onClick={() => onOpen(f.id, 'responses')}>Responses</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {creating && <NewFormDialog schools={schools} notify={notify} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id, 'edit') }} />}
      {toastNode}
    </div>
  )
}

function NewFormDialog({ schools, notify, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [school, setSchool] = useState(schools[0] || '')
  const [busy, setBusy] = useState(false)
  const create = async (e) => {
    e.preventDefault()
    if (!title.trim() || !school) return
    setBusy(true)
    try { const r = await schoolForms('create', { title: title.trim(), school_key: school }); onCreated(r.form.id) }
    catch (err) { notify(err.message, 'err'); setBusy(false) }
  }
  return (
    <div className="fm-scrim" onMouseDown={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <form className="fm-modal apf-dialog" role="dialog" aria-modal="true" aria-labelledby="apf-new-title" onMouseDown={e => e.stopPropagation()} onSubmit={create}>
        <h2 id="apf-new-title" className="apf-dialog-title">New Form</h2>
        <label className="apf-field"><span>Name</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} autoFocus placeholder="Clinical Clearance Attestation" /></label>
        {schools.length > 1 && (
          <label className="apf-field"><span>School</span>
            <select value={school} onChange={e => setSchool(e.target.value)}>{schools.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        )}
        <p className="fm-hint">The form starts as a draft. Add questions, publish it, then send it to your students.</p>
        <div className="apf-dialog-acts">
          <button type="button" className="fm-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="fm-btn fm-pri" disabled={busy || !title.trim() || !school}>{busy ? 'Creating…' : 'Create form'}</button>
        </div>
      </form>
    </div>
  )
}

function SendDialog({ formId, notify, onClose, onSent }) {
  const [form, setForm] = useState(null)
  const [students, setStudents] = useState(null)
  const [error, setError] = useState(null)
  const [picked, setPicked] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [due, setDue] = useState('')
  const [reminders, setReminders] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    schoolForms('get', { id: formId })
      .then(r => { if (!live) return; setForm(r.form); return schoolForms('students', { school_key: r.form.owner_school_key }) })
      .then(r => { if (live && r) setStudents(r.students || []) })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [formId])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (students || []).filter(s => !q || s.name.toLowerCase().includes(q))
  }, [students, query])
  const pickable = shown.filter(s => s.hasEmail)
  const allPicked = pickable.length > 0 && pickable.every(s => picked.has(s.id))
  const toggle = (id, on) => setPicked(p => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n })
  const toggleAll = (on) => setPicked(p => { const n = new Set(p); for (const s of pickable) { if (on) n.add(s.id); else n.delete(s.id) } return n })

  const send = async () => {
    setBusy(true)
    try {
      const r = await schoolForms('send', { send: {
        formId, studentIds: [...picked], dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : null,
        reminderRule: reminders || undefined, message: message.trim(),
      } })
      const skipped = (r.skipped || []).length
      notify(`Sent to ${r.sent} ${r.sent === 1 ? 'student' : 'students'}.${r.failed?.length ? ` ${r.failed.length} email${r.failed.length === 1 ? ' was' : 's were'} not accepted.` : ''}${skipped ? ` ${skipped} skipped.` : ''}`, r.failed?.length ? 'err' : 'ok')
      onSent()
    } catch (e) { notify(e.message, 'err'); setBusy(false) }
  }

  return (
    <div className="fm-scrim" onMouseDown={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="fm-modal apf-dialog apf-send" role="dialog" aria-modal="true" aria-labelledby="apf-send-title" onMouseDown={e => e.stopPropagation()}>
        <h2 id="apf-send-title" className="apf-dialog-title">Send {form?.draft?.title || 'Form'}</h2>
        {error ? <p className="fm-err" role="alert">{error}</p> : !students ? <p className="fm-hint">Loading your students…</p> : (
          <>
            <p className="fm-hint">Each student gets their own link by email, at their school address when one is on file. A student who already has an open link gets a new one.</p>
            <div className="apf-send-bar">
              <input type="search" className="apf-search" placeholder="Search students" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search students" />
              <label className="apf-all"><input type="checkbox" checked={allPicked} disabled={!pickable.length} onChange={e => toggleAll(e.target.checked)} /> Select all shown</label>
            </div>
            <ul className="apf-people" aria-label="Students">
              {!shown.length && <li className="fm-hint">No students match.</li>}
              {shown.map(s => (
                <li key={s.id}>
                  <label className={s.hasEmail ? '' : 'apf-disabled'}>
                    <input type="checkbox" disabled={!s.hasEmail} checked={picked.has(s.id)} onChange={e => toggle(s.id, e.target.checked)} />
                    <span>{s.name}</span>
                    <small>{!s.hasEmail ? 'No email on file' : s.status || ''}</small>
                  </label>
                </li>
              ))}
            </ul>
            <div className="apf-send-opts">
              <label className="apf-field"><span>Due (optional)</span><input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
              <label className="apf-field"><span>Reminders</span>
                <select value={reminders} onChange={e => setReminders(e.target.value)}>
                  <option value="">The form's setting</option>
                  {REMINDER_RULES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select></label>
            </div>
            <label className="apf-field"><span>Message (optional)</span>
              <textarea rows={3} maxLength={2000} value={message} onChange={e => setMessage(e.target.value)} placeholder="A sentence that tells your students why this matters and when it is due." /></label>
          </>
        )}
        <div className="apf-dialog-acts">
          <button type="button" className="fm-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="fm-btn fm-pri" onClick={send} disabled={busy || !picked.size}>
            {busy ? 'Sending…' : `Send to ${picked.size || ''} ${picked.size === 1 ? 'student' : 'students'}`.replace('  ', ' ')}</button>
        </div>
      </div>
    </div>
  )
}

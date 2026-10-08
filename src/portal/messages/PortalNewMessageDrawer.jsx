// ASPIRE MESSAGES, PHASE 5B-i: the student's New message drawer.
//
// DORMANT: mounted only by PortalMessagesWorkspace.
//
// Follows the existing portal drawer pattern (EditProfileDrawer): ptl-drawer
// markup, focus trapped while open, Escape closes, focus returns to the trigger.
//
// MESSAGE-DRAFTS-1 (Owner, 2026-10-03): the subject, category and message are
// saved in this browser under the signed-in person's own id until sent or
// discarded, so closing the drawer loses nothing (useMessageDraft).
//
// There is NO recipient picker. The start endpoint accepts only subject,
// category, and body; the server resolves the student from the verified JWT and
// the ASPIRE Team is the implicit recipient.
//
// TA-MESSAGES-1 (Owner, 2026-10-07): when the host passes `privateKinds`, the drawer gains a To
// choice. "ASPIRE Team" is the shared team inbox, exactly as before; a private kind (a unit
// leader, an alumnus, Talent Acquisition) picks ONE person from the server's list and starts a
// private conversation only the two of them see. The server re-resolves the person through the
// same rule that built the list. A non-student portal's ASPIRE Team message goes through the
// general team-thread endpoint (its first line is the subject), the one its role is admitted to.

import { useEffect, useRef, useState } from 'react'
import { useMessageDraft } from '../../lib/messages/useMessageDraft'
import { X } from 'lucide-react'
import {
  startPortalConversation, startGeneralTeamConversation, listPrivateRecipients, startPrivateConversation,
} from '../../lib/messages/portalMessagesApiClient'
import {
  MESSAGE_MAX_BODY_CHARS, SUBJECT_MAX_CHARS,
  normalizeBody, validateSubjectValue, validateBodyValue,
} from '../../lib/messages/messagesConstants'
import {
  PORTAL_CATEGORY_OPTIONS, PORTAL_RECIPIENT_LABEL, PORTAL_SAFETY_NOTICE,
  PORTAL_SEND_CONFIRMATION, mapPortalMessagesError, mapPortalConflict,
  PRIVATE_TO_LABELS, PRIVATE_TO_HELP, privateNotice,
} from '../../lib/messages/portalMessagesConstants'

const newRequestId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16)
  }))

// The category select needs string values; null (Uncategorized) is carried as ''
// and converted back at submission, so the browser never invents a sentinel the
// server would reject.
const toCategory = (v) => (v === '' ? null : v)

const NEW_DRAFT_TEXT = ['subject', 'body']
// One object for the module: the person search effect depends on `api`, and a default rebuilt on
// every render restarted (and cancelled) that search on every render.
const DEFAULT_API = { startPortalConversation, startGeneralTeamConversation, listPrivateRecipients, startPrivateConversation }

export default function PortalNewMessageDrawer({
  open, onClose, onSent, announce, returnFocusRef,
  variant = 'student', privateKinds = [],
  api = DEFAULT_API,
}) {
  const [to, setTo] = useState('team')
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState({ kind: null, rows: [], loading: false, error: null })
  const [person, setPerson] = useState(null)
  const isPrivate = to !== 'team'
  // The list for the chosen kind, re-asked as the search changes (debounced).
  useEffect(() => {
    if (!isPrivate) return undefined
    let live = true
    const t = setTimeout(() => {
      setPeople((p) => ({ ...p, kind: to, loading: true, error: null }))
      Promise.resolve(api.listPrivateRecipients({ kind: to, query }))
        .then((out) => { if (live) setPeople({ kind: to, rows: out?.recipients || [], loading: false, error: null }) })
        .catch((e) => { if (live) setPeople({ kind: to, rows: [], loading: false, error: e?.status === 409 ? 'Private messages are being prepared and are not active yet.' : mapPortalMessagesError(e?.status) }) })
    }, query ? 250 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [isPrivate, to, query, api])
  const panelRef = useRef(null)
  // Synchronous submit mutex. React state does not update until the next render,
  // so a `pending` state check alone lets repeated activations inside one tick
  // each fire a request. A ref flips immediately, so one activation is one
  // request even under a fast double click or a held Enter key.
  const submittingRef = useRef(false)
  const { draft, update, discard, saved } = useMessageDraft('new', { subject: '', category: '', body: '' }, NEW_DRAFT_TEXT)
  const subject = draft.subject || ''
  const category = draft.category || ''
  const body = draft.body || ''
  const setSubject = (value) => update({ subject: value })
  const setCategory = (value) => update({ category: value })
  const setBody = (value) => update({ body: value })
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState(null)
  const [touched, setTouched] = useState(false)

  // No open/close reset effect: the workspace mounts this drawer only while it
  // is open, so every open starts from fresh state. That keeps the form
  // preserved across a failed submit (the drawer stays mounted) without a
  // cascading setState in an effect.
  useEffect(() => {
    if (!open) return undefined
    const prev = returnFocusRef?.current || null
    const t = setTimeout(() => panelRef.current?.querySelector('[data-drawer-initial]')?.focus?.(), 20)
    const onKey = (e) => {
      if (e.key === 'Escape' && !pending) { onClose?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const els = Array.from(panelRef.current.querySelectorAll('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.disabled && el.offsetParent !== null)
      if (!els.length) return
      const first = els[0]; const last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      if (prev?.focus) prev.focus()
    }
  }, [open, pending, onClose, returnFocusRef])

  if (!open) return null

  const subjectCheck = validateSubjectValue(subject)
  const bodyCheck = validateBodyValue(body)
  const normalized = normalizeBody(body)
  const disabled = pending || !subjectCheck.ok || !bodyCheck.ok || (isPrivate && !person)

  async function submit(e) {
    e?.preventDefault?.()
    setTouched(true)
    // One user action produces one request. The ref is checked and set
    // synchronously, so repeats within the same tick cannot slip through.
    if (submittingRef.current || pending) return
    if (!subjectCheck.ok || !bodyCheck.ok) return
    if (isPrivate && !person) return

    submittingRef.current = true
    setPending(true)
    setErr(null)
    try {
      const out = isPrivate
        ? await api.startPrivateConversation({ toKind: to, toProfileId: person.profile_id, subject: subject.trim(), body: normalized })
        : variant === 'student'
          ? await api.startPortalConversation({ subject: subject.trim(), category: toCategory(category), body: normalized })
          // Every other portal's ASPIRE Team thread: the server takes the subject from the first line.
          : await api.startGeneralTeamConversation({ requestId: newRequestId(), body: `${subject.trim()}\n\n${normalized}` })
      // Clear only after authoritative success.
      discard(); setTouched(false)
      // The server returns the confirmation copy; the constant is only a
      // fallback, so the announcement never contradicts the server.
      announce?.(out?.confirmation || (isPrivate ? `Your private message was sent to ${person?.name || 'them'}.` : PORTAL_SEND_CONFIRMATION))
      onSent?.(out)
      onClose?.()
    } catch (e2) {
      // The form is preserved on every failure so nothing typed is lost.
      setErr(e2?.status === 409
        ? mapPortalConflict(e2?.reason)
        : mapPortalMessagesError(e2?.status))
    } finally {
      submittingRef.current = false
      setPending(false)
    }
  }

  return (
    <div className="ptl-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) onClose?.() }}>
      <div
        ref={panelRef}
        className="ptl-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ptl-newmsg-title"
      >
        <div className="ptl-drawer-head">
          <h2 className="ptl-drawer-title" id="ptl-newmsg-title">New message</h2>
          <button type="button" className="ptl-icon-btn" onClick={onClose} disabled={pending} aria-label="Close new message">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form className="ptl-drawer-body ptl-form" onSubmit={submit}>
          {privateKinds.length === 0 ? (
            <div className="ptl-form-row">
              <span className="ptl-field-label">To</span>
              <div className="ptl-readonly-block">{PORTAL_RECIPIENT_LABEL}</div>
            </div>
          ) : (
            <fieldset className="ptl-form-row ptl-msg-to">
              <legend className="ptl-field-label">To</legend>
              {['team', ...privateKinds].map((k) => (
                <label key={k} className={`ptl-msg-to-choice${to === k ? ' ptl-msg-to-choice-on' : ''}`}>
                  <input type="radio" name="ptl-newmsg-to" value={k} checked={to === k}
                    onChange={() => { setTo(k); setPerson(null); setQuery('') }} />
                  <span><b>{PRIVATE_TO_LABELS[k]}</b><small>{PRIVATE_TO_HELP[k]}</small></span>
                </label>
              ))}
            </fieldset>
          )}

          {isPrivate && (
            <div className="ptl-form-row">
              <label className="ptl-label" htmlFor="ptl-newmsg-person">{PRIVATE_TO_LABELS[to].replace(/^(A|An) /, '').replace(/^./, (c) => c.toUpperCase())}</label>
              <input id="ptl-newmsg-person" className="ptl-input ptl-input-full" value={query}
                placeholder="Search by name" onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
              <div className="ptl-msg-people" role="listbox" aria-label="People you can message">
                {people.loading && <div className="ptl-small">Loading…</div>}
                {!people.loading && people.error && <div className="ptl-form-error">{people.error}</div>}
                {!people.loading && !people.error && people.rows.length === 0 && <div className="ptl-small">No one matches. Only people with an active portal account can receive Messages.</div>}
                {!people.loading && people.rows.map((r) => (
                  <button key={r.profile_id} type="button" role="option" aria-selected={person?.profile_id === r.profile_id}
                    className={`ptl-msg-person${person?.profile_id === r.profile_id ? ' ptl-msg-person-on' : ''}`}
                    onClick={() => setPerson(r)}>
                    <b>{r.name}</b><small>{r.detail}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="ptl-form-row">
            <label className="ptl-label" htmlFor="ptl-newmsg-subject">Subject</label>
            <input
              id="ptl-newmsg-subject"
              data-drawer-initial
              className="ptl-input ptl-input-full"
              value={subject}
              maxLength={SUBJECT_MAX_CHARS}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && !subjectCheck.ok ? 'true' : undefined}
              aria-describedby="ptl-newmsg-subject-help"
            />
            <div className="ptl-small" id="ptl-newmsg-subject-help">
              {touched && !subjectCheck.ok
                ? <span className="ptl-form-error">{subjectCheck.error}</span>
                : `${subject.trim().length} of ${SUBJECT_MAX_CHARS} characters`}
            </div>
          </div>

          {variant === 'student' && !isPrivate && <div className="ptl-form-row">
            <label className="ptl-label" htmlFor="ptl-newmsg-category">Category (optional)</label>
            <select
              id="ptl-newmsg-category"
              className="ptl-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {PORTAL_CATEGORY_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>{o.label}</option>
              ))}
            </select>
          </div>}

          <div className="ptl-form-row">
            <label className="ptl-label" htmlFor="ptl-newmsg-body">Message</label>
            <textarea
              id="ptl-newmsg-body"
              className="ptl-input ptl-input-full ptl-msg-textarea"
              rows={5}
              value={body}
              maxLength={MESSAGE_MAX_BODY_CHARS}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && !bodyCheck.ok ? 'true' : undefined}
              aria-describedby="ptl-newmsg-body-help"
            />
            <div className="ptl-small" id="ptl-newmsg-body-help">
              {touched && !bodyCheck.ok
                ? <span className="ptl-form-error">{bodyCheck.error}</span>
                : `${normalized.length} of ${MESSAGE_MAX_BODY_CHARS} characters`}
            </div>
          </div>

          {isPrivate
            ? <p className="ptl-compose-note ptl-msg-private-note">{privateNotice(person?.name)}</p>
            : <p className="ptl-compose-note ptl-msg-safety">{PORTAL_SAFETY_NOTICE}</p>}

          {err && <p className="ptl-form-error" role="alert">{err}</p>}

          {saved && !pending && (
            <p className="ptl-small ptl-msg-draft-note">
              Draft saved
              <button type="button" className="ptl-msg-draft-discard" onClick={() => { discard(); setTouched(false); setErr(null) }}>
                Discard draft
              </button>
            </p>
          )}

          <div className="ptl-form-actions ptl-drawer-foot">
            <button type="button" className="ptl-btn-outline" onClick={onClose} disabled={pending}>Close</button>
            <button type="submit" className="ptl-btn ptl-msg-btn" disabled={disabled}>
              {pending ? 'Sending...' : 'Send message'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

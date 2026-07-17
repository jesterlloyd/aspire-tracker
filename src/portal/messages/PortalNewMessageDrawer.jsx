// ASPIRE MESSAGES, PHASE 5B-i: the student's New message drawer.
//
// DORMANT: mounted only by PortalMessagesWorkspace.
//
// Follows the existing portal drawer pattern (EditProfileDrawer): ptl-drawer
// markup, focus trapped while open, Escape closes, focus returns to the trigger.
//
// There is NO recipient picker. The start endpoint accepts only subject,
// category, and body; the server resolves the student from the verified JWT and
// the ASPIRE Team is the implicit recipient.

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { startPortalConversation } from '../../lib/messages/portalMessagesApiClient'
import {
  MESSAGE_MAX_BODY_CHARS, SUBJECT_MAX_CHARS,
  normalizeBody, validateSubjectValue, validateBodyValue,
} from '../../lib/messages/messagesConstants'
import {
  PORTAL_CATEGORY_OPTIONS, PORTAL_RECIPIENT_LABEL, PORTAL_SAFETY_NOTICE,
  PORTAL_SEND_CONFIRMATION, mapPortalMessagesError, mapPortalConflict,
} from '../../lib/messages/portalMessagesConstants'

// The category select needs string values; null (Uncategorized) is carried as ''
// and converted back at submission, so the browser never invents a sentinel the
// server would reject.
const toCategory = (v) => (v === '' ? null : v)

export default function PortalNewMessageDrawer({
  open, onClose, onSent, announce, returnFocusRef,
  api = { startPortalConversation },
}) {
  const panelRef = useRef(null)
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('')
  const [body, setBody] = useState('')
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
  const disabled = pending || !subjectCheck.ok || !bodyCheck.ok

  async function submit(e) {
    e?.preventDefault?.()
    setTouched(true)
    // One user action produces one request: a pending submit is ignored outright
    // rather than merely disabled, which also covers repeated Enter and
    // double-click.
    if (pending) return
    if (!subjectCheck.ok || !bodyCheck.ok) return

    setPending(true)
    setErr(null)
    try {
      const out = await api.startPortalConversation({
        subject: subject.trim(),
        category: toCategory(category),
        body: normalized,
      })
      // Clear only after authoritative success.
      setSubject(''); setCategory(''); setBody(''); setTouched(false)
      // The server returns the confirmation copy; the constant is only a
      // fallback, so the announcement never contradicts the server.
      announce?.(out?.confirmation || PORTAL_SEND_CONFIRMATION)
      onSent?.(out)
      onClose?.()
    } catch (e2) {
      // The form is preserved on every failure so nothing typed is lost.
      setErr(e2?.status === 409
        ? mapPortalConflict(e2?.code)
        : mapPortalMessagesError(e2?.status))
    } finally {
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
          <div className="ptl-form-row">
            <span className="ptl-field-label">To</span>
            <div className="ptl-readonly-block">{PORTAL_RECIPIENT_LABEL}</div>
          </div>

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

          <div className="ptl-form-row">
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
          </div>

          <div className="ptl-form-row">
            <label className="ptl-label" htmlFor="ptl-newmsg-body">Message</label>
            <textarea
              id="ptl-newmsg-body"
              className="ptl-input ptl-input-full ptl-msg-textarea"
              rows={7}
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

          <p className="ptl-compose-note ptl-msg-safety">{PORTAL_SAFETY_NOTICE}</p>

          {err && <p className="ptl-form-error" role="alert">{err}</p>}

          <div className="ptl-form-actions ptl-drawer-foot">
            <button type="button" className="ptl-btn-outline" onClick={onClose} disabled={pending}>Cancel</button>
            <button type="submit" className="ptl-btn-primary" disabled={disabled}>
              {pending ? 'Sending...' : 'Send message'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

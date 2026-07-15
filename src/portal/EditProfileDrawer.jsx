// ASPIRE-STUDENT-PORTAL: student self-service profile drawer. Edits ONLY the
// non-authoritative presentation/communication fields (preferred display name,
// phone) through the authenticated /api/portal/update-profile endpoint, which
// enforces the same allowlist server-side. Authoritative details (school,
// cohort, status, placement) are shown read-only with a "Request a correction"
// mailto to the ASPIRE team. Focus is trapped while open and returns on close.
import { useEffect, useRef, useState } from 'react'
import { X, Copy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { composePortalEmail } from '../lib/outlookCompose'

const SUPPORT = 'aspire@cshs.org'
const CORRECTION_SUBJECT = 'ASPIRE Student Profile Correction Request'

// Approved, non-sensitive correction request body (no internal identifiers).
function buildCorrectionBody({ fullName, field, currentValue }) {
  return `Hello ASPIRE Team,\n\nI would like to request a correction to my student profile.\n\nName: ${fullName || 'not available'}\nField: ${field || ''}\nCurrent information: ${currentValue || ''}\n\nRequested correction:\n\n\nThank you.`
}

export default function EditProfileDrawer({ open, student, loginEmail = '', onClose, onSaved, returnFocusRef }) {
  const panelRef = useRef(null)
  const [preferred, setPreferred] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [compose, setCompose] = useState(null) // { kind, loginEmail?, body? }

  const requestCorrection = () => {
    const fullName = [student?.preferred_first_name || student?.first_name, student?.last_name].filter(Boolean).join(' ')
    const body = buildCorrectionBody({ fullName, field: '', currentValue: '' })
    const res = composePortalEmail({ to: SUPPORT, subject: CORRECTION_SUBJECT, body, loginEmail })
    if (!res.opened) setCompose({ kind: 'blocked', body })
    else if (res.mode === 'outlook') setCompose({ kind: 'outlook', loginEmail: res.loginEmail })
    else setCompose({ kind: 'sent' })
  }
  const copy = (text) => { try { navigator.clipboard?.writeText(text) } catch { /* clipboard unavailable */ } }

  useEffect(() => {
    if (open) {
      setPreferred(student?.preferred_first_name || '')
      setPhone(student?.phone || '')
      setMsg(null)
    }
  }, [open, student])

  useEffect(() => {
    if (!open) return
    const prev = returnFocusRef?.current || null
    const t = setTimeout(() => panelRef.current?.querySelector('[data-drawer-initial]')?.focus?.(), 20)
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) { onClose?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const els = Array.from(panelRef.current.querySelectorAll('button, input, textarea, a[href], [tabindex]:not([tabindex="-1"])')).filter(el => !el.disabled && el.offsetParent !== null)
      if (!els.length) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); if (prev?.focus) prev.focus() }
  }, [open, busy, onClose, returnFocusRef])

  if (!open) return null

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/portal/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ student_id: student?.id, preferred_first_name: preferred.trim(), phone: phone.trim() }),
      })
      if (res.ok) { setMsg({ ok: true, text: 'Your profile was updated.' }); onSaved?.({ preferred_first_name: preferred.trim(), phone: phone.trim() }); setTimeout(() => onClose?.(), 700) }
      else if (res.status === 401 || res.status === 403) setMsg({ ok: false, text: 'Please sign in again to update your profile.' })
      else setMsg({ ok: false, text: 'We could not save your changes. Please try again.' })
    } catch { setMsg({ ok: false, text: 'We could not save your changes. Please try again.' }) }
    setBusy(false)
  }

  return (
    <>
      <div className="ptl-drawer-backdrop" onClick={() => !busy && onClose?.()} />
      <div ref={panelRef} className="ptl-drawer" role="dialog" aria-modal="true" aria-label="Edit your profile">
        <div className="ptl-drawer-head">
          <h2 className="ptl-drawer-title">Edit your profile</h2>
          <button type="button" data-drawer-initial className="ptl-icon-btn" aria-label="Close" onClick={() => !busy && onClose?.()}><X size={18} /></button>
        </div>
        <div className="ptl-drawer-body">
          <label className="ptl-field-label" htmlFor="ep-pref">Preferred display name</label>
          <input id="ep-pref" className="ptl-input ptl-input-full" value={preferred} onChange={e => setPreferred(e.target.value)} placeholder="What should we call you?" />
          <label className="ptl-field-label" htmlFor="ep-phone" style={{ marginTop: 14 }}>Phone (optional)</label>
          <input id="ep-phone" className="ptl-input ptl-input-full" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 555-5555" inputMode="tel" />

          <div className="ptl-readonly-block">
            <div className="ptl-readonly-title">Managed by ASPIRE</div>
            <dl className="ptl-dl">
              <div><dt>School</dt><dd>{student?.school || 'To be confirmed'}</dd></div>
              <div><dt>Cohort</dt><dd>{student?.cohort?.name || 'To be confirmed'}</dd></div>
              <div><dt>Status</dt><dd>{student?.status || 'To be confirmed'}</dd></div>
              <div><dt>Placement</dt><dd>{student?.unit_name || 'To be confirmed'}</dd></div>
            </dl>
            <p className="ptl-muted ptl-small">
              These are managed by the ASPIRE team. <button type="button" className="ptl-inline-link ptl-inline-btn" onClick={requestCorrection} aria-label="Request a correction (opens an email compose in a new tab)">Request a correction</button>.
            </p>
          </div>

          {compose && (compose.kind === 'blocked' ? (
            <div className="ptl-compose-note ptl-compose-blocked" role="alert">
              <div>Your browser blocked the email window. Allow pop-ups or copy {SUPPORT}.</div>
              <div className="ptl-compose-actions">
                <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={() => copy(SUPPORT)}><Copy size={13} /> Copy email address</button>
                <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={() => copy(compose.body)}><Copy size={13} /> Copy message</button>
              </div>
            </div>
          ) : (
            <div className="ptl-compose-note" role="status">
              {compose.kind === 'outlook'
                ? (compose.loginEmail
                    ? `Compose opened in Outlook. Confirm you are sending from ${compose.loginEmail}.`
                    : 'Compose opened in Outlook. Confirm you are using the intended email account.')
                : 'Email compose opened in a new tab. Confirm you are using the intended email account.'}
            </div>
          ))}

          {msg && <div className={msg.ok ? 'ptl-form-ok' : 'ptl-form-error'} role="status">{msg.text}</div>}
        </div>
        <div className="ptl-drawer-foot">
          <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={() => !busy && onClose?.()}>Cancel</button>
          <button type="button" className="ptl-btn ptl-btn-sm" onClick={save} disabled={busy} style={{ marginTop: 0 }}>{busy ? 'Saving...' : 'Save changes'}</button>
        </div>
      </div>
    </>
  )
}

// STAFF-INVITE-CONTACTS-1: contact-aware "Invite Staff User", structurally
// aligned with Grant Portal Access.
//
// WHAT CHANGED AND WHY
//   - The Staff member field is now the SHARED saved-Contacts typeahead
//     (./ContactSuggest.jsx -> src/lib/contactSearch.js), the same authorized
//     contacts path Outreach and Grant Portal Access use. Selecting a contact
//     fills the name and, when the contact has one, the login email, and shows
//     a compact linked-record treatment naming where the values came from.
//   - Typing an EMAIL first resolves the same way: an exact normalized-email
//     match to exactly ONE active contact auto-fills the name; two or more
//     matches surface the ambiguity instead of guessing.
//   - Field order mirrors the portal modal: Access role, Staff member, Login
//     email. Role is renamed "Access role" to sit beside "Portal role".
//   - A two-step Review flow replaces the direct send, matching the portal
//     modal's form -> review -> confirm rhythm.
//
// WHAT IS DELIBERATELY NOT HERE
//   Access start / Expiration date controls. Staff authorization is
//   user_profiles.role + is_active + login_enabled: booleans with NO time
//   dimension, and user_role_grants (which owns starts_at/expires_at) is
//   CHECK-constrained to portal roles only. Date controls here would collect
//   values nothing reads or enforces, which on an authorization surface reads
//   as "this access expires" when it never would. See the handoff for the
//   product decision this needs.
//
// UNCHANGED: the /api/invite-user contract ({ email, full_name, role }), role
// gating and options, and the caller's onInvited() refresh.
import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Mail, Loader, ChevronLeft, ShieldCheck, Contact as ContactIcon, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ROLE_OPTIONS, OWNER_NOT_ASSIGNABLE_NOTE } from './accountsShared'
import ContactSuggest from './ContactSuggest'
import { searchContacts } from '../../lib/contactSearch'
import { normalizeEmailForLookup } from '../../lib/emailUtils'

const F = 'Plus Jakarta Sans, sans-serif'
const field = { width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: F, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
const label = { display: 'block', fontFamily: F, fontWeight: 600, fontSize: 12, color: '#374151', marginBottom: 6 }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isValidEmail = (e) => EMAIL_RE.test(String(e || '').trim())
const contactName = (c) => c?.full_name || c?.preferred_name || c?.email || ''
const roleLabel = (v) => ROLE_OPTIONS.find(r => r.value === v)?.label || v

export default function InviteUserModal({ onClose, onInvited }) {
  const [step, setStep] = useState('form') // form | review
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('interviewer')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [selectedContact, setSelectedContact] = useState(null)
  // Which fields the selected contact supplied, so the linked-record treatment
  // can say so without implying the contact record itself was changed.
  const [fromContact, setFromContact] = useState({ name: false, email: false })
  const [emailAmbiguous, setEmailAmbiguous] = useState(null) // [contacts] when >1 match
  const firstFieldRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30)
    const onKey = (e) => { if (e.key === 'Escape' && !loading) onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey) }
  }, [onClose, loading])

  // Explicit contact selection from the typeahead. Never overwrites a login
  // email the Owner already typed; the contact record is never written here.
  const applyContactSelection = useCallback((c) => {
    if (!c) return
    setResult(null); setEmailAmbiguous(null)
    setSelectedContact(c)
    setFullName(contactName(c))
    const tookEmail = !!c.email && !email.trim()
    if (tookEmail) setEmail(c.email)
    setFromContact({ name: true, email: tookEmail })
  }, [email])

  // Email-first resolution: an exact normalized-email match to EXACTLY ONE
  // active contact fills the name. Two or more surfaces ambiguity rather than
  // guessing; zero leaves manual entry untouched.
  const resolveByEmail = useCallback(async (raw) => {
    const norm = normalizeEmailForLookup(raw)
    if (!norm || !isValidEmail(norm) || selectedContact || fullName.trim()) return
    const rows = await searchContacts(norm, { limit: 5 })
    const exact = (rows || []).filter(c => normalizeEmailForLookup(c.email) === norm)
    if (exact.length === 1) {
      setSelectedContact(exact[0])
      setFullName(contactName(exact[0]))
      setFromContact({ name: true, email: false })
      setEmailAmbiguous(null)
    } else if (exact.length > 1) {
      setEmailAmbiguous(exact)
    }
  }, [selectedContact, fullName])

  const clearContactLink = () => {
    setSelectedContact(null)
    setFromContact({ name: false, email: false })
  }

  const emailValid = isValidEmail(email)
  const formValid = !!fullName.trim() && emailValid && !!role && !loading

  const submit = async () => {
    if (!formValid || loading) return
    setLoading(true); setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      // Contract preserved exactly: { email, full_name, role }.
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ email: email.trim(), full_name: fullName.trim(), role }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setResult({ success: true, message: json.message || `Invitation sent to ${email.trim()}` })
        onInvited?.()
        setTimeout(() => onClose?.(), 1100)
      } else if (res.status === 409) {
        setResult({ success: false, message: json.message || 'An account already exists for that email.' })
      } else {
        setResult({ success: false, message: json.message || json.error || 'Invitation failed.' })
      }
    } catch (err) {
      setResult({ success: false, message: err.message })
    }
    setLoading(false)
  }

  return (
    <div onClick={() => !loading && onClose?.()} role="dialog" aria-modal="true" aria-label="Invite Staff User"
      style={{ position: 'fixed', inset: 0, zIndex: 2300, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(500px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #f3f4f6' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1D2567' }}>Invite Staff User</h2>
          <button type="button" onClick={() => !loading && onClose?.()} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4, display: 'flex' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '18px 20px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#eef2fb', border: '1px solid #dbe3fb', borderRadius: 8, padding: '9px 12px', marginBottom: 16 }}>
            <ShieldCheck size={16} style={{ color: '#1D2567', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: '#3a4a7a', lineHeight: 1.5 }}>
              This grants <strong>staff application access</strong>, not scoped portal access. The staff user can access the areas allowed by the selected role.
            </div>
          </div>

          {step === 'form' && (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={label} htmlFor="invite-role">Access role</label>
                <select id="invite-role" ref={firstFieldRef} value={role} onChange={e => { setRole(e.target.value); setResult(null) }}
                  style={{ ...field, cursor: 'pointer' }}>
                  {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}, {r.description}</option>)}
                </select>
                {/* ROLE-GUIDE-1: the selected role's audited consequence, plus
                    the reason Owner is not in the list. A grant should never be
                    made from the label alone. */}
                <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 5, lineHeight: 1.5 }}>
                  {ROLE_OPTIONS.find(r => r.value === role)?.description}
                  <div style={{ marginTop: 3 }}>{OWNER_NOT_ASSIGNABLE_NOTE}</div>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={label} htmlFor="invite-name">Staff member</label>
                {selectedContact ? (
                  <div style={{ border: '1px solid #c7d2fe', background: '#eef2fb', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: '#1D2567', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ContactIcon size={14} /></div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#1D2567' }}>{contactName(selectedContact)}</div>
                          <div style={{ fontSize: 11.5, color: '#4b5563' }}>
                            From saved contact{fromContact.email ? ' · name and email' : ' · name'}
                          </div>
                        </div>
                      </div>
                      <button type="button" onClick={clearContactLink}
                        style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', color: '#6b7280', padding: '4px 8px', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Clear</button>
                    </div>
                    <input value={fullName} onChange={e => setFullName(e.target.value)} aria-label="Staff member name for the invitation"
                      placeholder="Full name" style={{ ...field, marginTop: 8 }} />
                  </div>
                ) : (
                  <ContactSuggest id="invite-name" value={fullName} onChange={v => { setFullName(v); setResult(null) }} onPick={applyContactSelection}
                    placeholder="Search contacts by name or email" ariaLabel="Staff member, searches saved contacts" />
                )}
              </div>

              <div style={{ marginBottom: 6 }}>
                <label style={label} htmlFor="invite-email">Login email</label>
                <input id="invite-email" type="email" value={email}
                  onChange={e => { setEmail(e.target.value); setResult(null); setEmailAmbiguous(null) }}
                  onBlur={e => resolveByEmail(e.target.value)}
                  placeholder="name@example.com" style={field} aria-label="Login email" />
                {emailAmbiguous && (
                  <div role="alert" style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 7, background: '#FBF5E8', border: '1px solid #f0c9b0', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: '#8B5E1A', lineHeight: 1.5 }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>More than one saved contact uses that email. Select the intended person from the Staff member field so the right record is linked.</span>
                  </div>
                )}
              </div>
              <p style={{ margin: '0 0 14px', fontSize: 11.5, color: '#6b7280', lineHeight: 1.5 }}>
                The login email is the staff sign-in identity. It may be populated from the selected contact. Changing it does not change the linked contact unless explicitly saved through ASPIRE Connect.
              </p>
            </>
          )}

          {step === 'review' && (
            <div>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#1D2567' }}>Review staff access</h3>
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 9, fontSize: 13 }}>
                <dt style={{ color: '#6b7280' }}>Staff member</dt><dd style={{ margin: 0, color: '#191919' }}>{fullName}{selectedContact ? ' · from saved contact' : ''}</dd>
                <dt style={{ color: '#6b7280' }}>Login email</dt><dd style={{ margin: 0, color: '#191919' }}>{email}</dd>
                <dt style={{ color: '#6b7280' }}>Access role</dt><dd style={{ margin: 0, color: '#191919' }}>{roleLabel(role)}</dd>
              </dl>
            </div>
          )}

          {result && (
            <div role="status" style={{ marginTop: 14, padding: '8px 12px', borderRadius: 8, fontSize: 12, background: result.success ? '#f0fdf4' : '#fff1f2', border: `1px solid ${result.success ? '#86efac' : '#fca5a5'}`, color: result.success ? '#166534' : '#991b1b' }}>
              {result.message}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '12px 20px', borderTop: '1px solid #f3f4f6' }}>
          <button type="button" onClick={() => step === 'review' ? setStep('form') : onClose?.()} disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontFamily: F, fontSize: 13, cursor: loading ? 'default' : 'pointer' }}>
            {step === 'review' && <ChevronLeft size={14} />}{step === 'review' ? 'Back' : 'Cancel'}
          </button>
          {step === 'form' ? (
            <button type="button" onClick={() => setStep('review')} disabled={!formValid}
              style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: formValid ? '#1D2567' : '#e5e7eb', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: formValid ? 'pointer' : 'default' }}>Review</button>
          ) : (
            <button type="button" onClick={submit} disabled={loading || !formValid}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', border: 'none', borderRadius: 8, background: (loading || !formValid) ? '#e5e7eb' : '#1D2567', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: (loading || !formValid) ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              {loading ? <Loader size={13} /> : <Mail size={13} />} {loading ? 'Sending…' : 'Send invitation'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

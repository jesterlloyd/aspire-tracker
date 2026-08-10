// ACTIVATION-PASSWORD-SCREEN-1: first-time account activation for portal invitations.
//
// THE DEFECT THIS FIXES. Invitations previously redirected to /portal. Supabase
// established a session from the invite token, so the invitee landed inside the
// portal and everything looked fine, but NO PASSWORD WAS EVER SET. The login screen
// asks for email and password, so the first sign-out locked the account out of an
// account it appeared to already have. Access and credentials are not the same
// thing, and the old flow granted the first without ever creating the second.
//
// The invite link now lands HERE. A password is created before any portal is
// reachable, and the session is only carried onward after that succeeds.
//
// Mirrors ResetPasswordPage deliberately: same shell, same Supabase mechanics,
// same robust marker detection. The two screens differ in intent (create versus
// change) and in what happens afterward, not in how they talk to auth.
//
// MARKER DETECTION is the same three-way belt and braces as recovery, because the
// SIGNED_IN / PASSWORD_RECOVERY event can fire before this component subscribes:
//   1. read the initial URL hash/search synchronously on first render
//   2. subscribe to onAuthStateChange while mounted
//   3. fall back to getSession()
// Invite links carry type=invite; a reissued activation for an existing auth user
// carries type=recovery. Both mean "create your password", so both are accepted.
// No token or URL fragment is ever rendered.
//
// COMPLETION MARKER: on success we stamp user_metadata.password_set. That is what
// lets a later reissue tell "never finished setup" from "has a working password"
// without guessing, since Supabase does not expose whether a password exists.
//
// PORTAL-ACTIVATION-RELIABILITY-1: invitation emails now carry an ASPIRE-owned
// URL (?token_hash=...&type=invite|recovery) instead of the raw Supabase verify
// link. Loading this page does NOT consume the token: verification happens ONLY
// when the recipient clicks "Activate my account" (supabase.auth.verifyOtp), so
// email-security scanners that prefetch links can no longer burn the single-use
// token before the human arrives. The legacy fragment flow (a session or error
// delivered in the URL hash) is still accepted for links already in flight and
// for Supabase-templated recovery emails. The invalid state offers self-service
// recovery so routine expiry never needs staff SQL or a support email.
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { appUrl } from '../lib/appUrl'

// Token types the ASPIRE hash URL may carry. Anything else is not ours.
const TOKEN_TYPES = new Set(['invite', 'recovery'])

// Privacy-safe diagnostics: fire-and-forget, session-authenticated, and silent
// on every failure. Carries an event name and broad category only - never a
// token, hash, or link.
async function postActivationEvent(eventType, category) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return
    await fetch('/api/portal-activation-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ event_type: eventType, category: category || null }),
    })
  } catch { /* diagnostics never affect activation */ }
}

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'
const MIN_LEN = 8

const card = {
  width: '100%', maxWidth: '400px', background: '#ffffff',
  borderRadius: '20px', overflow: 'hidden',
  boxShadow: '0 8px 40px rgba(29,37,103,0.16)',
}
const inputStyle = {
  width: '100%', padding: '11px 14px',
  border: '1px solid #e5e7eb', borderRadius: '10px',
  fontSize: '14px', color: '#374151', outline: 'none',
  boxSizing: 'border-box', fontFamily: F,
}
const primaryBtn = (disabled) => ({
  width: '100%', padding: '13px',
  background: disabled ? '#e5e7eb' : NAVY,
  border: 'none', borderRadius: '10px',
  fontWeight: 700, fontSize: '14px', color: '#ffffff',
  cursor: disabled ? 'default' : 'pointer', marginTop: '4px', fontFamily: F,
})

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#F4F1EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: F }}>
      <div style={card}>
        <div style={{ background: 'linear-gradient(180deg, #1c2452 0%, #141928 100%)', padding: '28px 32px 24px', textAlign: 'center' }}>
          <img src="/cs-logo-rev.png" alt="Cedars-Sinai" style={{ height: '28px', width: 'auto', marginBottom: '14px' }} />
          <div style={{ fontWeight: 700, fontSize: '20px', color: '#ffffff', marginBottom: '4px' }}>ASPIRE Intelligence</div>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Geri and Richard Brawerman Nursing Institute</div>
        </div>
        <div style={{ padding: '32px' }}>{children}</div>
      </div>
    </div>
  )
}

export default function ActivateAccountPage() {
  const navigate = useNavigate()

  // Scanner-safe ASPIRE link: ?token_hash=...&type=... in the query string. Its
  // presence renders the explicit confirmation step; nothing is verified yet.
  const initialTokenLink = useMemo(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    const tokenHash = params.get('token_hash')
    const type = params.get('type')
    return (tokenHash && TOKEN_TYPES.has(type)) ? { tokenHash, type } : null
  }, [])

  // LEGACY fragment flow: an activation link is type=invite; a reissued one is
  // type=recovery. Read both synchronously, before detectSessionInUrl consumes
  // and clears the hash. (token_hash links are handled above and never match
  // here because their type param is read from the query with the hash intact.)
  const initialHasActivation = useMemo(() => {
    if (typeof window === 'undefined') return false
    if (initialTokenLink) return false
    const h = window.location.hash || ''
    const q = window.location.search || ''
    return /type=(invite|recovery|signup)/.test(h) || /type=(invite|recovery|signup)/.test(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A malformed or already-consumed link comes back as an error in the fragment
  // rather than a session. Captured up front so it is not mistaken for "no link".
  const initialLinkError = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /error=|error_code=|error_description=/.test(window.location.hash || window.location.search || '')
  }, [])

  // 'checking' | 'confirm' | 'form' | 'invalid' | 'success'
  const [status, setStatus] = useState(
    initialLinkError ? 'invalid' : (initialTokenLink ? 'confirm' : (initialHasActivation ? 'form' : 'checking')))
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [activating, setActivating] = useState(false)
  // Self-service recovery on the invalid state.
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoverySent, setRecoverySent] = useState(false)

  useEffect(() => {
    if (initialLinkError || initialTokenLink) return undefined
    let mounted = true
    // Never downgrade out of a resolved terminal/form state.
    const promote = (next) => setStatus(cur => (cur === 'success' || cur === 'form') ? cur : next)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return
      if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY' || event === 'USER_UPDATED') promote('form')
    })

    if (!initialHasActivation) {
      supabase.auth.getSession().then(({ data }) => {
        if (!mounted) return
        // A session here means the invite link was consumed and Supabase signed
        // them in. That is precisely the state that needs a password, so it is a
        // form, not a neutral "already signed in". Without a session there is
        // nothing to activate.
        promote(data?.session ? 'form' : 'invalid')
      }).catch(() => { if (mounted) promote('invalid') })
    }

    return () => { mounted = false; subscription?.unsubscribe() }
  }, [initialHasActivation, initialLinkError, initialTokenLink])

  // The ONE place the token is consumed: the recipient's explicit click. A
  // scanner GET renders the confirm screen and consumes nothing.
  const handleActivate = async () => {
    if (!initialTokenLink) return
    setActivating(true)
    try {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: initialTokenLink.tokenHash,
        type: initialTokenLink.type,
      })
      if (error) { setStatus('invalid'); return }
      setStatus('form')
    } catch {
      setStatus('invalid')
    } finally {
      setActivating(false)
    }
  }

  // Non-enumerating self-service: both requests answer identically whether or
  // not an account exists for the address. "New link" lands back on this
  // activation screen; "set or reset" lands on the standard reset screen.
  const requestRecovery = async (destinationPath) => {
    const addr = recoveryEmail.trim()
    if (!addr) return
    setRecoveryBusy(true)
    try {
      await supabase.auth.resetPasswordForEmail(addr, { redirectTo: appUrl(destinationPath) })
    } catch { /* identical confirmation either way; nothing to reveal */ }
    setRecoveryBusy(false)
    setRecoverySent(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    if (newPassword.length < MIN_LEN) { setFormError(`Password must be at least ${MIN_LEN} characters.`); return }
    if (newPassword !== confirmPassword) { setFormError('Passwords do not match.'); return }

    setSaving(true)
    try {
      // The supported password-update method, plus the completion marker in the
      // same call so the two can never disagree.
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        data: { password_set: true, password_set_at: new Date().toISOString() },
      })
      if (error) {
        postActivationEvent('activation_failed', 'password_update_failed')
        setFormError('Could not create your password. This activation link may have expired or already been used. Please ask the ASPIRE team to resend your invitation.')
        return
      }
      postActivationEvent('activation_succeeded')
      setStatus('success')
    } catch {
      setFormError('Could not create your password. This activation link may have expired or already been used. Please ask the ASPIRE team to resend your invitation.')
    } finally {
      setSaving(false)
    }
  }

  if (status === 'checking') {
    return <Shell><div style={{ textAlign: 'center', fontSize: '13px', color: '#9ca3af', padding: '8px 0' }}>Checking your activation link…</div></Shell>
  }

  if (status === 'confirm') {
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>👋</div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: NAVY, marginBottom: '8px' }}>Activate your account</div>
          <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.6, marginBottom: '20px' }}>
            Welcome to ASPIRE. Click below to verify your invitation and create your
            password. Activation links are time-limited and can be used once.
          </div>
          <button onClick={handleActivate} disabled={activating} style={primaryBtn(activating)}>
            {activating ? 'Verifying…' : 'Activate my account'}
          </button>
        </div>
      </Shell>
    )
  }

  if (status === 'success') {
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: NAVY, marginBottom: '8px' }}>Your account is ready</div>
          <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.6 }}>
            Your password has been created. You can sign in with your email and this
            password from now on.
          </div>
          {/* Only now is the portal reachable. The session established by the
              activation link is carried through, so there is no second sign-in. */}
          <button onClick={() => navigate('/portal', { replace: true })} style={{ ...primaryBtn(false), marginTop: '20px' }}>
            Continue to my portal
          </button>
        </div>
      </Shell>
    )
  }

  if (status === 'invalid') {
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔒</div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: NAVY, marginBottom: '8px' }}>
            This activation link is no longer available.
          </div>
          {/* Deliberately says nothing about whether an account exists for any
              address. The recovery path below is the same for everyone. */}
          <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.6, marginBottom: '18px' }}>
            Activation links are valid for 1 hour and can be used once. When a new
            link is issued, earlier activation links stop working. Request a new link
            below, set or reset your password, or return to sign in. Need help? Contact the
            ASPIRE team at <a href="mailto:aspire@cshs.org" style={{ color: NAVY }}>aspire@cshs.org</a>.
          </div>

          {recoverySent ? (
            <div style={{ background: '#eef6ee', border: '1px solid #bcd9bf', borderRadius: '10px', padding: '12px 14px', fontSize: '13px', color: '#2f6b34', lineHeight: 1.6, marginBottom: '16px', textAlign: 'left' }} role="status">
              If an account exists for that address, a new email is on its way.
              Always use the most recent email; earlier activation links stop working.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              <input
                type="email" value={recoveryEmail} onChange={e => setRecoveryEmail(e.target.value)}
                placeholder="you@school.edu" aria-label="Email address" style={inputStyle}
                onFocus={e => e.target.style.borderColor = NAVY} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
              <button onClick={() => requestRecovery('/auth/activate')} disabled={recoveryBusy || !recoveryEmail.trim()} style={primaryBtn(recoveryBusy || !recoveryEmail.trim())}>
                {recoveryBusy ? 'Sending…' : 'Email me a new link'}
              </button>
              <button onClick={() => requestRecovery('/auth/reset-password')} disabled={recoveryBusy || !recoveryEmail.trim()}
                style={{ width: '100%', padding: '12px', background: 'none', border: `1px solid ${NAVY}`, borderRadius: '10px', fontWeight: 700, fontSize: '13px', color: NAVY, cursor: (recoveryBusy || !recoveryEmail.trim()) ? 'default' : 'pointer', fontFamily: F, opacity: (recoveryBusy || !recoveryEmail.trim()) ? 0.5 : 1 }}>
                Set or reset password
              </button>
            </div>
          )}

          <button onClick={() => navigate('/login', { replace: true })}
            style={{ background: 'none', border: 'none', fontSize: '13px', fontWeight: 600, color: NAVY, cursor: 'pointer', textDecoration: 'underline', fontFamily: F, padding: 0 }}>
            Go to sign in
          </button>
        </div>
      </Shell>
    )
  }

  // status === 'form'
  return (
    <Shell>
      <div style={{ fontWeight: 700, fontSize: '15px', color: NAVY, marginBottom: '8px' }}>Create your password</div>
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '20px', lineHeight: 1.6 }}>
        Welcome to ASPIRE. Choose a password to finish setting up your account. You
        will use your email and this password to sign in from now on.
      </div>

      {formError && (
        <div style={{ background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#991b1b', marginBottom: '16px' }} role="alert">
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label style={{ fontWeight: 600, fontSize: '12px', color: '#374151', display: 'block', marginBottom: '6px' }}>Password</label>
          <input type={showPw ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)}
            required placeholder="At least 8 characters" style={inputStyle} autoComplete="new-password"
            onFocus={e => e.target.style.borderColor = NAVY} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
        </div>
        <div>
          <label style={{ fontWeight: 600, fontSize: '12px', color: '#374151', display: 'block', marginBottom: '6px' }}>Confirm password</label>
          <input type={showPw ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            required placeholder="Re-enter your password" style={inputStyle} autoComplete="new-password"
            onFocus={e => e.target.style.borderColor = NAVY} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#6b7280', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={showPw} onChange={e => setShowPw(e.target.checked)} style={{ cursor: 'pointer' }} />
          Show password
        </label>

        <button type="submit" disabled={saving} style={primaryBtn(saving)}>
          {saving ? 'Creating…' : 'Create password and continue'}
        </button>
      </form>
    </Shell>
  )
}

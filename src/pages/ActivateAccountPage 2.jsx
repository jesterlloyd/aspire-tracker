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
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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

  // An activation link is type=invite; a reissued one is type=recovery. Read both
  // synchronously, before detectSessionInUrl consumes and clears the hash.
  const initialHasActivation = useMemo(() => {
    if (typeof window === 'undefined') return false
    const h = window.location.hash || ''
    const q = window.location.search || ''
    return /type=(invite|recovery|signup)/.test(h) || /type=(invite|recovery|signup)/.test(q)
  }, [])

  // A malformed or already-consumed link comes back as an error in the fragment
  // rather than a session. Captured up front so it is not mistaken for "no link".
  const initialLinkError = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /error=|error_code=|error_description=/.test(window.location.hash || window.location.search || '')
  }, [])

  // 'checking' | 'form' | 'invalid' | 'success'
  const [status, setStatus] = useState(
    initialLinkError ? 'invalid' : (initialHasActivation ? 'form' : 'checking'))
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (initialLinkError) return undefined
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
  }, [initialHasActivation, initialLinkError])

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
        setFormError('Could not create your password. This activation link may have expired or already been used. Please ask the ASPIRE team to resend your invitation.')
        return
      }
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
            This activation link is invalid or has expired.
          </div>
          {/* Deliberately says nothing about whether an account exists for any
              address. The recovery path below is the same for everyone. */}
          <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.6, marginBottom: '20px' }}>
            Activation links are time-limited and can be used once. You can request a
            new link from the sign-in page using Forgot password, or contact the
            ASPIRE team at <a href="mailto:aspire@cshs.org" style={{ color: NAVY }}>aspire@cshs.org</a>.
          </div>
          <button onClick={() => navigate('/login', { replace: true })} style={primaryBtn(false)}>Go to sign in</button>
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

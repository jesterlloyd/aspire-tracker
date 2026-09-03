// RECOVERY-PASSWORD-SCREEN-1: public, shell-free landing screen for Supabase password-recovery
// links. Self-service reset (Login.jsx → resetPasswordForEmail) redirects here (/auth/reset-password).
// Mounted as a top-level route ABOVE the /* wildcard, so it renders independently of AuthedShell even
// once detectSessionInUrl has established a recovery session.
//
// Recovery detection is deliberately robust (the PASSWORD_RECOVERY event can fire before this
// component subscribes): we (1) capture the initial URL hash/search for a `type=recovery` marker
// synchronously on first render, (2) subscribe to onAuthStateChange for PASSWORD_RECOVERY while
// mounted, and (3) fall back to getSession(). A plain session WITHOUT a recovery marker is treated as
// a normal signed-in user (neutral state) - never the password form. No tokens/URL fragments are
// ever rendered.
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const F = 'Plus Jakarta Sans, sans-serif'
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
const linkBtn = {
  background: 'none', border: 'none', fontSize: '13px',
  color: NAVY, cursor: 'pointer', fontWeight: 600, fontFamily: F,
}

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

export default function ResetPasswordPage() {
  const navigate = useNavigate()

  // Capture the recovery marker from the initial URL synchronously (before detectSessionInUrl can
  // consume/clear the hash). Recovery links look like #access_token=…&type=recovery&….
  const initialHasRecovery = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /type=recovery/.test(window.location.hash || '') || /type=recovery/.test(window.location.search || '')
  }, [])

  // 'checking' | 'form' | 'authed' | 'invalid' | 'success'
  const [status, setStatus] = useState(initialHasRecovery ? 'form' : 'checking')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    let mounted = true
    // Never downgrade out of a resolved terminal/form state.
    const promote = (next) => setStatus(cur => (cur === 'success' || cur === 'form') ? cur : next)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return
      if (event === 'PASSWORD_RECOVERY') promote('form')
    })

    if (!initialHasRecovery) {
      supabase.auth.getSession().then(({ data }) => {
        if (!mounted) return
        // A session WITHOUT a recovery marker = a normal signed-in user, not a recovery.
        promote(data?.session ? 'authed' : 'invalid')
      }).catch(() => { if (mounted) promote('invalid') })
    }

    return () => { mounted = false; subscription?.unsubscribe() }
  }, [initialHasRecovery])

  // Auto-return to sign-in shortly after a successful update.
  useEffect(() => {
    if (status !== 'success') return
    const t = setTimeout(() => navigate('/', { replace: true }), 4000)
    return () => clearTimeout(t)
  }, [status, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    if (newPassword.length < MIN_LEN) { setFormError(`Password must be at least ${MIN_LEN} characters.`); return }
    if (newPassword !== confirmPassword) { setFormError('Passwords do not match.'); return }

    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        setFormError('Could not update your password. The link may have expired. Please request a new reset link.')
        return
      }
      setStatus('success')
      await supabase.auth.signOut() // do not leave a lingering recovery session
    } catch {
      setFormError('Could not update your password. The link may have expired. Please request a new reset link.')
    } finally {
      setSaving(false)
    }
  }

  if (status === 'checking') {
    return <Shell><div style={{ textAlign: 'center', fontSize: '13px', color: '#9ca3af', padding: '8px 0' }}>Checking your reset link…</div></Shell>
  }

  if (status === 'success') {
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: NAVY, marginBottom: '8px' }}>Password updated</div>
          <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.6 }}>
            Your password has been changed. Please sign in with your new password.
          </div>
          <button onClick={() => navigate('/', { replace: true })} style={{ ...primaryBtn(false), marginTop: '20px' }}>
            Return to sign in
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
            This password reset link is invalid or has expired.
          </div>
          <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.6, marginBottom: '20px' }}>
            You can request a new password reset from the sign-in page.
          </div>
          <button onClick={() => navigate('/', { replace: true })} style={primaryBtn(false)}>Return to sign in</button>
        </div>
      </Shell>
    )
  }

  if (status === 'authed') {
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <div style={{ fontWeight: 700, fontSize: '15px', color: NAVY, marginBottom: '8px' }}>You’re already signed in</div>
          <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.6, marginBottom: '20px' }}>
            There’s no password reset in progress. You can return to ASPIRE, or sign out to reset your password from the sign-in page.
          </div>
          <button onClick={() => navigate('/', { replace: true })} style={primaryBtn(false)}>Return to ASPIRE</button>
          <div style={{ marginTop: '16px' }}>
            <button onClick={async () => { await supabase.auth.signOut(); navigate('/', { replace: true }) }} style={{ ...linkBtn, color: '#6b7280', fontWeight: 500, fontSize: '12px' }}>
              Sign out
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // status === 'form'
  return (
    <Shell>
      <div style={{ fontWeight: 700, fontSize: '15px', color: NAVY, marginBottom: '8px' }}>Set a new password</div>
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '20px', lineHeight: 1.6 }}>
        Choose a new password for your ASPIRE Intelligence account.
      </div>

      {formError && (
        <div style={{ background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#991b1b', marginBottom: '16px' }}>
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label style={{ fontWeight: 600, fontSize: '12px', color: '#374151', display: 'block', marginBottom: '6px' }}>New password</label>
          <input type={showPw ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)}
            required placeholder="At least 8 characters" style={inputStyle} autoComplete="new-password"
            onFocus={e => e.target.style.borderColor = NAVY} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
        </div>
        <div>
          <label style={{ fontWeight: 600, fontSize: '12px', color: '#374151', display: 'block', marginBottom: '6px' }}>Confirm password</label>
          <input type={showPw ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            required placeholder="Re-enter your new password" style={inputStyle} autoComplete="new-password"
            onFocus={e => e.target.style.borderColor = NAVY} onBlur={e => e.target.style.borderColor = '#e5e7eb'} />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#6b7280', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={showPw} onChange={e => setShowPw(e.target.checked)} style={{ cursor: 'pointer' }} />
          Show password
        </label>

        <button type="submit" disabled={saving} style={primaryBtn(saving)}>
          {saving ? 'Updating…' : 'Update password'}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: '16px' }}>
        <button onClick={() => navigate('/', { replace: true })} style={{ ...linkBtn, color: '#6b7280', fontWeight: 500, fontSize: '12px' }}>
          ← Back to sign in
        </button>
      </div>
    </Shell>
  )
}

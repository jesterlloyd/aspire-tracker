// src/components/KeychainUsername.jsx
//
// SIGNIN-AUTOFILL-1 (Owner, 2026-11-05): a student typed a long Cedars-Sinai email on
// every sign-in. A password manager (iPhone Passwords, iCloud Keychain, Google) saves a
// new password against the username field in the SAME form, and the set-password forms
// had none, so the saved password had no email beside it and Face ID could not fill
// both. This puts the account's email in the form as a username the reader never sees.
// It is read-only, out of the tab order and hidden from assistive technology; the
// visible sign-in form marks its own email field autoComplete="username".
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const HIDDEN = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0, opacity: 0,
}

export default function KeychainUsername({ active = true }) {
  const [email, setEmail] = useState('')
  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    supabase.auth.getSession()
      .then(({ data }) => { if (!cancelled) setEmail(data?.session?.user?.email || '') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [active])
  if (!email) return null
  return (
    <input type="email" name="username" autoComplete="username" value={email} readOnly
      tabIndex={-1} aria-hidden="true" style={HIDDEN} />
  )
}

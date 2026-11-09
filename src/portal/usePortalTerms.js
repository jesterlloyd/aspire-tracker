// src/portal/usePortalTerms.js
//
// PORTAL-TERMS-1: has this portal user accepted the current Terms of Use and Confidentiality
// Agreement within the year? The answer comes from their own rows in portal_terms_acceptances
// (RLS: a person reads only their own), and acceptance is written by accept_portal_terms, which
// records the CALLER only.
//
// status:
//   'idle'      not asked (disabled: staff preview, no portal role yet)
//   'checking'  reading the record
//   'needed'    show the agreement
//   'accepted'  current version accepted within REACCEPT_DAYS
//   'off'       the Owner-gated migration is not applied; the gate stays out of the way
//
// A failed read that is NOT "not provisioned" shows the agreement: asking again is harmless,
// skipping it is not.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PORTAL_TERMS_VERSION, needsAcceptance, termsNotProvisioned, termsRoles } from '../lib/portalTerms'

export function usePortalTerms({ enabled, profileId, roles }) {
  // The answer is kept with the profile it was read for, so a different profile (or the first
  // render after access resolves) reads as 'checking' without a synchronous setState.
  const [result, setResult] = useState({ key: null, status: null })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const rolesKey = termsRoles(roles).join(',')
  const active = Boolean(enabled && profileId)
  const status = !active ? 'idle' : result.key === profileId ? result.status : 'checking'

  useEffect(() => {
    if (!active) return undefined
    let live = true
    const settle = (s) => { if (live) setResult({ key: profileId, status: s }) }
    ;(async () => {
      try {
        const { data, error: readError } = await supabase
          .from('portal_terms_acceptances')
          .select('terms_version, accepted_at')
          .eq('profile_id', profileId)
          .order('accepted_at', { ascending: false })
          .limit(1)
        if (readError) { settle(termsNotProvisioned(readError) ? 'off' : 'needed'); return }
        settle(needsAcceptance(data?.[0] || null) ? 'needed' : 'accepted')
      } catch {
        settle('needed')
      }
    })()
    return () => { live = false }
  }, [active, profileId])

  const accept = useCallback(async () => {
    setSaving(true)
    setError('')
    try {
      const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 400) : ''
      const { error: rpcError } = await supabase.rpc('accept_portal_terms', {
        p_version: PORTAL_TERMS_VERSION,
        p_roles: rolesKey ? rolesKey.split(',') : [],
        p_user_agent: ua,
      })
      if (rpcError) {
        if (termsNotProvisioned(rpcError)) { setResult({ key: profileId, status: 'off' }); return }
        setError('We could not save your agreement. Check your connection and try again.')
        return
      }
      setResult({ key: profileId, status: 'accepted' })
    } catch {
      setError('We could not save your agreement. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }, [rolesKey, profileId])

  return { status, accept, saving, error }
}

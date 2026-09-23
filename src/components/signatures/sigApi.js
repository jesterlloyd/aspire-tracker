// src/components/signatures/sigApi.js
//
// SIGNATURES-PHASE2: the staff screens' calls to /api/sig-staff, and the flag hook every
// entry point reads. The flag is asked of the SERVER (it knows the caller's role and the
// organization's flag); nothing on the client decides it. Until the answer arrives, and
// whenever it is not "allowed", every signature entry point stays hidden.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

async function token() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session expired. Please sign in again.')
  return session.access_token
}

export async function sigStaff(action, payload = {}) {
  const res = await fetch('/api/sig-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ action, ...payload }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) { const e = new Error(json.error || `Request failed (HTTP ${res.status}).`); e.code = json.code; throw e }
  return json
}

/** For ZIP and CSV: returns a Blob and saves it. */
export async function sigStaffDownload(action, payload, filename) {
  const res = await fetch('/api/sig-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ action, ...payload }),
  })
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Download failed.') }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

let flagPromise = null
export function resetSignaturesFlag() { flagPromise = null }

/** { ready, allowed, state }. Cached for the session; a failure reads as not allowed. */
export function useSignaturesFlag(enabled = true) {
  const [flag, setFlag] = useState({ ready: !enabled, allowed: false, state: 'off' })
  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    flagPromise ||= sigStaff('flag').catch(() => ({ state: 'off', allowed: false }))
    flagPromise.then(f => { if (live) setFlag({ ready: true, allowed: !!f.allowed, state: f.state || 'off' }) })
    return () => { live = false }
  }, [enabled])
  return flag
}

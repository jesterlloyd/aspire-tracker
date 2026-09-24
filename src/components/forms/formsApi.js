// src/components/forms/formsApi.js
//
// FORMS-PHASE3: the staff screens' calls to /api/form-staff, and the hook every Catalog
// entry point reads to know whether Forms is switched on (the database update applied).
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

async function token() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session expired. Please sign in again.')
  return session.access_token
}

async function post(action, payload) {
  return fetch('/api/form-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ action, ...payload }),
  })
}

export async function formStaff(action, payload = {}) {
  const res = await post(action, payload)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) { const e = new Error(json.error || `Request failed (HTTP ${res.status}).`); e.code = json.code; throw e }
  return json
}

/** Downloads one version's answers as CSV. */
export async function downloadCsv(formId, version) {
  const res = await post('csv', { id: formId, version })
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Export failed.') }
  const cd = res.headers.get('Content-Disposition') || ''
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || 'Form answers.csv'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(await res.blob()); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

let statusPromise = null
export function resetFormsStatus() { statusPromise = null }

/** { ready, enabled }. Asked of the server once per page load; a failure reads as off. */
export function useFormsStatus(enabled = true) {
  const [s, setS] = useState({ ready: !enabled, enabled: false })
  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    statusPromise ||= formStaff('status').catch(() => ({ enabled: false }))
    statusPromise.then(r => { if (live) setS({ ready: true, enabled: !!r.enabled }) })
    return () => { live = false }
  }, [enabled])
  return s
}

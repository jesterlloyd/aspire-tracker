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

/**
 * EXPORT-ONE-1 (Owner, 2026-09-24): the one export is the Sheet as Excel. With `view` it is
 * exactly the rows and columns the Sheet shows; without it, every answer in the saved layout.
 */
export async function downloadSheetXlsx(formId, view = {}) {
  const r = await formStaff('sheet_xlsx', { id: formId, ...view })
  const bytes = Uint8Array.from(atob(r.xlsx), ch => ch.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a'); a.href = url; a.download = r.fileName; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
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

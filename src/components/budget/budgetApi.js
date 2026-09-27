// src/components/budget/budgetApi.js
//
// PROGRAM-BUDGET (A3, 2026-09-27): the Program Budget screens' calls. Settings reads and writes
// through /api/budget-staff; the Nursing Education & Leadership portal reads through
// /api/portal/academics-budget, which has no write path. Both send the session token.
import { supabase } from '../../lib/supabase'

async function token() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session expired. Please sign in again.')
  return session.access_token
}
async function read(res) {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) { const e = new Error(json.message || json.error || `Request failed (HTTP ${res.status}).`); e.code = json.error; e.status = res.status; throw e }
  return json
}

/** Settings: one POST per action (see api/budget-staff.js for the list). */
export async function budgetStaff(action, payload = {}) {
  const res = await fetch('/api/budget-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ action, ...payload }),
  })
  return read(res)
}

/** The portal: GET only. */
export async function budgetPortal(query = {}) {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString()
  const res = await fetch(`/api/portal/academics-budget${qs ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${await token()}` } })
  return read(res)
}

/** The two sources the one view reads: the owner's (Settings) and the reader's (portal). */
export const STAFF_SOURCE = Object.freeze({
  load: (fy) => budgetStaff('load', { fiscal_year: fy }),
  exportXlsx: (fy) => budgetStaff('export', { fiscal_year: fy }),
  write: budgetStaff,
})
export const PORTAL_SOURCE = Object.freeze({
  load: (fy) => budgetPortal({ fiscal_year: fy }),
  exportXlsx: (fy) => budgetPortal({ fiscal_year: fy, export: '1' }),
  write: null,
})

/** Save the workbook the server built. */
export function saveXlsx({ fileName, xlsx }) {
  const bytes = Uint8Array.from(atob(xlsx), ch => ch.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

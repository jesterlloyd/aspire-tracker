// Client for the staff-authorized cohort response-targets endpoint. All access goes through the server
// (the table's RLS denies the browser directly); the caller must be an active owner/admin, enforced
// server-side. The bearer token is the current Supabase session.
import { supabase } from './supabase'

async function post(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/cohort-unit-response-targets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

// Returns { ok, ready, targets }. `ready` is false until the Owner migration is applied (fail closed:
// the caller then shows the "targets not set" state and never a false "0 pending").
export async function listCohortResponseTargets(cohortId, { includeInactive = false } = {}) {
  if (!cohortId) return { ok: false, ready: false, targets: [] }
  const { ok, json } = await post({ action: 'list', cohortId, includeInactive })
  return { ok, ready: json.ready === true, targets: Array.isArray(json.targets) ? json.targets : [] }
}

// units: [{ unit_key, unit_name }]. Server dedups canonically, reactivates removed matches, inserts new.
export const createCohortResponseTargets = (cohortId, units) => post({ action: 'create', cohortId, units })
export const deactivateCohortResponseTarget = (cohortId, id) => post({ action: 'deactivate', cohortId, id })
export const reactivateCohortResponseTarget = (cohortId, id) => post({ action: 'reactivate', cohortId, id })

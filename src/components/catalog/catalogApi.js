// src/components/catalog/catalogApi.js
// CATALOG-REVAMP-1: the Catalog's authenticated call to its own endpoints. A body sends a
// POST; no body sends a GET. The demo header is added by src/lib/demoFetch.js, as for every
// /api/ call. Errors surface the server's own message.
import { supabase } from '../../lib/supabase'

export async function authedPost(url, body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session expired. Please sign in again.')
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.message || json.error || `Request failed (HTTP ${res.status}).`)
  return json
}

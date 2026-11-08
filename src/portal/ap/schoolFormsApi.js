// src/portal/ap/schoolFormsApi.js
//
// AP-SCHOOL-FORMS-1: the Academic Partner portal's calls to /api/portal/school-forms. Same shape
// as the staff screens' formStaff (src/components/forms/formsApi.js): resolves the JSON, throws an
// Error with the server's sentence. The server decides which schools and students are the caller's.
import { supabase } from '../../lib/supabase'

export async function schoolForms(action, payload = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Your session expired. Please sign in again.')
  const res = await fetch('/api/portal/school-forms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = new Error(json.error === 'forbidden' ? 'You do not have access to that.' : (json.error || `Request failed (HTTP ${res.status}).`))
    e.code = json.code; e.status = res.status
    throw e
  }
  return json
}

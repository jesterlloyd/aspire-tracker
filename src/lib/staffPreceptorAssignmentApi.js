import { supabase } from './supabase'

async function staffAuthHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : null
}

// PHASE-2D: end a student's primary-preceptor relationship through the one
// canonical server path (clear_primary_preceptor RPC). Server-side the call is
// idempotent: an already-clear student returns ok/no_change, so revert flows
// may call this unconditionally. Each invocation is one intentional action and
// carries its own request id.
export async function clearPrimaryPreceptor(studentId, reason = null) {
  return mutateStaffPreceptorAssignment({
    action: 'clear_primary',
    student_id: studentId,
    reason,
    request_id: crypto.randomUUID(),
  })
}

export async function mutateStaffPreceptorAssignment(payload) {
  const headers = await staffAuthHeader()
  if (!headers) return { ok: false, status: 401, error: 'unauthenticated' }
  try {
    const res = await fetch('/api/preceptor-assignment-manage', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    let data = null
    try { data = await res.json() } catch { data = null }
    if (!res.ok) return { ok: false, status: res.status, data, error: data?.error || 'request_failed' }
    return { ok: true, status: res.status, data, error: null }
  } catch {
    return { ok: false, status: 0, data: null, error: 'network_error' }
  }
}

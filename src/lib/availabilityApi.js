// src/lib/availabilityApi.js
//
// S-04: the one client of /api/availability for the interviewer self-service actions
// (pause or resume a block, block or unblock a slot, mark a Teams invite sent) and the
// student-delete cascade. The browser never writes interview_availability_blocks,
// interview_slots or interview_sessions itself: the endpoint decides ownership from the
// verified profile and stamps the actor. Returns { ok, status, data } with the server's
// safe message in data.message when it refuses.

export async function callAvailability(supabase, payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res = await fetch('/api/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: 'network', message: 'Could not reach the server. Please try again.' } }
  }
}

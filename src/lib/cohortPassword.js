// src/lib/cohortPassword.js
//
// S-08: the browser never writes a cohort's school form password to the cohorts table.
// It posts the value to /api/cohort-password-set, which hashes it server-side. This is
// the one client of that endpoint, shared by New Cohort and Manage Cohort through
// StaffApp's createCohort and updateCohort.

export async function setCohortPassword(supabase, cohortId, password) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return { ok: false, error: 'Session expired. Please refresh and try again.' }
    const res = await fetch('/api/cohort-password-set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cohort_id: cohortId, password: password ?? '' }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 503) return { ok: false, error: body.message || 'The password store is not ready yet.' }
      if (res.status === 403) return { ok: false, error: 'You do not have permission to set the cohort password.' }
      return { ok: false, error: 'The password could not be saved. Please try again.' }
    }
    return { ok: true, cleared: body.cleared === true }
  } catch {
    return { ok: false, error: 'The password could not be saved. Please try again.' }
  }
}

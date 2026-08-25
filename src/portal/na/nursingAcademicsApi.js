// NURSING-ACADEMICS-1: the Nursing Academics portal's server API client.
//
// Same contract as unitLeaderApi/academicPartnerApi: every request carries the
// caller's Supabase JWT; the server re-verifies the active nursing_academic
// grant on every call. apiFetch never throws on a denial, it returns
// { ok, status, data, error } so callers render a permission state (and hand
// access-ended refusals up to the shell via portalAccessSignal).

import { supabase } from '../../lib/supabase'

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : null
}

async function apiFetch(path, { signal } = {}) {
  const headers = await authHeader()
  if (!headers) return { ok: false, status: 401, data: null, error: 'unauthenticated' }
  try {
    const res = await fetch(path, { headers, signal })
    let data = null
    try { data = await res.json() } catch { data = null }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data?.error || 'request_failed') }
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, status: 0, data: null, error: 'aborted' }
    return { ok: false, status: 0, data: null, error: 'network_error' }
  }
}

export function fetchAcademicsCalendar(opts) {
  return apiFetch('/api/portal/academics-calendar', opts)
}

export function fetchCommunityBenefit(fiscalYear, opts) {
  const q = fiscalYear ? `?fiscal_year=${encodeURIComponent(fiscalYear)}` : ''
  return apiFetch(`/api/portal/academics-community-benefit${q}`, opts)
}

// The aggregate CSV is generated server-side (privacy contract); this fetches
// the finished text for a client-side download. Returns
// { ok, status, csv, error }.
export async function fetchBenefitExportCsv(fiscalYear) {
  const headers = await authHeader()
  if (!headers) return { ok: false, status: 401, csv: null, error: 'unauthenticated' }
  try {
    const q = fiscalYear ? `?fiscal_year=${encodeURIComponent(fiscalYear)}` : ''
    const res = await fetch(`/api/portal/academics-benefit-export${q}`, { headers })
    if (!res.ok) {
      let data = null
      try { data = await res.json() } catch { data = null }
      return { ok: false, status: res.status, csv: null, error: data?.error || 'request_failed' }
    }
    const csv = await res.text()
    return { ok: true, status: res.status, csv, error: null }
  } catch {
    return { ok: false, status: 0, csv: null, error: 'network_error' }
  }
}

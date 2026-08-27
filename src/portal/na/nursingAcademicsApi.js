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

async function apiFetch(path, { signal, method = 'GET', body } = {}) {
  const headers = await authHeader()
  if (!headers) return { ok: false, status: 401, data: null, error: 'unauthenticated' }
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
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

export function fetchAcademicsContacts(opts) {
  return apiFetch('/api/portal/academics-contacts', opts)
}

export function createAcademicsContact(payload, opts = {}) {
  return apiFetch('/api/portal/academics-contacts', { ...opts, method: 'POST', body: payload })
}

export function updateAcademicsContact(id, changes, opts = {}) {
  return apiFetch('/api/portal/academics-contacts', { ...opts, method: 'PATCH', body: { id, ...changes } })
}

// CONTACTS-EDITOR-PARITY-1: server-mediated contact photo upload (the portal
// role cannot use the staff app's direct bucket path; the server verifies the
// manage grant and uploads with the service role). `file` is a File/Blob;
// contactId null = upload for a not-yet-created contact (URL returned for the
// create payload). Returns { ok, status, data: { avatar_url }, error }.
export async function uploadAcademicsContactAvatar({ contactId = null, file }, opts = {}) {
  const dataBase64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(file)
  }).catch(() => null)
  if (!dataBase64) return { ok: false, status: 0, data: null, error: 'read_failed' }
  return apiFetch('/api/portal/academics-contact-avatar', {
    ...opts,
    method: 'POST',
    body: { ...(contactId ? { contact_id: contactId } : {}), content_type: file.type, data_base64: dataBase64 },
  })
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

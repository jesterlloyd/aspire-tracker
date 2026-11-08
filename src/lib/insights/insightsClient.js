// ASPIRE-INSIGHTS-1: the browser half of /api/insights. The server decides the lock from the
// caller's grant; the surface only says which door this screen is. demoFetch adds the demo
// header to every /api/ request, so the population follows the session with nothing here.
import { supabase } from '../supabase'

/**
 * @param {'staff'|'leadership'|'partner'|'unit'|'residency'} surface
 * @param {string} search  the page's query string (searchFromFilters), '' for none
 * @param {object} [extra] e.g. { unit } for a Unit Leader narrowing to one of their units
 * @returns {Promise<object>} the figures, or throws an Error whose .status is the HTTP status
 */
export async function fetchInsights(surface, search = '', extra = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const p = new URLSearchParams(search.replace(/^\?/, ''))
  p.set('surface', surface)
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
  const res = await fetch(`/api/insights?${p.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json.error || 'insights_failed'), { status: res.status })
  return json
}

/**
 * INSIGHTS-KEITH-READ-1: Keith's Read. `latest` returns the saved read for these filters (and the
 * latest of any filters when these were never read); `run` asks Keith for a new one. The server
 * recomputes the figures from `filters`; nothing the browser has drawn is sent.
 * @param {'latest'|'run'} action
 * @param {object} filters  the page's filters (filtersFromSearch), strings only
 */
export async function keithInsights(action, filters = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => typeof v === 'string' && v !== ''))
  const res = await fetch('/api/keith-insights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, filters: clean }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json.message || json.error || 'keith_read_failed'), { status: res.status, code: json.error })
  return json
}

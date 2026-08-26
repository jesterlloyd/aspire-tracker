// ASPIRE-PORTAL-CONTACTS: single source of truth for the saved-Contacts
// typeahead search, extracted from ContactAutocomplete so the Outreach CC picker
// and the Grant Portal Access modal share ONE contacts search (same table, same
// authorized RLS path, same matched columns, same debounce, same sanitization).
// No new endpoint, schema, or migration; reads the contacts table client-direct
// under its existing RLS (is_active only), exactly as Outreach does.
//
// Pure helpers live in ./contactSearchCore.js (no React/Supabase import) and are
// re-exported here so components have one import site.
import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import { CONTACT_SEARCH_COLUMNS, sanitizeContactTerm, contactSubtitle, contactUnitValues, matchCatalogKeys, matchSchoolKeys, normalizeSchoolTerm, pickReliableStudent, inferPortalRoleFromContact, bestStudentLoginEmail } from './contactSearchCore'

export { CONTACT_SEARCH_COLUMNS, sanitizeContactTerm, contactSubtitle, contactUnitValues, matchCatalogKeys, matchSchoolKeys, normalizeSchoolTerm, pickReliableStudent, inferPortalRoleFromContact, bestStudentLoginEmail }

// The one contacts query. Returns [] for terms under 2 chars. Same .or(ilike)
// field set and is_active filter that Outreach's ContactAutocomplete uses.
export async function searchContacts(term, { limit = 6 } = {}) {
  const t = sanitizeContactTerm(term)
  if (t.length < 2) return []
  const like = `%${t}%`
  const { data, error } = await supabase
    .from('contacts')
    .select(CONTACT_SEARCH_COLUMNS)
    .eq('is_active', true)
    .or(`full_name.ilike.${like},preferred_name.ilike.${like},email.ilike.${like},role.ilike.${like},school_name.ilike.${like},organization.ilike.${like},category.ilike.${like}`)
    .limit(limit)
  if (error) return []
  return data || []
}

// Debounced (250ms) contacts search hook with a request-id staleness guard, so
// stale results never render for a newer query. Mirrors ContactAutocomplete's
// derived-loading pattern.
export function useContactSearch(value, { limit = 6 } = {}) {
  const [debounced, setDebounced] = useState('')
  const [state, setState] = useState({ key: '', rows: [] })
  const reqRef = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(sanitizeContactTerm(value)), 250)
    return () => clearTimeout(t)
  }, [value])

  useEffect(() => {
    if (debounced.length < 2) return
    const id = ++reqRef.current
    searchContacts(debounced, { limit })
      .then(rows => { if (id === reqRef.current) setState({ key: debounced, rows }) })
      .catch(() => { if (id === reqRef.current) setState({ key: debounced, rows: [] }) })
  }, [debounced, limit])

  const loading = debounced.length >= 2 && state.key !== debounced
  const rows = state.key === debounced ? state.rows : []
  return { rows, loading, debounced }
}

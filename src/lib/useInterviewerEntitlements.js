// INTERVIEWER-ENTITLEMENTS-UI-1: one query, two surfaces.
//
// The Account details drawer shows cohort access READ-ONLY (so the state is
// visible without entering edit mode, which is the whole point of the surface),
// and the Account profile modal grants and revokes. Both read the same ledger,
// so they share one query key and one fetcher: a grant made in the modal
// invalidates the drawer's copy too, and neither can drift from the other.
//
// The endpoint is active-Owner/Admin only and is the only writer.

import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { activeEntitlements } from './interviewerEntitlements'

export const ENTITLEMENTS_KEY = (profileId) => ['interviewer_entitlements', profileId]

export async function postEntitlements(body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/interviewer-entitlements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'request_failed')
  return json
}

/** Cohort catalogue for naming grants and offering new ones. */
export function useCohortCatalogue(enabled = true) {
  return useQuery({
    queryKey: ['entitlement_cohorts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cohorts').select('id, name').order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled,
  })
}

/**
 * The raw ledger plus this interviewer's live grants, named.
 * `enabled` is false for non-interviewers so no request is made for an account
 * that can never hold an entitlement.
 */
export function useInterviewerEntitlements(profileId, enabled = true) {
  const rowsQuery = useQuery({
    queryKey: ENTITLEMENTS_KEY(profileId),
    queryFn: async () => (await postEntitlements({ action: 'list' })).entitlements || [],
    enabled: !!profileId && enabled,
  })
  const cohortsQuery = useCohortCatalogue(!!profileId && enabled)

  return {
    rows: rowsQuery.data || [],
    cohorts: cohortsQuery.data || [],
    active: activeEntitlements(rowsQuery.data || [], profileId, cohortsQuery.data || []),
    isLoading: rowsQuery.isLoading,
    isError: rowsQuery.isError,
    refetch: rowsQuery.refetch,
  }
}

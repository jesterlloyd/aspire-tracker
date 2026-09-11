// NGRP-WORKSPACE-1 (correction): endpoint-backed NGRP reads.
//
// The browser holds NO direct privilege on any ngrp_* table (RLS on, all
// client-role grants revoked). Every read goes through POST
// /api/ngrp-workspace under the caller's verified JWT, where the one
// capability table (lib/server/access.js) authorizes an ACTIVE Owner-
// capability / Admin / Co-Lead caller and lib/server/ngrpApplicants.js
// resolves the roster contract server-side.
//
// Distinct states - never conflated, and never optimistic:
//   'loading'       first resolution still in flight (nothing is assumed
//                   provisioned or authorized until the server answers)
//   'unauthorized'  the server refused this caller (401/403)
//   'unprovisioned' the NGRP migration has not been applied
//   'error'         ordinary server/database failure, nothing cached
//   'stale'         a background refresh failed but earlier data is shown
//   'ready'         live data
//
// No hook here ever raises a toast: routine background refreshes stay quiet
// (plan §5.4), and error surfaces are the owning component's banners.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'

async function authedPost(endpoint, action, payload = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) {
    const err = new Error('unauthenticated')
    err.status = 401
    throw err
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  })
  let body = null
  try { body = await res.json() } catch { /* non-JSON body: treated as null */ }
  if (!res.ok) {
    const err = new Error(body?.error || 'request_failed')
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

const postNgrp = (action, payload) => authedPost('/api/ngrp-workspace', action, payload)

// NGRP-RELEASE-2: management writes (Planning + staff review actions). Same
// bearer pattern; callers get { ok:false, status, errors } instead of a throw
// so validation errors can render field-by-field without try/catch noise.
export async function postNgrpManage(action, payload = {}) {
  try {
    const body = await authedPost('/api/ngrp-manage', action, payload)
    return { ok: true, ...body }
  } catch (err) {
    return { ok: false, status: err.status || 0, error: err.message, errors: err.body?.errors || [] }
  }
}

const isAuthStatus = (s) => s === 401 || s === 403
const noAuthRetry = (failureCount, error) =>
  !isAuthStatus(error?.status) && failureCount < 1

function deriveStatus(query) {
  if (query.isLoading) return 'loading'
  if (query.isError) {
    if (isAuthStatus(query.error?.status)) return 'unauthorized'
    return query.data ? 'stale' : 'error'
  }
  if (query.data?.provisioned === false) return 'unprovisioned'
  return 'ready'
}

export function useNgrpCycles({ enabled = true } = {}) {
  const query = useQuery({
    queryKey: ['ngrp_workspace', 'cycles'],
    queryFn: () => postNgrp('cycles'),
    enabled,
    staleTime: 60_000,
    retry: noAuthRetry,
  })
  return {
    status: deriveStatus(query),
    cycles: query.data?.cycles || [],
    dataUpdatedAt: query.dataUpdatedAt || 0,
    refetch: query.refetch,
  }
}

// Planning bundle for one residency cohort (or the first-time setup data
// when cycleId is null: just the ASPIRE cohort catalog for the mapper).
export function useNgrpPlanning(cycleId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: ['ngrp_workspace', 'planning', cycleId || 'none'],
    queryFn: () => postNgrpManage('planning', cycleId ? { cycle_id: cycleId } : {})
      .then(r => { if (!r.ok) { const e = new Error(r.error || 'request_failed'); e.status = r.status; throw e } return r }),
    enabled,
    staleTime: 15_000,
    retry: noAuthRetry,
  })
  return {
    status: deriveStatus(query),
    data: query.data && query.data.provisioned !== false ? query.data : null,
    refetch: query.refetch,
  }
}

export function useNgrpApplicants(cycleId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: ['ngrp_workspace', 'applicants', cycleId],
    queryFn: () => postNgrp('applicants', { cycle_id: cycleId }),
    enabled: Boolean(cycleId) && enabled,
    staleTime: 30_000,
    // Quiet background freshness (plan §5.4): focus refetch plus a slow
    // interval fallback. Failures surface as the 'stale' status, never as a
    // toast.
    refetchOnWindowFocus: true,
    refetchInterval: 90_000,
    retry: noAuthRetry,
  })
  return {
    status: deriveStatus(query),
    payload: query.data && query.data.provisioned !== false ? query.data : null,
    dataUpdatedAt: query.dataUpdatedAt || 0,
    isFetching: query.isFetching,
    refetch: query.refetch,
  }
}

// RESIDENCY-PORTAL-2b: preceptor feedback requests. The same bearer pattern and
// the same { ok } result shape as postNgrpManage.
export async function postNgrpPreceptorFeedback(action, payload = {}) {
  try {
    const body = await authedPost('/api/ngrp-preceptor-feedback', action, payload)
    return { ok: true, ...body }
  } catch (err) {
    return { ok: false, status: err.status || 0, error: err.message }
  }
}

// Who has feedback on file and where each request stands, keyed by student id.
// Empty (and the feature hidden) until migration 20260912000000 is applied.
export function useNgrpPreceptorFeedback(cycleId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: ['ngrp_workspace', 'preceptor_feedback', cycleId],
    queryFn: () => authedPost('/api/ngrp-preceptor-feedback', 'summary', { cycle_id: cycleId }),
    enabled: Boolean(cycleId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: noAuthRetry,
  })
  const ready = Boolean(query.data) && query.data.provisioned !== false
  return {
    status: deriveStatus(query),
    byStudent: ready ? (query.data.byStudent || {}) : {},
    audience: ready ? query.data.audience || null : null,
    canDecide: ready && query.data.canDecide === true,
    refetch: query.refetch,
  }
}

// RESIDENCY-PORTAL-3: the Alumni Roster as a CSV, built server-side from the
// roster this caller may see. { ok, csv, filename } or { ok: false }.
export async function fetchNgrpRosterCsv(cycleId) {
  try {
    const body = await authedPost('/api/ngrp-workspace', 'export', { cycle_id: cycleId })
    return body?.provisioned === false ? { ok: false } : { ok: true, csv: body?.csv, filename: body?.filename }
  } catch (err) {
    return { ok: false, status: err.status || 0 }
  }
}

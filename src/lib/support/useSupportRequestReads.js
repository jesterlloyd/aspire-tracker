// src/lib/support/useSupportRequestReads.js
//
// ASPIRE-SUPPORT-REQUEST-ACTION-CENTER-2 - shared data layer for the per-user unread support-request
// feature. ONE react-query key ([SUPPORT_READS_KEY, profileId]) is fetched here and reused by all
// four consumers (bell count, Action Center, Rotation badge, shift-row dot), so react-query dedupes
// the fetch and a single invalidation refreshes every surface. The DB (support_request_reads) is the
// source of truth; receipts are the CURRENT user's own rows (RLS enforces this; we still filter by
// user_id). No custom event strings are scattered across components - invalidation is centralized in
// markSupportRequestRead().

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { buildReadReceipt } from './supportRequests'

export const SUPPORT_READS_KEY = 'support_request_reads'

// Current user's support-request read receipts ({ user_id, shift_log_id, support_fingerprint, read_at }).
// Disabled (returns []) when there is no profile id. Fetch errors surface via the query's error state;
// callers treat "no receipts" as "everything unread" (safe: never falsely marks a request read).
export function useSupportRequestReads(profileId) {
  const query = useQuery({
    queryKey: [SUPPORT_READS_KEY, profileId || null],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_request_reads')
        .select('user_id, shift_log_id, support_fingerprint, read_at')
        .eq('user_id', profileId)
      if (error) throw error
      return data || []
    },
    enabled: !!profileId,
    staleTime: 30 * 1000,
  })
  return { receipts: query.data || [], isLoading: query.isLoading, error: query.error }
}

// Idempotent read-receipt write for the current Owner/Admin, followed by a shared invalidation so all
// four surfaces recompute immediately. Returns:
//   { ok: true }               - written (or already present); indicators should clear
//   { ok: false, skipped }     - no meaningful support text / missing identity; nothing written
//   { ok: false, error }       - write failed; caller keeps the request unread + viewable
// Never logs support text. read_at is not updated on reopen (ON CONFLICT DO NOTHING via ignoreDuplicates).
export async function markSupportRequestRead(queryClient, profileId, log) {
  const receipt = buildReadReceipt(profileId, log)
  if (!receipt) return { ok: false, skipped: true }
  try {
    const { error } = await supabase
      .from('support_request_reads')
      .upsert(receipt, { onConflict: 'user_id,shift_log_id,support_fingerprint', ignoreDuplicates: true })
    if (error) {
      console.error('[support-request-read] receipt write failed', {
        shift_log_id: receipt.shift_log_id, user_id: receipt.user_id, code: error.code, message: error.message,
      })
      return { ok: false, error }
    }
  } catch (err) {
    console.error('[support-request-read] receipt write threw', { shift_log_id: receipt.shift_log_id, message: err?.message })
    return { ok: false, error: err }
  }
  // Refresh every consumer of the receipts query (bell, Action Center, Rotation badge, shift dot).
  queryClient.invalidateQueries({ queryKey: [SUPPORT_READS_KEY] })
  return { ok: true }
}

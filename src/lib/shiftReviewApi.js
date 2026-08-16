// src/lib/shiftReviewApi.js
//
// SHIFT-LOG-REVIEW-1: the browser's ONLY path to a review decision. Reads stay
// on the existing RLS SELECTs; every write goes through the protected endpoint
// (service-role RPC behind Owner/Admin JWT verification). The client never
// touches student_shift_logs.status or students hours columns directly.

import { supabase } from './supabase'

/**
 * Submit a review decision.
 * @param payload { shift_id, decision, rationale?, adjusted_hours?, acknowledged_warnings? }
 * @returns { ok, result? , error?, warnings?, current_status? }
 */
export async function decideShiftReview(payload) {
  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) return { ok: false, error: 'unauthorized' }
    const res = await fetch('/api/shift-log-review', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        ok: false,
        error: body.error || `http_${res.status}`,
        warnings: body.warnings || [],
        current_status: body.current_status,
      }
    }
    return { ok: true, result: body.result }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

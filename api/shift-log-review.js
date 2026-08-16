// api/shift-log-review.js
//
// SHIFT-LOG-REVIEW-1: Owner/Admin decisions on Pending Review shifts.
//
// POST { shift_id, decision: 'approved' | 'adjusted' | 'rejected',
//        rationale?, adjusted_hours?, acknowledged_warnings?: string[] }
//
// The decision itself is ONE service-role transactional RPC
// (public.review_shift_log): lock the student row, verify the shift is still
// Pending Review, enforce warning acknowledgement inside the lock, apply the
// status change, append the immutable audit row, recompute approved/pending
// totals from authoritative completed rows. This endpoint only:
//   1. verifies the caller is an ACTIVE Owner/Admin (JWT -> profile);
//   2. fails closed with 'migration_required' until 20260818000000 is applied;
//   3. maps the RPC's P000x taxonomy onto stable client errors;
//   4. applies the Auto-Accepted downstream parity effects after an approval
//      (api/lib/shiftReviewEffects.js) - best-effort, never blocking.
//
// The client NEVER writes review decisions or aggregate totals: RLS grants the
// browser no write on student_shift_logs reviews, and the RPC is EXECUTE-able
// by service_role only.
//
// Error responses (stable keys, never raw DB messages):
//   401 unauthorized | 403 forbidden | 405 method_not_allowed
//   503 migration_required
//   400 invalid_request | invalid_decision | rationale_required |
//       adjusted_hours_invalid
//   404 shift_not_found
//   409 already_decided { current_status }   - repeat/concurrent decision
//   409 warnings_not_acknowledged { warnings: [...] } - deliberate
//       confirmation required; the client shows the warnings and retries with
//       acknowledged_warnings once the reviewer explicitly confirms.
//   500 internal_error

/* global process */
import { createClient } from '@supabase/supabase-js'
import { applyApprovalDownstream } from './lib/shiftReviewEffects.js'

const DECISIONS = ['approved', 'adjusted', 'rejected']

async function verifyOwnerAdminCaller(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: 'unauthorized' }
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await userClient.auth.getUser()
    if (error || !data?.user) return { ok: false, status: 401, error: 'unauthorized' }
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: profile, error: profileError } = await admin
      .from('user_profiles')
      .select('id, role, is_owner, is_active')
      .eq('auth_user_id', data.user.id)
      .maybeSingle()
    if (profileError || !profile || profile.is_active === false) {
      return { ok: false, status: 403, error: 'forbidden' }
    }
    // Owner/Admin only - a review decision is hours authority.
    if (!['owner', 'admin'].includes(profile.role || '')) {
      return { ok: false, status: 403, error: 'forbidden' }
    }
    return { ok: true, db: admin, profile }
  } catch {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
}

async function reviewReady(db) {
  const { data, error } = await db.rpc('shift_review_ready')
  if (error) return false   // PGRST202 (missing function) or anything else: not ready
  return data === true
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const auth = await verifyOwnerAdminCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
  const { db, profile } = auth

  try {
    const body = req.body || {}
    const shiftId = String(body.shift_id || '')
    const decision = String(body.decision || '')
    if (!UUID_RE.test(shiftId) || !DECISIONS.includes(decision)) {
      return res.status(400).json({ error: 'invalid_request' })
    }
    const rationale = typeof body.rationale === 'string' ? body.rationale.slice(0, 2000) : null
    const adjustedHours = body.adjusted_hours == null ? null : Number(body.adjusted_hours)
    if (adjustedHours != null && !Number.isFinite(adjustedHours)) {
      return res.status(400).json({ error: 'adjusted_hours_invalid' })
    }
    const acknowledged = Array.isArray(body.acknowledged_warnings)
      ? body.acknowledged_warnings.filter(w => typeof w === 'string').slice(0, 10)
      : []

    // Fail closed until the review migration is applied - a decision whose
    // audit row and recompute cannot happen must not half-happen.
    if (!(await reviewReady(db))) {
      return res.status(503).json({
        error: 'migration_required',
        detail: 'Apply 20260818000000_shift_log_review before reviewing shifts.',
      })
    }

    // Pre-decision student snapshot for the downstream effects (the promotion
    // checks the PRE-decision status, same as the submit-past-shift path).
    const { data: shiftRow, error: shiftErr } = await db
      .from('student_shift_logs')
      .select('id, student_id, unit_name')
      .eq('id', shiftId)
      .maybeSingle()
    if (shiftErr) return res.status(500).json({ error: 'internal_error' })
    if (!shiftRow) return res.status(404).json({ error: 'shift_not_found' })
    const { data: student, error: studentErr } = await db
      .from('students')
      .select('id, cohort_id, status, hours_required')
      .eq('id', shiftRow.student_id)
      .maybeSingle()
    if (studentErr || !student) return res.status(500).json({ error: 'internal_error' })

    // ── The atomic decision ──────────────────────────────────────────────────
    const { data: result, error: rpcError } = await db.rpc('review_shift_log', {
      p_shift_id: shiftId,
      p_decision: decision,
      p_reviewer_profile_id: profile.id,
      p_rationale: rationale,
      p_adjusted_hours: adjustedHours,
      p_acknowledged_warnings: acknowledged,
    })

    if (rpcError) {
      const code = rpcError.code
      const msg = String(rpcError.message || '')
      if (code === 'P0001') {
        // Already decided (or raced) - report the current state, never re-apply.
        const { data: current } = await db
          .from('student_shift_logs').select('status').eq('id', shiftId).maybeSingle()
        return res.status(409).json({ error: 'already_decided', current_status: current?.status || null })
      }
      if (code === 'P0002') return res.status(404).json({ error: 'shift_not_found' })
      if (code === 'P0003') return res.status(400).json({ error: 'invalid_decision' })
      if (code === 'P0004') return res.status(400).json({ error: 'rationale_required' })
      if (code === 'P0005') return res.status(400).json({ error: 'adjusted_hours_invalid' })
      if (code === 'P0006') return res.status(403).json({ error: 'forbidden' })
      if (code === 'P0007') {
        // Deliberate confirmation required: name the warnings so the client can
        // show them and resubmit with acknowledged_warnings.
        const warnings = (msg.split('warnings_not_acknowledged:')[1] || '')
          .split(',').map(w => w.trim()).filter(Boolean)
        return res.status(409).json({ error: 'warnings_not_acknowledged', warnings })
      }
      console.error('[shift-log-review] rpc failed', { code })
      return res.status(500).json({ error: 'internal_error' })
    }

    // ── Downstream parity for approvals (best-effort, never blocks) ──────────
    if (decision !== 'rejected') {
      await applyApprovalDownstream(db, student, shiftRow, {
        approved_hours: result?.approved_hours,
      })
    }

    return res.status(200).json({ success: true, result })
  } catch (err) {
    console.error('[shift-log-review] unexpected error:', err?.message)
    return res.status(500).json({ error: 'internal_error' })
  }
}

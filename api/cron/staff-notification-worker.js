// api/cron/staff-notification-worker.js
//
// PHASE 2C: the Owner/Admin notification email worker cron. Vercel cron invokes this with
// Authorization: Bearer CRON_SECRET. It claims a bounded batch of due staff_notifications rows
// (SKIP LOCKED via the RPC) and sends one email per row. It never modifies assignment or audit
// rows. Safe under overlapping invocations. Mirrors api/cron/messages-delivery-worker.js.
//
// Until the assignment RPCs enqueue rows (Phase 2C applied) it finds nothing due and sends nothing.

/* global process */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { runStaffNotificationWorker } from '../../lib/server/staffNotifications/deliveryService.js'
import { CLAIM_BATCH_LIMIT, CLAIM_STALE_SECONDS } from '../../lib/server/staffNotifications/config.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'

const CRON_NAME = 'staff-notification-worker'

function createServiceDb(env) {
  return createClient(
    env.VITE_SUPABASE_URL || env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

// Dependency injection keeps authorization request-testable without constructing a database or
// Resend client. Production uses the defaults; rejected requests return before any dependency is
// created or any queue claim can occur.
export function createStaffNotificationWorkerHandler({
  env = process.env,
  getDb = () => createServiceDb(env),
  getResend = apiKey => new Resend(apiKey),
  startRun = startCronRun,
  finishSuccess = finishCronRunSuccess,
  finishError = finishCronRunError,
  runWorker = runStaffNotificationWorker,
} = {}) {
  return async function handler(req, res) {
    // S-12: this handler's inline guard was the correct one and became the
    // shared helper. It now CALLS that helper rather than keeping a second
    // copy, so there is exactly one implementation to audit. env stays
    // injected, which is how this route's tests supply a secret.
    if (!isAuthorizedCronRequest(req, env)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const supabase = getDb()
    const runId = await startRun(supabase, CRON_NAME)
    try {
      const resend = getResend(env.RESEND_API_KEY)
      const worker = `${CRON_NAME}:${runId || 'unknown'}`
      const counts = await runWorker(supabase, resend, {
        worker, limit: CLAIM_BATCH_LIMIT, staleSeconds: CLAIM_STALE_SECONDS,
      })
      await finishSuccess(supabase, runId, counts)
      return res.status(200).json({ success: true, ...counts })
    } catch (err) {
      await finishError(supabase, runId, err?.message)
      return res.status(500).json({ success: false, error: 'worker_error' })
    }
  }
}

export default createStaffNotificationWorkerHandler()

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

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const CRON_NAME = 'staff-notification-worker'

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const runId = await startCronRun(supabase, CRON_NAME)
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const worker = `${CRON_NAME}:${runId || 'unknown'}`
    const counts = await runStaffNotificationWorker(supabase, resend, {
      worker, limit: CLAIM_BATCH_LIMIT, staleSeconds: CLAIM_STALE_SECONDS,
    })
    await finishCronRunSuccess(supabase, runId, counts)
    return res.status(200).json({ success: true, ...counts })
  } catch (err) {
    await finishCronRunError(supabase, runId, err?.message)
    return res.status(500).json({ success: false, error: 'worker_error' })
  }
}

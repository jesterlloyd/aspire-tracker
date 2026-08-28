// api/cron/messages-delivery-worker.js
//
// ASPIRE MESSAGES, PHASE 2 (STAGE B): the bounded retry worker. Vercel cron
// invokes this bare path with the Authorization: Bearer CRON_SECRET header. It
// atomically claims a bounded batch of due delivery rows (FOR UPDATE SKIP LOCKED
// via the Stage A RPC), processes each independently with an awaited Resend send,
// and records queue state and cron_runs observability. It never modifies
// conversations, messages, participants, read state, or events, and never logs a
// message body. It is safe under overlapping invocations.
//
// Note: until the Phase 3 conversation API enqueues delivery rows, this worker
// finds nothing due and sends nothing. It does not initiate any send on its own.

/* global process */
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js';
import { runDeliveryWorker } from '../../lib/server/messages/deliveryService.js';
import { CLAIM_BATCH_LIMIT, CLAIM_STALE_SECONDS } from '../../lib/server/messages/config.js';
import { isAuthorizedCronRequest } from '../lib/cronAuth.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const CRON_NAME = 'messages-delivery-worker';

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const runId = await startCronRun(supabase, CRON_NAME);
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    // A per-invocation worker id lets stale-claim recovery distinguish holders.
    const worker = `${CRON_NAME}:${runId || 'unknown'}`;
    const counts = await runDeliveryWorker(supabase, resend, {
      worker,
      limit: CLAIM_BATCH_LIMIT,
      staleSeconds: CLAIM_STALE_SECONDS,
    });
    await finishCronRunSuccess(supabase, runId, counts);
    return res.status(200).json({ success: true, ...counts });
  } catch (err) {
    await finishCronRunError(supabase, runId, err?.message);
    // A worker error must not wedge the cron; report and move on next run.
    return res.status(500).json({ success: false, error: 'worker_error' });
  }
}

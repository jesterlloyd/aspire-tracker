/* global process */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js';
import { runPortalFeedbackDeliveryWorker } from '../../lib/server/portalFeedback/deliveryService.js';
import {
  PORTAL_FEEDBACK_CLAIM_BATCH_LIMIT,
  PORTAL_FEEDBACK_CLAIM_STALE_SECONDS,
} from '../../lib/server/portalFeedback/config.js';
import { isAuthorizedCronRequest } from '../lib/cronAuth.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const CRON_NAME = 'portal-feedback-delivery-worker';

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const runId = await startCronRun(supabase, CRON_NAME);
  try {
    const counts = await runPortalFeedbackDeliveryWorker(supabase, new Resend(process.env.RESEND_API_KEY), {
      worker: `${CRON_NAME}:${runId || 'unknown'}`,
      limit: PORTAL_FEEDBACK_CLAIM_BATCH_LIMIT,
      staleSeconds: PORTAL_FEEDBACK_CLAIM_STALE_SECONDS,
    });
    await finishCronRunSuccess(supabase, runId, counts);
    return res.status(200).json({ success: true, ...counts });
  } catch (err) {
    await finishCronRunError(supabase, runId, err?.message);
    return res.status(500).json({ success: false, error: 'worker_error' });
  }
}

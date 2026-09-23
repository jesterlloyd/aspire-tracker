// api/cron/sig-maintenance.js
//
// SIGNATURES-PHASE2: hourly upkeep for signature requests. Expires requests past their
// expiry (their links stop working), sends due reminders (every 3 days, or once 2 days
// before expiry, per request), and retries any seal that failed (for example when the
// timestamp authority was unreachable). Real requests only (DEMO-DATA-2): a demo request
// is never reminded or expired by the clock. Does nothing while catalog.signatures is off.

import { createClient } from '@supabase/supabase-js'
import { populationDb } from '../../lib/server/demoScope.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { createMailer } from '../../lib/server/email/mailer.js'
import { appBaseUrl } from '../../lib/server/appUrl.js'
import { flagState, loadSettings, maintenance } from '../../lib/server/signatures/engine.js'

export const CRON_NAME = 'sig-maintenance'

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  const db = populationDb(createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))
  const runId = await startCronRun(db, CRON_NAME)
  try {
    if ((await flagState(db)) === 'off') {
      await finishCronRunSuccess(db, runId, { skipped: true, reason: 'flag_off' })
      return res.status(200).json({ skipped: true, reason: 'flag_off' })
    }
    const out = await maintenance(db, { appUrl: appBaseUrl(), mailer: createMailer(), settings: await loadSettings(db) })
    await finishCronRunSuccess(db, runId, out)
    return res.status(200).json(out)
  } catch (err) {
    await finishCronRunError(db, runId, err?.message || String(err))
    return res.status(500).json({ error: err?.message || 'failed' })
  }
}

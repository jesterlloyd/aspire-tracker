// api/cron/budget-maintenance.js
//
// PROGRAM-BUDGET Phase A (A9, 2026-09-27): once a day, post every subscription charge that has
// come due as a row on the Sheet. Posting is idempotent (one row per subscription per charge
// date, held by a unique index), so a missed or repeated run changes nothing. Posts only into
// fiscal years the Owner has started. Does nothing until the Program Budget migration is applied.

import { createClient } from '@supabase/supabase-js'
import { populationDb } from '../../lib/server/demoScope.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { postDueCharges, status } from '../../lib/server/budget/engine.js'
import { autoStartApproved } from '../../lib/server/budget/plan.js'
import process from 'node:process'

export const CRON_NAME = 'budget-maintenance'

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  const db = populationDb(createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))
  const runId = await startCronRun(db, CRON_NAME)
  try {
    const ready = await status(db)
    // BUDGET-V2 item 14: on July 1 an approved proposal becomes the year, then its charges post.
    const started = ready.enabled ? await autoStartApproved(db) : { started: null }
    const out = ready.enabled ? { ...(await postDueCharges(db)), started: started.started } : { posted: 0, skipped: 'not_enabled' }
    await finishCronRunSuccess(db, runId, out)
    return res.status(200).json(out)
  } catch (err) {
    await finishCronRunError(db, runId, err?.message || String(err))
    return res.status(500).json({ error: err?.message || 'failed' })
  }
}

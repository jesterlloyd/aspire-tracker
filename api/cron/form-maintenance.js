// api/cron/form-maintenance.js
//
// FORMS-PHASE3: hourly upkeep for Catalog forms. Sends due reminders (every 3 days, or
// once 2 days before the due date, per assignment) and closes links whose due date has
// passed when the form says "Close after the due date". Real assignments only
// (DEMO-DATA-2): a demo assignment is never reminded or closed by the clock. Does nothing
// until the Forms migration is applied.

import { createClient } from '@supabase/supabase-js'
import { populationDb } from '../../lib/server/demoScope.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { createMailer } from '../../lib/server/email/mailer.js'
import { appBaseUrl } from '../../lib/server/appUrl.js'
import { maintenance } from '../../lib/server/forms/engine.js'
import process from 'node:process'

export const CRON_NAME = 'form-maintenance'

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  const db = populationDb(createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))
  const runId = await startCronRun(db, CRON_NAME)
  try {
    const out = await maintenance(db, { appUrl: appBaseUrl(), mailer: createMailer() })
    await finishCronRunSuccess(db, runId, out)
    return res.status(200).json(out)
  } catch (err) {
    await finishCronRunError(db, runId, err?.message || String(err))
    return res.status(500).json({ error: err?.message || 'failed' })
  }
}

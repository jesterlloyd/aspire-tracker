// api/cron/keith-residency-auto.js
//
// KEITH-AUTO-1: every 10 minutes, Keith scores new résumés and assesses submitted Transition Form
// statements for the residency cohorts in Planning or Active (lib/server/keith/residencyAutoRun.js).
// REAL rows only (DEMO-DATA-2): the client is populationDb. Does nothing while both Skills are off.

import { createClient } from '@supabase/supabase-js'
import { populationDb } from '../../lib/server/demoScope.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { sweep } from '../../lib/server/keith/residencyAutoRun.js'
import process from 'node:process'

export const CRON_NAME = 'keith-residency-auto'

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  // populationDb scopes the same client in place, so its storage is the service client's.
  const db = populationDb(createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))
  const runId = await startCronRun(db, CRON_NAME)
  try {
    const out = await sweep(db, db.storage)
    await finishCronRunSuccess(db, runId, out)
    return res.status(200).json(out)
  } catch (err) {
    await finishCronRunError(db, runId, err?.message || String(err))
    return res.status(500).json({ error: err?.message || 'failed' })
  }
}

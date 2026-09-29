// api/cron/keith-checkin-sort.js
//
// KEITH-CHECKIN-1: every 10 minutes, Keith sorts the support check-in replies the safety and decline
// rules did not catch (lib/server/keith/checkinSorting.js). REAL rows only (DEMO-DATA-2): the
// client is populationDb, and student_shift_logs is inside the demo boundary. Does nothing while
// the sort-checkin-reply skill is off or before its migration is applied.

import { createClient } from '@supabase/supabase-js'
import { populationDb } from '../../lib/server/demoScope.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { sweep } from '../../lib/server/keith/checkinSorting.js'
import process from 'node:process'

export const CRON_NAME = 'keith-checkin-sort'

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  const db = populationDb(createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))
  const runId = await startCronRun(db, CRON_NAME)
  try {
    const out = await sweep(db)
    await finishCronRunSuccess(db, runId, out)
    return res.status(200).json(out)
  } catch (err) {
    await finishCronRunError(db, runId, err?.message || String(err))
    return res.status(500).json({ error: err?.message || 'failed' })
  }
}

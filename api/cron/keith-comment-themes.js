// api/cron/keith-comment-themes.js
//
// KEITH-THEMES-1: once a day, a cohort's evaluation timepoint with nothing still awaiting a response gets
// Keith's themes, or fresh ones when comments arrived since and nobody has edited the current version
// (lib/server/evaluation/commentThemes.js autoRun). Five per run. REAL rows only (populationDb). Does
// nothing while the theme-comments skill is off or before its migration.

import { createClient } from '@supabase/supabase-js'
import { populationDb } from '../../lib/server/demoScope.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { autoRun } from '../../lib/server/evaluation/commentThemes.js'
import process from 'node:process'

export const CRON_NAME = 'keith-comment-themes'

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  const db = populationDb(createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))
  const runId = await startCronRun(db, CRON_NAME)
  try {
    const out = await autoRun(db)
    await finishCronRunSuccess(db, runId, out)
    return res.status(200).json(out)
  } catch (err) {
    await finishCronRunError(db, runId, err?.message || String(err))
    return res.status(500).json({ error: err?.message || 'failed' })
  }
}

// api/cron/keith-placement-shadow.js
//
// KEITH-PLACEMENT-1: every hour while the explain-placement skill is in SHADOW, Keith computes a
// suggestion for each ready student who has none yet (10 per cohort per run), quietly. Nothing is
// shown on the board; the comparison card reads these once the students are placed. REAL rows only
// (DEMO-DATA-2): populationDb, and students are inside the boundary. Does nothing while the skill is
// off or ON (ON runs are the Owner's "Suggest for all unplaced"), or before the migration.

import { createClient } from '@supabase/supabase-js'
import { populationDb } from '../../lib/server/demoScope.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { runSuggestions, cohortsToShadow } from '../../lib/server/placement/placementSuggestions.js'
import process from 'node:process'

export const CRON_NAME = 'keith-placement-shadow'

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  const db = populationDb(createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))
  const runId = await startCronRun(db, CRON_NAME)
  try {
    const out = []
    for (const cohortId of await cohortsToShadow(db)) out.push({ cohortId, ...(await runSuggestions(db, { cohortId, source: 'shadow_cron', limit: 10 })) })
    await finishCronRunSuccess(db, runId, { cohorts: out.length, suggested: out.reduce((a, r) => a + (r.suggested || 0), 0) })
    return res.status(200).json({ cohorts: out })
  } catch (err) {
    await finishCronRunError(db, runId, err?.message || String(err))
    return res.status(500).json({ error: err?.message || 'failed' })
  }
}

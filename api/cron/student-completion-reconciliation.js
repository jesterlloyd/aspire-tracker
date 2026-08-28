// Daily canonical lifecycle repair.
//
// The database function owns the guarded, transactional transition so every
// consumer sees the same stored students.status. This sweep exists for the one
// input that produces no database write of its own: a school-specific rotation
// end date becoming yesterday as the calendar advances.

import { createClient } from '@supabase/supabase-js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'

const CRON_NAME = 'student-completion-reconciliation'

export default async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server configuration error' })

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const runId = await startCronRun(db, CRON_NAME)

  try {
    const { data, error } = await db.rpc('reconcile_student_completions', {
      p_cohort_id: null,
      p_student_id: null,
    })
    if (error) {
      const migrationMissing = error.code === 'PGRST202' || /reconcile_student_completions/i.test(error.message || '')
      const failure = migrationMissing
        ? new Error('Completion reconciliation migration is not applied.')
        : new Error(error.message || 'Completion reconciliation failed.')
      throw failure
    }

    const completed = Number.isFinite(Number(data)) ? Number(data) : 0
    await finishCronRunSuccess(db, runId, { completed_count: completed })
    return res.status(200).json({ success: true, completed })
  } catch (err) {
    console.error('[student-completion-reconciliation] failed:', err?.message)
    await finishCronRunError(db, runId, err?.message || 'Unknown error')
    return res.status(500).json({ error: err?.message || 'Completion reconciliation failed.' })
  }
}

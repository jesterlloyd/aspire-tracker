// api/cron/keith-knowledge-check.js
//
// KEITH-KNOWLEDGE-SELFCHECK-1 Phase 3 (Owner, 2026-09-30: "every other week"): on the 1st and the 15th
// Keith checks his own Knowledge Center, exactly as Check now does (lib/server/keith/knowledgeSelfCheck.js),
// with nobody behind it: the suggestions are credited to the Owner who reviews them and the check is
// recorded with trigger 'schedule'. Nothing goes live; every suggestion waits for the Owner, and At a
// Glance > Needs you lists what is waiting. It does nothing while the Knowledge Self-Check skill is off
// or before its migration, and it stands down when a check is already running.

import { createClient } from '@supabase/supabase-js'
import { populationDb } from '../../lib/server/demoScope.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { runKnowledgeSelfCheck } from '../../lib/server/keith/knowledgeSelfCheck.js'
import process from 'node:process'

export const CRON_NAME = 'keith-knowledge-check'
// Not a failure: the skill is off, its tables are not there yet, or a check is already running.
const STAND_DOWN = ['off', 'not_enabled', 'already_running']

export function createKnowledgeCheckCron({ makeDb, run = runKnowledgeSelfCheck, authorized = isAuthorizedCronRequest } = {}) {
  return async function handler(req, res) {
    if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
    const db = makeDb ? makeDb() : populationDb(createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))
    const runId = await startCronRun(db, CRON_NAME)
    try {
      const out = await run(db, { actor: null, trigger: 'schedule' })
      if (!out.ok && !STAND_DOWN.includes(out.reason)) throw new Error(out.reason || 'failed')
      const c = out.check
      const summary = out.ok
        ? { checked: true, changes_read: c?.changes_read || 0, questions_read: c?.questions_read || 0, suggestions: c?.suggestions || 0, drafts: c?.drafts || 0 }
        : { checked: false, reason: out.reason }
      await finishCronRunSuccess(db, runId, summary)
      return res.status(200).json(summary)
    } catch (err) {
      await finishCronRunError(db, runId, err?.message || String(err))
      return res.status(500).json({ error: err?.message || 'failed' })
    }
  }
}

export default createKnowledgeCheckCron()

// api/cron/photo-thumbs.js
//
// PHOTO-THUMBS-1: every ten minutes, give each student headshot that has no small copy one
// (lib/server/studentPhotoThumbs.js), twenty at most. This is also the one-time pass over the photos
// that existed before small copies did. Once a day (the 09:00 UTC run) it first drops any copy older
// than its original. It only ADDS small copies and removes stale ones: an original is never written,
// recompressed or deleted here. REAL students only (populationDb). With nothing to do, a run is one
// database read and one storage call.

import { createClient } from '@supabase/supabase-js'
import { populationDb } from '../../lib/server/demoScope.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { runThumbSweep } from '../../lib/server/studentPhotoThumbs.js'
import process from 'node:process'

export const CRON_NAME = 'photo-thumbs'
/** The one run a day that also checks every copy against its original. */
export const isDeepRun = (now = new Date()) => now.getUTCHours() === 9 && now.getUTCMinutes() < 10

export function createPhotoThumbsCron({ makeDb, sweep = runThumbSweep, authorized = isAuthorizedCronRequest, clock = () => new Date() } = {}) {
  return async function handler(req, res) {
    if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
    const db = makeDb ? makeDb() : populationDb(createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))
    const runId = await startCronRun(db, CRON_NAME)
    try {
      const now = clock()
      const out = await sweep(db, db.storage, { deep: isDeepRun(now), now: now.getTime() })
      await finishCronRunSuccess(db, runId, out)
      // Counts only (no names, no paths), and only when something happened or went wrong, so a quiet
      // run does not write a line every ten minutes.
      if (out.built || out.failed || out.dropped) console.log('[photo-thumbs]', JSON.stringify(out))
      return res.status(200).json(out)
    } catch (err) {
      await finishCronRunError(db, runId, err?.message || String(err))
      return res.status(500).json({ error: err?.message || 'failed' })
    }
  }
}

export default createPhotoThumbsCron()

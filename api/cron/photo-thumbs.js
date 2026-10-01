// api/cron/photo-thumbs.js
//
// PHOTO-THUMBS-1: every ten minutes, give each student headshot that has no small copy one
// (lib/server/studentPhotoThumbs.js), twenty at most. This is also the one-time pass over the photos
// that existed before small copies did. Once a day (the 09:00 UTC run) it first drops any copy older
// than its original. It only ADDS small copies and removes stale ones: an original is never written,
// recompressed or deleted here. With nothing to do, a run is two database reads and two storage calls.
//
// DEMO-THUMBS-1 (Owner, 2026-10-01): demo students get small copies too, so a demo roster is as
// fast as a real one (21 demo photos, about 480 KB each, were still loading whole). The two
// populations are swept SEPARATELY, each through its own scoped client: the real sweep reads real
// rows only (populationDb, as every cron does) and the demo sweep reads demo rows only. Nothing is
// counted, listed or sent across the two; a small copy is made beside its own original either way.

import { createClient } from '@supabase/supabase-js'
import { populationDb, scopedServiceDb } from '../../lib/server/demoScope.js'
import { startCronRun, finishCronRunSuccess, finishCronRunError } from '../lib/cronRuns.js'
import { isAuthorizedCronRequest } from '../lib/cronAuth.js'
import { runThumbSweep } from '../../lib/server/studentPhotoThumbs.js'
import process from 'node:process'

export const CRON_NAME = 'photo-thumbs'
/** The one run a day that also checks every copy against its original. */
export const isDeepRun = (now = new Date()) => now.getUTCHours() === 9 && now.getUTCMinutes() < 10

const serviceClient = () => createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const did = (o) => Boolean(o && (o.built || o.failed || o.dropped))

export function createPhotoThumbsCron({ makeDb, makeDemoDb, sweep = runThumbSweep, authorized = isAuthorizedCronRequest, clock = () => new Date() } = {}) {
  return async function handler(req, res) {
    if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
    const db = makeDb ? makeDb() : populationDb(createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))
    // A second client, scoped to demo rows. With an injected real client and no demo one (a test), the
    // demo sweep is simply not run.
    const demoDb = makeDemoDb ? makeDemoDb() : (makeDb ? null : scopedServiceDb(serviceClient(), true))
    const runId = await startCronRun(db, CRON_NAME)
    try {
      const now = clock()
      const opts = { deep: isDeepRun(now), now: now.getTime() }
      const real = await sweep(db, db.storage, opts)
      // The demo sweep never fails the run: real students' copies are the job, demo ones a courtesy.
      let demo = null
      if (demoDb) { try { demo = await sweep(demoDb, demoDb.storage, opts) } catch (e) { demo = { error: e?.message || 'failed' } } }
      const out = demo ? { ...real, demo } : real
      await finishCronRunSuccess(db, runId, out)
      // Counts only (no names, no paths), and only when something happened or went wrong, so a quiet
      // run does not write a line every ten minutes.
      if (did(real) || did(demo) || demo?.error) console.log('[photo-thumbs]', JSON.stringify(out))
      return res.status(200).json(out)
    } catch (err) {
      await finishCronRunError(db, runId, err?.message || String(err))
      return res.status(500).json({ error: err?.message || 'failed' })
    }
  }
}

export default createPhotoThumbsCron()

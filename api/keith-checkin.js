// api/keith-checkin.js
//
// KEITH-CHECKIN-1 (2026-09-29): the Action Center's view of Keith sorting check-in replies. One POST,
// an { action, ... } body with a strict per-action key allow-list, server-verified identity.
// Owner and Admin, as the Action Center's support items are (record_support_checkin_decision).
//
//   queue        { cohort_id }   ->  mode, each reply's sort, the daily line, the shadow card
//   reopen       { shift_log_id } a reply Keith closed goes back to the queue (provenance reverted)
//   undo_reopen  { shift_log_id } the Undo on that toast
//   set_mode     { mode }         Owner only: 'on' (auto-close) or 'shadow'. 'on' is refused until
//                                 14 days of shadow have passed and no reply Keith would have closed
//                                 was kept open. The switch is logged with the agreement figure.

import { verifyPortalCaller, getServiceDb, isOwnerAdminProfile } from './lib/portalAuth.js'
import { populationDb } from '../lib/server/demoScope.js'
import { queueView, reopen, undoReopen, CheckinError } from '../lib/server/keith/checkinSorting.js'
import { setSkillMode, KeithSkillError } from '../lib/server/keith/runKeithSkill.js'
import { SKILL_KEY } from '../src/lib/keith/checkinSortModel.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTION_SCHEMAS = Object.freeze({
  queue: ['action', 'cohort_id'],
  reopen: ['action', 'shift_log_id'],
  undo_reopen: ['action', 'shift_log_id'],
  set_mode: ['action', 'mode'],
})
const invalid = (res, field, message) => res.status(400).json({ error: 'invalid_request', field, message })

export function createKeithCheckinHandler({ verifyCaller = verifyPortalCaller, makeDb = getServiceDb, now } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }) }
    const caller = await verifyCaller(req)
    if (!caller.authenticated) return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })
    const profile = caller.profile
    if (!(profile?.is_owner === true || isOwnerAdminProfile(profile))) return res.status(403).json({ error: 'forbidden' })

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    const allowed = ACTION_SCHEMAS[body.action]
    if (!allowed) return invalid(res, 'action', 'Unknown action.')
    const extra = Object.keys(body).find(k => !allowed.includes(k))
    if (extra) return invalid(res, extra, 'Unexpected field.')
    if ('cohort_id' in body && !UUID.test(String(body.cohort_id || ''))) return invalid(res, 'cohort_id', 'Choose a cohort.')
    if ('shift_log_id' in body && !UUID.test(String(body.shift_log_id || ''))) return invalid(res, 'shift_log_id', 'Missing check-in.')

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }
    const t = now ? now() : Date.now()
    try {
      switch (body.action) {
        case 'queue': return res.status(200).json(await queueView(populationDb(db, req), { cohortId: body.cohort_id, now: t }))
        case 'reopen': return res.status(200).json(await reopen(db, profile, { shiftLogId: body.shift_log_id }))
        case 'undo_reopen': return res.status(200).json(await undoReopen(db, profile, { shiftLogId: body.shift_log_id }))
        case 'set_mode': {
          if (profile?.is_owner !== true) return res.status(403).json({ error: 'owner_required', message: 'Only the Owner turns auto-close on or off.' })
          if (!['on', 'shadow'].includes(body.mode)) return invalid(res, 'mode', 'Choose on or shadow.')
          return res.status(200).json(await setSkillMode(db, SKILL_KEY, body.mode, profile))
        }
      }
    } catch (e) {
      if (e instanceof CheckinError || e instanceof KeithSkillError) return res.status(e.status || 409).json({ error: e.code || e.reason, message: e.message })
      console.warn('[keith-checkin] failed', { action: body.action, reason: e?.message })
      return res.status(500).json({ error: 'failed' })
    }
    return invalid(res, 'action', 'Unknown action.')
  }
}

export default createKeithCheckinHandler()

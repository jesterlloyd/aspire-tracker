// api/keith-placement.js
//
// KEITH-PLACEMENT-1 (2026-09-29): the Placement Board's view of Keith's suggestions. One POST, an
// { action, ... } body with a strict per-action key allow-list, server-verified identity. The
// board's placement roles (placement_manage: Owner, Admin, Co-Lead); the mode switch is the Owner's.
//
//   board        { cohort_id }       suggestions (ON only), accepted marks, the shadow comparison
//   suggest_all  { cohort_id }       run the suggestions now (skill ON)
//   accept       { suggestion_id }   every rule re-checked here; the board then places it
//   undo_accept  { suggestion_id }   after the board has taken the placement back
//   reject       { suggestion_id }   the pairing is not suggested again this cohort
//   set_mode     { mode }            Owner: 'on' shows suggestions, 'shadow' computes them quietly

import { verifyPortalCaller, getServiceDb } from './lib/portalAuth.js'
import { can } from '../lib/server/access.js'
import { populationDb } from '../lib/server/demoScope.js'
import { boardView, runSuggestions, accept, undoAccept, reject, PlacementSuggestionError, SKILL_KEY } from '../lib/server/placement/placementSuggestions.js'
import { setSkillMode, KeithSkillError } from '../lib/server/keith/runKeithSkill.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTION_SCHEMAS = Object.freeze({
  board: ['action', 'cohort_id'],
  suggest_all: ['action', 'cohort_id'],
  accept: ['action', 'suggestion_id'],
  undo_accept: ['action', 'suggestion_id'],
  reject: ['action', 'suggestion_id'],
  set_mode: ['action', 'mode'],
})
const invalid = (res, field, message) => res.status(400).json({ error: 'invalid_request', field, message })

export function createKeithPlacementHandler({ verifyCaller = verifyPortalCaller, makeDb = getServiceDb, complete } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }) }
    const caller = await verifyCaller(req)
    if (!caller.authenticated) return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })
    const profile = caller.profile
    if (!can(profile, 'placement_manage')) return res.status(403).json({ error: 'forbidden' })

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    const allowed = ACTION_SCHEMAS[body.action]
    if (!allowed) return invalid(res, 'action', 'Unknown action.')
    const extra = Object.keys(body).find(k => !allowed.includes(k))
    if (extra) return invalid(res, extra, 'Unexpected field.')
    if ('cohort_id' in body && !UUID.test(String(body.cohort_id || ''))) return invalid(res, 'cohort_id', 'Choose a cohort.')
    if ('suggestion_id' in body && !UUID.test(String(body.suggestion_id || ''))) return invalid(res, 'suggestion_id', 'Missing suggestion.')

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }
    try {
      switch (body.action) {
        case 'board': return res.status(200).json(await boardView(populationDb(db, req), { cohortId: body.cohort_id }))
        case 'suggest_all': return res.status(200).json(await runSuggestions(populationDb(db, req), { cohortId: body.cohort_id, actor: profile, source: 'manual', ...(complete ? { complete } : {}) }))
        case 'accept': return res.status(200).json(await accept(db, profile, { suggestionId: body.suggestion_id }))
        case 'undo_accept': return res.status(200).json(await undoAccept(db, profile, { suggestionId: body.suggestion_id }))
        case 'reject': return res.status(200).json(await reject(db, profile, { suggestionId: body.suggestion_id }))
        case 'set_mode': {
          if (profile?.is_owner !== true) return res.status(403).json({ error: 'owner_required', message: 'Only the Owner turns suggestions on or off.' })
          if (!['on', 'shadow'].includes(body.mode)) return invalid(res, 'mode', 'Choose on or shadow.')
          return res.status(200).json(await setSkillMode(db, SKILL_KEY, body.mode, profile))
        }
      }
    } catch (e) {
      if (e instanceof PlacementSuggestionError || e instanceof KeithSkillError) return res.status(e.status || 409).json({ error: e.code || e.reason, message: e.message })
      console.warn('[keith-placement] failed', { action: body.action, reason: e?.message })
      return res.status(500).json({ error: 'failed' })
    }
    return invalid(res, 'action', 'Unknown action.')
  }
}

export default createKeithPlacementHandler()

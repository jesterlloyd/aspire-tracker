// api/keith-provenance.js
//
// KEITH-FOUNDATION-1 (2026-09-28): the read path for the Keith mark. One POST, an { action, ... }
// body with a strict per-action key allow-list, server-verified identity.
//
//   cards      { ids: [provenance id, ...] }  ->  { records: { id: card } }
//              Only records the caller may see come back (lib/server/keith/provenanceCards.js);
//              the rest are absent and their marks draw nothing. Portal users get nothing, ever.
//   agreement  { skill }  ->  shadow mode agreement for one Skill. Owner and Admin.
//
// keith_provenance is deny-all at the RLS layer (no policy, no authenticated grant); this endpoint
// reads it with the service role.

import { verifyPortalCaller, getServiceDb } from './lib/portalAuth.js'
import { can } from '../lib/server/access.js'
import { provenanceCards, MAX_IDS } from '../lib/server/keith/provenanceCards.js'
import { shadowAgreement } from '../lib/server/keith/runKeithSkill.js'

const ACTION_SCHEMAS = Object.freeze({
  cards: ['action', 'ids'],
  agreement: ['action', 'skill'],
})

const invalid = (res, field, message) => res.status(400).json({ error: 'invalid_request', field, message })

export function createKeithProvenanceHandler({ verifyCaller = verifyPortalCaller, makeDb = getServiceDb } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }) }

    const caller = await verifyCaller(req)
    if (!caller.authenticated) return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    const allowed = ACTION_SCHEMAS[body.action]
    if (!allowed) return invalid(res, 'action', 'Unknown action.')
    const extra = Object.keys(body).find(k => !allowed.includes(k))
    if (extra) return invalid(res, extra, 'Unexpected field.')

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }

    try {
      if (body.action === 'cards') {
        if (!Array.isArray(body.ids) || body.ids.length > MAX_IDS) return invalid(res, 'ids', `Send up to ${MAX_IDS} ids.`)
        return res.status(200).json({ records: await provenanceCards(db, caller.profile, body.ids) })
      }
      if (body.action === 'agreement') {
        if (!(caller.profile?.is_owner === true || can(caller.profile, 'keith_chat') && String(caller.profile?.role || '').toLowerCase() === 'admin')) {
          return res.status(403).json({ error: 'forbidden' })
        }
        if (typeof body.skill !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,80}$/.test(body.skill)) return invalid(res, 'skill', 'Name a skill.')
        return res.status(200).json({ agreement: await shadowAgreement(db, body.skill) })
      }
    } catch (err) {
      console.warn('[keith-provenance] failed', { action: body.action, reason: err?.message })
      return res.status(500).json({ error: 'failed' })
    }
    return invalid(res, 'action', 'Unknown action.')
  }
}

export default createKeithProvenanceHandler()

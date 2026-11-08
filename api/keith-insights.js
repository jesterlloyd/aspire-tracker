// api/keith-insights.js
//
// INSIGHTS-KEITH-READ-1 (Owner, 2026-11-07): Keith's Read on ASPIRE Insights (/insights, staff app).
// One POST, { action, filters }, strict keys, server-verified identity.
//
//   latest { filters }   the latest read for these filters, or the latest of any; who may see it is
//                        insights_view (Owner, Admin, Co-Lead)
//   run    { filters }   a new read: the figures are recomputed HERE from the filters, never taken
//                        from the browser; who may run it is the Skill's own roles (Owner, Admin)
//
// One population per request (DEMO-DATA-2): a demo session reads and writes demo reads only.

import { verifyPortalCaller, getServiceDb } from './lib/portalAuth.js'
import { can } from '../lib/server/access.js'
import { populationDb, populationOf } from '../lib/server/demoScope.js'
import { latest, run, KeithReadError } from '../lib/server/insights/keithRead.js'
import { FILTER_KEYS } from '../src/lib/insights/insightsView.js'

const ACTIONS = Object.freeze({ latest: ['action', 'filters'], run: ['action', 'filters'] })
const invalid = (res, field, message) => res.status(400).json({ error: 'invalid_request', field, message })

/** Only the page's own filter names, as short strings. */
function cleanFilters(input) {
  if (input == null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) return null
  const out = {}
  for (const [k, v] of Object.entries(input)) {
    if (!FILTER_KEYS.includes(k)) return null
    if (v == null || v === '') continue
    if (typeof v !== 'string' || v.length > 120) return null
    out[k] = v
  }
  return out
}

export function createKeithInsightsHandler({ verifyCaller = verifyPortalCaller, makeDb = getServiceDb, complete, load } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }) }
    const caller = await verifyCaller(req)
    if (!caller?.authenticated) return res.status(caller?.status || 401).json({ error: caller?.reason || 'unauthenticated' })
    const profile = caller.profile
    if (!can(profile, 'insights_view')) return res.status(403).json({ error: 'insights_role_required' })

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    const allowed = ACTIONS[body.action]
    if (!allowed) return invalid(res, 'action', 'Unknown action.')
    const extra = Object.keys(body).find(k => !allowed.includes(k))
    if (extra) return invalid(res, extra, 'Unexpected field.')
    const filters = cleanFilters(body.filters)
    if (!filters) return invalid(res, 'filters', 'Unknown filter.')

    let db
    try { db = makeDb() } catch { return res.status(500).json({ error: 'server_misconfigured' }) }
    const population = populationOf(req)
    const dbFor = () => populationDb(makeDb(), req)
    const args = { filters, population, dbFor, actor: profile, ...(load ? { load } : {}) }
    try {
      if (body.action === 'latest') return res.status(200).json(await latest(db, args))
      return res.status(200).json(await run(db, { ...args, ...(complete ? { complete } : {}) }))
    } catch (e) {
      if (e instanceof KeithReadError) return res.status(e.status || 409).json({ error: e.code, message: e.message })
      console.warn('[keith-insights] failed', { action: body.action, reason: e?.message })
      return res.status(500).json({ error: 'failed' })
    }
  }
}

export default createKeithInsightsHandler()

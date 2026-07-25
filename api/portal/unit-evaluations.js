// api/portal/unit-evaluations.js
//
// UL-EVAL-API: the Unit Leader evaluations read surface. GET only.
//
// AUTHORIZATION. verifyPortalUnitLeaderCaller confirms an active unit_leader grant and
// resolves the caller's active unit scopes (service-role JS check, the same source of truth
// every Unit Leader endpoint uses). The DATA, however, is fetched with a client scoped to
// the caller's JWT (getUserScopedDb), because ul_eval_dashboard_summary / ul_eval_response_list
// are SECURITY DEFINER functions that resolve auth.uid() internally (active role grant +
// my_unit_scope_keys). We NEVER call them with the service-role client and NEVER pass an
// actor id: the database re-derives scope from the token.
//
// SCOPE NARROWS, NEVER WIDENS. instrument must be one of the two approved slugs; unit_key is
// intersected server-side with the caller's scopes by the RPC. All Assigned Units = no
// unit_key.
//
// OUTPUT IS ALLOWLISTED AND ASSERTED. The response is built from only safe keys and passed
// through assertUnitLeaderShape before it is sent; a shape failure returns 500 rather than
// risk leaking a field. No id, identity, timestamp, free text, raw JSON, or stable token.
//
// CACHING. no-store, private: role-scoped evaluation data is never shared-cached.

import { verifyPortalUnitLeaderCaller } from '../lib/unitLeaderScope.js'
import { getUserScopedDb } from '../lib/messagesAuth.js'
import { validateUnitEvalQuery } from '../../lib/server/unitEvaluations/validation.js'
import {
  serializeUnitLeaderEvaluations,
  assertUnitLeaderShape,
} from '../../lib/server/unitEvaluations/serialize.js'

function emptyPayload({ instrument, timepoint, unitKey }) {
  return {
    instrument_slug: instrument,
    timepoint: timepoint || null,
    unit_key: unitKey || null,
    released_response_count: 0,
    quantitative_averages: {},
    responses: [],
  }
}

export function createUnitEvaluationsHandler({
  verifyCaller = verifyPortalUnitLeaderCaller,
  makeUserDb = getUserScopedDb,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'method_not_allowed' })
    }

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

    const v = validateUnitEvalQuery(req.query)
    if (!v.ok) return res.status(v.status).json({ error: v.error })
    const { instrument, timepoint, unitKey } = v.value

    // A Unit Leader with no active unit scope sees nothing — a permission fact, not an error.
    if (!Array.isArray(auth.scopes) || auth.scopes.length === 0) {
      return res.status(200).json(emptyPayload(v.value))
    }

    const userDb = makeUserDb(req)
    if (!userDb) return res.status(401).json({ error: 'unauthenticated' })

    let summary, list
    try {
      const [sRes, lRes] = await Promise.all([
        userDb.rpc('ul_eval_dashboard_summary', {
          p_instrument_slug: instrument, p_timepoint: timepoint, p_unit_key: unitKey,
        }),
        userDb.rpc('ul_eval_response_list', {
          p_instrument_slug: instrument, p_timepoint: timepoint, p_unit_key: unitKey,
        }),
      ])
      if (sRes.error || lRes.error) return res.status(500).json({ error: 'internal_error' })
      summary = sRes.data
      list = lRes.data
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }

    let payload
    try {
      payload = assertUnitLeaderShape(
        serializeUnitLeaderEvaluations({ instrument, timepoint, unitKey, summary, list }),
      )
    } catch {
      // Fail closed: never send an unshaped/possibly-leaky payload.
      return res.status(500).json({ error: 'serialization_failed' })
    }
    return res.status(200).json(payload)
  }
}

export default createUnitEvaluationsHandler()

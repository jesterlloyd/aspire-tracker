// api/evaluation-unit-release-action.js
//
// STAFF (Owner/Admin) lifecycle actions for the Unit Leader evaluation release gate. POST.
//
// AUTHORIZATION IS THE DATABASE'S. The action calls one of the SECURITY DEFINER lifecycle
// RPCs (ul_eval_moderate/release/revoke/rerelease_response), which gate on
// is_active_owner_or_admin() via auth.uid(). We MUST call them with the caller's JWT client
// (getUserScopedDb) — never the service-role client, never a passed actor id. The endpoint
// ALSO verifies Owner/Admin for a clean 403 and to refuse before touching the database.
//
// Every RPC status is mapped explicitly to an HTTP code; nothing falls through to an opaque
// 500. The RPC's own refusal reason (not_yet_eligible, snapshot_incomplete, ...) is passed
// through verbatim so the staff UI can show the exact reason.

import { verifyOwnerAdminCaller } from './lib/portalAuth.js'
import { getUserScopedDb } from './lib/messagesAuth.js'
import { LIFECYCLE_ACTIONS, RPC_STATUS } from '../lib/server/unitEvaluations/config.js'
import { validateLifecycleAction } from '../lib/server/unitEvaluations/validation.js'

export function createReleaseActionHandler({
  verifyCaller = verifyOwnerAdminCaller,
  makeUserDb = getUserScopedDb,
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'method_not_allowed' })
    }

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const v = validateLifecycleAction(body)
    if (!v.ok) return res.status(v.status).json({ error: v.error, field: v.field })
    const { action, responseId, decision } = v.value

    const db = makeUserDb(req)
    if (!db) return res.status(401).json({ error: 'unauthenticated' })

    const rpcName = LIFECYCLE_ACTIONS[action]
    const params = action === 'moderate'
      ? { p_response_id: responseId, p_decision: decision }
      : { p_response_id: responseId }

    let data, error
    try {
      ({ data, error } = await db.rpc(rpcName, params))
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
    if (error) return res.status(500).json({ error: 'internal_error' })

    const status = data && typeof data === 'object' ? data.status : null
    const mapped = status ? RPC_STATUS[status] : null
    if (!mapped) return res.status(500).json({ error: 'unknown_rpc_status', status: status || null })

    // Pass through only the RPC's own safe status fields (no identity is ever present here).
    const out = { status, ok: mapped.ok }
    if (data.moderation_state) out.moderation_state = data.moderation_state
    if (data.release_state) out.release_state = data.release_state
    if (data.eligible_at) out.eligible_at = data.eligible_at
    return res.status(mapped.http).json(out)
  }
}

export default createReleaseActionHandler()

// api/portal/unit-preceptor-manage.js
//
// PHASE 2C: the Unit Leader preceptor-assignment endpoint.
//
// Unit Leaders NEVER get a direct table write. This endpoint verifies the portal caller,
// resolves their profile, and calls a scoped SECURITY DEFINER RPC with the SERVICE-ROLE
// client, passing the actor profile id. The RPC re-derives authorization from that id (active
// unit_leader grant + active unit scope), so the API cannot widen scope by passing an
// arbitrary id, and writes the audit + Owner/Admin notification in one transaction. This
// mirrors api/portal/unit-placement-requests.js exactly.
//
// Actions (POST body { action, ... }):
//   change_primary   { student_id, preceptor_id, reason? }
//   set_secondary    { student_id, role: secondary|coverage, op: add|replace|end,
//                      preceptor_id?, assignment_id?, reason?, notes? }
//   create_preceptor { full_name, email, unit_key, shift, phone? }

import { verifyPortalUnitLeaderCaller } from '../lib/unitLeaderScope.js'
import { mapRpcStatus, mapRpcError } from '../lib/unitLeaderRpcErrors.js'

const rid = () => `req_${Math.random().toString(36).slice(2, 10)}`

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyPortalUnitLeaderCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
  const { db, profile } = auth

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : ''
  const requestId = rid()

  let rpc, args
  if (action === 'change_primary') {
    rpc = 'assign_primary_preceptor'
    args = {
      p_actor_profile_id: profile.id,
      p_student_id: body.student_id,
      p_preceptor_id: body.preceptor_id,
      p_reason: body.reason || null,
      // A Unit Leader can never override the 90-day window; the RPC denies it even if these are
      // set. They are forwarded only so the contract is uniform with the owner/admin path.
      p_force: body.force === true,
      p_confirm_override: body.confirm_override === true,
      p_request_id: requestId,
    }
  } else if (action === 'set_secondary') {
    rpc = 'set_secondary_coverage_preceptor'
    args = {
      p_actor_profile_id: profile.id,
      p_student_id: body.student_id,
      p_role: body.role,
      p_action: body.op,
      p_preceptor_id: body.preceptor_id || null,
      p_assignment_id: body.assignment_id || null,
      p_reason: body.reason || null,
      p_notes: body.notes || null,
      p_force: body.force === true,
      p_confirm_override: body.confirm_override === true,
      p_request_id: requestId,
    }
  } else if (action === 'create_preceptor') {
    rpc = 'create_unit_preceptor'
    args = {
      p_actor_profile_id: profile.id,
      p_full_name: body.full_name,
      p_email: body.email,
      p_unit_key: body.unit_key,
      p_shift: body.shift,
      p_phone: body.phone || null,
      p_request_id: requestId,
    }
  } else {
    return res.status(400).json({ error: 'unknown_action' })
  }

  const { data, error } = await db.rpc(rpc, args)
  if (error) {
    console.log('[unit-preceptor-manage] rpc error', { request_id: requestId, action, code: error.code })
    return res.status(mapRpcStatus(error)).json({ error: mapRpcError(error) })
  }
  return res.status(200).json({ result: data })
}

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
// Actions (POST body { request_id, action, ... }):
//   change_primary   { student_id, preceptor_id, reason? }
//   set_secondary    { student_id, role: secondary|coverage, op: add|replace|end,
//                      preceptor_id?, assignment_id?, reason?, notes? }
//   create_preceptor { full_name, email, unit_key, shift, phone?, role?, photo? }
//
// UL-PRECEPTOR-TITLE-PHOTO-1: create_preceptor also accepts the preceptor's
// Role/Title and a photo ({ content_type, data_base64 }). Both are validated
// BEFORE the RPC, and saved onto the ASPIRE Connect contact only AFTER the
// scoped create succeeds (api/lib/unitPreceptorContactSync.js). The contact
// save is non-blocking; its outcome is returned as contact_sync.

import { verifyPortalUnitLeaderCaller } from '../lib/unitLeaderScope.js'
import { mapRpcStatus, mapRpcError } from '../lib/unitLeaderRpcErrors.js'
import { readPreceptorTitle, readPreceptorPhoto, syncUnitPreceptorContact } from '../lib/unitPreceptorContactSync.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await verifyPortalUnitLeaderCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
  const { db, profile } = auth

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : ''
  const requestId = typeof body.request_id === 'string' ? body.request_id.trim() : ''
  if (!requestId) return res.status(400).json({ error: 'request_id_required' })

  let rpc, args
  let contactFields = null
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
    const title = readPreceptorTitle(body.role)
    if (!title.ok) return res.status(title.status).json({ error: title.error })
    const photo = readPreceptorPhoto(body.photo)
    if (!photo.ok) return res.status(photo.status).json({ error: photo.error })
    contactFields = { role: title.role, photo: photo.photo }
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
  // The contact save runs only once the scoped create has succeeded, keyed on
  // the preceptor id the RPC returned. It never fails the create.
  if (contactFields && data?.preceptor_id) {
    const sync = await syncUnitPreceptorContact(db, { preceptorId: data.preceptor_id, ...contactFields })
    if (sync.status === 'error') console.log('[unit-preceptor-manage] contact sync failed', { request_id: requestId })
    return res.status(200).json({ result: data, contact_sync: sync.status })
  }
  return res.status(200).json({ result: data })
}

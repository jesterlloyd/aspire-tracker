// api/lib/ngrpAuth.js
//
// NGRP-WORKSPACE-1 (correction): server-side NGRP caller verification.
//
// Builds on verifyPortalCaller (JWT verification, profile resolution, and the
// S-05 inactive refusal) and then applies the SAME canonical capability the
// client checks: lib/server/access.js `can(profile, 'ngrp_access')` - Owner
// capability via is_owner, or normalized Admin / Co-Lead (both persisted
// spellings). Interviewer, Viewer, portal roles, and anonymous callers are
// refused. There is deliberately no second role array here: the table in
// lib/server/access.js is the single definition, so UI and server can never
// disagree about who may enter NGRP.
//
// verifyStaffCaller (owner/admin only) is intentionally NOT reused: it
// excludes Co-Lead and does not honor the is_owner capability rule.
import { verifyPortalCaller } from './portalAuth.js'
import { can } from '../../lib/server/access.js'

// Returns { ok: true, profile } or { ok: false, status, reason }.
export async function verifyNgrpCaller(req) {
  const caller = await verifyPortalCaller(req)
  if (!caller.authenticated) {
    return { ok: false, status: caller.status || 401, reason: caller.reason || 'unauthenticated' }
  }
  if (!can(caller.profile, 'ngrp_access')) {
    return { ok: false, status: 403, reason: 'ngrp_role_required' }
  }
  return { ok: true, profile: caller.profile }
}

// api/lib/ngrpAuth.js
//
// NGRP-WORKSPACE-1 (correction): server-side NGRP caller verification.
//
// Builds on verifyPortalCaller (JWT verification, profile resolution, and the
// S-05 inactive refusal) and then applies the SAME canonical capability the
// client checks: lib/server/access.js `can(profile, 'ngrp_access')` - Owner
// capability via is_owner, or normalized Admin / Co-Lead (both persisted
// spellings). Interviewer, Viewer, and anonymous callers are refused; a portal
// user is refused unless they hold an ACTIVE talent_acquisition grant
// (RESIDENCY-PORTAL-2). There is deliberately no second role array here: the table in
// lib/server/access.js is the single definition, so UI and server can never
// disagree about who may enter NGRP.
//
// verifyStaffCaller (owner/admin only) is intentionally NOT reused: it
// excludes Co-Lead and does not honor the is_owner capability rule.
import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant } from './portalAuth.js'
import { can } from '../../lib/server/access.js'
import { TALENT_ACQUISITION } from '../../lib/server/ngrpTalentAcquisition.js'

// Returns { ok: true, profile, audience } or { ok: false, status, reason }.
// audience is 'staff' for the ASPIRE team, or 'talent_acquisition' for the
// Residency Portal: Talent Acquisition co-owns the residency workspace (Owner),
// so an ACTIVE grant passes both the read check and the manage check, and each
// endpoint narrows what that audience sees. Pass { manage: true } for the
// management endpoint's ngrp_manage capability.
export async function verifyNgrpCaller(req, { manage = false } = {}) {
  const caller = await verifyPortalCaller(req)
  if (!caller.authenticated) {
    return { ok: false, status: caller.status || 401, reason: caller.reason || 'unauthenticated' }
  }
  const staff = manage ? can(caller.profile, 'ngrp_manage') : can(caller.profile, 'ngrp_access')
  if (staff) return { ok: true, profile: caller.profile, audience: 'staff' }
  // hasActiveRoleGrant fails closed: a lookup error reads as no grant.
  if (await hasActiveRoleGrant(getServiceDb(), caller.profile.id, TALENT_ACQUISITION)) {
    return { ok: true, profile: caller.profile, audience: TALENT_ACQUISITION }
  }
  // A portal user whose grant has ended gets the reason the portal treats as
  // "access ended"; everyone else keeps the staff wording.
  return {
    ok: false, status: 403,
    reason: caller.profile.role === 'portal' ? 'talent_acquisition_role_required' : 'ngrp_role_required',
  }
}

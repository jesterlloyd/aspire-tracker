// api/lib/nursingAcademicScope.js
//
// NURSING-ACADEMICS-1: the single server-side authorization check for the
// Nursing Academics portal (BNI nursing academics and leadership).
//
// The role is ORGANIZATION-WIDE and VIEW-ONLY by design: an active
// nursing_academic grant authorizes the aggregate/report read surface with no
// school, unit, or student scope rows. There is deliberately no scope
// resolver here; the endpoints this guard protects expose only allowlisted,
// reporting-shaped data and no write path of any kind.
//
// Authorization chain, fail closed at every link:
//   1. verified JWT              -> user_profiles row (active only, S-05)
//   2. ACTIVE user_role_grants 'nursing_academic' -> otherwise 403
//
// Authority never comes from client state, request parameters, emails, or
// names: the grant row is re-read on every request, so revocation and
// expiration take effect on the very next call.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant } from './portalAuth.js'

export { getServiceDb }

/**
 * Verify the caller holds an ACTIVE nursing_academic grant.
 * Returns { ok: true, db, profile } or { ok: false, status, reason }.
 */
export async function verifyPortalNursingAcademicCaller(req) {
  const caller = await verifyPortalCaller(req)
  if (!caller.authenticated) {
    return { ok: false, status: caller.status || 401, reason: caller.reason || 'unauthenticated' }
  }

  let db
  try { db = getServiceDb() } catch { return { ok: false, status: 500, reason: 'server_misconfigured' } }

  let isNursingAcademic
  try {
    isNursingAcademic = await hasActiveRoleGrant(db, caller.profile.id, 'nursing_academic')
  } catch {
    return { ok: false, status: 500, reason: 'grant_lookup_failed' }
  }
  if (!isNursingAcademic) return { ok: false, status: 403, reason: 'nursing_academic_role_required' }

  return { ok: true, db, profile: caller.profile }
}

// api/lib/nursingAcademicScope.js
//
// NURSING-ACADEMICS-1: the single server-side authorization check for the
// Nursing Academics portal (BNI nursing academics and leadership).
//
// The role is ORGANIZATION-WIDE. Reporting surfaces remain view-only. A grant
// may separately carry contacts_access='manage', which authorizes only the
// allowlisted Contacts create/update/status endpoint. It never widens access
// to reporting inputs, school/program data, outreach, messaging, or deletion.
//
// Authorization chain, fail closed at every link:
//   1. verified JWT              -> user_profiles row (active only, S-05)
//   2. ACTIVE user_role_grants 'nursing_academic' -> otherwise 403
//
// Authority never comes from client state, request parameters, emails, or
// names: the grant row is re-read on every request, so revocation and
// expiration take effect on the very next call.

import { verifyPortalCaller, getServiceDb, getActiveRoleGrant, isOwnerAdminProfile } from './portalAuth.js'
import { serviceDbForRequest } from '../../lib/server/demoScope.js'

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

  // DEMO-MODE-2: the boundary for this whole preview, applied once to the client every
  // endpoint below shares. A demo presentation must not show a real student, and real
  // work must not show a fabricated one; when the request carries no scope at all the
  // client is returned untouched and nothing here behaves differently than it did
  // before demo mode existed. See lib/server/demoScope.js.
  let db
  try { db = serviceDbForRequest(getServiceDb(), req) } catch { return { ok: false, status: 500, reason: 'server_misconfigured' } }

  // Owner/Admin may open this organization-wide portal with their existing
  // staff identity. Contacts management remains attributable to that profile.
  if (isOwnerAdminProfile(caller.profile)) {
    return {
      ok: true,
      db,
      profile: caller.profile,
      grant: null,
      contactsAccess: 'manage',
      canManageContacts: true,
      staffPreview: true,
    }
  }

  let grant
  try {
    grant = await getActiveRoleGrant(db, caller.profile.id, 'nursing_academic')
  } catch {
    return { ok: false, status: 500, reason: 'grant_lookup_failed' }
  }
  if (!grant) return { ok: false, status: 403, reason: 'nursing_academic_role_required' }

  const contactsAccess = grant.contacts_access === 'manage' ? 'manage' : 'view'
  return {
    ok: true,
    db,
    profile: caller.profile,
    grant,
    contactsAccess,
    canManageContacts: contactsAccess === 'manage',
  }
}

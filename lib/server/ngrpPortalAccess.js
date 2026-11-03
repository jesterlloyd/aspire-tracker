// lib/server/ngrpPortalAccess.js
//
// TRANSITION-PORTAL-1 (Owner, 2026-11-02): every Transition Form send also opens the alumnus's
// Student Portal, so the form can be opened under their own sign-in instead of an emailed code.
// Jorge Velasco was locked out on the deadline day by the code; a portal sign-in has no code and
// no lockout. Reached only from the send endpoint, and only when the email is really going out
// (buildEmail runs right before the provider call), so a replayed batch mints nothing.
//
// What it does, and does not:
//   - Reactivates an EXPIRED student grant or creates one, through provision_portal_access, the
//     same transaction api/invite-portal-user.js uses. Access runs through the last day of the
//     residency start month (portalAccessEnd). A grant that already runs longer, or has no end,
//     is never shortened.
//   - Reuses the account the student is already linked to. A student whose link the ASPIRE team
//     REVOKED is left alone: a revoke is a decision, an expiry is not.
//   - Mints an activation link only when the account has never set a password, the same
//     scanner-safe /auth/activate hash URL as the portal invitation.
//   - Never fails the form send. Anything that goes wrong is a warning; the form link still works.
import { appUrl } from './appUrl.js'
import { pacificEndOfDay } from './ngrpTransition.js'

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// The last day of the residency start month, end of day Pacific. A cohort with no start date
// has no end to promise, so no access is granted from the send.
export function portalAccessEnd(cycle) {
  const start = cycle?.residency_start_date
  if (!isDate(start)) return null
  const [y, m] = start.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return pacificEndOfDay(`${start.slice(0, 7)}-${String(last).padStart(2, '0')}`)
}

// Keep the later of the two windows. null means no end, which is the longest of all.
export function laterExpiry(current, wanted) {
  if (current === null) return null
  if (!current) return wanted
  return new Date(current).getTime() >= new Date(wanted).getTime() ? current : wanted
}

function activationUrl(hashedToken, type) {
  if (!hashedToken) return null
  return `${appUrl('/auth/activate')}?token_hash=${encodeURIComponent(hashedToken)}&type=${encodeURIComponent(type)}`
}

async function recoveryLink(db, email) {
  const { data, error } = await db.auth.admin.generateLink({
    type: 'recovery', email, options: { redirectTo: appUrl('/auth/activate') },
  })
  return error ? null : activationUrl(data?.properties?.hashed_token, 'recovery')
}

async function neverActivated(db, authUserId) {
  try {
    const { data } = await db.auth.admin.getUserById(authUserId)
    return data?.user?.user_metadata?.password_set !== true
  } catch {
    // Unknown: a reset email to someone with a password is harmless; no link is a lockout.
    return true
  }
}

/**
 * @returns {Promise<{ ok: true, signInEmail, accessEndsAt, activationLink, grantAction }
 *                  | { ok: false, reason }>}
 */
export async function ensureStudentPortalAccess(db, { student, email, fullName, cycle, actorProfileId = null }) {
  const wanted = portalAccessEnd(cycle)
  if (!wanted) return { ok: false, reason: 'portal_access_no_start_date' }
  if (!student?.id) return { ok: false, reason: 'portal_access_failed' }

  // 1. The account this student is linked to, if any.
  const links = await db.from('user_student_links')
    .select('user_profile_id, revoked_at, linked_at').eq('student_id', student.id)
  if (links.error) return { ok: false, reason: 'portal_access_failed' }
  const live = (links.data || []).find(l => l.revoked_at === null)
  if (!live && (links.data || []).length) return { ok: false, reason: 'portal_access_revoked' }

  let profile
  if (live) {
    const p = await db.from('user_profiles').select('id, auth_user_id, email, full_name')
      .eq('id', live.user_profile_id).maybeSingle()
    if (p.error || !p.data?.auth_user_id || !p.data.email) return { ok: false, reason: 'portal_access_failed' }
    profile = p.data
  } else {
    if (!email) return { ok: false, reason: 'portal_access_no_email' }
    const p = await db.from('user_profiles').select('id, auth_user_id, email, full_name')
      .eq('email', email).maybeSingle()
    if (p.error) return { ok: false, reason: 'portal_access_failed' }
    profile = p.data || null
  }

  // 2. Never shorten a grant that already runs longer.
  let expiresAt = wanted
  if (profile?.id) {
    const g = await db.from('user_role_grants').select('expires_at')
      .eq('user_profile_id', profile.id).eq('role', 'student').is('revoked_at', null).maybeSingle()
    if (g.error) return { ok: false, reason: 'portal_access_failed' }
    if (g.data && (g.data.expires_at === null || new Date(g.data.expires_at) > new Date())) {
      expiresAt = laterExpiry(g.data.expires_at, wanted)
    }
  }

  // 3. The auth user: reuse, or create with an invite link.
  const signInEmail = profile?.email || email
  let authUserId = profile?.auth_user_id || null
  let created = false
  let activationLink = null
  try {
    if (authUserId) {
      if (await neverActivated(db, authUserId)) activationLink = await recoveryLink(db, signInEmail)
    } else {
      const { data, error } = await db.auth.admin.generateLink({
        type: 'invite', email: signInEmail,
        options: { data: { full_name: fullName, role: 'portal', portal_role: 'student' }, redirectTo: appUrl('/auth/activate') },
      })
      if (error) return { ok: false, reason: /already|registered|exists/i.test(error.message || '') ? 'portal_access_unlinked_account' : 'portal_access_failed' }
      authUserId = data.user.id
      activationLink = activationUrl(data.properties?.hashed_token, 'invite')
      created = true
    }
  } catch {
    return { ok: false, reason: 'portal_access_failed' }
  }

  // 4. One transaction: profile, grant (created, renewed or reused) and the student link.
  const { data: result, error: rpcErr } = await db.rpc('provision_portal_access', {
    p_auth_user_id: authUserId, p_email: signInEmail, p_full_name: fullName || signInEmail,
    p_role: 'student', p_granted_by: actorProfileId, p_expires_at: expiresAt,
    p_student_id: student.id, p_unit_keys: null, p_school_keys: null, p_cohort_id: null,
  })
  if (rpcErr) {
    // Undo only an auth user this call created.
    if (created) { try { await db.auth.admin.deleteUser(authUserId) } catch { /* reported below */ } }
    return { ok: false, reason: rpcErr.code === 'PT409' ? 'portal_access_conflict' : 'portal_access_failed' }
  }
  return {
    ok: true, signInEmail, activationLink,
    accessEndsAt: result?.grant?.expires_at ?? expiresAt,
    grantAction: result?.grant?.action || null,
  }
}

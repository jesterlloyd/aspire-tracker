// api/lib/accountSession.js
//
// S-05: make deactivation reach Supabase Auth, not only the profile row.
//
// Setting user_profiles.is_active = false changes what the application will do
// for an account. It does not change anything about the account's existing
// Supabase session: the access token stays valid until it expires, and the
// refresh token keeps minting new ones indefinitely. Deactivation is normally
// used because someone has left or should no longer hold authority, so "ends
// when the token happens to expire" is the wrong behaviour.
//
// MECHANISM. Supabase exposes no server-side "sign this user out" call that
// works from a user id: auth.admin.signOut() needs the user's own JWT, which a
// staff member revoking someone else's access does not have. Banning does work
// from a user id, and it closes both remaining doors: the account cannot refresh
// its token and cannot sign in again. The ban is set far enough out to be
// permanent in practice and is lifted on reactivation.
//
// WHAT ACTUALLY ENFORCES THE BOUNDARY. The per-request active checks on the
// endpoints are the authoritative gate, and they hold whether or not the calls
// below succeed: every JWT-verified endpoint re-reads is_active from the profile
// on each request. This module is what stops the account from continuing to hold
// a renewable session. That is why a failure here is reported and logged but
// never rolls back the profile change: the profile change is the part that
// already secures the account.

// About 100 years. Supabase has no "forever" literal; a duration this long is
// the documented way to express a permanent ban, and it is fully reversible.
export const PERMANENT_BAN_DURATION = '876000h'

// Lift an existing ban. Supabase treats the string 'none' as "not banned".
export const NO_BAN = 'none'

async function setBan(admin, authUserId, banDuration, action) {
  if (!authUserId) {
    // A profile with no auth identity has no session to end. Not a failure:
    // portal-only and pre-created profiles legitimately reach this state.
    return { ok: true, skipped: true, reason: 'no_auth_identity' }
  }
  try {
    const { error } = await admin.auth.admin.updateUserById(authUserId, { ban_duration: banDuration })
    if (error) return { ok: false, action, reason: error.message || 'auth_update_failed' }
    return { ok: true, action }
  } catch (err) {
    return { ok: false, action, reason: err?.message || 'auth_update_threw' }
  }
}

// Called when an account is deactivated. Ends the account's ability to renew its
// session or sign in again.
export function endAuthAccess(admin, authUserId) {
  return setBan(admin, authUserId, PERMANENT_BAN_DURATION, 'ban')
}

// Called when an account is reactivated or re-invited, so a previously
// deactivated person can sign in again. Safe to call on an account that was
// never banned.
export function restoreAuthAccess(admin, authUserId) {
  return setBan(admin, authUserId, NO_BAN, 'unban')
}

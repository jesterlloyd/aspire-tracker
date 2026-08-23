// api/lib/activeAccount.js
//
// S-05: one definition of "this account may still act".
//
// Deactivating an account writes user_profiles.is_active = false. That flag is
// the whole of the decision, so every JWT-verified endpoint has to consult it
// on every request: a Supabase access token stays cryptographically valid until
// it expires, and it is issued before the deactivation, not after. Without this
// check a deactivated Owner or Admin keeps invite, bulk email, evaluation
// release, and edit authority for the remainder of the token's life.
//
// api/lib/portalAuth.js and api/lib/messagesAuth.js already enforce this for
// the portal and Messages families, and api/revoke-portal-access.js documents
// the same reasoning. This module states the rule once for the endpoints that
// verify their caller inline, so the three families cannot drift apart.
//
// The predicate is deliberately "is_active === false" rather than
// "!is_active": a row whose column is NULL (older than the column's default)
// counts as active, which is exactly how portalAuth has always read it. Widening
// it to a falsy test would lock out accounts that were never deactivated.
//
// This module performs no I/O. It holds a predicate and the refusal wording.

// Refused with 403, not 401: the token is genuine and the caller is who they
// say they are. What changed is their standing, and saying so plainly is more
// useful than implying the sign-in failed.
export const INACTIVE_STATUS = 403

// The reason string recorded in server logs and returned to the sibling
// verifiers that carry one. Matches the existing spelling in api/aspire-events.js.
export const INACTIVE_REASON = 'inactive'

// Shown to the person. No mechanism, no column name, no next-step the caller
// cannot take.
export const INACTIVE_MESSAGE =
  'This account is no longer active. Contact the ASPIRE team if you need access restored.'

// True when the profile may still act. A missing profile is NOT active; callers
// that distinguish "no profile" from "deactivated" should test for the profile
// first and keep their own refusal for that case.
export function isActiveProfile(profile) {
  return !!profile && profile.is_active !== false
}

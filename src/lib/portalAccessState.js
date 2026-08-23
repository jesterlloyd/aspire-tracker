// src/lib/portalAccessState.js
//
// PORTAL-ACCESS-STATE: what to tell a person who reaches the portal but has no
// portal to show them.
//
// TWO states, deliberately. An earlier version of this module had six, on the
// theory that a revoked grant, an expired grant, a deactivated account, and an
// account that was never provisioned are different situations and should read
// differently. They are different situations, but they are not different TO THE
// READER: in every one of them the person has no access, cannot give themselves
// any, and needs the same human. Splitting them produced four near-identical
// paragraphs and one genuinely misleading one, because "not provisioned yet"
// was being shown to students who had finished a rotation and lost access. For
// them nothing was being prepared and nobody was going to be notified.
//
// So the only distinction that survives is the one that changes what the person
// can DO: either we know they have no access, or we could not find out and they
// should try again.
//
// A note on what was removed. The set used to include a 'pending' state for a
// grant scheduled to start later, which was the one case where "being prepared"
// was true. It is unreachable: user_role_grants.starts_at is NOT NULL DEFAULT
// now() and grant_portal_access() never supplies it, so no path in the product
// can create a future-dated grant. Copy for a state that cannot occur is copy
// nobody can check.
//
// This module is pure: state constants, the resolver, and the copy. It performs
// no I/O and reads no session, so the wording can be tested directly.

// The email on every ASPIRE portal screen (house pattern: a local constant per
// module, matching StudentPortal.jsx and MyProfile.jsx).
const SUPPORT = 'aspire@cshs.org'

export const ACCESS_STATES = {
  // Whatever the underlying reason, this account has no portal access. Covers a
  // deactivated account, a closed grant, a grant that reached its end date, and
  // one that never existed.
  NO_ACCESS: 'no_access',
  // We could not find out. Never dressed up as good news.
  UNKNOWN: 'unknown',
}

// Copy per state. `title` and `body` are plain strings; `showSupport` decides
// whether the support line is appended, and `canRetry` whether a Try again
// control is offered.
//
// Neither state promises anything. No "yet", nothing "being prepared", and no
// claim that anyone will be in touch, because for most people who see this
// screen none of that would be true. Neither names the mechanism (no token,
// grant, role, or column) because none of it helps the reader act.
export const ACCESS_COPY = {
  [ACCESS_STATES.NO_ACCESS]: {
    title: 'No portal access on this account',
    body: 'There is no ASPIRE portal access on this account right now. If you need access, or you think this is a mistake, the ASPIRE team can help.',
    showSupport: true,
    canRetry: false,
  },
  [ACCESS_STATES.UNKNOWN]: {
    title: 'We could not check your access',
    body: 'Something went wrong on our end, so we could not check this account. Please try again in a few minutes.',
    showSupport: true,
    canRetry: true,
  },
}

export const SUPPORT_EMAIL = SUPPORT

// Resolve the state to show. A failed check is the only thing that changes the
// answer, because it is the only case where trying again can help.
//
// Note what is NOT an input: whether the account is deactivated. That decides
// WHICH SCREEN a person sees, not which words are on it, and PortalApp answers
// it before any portal branch runs. Once someone is on this card, a deactivated
// account and a finished rotation say the same thing.
export function resolveAccessState({ checkFailed } = {}) {
  return checkFailed ? ACCESS_STATES.UNKNOWN : ACCESS_STATES.NO_ACCESS
}

// ── Classifying a failed portal request ──────────────────────────────────────
//
// A portal data fetch can fail for three different reasons, and they need three
// different screens. Treating them as one is what produced "Something went wrong.
// We could not load your students right now. Please try again shortly." for a
// person whose access had just been revoked: nothing had gone wrong, and Try
// again could never succeed.
//
// The signal is the REASON the server sent, not the bare status code. That
// distinction matters: a 403 or 404 can equally mean "not you, for this one
// student", which is a correct and local refusal that must NOT tip the whole
// portal into a no-access screen. Only the reasons the portal's own verifiers
// emit when a person's standing has changed count as access ending.
export const ACCESS_FAILURE = {
  // Their standing ended. Retrying cannot help. Show the no-access card.
  ACCESS_ENDED: 'access_ended',
  // The session itself is missing or unreadable. Signing in again can help.
  SIGNED_OUT: 'signed_out',
  // Something really did go wrong. Try again is honest.
  TRANSIENT: 'transient',
}

// Emitted by verifyPortalCaller and the role/scope verifiers when the caller no
// longer holds what the endpoint requires: deactivated account, missing profile,
// revoked or expired role grant, or a scope that no longer covers anything.
const ACCESS_ENDED_REASONS = new Set([
  'deactivated',
  'no_profile',
  'no_active_student_grant',
  'no_active_student_link',
  'unit_leader_role_required',
  'staff_role_required',
  'inactive_staff',
  'owner_or_admin_required',
  // The generic denial from unitLeaderScope and schoolScope, reached when a
  // caller holds the role but no longer has any unit or school in scope.
  'forbidden',
])

// The token is absent or will not verify. Distinct from access ending: the person
// may still have access, they just are not currently signed in.
const SIGNED_OUT_REASONS = new Set(['missing_token', 'invalid_token', 'verify_threw', 'unauthenticated'])

// Everything else is transient by default, INCLUDING the *_lookup_failed reasons.
// Those mean the server could not read the authorization tables, not that the
// answer was no, so telling someone their access ended would be a guess.
export function classifyPortalFailure({ status, error } = {}) {
  const reason = typeof error === 'string' ? error : ''
  if (ACCESS_ENDED_REASONS.has(reason)) return ACCESS_FAILURE.ACCESS_ENDED
  if (SIGNED_OUT_REASONS.has(reason)) return ACCESS_FAILURE.SIGNED_OUT
  // A 401 with no reason we recognise still means the session did not verify.
  if (status === 401 && !reason) return ACCESS_FAILURE.SIGNED_OUT
  return ACCESS_FAILURE.TRANSIENT
}

// True when a failed request means this person no longer has portal access, so
// the caller should hand off to the no-access card instead of its own error state.
export function isAccessEnded(failure) {
  return classifyPortalFailure(failure) === ACCESS_FAILURE.ACCESS_ENDED
}

export function accessCopy(state) {
  return ACCESS_COPY[state] || ACCESS_COPY[ACCESS_STATES.NO_ACCESS]
}

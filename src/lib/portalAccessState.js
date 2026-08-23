// src/lib/portalAccessState.js
//
// PORTAL-ACCESS-STATE: what to tell a person who reaches the portal but has no
// portal to show them.
//
// One card used to serve every one of these situations, saying "Your ASPIRE
// portal is being prepared. Your account is active, but your portal experience
// is not available yet. The ASPIRE team will let you know as soon as it opens."
// For a deactivated or closed account every clause of that was false: the
// account was not active, nothing was being prepared, and no one was going to
// be notified. It was written for the not-provisioned-yet case and became a
// catch-all.
//
// Each state below gets its own wording. Where access has ended, the person is
// told plainly and pointed at a human. Where something genuinely is coming,
// the original promise is kept, because for that state it was always true.
//
// This module is pure: state constants, the resolver, and the copy. It performs
// no I/O and reads no session, so the wording can be tested directly.

// The email on every ASPIRE portal screen (house pattern: a local constant per
// module, matching StudentPortal.jsx and MyProfile.jsx).
const SUPPORT = 'aspire@cshs.org'

export const ACCESS_STATES = {
  // The account itself is switched off. Outranks everything else: whatever the
  // grants say, this is the true answer and the one the person needs.
  DEACTIVATED: 'deactivated',
  // A grant existed and was deliberately closed.
  REVOKED: 'revoked',
  // A grant existed and reached its end date on its own.
  EXPIRED: 'expired',
  // A grant exists but has not started yet. The only state where "being
  // prepared" was ever the truth.
  PENDING: 'pending',
  // Account is fine, no portal role has ever been provisioned.
  NOT_PROVISIONED: 'not_provisioned',
  // We could not find out. Never dressed up as good news.
  UNKNOWN: 'unknown',
}

// Copy per state. `title` and `body` are plain strings; `showSupport` decides
// whether the support line is appended, and `canRetry` whether a Try again
// control is offered. No state names the mechanism (no token, grant, role,
// endpoint, or column) because none of that helps the reader act.
export const ACCESS_COPY = {
  [ACCESS_STATES.DEACTIVATED]: {
    title: 'Your ASPIRE access has ended',
    body: 'This account is no longer active, so there is nothing to show here. If you think this is a mistake, or you need access again, the ASPIRE team can help.',
    showSupport: true,
    canRetry: false,
  },
  [ACCESS_STATES.REVOKED]: {
    title: 'Your ASPIRE access has ended',
    body: 'Your portal access has been closed. If you think this is a mistake, or you need it reopened, the ASPIRE team can help.',
    showSupport: true,
    canRetry: false,
  },
  [ACCESS_STATES.EXPIRED]: {
    title: 'Your ASPIRE access has ended',
    body: 'Your portal access reached its end date. If you still need it, the ASPIRE team can extend it for you.',
    showSupport: true,
    canRetry: false,
  },
  [ACCESS_STATES.PENDING]: {
    title: 'Your ASPIRE portal is being prepared',
    body: 'Your access is set up but has not opened yet. The ASPIRE team will let you know as soon as it does.',
    showSupport: false,
    canRetry: false,
  },
  [ACCESS_STATES.NOT_PROVISIONED]: {
    title: 'Your ASPIRE portal is being prepared',
    body: 'Your account is ready, but your portal has not been set up yet. The ASPIRE team will let you know as soon as it opens. If you were expecting it already, please get in touch.',
    showSupport: true,
    canRetry: false,
  },
  [ACCESS_STATES.UNKNOWN]: {
    title: 'We could not check your access',
    body: 'Something went wrong on our end, so we cannot tell you where your portal stands right now. Please try again in a few minutes.',
    showSupport: true,
    canRetry: true,
  },
}

export const SUPPORT_EMAIL = SUPPORT

// Resolve the state to show.
//
// Order matters and is deliberate:
//   1. is_active === false wins outright. A deactivated account can still hold
//      a live grant, in which case the grant lookup would say "active" and be
//      useless to the reader.
//   2. A failed check never borrows a reassuring message.
//   3. Otherwise defer to whatever the grant lookup found.
//
// `profileActive` is user_profiles.is_active, where NULL and undefined mean
// active (matching how the server has always read that column). `grantState`
// is the endpoint's answer, or null when it has not answered yet.
export function resolveAccessState({ profileActive, checkFailed, grantState } = {}) {
  if (profileActive === false) return ACCESS_STATES.DEACTIVATED
  if (checkFailed) return ACCESS_STATES.UNKNOWN
  switch (grantState) {
    case ACCESS_STATES.REVOKED:
    case ACCESS_STATES.EXPIRED:
    case ACCESS_STATES.PENDING:
    case ACCESS_STATES.NOT_PROVISIONED:
      return grantState
    default:
      // No answer yet, or an answer this build does not recognise. Say the
      // neutral true thing rather than guessing at a reason.
      return ACCESS_STATES.NOT_PROVISIONED
  }
}

export function accessCopy(state) {
  return ACCESS_COPY[state] || ACCESS_COPY[ACCESS_STATES.NOT_PROVISIONED]
}

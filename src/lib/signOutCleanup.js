// src/lib/signOutCleanup.js
//
// S-17 (FINDINGS_REGISTER.md): what this browser forgets when a person signs out, and
// what it keeps. One place, one registry, one function, so the next person on a shared
// workstation inherits nothing that was the previous person's, and so a new storage key
// cannot be added without saying which side of that line it is on.
//
// THE RULE. Every key the app writes to localStorage or sessionStorage is listed below
// with a CLASS:
//
//   clear       Removed on sign-out and on a change of signed-in user. Anything that
//               holds student, contact or recipient data, or that is "where you were",
//               and is NOT keyed by the user id.
//   keyed       Kept. The key contains the user's own id, so another account cannot
//               read it through the app (its readers build the key from THEIR id).
//               Unsent drafts live here on purpose: deleting them would lose work.
//   preference  Kept. A device or UI preference with no personal data in it.
//   mechanism   Kept. State the sign-in and sign-out flow itself relies on.
//   public      Kept. Written by the no-account pages (a form or signing link opened
//               from an email); there is no signed-in user to clear it for.
//   auth        The Supabase session itself. supabase.auth.signOut() removes it; it is
//               listed so the sweep can account for it, not because this file touches it.
//
// test/s17SignOutCleanup.test.mjs walks every setItem() in src/, resolves the key each
// one writes, and fails if this registry does not classify it. So a new key is a new
// row here, decided out loud, or the suite is red.
//
// React Query is the other half: every list, roster and thread the previous person
// opened is in the query cache, and a cache that survives sign-out is readable by the
// next person the moment they sign in, before their own fetches land. The cache is
// cleared here too, on sign-out and on a change of user.

import { clearStudentPhotoCache } from './studentPhotoCache.js'

/**
 * Every storage key the app writes. `prefix` is matched with startsWith; an exact key
 * is simply a prefix that is the whole key. `store` is where it lives. `holds` says
 * what a value contains, which is what the class was decided from.
 */
export const STORAGE_KEY_REGISTRY = Object.freeze([
  // ── clear: not keyed by user, and holds people or place ──────────────────────
  { prefix: 'aspire_interviewers_v1', store: 'local', cls: 'clear', holds: 'the interviewer roster cache: names, emails, colours (InterviewersModal, AvailabilityManagerModal)' },
  { prefix: 'aspire.connect.contacts.lastContactId', store: 'local', cls: 'clear', holds: 'the id of the contact last opened in Connect' },
  { prefix: 'aspire.connect.lastTab', store: 'local', cls: 'clear', holds: 'which Connect tab was open (where you were)' },
  { prefix: 'aspire.connect.launchContext.v1', store: 'session', cls: 'clear', holds: 'the recipient a screen handed to Outreach: student or contact id, name, email, cohort' },
  { prefix: 'aspire:studentPhotoCache:v1', store: 'session', cls: 'clear', holds: 'signed headshot URLs, scoped to the signed-in profile' },
  { prefix: 'aspire.portalFeedback.requestId.v1:', store: 'local', cls: 'clear', holds: 'the idempotency id of a portal feedback submission in progress' },
  { prefix: 'aspire:portal:cohort-hint:', store: 'session', cls: 'clear', holds: 'that this user has seen the portal cohort hint this tab session' },
  { prefix: 'onboarding_tour_snoozed', store: 'session', cls: 'clear', holds: 'that the welcome tour was snoozed this tab session (bare legacy key and the :experience form)' },
  { prefix: 'aspire_active_tab', store: 'local', cls: 'clear', holds: 'legacy pre-namespacing active tab; StaffApp migrates and nothing reads it' },
  { prefix: 'aspire_auth', store: 'both', cls: 'clear', holds: 'legacy shared-password flag from the retired LoginPage' },
  { prefix: 'aspire_password', store: 'both', cls: 'clear', holds: 'legacy shared-password storage (never written by current code; removed defensively)' },
  { prefix: 'app_authenticated', store: 'both', cls: 'clear', holds: 'legacy auth flag (never written by current code; removed defensively)' },
  { prefix: 'isAuthenticated', store: 'both', cls: 'clear', holds: 'legacy auth flag (never written by current code; removed defensively)' },

  // ── keyed: the user id is in the key, so another account cannot read it ───────
  { prefix: 'aspire.connect.outreach.directDraft.', store: 'local', cls: 'keyed', holds: 'an unsent Send-to-one draft: subject, body, attachments, recipient token; keyed by user id and cohort, 7-day TTL' },
  { prefix: 'aspire.connect.outreach.lastDraftPointer.', store: 'local', cls: 'keyed', holds: 'which direct draft to reopen; keyed by user id and cohort' },
  { prefix: 'aspire.connect.outreach.bulkDraft.', store: 'local', cls: 'keyed', holds: 'an unsent Send-to-many draft: subject, body, signature flag (no recipients); keyed by user id and cohort' },
  { prefix: 'aspire.rubric.draft.', store: 'local', cls: 'keyed', holds: 'an interview rubric safety-net draft for one student; keyed by student id AND the interviewer profile id' },
  { prefix: 'aspire:activeCohort:', store: 'local', cls: 'keyed', holds: 'the selected ASPIRE cohort (what you work in, kept on purpose; sessionKeys.js)' },
  { prefix: 'aspire:lastActiveTab:', store: 'local', cls: 'keyed', holds: 'the staff tab (cleared for the leaving user by clearLastLocationOnSignOut)' },
  { prefix: 'aspire:lastNgrpTab:', store: 'local', cls: 'keyed', holds: 'the Residency sub-tab (cleared for the leaving user by clearLastLocationOnSignOut)' },
  { prefix: 'aspire:ngrpCycle:', store: 'local', cls: 'keyed', holds: 'the selected Residency cycle' },
  { prefix: 'aspire:ui-preferences:', store: 'local', cls: 'keyed', holds: 'a cache of the account\'s Style and Color mode' },
  { prefix: 'aspire:demoMode:', store: 'local', cls: 'keyed', holds: 'this user\'s own demo mode choice' },
  { prefix: 'aspire.portal.desktopNotice.v1:', store: 'local', cls: 'keyed', holds: 'that this portal user dismissed the desktop notice' },
  { prefix: 'keith-model-', store: 'local', cls: 'keyed', holds: 'the Keith model this profile picked' },
  { prefix: 'keith-welcomed-', store: 'local', cls: 'keyed', holds: 'that this profile has seen Keith\'s welcome line' },

  // ── preference: no personal data ─────────────────────────────────────────────
  { prefix: 'aspire-color-mode', store: 'local', cls: 'preference', holds: 'the device mirror of the painted color mode (index.html reads it before React)' },
  { prefix: 'aspire-style', store: 'local', cls: 'preference', holds: 'the device mirror of the painted Style' },
  { prefix: 'aspire-theme', store: 'local', cls: 'preference', holds: 'the legacy theme choice, read once for adoption' },
  { prefix: 'aspire.connect.richCompose', store: 'local', cls: 'preference', holds: 'the Owner\'s per-browser rich compose opt-out' },
  { prefix: 'aspire.connect.outreach.lastMode', store: 'local', cls: 'preference', holds: 'message or survey' },
  { prefix: 'aspire.connect.outreach.mode', store: 'local', cls: 'preference', holds: 'single or bulk' },
  { prefix: 'aspire_sent_history_filters', store: 'local', cls: 'preference', holds: 'Sent History folder, audience and date range; the student or contact filter is deliberately never persisted' },
  { prefix: 'aspire-catalog-moved-dismissed', store: 'local', cls: 'preference', holds: 'ids of "moved" Catalog notices dismissed in this browser' },
  { prefix: 'aspire.evaluation.lastWorkflow', store: 'local', cls: 'preference', holds: 'the Review & Release workflow last opened' },

  // ── mechanism: the sign-in and sign-out flow itself ──────────────────────────
  { prefix: 'aspire:lastAuthenticatedUserId', store: 'local', cls: 'mechanism', holds: 'which account was last active in this browser; how a DIFFERENT account is detected' },
  { prefix: 'aspire:signedOutHere', store: 'local', cls: 'mechanism', holds: 'one-shot marker that a sign-out happened, consumed by the next sign-in' },
  { prefix: 'aspire:demoMode', store: 'local', cls: 'mechanism', holds: 'the browser-level demo ARMED marker; reconciled against the per-user key at sign-in so a second account never inherits it' },
  { prefix: 'aspire:chunk-reload:', store: 'session', cls: 'mechanism', holds: 'when a stale-chunk reload last ran, to reload once and not loop' },

  // ── public: no signed-in user ────────────────────────────────────────────────
  { prefix: 'aspire-form-draft:', store: 'local', cls: 'public', holds: 'a respondent\'s in-progress answers on a personal form link, keyed by the link token' },
  { prefix: 'aspire-form-token', store: 'session', cls: 'public', holds: 'the form link token, moved out of the address bar' },
  { prefix: 'aspire-sign-token', store: 'session', cls: 'public', holds: 'the signing link token, moved out of the address bar' },

  // ── auth: the session, owned by supabase-js ──────────────────────────────────
  { prefix: 'aspire-intelligence-auth', store: 'local', cls: 'auth', holds: 'the Supabase session; removed by supabase.auth.signOut()' },
])

/** The registry entry a key falls under, or null when nothing classifies it. */
export function classifyStorageKey(key) {
  if (typeof key !== 'string' || !key) return null
  let best = null
  for (const entry of STORAGE_KEY_REGISTRY) {
    if (key.startsWith(entry.prefix) && (!best || entry.prefix.length > best.prefix.length)) best = entry
  }
  return best
}

function keysOf(store) {
  const out = []
  try {
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i)
      if (k) out.push(k)
    }
  } catch { /* storage unavailable */ }
  return out
}

function removeClearable(store) {
  const removed = []
  for (const key of keysOf(store)) {
    const entry = classifyStorageKey(key)
    if (entry?.cls !== 'clear') continue
    try { store.removeItem(key); removed.push(key) } catch { /* ignore */ }
  }
  return removed
}

function browserStore(name) {
  try { return typeof window !== 'undefined' ? window[name] : null } catch { return null }
}

/**
 * Forget the signed-in person's state in this browser.
 *
 * Runs on every way a session ends (a deliberate sign-out, an expired session, both
 * arrive as SIGNED_OUT) and whenever the signed-in user changes without a sign-out in
 * between (another tab signed in as someone else, or the app opened on a session that
 * is not the one this browser last saw). Idempotent and never throws: a sign-out must
 * complete whatever the state of storage.
 *
 * Returns what it removed, for tests and for a console line.
 */
export function clearClientStateOnSignOut({ queryClient = null, local = browserStore('localStorage'), session = browserStore('sessionStorage') } = {}) {
  const removed = []
  try { queryClient?.clear?.() } catch { /* a cache that cannot be cleared is empty next mount */ }
  try { clearStudentPhotoCache() } catch { /* module state only */ }
  if (local) removed.push(...removeClearable(local))
  if (session) removed.push(...removeClearable(session))
  return { removed, cacheCleared: Boolean(queryClient) }
}

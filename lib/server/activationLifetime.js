// The one place the activation-link lifetime is stated to a human being.
//
// WHY THIS MODULE EXISTS
// The duration used to be hardcoded independently in four places: the shared
// portal invitation template, the staff invitation template, and two states of
// the activation page. On 2026-08-10 that cost us a real defect - three
// surfaces were corrected to a new wording and the fourth, the screen a user
// reaches when their link WORKS, silently kept the old phrasing. Copy that is
// written four times drifts four ways, so it is now written once and imported.
//
// THIS IS DESCRIPTIVE COPY, NOT CONFIGURATION.
// Nothing here changes how long a link actually lives. The runtime authority is
// and remains the Supabase Auth project setting `mailer_otp_exp`, which is set
// in the Supabase dashboard and is not represented anywhere in this repository.
// Editing this file changes only what we TELL people. If the dashboard value
// and this file disagree, this file is wrong and the dashboard is right.
//
// CONFIGURATION HISTORY (newest first)
//   2026-08-10  86400 seconds (24 hours). Set manually by the Owner in the
//               production Supabase dashboard. CURRENT CANONICAL VALUE.
//   2026-08-03  3600 seconds (1 hour). Verified in the production dashboard on
//               that date and treated as canonical until superseded above.
//               Historical only - it does not describe production today.
// Before changing the duration below, re-verify `mailer_otp_exp` against the
// production dashboard. Do not infer it from this file, from a test, or from a
// handoff document.

/** Human-readable lifetime. Must match production `mailer_otp_exp`. */
export const ACTIVATION_LIFETIME_LABEL = '24 hours'

/**
 * The full rule as told to invitees, in one voice, everywhere.
 * Stated as one sentence for the lifetime, then the recovery path, then what
 * happens to older links - deliberately separate ideas in separate clauses so
 * none of them can be misread as the portal-access grant date.
 */
export const ACTIVATION_LIFETIME_SENTENCE =
  `Your activation link is valid for ${ACTIVATION_LIFETIME_LABEL} and can be used once. ` +
  'If it expires, request a new link from the activation page or use Forgot Password ' +
  'on the sign-in page. When a new link is issued, earlier activation links stop working, ' +
  'so always use the most recent email.'

/**
 * The activation page's own phrasing. Shorter than the emailed sentence because
 * the reader is already looking at the activation screen, but it states the same
 * duration from the same constant, so the two cannot drift apart.
 */
export const ACTIVATION_PAGE_SENTENCE =
  `Activation links are valid for ${ACTIVATION_LIFETIME_LABEL} and can be used once.`

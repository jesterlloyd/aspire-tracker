// PORTAL-ACTIVATION-RELIABILITY-1: scanner-safe activation, corrected invite
// branching, self-service expired-link recovery, truthful email copy, and
// privacy-safe invitation diagnostics.
//
// The four defects this fixes (from the 2026-08-03 read-only audit):
//   1. emails embedded the raw Supabase verify URL, consumed on GET by
//      email-security scanners before the recipient ever clicked;
//   2. newer links silently invalidated older emailed links with no user-facing
//      explanation;
//   3. the email presented the months-away GRANT expiry as the activation
//      deadline while the token lived about a day;
//   4. an existing auth user without profile linkage hit a branch that
//      provisioned access and reported success while emailing nothing.
//
// Run: node --test test/portalActivationReliability.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const endpoint = read('api/invite-portal-user.js')
const page     = read('src/pages/ActivateAccountPage.jsx')
const email    = read('lib/server/email/portalInvitation.js')
const eventApi = read('api/portal-activation-event.js')
const ledger   = read('supabase/migrations/20260804000000_portal_invitation_events.sql')

// ── Scanner-safe activation ──────────────────────────────────────────────────

test('the emailed link is the ASPIRE hash URL, never the consumed-on-GET verify URL', () => {
  assert.match(endpoint, /function activationUrl\(hashedToken, type\)/)
  assert.match(endpoint, /appUrl\('\/auth\/activate'\)\}\?token_hash=\$\{encodeURIComponent\(hashedToken\)\}&type=\$\{encodeURIComponent\(type\)\}/)
  assert.match(endpoint, /activationUrl\(linkData\.properties\?\.hashed_token, 'invite'\)/)
  assert.match(endpoint, /activationUrl\(reissue\?\.properties\?\.hashed_token, 'recovery'\)/)
  // The raw action_link is never read, so it can never be emailed.
  assert.doesNotMatch(endpoint, /properties\?\.action_link/)
})

test('loading the page never consumes the token; only the explicit click verifies', () => {
  // token_hash renders the confirm step and nothing else happens on load.
  assert.match(page, /params\.get\('token_hash'\)/)
  assert.match(page, /\(tokenHash && TOKEN_TYPES\.has\(type\)\) \? \{ tokenHash, type \} : null/)
  assert.match(page, /initialTokenLink \? 'confirm'/)
  // verifyOtp is CALLED exactly once, inside the click handler, never in an
  // effect (the header comment may name it; call sites are what count).
  const occurrences = page.split('verifyOtp(').length - 1
  assert.equal(occurrences, 1, 'verifyOtp is called from exactly one place')
  assert.match(page, /const handleActivate = async \(\) => \{[\s\S]{0,400}verifyOtp\(\{\n\s+token_hash: initialTokenLink\.tokenHash,\n\s+type: initialTokenLink\.type,\n\s+\}\)/)
  assert.doesNotMatch(page, /useEffect\([\s\S]{0,600}?verifyOtp/, 'no automatic verification on load')
  assert.match(page, /Activate my account/)
  // Token types are constrained to the two ASPIRE link types.
  assert.match(page, /const TOKEN_TYPES = new Set\(\['invite', 'recovery'\]\)/)
})

test('a failed explicit verification resolves to the recovery state, not a crash', () => {
  assert.match(page, /if \(error\) \{ setStatus\('invalid'\); return \}/)
})

// ── Correct invite and reissue branching ─────────────────────────────────────

test('an existing auth user with missing profile linkage now gets a real link', () => {
  const branch = endpoint.slice(endpoint.indexOf('findAuthUserIdByEmail(db, email)'), endpoint.indexOf('} else {\n          console.log'))
  assert.match(branch, /needsActivation = foundUser\?\.user\?\.user_metadata\?\.password_set !== true/)
  assert.match(branch, /catch \{[\s\S]{0,80}needsActivation = true/)
  assert.match(branch, /type: 'recovery',/)
  assert.match(branch, /activationUrl\(relink\?\.properties\?\.hashed_token, 'recovery'\)/)
  assert.match(branch, /unlinked_auth_user: true/)
})

test('success messaging stays honest: no sent claim without a send', () => {
  assert.match(endpoint, /if \(activationLink && \(createdAuthUser \|\| needsActivation\)\)/)
  assert.match(endpoint, /'Portal access granted\. The invitation email could not be sent; please resend\.'/)
  assert.match(endpoint, /email_sent: invited \? emailSent : undefined/)
})

test('already-activated accounts and existing identities are preserved, never recreated', () => {
  // The reissue check and the compensation rule survive unchanged.
  assert.match(endpoint, /user_metadata\?\.password_set !== true/)
  assert.match(endpoint, /Never delete a\n\s+\/\/ pre-existing auth user/)
})

// ── Self-service expired-link recovery ───────────────────────────────────────

test('the invalid state offers new-link, set-or-reset, and sign-in, non-enumerating', () => {
  assert.match(page, /This activation link is no longer available\./)
  assert.match(page, /Email me a new link/)
  assert.match(page, /Set or reset password/)
  assert.match(page, /Go to sign in/)
  assert.match(page, /aspire@cshs\.org/)
  // Both requests go through one non-enumerating helper with an identical
  // confirmation whether or not the account exists.
  assert.match(page, /const requestRecovery = async \(destinationPath\) => \{/)
  assert.match(page, /resetPasswordForEmail\(addr, \{ redirectTo: appUrl\(destinationPath\) \}\)/)
  assert.match(page, /If an account exists for that address, a new email is on its way\./)
  assert.match(page, /requestRecovery\('\/auth\/activate'\)/)
  assert.match(page, /requestRecovery\('\/auth\/reset-password'\)/)
})

test('supersession is explained to the user and in the email', () => {
  assert.match(page, /requesting a\n\s+new link makes earlier links stop working/i)
  assert.match(email, /Requesting a new link makes earlier links stop working, so always use the newest email\./)
})

// ── Corrected email copy ─────────────────────────────────────────────────────

test('the email separates link lifetime from portal-access expiration', () => {
  // The stated lifetime matches the confirmed production Email OTP expiration
  // (3600 seconds): 1 hour, not the earlier estimated 24 hours.
  assert.match(email, /works for 1 hour and can be used once/)
  assert.match(email, /Your portal access itself is available through <strong>/)
  // The old copy that presented the grant date as the activation deadline is gone.
  assert.doesNotMatch(email, /activate your access and create your password by/)
})

// ── Redirects and landing ────────────────────────────────────────────────────

test('activation links and recovery requests target the canonical domain', () => {
  assert.match(endpoint, /appUrl\('\/auth\/activate'\)/)
  assert.match(page, /import \{ appUrl \} from '\.\.\/lib\/appUrl'/)
  // Successful activation still lands in the portal.
  assert.match(page, /navigate\('\/portal', \{ replace: true \}\)/)
})

// ── Privacy-safe diagnostics ─────────────────────────────────────────────────

test('the invite endpoint records lifecycle events without tokens or links', () => {
  assert.match(endpoint, /async function recordInviteEvent\(db, \{ eventType/)
  for (const ev of ['resend_requested', 'link_generated', 'email_send_attempted', 'email_send_failed']) {
    assert.match(endpoint, new RegExp(`'${ev}'`), `records ${ev}`)
  }
  // The ledger helper's insert carries no token, hash, or link field.
  const helper = endpoint.slice(endpoint.indexOf('async function recordInviteEvent'), endpoint.indexOf('const str ='))
  assert.doesNotMatch(helper, /token|hash|link_url|activationLink/i)
  assert.match(helper, /catch \{ \/\* diagnostics never block the invitation \*\/ \}/)
})

test('the activation-event endpoint is authenticated, allowlisted, and defensive', () => {
  assert.match(eventApi, /const EVENT_TYPES = new Set\(\['activation_succeeded', 'activation_failed', 'recovery_requested'\]\)/)
  assert.match(eventApi, /if \(!EVENT_TYPES\.has\(eventType\)\) return res\.status\(400\)/)
  // The target email comes from the verified session (normalized), never the
  // request body.
  assert.match(eventApi, /data\.user\.email\.trim\(\)\.toLowerCase\(\)/)
  assert.doesNotMatch(eventApi, /body\.email/)
  // Ledger absence never breaks activation.
  assert.match(eventApi, /catch \{ \/\* ledger absent or failed: never break activation \*\/ \}/)
})

test('the ledger migration is Owner/Admin read-only with no token-shaped columns', () => {
  // R2: created exactly once behind a transactional precheck; a prior (even
  // partial) apply aborts for deliberate reconciliation instead of a silent
  // re-run, so the table statement carries no IF NOT EXISTS.
  assert.match(ledger, /IF to_regclass\('public\.portal_invitation_events'\) IS NOT NULL THEN\n\s+RAISE EXCEPTION 'PRECHECK FAILED/)
  assert.match(ledger, /CREATE TABLE public\.portal_invitation_events \(/)
  assert.doesNotMatch(ledger, /CREATE TABLE IF NOT EXISTS/)
  assert.match(ledger, /'invite_requested', 'link_generated',/)
  assert.match(ledger, /portal_invitation_events_owner_admin_read/)
  assert.match(ledger, /REVOKE INSERT, UPDATE, DELETE ON public\.portal_invitation_events FROM authenticated;/)
  // No token/hash/link column exists in the table definition block.
  const tableDef = ledger.slice(ledger.indexOf('CREATE TABLE'), ledger.indexOf('CREATE INDEX'))
  assert.doesNotMatch(tableDef, /token|hash|link_url/i)
})

test('R1 migration safeguards: deterministic grants, normalized email, idempotent policy, bounded detail', () => {
  // Explicit privileges: authenticated read (RLS-narrowed), service-role
  // append-only with identity-sequence usage, nothing for anon/PUBLIC.
  assert.match(ledger, /GRANT SELECT ON public\.portal_invitation_events TO authenticated;/)
  assert.match(ledger, /GRANT SELECT, INSERT ON public\.portal_invitation_events TO service_role;/)
  assert.match(ledger, /REVOKE UPDATE, DELETE ON public\.portal_invitation_events FROM service_role;/)
  assert.match(ledger, /REVOKE ALL ON public\.portal_invitation_events FROM PUBLIC, anon;/)
  assert.match(ledger, /pg_get_serial_sequence\('public\.portal_invitation_events', 'id'\)/)
  assert.match(ledger, /GRANT USAGE, SELECT ON SEQUENCE %s TO service_role/)
  // True normalization enforced by the table itself: nonblank, bounded, and
  // exactly equal to its own trimmed lowercase form (R2).
  assert.match(ledger, /btrim\(target_email\) <> ''\n\s+AND target_email = lower\(btrim\(target_email\)\)\n\s+AND length\(target_email\) <= 320/)
  // Policy creation is safe after a partial prior apply.
  assert.match(ledger, /DROP POLICY IF EXISTS "portal_invitation_events_owner_admin_read"/)
  // detail is a bounded JSON OBJECT, never an array/scalar or oversized blob.
  assert.match(ledger, /jsonb_typeof\(detail\) = 'object'\n\s+AND pg_column_size\(detail\) <= 2048/)
  // Expanded verification: helper existence, exact policy row, table and
  // sequence privileges per role.
  assert.match(ledger, /p\.proname = 'is_active_owner_or_admin'/)
  assert.match(ledger, /FROM pg_policies/)
  assert.match(ledger, /has_table_privilege\('service_role', 'public\.portal_invitation_events', 'INSERT'\)/)
  assert.match(ledger, /has_sequence_privilege\('service_role'/)
})

test('R1 writer allowlists: fixed fields and boolean-only sanitized detail', () => {
  assert.match(endpoint, /const EVENT_DETAIL_KEYS = new Set\(\['created_auth_user', 'reissue', 'unlinked_auth_user'\]\)/)
  assert.match(endpoint, /EVENT_DETAIL_KEYS\.has\(key\) && typeof detail\[key\] === 'boolean'/)
  assert.match(endpoint, /detail: sanitizeEventDetail\(detail\),/)
  // The activation-event writer inserts exactly four allowlisted fields with
  // the email from the verified session.
  assert.match(eventApi, /event_type: eventType,\n\s+target_email: data\.user\.email\.trim\(\)\.toLowerCase\(\),\n\s+target_profile_id: profileId,\n\s+category,/)
})

test('no token, hash, or activation link is ever logged or returned', () => {
  assert.doesNotMatch(endpoint, /console\.log\([^)]*activationLink/)
  assert.doesNotMatch(endpoint, /console\.log\([^)]*hashed_token/)
  assert.doesNotMatch(endpoint, /json\([^)]*activationLink/)
  assert.doesNotMatch(page, /console\.log/)
  assert.doesNotMatch(eventApi, /console\.log/)
})

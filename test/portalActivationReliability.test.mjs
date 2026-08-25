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
import { ACTIVATION_LIFETIME_SENTENCE, ACTIVATION_PAGE_SENTENCE } from '../lib/server/activationLifetime.js'

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

test('supersession is explained to the user and in the email', async () => {
  // The page now uses the SAME sentence as the emails (aligned 2026-08-10).
  assert.match(page, /When a new\n?\s*link is issued, earlier activation links stop working/i)
  // Rendered, not read from source: since the copy was centralized the
  // template file no longer contains the sentence literally, and asserting
  // against source would silently stop checking the delivered email.
  const { portalInvitationEmail } = await import('../lib/server/email/portalInvitation.js')
  const html = portalInvitationEmail({ firstName: 'Sam', activationLink: 'https://x/a#t', role: 'student' }).html
  assert.match(html, /When a new link is issued, earlier activation links stop working, so always use the most recent email\./)
})

// ── Corrected email copy ─────────────────────────────────────────────────────

test('the email separates link lifetime from portal-access expiration', async () => {
  // The stated lifetime tracks the production Email OTP expiration, which the
  // Owner set to 86400 seconds (24 hours) on 2026-08-10, superseding the
  // 3600-second value confirmed on 2026-08-03. Asserted through the shared
  // constant, against RENDERED output, so this cannot disagree with what is
  // actually delivered.
  const { portalInvitationEmail } = await import('../lib/server/email/portalInvitation.js')
  const html = portalInvitationEmail({ firstName: 'Sam', activationLink: 'https://x/a#t', expiresAt: '2027-01-01', role: 'student' }).html
  assert.ok(html.includes(ACTIVATION_LIFETIME_SENTENCE))
  assert.match(html, /Your portal access itself is available through <strong>/)
  // The old copy that presented the grant date as the activation deadline is gone.
  assert.doesNotMatch(html, /activate your access and create your password by/)
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

// ── TTL CANON 2026-08-10: one duration, one sentence, four surfaces ──────────
//
// The activation-link TTL is a Supabase Auth project setting (mailer_otp_exp)
// that no code in this repository controls. The Owner set it to 86400 seconds
// (24 hours) in the production dashboard on 2026-08-10, superseding the
// 3600-second (1 hour) value confirmed on 2026-08-03.
//
// These tests assert THROUGH the shared constant rather than restating the
// duration, because restating it is precisely how the surfaces drifted apart
// before. The single test below is the one place the literal value is pinned.

test('the canonical lifetime matches the production Supabase setting', async () => {
  const { ACTIVATION_LIFETIME_LABEL } = await import('../lib/server/activationLifetime.js')
  // THE VALUE PIN. Production mailer_otp_exp = 86400 seconds, set by the Owner
  // on 2026-08-10. If the dashboard changes again, re-verify it there FIRST,
  // then change the module, then this line - in that order. This assertion
  // exists so the duration can never drift silently; it is not the authority.
  assert.equal(ACTIVATION_LIFETIME_LABEL, '24 hours')
})

test('the copy module is descriptive only and sets no authentication TTL', () => {
  // Supabase remains the runtime authority. This module must never grow into
  // an application-side TTL setting that code reads to decide link lifetime.
  const mod = read('lib/server/activationLifetime.js')
  // Strip line comments AND JSDoc blocks: the module's prose legitimately names
  // mailer_otp_exp and both configuration values, so only executable text may
  // be asserted against. (Missing the `/*` opener here is exactly the kind of
  // comment-leak that has bitten these source-guard tests before.)
  const code = mod.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n')
  assert.ok(!/mailer_otp_exp\s*[:=]/.test(code), 'must not define a TTL setting')
  assert.ok(!/86400|3600/.test(code), 'must not express the lifetime as seconds in executable code')
  assert.ok(!/expiresIn|ttl|otp_exp/i.test(code), 'must not expose a lifetime knob')
  // It is copy: strings only, no imports, no functions with side effects.
  assert.ok(!/^import /m.test(code), 'copy needs no dependencies')
})

test('every invitation states the SAME activation rule, word for word', async () => {
  const { portalInvitationEmail } = await import('../lib/server/email/portalInvitation.js')
  const staffMod = await import('../lib/server/email/staffInvitation.js')
  const staffFn = staffMod.staffInvitationEmail || staffMod.default

  const RECOVERY = 'request a new link from the activation page or use Forgot Password on the sign-in page'
  const SUPERSESSION = 'When a new link is issued, earlier activation links stop working, so always use the most recent email.'

  const rendered = ['student', 'unit_leader', 'academic_partner', 'nursing_academic'].map(role =>
    portalInvitationEmail({ firstName: 'Sam', activationLink: 'https://x/auth/activate#t', expiresAt: '2027-01-01', role }).html)
  rendered.push(staffFn({ firstName: 'Ada', activationLink: 'https://x/auth/activate#t', role: 'admin' }).html)

  for (const html of rendered) {
    assert.ok(html.includes(ACTIVATION_LIFETIME_SENTENCE), 'the lifetime sentence must be identical everywhere')
    assert.ok(html.includes(RECOVERY), 'self-service recovery must be offered')
    assert.ok(html.includes(SUPERSESSION), 'supersession must be explained')
    // Retired wording must not survive anywhere, including the superseded
    // 1-hour duration this release replaced.
    assert.ok(!/activation button is time-limited/.test(html))
    assert.ok(!/always use the newest email/.test(html))
    assert.ok(!/valid for 1 hour|1 hour and can be used once/.test(html),
      'the 1-hour TTL was superseded on 2026-08-10; no template may still claim it')
    assert.ok(!/60 minutes/.test(html))
  }
})

// HOW THE PAGE DRIFTED, AND WHY THESE GUARDS CHANGED SHAPE
// On 2026-08-10 four surfaces were corrected to new wording and the confirm
// state - the screen a user reaches when their link WORKS - silently kept the
// old phrasing. The first fix pinned each state to a literal sentence. The
// duration then changed again the same day, which would have meant editing
// every literal a second time. So the copy now lives in one module and these
// guards assert STRUCTURE instead: no state may hardcode a duration at all,
// and every state that states the rule must render the shared constant.
test('no activation-page state hardcodes a duration', () => {
  // Comments are stripped first so the file's own prose can discuss the
  // retired 1-hour wording without tripping the absence checks.
  const prose = page
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n').replace(/\s+/g, ' ')

  // Any literal duration in the page's own JSX is drift waiting to happen.
  assert.ok(!/\b\d+\s*(hour|hours|minute|minutes)\b/.test(prose),
    'the page must render the shared constant, never a hardcoded duration')
  assert.ok(!/time-limited/.test(prose),
    'no activation-page state may describe the lifetime vaguely as "time-limited"')
  // The superseded value must not reappear in any form.
  assert.ok(!/valid for 1 hour/.test(prose),
    'the 1-hour TTL was superseded on 2026-08-10')

  // The rule is stated in more than one state, and each must come from the
  // one constant. Two references: the confirm state and the invalid state.
  const refs = [...prose.matchAll(/ACTIVATION_PAGE_SENTENCE/g)]
  assert.ok(refs.length >= 3,
    `expected the shared sentence to be imported and rendered in at least the confirm and invalid states, found ${refs.length} references`)
})

test('the valid-link confirm state renders the canonical lifetime sentence', () => {
  // Slice the confirm branch specifically: it is the screen a user sees when
  // the link WORKS, and it is the one that regressed on 2026-08-10.
  const start = page.indexOf("status === 'confirm'")
  assert.ok(start > -1, 'the confirm state must exist')
  const next = page.indexOf("status === '", start + 20)
  const confirmBranch = page.slice(start, next > -1 ? next : page.length).replace(/\s+/g, ' ')

  assert.match(confirmBranch, /\{ACTIVATION_PAGE_SENTENCE\}/,
    'the confirm state must render the shared sentence')
  assert.ok(!/\b\d+\s*(hour|hours|minute|minutes)\b|time-limited/.test(confirmBranch),
    'the confirm state regressed to hardcoded or vague lifetime copy')
})

test('the invalid/expired state renders the same canonical sentence', () => {
  const start = page.indexOf("status === 'invalid'")
  assert.ok(start > -1, 'the invalid state must exist')
  const next = page.indexOf("status === '", start + 20)
  const branch = page.slice(start, next > -1 ? next : page.length).replace(/\s+/g, ' ')

  assert.match(branch, /\{ACTIVATION_PAGE_SENTENCE\}/)
  assert.ok(!/\b\d+\s*(hour|hours|minute|minutes)\b/.test(branch),
    'the expired screen must not restate the duration independently')
  // Recovery guidance states no duration of its own, so it cannot go stale.
  assert.match(page, /Always use the most recent email; earlier activation links stop working\./)
})

test('the portal grant date stays a separate statement from the link lifetime', async () => {
  const { portalInvitationEmail } = await import('../lib/server/email/portalInvitation.js')
  const withGrant = portalInvitationEmail({ firstName: 'Sam', activationLink: 'https://x/a#t', expiresAt: '2027-01-01', role: 'student' }).html
  assert.match(withGrant, /Your portal access itself is available through <strong>/)
  assert.match(withGrant, /January 1, 2027/)
  // Two different ideas, two different sentences - the defect this guards.
  // The link lifetime comes first, the months-away grant date second, so the
  // grant date can never be read as the activation deadline.
  assert.ok(withGrant.indexOf(ACTIVATION_LIFETIME_SENTENCE) < withGrant.indexOf('portal access itself'))
  // The grant date survives the TTL change untouched: it is a different fact.
  assert.match(withGrant, /January 1, 2027/)
  // No grant date, no access line - and the lifetime sentence still stands.
  const noGrant = portalInvitationEmail({ firstName: 'Sam', activationLink: 'https://x/a#t', role: 'student' }).html
  assert.ok(!/portal access itself is available through/.test(noGrant))
  assert.ok(noGrant.includes(ACTIVATION_LIFETIME_SENTENCE))
})

test('the copy refresh changed no authentication behavior', () => {
  // TTL, link generation, resend and supersession all live in the endpoint and
  // in Supabase - the templates are presentational and must stay that way.
  const tmpl = read('lib/server/email/portalInvitation.js')
  // Comment-stripped: the provenance note legitimately NAMES Supabase, so the
  // check must look at executable text, not prose.
  const code = tmpl.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.ok(!/generateLink\(|verifyOtp\(|createClient\(|from '@supabase/.test(code),
    'the template performs no auth work')
  // Provenance now lives with the copy itself, and must name the runtime
  // authority plus the configuration history that supersedes the old value.
  const lifetime = read('lib/server/activationLifetime.js')
  assert.match(lifetime, /mailer_otp_exp/, 'the provenance of the figure is recorded')
  assert.match(lifetime, /86400/, 'the current canonical value is recorded')
  assert.match(lifetime, /3600/, 'the superseded value is retained as history')
  assert.match(lifetime, /2026-08-10/, 'the supersession date is recorded')
  // The endpoint still mints links exactly as before.
  const endpoint = read('api/invite-portal-user.js')
  assert.match(endpoint, /type: 'invite'/)
  assert.match(endpoint, /type: 'recovery'/)
  assert.match(endpoint, /hashed_token/)
})

// STAFF-INVITE-CONTACTS-1: contact-aware Invite Staff User, aligned with Grant
// Portal Access, on the released scanner-safe invitation architecture.
//
// The staff invite previously had three problems this pins the fixes for:
//   1. it knew nothing about ASPIRE Connect contacts, so the Owner retyped
//      people who already existed as canonical records;
//   2. it used Supabase's default mailer (inviteUserByEmail) with the raw
//      consumable verify link, redirecting to the app ROOT - so a scanner could
//      burn the link, and a successful click created a session with NO password
//      (the exact lockout /auth/activate was built to fix);
//   3. it duplicated identities instead of reusing an existing auth user for a
//      portal-only person or a previously disabled staff account.
//
// Run: node --test test/inviteStaffContactAware.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ACTIVATION_LIFETIME_SENTENCE } from '../lib/server/activationLifetime.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const modal    = read('src/components/settings/InviteUserModal.jsx')
const suggest  = read('src/components/settings/ContactSuggest.jsx')
const portal   = read('src/components/settings/GrantPortalAccessModal.jsx')
const endpoint = read('api/invite-user.js')
const staffMail = read('lib/server/email/staffInvitation.js')

// ── ONE contacts source, ONE typeahead ───────────────────────────────────────

test('both modals share the same extracted contacts typeahead', () => {
  assert.match(suggest, /import \{ useContactSearch, contactSubtitle \} from '\.\.\/\.\.\/lib\/contactSearch'/)
  assert.match(modal, /import ContactSuggest from '\.\/ContactSuggest'/)
  assert.match(portal, /import ContactSuggest from '\.\/ContactSuggest'/)
  // No second copy of the component and no second contacts query.
  assert.doesNotMatch(portal, /function ContactSuggest\(/)
  assert.doesNotMatch(modal, /function ContactSuggest\(/)
  assert.doesNotMatch(modal, /from\('contacts'\)/)
})

test('the staff modal searches contacts by name AND email through the canonical helper', () => {
  assert.match(modal, /import \{ searchContacts \} from '\.\.\/\.\.\/lib\/contactSearch'/)
  assert.match(modal, /placeholder="Search contacts by name or email"/)
  // The canonical query already matches full_name, preferred_name and email.
  assert.match(read('src/lib/contactSearch.js'), /full_name\.ilike\.\$\{like\},preferred_name\.ilike\.\$\{like\},email\.ilike\.\$\{like\}/)
})

// ── Email-first resolution, safe ambiguity ───────────────────────────────────

test('an exact normalized-email match to exactly one contact fills the name', () => {
  assert.match(modal, /import \{ normalizeEmailForLookup \} from '\.\.\/\.\.\/lib\/emailUtils'/)
  assert.match(modal, /const exact = \(rows \|\| \[\]\)\.filter\(c => normalizeEmailForLookup\(c\.email\) === norm\)/)
  assert.match(modal, /if \(exact\.length === 1\) \{/)
})

test('two or more matches surface ambiguity instead of guessing', () => {
  assert.match(modal, /\} else if \(exact\.length > 1\) \{\n\s+setEmailAmbiguous\(exact\)/)
  assert.match(modal, /More than one saved contact uses that email\./)
  // Ambiguity is announced, not silent.
  assert.match(modal, /\{emailAmbiguous && \([\s\S]{0,200}role="alert"/)
})

// ── Manual entry and no silent mutation ──────────────────────────────────────

test('manual entry survives when no contact exists', () => {
  assert.match(suggest, /No matching contact found\. You can continue by entering the details manually\./)
  // The name field is a plain editable input in the linked state too.
  assert.match(modal, /aria-label="Staff member name for the invitation"/)
  assert.match(modal, /<button type="button" onClick=\{clearContactLink\}/)
})

test('selecting a contact never overwrites a typed email and never writes the contact', () => {
  assert.match(modal, /const tookEmail = !!c\.email && !email\.trim\(\)/)
  assert.match(modal, /setFromContact\(\{ name: true, email: tookEmail \}\)/)
  assert.match(modal, /From saved contact\{fromContact\.email \? ' · name and email' : ' · name'\}/)
  // No write of any kind to contacts from this modal.
  assert.doesNotMatch(modal, /\.update\(|\.insert\(|\.upsert\(/)
})

// ── Grant Portal Access parity ───────────────────────────────────────────────

test('Access role comes first and keeps the existing staff role options', () => {
  // Compare LABEL order inside the rendered form only; the header comment
  // naturally names the same fields in prose.
  const form = modal.slice(modal.indexOf("{step === 'form' && ("))
  const roleIdx = form.indexOf('>Access role<')
  const memberIdx = form.indexOf('>Staff member<')
  const emailIdx = form.indexOf('>Login email<')
  assert.ok(roleIdx > -1 && memberIdx > roleIdx && emailIdx > memberIdx, 'order: Access role, Staff member, Login email')
  assert.match(modal, /import \{ ROLE_OPTIONS, OWNER_NOT_ASSIGNABLE_NOTE \} from '\.\/accountsShared'/)
  // ROLE-GUIDE-1: the selector now states the consequence of the grant and
  // why Owner is not offered.
  assert.match(modal, /ROLE_OPTIONS\.find\(r => r\.value === role\)\?\.description/)
  assert.match(modal, /OWNER_NOT_ASSIGNABLE_NOTE/)
  assert.doesNotMatch(modal, /PORTAL_ROLE_OPTIONS/, 'portal roles never appear in the staff selector')
})

test('the staff banner states staff access, not scoped portal access', () => {
  assert.match(modal, /This grants <strong>staff application access<\/strong>, not scoped portal access\./)
  assert.match(portal, /This grants <strong>scoped portal access<\/strong>, not staff application access\./)
})

test('the login-email helper explains it does not mutate the contact', () => {
  assert.match(modal, /The login email is the staff sign-in identity\. It may be populated from the selected contact\. Changing it does not change the linked contact unless explicitly saved through ASPIRE Connect\./)
})

test('the two-step review flow mirrors the portal modal', () => {
  assert.match(modal, /const \[step, setStep\] = useState\('form'\)/)
  assert.match(modal, /onClick=\{\(\) => setStep\('review'\)\}[\s\S]{0,400}>Review<\/button>/)
  assert.match(modal, /Review staff access/)
  assert.match(modal, /Send invitation/)
  assert.match(modal, /\{step === 'review' && <ChevronLeft size=\{14\} \/>\}\{step === 'review' \? 'Back' : 'Cancel'\}/)
  // Same width and modal chrome as Grant Portal Access.
  assert.match(modal, /width: 'min\(500px, 100%\)', maxHeight: '92vh'/)
  assert.match(portal, /width: 'min\(500px, 100%\)', maxHeight: '92vh'/)
})

test('no non-functional date controls were added to staff access', () => {
  // Staff authorization is role + is_active + login_enabled, with no time
  // dimension: user_role_grants (which owns starts_at/expires_at) is
  // CHECK-constrained to portal roles. Date inputs here would collect values
  // nothing enforces. The decision is recorded in the handoff.
  assert.doesNotMatch(modal, /type="date"/)
  assert.doesNotMatch(modal, /expiresAt|startsAt/)
  assert.match(read('supabase/migrations/20260712000007_phase2_authz_foundation.sql'),
    /role\s+text\s+NOT NULL CHECK \(role IN \('student', 'unit_leader', 'academic_partner'\)\)/)
})

// ── Scanner-safe invitation reuse ────────────────────────────────────────────

test('the staff endpoint uses the scanner-safe hashed-token flow, not the default mailer', () => {
  // The CALL is gone (the header comment still explains why, by name).
  assert.doesNotMatch(endpoint, /admin\.inviteUserByEmail\(/)
  assert.match(endpoint, /function activationUrl\(hashedToken, type\)/)
  assert.match(endpoint, /appUrl\('\/auth\/activate'\)\}\?token_hash=\$\{encodeURIComponent\(hashedToken\)\}&type=\$\{encodeURIComponent\(type\)\}/)
  assert.match(endpoint, /activationUrl\(linkData\.properties\?\.hashed_token, 'invite'\)/)
  assert.match(endpoint, /activationUrl\(reissue\?\.properties\?\.hashed_token, 'recovery'\)/)
  assert.doesNotMatch(endpoint, /properties\?\.action_link/)
  // Lands on the password-creation screen, never the app root.
  assert.match(endpoint, /redirectTo: appUrl\('\/auth\/activate'\)/)
  assert.doesNotMatch(endpoint, /redirectTo: appUrl\(\),/)
})

test('the branded staff email carries the canonical single-use wording', async () => {
  // Rendered, not read from source: the sentence lives in the shared copy
  // module now, so a source grep would silently stop checking the real email.
  // Asserted through the shared constant because the duration moved from
  // 1 hour to 24 hours on 2026-08-10 and this test must track it, not restate it.
  const mod = await import('../lib/server/email/staffInvitation.js')
  const fn = mod.staffInvitationEmail || mod.default
  const html = fn({ firstName: 'Ada', activationLink: 'https://x/auth/activate#t', role: 'admin' }).html
  assert.ok(html.includes(ACTIVATION_LIFETIME_SENTENCE))
  assert.match(html, /When a new link is issued, earlier activation links stop working, so always use the most recent email\./)
  assert.match(endpoint, /import \{ staffInvitationEmail \}/)
  assert.match(endpoint, /replyTo: EMAIL_REPLY_TO/)
  // Staff Access has no expiration, so the rendered email states none.
  assert.doesNotMatch(html, /portal access itself is available through/)
  assert.ok(!/\b\d+\s*(hour|hours|minute|minutes)\b/.test(staffMail),
    'the staff template must render the shared sentence, never a hardcoded duration')
})

// ── Duplicate and existing-identity handling ─────────────────────────────────

test('an active staff account is a conflict, not a duplicate invitation', () => {
  assert.match(endpoint, /const hasActiveStaff = !!existingProfile/)
  assert.match(endpoint, /That email already has an active staff account\./)
  assert.match(endpoint, /return res\.status\(409\)/)
})

test('an existing identity is reused; a second auth user is never created', () => {
  assert.match(endpoint, /let newUserId = existingProfile\?\.auth_user_id \|\| null;/)
  assert.match(endpoint, /if \(newUserId\) \{/)
  // Portal-only / disabled-staff people keep their identity and are re-enabled.
  assert.match(endpoint, /is_active: true,\n\s+full_name: fullName,/)
  // An established password means no activation link is sent at all.
  assert.match(endpoint, /needsActivation = existingUser\?\.user\?\.user_metadata\?\.password_set !== true/)
  assert.match(endpoint, /already has a password, so they can sign in with their existing credentials/)
  // Nothing is ever deleted to make an invitation work.
  assert.doesNotMatch(endpoint, /deleteUser|\.delete\(\)/)
})

test('the endpoint reports send outcomes honestly and records privacy-safe events', () => {
  assert.match(endpoint, /email_sent: emailSent,/)
  assert.match(endpoint, /The invitation email could not be sent; please resend\./)
  assert.match(endpoint, /async function recordStaffInviteEvent/)
  for (const ev of ['invite_requested', 'link_generated', 'email_send_attempted', 'email_sent', 'email_send_failed']) {
    assert.match(endpoint, new RegExp(`'${ev}'`), `records ${ev}`)
  }
  // Bounded window over the ledger writer itself: its insert must carry only
  // the allowlisted diagnostic fields.
  const start = endpoint.indexOf('async function recordStaffInviteEvent')
  const ledger = endpoint.slice(start, endpoint.indexOf('}', endpoint.indexOf('catch { /* diagnostics never block', start)))
  assert.doesNotMatch(ledger, /token|hash|activationLink/i, 'no secrets in the ledger writer')
  assert.doesNotMatch(endpoint, /console\.log\([^)]*activationLink/)
  assert.doesNotMatch(endpoint, /console\.log\([^)]*hashed_token/)
})

// ── Accessibility and unchanged neighbors ────────────────────────────────────

test('the combobox keeps its accessible contract and Escape/focus behavior', () => {
  assert.match(suggest, /role="combobox" aria-expanded=\{open && rows\.length > 0\} aria-controls=\{listboxId\} aria-autocomplete="list"/)
  assert.match(suggest, /aria-activedescendant=/)
  assert.match(suggest, /else if \(e\.key === 'Escape'\) \{ if \(open\) \{ e\.preventDefault\(\); setOpen\(false\) \} \}/)
  // Escape closes the modal only when the list is not open, and never mid-send.
  assert.match(modal, /if \(e\.key === 'Escape' && !loading\) onClose\?\.\(\)/)
  assert.match(modal, /firstFieldRef\.current\?\.focus\(\)/)
})

test('Grant Portal Access behavior and the staff invite contract are unchanged', () => {
  // Portal modal still posts its own payload to its own endpoint.
  assert.match(portal, /fetch\('\/api\/invite-portal-user'/)
  // Staff modal still posts exactly { email, full_name, role }.
  assert.match(modal, /body: JSON\.stringify\(\{ email: email\.trim\(\), full_name: fullName\.trim\(\), role \}\)/)
  assert.match(modal, /fetch\('\/api\/invite-user'/)
  assert.match(modal, /onInvited\?\.\(\)/)
})

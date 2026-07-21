// ASPIRE-STUDENT-PORTAL: branded invitation email tests. Pure tests for the
// email builder plus static-source guards on the invite endpoint (generateLink
// instead of the default Supabase mailer, branded Resend send, and the raw
// activation link never logged or returned to the client).
// Run: node --test test/portalInvitationEmail.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { portalInvitationEmail, PORTAL_INVITE_SUBJECT } from '../lib/server/email/portalInvitation.js'

const here = dirname(fileURLToPath(import.meta.url))
const endpoint = readFileSync(join(here, '../api/invite-portal-user.js'), 'utf8')

test('portalInvitationEmail is ASPIRE-branded and embeds the activation link', async (t) => {
  // Explicitly the STUDENT role now that the builder is role aware. This test
  // predates roles; leaving the role off would assert student copy from the
  // neutral fallback, which is the coupling the role layer removed.
  const out = portalInvitationEmail({ firstName: 'Jae', role: 'student', activationLink: 'https://auth.example/verify?token=SECRET123', expiresAt: '2026-08-01T00:00:00Z' })
  await t.test('official subject', () => {
    assert.equal(out.subject, PORTAL_INVITE_SUBJECT)
    assert.match(out.subject, /ASPIRE Student Portal/)
  })
  await t.test('Cedars-Sinai + ASPIRE branding and greeting', () => {
    assert.match(out.html, /ASPIRE/)
    assert.match(out.html, /Cedars-Sinai/)
    assert.match(out.html, /Hello Jae/)
  })
  await t.test('primary activation button and the raw link', () => {
    assert.match(out.html, /Activate My Account/)
    assert.match(out.html, /token=SECRET123/)
  })
  await t.test('security note, support email, expiration, and public site', () => {
    assert.match(out.html, /intended only for you/)
    assert.match(out.html, /aspire@cshs\.org/)
    assert.match(out.html, /August 1, 2026/)
    assert.match(out.html, /aspireintelligence\.app/)
  })
  await t.test('escapes contact fields (no HTML injection)', () => {
    const evil = portalInvitationEmail({ firstName: '<script>x</script>', activationLink: 'https://x/y' })
    assert.doesNotMatch(evil.html, /<script>x<\/script>/)
  })
})

test('invite endpoint sends the branded email, not the default Supabase mailer', async (t) => {
  await t.test('uses generateLink (no default invite email) instead of inviteUserByEmail', () => {
    assert.match(endpoint, /admin\.generateLink\(\{\s*[\s\S]*?type: 'invite'/)
    assert.doesNotMatch(endpoint, /inviteUserByEmail/)
    assert.match(endpoint, /action_link/)
  })
  await t.test('sends via the ASPIRE Resend helper with a support reply-to', () => {
    assert.match(endpoint, /import \{ Resend \} from 'resend'/)
    assert.match(endpoint, /portalInvitationEmail/)
    assert.match(endpoint, /replyTo: EMAIL_REPLY_TO/)
    assert.match(endpoint, /const EMAIL_REPLY_TO = 'aspire@cshs\.org'/)
    // Sends for a newly created account OR a reissued activation for an existing
    // auth user who never completed password setup. Re-granting to an already
    // activated account still sends nothing.
    assert.match(endpoint, /if \(activationLink && \(createdAuthUser \|\| needsActivation\)\)/)
  })
  await t.test('never logs or returns the raw activation link', () => {
    // The link is embedded in the email only; it must not appear in any console.log or res.json.
    assert.doesNotMatch(endpoint, /console\.log\([^)]*activationLink/)
    assert.doesNotMatch(endpoint, /console\.log\([^)]*action_link/)
    assert.doesNotMatch(endpoint, /res\.(status\(\d+\)\.)?json\([^)]*activationLink/)
    assert.doesNotMatch(endpoint, /json\(\{[^}]*action_link/)
  })
  await t.test('mail failure is sanitized and does not roll back the account', () => {
    assert.match(endpoint, /branded invite email failed/)
    assert.match(endpoint, /email_sent: emailSent/)
    // A mail failure returns success with email_sent:false, not a compensation delete.
    assert.match(endpoint, /emailSent\s*\?\s*'Portal invitation sent and access granted\.'/)
  })
  await t.test('no service-role key or raw provider error is returned to the client', () => {
    assert.doesNotMatch(endpoint, /json\([^)]*SERVICE_ROLE/i)
    assert.doesNotMatch(endpoint, /json\([^)]*emailErr\.message/)
  })
})

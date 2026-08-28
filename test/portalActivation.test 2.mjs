// ACTIVATION: guards for role-aware invitations and first-time password setup.
//
// Two production defects are covered here, and each test is written so that
// reintroducing the defect fails it:
//
//   1. The invitation was hardcoded to Student Portal copy, so a Unit Leader was
//      told to "track your clinical hours" and "log shifts".
//   2. The invite redirected to /portal. Supabase established a session from the
//      token, so access worked but NO PASSWORD WAS EVER SET, and the first
//      sign-out locked the user out.
//
// Pure-function tests for the email builder, static-source guards for the
// endpoint and the activation screen. No jsdom and no new test dependency.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { portalInvitationEmail, inviteCopyForRole, PORTAL_INVITE_SUBJECT } from '../lib/server/email/portalInvitation.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const endpoint = read('api/invite-portal-user.js')
const page     = read('src/pages/ActivateAccountPage.jsx')
const app      = read('src/App.jsx')
const reset    = read('src/pages/ResetPasswordPage.jsx')

const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const endpointCode = stripJs(endpoint)
const pageCode     = stripJs(page)

const LINK = 'https://auth.example/verify?token=SECRET123'
const build = (role) => portalInvitationEmail({ firstName: 'Jae', role, activationLink: LINK })

// Student-only language that must never reach a non-student invitation.
const STUDENT_ONLY = [
  'Student Portal', 'clinical hours', 'log shifts', 'your placement',
  'your Cedars-Sinai clinical rotation',
]

// ── Defect 1: role-aware invitation copy ────────────────────────────────────
test('the Unit Leader invitation uses Unit Leader copy', () => {
  const out = build('unit_leader')
  assert.match(out.subject, /Unit Leader Portal/)
  assert.match(out.html, /ASPIRE Unit Leader Portal/)
  for (const phrase of ['placement requests', 'capacity', 'preceptors', 'report a concern']) {
    assert.match(out.html.toLowerCase(), new RegExp(phrase),
      `Unit Leader copy must mention ${phrase}`)
  }
})

test('the Unit Leader invitation contains NO student language', () => {
  const out = build('unit_leader')
  for (const phrase of STUDENT_ONLY) {
    assert.ok(!out.html.includes(phrase),
      `Unit Leader invitation must not say "${phrase}"`)
    assert.ok(!out.subject.includes(phrase),
      `Unit Leader subject must not say "${phrase}"`)
  }
})

test('the Student invitation copy is unchanged', () => {
  const out = build('student')
  assert.equal(out.subject, PORTAL_INVITE_SUBJECT)
  assert.match(out.subject, /ASPIRE Student Portal/)
  assert.match(out.html, /ASPIRE Student Portal/)
  assert.match(out.html, /track your clinical hours, log shifts/)
})

test('the Academic Partner invitation uses its own copy', () => {
  const out = build('academic_partner')
  assert.match(out.subject, /Academic Partner Portal/)
  assert.match(out.html, /ASPIRE Academic Partner Portal/)
  assert.ok(!out.html.includes('log shifts'))
})

test('every role gets a distinct subject, heading, and body', () => {
  const roles = ['student', 'unit_leader', 'academic_partner']
  const subjects = roles.map(r => build(r).subject)
  const bodies = roles.map(r => build(r).html)
  assert.equal(new Set(subjects).size, roles.length, 'subjects must differ per role')
  assert.equal(new Set(bodies).size, roles.length, 'bodies must differ per role')
})

test('an unknown role falls back to neutral copy, never to student copy', () => {
  // Defaulting an unrecognized role to student wording is the original defect.
  for (const role of [undefined, null, '', 'preceptor', 'nope']) {
    const out = portalInvitationEmail({ firstName: 'Jae', role, activationLink: LINK })
    assert.ok(!out.html.includes('log shifts'),
      `role ${String(role)} must not receive student copy`)
    assert.ok(!out.subject.includes('Student Portal'))
    assert.match(out.subject, /ASPIRE Portal/)
  }
  assert.equal(inviteCopyForRole('nope').portalName, 'ASPIRE Portal')
})

test('every role keeps the same shell, sender identity, and support address', () => {
  for (const role of ['student', 'unit_leader', 'academic_partner']) {
    const out = build(role)
    assert.match(out.html, /Cedars-Sinai/)
    assert.match(out.html, /aspire@cshs\.org/)
    assert.match(out.html, /token=SECRET123/)
    assert.equal(out.supportEmail, 'aspire@cshs.org')
  }
  assert.match(endpoint, /const EMAIL_FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program\.com>'/)
  assert.match(endpoint, /replyTo: EMAIL_REPLY_TO/)
})

test('the invitation states that access is time limited and needs a password', () => {
  const out = portalInvitationEmail({
    firstName: 'Jae', role: 'unit_leader', activationLink: LINK, expiresAt: '2026-08-01T00:00:00Z',
  })
  assert.match(out.html, /time-limited/)
  assert.match(out.html, /create your password/)
  assert.match(out.html, /August 1, 2026/)
  assert.match(out.html, /intended only for you/)
})

test('the role is passed from the endpoint into the template', () => {
  assert.match(endpointCode, /portalInvitationEmail\(\{ firstName, activationLink, expiresAt, role \}\)/)
  assert.match(endpointCode, /role: portalRole,/)
})

// ── Defect 2: first-time password setup ─────────────────────────────────────
test('the invite redirect lands on activation, NOT directly on the portal', () => {
  assert.match(endpointCode, /redirectTo: appUrl\('\/auth\/activate'\)/)
  assert.ok(!/redirectTo: appUrl\('\/portal'\)/.test(endpointCode),
    'redirecting an invite to /portal is the defect: it grants access with no password')
})

test('the activation route is mounted above the wildcard', () => {
  const activate = app.indexOf('path="/auth/activate"')
  const wildcard = app.indexOf('path="/*"')
  assert.ok(activate > -1, 'the /auth/activate route must exist')
  assert.ok(wildcard > -1)
  assert.ok(activate < wildcard,
    'activation must resolve before the authed shell, or the invitee falls through with no password')
  assert.match(app, /import ActivateAccountPage from '\.\/pages\/ActivateAccountPage'/)
})

test('the portal is only reachable after the password is created', () => {
  // The navigate to /portal must live in the success branch, after updateUser.
  const success = pageCode.indexOf("status === 'success'")
  const nav = pageCode.indexOf("navigate('/portal'")
  assert.ok(nav > -1, 'activation must route onward to the portal')
  assert.ok(success > -1 && nav > success,
    'the portal navigation must sit inside the success state, never before it')
  // And there must be no other escape hatch to the portal from this screen.
  assert.equal((pageCode.match(/navigate\('\/portal'/g) || []).length, 1)
})

test('activation uses the supported Supabase password-update method', () => {
  assert.match(pageCode, /supabase\.auth\.updateUser\(\{\s*password: newPassword/)
})

test('a completion marker is stamped so a later reissue can tell the difference', () => {
  assert.match(pageCode, /password_set: true/)
  assert.match(endpointCode, /user_metadata\?\.password_set !== true/)
})

test('the password is confirmed and length checked before submission', () => {
  assert.match(pageCode, /newPassword !== confirmPassword/)
  assert.match(pageCode, /newPassword\.length < MIN_LEN/)
  assert.match(pageCode, /const MIN_LEN = 8/)
})

test('expired, used, malformed, and missing links all resolve safely', () => {
  // A consumed or malformed link returns an error fragment rather than a session.
  assert.match(pageCode, /error=\|error_code=\|error_description=/)
  assert.match(pageCode, /initialLinkError \? 'invalid'/)
  // No session and no marker is the missing-link case.
  assert.match(pageCode, /promote\(data\?\.session \? 'form' : 'invalid'\)/)
  // A failed update is reported as expired-or-used, not as a crash.
  assert.match(pageCode, /may have expired or already been used/)
})

test('both invite and reissued recovery links are accepted', () => {
  assert.match(pageCode, /type=\(invite\|recovery\|signup\)/,
    'a reissued activation arrives as type=recovery and means the same thing')
})

test('an existing auth user who never activated still gets a link', () => {
  // Before the fix this path sent nothing at all, stranding the account.
  assert.match(endpointCode, /type: 'recovery'/)
  assert.match(endpointCode, /if \(activationLink && \(createdAuthUser \|\| needsActivation\)\)/)
  assert.match(endpointCode, /getUserById\(authUserId\)/)
})

test('an unknown activation state fails toward sending, not toward a lockout', () => {
  const branch = endpointCode.slice(endpointCode.indexOf('getUserById'), endpointCode.indexOf('} else {'))
  assert.match(branch, /catch \{[\s\S]*?needsActivation = true/,
    'if we cannot tell, send the link: silence locks someone out')
})

// ── No enumeration, no token leakage ────────────────────────────────────────
test('the activation screen never reveals whether an account exists', () => {
  for (const leak of ['No account', 'not found', 'no such user', 'unregistered', 'does not exist']) {
    assert.ok(!page.includes(leak), `the activation screen must not say "${leak}"`)
  }
  // The invalid state offers the same generic recovery route to everyone.
  assert.match(pageCode, /Activation links are time-limited and can be used once/)
})

test('no token or activation link is ever rendered or logged', () => {
  assert.ok(!/window\.location\.hash\s*\}/.test(pageCode), 'never render the URL fragment')
  assert.doesNotMatch(pageCode, /console\.log/)
  assert.doesNotMatch(endpointCode, /console\.log\([^)]*activationLink/)
  assert.doesNotMatch(endpointCode, /console\.log\([^)]*action_link/)
  assert.doesNotMatch(endpointCode, /json\([^)]*activationLink/)
})

// ── No regression to existing auth surfaces ─────────────────────────────────
test('the password recovery screen is untouched and still its own route', () => {
  assert.match(app, /path="\/auth\/reset-password"/)
  assert.match(reset, /supabase\.auth\.updateUser\(\{ password: newPassword \}\)/)
  // Recovery still signs out afterward; activation deliberately does not, because
  // the invitee should continue straight into their portal.
  assert.match(reset, /await supabase\.auth\.signOut\(\)/)
  assert.ok(!pageCode.includes('signOut'),
    'activation keeps the session so the user is not asked to sign in twice')
})

test('staff invitations and the staff app are not touched by this change', () => {
  const staffInvite = read('api/invite-user.js')
  assert.ok(!staffInvite.includes('/auth/activate'),
    'the staff invitation path is deliberately unchanged in this pass')
})

test('portal role routing still decides the destination, not the activation page', () => {
  // Activation sends everyone to /portal; PortalApp resolves the actual portal
  // from active role grants, so no role logic is duplicated here.
  assert.ok(!pageCode.includes('unit_leader'))
  assert.ok(!pageCode.includes('user_role_grants'))
  const portalApp = read('src/portal/PortalApp.jsx')
  assert.match(portalApp, /roles\.includes\('unit_leader'\)/)
  assert.match(portalApp, /roles\.includes\('student'\)/)
})

// ── House style ─────────────────────────────────────────────────────────────
test('no em dash in the activation sources', () => {
  const EM_DASH = String.fromCharCode(0x2014)
  for (const [name, src] of [['page', page], ['endpoint', endpoint],
    ['template', read('lib/server/email/portalInvitation.js')]]) {
    assert.ok(!src.includes(EM_DASH), `${name} must not contain an em dash`)
  }
})

// ASPIRE-PORTAL-NAV: pure-logic tests for the portal-aware compose routing.
// Recognized Microsoft 365 logins open Outlook Web in a new tab; others use a
// separate-tab mailto. The current tab is never navigated.
// Run: node --test test/portalEmailCompose.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MICROSOFT_365_DOMAINS, emailDomain, isMicrosoft365Email,
  buildOutlookComposeUrl, buildMailtoUrl, composePortalEmail,
} from '../src/lib/outlookCompose.js'

// Minimal window stub: window.open('', '_blank') returns a fake tab whose
// location.href we can read; blocked mode returns null. The app tab's own
// location must never be touched.
function installWindow({ blocked = false } = {}) {
  const opened = []
  const appLocation = { href: 'https://aspireintelligence.app/portal' }
  global.window = {
    location: appLocation,
    open() {
      if (blocked) return null
      const w = { opener: {}, location: { href: '' } }
      opened.push(w)
      return w
    },
  }
  return { opened, appLocation }
}
function uninstallWindow() { delete global.window }

test('domain recognition', async (t) => {
  await t.test('waldenu.edu and cshs.org are Microsoft 365', () => {
    assert.ok(MICROSOFT_365_DOMAINS.has('waldenu.edu'))
    assert.ok(MICROSOFT_365_DOMAINS.has('cshs.org'))
    assert.equal(isMicrosoft365Email('jesterlloyd.bautista@waldenu.edu'), true)
    assert.equal(isMicrosoft365Email('someone@cshs.org'), true)
  })
  await t.test('other domains are not', () => {
    assert.equal(isMicrosoft365Email('student@gmail.com'), false)
    assert.equal(isMicrosoft365Email('x@ionos.com'), false)
    assert.equal(isMicrosoft365Email(''), false)
    assert.equal(emailDomain('A.B@Waldenu.EDU'), 'waldenu.edu')
  })
})

test('URL builders encode correctly and carry no identifiers', () => {
  const url = buildOutlookComposeUrl({ to: 'aspire@cshs.org', subject: 'ASPIRE Student Support Request', body: 'Name: Jae Doe\nSchool: CSULB' })
  assert.ok(url.startsWith('https://outlook.office.com/mail/deeplink/compose'))
  assert.match(url, /to=aspire%40cshs\.org/)
  assert.match(url, /subject=ASPIRE%20Student%20Support%20Request/)
  assert.match(url, /body=Name%3A%20Jae%20Doe/)
  for (const id of ['student_id', 'auth_user_id', 'user_profile_id', 'grant']) assert.ok(!url.includes(id))
  assert.match(buildMailtoUrl({ to: 'aspire@cshs.org', subject: 'S', body: 'B' }), /^mailto:aspire@cshs\.org\?subject=S&body=B$/)
})

test('composePortalEmail routing', async (t) => {
  await t.test('Walden login opens Outlook Web in a new tab; app tab untouched', () => {
    const { opened, appLocation } = installWindow()
    try {
      const res = composePortalEmail({ to: 'aspire@cshs.org', subject: 'ASPIRE Student Support Request', body: 'Name: Jae', loginEmail: 'jesterlloyd.bautista@waldenu.edu' })
      assert.equal(res.mode, 'outlook')
      assert.equal(res.opened, true)
      assert.equal(res.loginEmail, 'jesterlloyd.bautista@waldenu.edu')
      assert.equal(opened.length, 1)
      assert.ok(opened[0].location.href.startsWith('https://outlook.office.com/mail/deeplink/compose'))
      assert.equal(opened[0].opener, null, 'opener severed')
      assert.equal(appLocation.href, 'https://aspireintelligence.app/portal', 'current tab not navigated')
    } finally { uninstallWindow() }
  })
  await t.test('cshs.org login uses Outlook, not mailto', () => {
    const { opened } = installWindow()
    try {
      const res = composePortalEmail({ to: 'aspire@cshs.org', subject: 'S', body: 'B', loginEmail: 'nurse@cshs.org' })
      assert.equal(res.mode, 'outlook')
      assert.ok(!opened[0].location.href.startsWith('mailto:'))
    } finally { uninstallWindow() }
  })
  await t.test('unknown domain uses the separate-tab mailto fallback', () => {
    const { opened, appLocation } = installWindow()
    try {
      const res = composePortalEmail({ to: 'aspire@cshs.org', subject: 'S', body: 'B', loginEmail: 'student@gmail.com' })
      assert.equal(res.mode, 'mailto')
      assert.equal(res.opened, true)
      assert.ok(opened[0].location.href.startsWith('mailto:aspire@cshs.org'))
      assert.equal(appLocation.href, 'https://aspireintelligence.app/portal', 'current tab not navigated')
    } finally { uninstallWindow() }
  })
  await t.test('blocked popup reports opened:false and never navigates the app tab', () => {
    const { appLocation } = installWindow({ blocked: true })
    try {
      const outlook = composePortalEmail({ to: 'aspire@cshs.org', subject: 'S', body: 'B', loginEmail: 'x@waldenu.edu' })
      const mailto = composePortalEmail({ to: 'aspire@cshs.org', subject: 'S', body: 'B', loginEmail: 'x@gmail.com' })
      assert.equal(outlook.opened, false)
      assert.equal(mailto.opened, false)
      assert.equal(appLocation.href, 'https://aspireintelligence.app/portal')
    } finally { uninstallWindow() }
  })
})

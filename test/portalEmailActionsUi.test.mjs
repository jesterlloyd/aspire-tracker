// ASPIRE-PORTAL-NAV: static-source guards for the portal Contact ASPIRE and
// Request a correction actions using the centralized compose helper, plus the
// consistent "Public site" label.
// Run: node --test test/portalEmailActionsUi.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const portal = read('src/portal/StudentPortal.jsx')
const drawer = read('src/portal/EditProfileDrawer.jsx')
const login = read('src/pages/Login.jsx')
const shell = read('src/portal/PortalShell.jsx')

test('Contact ASPIRE uses the centralized compose helper', async (t) => {
  await t.test('imports and calls composePortalEmail (no ad hoc mailto in the component)', () => {
    assert.match(portal, /import \{ composePortalEmail \} from '\.\.\/lib\/outlookCompose'/)
    assert.match(portal, /composePortalEmail\(\{ to: SUPPORT, subject: CONTACT_SUBJECT, body, loginEmail \}\)/)
    assert.doesNotMatch(portal, /href=\{mailto\}/, 'no leftover mailto anchors')
    assert.doesNotMatch(portal, /`mailto:\$\{SUPPORT\}\?subject/, 'no inline mailto URL building')
  })
  await t.test('login email comes from the authenticated session', () => {
    assert.match(portal, /const \{ user \} = useAuth\(\)/)
    assert.match(portal, /const loginEmail = user\?\.email/)
  })
  await t.test('body carries only approved, non-sensitive context', () => {
    assert.match(portal, /function buildContactBody/)
    assert.match(portal, /Name: \$\{name \|\| 'not available'\}/)
    assert.match(portal, /ASPIRE status: \$\{status/)
    for (const id of ['student_id', 'auth_user_id', 'user_profile_id']) {
      assert.doesNotMatch(portal, new RegExp(`buildContactBody[\\s\\S]{0,400}${id}`), `body must not include ${id}`)
    }
  })
  await t.test('shows the Outlook confirm-your-account note and the blocked fallback', () => {
    assert.match(portal, /Compose opened in Outlook\. Confirm you are sending from \$\{compose\.loginEmail\}/)
    assert.match(portal, /Your browser blocked the email window\. Allow pop-ups or copy /)
    assert.match(portal, /Copy email address/)
    assert.match(portal, /Copy message/)
  })
  await t.test('actions are buttons with new-tab accessible names; nothing logs the composed url', () => {
    assert.match(portal, /aria-label="Contact ASPIRE \(opens an email compose in a new tab\)"/)
    assert.doesNotMatch(portal, /console\.log\([^)]*(body|url|compose)/i)
  })
})

test('Request a correction uses the centralized compose helper', async (t) => {
  await t.test('imports and calls composePortalEmail with the login email', () => {
    assert.match(drawer, /import \{ composePortalEmail \} from '\.\.\/lib\/outlookCompose'/)
    assert.match(drawer, /composePortalEmail\(\{ to: SUPPORT, subject: CORRECTION_SUBJECT, body, loginEmail \}\)/)
    assert.match(drawer, /loginEmail = ''/, 'drawer receives the login email as a prop')
    assert.doesNotMatch(drawer, /href=\{correctionMailto/, 'no leftover mailto anchor')
  })
  await t.test('correction subject and non-sensitive body', () => {
    assert.match(drawer, /const CORRECTION_SUBJECT = 'ASPIRE Student Profile Correction Request'/)
    assert.match(drawer, /function buildCorrectionBody/)
    assert.doesNotMatch(drawer, /buildCorrectionBody[\s\S]{0,300}student_id/)
  })
  await t.test('the drawer is passed the login email from the portal', () => {
    assert.match(portal, /<EditProfileDrawer open=\{editOpen\} student=\{student\} loginEmail=\{loginEmail\}/)
  })
})

test('Consistent "Public site" label', async (t) => {
  await t.test('login screen renders "Public site" with the left-arrow, not "Back..."', () => {
    assert.match(login, /<span aria-hidden="true">←<\/span> Public site/)
    assert.doesNotMatch(login, /Back to the ASPIRE site/)
  })
  await t.test('portal profile menu keeps "Public site"', () => {
    assert.match(shell, /<ExternalLink size=\{15\} \/> Public site/)
  })
  await t.test('no inconsistent public-site label remains anywhere in src', () => {
    const hits = execSync(
      `grep -rEl "Back to the ASPIRE site|Back to public site|Back to the public site" ${join(here, '../src')} || true`,
      { encoding: 'utf8' },
    ).trim()
    assert.equal(hits, '', `stale label found in: ${hits}`)
  })
})

// ASPIRE-STUDENT-PORTAL: static-source guards for the redesigned Student Portal,
// the shell header, and the edit drawer.
// Run: node --test test/studentPortalUi.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const portal = read('src/portal/StudentPortal.jsx')
const shell = read('src/portal/PortalShell.jsx')
const drawer = read('src/portal/EditProfileDrawer.jsx')
const css = read('src/portal/portal.css')

test('Student Portal redesign', async (t) => {
  await t.test('profile hero with avatar and initials fallback', () => {
    assert.match(portal, /ptl-hero/)
    assert.match(portal, /ptl-avatar/)
    assert.match(portal, /function initials/)
    assert.match(portal, /student\.headshot_url \? <img[\s\S]*?: initials\(fullName\)/)
  })

  await t.test('Edit Profile action opens the drawer', () => {
    assert.match(portal, /Edit Profile/)
    assert.match(portal, /onOpenEdit/)
    assert.match(portal, /<EditProfileDrawer open=\{editOpen\}/)
  })

  await t.test('Log a Shift routes to /shift-log with no student identifiers in the URL', () => {
    assert.match(portal, /href="\/shift-log"/)
    assert.doesNotMatch(portal, /shift-log\?[^"']*(student|id|email)/i)
  })

  await t.test('Contact ASPIRE composes to aspire@cshs.org via the centralized helper', () => {
    assert.match(portal, /composePortalEmail\(\{ to: SUPPORT, subject: CONTACT_SUBJECT/)
    assert.match(portal, /const SUPPORT = 'aspire@cshs\.org'/)
    assert.match(portal, /const CONTACT_SUBJECT = 'ASPIRE Student Support Request'/)
  })

  await t.test('sections carry meaningful icons (Placement, Hours, Next Steps, Evaluations, Shift logs, Support)', () => {
    for (const icon of ['MapPin', 'Clock', 'ListChecks', 'ClipboardCheck', 'CalendarPlus', 'LifeBuoy']) {
      assert.match(portal, new RegExp(`\\b${icon}\\b`), `missing icon ${icon}`)
    }
    assert.match(portal, /Need help\?/)
  })

  await t.test('dates use the null-safe helpers (no raw Invalid Date rendering)', () => {
    assert.match(portal, /import \{ fmtDate, placementWindow, TBC \} from '\.\.\/lib\/portalDates'/)
    assert.match(portal, /placementWindow\(student\.cohort, student\.term_dates\)/)
    assert.doesNotMatch(portal, /toLocaleDateString/, 'formatting goes through portalDates, not inline')
  })

  await t.test('clinical-hours progress bar renders only with reliable data', () => {
    assert.match(portal, /const hoursReliable = Number\.isFinite\(required\) && required > 0 && Number\.isFinite\(approved\)/)
    assert.match(portal, /hoursReliable \? \(/)
  })

  await t.test('a mobile sticky action bar exists and no service-role reference', () => {
    assert.match(portal, /ptl-actionbar/)
    assert.doesNotMatch(portal, /SERVICE_ROLE|service_role/i)
  })
})

test('PortalShell mobile header', async (t) => {
  await t.test('profile menu holds name, Edit Profile, Public site, Sign out', () => {
    assert.match(shell, /function ProfileMenu/)
    assert.match(shell, /ptl-menu-name/)
    assert.match(shell, /Edit Profile/)
    assert.match(shell, /Public site/)
    assert.match(shell, /Sign out/)
    assert.match(shell, /aria-haspopup="menu"/)
  })

  await t.test('the previous overcrowded header actions are gone', () => {
    // No inline full-name span, Public-site link, and Sign-out button rendered directly in the header row.
    assert.doesNotMatch(shell, /ptl-header-name/)
    assert.doesNotMatch(shell, /className="ptl-header-link"/)
    assert.doesNotMatch(shell, /ptl-btn-outline ptl-btn-sm" onClick=\{signOut\}/)
  })

  await t.test('header and action bar respect iOS safe-area insets', () => {
    assert.match(css, /env\(safe-area-inset-top\)/)
    assert.match(css, /env\(safe-area-inset-bottom\)/)
    assert.match(css, /\.ptl-actionbar \{ display: none; \}/, 'action bar hidden on desktop')
  })
})

test('EditProfileDrawer boundaries', async (t) => {
  await t.test('edits only preferred name and phone via the secure endpoint', () => {
    assert.match(drawer, /\/api\/portal\/update-profile/)
    assert.match(drawer, /preferred_first_name: preferred\.trim\(\), phone: phone\.trim\(\)/)
  })
  await t.test('authoritative fields are read-only with a Request a correction action', () => {
    assert.match(drawer, /Managed by ASPIRE/)
    assert.match(drawer, /Request a correction/)
    assert.match(drawer, /const requestCorrection = /)
  })
  await t.test('focus is trapped and returns on close; no authz-table writes', () => {
    assert.match(drawer, /e\.key === 'Escape'/)
    assert.match(drawer, /data-drawer-initial/)
    for (const tbl of ['user_role_grants', 'user_student_links']) {
      assert.doesNotMatch(drawer, new RegExp(`from\\('${tbl}'\\)`), `must not touch ${tbl}`)
    }
  })
})

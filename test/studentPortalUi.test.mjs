// ASPIRE-COMPASS: static-source guards for the Student Portal home, shell,
// navigation, and edit drawer. These preserve the security and behavior
// intents of the pre-Compass suite (endpoint safety, derived-data
// discipline, drawer boundaries) against the Compass structure (orientation
// band, merged Hours & shifts, single bottom tab bar, student vocabulary).
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
const nav = read('src/portal/PortalNav.jsx')
const drawer = read('src/portal/EditProfileDrawer.jsx')
const css = read('src/portal/portal.css')

test('the Compass orientation band', async (t) => {
  await t.test('identity with avatar and initials fallback', () => {
    assert.match(portal, /ptl-compass-id/)
    assert.match(portal, /function initials/)
    // WAVE F-2: the own headshot now resolves through the portal access endpoint
    // (server-mediated signed URL); the photo-or-initials fallback is unchanged.
    assert.match(portal, /ownHeadshotUrl \? <img[\s\S]*?: initials\(fullName\)/)
  })

  await t.test('the welcome name and stage are the Fraunces moments', () => {
    assert.match(css, /\.ptl-compass-name \{[\s\S]*?font-family: var\(--ptl-serif\)/)
    assert.match(css, /\.ptl-compass-stage \{[\s\S]*?font-family: var\(--ptl-serif\)/)
  })

  await t.test('the stage derives ONLY from reliable status data', () => {
    assert.match(portal, /deriveHeroStage\(student\.status\)/)
    assert.match(portal, /derivePortalTimeline\(\{ status: student\.status/)
  })

  await t.test('attention items derive from real records and stay quiet at zero', () => {
    assert.match(portal, /deriveAttentionItems\(\{ unreadMessages: unread, evaluations: myEvals, shiftLogs: myLogs \}\)/)
    assert.match(portal, /\{attention\.length > 0 && \(/)
  })

  await t.test('the ONE primary action is stage-derived, never invented', () => {
    assert.match(portal, /deriveCompassAction\(\{ status: student\.status, certificateDownloadable/)
  })
})

test('actions and destinations', async (t) => {
  await t.test('Log a Shift routes to /shift-log with no student identifiers in the URL', () => {
    assert.match(portal, /href="\/shift-log"/)
    assert.doesNotMatch(portal, /shift-log\?[^"']*(student|id|email)/i)
  })

  await t.test('Contact ASPIRE composes to aspire@cshs.org via the centralized helper', () => {
    assert.match(portal, /composePortalEmail\(\{ to: SUPPORT, subject: CONTACT_SUBJECT/)
    assert.match(portal, /const SUPPORT = 'aspire@cshs\.org'/)
    assert.match(portal, /const CONTACT_SUBJECT = 'ASPIRE Student Support Request'/)
  })

  await t.test('Edit Profile opens the drawer and focus returns to its trigger', () => {
    assert.match(portal, /<EditProfileDrawer open=\{editOpen\}/)
    assert.match(portal, /ref=\{editBtnRef\}/)
    assert.match(portal, /returnFocusRef=\{editBtnRef\}/)
  })
})

test('student-facing vocabulary', async (t) => {
  await t.test('Surveys, Badge & Certificate, and Support replace the staff terms', () => {
    assert.match(portal, />Surveys<\/h2>/)
    assert.match(portal, />Badge &amp; Certificate<\/h2>/)
    assert.match(portal, />Support<\/h2>/)
    assert.doesNotMatch(portal, />Evaluations<\/h2>|>Documents<\/h2>|>Need help\?<\/h2>/)
  })

  await t.test('waiting surveys point at the email link explicitly', () => {
    assert.match(portal, /Your survey link arrives by email/)
  })

  await t.test('API fields and instrument names are untouched by the renames', () => {
    assert.match(portal, /portal_my_evaluation_assignments/)
    assert.match(portal, /e\.instrument_title \|\| e\.instrument_slug/)
  })
})

test('data discipline', async (t) => {
  await t.test('dates use the null-safe helpers (no raw Invalid Date rendering)', () => {
    assert.match(portal, /import \{ fmtDate, placementWindow, TBC \} from '\.\.\/lib\/portalDates'/)
    assert.match(portal, /placementWindow\(student\.cohort, student\.term_dates\)/)
    assert.doesNotMatch(portal, /toLocaleDateString/, 'formatting goes through portalDates, not inline')
  })

  await t.test('the hours bar renders only with reliable data (via deriveClinicalHours)', () => {
    assert.match(portal, /deriveClinicalHours\(student\.hours\)/)
    assert.match(portal, /\{hours\.reliable \? \(/)
  })

  await t.test('approved and pending hours are separate, labeled values', () => {
    assert.match(portal, /Approved hours/)
    assert.match(portal, /Pending review/)
    assert.doesNotMatch(portal, /hours\.completed \+ hours\.pending/)
  })

  await t.test('the Home message strip never marks read and duplicates no inbox', () => {
    assert.match(portal, /usePortalInboxPreview/)
    assert.doesNotMatch(portal, /markPortalConversationRead|messages-read|getPortalThreadPage/)
  })

  await t.test('no service-role reference leaks into the client bundle', () => {
    for (const s of [portal, shell, nav, drawer]) {
      assert.doesNotMatch(s, /SERVICE_ROLE|service_role/i)
    }
  })
})

test('shell, navigation, and mobile', async (t) => {
  await t.test('profile menu holds name, Edit Profile, Public site, Sign out', () => {
    assert.match(shell, /function ProfileMenu/)
    assert.match(shell, /ptl-menu-name/)
    assert.match(shell, /Edit Profile/)
    assert.match(shell, /Public site/)
    assert.match(shell, /Sign out/)
    assert.match(shell, /aria-haspopup="menu"/)
  })

  await t.test('the previous overcrowded header actions are gone', () => {
    // UL-POLISH P2: the shared shell can render a name, but ONLY when a portal
    // opts in. The Student Portal does not, so its header is unchanged.
    assert.match(shell, /showHeaderName = false/)
    assert.doesNotMatch(
      read('src/portal/PortalApp.jsx'),
      /title="Student Portal"[\s\S]{0,120}showHeaderName/,
    )
    assert.doesNotMatch(shell, /className="ptl-header-link"/)
    assert.doesNotMatch(shell, /ptl-btn-outline ptl-btn-sm" onClick=\{signOut\}/)
  })

  await t.test('one persistent mobile bar: the nav IS the bottom bar', () => {
    assert.doesNotMatch(portal, /ptl-actionbar/)
    assert.doesNotMatch(css, /\.ptl-actionbar/)
    assert.match(css, /\.ptl-nav \{\s*\n\s*position: fixed; left: 0; right: 0; bottom: 0;/)
  })

  await t.test('header and bottom bar respect iOS safe-area insets', () => {
    assert.match(css, /env\(safe-area-inset-top\)/)
    assert.match(css, /calc\(6px \+ env\(safe-area-inset-bottom\)\)/)
    assert.match(css, /\.ptl-page-tabbar \.ptl-main \{ padding-bottom: calc\(84px \+ env\(safe-area-inset-bottom\)\); \}/)
  })

  await t.test('loading uses a skeleton, not bare text', () => {
    assert.match(portal, /HomeSkeleton/)
    assert.match(css, /\.ptl-skel \{/)
    assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?ptl-shimmer/)
  })

  await t.test('a portal-wide focus-visible ring exists and nothing removes it', () => {
    assert.match(css, /\.ptl-page \*:focus-visible \{\s*\n\s*outline: 2px solid var\(--ptl-navy\);/)
  // UL-POLISH: an outline may be suppressed ONLY for non-keyboard focus, i.e.
    // :focus:not(:focus-visible) or the [data-programmatic-focus] marker set by
    // the focus-on-navigation effect. Every keyboard focus ring must survive.
    const isProgrammaticFocusRule = (line) =>
      line.includes(':focus:not(:focus-visible)') || line.includes('[data-programmatic-focus]')
    const keyboardRules = css.split('\n').filter(l => !isProgrammaticFocusRule(l)).join('\n')
    assert.doesNotMatch(keyboardRules, /outline: none/)
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

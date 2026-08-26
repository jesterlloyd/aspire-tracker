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

test('the shared greeting masthead replaces the student-only hero', async (t) => {
  await t.test('reuses the shared GreetingMasthead (greeting + date/cohort/last-visit + weather)', () => {
    assert.match(portal, /import GreetingMasthead from '\.\.\/components\/masthead\/GreetingMasthead'/)
    assert.match(portal, /<GreetingMasthead[\s\S]*?fullName=\{fullName\}[\s\S]*?dateLabel=\{dateLabel\}[\s\S]*?contextLabel=\{cohortName\}[\s\S]*?lastVisitLine=\{lastVisitLine\}/)
  })

  await t.test('the old navy compass hero (welcome / stage / attention) is fully removed', () => {
    assert.doesNotMatch(portal, /ptl-compass|Welcome back|ptl-attention|deriveHeroStage|deriveAttentionItems|function initials/)
    assert.doesNotMatch(css, /\.ptl-compass/)
  })

  await t.test('last-visit reuses the shared hook, scoped to this browser + student', () => {
    assert.match(portal, /import \{ useLastVisitLabel \} from '\.\.\/lib\/lastVisit'/)
    assert.match(portal, /useLastVisitLabel\(student\?\.id \? `aspire:lastVisit:portal:student:\$\{student\.id\}` : null\)/)
  })

  await t.test('the single stage representation is Your progress; the stage action stays on its own card', () => {
    // The timeline (Your progress card) is the one stage representation; the redundant hero
    // stage/next block and duplicated CTA are gone. The action lives on the Hours / Badge cards.
    assert.match(portal, /derivePortalTimeline\(\{ status: student\.status/)
    assert.match(portal, />Your progress<\/h2>/)
    const logShift = portal.match(/Log a Shift/g) || []
    assert.equal(logShift.length, 1, 'exactly one Log a Shift entry point (the Hours card)')
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

  await t.test('the profile affordance routes to My Profile (drawer retired as an editor)', () => {
    // STUDENT-PORTAL-PROFILE-1 (Owner decision): the Home action navigates to the
    // My Profile destination; the drawer render (and its focus-return contract) is gone.
    assert.match(portal, /onClick=\{\(\) => onOpenProfile\?\.\(\)\}/)
    assert.match(portal, /ref=\{editBtnRef\}/)
    assert.doesNotMatch(portal, /<EditProfileDrawer/)
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
  await t.test('record dates use the null-safe helpers (no raw Invalid Date rendering)', () => {
    assert.match(portal, /import \{ fmtDate, placementWindow, TBC \} from '\.\.\/lib\/portalDates'/)
    assert.match(portal, /placementWindow\(student\.cohort, student\.term_dates\)/)
    // The ONLY inline toLocaleDateString is the shared masthead's date label (always today's date,
    // never a nullable record value), matching the Unit Leader Home. Record dates stay on fmtDate.
    const localeUses = portal.match(/toLocaleDateString/g) || []
    assert.equal(localeUses.length, 1, 'only the masthead date label formats inline')
    assert.match(portal, /const dateLabel = useMemo\(\s*\n\s*\(\) => new Date\(\)\.toLocaleDateString/)
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

  await t.test('the Home no longer embeds a message strip (the Messages tab owns messages)', () => {
    // The redundant Home Messages card was removed, so Home neither queries nor renders inbox data.
    assert.doesNotMatch(portal, /usePortalInboxPreview|ptl-latest-|Go to Messages/)
    assert.doesNotMatch(portal, /markPortalConversationRead|messages-read|getPortalThreadPage/)
  })

  await t.test('no service-role reference leaks into the client bundle', () => {
    for (const s of [portal, shell, nav, drawer]) {
      assert.doesNotMatch(s, /SERVICE_ROLE|service_role/i)
    }
  })
})

test('shell, navigation, and mobile', async (t) => {
  await t.test('profile menu holds name, My Profile, Change Photo, Public site, Sign out', () => {
    // PROFILE-MENU-AVATARS-1: the student item reads "My Profile" (matching the
    // destination page and nav tab; the old "Edit Profile" wording predated the
    // My Profile page), and Change Photo joined every portal menu.
    assert.match(shell, /function ProfileMenu/)
    assert.match(shell, /ptl-menu-name/)
    assert.match(shell, /> My Profile<\/button>/)
    assert.match(shell, /> Change Photo<\/button>/)
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
    // NA-CONTACTS-POLISH-1: one named exception - a text input inside a styled
    // search wrapper moves its ring to the wrapper's :focus-within treatment
    // (text inputs match :focus-visible on EVERY focus, so the raw global ring
    // double-boxed the wrapper for mouse users). Keyboard focus stays visible
    // via the wrapper ring, asserted below.
    const isProgrammaticFocusRule = (line) =>
      line.includes(':focus:not(:focus-visible)') || line.includes('[data-programmatic-focus]')
      || line.includes('.ptl-na-contact-search input:focus-visible')
    const keyboardRules = css.split('\n').filter(l => !isProgrammaticFocusRule(l)).join('\n')
    assert.doesNotMatch(keyboardRules, /outline: none/)
    // The excepted search input's replacement ring actually exists.
    assert.match(css, /\.ptl-na-contact-search:focus-within \{ border-color: var\(--nova/)
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

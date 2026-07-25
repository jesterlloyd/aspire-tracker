// UL-POLISH: static-source guards for the Unit Leader Portal polish pass.
// P0 defect fixes, P1 hierarchy and density, P2 consistency and finish.
// Run: node --test test/unitLeaderPortalPolish.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const css = read('src/portal/portal.css')
const portal = read('src/portal/UnitLeaderPortal.jsx')
const chrome = read('src/portal/unit/UnitLeaderChrome.jsx')
const app = read('src/portal/PortalApp.jsx')
const workspace = read('src/portal/messages/PortalMessagesWorkspace.jsx')
const inbox = read('src/portal/messages/PortalMessagesInbox.jsx')
const thread = read('src/portal/messages/PortalMessagesThread.jsx')
const constants = read('src/lib/messages/portalMessagesConstants.js')
const listApi = read('api/portal/messages-list.js')
const preceptorsWorkspace = read('src/portal/unit/UnitPreceptorsWorkspace.jsx')
const createModal = read('src/portal/unit/UnitPreceptorCreateModal.jsx')

test('P0-1: the stage filter bar is removed', () => {
  // SUPERSEDED: the UX-cleanup pass removed the All/Upcoming/Active/Completed filters in
  // favour of one 90-day table, so the filter chip class is gone from the roster.
  assert.ok(!portal.includes('ptl-filterbar'), 'the filter bar markup is gone')
  assert.ok(!portal.includes('ptl-filter-chip'), 'the filter chip class is gone')
})

test('P1: the page grid does not stretch its rows to fill the viewport', () => {
  // Without this the leftover viewport height is distributed into every row,
  // so short screens (Placements, Preceptors) show large arbitrary gaps.
  assert.match(css, /\.ptl-unit-page \{ display: grid; gap: 16px; align-content: start; \}/)
})

test('P0-2: section-title focus behavior', () => {
  assert.match(css, /\.ptl-unit-page \.ptl-section-title \{ width: fit-content; \}/)
  assert.match(css, /\.ptl-unit-page \.ptl-section-title:focus:not\(:focus-visible\) \{ outline: none; \}/)
  // A CSS-only rule is not sufficient (Chromium matches :focus-visible for the
  // programmatic focus), so the effect marks it and the marker suppresses it.
  assert.match(chrome, /el\.dataset\.programmaticFocus = 'true'/)
  assert.match(chrome, /el\.addEventListener\('blur', clear, \{ once: true \}\)/)
  assert.match(css, /\.ptl-section-title\[data-programmatic-focus\]:focus \{ outline: none; \}/)
  // Programmatic focus itself is preserved for assistive technology.
  assert.match(chrome, /el\.focus\(\)/)
  // The keyboard indicator is preserved (the existing focus-visible rule).
  assert.match(css, /\.ptl-section-title:focus-visible/)
})

test('P0-3: the change-request comment is an inline editor, never window.prompt', () => {
  assert.doesNotMatch(portal, /window\.prompt/)
  assert.match(portal, /ptl-editor/)
  assert.match(portal, /A comment is required when requesting changes\./)
  // Typed text survives: the comment state is cleared only on success.
  assert.match(portal, /if \(res\.ok\) \{\s*setEditorFor\(null\)\s*setComment\(''\)/)
  assert.match(portal, /Send request/)
})

test('P0-4: unit switcher scope and the single-unit context line', async (t) => {
  await t.test('the switcher renders only on views where narrowing changes the data', () => {
    // Placement Requests and Capacity are excluded (each carries its own unit context),
    // so the switcher lives on Home, Students, and Preceptors only.
    assert.match(portal, /UNIT_SCOPED_VIEWS = \['home', 'students', 'preceptors'\]/)
    assert.match(portal, /\{UNIT_SCOPED_VIEWS\.includes\(view\) && \(\s*<UnitSwitcher/)
  })
  await t.test('a single-unit leader sees a static context line, not a dead control', () => {
    assert.match(chrome, /if \(unitKeys\.length === 1\) \{\s*return <p className="ptl-unit-context">/)
    assert.match(chrome, /label: 'All Assigned Units'/)
    assert.match(chrome, /<SegmentedTabs[\s\S]*className="ptl-unit-switcher"[\s\S]*items=\{items\}/)
    assert.doesNotMatch(chrome, /id="ul-unit-switcher"|<select/)
  })
})

test('P0-5: Messages is role-aware', async (t) => {
  await t.test('unit-leader copy exists and the student copy is untouched', () => {
    assert.match(constants, /PORTAL_SUBTITLE = 'Contact the ASPIRE Team about your ASPIRE experience\.'/)
    assert.match(constants, /UL_PORTAL_SUBTITLE =/)
    assert.match(constants, /ulDirectThreadLabel/)
  })
  await t.test('the workspace selects copy by variant and threads it down', () => {
    assert.match(workspace, /variant = 'student'/)
    assert.match(workspace, /variant === 'unit_leader' \? UL_PORTAL_SUBTITLE : PORTAL_SUBTITLE/)
    assert.match(workspace, /<PortalMessagesInbox\s+variant=\{variant\}/)
    assert.match(workspace, /<PortalMessagesThread\s+variant=\{variant\}/)
  })
  await t.test('the UL portal passes the variant; the student branch defaults', () => {
    assert.match(portal, /variant="unit_leader"/)
  })
  await t.test('inbox cards distinguish ASPIRE Team from Direct threads', () => {
    assert.match(inbox, /ptl-msg-row-context/)
    assert.match(inbox, /direct_student_name \? ulDirectThreadLabel\(c\.direct_student_name\) : UL_THREAD_ASPIRE_LABEL/)
    assert.match(thread, /UL_PORTAL_NO_SELECTION : PORTAL_NO_SELECTION/)
  })
  await t.test('the list endpoint attaches explicit thread classification after authorization', () => {
    assert.match(listApi, /classifyPortalConversations\(svc, conversations, caller\.profile\.id\)/)
    assert.match(listApi, /direct_student_name is preserved/)
    assert.match(listApi, /callers should now prefer thread_kind/)
    assert.doesNotMatch(listApi, /svc\s*\.\s*from\('conversations'\)|svc\s*\.\s*from\('messages'\)/)
  })
})

test('P0-6: unread polling runs for the unit-leader branch', () => {
  assert.match(app, /const isUnitLeader = !isStudent && \(access\?\.roles \|\| \[\]\)\.includes\('unit_leader'\)/)
  assert.match(app, /enabled: isStudent \|\| isUnitLeader/)
  assert.match(app, /intervalMs: onMessagesRoute \? PORTAL_ACTIVE_POLL_MS : PORTAL_IDLE_UNREAD_POLL_MS/)
})

test('P0-7: six desktop destinations and four mobile slots with accessible More', async (t) => {
  await t.test('desktop and mobile sets are explicit and ordered', () => {
    assert.match(chrome, /DESKTOP_KEYS = \['home', 'preceptors', 'messages', 'evaluations', 'placements', 'capacity'\]/)
    assert.match(chrome, /MOBILE_PRIMARY_KEYS = \['home', 'preceptors', 'messages'\]/)
    assert.match(chrome, /MOBILE_MORE_KEYS = \['evaluations', 'placements', 'capacity'\]/)
    assert.match(css, /\.ptl-nav-mobile-more \{ display: none; \}/)
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.ptl-nav-mobile-more \{ display: inline-flex; \}/)
  })
  await t.test('the More sheet is a real dialog with trap, Escape, and return focus', () => {
    assert.match(chrome, /role="dialog" aria-modal="true" aria-label="More sections"/)
    assert.match(chrome, /e\.key === 'Escape'/)
    assert.match(chrome, /returnFocusRef/)
    assert.match(chrome, /aria-haspopup="dialog"/)
    assert.match(chrome, /aria-expanded=\{moreOpen\}/)
  })
  await t.test('sheet items meet the 44px minimum and carry active state', () => {
    assert.match(css, /\.ptl-sheet-item \{[\s\S]*?min-height: 48px/)
    assert.match(css, /\.ptl-sheet-item\[aria-current="page"\]/)
  })
})

// ── P1: hierarchy and density ───────────────────────────────────────────────

test('P1-8: the Compass welcome header replaces the literal Home heading', () => {
  // The welcome header is now the shared greeting masthead (Commit 1), which reuses the
  // main-app masthead visual system rather than a plain heading.
  assert.match(portal, /<GreetingMasthead/)
  assert.doesNotMatch(portal, /\{first \? `Welcome, \$\{first\}` : 'Welcome'\}/)
  // The Unit Leader unit context still appears exactly once, below the masthead.
  assert.match(portal, /Unit Leader · \{unitContext\}/)
  // Long unit lists summarize instead of running on.
  assert.match(portal, /`\$\{unitKeys\.length\} assigned units`/)
})

test('P1-9: Home uses the canonical calendar first with actionable attention rows', async (t) => {
  await t.test('the calendar leads directly into the student roster', () => {
    const home = portal.slice(portal.indexOf('function HomeScreen'), portal.indexOf('function PlacementScreen'))
    assert.ok(home.indexOf('<UnitRotationCalendar') < home.indexOf('<StudentRoster'))
    assert.ok(!home.includes('ptl-home-followup-grid'))
    assert.ok(!home.includes('Capacity and placement'))
    assert.ok(!home.includes('Upcoming students'))
  })
  await t.test('attention items are rows with tone dot, unit chip, and a destination', () => {
    assert.match(portal, /ptl-attn-dot/)
    assert.match(portal, /ptl-attn-unit/)
    assert.match(portal, /ptl-attn-chevron/)
    assert.match(portal, /onClick=\{\(\) => onNavigate\?\.\(n\.section\)\}/)
  })
  await t.test('support-note signals stay out of Home attention', () => {
    assert.ok(!portal.includes('raised a support note'))
    assert.doesNotMatch(portal, /support_needed|support\.text|support\.note/)
  })
  await t.test('capacity and placement stay as dedicated routed sections', () => {
    assert.match(portal, /view === 'capacity'/)
    assert.match(portal, /view === 'placements'/)
    assert.match(chrome, /label: 'Capacity'/)
    assert.match(chrome, /label: 'Placement Requests'/)
  })
})

test('P1-10: the recent-threads card is removed from Home', () => {
  // SUPERSEDED: the card was removed (Messages has its own tab). Check the render markup
  // and the fetch, not prose, so a comment mentioning it does not trip this.
  assert.ok(!portal.includes('ptl-recent-row'), 'the recent-threads card markup is gone')
  assert.ok(!portal.includes('listPortalConversations'), 'the recent-threads fetch is gone')
})

test('P1-11: the Students table identity, hours bar', async (t) => {
  // SUPERSEDED BY THE VISUAL REDESIGN. The table became a staff-style row LIST: a
  // circular photo avatar, name and school stacked, a stage pill, and a single kebab.
  // The properties this test protects (identity treatment, safe primary affordance,
  // hours bar, onboarding chips) are unchanged and re-asserted against the new markup.
  await t.test('the row uses the circular photo avatar with name and school', () => {
    assert.match(portal, /<UnitStudentAvatar url=\{photoUrl\}/)
    assert.match(portal, /ptl-stu-name/)
    assert.match(portal, /ptl-stu-school/)
  })
  await t.test('the whole table row opens the profile; the old stacked buttons are gone', () => {
    assert.match(portal, /role="button"/)
    assert.match(portal, /aria-label=\{`Open details for \$\{studentName\(s\)\}`\}/)
    assert.ok(!portal.includes('function StudentActions'))
    assert.ok(!portal.includes('ptl-stu-rowbtn'), 'the row-button list markup is superseded by a table')
  })
  await t.test('hours render as a mini progress bar with the exact numbers', () => {
    assert.match(portal, /ptl-mini-progress/)
    assert.match(portal, /aria-label=\{`\$\{approved\} of \$\{hours\.required\} required hours approved`\}/)
  })
})

test('P1-12: the Compass form treatment covers portal and create forms', async (t) => {
  await t.test('full-width inputs inside the responsive field grid', () => {
    const grids = portal.match(/className="ptl-form-grid"/g) || []
    assert.equal(grids.length, 2, 'capacity and concern forms')
    assert.match(portal, /ptl-input ptl-input-full/)
    assert.match(createModal, /ptl-modal-body ptl-form-grid/)
    assert.match(css, /@media \(min-width: 760px\) \{\s*\n\s*\.ptl-form-grid \{ grid-template-columns: 1fr 1fr; \}/)
  })
  await t.test('helper text and a right-aligned submit row', () => {
    assert.match(portal, /ptl-field-help/)
    const submits = portal.match(/className="ptl-form-submit"/g) || []
    assert.equal(submits.length, 2)
    assert.match(css, /\.ptl-form-submit \{\s*\n\s*display: flex; align-items: center; justify-content: flex-end/)
    assert.match(createModal, /ptl-modal-actions/)
  })
  await t.test('success notices name what was recorded', () => {
    assert.match(portal, /Thank you, \{form\.unit_name\}/)
    assert.match(preceptorsWorkspace, /Preceptor created and active/)
  })
  await t.test('the ASPIRE authority note remains on routed action screens', () => {
    const notes = portal.match(/\{ASPIRE_AUTHORITY_NOTE\}/g) || []
    assert.equal(notes.length, 2, 'placements and capacity: one each')
  })
})

test('P1-13: placement response state after responding', async (t) => {
  await t.test('a recorded response shows one chip and one Change response affordance', () => {
    assert.match(portal, /const hasResponded = r\.unit_response !== 'pending'/)
    assert.match(portal, /const showOptions = isOpen && \(!hasResponded \|\| changing\)/)
    assert.match(portal, /Change response/)
    assert.match(portal, /Keep current/)
  })
  await t.test('sentence case flows through every status', () => {
    // Lives with the other presentation helpers, not exported from a
    // component module (react-refresh).
    assert.match(read('src/portal/unit/unitLeaderApi.js'), /export function sentenceCase/)
    assert.doesNotMatch(portal, /export function sentenceCase/)
    assert.match(portal, /sentenceCase\(r\.unit_response\)/)
    assert.match(portal, /sentenceCase\(r\.aspire_status\)/)
    // SUPERSEDED: the old capacity review-status table is gone; the canonical form has no
    // per-submission review status to sentence-case.
  })
  await t.test('overdue due dates carry the warning tone with text', () => {
    // The clock is read in the loader's resolver, never during render.
    assert.match(portal, /const overdue = isOpen && r\.due_at && new Date\(r\.due_at\)\.getTime\(\) < now/)
    assert.match(portal, /at: Date\.now\(\)/)
    assert.doesNotMatch(portal, /getTime\(\) < Date\.now\(\)/)
    assert.match(portal, /ptl-due-overdue/)
    assert.match(portal, /· overdue/)
  })
})

// ── P2: consistency and finish ──────────────────────────────────────────────

test('P2-14: one type scale across the portal', () => {
  assert.match(css, /\.ptl-unit-page \.ptl-section-title \{ font-size: 21px; \}/)
  assert.match(css, /\.ptl-msg-workspace \.ptl-section-title \{ font-size: 22px; line-height: 1\.25; \}/)
  // No 26px page heading survives; the pre-existing .ptl-hours-big stat is a
  // Student Portal numeral, not a heading, and is deliberately untouched.
  assert.doesNotMatch(css, /\.ptl-section-title \{ font-size: 26px/)
  assert.match(css, /\.ptl-msg-row-cat, \.ptl-msg-row-time \{ font-size: 12\.5px; \}/)
})

test('P1/P2: no new class collides with an existing Student Portal component', () => {
  // The P0 filter-chip defect was a shared class with two meanings. These are
  // the Unit Leader equivalents, namespaced so the same bug cannot recur.
  for (const cls of ['ptl-ulstat', 'ptl-ulstat-num', 'ptl-ulstat-label', 'ptl-ulstat-row']) {
    assert.match(css, new RegExp(`\\.${cls}[\\s{:.]`), cls)
  }
  // The Student Portal's own stat rules keep their values.
  assert.match(css, /\.ptl-stat \{ display: flex; flex-direction: column;/)
  assert.match(css, /\.ptl-stat-num \{ font-size: 20px;/)
  assert.match(css, /\.ptl-stat-label \{ font-size: 11\.5px;/)
  assert.doesNotMatch(portal, /className="ptl-stat(-num|-label|-row)?"/)
})

test('P2-15: the signed-in name appears in the header, desktop only, opt-in', () => {
  const shell = read('src/portal/PortalShell.jsx')
  assert.match(shell, /showHeaderName = false/)
  assert.match(shell, /\{showHeaderName && userName && <span className="ptl-header-name">\{userName\}<\/span>\}/)
  assert.match(app, /title="Unit Leader Portal"[\s\S]{0,80}showHeaderName/)
  // Student Portal shell call is unchanged.
  assert.doesNotMatch(app, /title="Student Portal"[\s\S]{0,80}showHeaderName/)
  assert.match(css, /@media \(max-width: 760px\) \{ \.ptl-header-name \{ display: none; \} \}/)
})

test('P2-16: table screens load with shimmer skeletons and polite announcements', () => {
  assert.match(chrome, /export function TableSkeleton/)
  assert.match(chrome, /role="status" aria-live="polite" className="ptl-visually-hidden"/)
  assert.match(portal, /<TableSkeleton label="Loading placement requests" \/>/)
  assert.match(preceptorsWorkspace, /<TableSkeleton label="Loading preceptors" \/>/)
  // SUPERSEDED: Capacity is a submit form (the canonical /unit-form workflow), not a table
  // that loads prior rows, so it no longer shows a table skeleton.
})

test('P2-17: the student drawer renders the real response shape with an hours bar', () => {
  const drawer = read('src/portal/unit/StudentDetailDrawer.jsx')
  // The endpoint nests the record under student; the drawer unwraps exactly that.
  assert.match(drawer, /data: res\.data\?\.student \|\| null/)
  assert.match(drawer, /ptl-mini-progress/)
  assert.match(drawer, /required hours approved/)
  // Approved contact links and mediated file access are untouched.
  assert.match(drawer, /ContactLink/)
  assert.match(drawer, /getStudentFileUrl/)
})

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

test('P0-1: filter chips are a dedicated, visible class', async (t) => {
  await t.test('the UL filter control no longer squats on .ptl-chip', () => {
    assert.match(portal, /ptl-filter-chip/)
    assert.doesNotMatch(portal, /className=\{`ptl-chip\$/)
  })
  await t.test('exactly one semantic .ptl-chip definition remains (the status chip)', () => {
    const defs = css.match(/^\.ptl-chip \{/gm) || []
    assert.equal(defs.length, 1, 'one .ptl-chip block')
  })
  await t.test('the filter bar is a compact toolbar, not a full content card', () => {
    assert.match(css, /\.ptl-filterbar \{ display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 14px; \}/)
  })
  await t.test('.ptl-filter-chip declares its own text color and states', () => {
    assert.match(css, /\.ptl-filter-chip \{[\s\S]*?color: var\(--ptl-navy/)
    assert.match(css, /\.ptl-filter-chip:hover/)
    assert.match(css, /\.ptl-filter-chip\[aria-pressed="true"\]/)
  })
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
  await t.test('the switcher renders only on unit-scoped views', () => {
    assert.match(portal, /UNIT_SCOPED_VIEWS = \['home', 'placements', 'capacity', 'students', 'preceptors'\]/)
    assert.match(portal, /\{UNIT_SCOPED_VIEWS\.includes\(view\) && \(\s*<UnitSwitcher/)
  })
  await t.test('a single-unit leader sees a static context line, not a dead control', () => {
    assert.match(chrome, /if \(unitKeys\.length === 1\) \{\s*return <p className="ptl-unit-context">/)
    assert.match(chrome, /All assigned units \(\{unitKeys\.length\}\)/)
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
  await t.test('the list endpoint names students only for a unit_leader caller', () => {
    assert.match(listApi, /caller\.actorKind === 'unit_leader' && conversations\.length > 0/)
    assert.match(listApi, /\.eq\('participant_profile_id', profileId\)/)
    assert.match(listApi, /\.eq\('participant_role', 'unit_leader'\)/)
    assert.match(listApi, /\.not\('scope_student_id', 'is', null\)/)
  })
})

test('P0-6: unread polling runs for the unit-leader branch', () => {
  assert.match(app, /const isUnitLeader = !isStudent && \(access\?\.roles \|\| \[\]\)\.includes\('unit_leader'\)/)
  assert.match(app, /enabled: isStudent \|\| isUnitLeader/)
  assert.match(app, /intervalMs: onMessagesRoute \? PORTAL_ACTIVE_POLL_MS : PORTAL_IDLE_UNREAD_POLL_MS/)
})

test('P0-7: five-slot mobile navigation with an accessible More sheet', async (t) => {
  await t.test('narrow widths show the five primary slots', () => {
    assert.match(chrome, /PRIMARY_KEYS = \['home', 'students', 'placements', 'messages'\]/)
    assert.match(chrome, /MORE_KEYS = \['capacity', 'preceptors', 'concern', 'profile'\]/)
    assert.match(chrome, /usePortalIsNarrow\(\)/)
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
  assert.match(portal, /\{first \? `Welcome, \$\{first\}` : 'Welcome'\}/)
  assert.match(portal, /Unit Leader · \{unitContext\}/)
  // Long unit lists summarize instead of running on.
  assert.match(portal, /`\$\{unitKeys\.length\} assigned units`/)
})

test('P1-9: Home is a 7/5 grid with actionable attention rows', async (t) => {
  await t.test('the grid uses the existing Compass columns', () => {
    assert.match(portal, /className="ptl-grid ptl-home-grid"/)
    assert.match(portal, /className="ptl-col-7 ptl-home-col"/)
    assert.match(portal, /className="ptl-col-5 ptl-home-col"/)
  })
  await t.test('attention items are rows with tone dot, unit chip, and a destination', () => {
    assert.match(portal, /ptl-attn-dot/)
    assert.match(portal, /ptl-attn-unit/)
    assert.match(portal, /ptl-attn-chevron/)
    assert.match(portal, /onClick=\{\(\) => onNavigate\?\.\(n\.section\)\}/)
  })
  await t.test('the support signal links to Students and never carries note text', () => {
    assert.match(portal, /raised a support note/)
    assert.doesNotMatch(portal, /support_needed|support\.text|support\.note/)
  })
  await t.test('capacity and placement numerals link to their sections', () => {
    assert.match(portal, /ptl-ulstat-num/)
    assert.match(portal, /onClick=\{\(\) => onNavigate\?\.\('capacity'\)\}/)
    assert.match(portal, /onClick=\{\(\) => onNavigate\?\.\('placements'\)\}/)
  })
})

test('P1-10: Recent Messages renders the latest threads', () => {
  assert.match(portal, /listPortalConversations\(\{ limit: 3, signal: sig \}\)/)
  assert.match(portal, /ptl-recent-row/)
  assert.match(portal, /formatInboxTimestamp\(c\.last_message_at\)/)
  assert.match(portal, /ulDirectThreadLabel\(c\.direct_student_name\) : UL_THREAD_ASPIRE_LABEL/)
  assert.match(portal, /onClick=\{\(\) => onOpenThread\?\.\(c\.id\)\}/)
  // The empty state stays honest and Open Messages remains.
  assert.match(portal, /No messages yet\./)
  assert.match(portal, /Open Messages/)
})

test('P1-11: the Students table identity cell, hours bar, and chips', async (t) => {
  await t.test('student cell stacks avatar, name link, and school; School column is gone', () => {
    assert.match(portal, /ptl-stu-avatar/)
    assert.match(portal, /ptl-stu-name/)
    assert.match(portal, /ptl-stu-school/)
    assert.doesNotMatch(portal, /<th scope="col">School<\/th>/)
  })
  await t.test('the name is a safe primary link, not a whole-row click', () => {
    assert.match(portal, /className="ptl-linklike ptl-stu-name"/)
    assert.doesNotMatch(portal, /<tr[^>]*onClick/)
  })
  await t.test('hours render as a mini progress bar with the exact numbers', () => {
    assert.match(portal, /ptl-mini-progress/)
    assert.match(portal, /aria-label=\{`\$\{approved\} of \$\{hours\.required\} required hours approved`\}/)
  })
  await t.test('outstanding onboarding items are chips, and View details remains', () => {
    assert.match(portal, /ptl-ochip/)
    assert.match(portal, /View details/)
  })
})

test('P1-12: the Compass form treatment on all three forms', async (t) => {
  await t.test('full-width inputs inside the responsive field grid', () => {
    const grids = portal.match(/className="ptl-form-grid"/g) || []
    assert.equal(grids.length, 3, 'capacity, nomination, and concern forms')
    assert.match(portal, /ptl-input ptl-input-full/)
    assert.match(css, /@media \(min-width: 760px\) \{\s*\n\s*\.ptl-form-grid \{ grid-template-columns: 1fr 1fr; \}/)
  })
  await t.test('helper text and a right-aligned submit row', () => {
    assert.match(portal, /ptl-field-help/)
    const submits = portal.match(/className="ptl-form-submit"/g) || []
    assert.equal(submits.length, 3)
    assert.match(css, /\.ptl-form-submit \{\s*\n\s*display: flex; align-items: center; justify-content: flex-end/)
  })
  await t.test('success notices name what was recorded', () => {
    assert.match(portal, /`Capacity recorded for \$\{summaryUnit\}/)
    assert.match(portal, /`Nomination recorded: \$\{form\.proposed_name\} for \$\{studentName\(nominee\)\}/)
  })
  await t.test('the ASPIRE authority note appears once per screen', () => {
    const notes = portal.match(/\{ASPIRE_AUTHORITY_NOTE\}/g) || []
    assert.equal(notes.length, 4, 'home, placements, capacity, preceptors: one each')
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
    assert.match(portal, /sentenceCase\(c\.review_status\)/)
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
  assert.match(portal, /<TableSkeleton label="Loading capacity" \/>/)
  assert.match(portal, /<TableSkeleton label="Loading preceptor assignments" \/>/)
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

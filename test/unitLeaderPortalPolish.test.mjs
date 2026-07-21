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
  await t.test('.ptl-filter-chip declares its own text color and states', () => {
    assert.match(css, /\.ptl-filter-chip \{[\s\S]*?color: var\(--ptl-navy/)
    assert.match(css, /\.ptl-filter-chip:hover/)
    assert.match(css, /\.ptl-filter-chip\[aria-pressed="true"\]/)
  })
})

test('P0-2: section-title focus behavior', () => {
  assert.match(css, /\.ptl-unit-page \.ptl-section-title \{ width: fit-content; \}/)
  assert.match(css, /\.ptl-unit-page \.ptl-section-title:focus:not\(:focus-visible\) \{ outline: none; \}/)
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

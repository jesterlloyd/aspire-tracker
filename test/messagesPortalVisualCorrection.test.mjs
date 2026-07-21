// MESSAGES-PORTAL-VISUAL-CORRECTION: guards for the Student Portal Messages
// visual corrections. Each guard exists because a real defect shipped, so the
// comments record the failure rather than the intent.
//
// Run: node --test test/messagesPortalVisualCorrection.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { PORTAL_SAFETY_NOTICE } from '../src/lib/messages/portalMessagesConstants.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')

const css = read('../src/portal/portal.css')
const polling = read('../src/lib/messages/portalMessagesPolling.js')
const workspace = read('../src/portal/messages/PortalMessagesWorkspace.jsx')
const inbox = read('../src/portal/messages/PortalMessagesInbox.jsx')
const reply = read('../src/portal/messages/PortalReplyComposer.jsx')
const drawer = read('../src/portal/messages/PortalNewMessageDrawer.jsx')
const jsxFiles = { workspace, inbox, reply, drawer }

test('primary buttons use the established base, not the hero-only modifier', async (t) => {
  await t.test('.ptl-btn-primary is retired and no component uses it', () => {
    // ASPIRE-COMPASS removed the hero and the trap class with it: the "primary"
    // that was secretly white-on-navy no longer exists anywhere. The compass
    // CTA carries its own explicit on-navy class instead.
    assert.doesNotMatch(css, /\.ptl-btn-primary/)
    assert.match(css, /\.ptl-compass-cta \{/)
    for (const [name, s] of Object.entries(jsxFiles)) {
      assert.doesNotMatch(s, /ptl-btn-primary/, `${name} must not use the retired hero modifier`)
    }
  })

  await t.test('New message and Send compose .ptl-btn with the Messages modifier', () => {
    assert.match(workspace, /className="ptl-btn ptl-msg-btn ptl-msg-new"/)
    assert.match(inbox, /className="ptl-btn ptl-msg-btn"/)
    assert.match(reply, /className="ptl-btn ptl-msg-btn"/)
    assert.match(drawer, /className="ptl-btn ptl-msg-btn"/)
  })

  await t.test('.ptl-btn is the filled navy primary, and the modifier fixes its gaps', () => {
    assert.match(css, /\.ptl-btn \{[\s\S]{0,200}?background: #1D2567; color: #fff;/)
    assert.match(css, /\.ptl-btn \{[\s\S]{0,200}?border: none;/)
    // The base bakes in margin-top: 10px, which the hero also has to undo.
    assert.match(css, /\.ptl-msg-btn \{[\s\S]{0,240}?margin-top: 0;/)
    assert.match(css, /\.ptl-msg-btn \{[\s\S]{0,240}?display: inline-flex;/)
    assert.match(css, /\.ptl-msg-btn \{[\s\S]{0,240}?min-height: 44px;/)
    assert.match(css, /\.ptl-msg-btn \{[\s\S]{0,240}?font-size: 14px;/)
  })

  await t.test('the primary has a design-system focus ring and a real disabled state', () => {
    assert.match(css, /\.ptl-msg-btn:focus-visible \{ outline: 2px solid #1D2567; outline-offset: 2px; \}/)
    assert.match(css, /\.ptl-msg-btn:disabled \{ background: #b9bed6; cursor: not-allowed; \}/)
    // Without this the base :hover would still repaint a disabled button.
    assert.match(css, /\.ptl-msg-btn:disabled:hover \{ background: #b9bed6; \}/)
  })

  await t.test('secondary controls keep a 44px target', () => {
    assert.match(css, /\.ptl-msg-back \{[\s\S]{0,220}?min-height: 44px/)
    assert.match(css, /\.ptl-msg-loadmore, \.ptl-msg-loadearlier \{ align-self: center; min-height: 44px; \}/)
    // Back is quiet but legible, not the old grey 13.3px UA text.
    assert.match(css, /\.ptl-msg-back \{[\s\S]{0,220}?color: #1D2567;/)
    assert.match(css, /\.ptl-msg-back:focus-visible/)
  })
})

test('the breakpoint is one value in both languages', async (t) => {
  await t.test('the JS narrow width equals the CSS breakpoint', () => {
    // At 900 vs 760, widths from 761 to 900 rendered the two-column grid in CSS
    // while JS showed a single pane, leaving a dead empty column.
    assert.match(polling, /export const PORTAL_MOBILE_MAX_WIDTH = 760;/)
    assert.match(css, /@media \(max-width: 760px\)/)
  })

  await t.test('an unmeasured width is still not a phone', () => {
    assert.match(polling, /const isNarrowWidth = \(width, maxWidth\) => width > 0 && width <= maxWidth;/)
  })
})

test('desktop uses the viewport without stranding the card', async (t) => {
  await t.test('the workspace is bounded and centered', () => {
    // 1354px wide against a 1500px .ptl-main gave a 320/961 split. The bound is
    // on the workspace, not .ptl-main, which other portal sections share.
    assert.match(css, /\.ptl-msg-workspace \{ max-width: 1280px; margin-left: auto; margin-right: auto; \}/)
  })

  await t.test('the split is balanced', () => {
    assert.match(css, /\.ptl-msg-split \{ display: grid; grid-template-columns: 360px 1fr/)
    assert.match(css, /@media \(max-width: 1000px\) \{\s*\n\s*\.ptl-msg-split \{ grid-template-columns: 300px 1fr/)
  })

  await t.test('the workspace has a useful minimum height and scrolls internally', () => {
    // The card was 437px tall in a 900px viewport: 308px of dead space below it.
    assert.match(css, /@media \(min-width: 761px\) \{[\s\S]{0,400}?\.ptl-msg-split \{ min-height: 560px; \}/)
    assert.match(css, /\.ptl-msg-pane-thread \{ height: 560px; \}/)
    // flex:1 on the scroll region keeps the composer attached to the thread.
    assert.match(css, /\.ptl-msg-scroll \{ flex: 1; min-height: 0; max-height: none; \}/)
  })

  await t.test('no fixed-height spacer element exists', () => {
    for (const [name, s] of Object.entries(jsxFiles)) {
      assert.doesNotMatch(s, /spacer|<br\s*\/>|&nbsp;/i, `${name} must not use a spacer`)
      assert.doesNotMatch(s, /height:\s*['"]?\d+px/, `${name} must not hard-code a height`)
    }
  })
})

test('mobile rhythm', async (t) => {
  await t.test('the head stacks and the chip shares the action row', () => {
    // flex-wrap plus width:100% pushed the unread chip onto its own line and
    // opened a 49px gap between the subtitle and New message.
    assert.match(css, /\.ptl-msg-head \{ flex-direction: column; align-items: stretch; gap: 12px; margin-bottom: 16px; \}/)
    assert.match(css, /\.ptl-msg-head-actions \{ width: 100%; gap: 10px; flex-wrap: nowrap; \}/)
    assert.match(css, /\.ptl-msg-new \{ flex: 1; \}/)
    // The desktop head no longer wraps either.
    assert.match(css, /\.ptl-msg-head \{ align-items: flex-start; justify-content: space-between; gap: 12px; \}/)
  })

  await t.test('the textarea is compact and avoids Safari zoom-on-focus', () => {
    // Declared AFTER the base: an equal-specificity rule in an earlier media
    // block silently lost the cascade and never applied.
    const baseAt = css.indexOf('.ptl-msg-textarea { resize: vertical;')
    const mobileAt = css.indexOf('.ptl-msg-textarea { min-height: 112px; font-size: 16px; }')
    assert.ok(baseAt > -1 && mobileAt > -1)
    assert.ok(mobileAt > baseAt, 'the mobile override must follow the base rule')
    assert.match(css, /\.ptl-msg-textarea \{ resize: vertical; min-height: 104px; max-height: 320px; font: inherit; \}/)
  })

  await t.test('the phone thread starts at Back to messages, not a second header', () => {
    // The workspace header (heading, subtitle, unread, New message) stacked above
    // Back to messages on the phone thread view and pushed the conversation down
    // a full screen. Back plus the subject is the context there; New message
    // stays one tap away through Back.
    const ws = read('../src/portal/messages/PortalMessagesWorkspace.jsx')
    assert.match(ws, /const showHead = !narrow \|\| mobileView === 'list'/)
    assert.match(ws, /\{showHead && \(\s*\n\s*<div className="ptl-section-head ptl-msg-head">/)
    // Desktop always shows it, because the list and thread share one screen.
    assert.match(ws, /const showList = !narrow \|\| mobileView === 'list'/)
  })

  await t.test('the New message drawer textarea is not oversized', () => {
    assert.match(drawer, /rows=\{5\}/)
    assert.doesNotMatch(drawer, /rows=\{7\}/)
  })
})

test('safety notice is compact but exact', async (t) => {
  await t.test('the wording is unchanged', () => {
    assert.equal(PORTAL_SAFETY_NOTICE,
      'ASPIRE Messages is not monitored continuously. Do not include patient names, '
      + 'medical record numbers, or other identifying information. For urgent '
      + 'patient-care or safety concerns, follow your unit\'s established escalation process.')
    assert.match(reply, /\{PORTAL_SAFETY_NOTICE\}/)
    assert.match(drawer, /\{PORTAL_SAFETY_NOTICE\}/)
  })

  await t.test('it is a compact block, not the note-plus-action row', () => {
    // .ptl-compose-note is display:flex; justify-content:space-between, built for
    // a note beside an action. For a three line paragraph it rendered a 114px
    // navy-on-blue panel that dominated the composer.
    assert.match(css, /\.ptl-compose-note \{[\s\S]{0,220}?justify-content: space-between/)
    assert.match(css, /\.ptl-msg-safety \{[\s\S]{0,260}?display: block;/)
    assert.match(css, /\.ptl-msg-safety \{[\s\S]{0,260}?padding: 10px 12px;/)
    assert.match(css, /\.ptl-msg-safety \{[\s\S]{0,260}?font-size: 12\.5px;/)
    // Muted rather than the prominent navy-on-blue.
    assert.match(css, /\.ptl-msg-safety \{[\s\S]{0,260}?color: #4b5563;/)
  })

  await t.test('it carries no minimum height of its own', () => {
    const block = css.slice(css.indexOf('.ptl-msg-safety {'), css.indexOf('.ptl-msg-safety {') + 260)
    assert.doesNotMatch(block, /min-height/)
  })

  await t.test('the staff notice is styled independently and was not touched', () => {
    // Staff uses an inline style object, so the portal restyle cannot reach it.
    const staff = read('../src/components/connect/messages/ThreadActions.jsx')
    assert.match(staff, /<p id="reply-safety" style=\{safety\}>\{SAFETY_NOTICE\}<\/p>/)
    assert.doesNotMatch(staff, /ptl-msg-safety|ptl-compose-note/)
  })
})

test('typography hierarchy', async (t) => {
  await t.test('the workspace heading is a page heading, scoped so other cards keep theirs', () => {
    // Global .ptl-section-title is 15px, 18px above 761px: too small for a page
    // heading, but StudentPortal's own section cards must keep it.
    // UL-POLISH P2: the page-title scale is now shared across the portal
    // (20-22px). Still scoped to .ptl-msg-workspace, so StudentPortal's own
    // section cards keep the 15px card-title scale.
    assert.match(css, /\.ptl-msg-workspace \.ptl-section-title \{ font-size: 22px; line-height: 1\.25; \}/)
    assert.doesNotMatch(css, /^\.ptl-section-title \{[^}]*font-size: 2[0-9]px/m)
  })

  await t.test('body, subjects, and metadata are readable', () => {
    assert.match(css, /\.ptl-msg-subtitle \{ font-size: 14\.5px; margin: 0; \}/)
    assert.match(css, /\.ptl-msg-row-subject \{[\s\S]{0,140}?font-size: 15\.5px;/)
    assert.match(css, /\.ptl-msg-row-meta \{[\s\S]{0,140}?font-size: 12\.5px;/)
    assert.match(css, /\.ptl-msg-row-preview \{\s*\n\s*font-size: 13px;/)
    assert.match(css, /\.ptl-msg-body \{ font-size: 14\.5px;/)
    assert.match(css, /\.ptl-msg-thread-subject \{[\s\S]{0,140}?font-size: 18px;/)
  })
})

test('no horizontal overflow and no regressions', async (t) => {
  await t.test('long content wraps rather than forcing a scrollbar', () => {
    assert.match(css, /\.ptl-msg-pane \{ min-width: 0; \}/)
    for (const sel of ['ptl-msg-row-subject', 'ptl-msg-thread-subject', 'ptl-msg-body']) {
      assert.match(css, new RegExp(`\\.${sel} \\{[\\s\\S]{0,160}?overflow-wrap: anywhere`), `${sel} must wrap`)
    }
  })

  await t.test('Phase 5 behavior is untouched by the visual pass', () => {
    // Reverse pagination, the mutexes, the 409 reason, and the mark-read gate.
    assert.match(read('../api/portal/messages-thread.js'), /messages_portal_get_thread_v2/)
    assert.match(read('../src/lib/messages/portalThreadState.js'), /export function prependOlderPage/)
    assert.match(reply, /const sendingRef = useRef\(false\)/)
    assert.match(drawer, /const submittingRef = useRef\(false\)/)
    assert.match(reply, /mapPortalConflict\(e2\?\.reason\)/)
    assert.match(read('../src/portal/messages/PortalMessagesThread.jsx'), /if \(!active\) return/)
    assert.match(read('../src/portal/PortalApp.jsx'), /<PortalMessagesWorkspace\s[\s\S]*?active=\{studentView === 'messages'\}/)
  })

  await t.test('staff Messages and the migrations were not touched', () => {
    assert.match(read('../src/pages/Connect.jsx'), /<MessagesWorkspace refreshKey=\{refreshKey\} onOpenStudent=\{onNavigateToStudent\} \/>/)
    assert.match(read('../api/messages-staff-thread.js'), /messages_staff_get_thread_v2/)
    for (const n of ['20260716000000_messages_phase1_schema_foundation',
      '20260716000006_messages_phase5_portal_thread_reverse_pagination']) {
      assert.ok(read(`../supabase/migrations/${n}.sql`).length > 0)
    }
  })

  await t.test('no em dash and correct ASPIRE usage', () => {
    for (const s of [css, polling, ...Object.values(jsxFiles)]) {
      assert.doesNotMatch(s, /\u2014/)
      assert.doesNotMatch(s, /ASPIRE Program/)
    }
  })
})

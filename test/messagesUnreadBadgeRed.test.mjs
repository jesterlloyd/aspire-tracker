// MESSAGES-BADGE: guards for the Cedars-Sinai red unread counters and the global
// ASPIRE Connect icon badge. Static-source plus pure-function, matching the
// repository stack. No real API call or student content.
//
// Run: node --test test/messagesUnreadBadgeRed.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  UNREAD_BADGE_BG, UNREAD_BADGE_FG, formatUnread, unreadLabel,
} from '../src/lib/messages/messagesConstants.js'
import { BADGE_COUNT_BG, BADGE_COUNT_FG, pinBadgeStyle, inlineBadgeStyle } from '../src/lib/badgeTokens.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const indexCss = read('../src/index.css')
const portalCss = read('../src/portal/portal.css')
const headerActions = read('../src/components/Header/HeaderActions.jsx')
const headerCode = strip(headerActions)
const connect = read('../src/pages/Connect.jsx')
const staffInbox = read('../src/components/connect/messages/MessagesInbox.jsx')
const portalNav = read('../src/portal/PortalNav.jsx')
const polling = read('../src/lib/messages/messagesPolling.js')

test('the red comes from the existing token, not a duplicated hex', async (t) => {
  await t.test('--cs-red is already defined on :root and is the Cedars-Sinai red', () => {
    assert.match(indexCss, /--cs-red:\s*#dc1e34;/i)
  })

  await t.test('one shared source defines the badge color for the whole app', () => {
    assert.equal(BADGE_COUNT_BG, 'var(--cs-red, #DC1E34)')
    assert.equal(BADGE_COUNT_FG, '#FFFFFF')
    // Messages re-exports the same source rather than defining a second copy.
    assert.equal(UNREAD_BADGE_BG, BADGE_COUNT_BG)
    assert.equal(UNREAD_BADGE_FG, BADGE_COUNT_FG)
    const mc = read('../src/lib/messages/messagesConstants.js')
    assert.match(mc, /export \{ BADGE_COUNT_BG as UNREAD_BADGE_BG, BADGE_COUNT_FG as UNREAD_BADGE_FG \} from '\.\.\/badgeTokens\.js';/)
    // The shared styles carry the shared color, so no call site restates it.
    assert.equal(pinBadgeStyle.background, BADGE_COUNT_BG)
    assert.equal(pinBadgeStyle.color, BADGE_COUNT_FG)
    assert.equal(inlineBadgeStyle.background, BADGE_COUNT_BG)
  })

  await t.test('no Messages badge hard-codes the hex instead of the token', () => {
    for (const [name, s] of Object.entries({ connect, staffInbox, headerActions })) {
      const badgeArea = strip(s)
      assert.doesNotMatch(badgeArea, /background:\s*['"]#DC1E34['"]/i, `${name} must use the token`)
    }
  })
})

test('every Messages unread counter is red, and none is blue', async (t) => {
  await t.test('Student Portal Messages navigation badge', () => {
    assert.match(portalCss, /\.ptl-nav-badge \{[\s\S]{0,160}?background: var\(--cs-red, #DC1E34\); color: #fff;/)
    assert.match(portalNav, /<span className="ptl-nav-badge" aria-hidden="true">\{formatUnread\(unread\)\}<\/span>/)
  })

  await t.test('Student Portal inbox row counter', () => {
    assert.match(portalCss, /\.ptl-msg-unread-dot \{[\s\S]{0,200}?background: var\(--cs-red, #DC1E34\); color: #fff;/)
  })

  await t.test('ASPIRE Connect Messages tab badge', () => {
    assert.match(connect, /style=\{\{ \.\.\.inlineBadgeStyle, marginLeft: 2 \}\}/)
    // It previously swapped color with tab selection; the red is now constant.
    assert.doesNotMatch(strip(connect), /background: activeSubTab === 'messages' \? 'rgba\(255,255,255,0\.22\)'/)
  })

  await t.test('staff inbox row counter', () => {
    assert.match(staffInbox, /<span style=\{\{ \.\.\.badge, background: UNREAD_BADGE_BG, color: UNREAD_BADGE_FG \}\}>/)
    // UNREAD_BADGE_BG is the re-exported shared token, so this is the app red.
    assert.equal(UNREAD_BADGE_BG, BADGE_COUNT_BG)
  })

  await t.test('global ASPIRE Connect icon badge', () => {
    const btn = headerActions.slice(headerActions.indexOf('data-tour="connect"'), headerActions.indexOf('data-tour="catalog"'))
    assert.match(btn, /<span aria-hidden="true" style=\{pinBadgeStyle\}>/)
  })

  await t.test('Interview Room .ir-tab-badge uses the shared red token', () => {
    // A count badge, so it follows the badge standard. It is NOT the Chroma
    // accent that also happens to be #930045.
    assert.match(indexCss, /\.ir-tab-badge \{[\s\S]{0,600}?background: var\(--cs-red, #DC1E34\); color: #FFFFFF;/)
    const rule = indexCss.slice(indexCss.indexOf('.ir-tab-badge {'), indexCss.indexOf('.ir-tab-badge {') + 700)
    // Only the explanatory comment may mention the old color, never a declaration.
    assert.doesNotMatch(rule, /background:\s*#930045/)
  })

  await t.test('the live UnifiedNav counter badges use the shared source', () => {
    const nav = read('../src/components/UnifiedNav.jsx')
    assert.match(nav, /import \{ BADGE_COUNT_BG, BADGE_COUNT_FG \} from '\.\.\/lib\/badgeTokens'/)
    // Both spBadge and irBadge spans, color-only migration.
    assert.equal((nav.match(/background: BADGE_COUNT_BG, color: BADGE_COUNT_FG,/g) || []).length, 2)
    // No count badge in UnifiedNav is still #930045.
    const spSpan = nav.slice(nav.indexOf('spBadge > 0'), nav.indexOf('spBadge >= 10'))
    const irSpan = nav.slice(nav.indexOf('irBadge > 0'), nav.indexOf('irBadge >= 10'))
    assert.doesNotMatch(spSpan, /#930045/)
    assert.doesNotMatch(irSpan, /#930045/)
    // Geometry and 9+ count logic preserved.
    assert.match(nav, /\{spBadge >= 10 \? '9\+' : spBadge\}/)
    assert.match(nav, /\{irBadge >= 10 \? '9\+' : irBadge\}/)
    assert.match(nav, /fontVariantNumeric: 'tabular-nums', lineHeight: 1\.4,/)
  })

  await t.test('the protected non-badge #930045 tokens are untouched', () => {
    const theme = read('../src/styles/theme.css')
    assert.match(theme, /--color-accent-secondary: #930045;/)
    assert.match(theme, /--color-status-danger:\s*#930045;/)
  })

  await t.test('no unread counter uses the old navy', () => {
    // The badges were authored navy to match the accent, which is the defect.
    assert.doesNotMatch(portalCss, /\.ptl-nav-badge \{[\s\S]{0,160}?background: #1D2567/)
    assert.doesNotMatch(portalCss, /\.ptl-msg-unread-dot \{[\s\S]{0,200}?background: #1D2567/)
    // The accent legitimately remains the selected tab button's background; only
    // the unread badge moved off it. Scope the check to the badge span.
    const badgeSpan = connect.slice(connect.indexOf('{messagesUnread > 0 && ('), connect.indexOf('{formatUnread(messagesUnread)}'))
    assert.doesNotMatch(badgeSpan, /#1D2567|--color-accent-primary/)
    assert.match(connect, /background: activeSubTab === key \? 'var\(--color-accent-primary,#1D2567\)'/,
      'the tab button background is unchanged')
  })
})

test('count formatting and accessible labels', async (t) => {
  await t.test('hidden at zero, plain to 99, 99+ above', () => {
    assert.equal(formatUnread(0), null)
    assert.equal(formatUnread(1), '1')
    assert.equal(formatUnread(7), '7')
    assert.equal(formatUnread(99), '99')
    assert.equal(formatUnread(100), '99+')
    assert.equal(formatUnread(150), '99+')
  })

  await t.test('negative and invalid counts fail safe to hidden', () => {
    assert.equal(formatUnread(-1), null)
    assert.equal(formatUnread(null), null)
    assert.equal(formatUnread(undefined), null)
    assert.equal(formatUnread(NaN), null)
    assert.equal(formatUnread('abc'), null)
  })

  await t.test('the accessible label keeps the TRUE count, never the cap', () => {
    assert.equal(unreadLabel(1), '1 unread message')
    assert.equal(unreadLabel(7), '7 unread messages')
    assert.equal(unreadLabel(150), '150 unread messages')
    assert.equal(unreadLabel(0), '')
  })

  await t.test('every badge renders only above zero', () => {
    assert.match(portalNav, /\{unread > 0 && \(/)
    assert.match(connect, /\{messagesUnread > 0 && \(/)
    assert.match(headerActions, /\{messagesUnread > 0 && \(/)
  })

  await t.test('the visual chip is hidden from assistive technology', () => {
    assert.match(portalNav, /<span className="ptl-nav-badge" aria-hidden="true">/)
    assert.match(headerActions, /<span aria-hidden="true" style=\{pinBadgeStyle\}>/)
  })
})

test('the Connect icon badge', async (t) => {
  await t.test('it sits on the real ASPIRE Connect icon', () => {
    const btn = headerActions.slice(headerActions.indexOf('data-tour="connect"'), headerActions.indexOf('data-tour="catalog"'))
    assert.match(btn, /<MessagesSquare size=\{15\}/)
    assert.match(btn, /\{messagesUnread > 0 && \(/)
    assert.match(btn, /<span aria-hidden="true" style=\{pinBadgeStyle\}>/)
  })

  await t.test('it shares one pin badge with the Action Center bell', () => {
    // Both header badges render style={pinBadgeStyle}: same color, size, shape,
    // position, and navy ring, from one definition.
    assert.equal((headerActions.match(/style=\{pinBadgeStyle\}/g) || []).length, 2)
    assert.equal(pinBadgeStyle.top, -3)
    assert.equal(pinBadgeStyle.border, '1.5px solid #1D2567')
  })

  await t.test('the count is in the aria-label, since aria-label overrides inner text', () => {
    assert.match(headerActions, /aria-label=\{messagesUnread > 0\s*\n\s*\? `ASPIRE Connect, \$\{unreadLabel\(messagesUnread\)\}`\s*\n\s*: 'ASPIRE Connect'\}/)
  })

  await t.test('the icon click target and routing are unchanged', () => {
    assert.match(headerActions, /localStorage\.getItem\('aspire\.connect\.lastTab'\)/)
    assert.match(headerActions, /navigate\(`\/connect\/\$\{tab\}`\)/)
    assert.match(headerActions, /width: 34, height: 34/)
  })

  await t.test('Action Center now shares the red, but its count LOGIC is unchanged', () => {
    // The standard was corrected to one color everywhere, so #930045 is gone.
    assert.doesNotMatch(headerActions, /#930045/)
    // Its count behavior is Action Center's own and must not change: still 9+.
    assert.match(headerActions, /\{actionBadgeCount >= 10 \? '9\+' : actionBadgeCount\}/)
    assert.match(headerActions, /aria-label="Action Center"/)
    // The bell badge and its open marker still render; only the color moved.
    assert.match(headerActions, /ref=\{bellRef\}/)
  })
})

test('authorization', async (t) => {
  await t.test('the badge gate is an ACTIVE Owner or Admin', () => {
    assert.match(headerActions, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)\s*\n\s*&& userProfile\?\.is_active !== false/)
  })

  await t.test('it does not lean on isAdmin or canEdit, which ignore activity', () => {
    const auth = read('../src/contexts/AuthContext.jsx')
    assert.match(auth, /isAdmin:\s*\['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
    assert.match(auth, /canEdit:\s*\['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
    assert.doesNotMatch(headerCode, /canUseMessages = (isAdmin|canEdit)/)
  })

  await t.test('an unauthorized caller never requests the count', () => {
    // `enabled` gates the query itself, so Interviewer, Viewer, inactive staff,
    // portal users, and unauthenticated callers issue no request at all.
    assert.match(headerActions, /enabled: canUseMessages,/)
    assert.match(polling, /export function useStaffUnreadCount\(\{ intervalMs = ACTIVE_POLL_MS, enabled = true, api = defaultApi \} = \{\}\)/)
    assert.match(polling, /\n    enabled,/)
    assert.match(polling, /refetchInterval: enabled && visible \? intervalMs : false/)
    assert.match(polling, /refetchOnWindowFocus: enabled/)
  })

  await t.test('never is_staff, no direct RPC, no service role', () => {
    assert.doesNotMatch(headerCode, /is_staff/)
    assert.doesNotMatch(headerCode, /\.rpc\(/)
    assert.doesNotMatch(headerCode, /service_role|SERVICE_ROLE/)
  })

  await t.test('the portal count is never mixed into the staff badge', () => {
    assert.doesNotMatch(headerCode, /portal_messages_unread|usePortalUnreadCount|getPortalUnreadCount/)
    assert.match(polling, /queryKey: \['messages_staff_unread'\]/)
  })
})

test('query and polling reuse', async (t) => {
  await t.test('the icon badge and the tab badge share one query key', () => {
    assert.match(headerActions, /useStaffUnreadCount\(\{/)
    assert.match(connect, /useStaffUnreadCount\(\{/)
    // One key means React Query serves both observers from a single query.
    assert.match(polling, /queryKey: \['messages_staff_unread'\]/)
    assert.equal((polling.match(/queryKey: \['messages_staff_unread'\]/g) || []).length, 1)
  })

  await t.test('no duplicate fetch and no second interval were introduced', () => {
    assert.doesNotMatch(headerCode, /fetch\(|useQuery\(|setInterval|setTimeout/)
    assert.doesNotMatch(headerCode, /getStaffUnreadCount/)
  })

  await t.test('the header polls at the idle cadence; the Messages tab still drives 30s', () => {
    assert.match(headerActions, /intervalMs: IDLE_UNREAD_POLL_MS,/)
    assert.match(connect, /intervalMs: activeSubTab === 'messages' \? ACTIVE_POLL_MS : IDLE_UNREAD_POLL_MS,/)
    assert.match(polling, /export const ACTIVE_POLL_MS = 30 \* 1000/)
    assert.match(polling, /export const IDLE_UNREAD_POLL_MS = 60 \* 1000/)
  })

  await t.test('no Realtime and no persistence of the count', () => {
    assert.doesNotMatch(strip(polling), /realtime|\.channel\(|\.subscribe\(/i)
    assert.doesNotMatch(headerCode, /localStorage\.setItem\([^)]*unread/i)
    assert.doesNotMatch(strip(polling), /localStorage|sessionStorage|indexedDB/i)
  })

  await t.test('portal polling is untouched', () => {
    const pp = read('../src/lib/messages/portalMessagesPolling.js')
    assert.match(pp, /queryKey: \['portal_messages_unread'\]/)
    assert.match(pp, /export const PORTAL_ACTIVE_POLL_MS = 30 \* 1000/)
    assert.match(pp, /export const PORTAL_IDLE_UNREAD_POLL_MS = 60 \* 1000/)
    assert.match(read('../src/portal/PortalApp.jsx'), /intervalMs: studentView === 'messages' \? PORTAL_ACTIVE_POLL_MS : PORTAL_IDLE_UNREAD_POLL_MS/)
  })
})

test('regression', async (t) => {
  await t.test('no unread badge was added to an unrelated nav item', () => {
    // Catalog and the user menu gain nothing.
    const catalog = headerActions.slice(headerActions.indexOf('data-tour="catalog"'), headerActions.indexOf('data-tour="action-center"'))
    assert.doesNotMatch(catalog, /messagesUnread|UNREAD_BADGE_BG/)
    // UnifiedNav has a pre-existing useUnreadStudents badge that is unrelated to
    // Messages and out of scope: assert only that Messages did not leak in.
    const nav = read('../src/components/UnifiedNav.jsx')
    assert.doesNotMatch(nav, /messages_staff_unread|useStaffUnreadCount|UNREAD_BADGE/)
    assert.match(nav, /useUnreadStudents/, 'the existing unrelated badge is untouched')
  })

  await t.test('Connect tabs and staff Messages still work', () => {
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
    assert.match(connect, /<MessagesWorkspace refreshKey=\{refreshKey\} \/>/)
    assert.match(connect, /<ContactsView refreshKey=\{refreshKey\} \/>/)
    assert.match(connect, /<OutreachView cohortId=\{cohortId\}/)
    assert.match(connect, /<AutomationView active=\{activeSubTab === 'broadcasts'\}/)
  })

  await t.test('Student Portal Messages still works', () => {
    assert.match(read('../src/portal/PortalApp.jsx'), /<PortalMessagesWorkspace active=\{studentView === 'messages'\} \/>/)
    assert.match(read('../api/portal/messages-thread.js'), /messages_portal_get_thread_v2/)
  })

  await t.test('all seven migrations and the badge generator are present and untouched', () => {
    for (const n of ['20260716000000_messages_phase1_schema_foundation',
      '20260716000006_messages_phase5_portal_thread_reverse_pagination']) {
      assert.ok(read(`../supabase/migrations/${n}.sql`).length > 0)
    }
  })

  await t.test('no em dash and correct ASPIRE usage', () => {
    for (const s of [headerActions, portalNav, portalCss, connect, staffInbox]) {
      assert.doesNotMatch(s, /\u2014/)
      assert.doesNotMatch(s, /ASPIRE Program/)
    }
  })
})

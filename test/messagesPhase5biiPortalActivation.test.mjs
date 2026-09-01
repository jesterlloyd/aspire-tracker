// MESSAGES-PHASE5B-II: guards for the Student Portal Messages activation.
// Static-source and pure-function, matching the repository stack. No real API
// call, conversation, notification, or student content.
//
// Run: node --test test/messagesPhase5biiPortalActivation.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { formatUnread, unreadLabel } from '../src/lib/messages/messagesConstants.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const app = read('../src/portal/PortalApp.jsx')
const appCode = strip(app)
const shell = read('../src/portal/PortalShell.jsx')
const nav = read('../src/portal/PortalNav.jsx')
const navCode = strip(nav)
const studentPortal = read('../src/portal/StudentPortal.jsx')
const workspace = read('../src/portal/messages/PortalMessagesWorkspace.jsx')
const thread = read('../src/portal/messages/PortalMessagesThread.jsx')
const polling = read('../src/lib/messages/portalMessagesPolling.js')
const css = read('../src/portal/portal.css')
const rootApp = read('../src/App.jsx')

test('activation: the workspace is mounted inside the portal boundary', async (t) => {
  await t.test('PortalApp mounts the existing dormant workspace', () => {
    assert.match(app, /import PortalMessagesWorkspace from '\.\/messages\/PortalMessagesWorkspace'/)
    // ASPIRE-COMPASS: the workspace is URL-controlled but still mounted only
    // here, still gated by the active prop.
    assert.match(app, /<PortalMessagesWorkspace\s[\s\S]*?active=\{studentView === 'messages'\}/)
  })

  await t.test('no second portal Messages implementation was created', () => {
    // The activation reuses the Phase 5B-i components verbatim.
    assert.match(app, /import PortalNav from '\.\/PortalNav'/)
    assert.doesNotMatch(appCode, /useInfiniteQuery|messages-list|messages-thread|listPortalConversations/)
  })

  await t.test('it mounts ONLY in the active student branch', () => {
    // roles come from get_my_portal_access(), which returns only grants passing
    // the canonical active predicate, so this branch IS the active-access gate.
    const branch = app.slice(app.indexOf("if (roles.includes('student'))"), app.indexOf("if (roles.includes('unit_leader'))"))
    assert.match(branch, /<PortalMessagesWorkspace/)
    assert.match(branch, /<PortalNav/)
  })

  await t.test('no other portal role mounts Messages', () => {
    // PORTAL-ACCESS-STATE: the fallback is now <PortalAccessNotice>, which
    // reports WHY there is no portal instead of one catch-all card. The slice
    // landmark moved with it; the property under test is unchanged.
    const end = app.indexOf('<PortalAccessNotice')
    assert.ok(end > 0, 'the portal fallback landmark must exist')
    const unit = app.slice(app.indexOf("if (roles.includes('unit_leader'))"), end)
    assert.doesNotMatch(unit, /PortalMessagesWorkspace|PortalNav/)
  })

  await t.test('the access boundary is the active portal grant, resolved server-side', () => {
    assert.match(app, /supabase\.rpc\('get_my_portal_access'\)/)
    const authz = read('../supabase/migrations/20260712000007_phase2_authz_foundation.sql')
    // Active predicate.
    assert.match(authz, /g\.revoked_at IS NULL\s*\n\s*AND g\.starts_at <= now\(\)\s*\n\s*AND \(g\.expires_at IS NULL OR g\.expires_at > now\(\)\)/)
    // Identity is resolved, never forced equal.
    assert.match(authz, /SELECT id FROM public\.user_profiles WHERE auth_user_id = auth\.uid\(\)/)
  })

  await t.test('the browser grants nothing on its own', () => {
    for (const s of [appCode, navCode, strip(workspace)]) {
      assert.doesNotMatch(s, /is_staff/)
      assert.doesNotMatch(s, /\.rpc\('messages_/)
      assert.doesNotMatch(s, /service_role|SERVICE_ROLE/)
      // No student, staff, or recipient email is handled in the browser. The one
      // permitted appearance is the fixed ASPIRE support address on the
      // no-access card: a mailto link and its visible label, which identify
      // nobody. Those lines are set aside by name and everything else must
      // still be free of any email reference.
      const withoutSupport = s.split('\n').filter(l => !/SUPPORT_EMAIL/.test(l)).join('\n')
      assert.doesNotMatch(withoutSupport, /email/i)
    }
    // Client visibility is not the boundary: every call is an authenticated API.
    assert.match(read('../src/lib/messages/portalMessagesApiClient.js'), /\/api\/portal\/messages-list/)
  })

  await t.test('URL routing is deliberate, minimal, and grants nothing', () => {
    // ASPIRE-COMPASS (owner-approved): /portal, /portal/messages, and
    // /portal/messages/:threadId are real URLs now. Routing uses ONLY the
    // app's existing react-router (no new routing library), the view derives
    // from the location, and URLs never grant access: the messages endpoints
    // still verify the caller's JWT on every request.
    assert.match(app, /useLocation, useNavigate \} from 'react-router-dom'/)
    assert.doesNotMatch(appCode, /wouter|@tanstack\/react-router|BrowserRouter|createBrowserRouter/)
    assert.match(app, /location\.pathname\.startsWith\('\/portal\/messages'\)/)
    // App.jsx routes the whole /portal/* subtree to the SAME guarded
    // PortalRoute; the workspace itself is still only imported by PortalApp.
    assert.match(rootApp, /const PortalApp = lazy\(\(\) => import\('\.\/portal\/PortalApp'\)\)/)
    assert.match(rootApp, /<Route path="\/portal\/\*"\s+element=\{<PortalRoute \/>\} \/>/)
    assert.doesNotMatch(strip(rootApp), /PortalMessagesWorkspace/)
  })

  await t.test('PortalShell is untouched, so activation is isolated to PortalApp', () => {
    assert.doesNotMatch(strip(shell), /Messages|PortalNav|unread/)
  })

  await t.test('StudentPortal itself is untouched', () => {
    assert.doesNotMatch(strip(studentPortal), /PortalMessagesWorkspace|PortalNav|usePortalUnreadCount/)
  })
})

test('activation: view switching preserves both surfaces', async (t) => {
  await t.test('Home and Messages are mounted-but-hidden, not unmounted', () => {
    // Unmounting would drop the reply draft, the selected conversation, the
    // mobile view, and StudentPortal's own fetched data on every switch.
    assert.match(app, /display: \['home', 'placement'\]\.includes\(studentView\) \? 'block' : 'none'/)
    assert.match(app, /display: studentView === 'messages' \? 'block' : 'none'/)
  })

  await t.test('the existing portal home still renders and keeps its props', () => {
    // STUDENT-PORTAL-PROFILE-1 (Owner decision): the EditProfileDrawer is retired as
    // an editor; the drawer plumbing (editOpen/onOpenEdit/onCloseEdit) is gone and
    // the profile affordances navigate to the My Profile destination instead.
    assert.match(app, /<StudentPortal\s[\s\S]*?onOpenProfile=\{goProfile\}/)
    assert.match(app, /onEditProfile=\{goProfile\}/)
    assert.doesNotMatch(app, /editOpen|onOpenEdit|onCloseEdit/)
  })

  await t.test('the default view is Home', () => {
    // The view derives from the URL. Regular student Messages and the read-only
    // Owner/Admin preview Messages route share one explicit predicate; every
    // other unmatched Student Portal path resolves to Home.
    assert.match(app, /const studentMessagesPath = location\.pathname\.startsWith\('\/portal\/messages'\)[\s\S]*?startsWith\('\/portal\/student\/messages'\)/)
    assert.match(app, /const studentView = studentMessagesPath \? 'messages'[\s\S]*?: 'home'/)
  })

  await t.test('a hidden Messages view does not poll the inbox or thread', () => {
    assert.match(workspace, /refreshMs=\{active \? PORTAL_ACTIVE_POLL_MS : false\}/)
    assert.match(app, /<PortalMessagesWorkspace\s[\s\S]*?active=\{studentView === 'messages'\}/)
  })

  await t.test('a hidden Messages view never marks anything read', () => {
    // The gate sits BEFORE the token is recorded, and `active` is a dependency,
    // so returning to Messages still marks read exactly once.
    assert.match(thread, /if \(!active\) return\s*\n\s*if \(!conversationId \|\| !newestPage\) return/)
    assert.match(thread, /\}, \[active, conversationId, newestPage, newestAt, onMarkRead\]\)/)
    assert.match(workspace, /active=\{active\}/)
  })
})

test('unread navigation badge', async (t) => {
  await t.test('the badge is driven by the portal unread hook', () => {
    assert.match(app, /const unread = usePortalUnreadCount\(\{/)
    assert.match(app, /<PortalNav\s[\s\S]*?unread=\{unread\}/)
  })

  await t.test('30 seconds while Messages is active, 60 seconds elsewhere', () => {
    // UL-POLISH: the cadence is unchanged; the route check now serves both
    // portal kinds (the unit-leader branch polls too).
    assert.match(app, /intervalMs: onMessagesRoute \? PORTAL_ACTIVE_POLL_MS : PORTAL_IDLE_UNREAD_POLL_MS/)
    assert.match(polling, /export const PORTAL_ACTIVE_POLL_MS = 30 \* 1000/)
    assert.match(polling, /export const PORTAL_IDLE_UNREAD_POLL_MS = 60 \* 1000/)
  })

  await t.test('paused while hidden, refreshed on focus, never overlapping', () => {
    assert.match(polling, /refetchInterval: enabled && visible \? intervalMs : false/)
    assert.match(polling, /refetchOnWindowFocus: enabled/)
    assert.match(polling, /document\.addEventListener\('visibilitychange', sync\)/)
    // One query key means React Query serializes refetches; the workspace's own
    // unread observer shares it rather than adding a second request.
    assert.match(polling, /queryKey: \['portal_messages_unread'\]/)
    assert.doesNotMatch(strip(polling), /setInterval/)
  })

  await t.test('hidden at zero, 1 through 99 plain, 99+ above that', () => {
    assert.match(nav, /\{unread > 0 && \(/)
    assert.match(nav, /\{formatUnread\(unread\)\}/)
    assert.equal(formatUnread(0), null)
    assert.equal(formatUnread(1), '1')
    assert.equal(formatUnread(99), '99')
    assert.equal(formatUnread(100), '99+')
  })

  await t.test('accessible unread text carries the true count, not the cap', () => {
    assert.match(nav, /\{unread > 0 \? unreadLabel\(unread\) : ''\}/)
    assert.equal(unreadLabel(3), '3 unread messages')
    assert.equal(unreadLabel(150), '150 unread messages')
    assert.equal(unreadLabel(0), '')
    // The visible chip is decorative; the text is the accessible source.
    assert.match(nav, /<span className="ptl-nav-badge" aria-hidden="true">/)
  })

  await t.test('it is the portal count only, never staff', () => {
    assert.match(polling, /getPortalUnreadCount/)
    assert.doesNotMatch(strip(polling), /messages_staff_unread|getStaffUnreadCount/)
    assert.doesNotMatch(navCode, /staff/i)
    // No portal count in the staff sidebar, and no public-site badge.
    assert.doesNotMatch(read('../src/components/UnifiedNav.jsx'), /portal_messages_unread|usePortalUnreadCount/)
  })

  await t.test('the portal unread endpoint counts only staff-authored messages', () => {
    assert.match(read('../api/portal/messages-unread-count.js'), /messages_portal_unread_count/)
    assert.match(read('../supabase/migrations/20260716000002_messages_phase3_api_foundation.sql'),
      /FROM public\.messages m\s*\n\s*WHERE m\.conversation_id IN \(SELECT public\.my_message_conversation_ids\(\)\)\s*\n\s*AND m\.author_role = 'staff'/)
  })
})

test('navigation semantics and accessibility', async (t) => {
  await t.test('it is a labeled nav of real buttons', () => {
    assert.match(nav, /<nav className="ptl-nav" aria-label="Student Portal sections">/)
    assert.match(nav, /type="button"/)
  })

  await t.test('the active section is conveyed semantically, not by color alone', () => {
    assert.match(nav, /aria-current=\{view === 'home' \? 'page' : undefined\}/)
    assert.match(nav, /aria-current=\{view === 'messages' \? 'page' : undefined\}/)
    // The underline plus weight are the visual echo.
    assert.match(css, /\.ptl-nav-item-active \{ color: var\(--ptl-navy\); border-bottom-color: var\(--ptl-navy\); \}/)
  })

  await t.test('visible focus and adequate touch targets', () => {
    // ASPIRE-COMPASS: focus comes from the portal-wide focus-visible ring; the
    // nav only tightens the offset so the ring hugs the tab.
    assert.match(css, /\.ptl-page \*:focus-visible \{\s*\n\s*outline: 2px solid var\(--ptl-navy\);/)
    assert.match(css, /\.ptl-nav-item:focus-visible \{ outline-offset: -2px; \}/)
    assert.match(css, /\.ptl-nav-item \{[\s\S]*?min-height: 44px;/)
  })

  await t.test('icons are decorative and the label is text', () => {
    assert.match(nav, /<Home size=\{16\} aria-hidden="true" \/>/)
    assert.match(nav, /<MessageSquare size=\{16\} aria-hidden="true" \/>/)
    assert.match(nav, /<span className="ptl-nav-label">Messages<\/span>/)
    assert.match(nav, /<span className="ptl-nav-label">Home<\/span>/)
  })

  await t.test('unrelated portal items were not renamed', () => {
    // The shell's own actions are untouched.
    assert.match(shell, /Edit Profile/)
    assert.match(shell, /Public site/)
    assert.match(shell, /Sign out/)
  })
})

test('the three Phase 5B-i visual-pass fixes are preserved', async (t) => {
  await t.test('1. synchronous duplicate-submit mutex on both writes', () => {
    const newMsg = read('../src/portal/messages/PortalNewMessageDrawer.jsx')
    const reply = read('../src/portal/messages/PortalReplyComposer.jsx')
    assert.match(newMsg, /const submittingRef = useRef\(false\)/)
    assert.match(newMsg, /if \(submittingRef\.current \|\| pending\) return/)
    assert.match(newMsg, /submittingRef\.current = true/)
    assert.match(reply, /const sendingRef = useRef\(false\)/)
    assert.match(reply, /if \(sendingRef\.current \|\| pending\) return/)
    assert.match(reply, /sendingRef\.current = true/)
  })

  await t.test('2. the 409 reason is retained and mapped, never shown raw', () => {
    const core = read('../src/lib/messages/messagesApiClient.js')
    assert.match(core, /constructor\(status, code, reason\)/)
    assert.match(core, /this\.reason = reason \|\| null;/)
    assert.match(core, /if \(typeof parsed\?\.reason === 'string'\) reason = parsed\.reason;/)
    const reply = read('../src/portal/messages/PortalReplyComposer.jsx')
    assert.match(reply, /mapPortalConflict\(e2\?\.reason\)/)
    assert.match(reply, /if \(portalConflictIsAccessLost\(e2\?\.reason\)\) setAccessLost\(true\)/)
    // Safe copy only.
    const constants = read('../src/lib/messages/portalMessagesConstants.js')
    assert.match(constants, /no longer active, so replies cannot be sent/)
  })

  await t.test('3. an unmeasured width is not a phone', () => {
    assert.match(polling, /const isNarrowWidth = \(width, maxWidth\) => width > 0 && width <= maxWidth;/)
    assert.match(polling, /isNarrowWidth\(window\.innerWidth, maxWidth\)/)
  })

  await t.test('revoked access disables sending but keeps history readable', () => {
    const reply = read('../src/portal/messages/PortalReplyComposer.jsx')
    assert.match(reply, /const disabled = !conversationId \|\| pending \|\| !check\.ok \|\| accessLost/)
    // The draft survives, and nothing hides the thread.
    const c = reply.slice(reply.indexOf('} catch (e2)'), reply.indexOf('} finally'))
    assert.doesNotMatch(c, /setBody\(''\)/)
    assert.doesNotMatch(strip(reply), /hideHistory|setMessages\(\[\]\)/)
  })
})

test('regression: nothing else moved', async (t) => {
  await t.test('all seven migrations are present', () => {
    for (const n of ['20260716000000_messages_phase1_schema_foundation',
      '20260716000001_messages_phase2_notification_delivery_foundation',
      '20260716000002_messages_phase3_api_foundation',
      '20260716000003_messages_phase3_delivery_invariant_fix',
      '20260716000004_messages_phase4_staff_inbox_filter_modes',
      '20260716000005_messages_phase4_staff_thread_reverse_pagination',
      '20260716000006_messages_phase5_portal_thread_reverse_pagination']) {
      assert.ok(read(`../supabase/migrations/${n}.sql`).length > 0, `missing ${n}`)
    }
  })

  await t.test('the portal thread endpoint still uses v2, and the client never uses v1', () => {
    assert.match(read('../api/portal/messages-thread.js'), /messages_portal_get_thread_v2/)
    assert.doesNotMatch(strip(read('../api/portal/messages-thread.js')), /rpc\('messages_portal_get_thread'/)
    assert.doesNotMatch(strip(read('../src/lib/messages/portalMessagesApiClient.js')), /messages_portal_get_thread\b/)
    // v1 remains in migrations for rollback.
    assert.match(read('../supabase/migrations/20260716000002_messages_phase3_api_foundation.sql'),
      /CREATE OR REPLACE FUNCTION public\.messages_portal_get_thread\(/)
  })

  await t.test('staff Messages and the other Connect tabs are unchanged', () => {
    const connect = read('../src/pages/Connect.jsx')
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
    assert.match(connect, /<MessagesWorkspace refreshKey=\{refreshKey\} onOpenStudent=\{onNavigateToStudent\} \/>/)
    assert.match(connect, /<ContactsView refreshKey=\{refreshKey\} \/>/)
    assert.match(connect, /<OutreachView[^>]*cohortId=\{cohortId\}/)
    assert.match(connect, /<AutomationView active=\{activeSubTab === 'broadcasts'\}/)
    assert.match(read('../api/messages-staff-list.js'), /messages_staff_list_conversations_v2/)
    assert.match(read('../api/messages-staff-thread.js'), /messages_staff_get_thread_v2/)
  })

  await t.test('Academic Partner Messages is fail-closed (Preceptor remains a reservation)', () => {
    // UL-PORTAL: Unit Leader Messages is DELIBERATELY activated. Preceptor remains a schema
    // reservation with no authorization branch. Academic Partner Messages is now WIRED but
    // fail-closed behind the SERVER capability (messagesEnabled prop / apMessagesEnabled): the portal
    // reuses the canonical workspace, gated so that until the server reports capable it mounts no
    // workspace and makes no request.
    const apPortal = read('../src/portal/AcademicPartnerPortal.jsx')
    assert.match(apPortal, /if \(!messagesEnabled\)/)   // fail-closed gate precedes the workspace
    assert.doesNotMatch(apPortal, /AP_MESSAGING_ENABLED|apMessaging/)   // no client capability constant
    // The AP branch runs the utility layer with Messages gated on the server capability value.
    assert.match(appCode.slice(appCode.indexOf("roles.includes('academic_partner')")), /messagesAuthorized=\{apMessagesEnabled\}/)
    // Preceptor is still never admitted anywhere in the messaging auth chain.
    assert.doesNotMatch(read('../api/lib/messagesAuth.js').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''), /preceptor/)
  })

  await t.test('no analytics, telemetry, persistence, or dangerous HTML in the activation', () => {
    for (const s of [appCode, navCode]) {
      assert.doesNotMatch(s, /analytics|telemetry|gtag|posthog/i)
      assert.doesNotMatch(s, /localStorage|sessionStorage|indexedDB/i)
      assert.doesNotMatch(s, /dangerouslySetInnerHTML|innerHTML/)
      assert.doesNotMatch(s, /console\./)
    }
  })

  await t.test('no temporary harness or debug surface survives', () => {
    for (const s of [appCode, navCode, strip(workspace)]) {
      assert.doesNotMatch(s, /__harness|harness|debug|VITE_ENABLE|featureFlag/i)
    }
  })

  await t.test('no em dash and correct ASPIRE usage', () => {
    for (const s of [app, nav, css, workspace, thread]) {
      assert.doesNotMatch(s, /\u2014/)
      assert.doesNotMatch(s, /ASPIRE Program/)
    }
  })
})

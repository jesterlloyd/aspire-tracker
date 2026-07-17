// MESSAGES-PHASE4B2B-II: guards for the final Connect activation. Static-source,
// using the repository's existing node:test stack. No real API call, message, or
// student content.
//
// Run: node --test test/messagesPhase4b2iiConnectActivation.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const connect = read('../src/pages/Connect.jsx')
const code = strip(connect)
const polling = read('../src/lib/messages/messagesPolling.js')
const workspace = read('../src/components/connect/messages/MessagesWorkspace.jsx')
const auth = read('../src/contexts/AuthContext.jsx')
const app = read('../src/App.jsx')

test('Connect authorization gate', async (t) => {
  await t.test('requires BOTH an owner/admin role AND an active profile', () => {
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)\s*\n\s*&& userProfile\?\.is_active !== false/)
  })

  await t.test('does not rely on canEdit or isAdmin, which are role-only', () => {
    // Proof the shortcut would be wrong: useAuth defines both without is_active.
    assert.match(auth, /isAdmin:\s*\['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
    assert.match(auth, /canEdit:\s*\['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
    assert.doesNotMatch(code, /canUseMessages = (canEdit|isAdmin)/)
  })

  await t.test('never uses is_staff', () => {
    assert.doesNotMatch(code, /is_staff/)
  })

  await t.test('an inactive profile is additionally blocked app-wide', () => {
    // The established behavior: AuthedShell renders Account Deactivated before
    // any tab can mount, so an inactive Owner/Admin never reaches Connect.
    assert.match(app, /if \(user && userProfile && !userProfile\.is_active\)/)
  })

  await t.test('the tab renders only for an authorized user', () => {
    assert.match(connect, /\{canUseMessages && \(\s*\n\s*<button onClick=\{\(\) => navigate\('\/connect\/messages'\)\}/)
  })

  await t.test('the workspace mounts only for an authorized user', () => {
    assert.match(connect, /\{canUseMessages && \(\s*\n\s*<div style=\{\{ display: activeSubTab === 'messages'/)
    assert.match(connect, /<MessagesWorkspace refreshKey=\{refreshKey\} \/>/)
  })

  await t.test('an unauthorized user never resolves to Messages and never calls its APIs', () => {
    // The resolved tab can never be 'messages' without authorization, so the
    // workspace (and every Messages request it would make) never mounts.
    assert.match(connect, /const activeSubTab = \(rawSubTab === 'messages' && !canUseMessages\) \? 'contacts' : rawSubTab/)
    // The unread badge query is disabled, so not even the count is requested.
    assert.match(connect, /enabled: canUseMessages/)
    assert.match(polling, /export function useStaffUnreadCount\(\{ intervalMs = ACTIVE_POLL_MS, enabled = true, api = defaultApi \} = \{\}\)/)
    assert.match(polling, /\n    enabled,/)
  })

  await t.test('the unauthorized redirect cannot loop', () => {
    // The guard reads rawSubTab (the PATH), not the resolved tab, and replaces
    // once to an allowed tab. After the redirect the path is no longer
    // /connect/messages, so the effect cannot re-fire.
    assert.match(connect, /if \(rawSubTab === 'messages' && !canUseMessages\) \{\s*\n\s*navigate\('\/connect\/contacts', \{ replace: true \}\)/)
  })
})

test('Connect routing', async (t) => {
  await t.test('messages joins VALID_TABS and Automations keeps its slug', () => {
    assert.match(connect, /const VALID_TABS = new Set\(\['contacts', 'outreach', 'messages', 'broadcasts'\]\)/)
    assert.match(connect, /navigate\('\/connect\/broadcasts'\)/)
    assert.doesNotMatch(code, /\/connect\/automations/)
  })

  await t.test('tab order is Contacts, Outreach, Messages, Automations', () => {
    const order = [...connect.matchAll(/navigate\('\/connect\/(contacts|outreach|messages|broadcasts)'\)\} style=\{btnStyle/g)].map((m) => m[1])
    assert.deepEqual(order, ['contacts', 'outreach', 'messages', 'broadcasts'])
  })

  await t.test('direct navigation and refresh select Messages from the URL', () => {
    // The tab is derived from location.pathname, so a refresh retains it and
    // Back/Forward keep working through navigate().
    assert.match(connect, /location\.pathname\.startsWith\('\/connect\/messages'\)\s*\n?\s*\? 'messages'/)
  })

  await t.test('an authorized user may store Messages as the last tab', () => {
    assert.match(connect, /if \(VALID_TABS\.has\(activeSubTab\) && \(activeSubTab !== 'messages' \|\| canUseMessages\)\)/)
  })

  await t.test('an unauthorized stored Messages tab falls back safely', () => {
    assert.match(connect, /const allowed = saved && VALID_TABS\.has\(saved\) && \(saved !== 'messages' \|\| canUseMessages\)/)
    assert.match(connect, /navigate\(`\/connect\/\$\{allowed \? saved : 'contacts'\}`, \{ replace: true \}\)/)
  })

  await t.test('the existing tabs and their behavior are preserved', () => {
    for (const t2 of ['contacts', 'outreach', 'broadcasts']) {
      assert.ok(connect.includes(`navigate('/connect/${t2}')`), `missing ${t2} tab`)
    }
    assert.match(connect, /<ContactsView refreshKey=\{refreshKey\} \/>/)
    assert.match(connect, /<OutreachView cohortId=\{cohortId\}/)
    assert.match(connect, /<AutomationView active=\{activeSubTab === 'broadcasts'\}/)
    assert.match(connect, /aspire\.connect\.lastTab/)
    // Mounted-but-hidden preservation is unchanged for every tab.
    assert.match(connect, /display: activeSubTab === 'contacts' \? 'flex' : 'none'/)
    assert.match(connect, /display: activeSubTab === 'outreach' \? 'block' : 'none'/)
    assert.match(connect, /display: activeSubTab === 'broadcasts' \? 'block' : 'none'/)
    assert.match(connect, /display: activeSubTab === 'messages' \? 'flex' : 'none'/)
  })
})

test('Messages tab unread badge', async (t) => {
  await t.test('shows only above zero, with 99+ formatting and accessible text', () => {
    assert.match(connect, /\{messagesUnread > 0 && \(/)
    assert.match(connect, /\{formatUnread\(messagesUnread\)\}/)
    assert.match(connect, /<span style=\{srOnly\}>\{unreadLabel\(messagesUnread\)\}<\/span>/)
    // formatUnread caps at 99+ and unreadLabel supplies the text; both are
    // covered by the Phase 4A constants tests.
    assert.match(connect, /import \{ formatUnread, unreadLabel \}/)
  })

  await t.test('is not conveyed by color alone', () => {
    // The chip carries the count itself, plus screen-reader text.
    assert.match(connect, /<span aria-hidden="true" style=\{\{[\s\S]{0,600}?\{formatUnread\(messagesUnread\)\}/)
  })

  await t.test('polls at 30s active and 60s idle, pausing while hidden', () => {
    assert.match(connect, /intervalMs: activeSubTab === 'messages' \? ACTIVE_POLL_MS : IDLE_UNREAD_POLL_MS/)
    assert.match(polling, /export const ACTIVE_POLL_MS = 30 \* 1000/)
    assert.match(polling, /export const IDLE_UNREAD_POLL_MS = 60 \* 1000/)
    assert.match(polling, /refetchInterval: enabled && visible \? intervalMs : false/)
    assert.match(polling, /refetchOnWindowFocus: enabled/)
  })

  await t.test('read state stays per staff profile and no global sidebar badge is added', () => {
    // The count comes from the staff unread endpoint, which is scoped to the
    // calling profile, so one staff member reading never clears another's.
    assert.match(polling, /queryKey: \['messages_staff_unread'\]/)
    assert.doesNotMatch(read('../src/components/UnifiedNav.jsx'), /messages|Messages/)
  })
})

test('workspace and prior-phase behavior preserved', async (t) => {
  await t.test('the workspace reuses the Phase 4A inbox with no parallel implementation', () => {
    assert.match(workspace, /import MessagesInbox from '\.\/MessagesInbox'/)
    assert.match(workspace, /<MessagesInbox/)
  })

  await t.test('Phase 4B2a thread, read-state, and polling behavior is intact', () => {
    assert.match(workspace, /queryKey: \['messages_staff_thread', conversationId\]/)
    assert.match(workspace, /getNextPageParam: \(lastPage\) => \(lastPage\?\.has_more \? lastPage\?\.next_cursor \?\? undefined : undefined\)/)
    assert.match(workspace, /Load earlier messages/)
    assert.match(workspace, /refetchInterval: visible \? ACTIVE_POLL_MS : false/)
    assert.match(workspace, /markedRef\.current === token/)
  })

  await t.test('Phase 4B2b-i writes and controls are intact', () => {
    assert.match(workspace, /<NewMessageDialog/)
    assert.match(workspace, /<ReplyComposer/)
    assert.match(workspace, /<ThreadManagementControls/)
    assert.match(workspace, /role="status" aria-live="polite"/)
  })

  await t.test('the v2 RPCs remain the active server path', () => {
    assert.match(read('../api/messages-staff-list.js'), /messages_staff_list_conversations_v2/)
    assert.match(read('../api/messages-staff-thread.js'), /messages_staff_get_thread_v2/)
  })

  await t.test('the header subtitle makes no promise about response time', () => {
    assert.match(workspace, /Communicate securely with active ASPIRE portal participants\./)
    assert.doesNotMatch(workspace, /respond within|response time|monitored (24|around)/i)
  })
})

test('privacy and scope at activation', async (t) => {
  await t.test('Connect logs nothing and renders no dangerous HTML', () => {
    assert.doesNotMatch(code, /console\.(log|error|warn)/)
    assert.doesNotMatch(code, /dangerouslySetInnerHTML/)
    assert.doesNotMatch(code, /analytics|telemetry/i)
  })

  await t.test('Connect makes no direct RPC or service-role call', () => {
    assert.doesNotMatch(code, /\.rpc\(/)
    assert.doesNotMatch(code, /service_role|SERVICE_ROLE/)
  })

  await t.test('no Student Portal Messages UI exists', () => {
    for (const f of ['../src/portal/PortalApp.jsx', '../src/portal/PortalShell.jsx', '../src/portal/StudentPortal.jsx']) {
      assert.doesNotMatch(read(f), /MessagesWorkspace|MessagesInbox|messagesApiClient|NewMessageDialog/)
    }
  })

  await t.test('App.jsx was not modified for activation', () => {
    // Connect owns its own sub-tab routing, so the app shell needed no change.
    assert.doesNotMatch(app, /MessagesWorkspace/)
  })
})

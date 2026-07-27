// Portal cohort polish, Commit 4: Academic Partner <-> ASPIRE Team messaging, reusing the canonical
// portal messaging stack (no parallel tables, endpoints, or UI). End-to-end enablement requires an
// Owner SQL migration (the DB read/send predicates + general-team-start RPC admit only student and
// unit_leader), so the feature is fail-closed behind AP_MESSAGING_ENABLED: the AP Messages tab shows a
// prepared state, no launcher mounts, and AP thread creation is refused (503). Source guards prove the
// wiring, the fail-closed posture, the fixed ASPIRE Team recipient, and reuse of the shared components.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const flag = read('src/lib/apMessaging.js')
const auth = read('api/lib/messagesAuth.js')
const teamStart = read('api/portal/team-messages-start.js')
const portal = read('src/portal/AcademicPartnerPortal.jsx')
const app = read('src/portal/PortalApp.jsx')
const layer = read('src/portal/PortalUtilityLayer.jsx')
const workspace = read('src/portal/messages/PortalMessagesWorkspace.jsx')

test('the capability flag exists and defaults to false (fail-closed)', () => {
  assert.ok(existsSync(join(root, 'src/lib/apMessaging.js')))
  assert.match(flag, /export const AP_MESSAGING_ENABLED = false/)
  // The flag documents that the ONLY remaining blocker is an Owner SQL migration.
  assert.match(flag, /Owner SQL gate/)
})

test('the messages caller admits an active academic partner, last, with server-derived school scope', () => {
  assert.match(auth, /import \{ verifyPortalAcademicPartnerCaller \} from '\.\/schoolScope\.js'/)
  const fn = auth.slice(
    auth.indexOf('export async function verifyPortalMessagesCaller'),
    auth.indexOf('export async function verifyPortalStudentCaller'))
  // Student -> unit leader -> academic partner, in that order (no existing behavior changes).
  assert.ok(fn.indexOf('verifyPortalStudentCaller') < fn.indexOf('verifyPortalUnitLeaderCaller'))
  assert.ok(fn.indexOf('verifyPortalUnitLeaderCaller') < fn.indexOf('verifyPortalAcademicPartnerCaller'))
  assert.match(fn, /actorKind: 'academic_partner'/)
  // School scope comes from the active user_school_scopes rows resolved by the shared AP verifier,
  // never from a request value. Cross-school, student-linked, revoked/expired, and WCU-campus
  // isolation are all enforced there (see schoolScope + academicPartner tests).
  assert.match(fn, /schoolKeys = \[\.\.\.new Set\(\(asPartner\.scopes \|\| \[\]\)\.map\(\(s\) => s\.school_key\)\.filter\(Boolean\)\)\]/)
})

test('AP thread creation is fail-closed: 503 until enabled, and requires an active school scope', () => {
  assert.match(teamStart, /import \{ AP_MESSAGING_ENABLED \} from '\.\.\/\.\.\/src\/lib\/apMessaging\.js'/)
  // A partner with no active school scope is refused before anything else.
  assert.match(teamStart, /if \(!caller\.schoolKeys \|\| caller\.schoolKeys\.length === 0\) \{\s*\n\s*return res\.status\(403\)\.json\(\{ error: 'no_active_school_scope' \}\)/)
  // Until the flag is flipped (post-migration), the RPC is never attempted; the handler returns 503.
  assert.match(teamStart, /if \(!AP_MESSAGING_ENABLED\) \{\s*\n\s*return res\.status\(503\)\.json\(\{ error: 'messaging_not_enabled', reason: 'ap_messaging_pending_migration' \}\)/)
  // No parallel write path: it still delegates to the ONE shared general-team start service.
  assert.match(teamStart, /startGeneralTeamConversationForPortal/)
})

test('the AP Messages tab reuses the canonical workspace with the academic_partner variant', () => {
  assert.match(portal, /import PortalMessagesWorkspace from '\.\/messages\/PortalMessagesWorkspace'/)
  assert.match(portal, /import \{ AP_MESSAGING_ENABLED \} from '\.\.\/lib\/apMessaging'/)
  const code = stripJs(portal)
  // Fail-closed: prepared state while off; the SAME PortalMessagesWorkspace when on (no parallel UI).
  assert.match(code, /if \(view === 'messages'\) \{[\s\S]*?if \(!AP_MESSAGING_ENABLED\) \{[\s\S]*?being prepared and is not active yet/)
  assert.match(code, /<PortalMessagesWorkspace[\s\S]*?variant="academic_partner"[\s\S]*?threadId=\{threadId\}/)
  // The workspace maps the academic_partner variant to AP-appropriate subtitle copy.
  assert.match(workspace, /variant === 'academic_partner' \? AP_PORTAL_SUBTITLE/)
})

test('the lower-right launcher + unread wiring is shared and AP-gated (no duplicate store)', () => {
  // The launcher mounts for AP only when authorized (flag on); the panel uses the academic_partner
  // variant. This is the SAME PortalTeamMessagesPanel + shared React-Query keys, not a second store.
  assert.match(layer, /messagesEnabled = messagesAuthorized && \(isUnitLeaderPortal \|\| isStudentPortal \|\| isAcademicPartnerPortal\)/)
  assert.match(layer, /variant=\{isUnitLeaderPortal \? 'unit_leader' : isAcademicPartnerPortal \? 'academic_partner' : 'student'\}/)
  // The unread badge uses the canonical Cedars red token (shared with student/UL), not a new color.
  const css = read('src/portal/portal.css')
  assert.match(css, /\.ptl-team-message-badge[\s\S]*?background: var\(--cs-red, #DC1E34\)/)
  // AP messages route + thread deep link reuse the same PortalApp routing pattern (one URL space).
  assert.match(app, /function apThreadIdFromPath\(pathname\)/)
  assert.match(app, /const apMessagesEnabled = isAcademicPartner && AP_MESSAGING_ENABLED/)
  assert.match(app, /enabled: isStudent \|\| isUnitLeader \|\| apMessagesEnabled/)
})

test('no parallel messaging surface: AP introduces no new message endpoints or tables', () => {
  // AP reuses the existing endpoints only; there is no api/portal/school-messages* file.
  assert.ok(!existsSync(join(root, 'api/portal/school-messages-start.js')))
  assert.ok(!existsSync(join(root, 'api/portal/ap-messages-start.js')))
  // The AP portal makes no direct Supabase/message-table calls; it goes through the shared workspace.
  assert.doesNotMatch(stripJs(portal), /supabase\.from\('conversations'\)|supabase\.from\('messages'\)|localStorage/)
})

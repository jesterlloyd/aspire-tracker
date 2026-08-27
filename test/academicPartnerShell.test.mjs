// AP Phase 1, Commit 1: the Academic Partner portal shell, three-tab navigation, URL routing,
// and the Feedback-only utility layer. Static-source guards (no runtime); the reuse-first shell,
// Nightfall chrome, and prepared states are asserted against the shared portal foundation.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const app = read('src/portal/PortalApp.jsx')
const nav = read('src/portal/ap/AcademicPartnerChrome.jsx')
const portal = read('src/portal/AcademicPartnerPortal.jsx')
const layer = read('src/portal/PortalUtilityLayer.jsx')
const endpoint = read('api/portal/feedback-submit.js')
const apBranch = app.slice(app.indexOf("roles.includes('academic_partner')"), app.indexOf('return <BeingPrepared'))

test('the Academic Partner branch renders the shared Nightfall shell', () => {
  assert.match(apBranch, /<PortalShell title="Academic Partner Portal"/)
  assert.match(apBranch, /withTabBar showHeaderName/)
  assert.match(apBranch, /headerVariant="nightfall" logoSrc="\/cs-logo-large\.png"/)
  assert.match(apBranch, /publicSiteUrl="https:\/\/aspireintelligence\.app"/)
  assert.match(apBranch, /nav=\{<AcademicPartnerNav view=\{apView\} onNavigate=\{goApSection\} \/>\}/)
  assert.match(apBranch, /<AcademicPartnerPortal view=\{apView\} onNavigate=\{goApSection\} schoolKeys=\{access\?\.school_keys \|\| \[\]\}[\s\S]*?threadId=\{apThreadId\} onSelectThread=\{openApThread\} onBackToList=\{apBackToList\} \/>/)
})

test('the three sections are stable URL routes; /portal resolves to Students', () => {
  assert.match(app, /const AP_SECTIONS = new Set\(\['students', 'placement-requests', 'messages'\]\)/)
  // apViewFromPath: a valid /portal/ap/<section> resolves to that section, else Students (default).
  assert.match(app, /function apViewFromPath\(pathname\) \{[\s\S]*?return 'students'\s*\n\}/)
  assert.match(app, /const apView = apViewFromPath\(location\.pathname\)/)
  assert.match(app, /const goApSection = useCallback\(\(key\) => \{\s*\n\s*navigate\(`\/portal\/ap\/\$\{key\}`\)/)
  // Student and Unit Leader routing is untouched (their parsers still exist).
  assert.match(app, /function unitViewFromPath/)
  assert.match(app, /function threadIdFromPath/)
})

test('AcademicPartnerNav is exactly Students, Placement Requests, Messages', () => {
  assert.match(nav, /export function AcademicPartnerNav\(\{ view, onNavigate \}\)/)
  assert.match(nav, /key: 'students',\s*label: 'Students'/)
  assert.match(nav, /key: 'placement-requests', label: 'Placement Requests'/)
  assert.match(nav, /key: 'messages',\s*label: 'Messages'/)
  // Reuses the shared attached-nav language and the accessible current-page + tab semantics.
  assert.match(nav, /<nav className="ptl-nav" aria-label="Academic Partner Portal sections">/)
  assert.match(nav, /className=\{`ptl-nav-item\$\{view === key \? ' ptl-nav-item-active' : ''\}`\}/)
  assert.match(nav, /aria-current=\{view === key \? 'page' : undefined\}/)
  // No unread badge is wired in the nav code (Messages backend is not authorized this phase).
  assert.doesNotMatch(stripJs(nav), /unread|ptl-nav-badge|formatUnread/)
})

test('the three sections route: Students roster, Placement Requests workspace, Messages prepared', () => {
  const code = stripJs(portal)
  assert.match(portal, /export default function AcademicPartnerPortal\(\{ view = 'students', onNavigate, messagesEnabled = false, threadId, onSelectThread, onBackToList \}\)/)
  assert.match(portal, /if \(view === 'placement-requests'\)/)
  assert.match(portal, /if \(view === 'messages'\)/)
  // Placement Requests is now the live workspace; Messages stays an honest prepared state.
  assert.match(portal, /import PlacementRequestsView from '\.\/ap\/PlacementRequestsView'/)
  assert.match(code, /return <PlacementRequestsView onNavigate=\{onNavigate\} \/>/)
  assert.match(portal, /import \{[^}]*\bEmptyState\b[^}]*\} from '\.\/unit\/UnitLeaderChrome'/)
  assert.match(portal, /being prepared and is not active yet/)  // Messages prepared state (flag off)
  // Students still renders the roster (StudentsView).
  assert.match(code, /return <StudentsView \/>/)
  assert.match(code, /function StudentsView\(\)/)
  // No fake data, no drawer, no On Campus Now, no Needs Attention on the students surface.
  assert.doesNotMatch(code, /OnCampusNow|NeedsAttention|StudentDetailDrawer|ptl-detail-drawer/)
})

test('Messages is fail-closed for the Academic Partner behind a SERVER capability (no client constant)', () => {
  // The AP branch wires the canonical launcher + workspace, but enablement is a SERVER capability the
  // client fetches (env flag AND applied DB migration); the browser never decides it from a constant.
  assert.match(app, /const apMessagesEnabled = isAcademicPartner && apMessagingCapable/)
  assert.match(app, /fetch\('\/api\/portal\/portal-capabilities'/)
  assert.match(app, /setApMessagingCapable\(data\?\.ap_messaging === true\)/)
  assert.match(apBranch, /messagesAuthorized=\{apMessagesEnabled\}/)
  assert.match(apBranch, /messagesEnabled=\{apMessagesEnabled\}/)
  // No client capability constant survives: no AP_MESSAGING_ENABLED and no import of the old module.
  assert.doesNotMatch(app, /AP_MESSAGING_ENABLED/)
  assert.doesNotMatch(app, /from '\.\.\/lib\/apMessaging'/)
  // The AP Messages view reuses the CANONICAL workspace (no parallel system), gated on the prop; when
  // disabled it shows the honest prepared state.
  assert.match(portal, /import PortalMessagesWorkspace from '\.\/messages\/PortalMessagesWorkspace'/)
  assert.match(stripJs(portal), /if \(!messagesEnabled\) \{[\s\S]*?being prepared and is not active yet/)
  assert.match(stripJs(portal), /<PortalMessagesWorkspace[\s\S]*?variant="academic_partner"/)
})

test('the Academic Partner top-chrome profile control uses avatar_url with an initials fallback', () => {
  // Reuses the exact Unit Leader profile-image resolution path (user_profiles.avatar_url); no new
  // upload flow, no raw storage path, and the shared ProfileMenu keeps the initials fallback.
  assert.match(apBranch, /profileImageUrl=\{userProfile\?\.avatar_url\}/)
  const shell = read('src/portal/PortalShell.jsx')
  assert.match(shell, /const showPhoto = Boolean\(profileImageUrl && failedImageUrl !== profileImageUrl\)/)
  assert.match(shell, /\? <img src=\{profileImageUrl\} alt="" onError=\{\(\) => setFailedImageUrl\(profileImageUrl\)\} \/>/)
  assert.match(shell, /: initials\(userName\)/)
})

test('the utility layer enables Feedback for the Academic Partner, and Messages only when authorized', () => {
  assert.match(layer, /isAcademicPartnerPortal = portalRole === 'academic_partner' && portalType === 'academic_partner'/)
  assert.match(layer, /feedbackEnabled = feedbackAuthorized && \(isUnitLeaderPortal \|\| isStudentPortal \|\| isAcademicPartnerPortal \|\| isNursingAcademicPortal\)/)
  // Messages is gated on messagesAuthorized (AP is fail-closed behind AP_MESSAGING_ENABLED), so with
  // the flag off the AP launcher never mounts, exactly as before.
  assert.match(layer, /messagesEnabled = messagesAuthorized && \(isUnitLeaderPortal \|\| isStudentPortal \|\| isAcademicPartnerPortal \|\| isNursingAcademicPortal\)/)
  assert.match(layer, /if \(!enabled \|\| \(!isUnitLeaderPortal && !isStudentPortal && !isAcademicPartnerPortal && !isNursingAcademicPortal\)\) return null/)
  // The docked Messages panel mounts only where Messages is enabled, so AP never instantiates it.
  assert.match(layer, /\{messagesEnabled && \(\s*\n\s*<PortalTeamMessagesPanel/)
  // The feedback endpoint authorizes an active academic_partner grant (wired to the DB + RPC that
  // already accept the role).
  assert.match(endpoint, /hasActiveRoleGrant\([^)]*'academic_partner'\)/)
  assert.match(endpoint, /actorKind: 'academic_partner'/)
})

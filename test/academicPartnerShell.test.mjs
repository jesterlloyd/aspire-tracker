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
  assert.match(apBranch, /<AcademicPartnerPortal view=\{apView\} schoolKeys=\{access\?\.school_keys \|\| \[\]\} \/>/)
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

test('Placement Requests and Messages render honest prepared states, not broken controls', () => {
  const code = stripJs(portal)
  assert.match(portal, /export default function AcademicPartnerPortal\(\{ view = 'students' \}\)/)
  assert.match(portal, /if \(view === 'placement-requests'\)/)
  assert.match(portal, /if \(view === 'messages'\)/)
  // The prepared states reuse the shared EmptyState primitive (no bespoke card, no controls).
  assert.match(portal, /import \{ EmptyState \} from '\.\/unit\/UnitLeaderChrome'/)
  assert.match(portal, /being prepared and is not active yet/)
  // Students still renders the roster (StudentsView), which is the only view that fetches.
  assert.match(code, /return <StudentsView \/>/)
  assert.match(code, /function StudentsView\(\)/)
  // No fake data, no drawer, no On Campus Now, no Needs Attention in this phase.
  assert.doesNotMatch(code, /OnCampusNow|NeedsAttention|StudentDetailDrawer|ptl-detail-drawer/)
})

test('Messages backend stays dormant for the Academic Partner', () => {
  // The AP branch runs the utility layer with Messages explicitly unauthorized: Feedback only.
  assert.match(apBranch, /messagesAuthorized=\{false\}/)
  assert.doesNotMatch(apBranch, /onOpenMessages=|unread=\{unread\}/)
  // No Messages workspace or Messages client is mounted from the AP portal.
  assert.doesNotMatch(stripJs(portal), /PortalMessagesWorkspace|portalMessages|team-messages/)
})

test('the utility layer enables Feedback (not Messages) for the Academic Partner, end to end', () => {
  assert.match(layer, /isAcademicPartnerPortal = portalRole === 'academic_partner' && portalType === 'academic_partner'/)
  assert.match(layer, /feedbackEnabled = isUnitLeaderPortal \|\| isStudentPortal \|\| isAcademicPartnerPortal/)
  assert.match(layer, /messagesEnabled = messagesAuthorized && \(isUnitLeaderPortal \|\| isStudentPortal\)/)
  assert.match(layer, /if \(!enabled \|\| \(!isUnitLeaderPortal && !isStudentPortal && !isAcademicPartnerPortal\)\) return null/)
  // The docked Messages panel mounts only where Messages is enabled, so AP never instantiates it.
  assert.match(layer, /\{messagesEnabled && \(\s*\n\s*<PortalTeamMessagesPanel/)
  // The feedback endpoint authorizes an active academic_partner grant (wired to the DB + RPC that
  // already accept the role).
  assert.match(endpoint, /hasActiveRoleGrant\([^)]*'academic_partner'\)/)
  assert.match(endpoint, /actorKind: 'academic_partner'/)
})

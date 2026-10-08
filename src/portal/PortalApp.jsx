// PHASE2-PORTAL: role-aware portal entry (lazy chunk).
//
// Resolves the signed-in user's ACTIVE portal grants via the SECURITY DEFINER
// RPC get_my_portal_access() (Phase 2 migration) and renders the matching
// portal. Every read this chunk performs is authorized server-side (scoped
// views, RPCs, or JWT-verified endpoints). If the RPC is missing or returns
// no grants, the user sees the "being prepared" landing, never an error.
//
// ASPIRE-COMPASS: the student section is now URL-driven:
//   /portal                     -> Home
//   /portal/messages            -> Messages (list)
//   /portal/messages/:threadId  -> Messages (thread selected)
// URLs never grant access: the messages endpoints verify the caller's own JWT
// and an active student link on every request, and an unauthorized or unknown
// thread id fails closed through the existing error mapping. Both sections
// stay MOUNTED and are hidden with display (matching the staff Connect
// convention) so a reply draft, the fetched Home data, and list state survive
// navigation; the workspace's `active` prop is what stops a hidden view from
// polling or marking anything read. Refresh, back, and forward now work
// because the view derives from the location instead of transient state.

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { postMyResidency } from '../lib/myResidencyApi'
import { lazyReload } from '../lib/lazyReload'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useUserPreference } from '../hooks/useUserPreference'
import { RESIDENCY_DIGEST } from '../lib/userPreferences'
import PortalShell from './PortalShell'
import PortalUtilityLayer from './PortalUtilityLayer'
import FeedbackPanel from '../components/FeedbackPanel'
import MainMessagesLauncher from '../components/MainMessagesLauncher'
import PortalNav from './PortalNav'
// STUDENT-SHIFT-TAB-1: loaded on first visit; it carries the shift-log views.
const StudentShiftLog = lazyReload(() => import('./StudentShiftLog'), 'StudentShiftLog')
const StudentResidency = lazyReload(() => import('./StudentResidency'), 'StudentResidency')
// PORTAL-SPLIT Phase 3 (2026-09-16): one chunk per portal.
//
// All five were static imports, so every portal visitor downloaded all five. A
// student on a phone carried the Unit Leader workspace, the Academic Partner
// portal and the Nursing Education & Leadership reports before their own home
// screen could paint, and none of it is reachable from their role. Each portal
// now loads when its own role resolves, one role per visitor.
//
// The navs and chrome stay STATIC: they render with the shell before the body
// arrives, they are small, and UnitLeaderChrome's shared states (EmptyState,
// LoadingState) are used by the Academic Partner portal too.
const StudentPortal          = lazyReload(() => import('./StudentPortal'), 'StudentPortal')
const MyProfile              = lazyReload(() => import('./MyProfile'), 'MyProfile')
const UnitLeaderPortal       = lazyReload(() => import('./UnitLeaderPortal'), 'UnitLeaderPortal')
const AcademicPartnerPortal  = lazyReload(() => import('./AcademicPartnerPortal'), 'AcademicPartnerPortal')
const NursingAcademicsPortal = lazyReload(() => import('./na/NursingAcademicsPortal'), 'NursingAcademicsPortal')
const ResidencyPortal        = lazyReload(() => import('./residency/ResidencyPortal'), 'ResidencyPortal')
import { EmptyState, UnitLeaderNav } from './unit/UnitLeaderChrome'
import { AcademicPartnerNav } from './ap/AcademicPartnerChrome'
// NURSING-ACADEMICS-1: the fourth portal experience (organization-wide, view only).
import { NursingAcademicsNav } from './na/NursingAcademicsChrome'
// RESIDENCY-PORTAL-1: the fifth portal experience (Cedars-Sinai Talent Acquisition).
import { ResidencyNav } from './residency/ResidencyChrome'
import { NAV_LABELS } from '../lib/navigationCanon'
import { resolveNgrpPath, ngrpPath, RESIDENCY_PORTAL_BASE, NGRP_TABS } from '../lib/ngrp/ngrpTabs'
import { canManageNgrp } from '../lib/ngrp/ngrpAccess'
import PortalCohortLoginHint from './PortalCohortLoginHint'
import PortalMessagesWorkspace from './messages/PortalMessagesWorkspace'
// PROFILE-MENU-AVATARS-1: self-service photo dialog shared by all three portals.
import ChangePhotoDialog from './ChangePhotoDialog'
import {
  PORTAL_ACTIVE_POLL_MS, PORTAL_IDLE_UNREAD_POLL_MS, usePortalUnreadCount,
} from '../lib/messages/portalMessagesPolling'
import { usePortalHeadshotUrl } from '../lib/useStudentFile'
import { useStudentFileUrl } from '../lib/useStudentFile'
// WELCOME-TOUR-PORTALS-1: the same Welcome Tour engine the staff app uses, mounted here
// for the three portal experiences (student, unit_leader, academic_partner).
import CustomOnboardingTour from '../components/CustomOnboardingTour'
import { shouldAutoStartTour } from '../lib/onboardingTours'
import { markPortalCohortHintSeen } from '../lib/portalCohortHint'
// PORTAL-ACCESS-STATE: one honest message per access state, instead of one
// "being prepared" card standing in for every reason a portal is not there.
import { resolveAccessState, accessCopy, ACCESS_STATES, SUPPORT_EMAIL } from '../lib/portalAccessState'
// A data surface that is refused for an access reason reports it here rather than
// showing its own "something went wrong" card.
import { PortalAccessSignalContext } from './portalAccessSignal'
import { portalKeyFromPath, MAIN_APP_PATH, STAFF_SETTINGS_PATH, STAFF_PROFILE_PATH } from '../lib/portalLinks'
import '../styles/aspireBrand.css'
import '../styles/aspireTable.css'
import './portal.css'
import { demoScopeParam } from '../lib/demoMode'
import { isFullMessagesPath } from '../lib/messages/messagesRoutes'
import { budgetPortal } from '../components/budget/budgetApi'
import { fetchAcademicsEvaluationThemes } from './na/nursingAcademicsApi'
import { portalActionsFor } from './portalCommandModel'

// PORTAL-SPLIT Phase 3: what a portal shows while its own chunk arrives. The
// same card the Shift Log tab already uses, so a portal opening for the first
// time looks like one waiting for its data rather than a broken page.
function PortalLoading({ label }) {
  return <div className="ptl-card ptl-activity-loading" role="status">{label}</div>
}

// /portal/messages/abc -> 'abc'; /portal/messages -> null; /portal -> null.
function threadIdFromPath(pathname) {
  const m = /^\/portal\/messages\/([^/]+)\/?$/.exec(pathname)
  return m ? m[1] : null
}

// UL-PORTAL section from the URL. Messages deliberately shares the Student Portal
// route so a thread deep link is identical for both portal kinds.
// Every valid /portal/unit/<section>. 'students' stays here even though it left the
// primary nav, so the deep link keeps working. 'concern' stays so old links resolve,
// and is handed off to Messages below rather than 404ing.
const UNIT_SECTIONS = new Set([
  'home', 'messages', 'evaluations', 'placements', 'capacity', 'students',
  'preceptors', 'profile', 'concern',
  // NGRP-INTERVIEWS-1
  'interviews',
])
// Report a Concern is no longer a section. It was always a Messages conversation with
// destination 'aspire', so the retained route hands off to Messages with the concern
// compose prefilled rather than rendering a separate screen.
const HANDOFF_TO_MESSAGES = { concern: { compose: 'aspire', category: 'concern' } }

function unitViewFromPath(pathname) {
  if (pathname.startsWith('/portal/messages')) return 'messages'
  const m = /^\/portal\/unit\/([^/]+)\/?$/.exec(pathname)
  if (m && UNIT_SECTIONS.has(m[1])) return m[1]
  return 'home'
}

// AP-PORTAL sections are real routes under /portal/ap, so back, forward, refresh, and a
// pasted deep link all work. /portal (no section) resolves to Students, the default.
const AP_SECTIONS = new Set(['students', 'placement-requests', 'messages'])
function apViewFromPath(pathname) {
  // Messages owns a thread sub-route (/portal/ap/messages/:threadId) so a thread deep link, back, and
  // forward all work, mirroring the Student/Unit Leader /portal/messages space.
  if (/^\/portal\/ap\/messages(\/|$)/.test(pathname)) return 'messages'
  const m = /^\/portal\/ap\/([^/]+)\/?$/.exec(pathname)
  if (m && AP_SECTIONS.has(m[1])) return m[1]
  return 'students'
}
function apThreadIdFromPath(pathname) {
  const m = /^\/portal\/ap\/messages\/([^/]+)\/?$/.exec(pathname)
  return m ? m[1] : null
}

// NURSING-ACADEMICS-1: sections are real routes under /portal/academics, so
// back, forward, refresh, and a pasted deep link all work. /portal (no
// section) resolves to the Academic Calendar, the default.
// NA-PORTAL-UTILITIES-1: Messages owns a thread sub-route
// (/portal/academics/messages/:threadId), mirroring the AP space.
// PORTAL-CONNECT-1 (Owner, 2026-10-07): Contacts and Messages left the section nav for the
// portal's ASPIRE Connect, at /portal/academics/connect/contacts and /connect/messages[/:thread].
// The old /portal/academics/contacts and /messages paths still resolve (and are replaced with
// the new ones on arrival), so a bookmark or an older email link keeps working.
const NA_SECTIONS = new Set(['calendar', 'community-benefit', 'budget', 'evaluation'])
const NA_CONNECT_PATH = '/portal/academics/connect'
function naViewFromPath(pathname) {
  if (/^\/portal\/academics\/(connect\/)?messages(\/|$)/.test(pathname)) return 'messages'
  if (/^\/portal\/academics\/(connect\/)?contacts\/?$/.test(pathname)) return 'contacts'
  const m = /^\/portal\/academics\/([^/]+)\/?$/.exec(pathname)
  if (m && NA_SECTIONS.has(m[1])) return m[1]
  return 'calendar'
}
function naThreadIdFromPath(pathname) {
  const m = /^\/portal\/academics\/(?:connect\/)?messages\/([^/]+)\/?$/.exec(pathname)
  return m ? m[1] : null
}
/** The Connect path a legacy NE&L Contacts or Messages path should be replaced with, or null. */
function naLegacyConnectPath(pathname) {
  const m = /^\/portal\/academics\/(contacts|messages)(\/[^/]+)?\/?$/.exec(pathname)
  return m ? `${NA_CONNECT_PATH}/${m[1]}${m[2] || ''}` : null
}
const NA_SECTION_LABELS = { calendar: NAV_LABELS.atAGlance, 'community-benefit': NAV_LABELS.communityBenefit, budget: NAV_LABELS.programBudgets, evaluation: NAV_LABELS.evaluation }
// The Residency Portal's Connect lives beside the workspace's own tabs.
const RESIDENCY_CONNECT_RE = /^\/portal\/residency\/connect(\/|$)/
function residencyConnectTab(pathname) {
  const m = /^\/portal\/residency\/connect\/(contacts|messages)/.exec(pathname)
  return RESIDENCY_CONNECT_RE.test(pathname) ? (m ? m[1] : 'contacts') : null
}
// TA-MESSAGES-1: /portal/residency/connect/messages/:threadId selects a thread.
function residencyThreadIdFromPath(pathname) {
  const m = /^\/portal\/residency\/connect\/messages\/([^/]+)\/?$/.exec(pathname)
  return m ? m[1] : null
}

function useMobileUtilityLayout() {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  return mobile
}

// Owner/Admin preview keeps the portal chrome but uses the staff utilities.
// The student Messages tab stays inside the preview with an honest read-only
// state; the shared launcher opens the real staff inbox. Neither action
// impersonates a portal user.
function StaffPreviewUtilities({ portalName, section }) {
  const location = useLocation()
  const mobile = useMobileUtilityLayout()
  const [activeUtility, setActiveUtility] = useState(null)
  const handleMessagesOpenChange = useCallback((open) => {
    setActiveUtility(current => open ? 'messages' : current === 'messages' ? null : current)
  }, [])
  const handleFeedbackOpenChange = useCallback((open) => {
    setActiveUtility(current => open ? 'feedback' : current === 'feedback' ? null : current)
  }, [])
  return (
    <>
      {!isFullMessagesPath(location.pathname) && (
        <MainMessagesLauncher
          portalPreview
          portalPreviewMobile={mobile}
          hidden={mobile && activeUtility === 'feedback'}
          keepLauncherVisible
          onOpenChange={handleMessagesOpenChange}
        />
      )}
      <FeedbackPanel
        activeTab={section}
        cohortName={`${portalName} preview`}
        isAuthenticated
        hidden={mobile && activeUtility === 'messages'}
        open={activeUtility === 'feedback'}
        onOpenChange={handleFeedbackOpenChange}
      />
    </>
  )
}

export default function PortalApp() {
  const { userProfile, refreshUserProfile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const ownerAdmin = userProfile?.is_active !== false && ['owner', 'admin'].includes(userProfile?.role)
  const previewRole = ownerAdmin ? portalKeyFromPath(location.pathname) : null
  const staffPreview = Boolean(previewRole)
  // RESIDENCY-DIGEST-1: Talent Acquisition's opt-in weekly digest, switched in the profile menu.
  // A per-person preference (user_profiles.ui_preferences), read by the Monday cron. Declared
  // here, above every early return (rules of hooks; see the 2026-10-04 portal incident).
  const [digestPref, setDigestPref] = useUserPreference(RESIDENCY_DIGEST)
  const residencyDigest = { on: digestPref === 'on', onToggle: next => setDigestPref(next ? 'on' : 'off') }
  const [access, setAccess]   = useState(null)   // { roles, student_ids, unit_keys, school_keys }
  const [loading, setLoading] = useState(true)
  // PORTAL-ACCESS-STATE: the access lookup failing is its own state, kept apart
  // from "no grants" so a dropped request is never reported as good news.
  const [accessFailed, setAccessFailed] = useState(false)
  const [accessAttempt, setAccessAttempt] = useState(0)
  // Set when a portal data surface is refused because this person's standing
  // ended, rather than because a request failed. Sticky on purpose: once the
  // server has said the access is gone, no later view may quietly render as if
  // it were not, and Try again is not offered for something retrying cannot fix.
  const [accessEnded, setAccessEnded] = useState(false)
  const [previewStudents, setPreviewStudents] = useState([])
  const [previewStudentId, setPreviewStudentId] = useState(null)
  const [commandPeople, setCommandPeople] = useState([])

  // STUDENT-PORTAL-PROFILE-1: /portal/profile is the My Profile destination.
  const studentMessagesPath = location.pathname.startsWith('/portal/messages')
    || (previewRole === 'student' && location.pathname.startsWith('/portal/student/messages'))
  const studentView = studentMessagesPath ? 'messages'
    : location.pathname.startsWith('/portal/shift-log') || location.pathname.startsWith('/portal/student/shift-log') ? 'shiftlog'
    : location.pathname.startsWith('/portal/residency') ? 'residency'
    : location.pathname.startsWith('/portal/profile') ? 'profile'
    : location.pathname.startsWith('/portal/placement') || location.pathname.startsWith('/portal/student/placement') ? 'placement'
    : 'home'
  const threadId = threadIdFromPath(location.pathname)
  // /portal/unit/<section> -> section; /portal/messages -> messages; else home.
  const rawUnitView = unitViewFromPath(location.pathname)
  // A retained handoff route resolves to Messages, with the compose intent passed
  // through so the concern link still lands the user in the right place.
  const unitHandoff = HANDOFF_TO_MESSAGES[rawUnitView] || null
  const unitView = unitHandoff ? 'messages' : rawUnitView

  // A section change is a real navigation, so the URL is the source of truth.
  const goUnitSection = useCallback((key) => {
    // Staff preview stays inside its explicit preview route. A real Unit Leader
    // keeps the shared /portal/messages route used by existing deep links.
    if (staffPreview && key === 'messages') {
      navigate('/connect/messages')
      return
    }
    navigate(key === 'messages' ? '/portal/messages' : `/portal/unit/${key}`)
  }, [navigate, staffPreview])

  // Academic Partner sections are their own URL space (/portal/ap/<section>); /portal
  // resolves to Students. Messages and Placement Requests are stable routes now, showing
  // an honest prepared state until their backends land in later phases.
  const apView = apViewFromPath(location.pathname)
  const apThreadId = apThreadIdFromPath(location.pathname)
  const goApSection = useCallback((key) => {
    if (staffPreview && key === 'messages') {
      navigate('/connect/messages')
      return
    }
    navigate(`/portal/ap/${key}`)
  }, [navigate, staffPreview])
  // NURSING-ACADEMICS-1 section routing.
  const naView = naViewFromPath(location.pathname)
  const naThreadId = naThreadIdFromPath(location.pathname)
  // PORTAL-CONNECT-2: the Connect page's back pill returns to the section the person came from.
  // The section's path rides the router state (`from`) into Connect and is carried along while
  // they move between its tabs and threads; a pasted Connect link has none and goes home.
  const naOnConnect = naView === 'contacts' || naView === 'messages'
  const naFrom = (naOnConnect && location.state?.from) || null
  const goNaSection = useCallback((key) => {
    if (staffPreview && key === 'messages') {
      navigate('/connect/messages')
      return
    }
    // PORTAL-CONNECT-1: Contacts and Messages are the portal's Connect.
    if (key === 'contacts' || key === 'messages') {
      navigate(`${NA_CONNECT_PATH}/${key}`, { state: { from: naOnConnect ? naFrom : location.pathname } })
      return
    }
    navigate(`/portal/academics/${key}`)
  }, [navigate, staffPreview, naOnConnect, naFrom, location.pathname])
  const naBackPath = naFrom || '/portal/academics/calendar'
  const naBackLabel = NA_SECTION_LABELS[naViewFromPath(naBackPath)] || NAV_LABELS.atAGlance
  // A legacy NE&L Contacts or Messages path is replaced with its Connect path on arrival.
  const naLegacyPath = naLegacyConnectPath(location.pathname)
  useEffect(() => { if (naLegacyPath) navigate(naLegacyPath + location.search, { replace: true }) }, [naLegacyPath, location.search, navigate])
  const openApThread = useCallback((id) => navigate(`/portal/ap/messages/${id}`), [navigate])
  const apBackToList = useCallback(() => navigate('/portal/ap/messages'), [navigate])
  const openNaThread = useCallback((id) => navigate(`${NA_CONNECT_PATH}/messages/${id}`, { state: { from: naFrom } }), [navigate, naFrom])
  const naBackToList = useCallback(() => navigate(`${NA_CONNECT_PATH}/messages`, { state: { from: naFrom } }), [navigate, naFrom])
  // RESIDENCY-PORTAL-1: the Residency Portal's sections are the workspace's own
  // routes under /portal/residency; the nav and the workspace read one resolver.
  const residencyRoute = resolveNgrpPath(location.pathname, RESIDENCY_PORTAL_BASE)
  const goResidencyTab = useCallback(
    (key) => navigate(ngrpPath(key, undefined, RESIDENCY_PORTAL_BASE)),
    [navigate],
  )
  // PORTAL-CONNECT-1: on the Residency Portal's Connect no workspace tab is current.
  const residencyConnect = residencyConnectTab(location.pathname)
  const residencyFrom = (residencyConnect && location.state?.from) || null
  const goResidencyConnect = useCallback(
    (key) => navigate(`${RESIDENCY_PORTAL_BASE}/connect/${key}`, { state: { from: residencyConnect ? residencyFrom : location.pathname } }),
    [navigate, residencyConnect, residencyFrom, location.pathname],
  )
  const residencyBackPath = residencyFrom || `${RESIDENCY_PORTAL_BASE}/overview`
  const residencyThreadId = residencyThreadIdFromPath(location.pathname)
  const openResidencyThread = useCallback((id) => navigate(`${RESIDENCY_PORTAL_BASE}/connect/messages/${id}`, { state: { from: residencyFrom } }), [navigate, residencyFrom])
  const residencyBackToList = useCallback(() => navigate(`${RESIDENCY_PORTAL_BASE}/connect/messages`, { state: { from: residencyFrom } }), [navigate, residencyFrom])
  const residencyBackLabel = NGRP_TABS.find(t => t.id === resolveNgrpPath(residencyBackPath, RESIDENCY_PORTAL_BASE).tab)?.label || NAV_LABELS.atAGlance

  const isStudent = (access?.roles || []).includes('student')
  // UL-POLISH P0: the idle unread poll runs for Unit Leaders too, so the
  // Messages badge is live from Home and every other section, exactly like the
  // Student Portal. Same endpoint, same cadence, faster while on Messages.
  const isUnitLeader = !isStudent && (access?.roles || []).includes('unit_leader')
  // AP-PORTAL: Academic Partner messaging enablement is a SERVER capability (env flag AND applied DB
  // migration), fetched below. The client never decides it from a constant. Fail-closed (false) until
  // the server reports it, so the unread poll and launcher stay off until then.
  const isAcademicPartner = !isStudent && !isUnitLeader && (access?.roles || []).includes('academic_partner')
  // NURSING-ACADEMICS-1: appended LAST in the precedence chain so no existing
  // user's resolved experience changes. Organization-wide, view-only; no
  // messages, no feedback, no scope arrays.
  const isNursingAcademic = !isStudent && !isUnitLeader && !isAcademicPartner && (access?.roles || []).includes('nursing_academic')
  const [apMessagingCapable, setApMessagingCapable] = useState(false)
  // NA-PORTAL-UTILITIES-1: the Nursing Education & Leadership capabilities, from the SAME canonical
  // server endpoint. Fail-closed (false) until the server reports them.
  const [naMessagingCapable, setNaMessagingCapable] = useState(false)
  const [naFeedbackCapable, setNaFeedbackCapable] = useState(false)
  // WELCOME-TOUR-PORTALS-1: whether the AP capability fetch below has settled (succeeded or
  // failed), so the Academic Partner tour waits to decide the Messages step before it starts.
  // Student and Unit Leader have no such fetch to wait on.
  const [apCapabilityResolved, setApCapabilityResolved] = useState(false)
  const apMessagesEnabled = isAcademicPartner && apMessagingCapable
  const naMessagesEnabled = isNursingAcademic && naMessagingCapable
  // TA-MESSAGES-1: private conversations and Talent Acquisition's Messages, from the same endpoint
  // (private_messaging: the 20261114000000 migration applied). Fail-closed until it says so.
  const [privateMessagingCapable, setPrivateMessagingCapable] = useState(false)
  const isTalentAcquisition = !isStudent && !isUnitLeader && !isAcademicPartner && !isNursingAcademic && (access?.roles || []).includes('talent_acquisition')
  const taMessagesEnabled = isTalentAcquisition && privateMessagingCapable && !staffPreview
  const naFeedbackEnabled = isNursingAcademic && naFeedbackCapable
  // PROGRAM-BUDGET (2026-09-27): the Program Budget tab shows only when the server says this
  // grant carries budget_access (or the viewer is Owner/Admin previewing). Fail-closed.
  const [naBudgetEnabled, setNaBudgetEnabled] = useState(false)
  useEffect(() => {
    if (!isNursingAcademic) return undefined
    let live = true
    budgetPortal({ probe: '1' }).then(r => { if (live) setNaBudgetEnabled(!!r?.enabled) }).catch(() => { if (live) setNaBudgetEnabled(false) })
    return () => { live = false }
  }, [isNursingAcademic])
  // RESIDENCY-TAB-1: is this student an ASPIRE alumnus (Completed)? The server answers; the
  // nav then shows Residency in Shift Log's place. Not in an Owner/Admin preview, which does
  // not impersonate the student.
  const [residencyEligible, setResidencyEligible] = useState(false)
  useEffect(() => {
    if (!isStudent || staffPreview) return undefined
    let cancelled = false
    postMyResidency('status').then((r) => { if (!cancelled) setResidencyEligible(r.ok && r.eligible === true) })
    return () => { cancelled = true }
  }, [isStudent, staffPreview])
  const portalKind = isStudent ? 'student' : isUnitLeader ? 'unit_leader' : isAcademicPartner ? 'academic_partner' : isNursingAcademic ? 'nursing_academic' : 'talent_acquisition'
  const portalCommand = {
    actions: portalActionsFor(portalKind, { budgetEnabled: naBudgetEnabled, messagesEnabled: !staffPreview, residency: residencyEligible }),
    people: commandPeople,
    canAskKeith: false,
    onRun: (item) => item?.to && navigate(item.to),
    onOpenPerson: (person) => person?.to && navigate(person.to),
    // STUDENT-HEADER-1: a student's search is desktop only (see PortalCommandBar).
    desktopOnly: isStudent,
  }
  // KEITH-THEMES-1 (2026-09-29): the Evaluation tab shows only when the server says this grant carries
  // evaluation_themes_access (or the viewer is Owner/Admin previewing). Fail-closed, like the budget.
  const [naThemesEnabled, setNaThemesEnabled] = useState(false)
  useEffect(() => {
    if (!isNursingAcademic) return undefined
    let live = true
    fetchAcademicsEvaluationThemes({ probe: '1' }).then(r => { if (live) setNaThemesEnabled(!!(r.ok && r.data?.enabled)) })
    return () => { live = false }
  }, [isNursingAcademic])
  // WELCOME-TOUR-PORTALS-1: the Welcome Tour experience for the resolved portal role, derived
  // from the same role booleans the rest of this component already uses.
  const experience = isStudent ? 'student' : isUnitLeader ? 'unit_leader' : isAcademicPartner ? 'academic_partner' : isNursingAcademic ? 'nursing_academic' : null
  // PORTAL-ACCESS-STATE: a deactivated account is the one answer that outranks
  // everything else. It is read from the profile the app already holds, so no
  // extra request is needed and the answer is available even when every portal
  // endpoint is refusing this caller.
  const deactivated = userProfile?.is_active === false
  const [tourRunning, setTourRunning] = useState(false)
  const tourArmedRef = useRef(false)
  const tourTimeoutRef = useRef(null)
  const portalTourDecisionReady = Boolean(
    !staffPreview
    && experience
    && userProfile
    && userProfile.onboarding_tour_completed !== undefined
    && (experience !== 'academic_partner' || apCapabilityResolved)
  )
  // A first-login Welcome Tour already explains the portal controls. Keep the smaller cohort hint
  // out of that login entirely; it begins on later logins after the tour has been acknowledged.
  const welcomeTourWillAutoStart = portalTourDecisionReady
    && shouldAutoStartTour(userProfile, experience)
  // PROFILE-MENU-AVATARS-1: bumping headshotVersion re-keys the portal-self
  // photo cache after a Change Photo save, so the header re-signs the new image
  // without a reload. UL/AP saves instead refresh userProfile (avatar_url).
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false)
  const [headshotVersion, setHeadshotVersion] = useState(0)
  const { url: studentHeaderPhotoUrl } = usePortalHeadshotUrl({ enabled: isStudent && !staffPreview, refreshKey: headshotVersion })
  const { url: previewStudentHeaderPhotoUrl } = useStudentFileUrl({
    studentId: previewStudentId,
    kind: 'headshot',
    enabled: isStudent && staffPreview && Boolean(previewStudentId),
    refreshKey: previewStudentId,
    small: true,
  })
  const openChangePhoto = useCallback(() => setPhotoDialogOpen(true), [])
  const onPhotoSaved = useCallback(() => {
    if (isStudent) setHeadshotVersion(v => v + 1)
    else refreshUserProfile?.()
  }, [isStudent, refreshUserProfile])
  const onMessagesRoute = isFullMessagesPath(location.pathname)
  const unread = usePortalUnreadCount({
    enabled: !staffPreview && (isStudent || isUnitLeader || apMessagesEnabled || naMessagesEnabled || taMessagesEnabled),
    intervalMs: onMessagesRoute ? PORTAL_ACTIVE_POLL_MS : PORTAL_IDLE_UNREAD_POLL_MS,
  })

  const goHome = useCallback(() => navigate(staffPreview ? '/portal/student' : '/portal'), [navigate, staffPreview])
  const goPlacement = useCallback(() => navigate(staffPreview ? '/portal/student/placement' : '/portal/placement'), [navigate, staffPreview])
  const goShiftLog = useCallback(() => navigate(staffPreview ? '/portal/student/shift-log' : '/portal/shift-log'), [navigate, staffPreview])
  const goResidency = useCallback(() => navigate('/portal/residency'), [navigate])
  const goMessages = useCallback(() => navigate(
    previewRole === 'student' ? '/portal/student/messages'
      : staffPreview ? '/connect/messages' : '/portal/messages',
  ), [navigate, previewRole, staffPreview])
  const goProfile = useCallback(() => navigate('/portal/profile'), [navigate])
  const openThread = useCallback((id) => navigate(`/portal/messages/${id}`), [navigate])
  const backToList = useCallback(() => navigate('/portal/messages'), [navigate])

  useEffect(() => {
    let cancelled = false
    if (staffPreview) {
      ;(async () => {
        try {
          const { data: sessionData } = await supabase.auth.getSession()
          const token = sessionData?.session?.access_token
          if (!token) throw new Error('unauthenticated')
          // DEMO-MODE-1: the catalog must list the population being presented, not
          // whatever exists. Omitted entirely while the boundary is off.
          const demoParam = demoScopeParam()
          const demoQuery = demoParam === null ? '' : `&demo=${demoParam}`
          const response = await fetch(`/api/portal/admin-preview-access?role=${encodeURIComponent(previewRole)}${demoQuery}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!response.ok) throw new Error('preview_access_failed')
          const data = await response.json()
          if (cancelled) return
          const students = Array.isArray(data.students) ? data.students : []
          setPreviewStudents(students)
          setPreviewStudentId(current => students.some(student => student.id === current)
            ? current
            : (students[0]?.id || null))
          setAccess({
            roles: [previewRole],
            student_ids: students.map(student => student.id),
            unit_keys: Array.isArray(data.unit_keys) ? data.unit_keys : [],
            school_keys: Array.isArray(data.school_keys) ? data.school_keys : [],
          })
          setAccessFailed(false)
          setLoading(false)
        } catch {
          if (!cancelled) { setAccess({ roles: [] }); setAccessFailed(true); setLoading(false) }
        }
      })()
      return () => { cancelled = true }
    }
    // No reset here: retryAccessCheck clears accessFailed before bumping
    // accessAttempt, so this effect never starts from a stale failure.
    supabase.rpc('get_my_portal_access')
      .then(({ data, error }) => {
        if (cancelled) return
        // A failed or empty RPC is recorded AS a failure. It used to be flattened
        // into { roles: [] }, which rendered the same reassuring card as a person
        // who genuinely has no portal yet.
        if (error || !data) { setAccess({ roles: [] }); setAccessFailed(true) }
        else setAccess({
          roles: Array.isArray(data.roles) ? data.roles : [],
          student_ids: Array.isArray(data.student_ids) ? data.student_ids : [],
          unit_keys: Array.isArray(data.unit_keys) ? data.unit_keys : [],
          school_keys: Array.isArray(data.school_keys) ? data.school_keys : [],
        })
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setAccess({ roles: [] }); setAccessFailed(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [accessAttempt, previewRole, staffPreview])

  // AP-PORTAL: read the ONE canonical server capability (env flag AND applied DB migration) for
  // Academic Partner messaging, only for an Academic Partner. Fails closed on any error; the Messages
  // tab and the lower-right launcher both derive from this single value.
  useEffect(() => {
    // NA-PORTAL-UTILITIES-1: the same single capability fetch also serves the Nursing Education &
    // Leadership portal (na_messaging, na_feedback), so both roles read one canonical result.
    // TA-MESSAGES-1: every portal reads it now, for private_messaging (who may start a private
    // conversation with Talent Acquisition, and Talent Acquisition's own Messages).
    if (staffPreview || (!isAcademicPartner && !isNursingAcademic && !isTalentAcquisition && !isUnitLeader && !isStudent)) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const { data: s } = await supabase.auth.getSession()
        const token = s?.session?.access_token
        if (!token) { if (!cancelled) setApCapabilityResolved(true); return }
        const res = await fetch('/api/portal/portal-capabilities', { headers: { Authorization: `Bearer ${token}` } })
        if (cancelled) return
        if (!res.ok) { setApCapabilityResolved(true); return }
        const data = await res.json()
        if (!cancelled) {
          setApMessagingCapable(data?.ap_messaging === true)
          setNaMessagingCapable(data?.na_messaging === true)
          setNaFeedbackCapable(data?.na_feedback === true)
          setPrivateMessagingCapable(data?.private_messaging === true)
          // WELCOME-TOUR-PORTALS-1: the fetch settled, so the Academic Partner tour is now free to
          // decide whether its Messages step belongs in the sequence.
          setApCapabilityResolved(true)
        }
      } catch {
        /* fail closed: leave capability false, but the fetch still settled */
        if (!cancelled) setApCapabilityResolved(true)
      }
    })()
    return () => { cancelled = true }
  }, [isAcademicPartner, isNursingAcademic, staffPreview, isTalentAcquisition, isUnitLeader, isStudent])

  // WELCOME-TOUR-PORTALS-1: unmount-only cleanup for the auto-start timer below. Kept in its own
  // effect (empty deps) so a dependency change never cancels an already-armed timer; only real
  // unmount does.
  // Re-resolve on the way in, so the card is drawn from current truth rather than
  // from the stale snapshot this session started with: an account deactivated
  // mid-session should be read as deactivated. The card shows either way, because
  // a portal endpoint has already answered authoritatively for this caller.
  const handleAccessEnded = useCallback(() => {
    setAccessEnded(prev => {
      if (!prev) {
        setAccessAttempt(n => n + 1)
        try { refreshUserProfile?.() } catch { /* the card does not depend on it */ }
      }
      return true
    })
  }, [refreshUserProfile])

  const retryAccessCheck = useCallback(() => {
    setAccessFailed(false)
    setLoading(true)
    setAccessAttempt(n => n + 1)
  }, [])

  useEffect(() => () => { if (tourTimeoutRef.current) clearTimeout(tourTimeoutRef.current) }, [])

  // WELCOME-TOUR-PORTALS-1: auto-start once, after portal access AND role resolution. Student and
  // Unit Leader need only the profile's tour fields to have loaded; Academic Partner additionally
  // waits for the capability fetch to settle, so the Messages step is decided before the tour
  // starts. tourArmedRef guards this so re-renders (e.g. a userProfile object identity change from
  // AuthContext) never re-arm or re-schedule the timeout.
  useEffect(() => {
    if (tourArmedRef.current) return
    if (staffPreview) return
    if (!experience) return
    if (!userProfile || userProfile.onboarding_tour_completed === undefined) return
    if (experience === 'academic_partner' && !apCapabilityResolved) return
    if (!shouldAutoStartTour(userProfile, experience)) return
    tourArmedRef.current = true
    // The automatic Welcome Tour is the guidance for this first login. Mark the smaller cohort hint
    // as handled for this signed-in session so it does not appear as soon as the tour closes.
    if (experience === 'unit_leader' || experience === 'academic_partner') {
      markPortalCohortHintSeen(userProfile.id, experience)
    }
    tourTimeoutRef.current = setTimeout(() => setTourRunning(true), 700)
  }, [experience, userProfile, apCapabilityResolved, staffPreview])

  if (loading) {
    return (
      <div className="ptl-page ptl-center">
        <div className="ptl-skel-page" aria-hidden="true">
          <div className="ptl-skel ptl-skel-band" />
          <div className="ptl-skel ptl-skel-card" />
          <div className="ptl-skel ptl-skel-card" />
        </div>
          <p className="ptl-visually-hidden" role="status">Loading your ASPIRE portal</p>
      </div>
    )
  }

  // PORTAL-ACCESS-STATE: a deactivated account is answered HERE, ahead of every
  // portal branch, and this placement is the point of it. It shows the SAME
  // no-access card everyone else sees: a switched-off account and a finished
  // rotation are the same fact to the person reading it.
  //
  // Deactivation does not remove a portal role grant, and get_my_portal_access()
  // reports grants without consulting user_profiles.is_active, so a deactivated
  // person can still resolve to a full portal experience. They would then land in
  // StudentPortal, whose summary fetch treats the refusal as an empty result
  // (`summaryRes.ok ? ... : { students: [] }`), and be shown a complete, blank
  // portal with no explanation at all. Answering before the branch is what stops
  // that. The endpoints were already refusing this caller; only the screen was
  // lying about why.
  // Same answer, same placement, for the two ways we can learn it: the profile
  // says the account is off, or a portal endpoint refused this caller for an
  // access reason while they were already inside.
  if (deactivated || accessEnded) return <PortalAccessNotice state={ACCESS_STATES.NO_ACCESS} />

  const roles = access?.roles || []

  // WELCOME-TOUR-PORTALS-1: one tour instance, mounted inside whichever portal branch below is
  // active. It renders null while not running, so this is safe to include unconditionally per
  // branch. context.apMessagesEnabled lets the engine include or skip the capability-gated AP
  // messaging step for the experiences that need it.
  const tourOverlay = !staffPreview && experience ? (
    <CustomOnboardingTour
      run={tourRunning}
      onClose={() => setTourRunning(false)}
      experience={experience}
      context={{ apMessagesEnabled }}
    />
  ) : null

  // PORTAL-SWITCHER-1: the same Owner/Admin predicate that gates the Portals group in the
  // staff profile menu also gates it here, so the two menus offer the same destinations.
  // Main App widens from staffPreview to ownerAdmin for the same reason: a staff member who
  // is offered a way ACROSS the portals is offered the way OUT of them from the same menu.
  // A student, unit leader, academic partner or nursing academic sees none of this.
  const staffMenu = ownerAdmin ? {
    // NAV-POLISH-1: the identity row opens the person's Profile in the main app.
    portalSwitcher: { currentKey: previewRole || experience, profileUrl: STAFF_PROFILE_PATH },
    mainAppUrl: MAIN_APP_PATH,
    settingsUrl: STAFF_SETTINGS_PATH,
    roleLabel: userProfile?.is_owner ? 'Owner' : 'Admin',
  } : {
    portalSwitcher: null,
    mainAppUrl: undefined,
    settingsUrl: undefined,
    roleLabel: undefined,
  }

  const cohortLoginHint = (isUnitLeader || isAcademicPartner) ? (
    <PortalCohortLoginHint
      enabled={portalTourDecisionReady && !welcomeTourWillAutoStart && !tourRunning}
      userId={userProfile?.id}
      experience={experience}
    />
  ) : null

  // PROFILE-MENU-AVATARS-1: one dialog instance for whichever portal branch is
  // active. Students replace the canonical headshot (no remove); Unit Leaders
  // and Academic Partners manage user_profiles.avatar_url (remove offered).
  const photoDialog = photoDialogOpen ? (
    <ChangePhotoDialog
      mode={isStudent ? 'headshot' : 'profile'}
      hasPhoto={isStudent ? Boolean(studentHeaderPhotoUrl) : Boolean(userProfile?.avatar_url)}
      onClose={() => setPhotoDialogOpen(false)}
      onSaved={onPhotoSaved}
    />
  ) : null

  if (roles.includes('student')) {
    // Every fetching child can hand an access refusal up to the shell.
    return (
      <PortalAccessSignalContext.Provider value={handleAccessEnded}>
      <PortalShell title="Student Portal" userName={userProfile?.full_name}
        command={portalCommand}
        onEditProfile={goProfile} withTabBar
        headerVariant="nightfall" logoSrc="/cs-logo-large.png"
        homePath={staffPreview ? '/portal/student' : '/portal'} homeLabel="Home"
        profileImageUrl={studentHeaderPhotoUrl}
        previewProfileImageUrl={staffPreview ? previewStudentHeaderPhotoUrl : null}
        onChangePhoto={openChangePhoto} publicSiteUrl="https://aspireintelligence.app"
        onRestartTour={() => setTourRunning(true)}
        mainAppUrl={staffMenu.mainAppUrl} settingsUrl={staffMenu.settingsUrl}
        portalSwitcher={staffMenu.portalSwitcher}
        roleLabel={staffMenu.roleLabel}
        portalUserActionsEnabled={!staffPreview}
        nav={(
          <PortalNav
            view={studentView}
            unread={unread}
            onHome={goHome}
            onPlacement={goPlacement}
            onMessages={goMessages}
            onShiftLog={goShiftLog}
            messagesEnabled
            residency={residencyEligible}
            onResidency={goResidency}
          />
        )}
        utilityLayer={(
          staffPreview ? (
            <StaffPreviewUtilities portalName="Student Portal" section={studentView} />
          ) : <PortalUtilityLayer
            enabled
            portalRole="student"
            portalType="student"
            profileId={userProfile?.id}
            pathname={location.pathname}
            unread={unread}
            messagesAuthorized
            onOpenMessages={goMessages}
          />
        )}>
        <div style={{ display: ['home', 'placement'].includes(studentView) ? 'block' : 'none' }}>
          <Suspense fallback={<PortalLoading label="Loading your portal" />}>
            <StudentPortal
              active={['home', 'placement'].includes(studentView)}
              view={studentView}
              onOpenProfile={goProfile}
              onOpenShiftLog={goShiftLog}
              previewStudentId={previewStudentId}
              previewStudents={previewStudents}
              onPreviewStudentChange={setPreviewStudentId}
              readOnlyPreview={staffPreview}
              onCommandPeople={setCommandPeople}
            />
          </Suspense>
        </div>
        {!staffPreview && <div style={{ display: studentView === 'messages' ? 'block' : 'none' }}>
          <PortalMessagesWorkspace
            active={studentView === 'messages'}
            threadId={threadId}
            onSelectThread={openThread}
            onBackToList={backToList}
            privateKinds={residencyEligible && privateMessagingCapable ? ['talent_acquisition'] : []}
          />
        </div>}
        {staffPreview && studentView === 'messages' && (
          <EmptyState
            title="Messages"
            detail="Student messaging remains read-only in Owner/Admin preview because the preview does not impersonate the selected student. Use the Messages launcher to open the staff inbox."
          />
        )}
        {/* STUDENT-SHIFT-TAB-1: mounted only while visited; it looks the student up on
            activation and again on the shared Refresh. */}
        {studentView === 'shiftlog' && (
          <Suspense fallback={<div className="ptl-card ptl-activity-loading" role="status">Loading Shift Log</div>}>
            <StudentShiftLog active readOnlyPreview={staffPreview} />
          </Suspense>
        )}
        {/* RESIDENCY-TAB-1: mounted only while visited; the page and the server both refuse a
            student who is not an alumnus. */}
        {!staffPreview && studentView === 'residency' && (
          <Suspense fallback={<PortalLoading label="Loading your residency page" />}>
            <StudentResidency active />
          </Suspense>
        )}
        {/* STUDENT-PORTAL-PROFILE-1: mounted only while visited (it fetches on
            activation), unlike the always-mounted Home/Messages pair. */}
        {!staffPreview && studentView === 'profile' && (
          <Suspense fallback={<PortalLoading label="Loading your profile" />}><MyProfile active /></Suspense>
        )}
        {!staffPreview && photoDialog}
        {tourOverlay}
      </PortalShell>
      </PortalAccessSignalContext.Provider>
    )
  }

  if (roles.includes('unit_leader')) {
    // UL-PORTAL: sections are REAL routes under /portal/unit, so back, forward,
    // refresh, and a pasted deep link all behave like the rest of the app. The
    // Messages section reuses the same /portal/messages thread URL the Student
    // Portal already uses, so one thread link works for either kind.
    // Every fetching child can hand an access refusal up to the shell.
    return (
      <PortalAccessSignalContext.Provider value={handleAccessEnded}>
      <PortalShell title="Unit Leader Portal" userName={userProfile?.full_name} withTabBar showHeaderName command={portalCommand}
        headerVariant="nightfall" logoSrc="/cs-logo-large.png"
        homePath="/portal/unit/home" homeLabel="Home"
        profileImageUrl={userProfile?.avatar_url}
        onProfile={() => goUnitSection('profile')} onChangePhoto={openChangePhoto}
        publicSiteUrl="https://aspireintelligence.app"
        onRestartTour={() => setTourRunning(true)}
        mainAppUrl={staffMenu.mainAppUrl} settingsUrl={staffMenu.settingsUrl}
        portalSwitcher={staffMenu.portalSwitcher}
        roleLabel={staffMenu.roleLabel}
        portalUserActionsEnabled={!staffPreview}
        nav={<UnitLeaderNav view={unitView} unread={unread} onNavigate={goUnitSection} />}
        utilityLayer={(
          staffPreview ? (
            <StaffPreviewUtilities portalName="Unit Leader Portal" section={unitView} />
          ) : <PortalUtilityLayer
            enabled
            portalRole="unit_leader"
            portalType="unit_leader"
            profileId={userProfile?.id}
            pathname={location.pathname}
            unread={unread}
            messagesAuthorized
            onOpenMessages={goMessages}
          />
        )}>
        <Suspense fallback={<PortalLoading label="Loading your portal" />}>
          <UnitLeaderPortal
            privateKinds={privateMessagingCapable ? ['talent_acquisition'] : []}
            view={unitView}
            composeIntent={unitHandoff}
            onNavigate={goUnitSection}
            threadId={threadId}
            onSelectThread={openThread}
            onBackToList={backToList}
            messagesEnabled={!staffPreview}
            staffPreview={staffPreview}
            onCommandPeople={setCommandPeople}
          />
        </Suspense>
        {!staffPreview && photoDialog}
        {!staffPreview && cohortLoginHint}
        {tourOverlay}
      </PortalShell>
      </PortalAccessSignalContext.Provider>
    )
  }

  if (roles.includes('academic_partner')) {
    // The same shared shell, Nightfall chrome, and attached nav as the Student and Unit Leader
    // portals. Messages reuses the canonical workspace + lower-right launcher, gated on the SERVER
    // capability (apMessagesEnabled): until the server reports enabled it is fail-closed
    // (messagesAuthorized false => Feedback only, no floating Messages launcher, no unread polling).
    // Every fetching child can hand an access refusal up to the shell.
    return (
      <PortalAccessSignalContext.Provider value={handleAccessEnded}>
      <PortalShell title="Academic Partner Portal" userName={userProfile?.full_name} withTabBar showHeaderName command={portalCommand}
        headerVariant="nightfall" logoSrc="/cs-logo-large.png"
        homePath="/portal/ap/students" homeLabel="Home"
        profileImageUrl={userProfile?.avatar_url}
        onChangePhoto={openChangePhoto}
        publicSiteUrl="https://aspireintelligence.app"
        onRestartTour={() => setTourRunning(true)}
        mainAppUrl={staffMenu.mainAppUrl} settingsUrl={staffMenu.settingsUrl}
        portalSwitcher={staffMenu.portalSwitcher}
        roleLabel={staffMenu.roleLabel}
        portalUserActionsEnabled={!staffPreview}
        nav={<AcademicPartnerNav view={apView} onNavigate={goApSection} />}
        utilityLayer={(
          staffPreview ? (
            <StaffPreviewUtilities portalName="Academic Partner Portal" section={apView} />
          ) : <PortalUtilityLayer
            enabled
            portalRole="academic_partner"
            portalType="academic_partner"
            profileId={userProfile?.id}
            pathname={location.pathname}
            unread={unread}
            messagesAuthorized={apMessagesEnabled}
            onOpenMessages={() => goApSection('messages')}
            schools={access?.school_keys || []}
          />
        )}>
        <Suspense fallback={<PortalLoading label="Loading your portal" />}>
          <AcademicPartnerPortal view={apView} onNavigate={goApSection} schoolKeys={access?.school_keys || []}
            messagesEnabled={apMessagesEnabled}
            onCommandPeople={setCommandPeople}
            threadId={apThreadId} onSelectThread={openApThread} onBackToList={apBackToList} />
        </Suspense>
        {!staffPreview && photoDialog}
        {!staffPreview && cohortLoginHint}
        {tourOverlay}
      </PortalShell>
      </PortalAccessSignalContext.Provider>
    )
  }

  if (roles.includes('nursing_academic')) {
    // NA-PORTAL-UTILITIES-1: the last portal without Messages and Send Feedback gets both, exactly
    // like the others - the shared PortalMessagesWorkspace behind /portal/academics/messages, the
    // lower-right launcher pair, and the unread poll. Everything is gated on the SERVER capabilities
    // (fail-closed until the Owner SQL gate is applied: no launcher, no polling, no tab).
    // Every fetching child can hand an access refusal up to the shell.
    return (
      <PortalAccessSignalContext.Provider value={handleAccessEnded}>
      <PortalShell title="Nursing Education & Leadership Portal" userName={userProfile?.full_name} withTabBar showHeaderName command={portalCommand}
        headerVariant="nightfall" logoSrc="/cs-logo-large.png"
        homePath="/portal/academics/calendar" homeLabel="Home"
        profileImageUrl={userProfile?.avatar_url}
        onChangePhoto={openChangePhoto}
        publicSiteUrl="https://aspireintelligence.app"
        onRestartTour={() => setTourRunning(true)}
        mainAppUrl={staffMenu.mainAppUrl} settingsUrl={staffMenu.settingsUrl}
        portalSwitcher={staffMenu.portalSwitcher}
        roleLabel={staffMenu.roleLabel}
        portalUserActionsEnabled={!staffPreview}
        connectPage={naOnConnect}
        nav={naOnConnect ? null : <NursingAcademicsNav view={naView} onNavigate={goNaSection} budgetEnabled={naBudgetEnabled} themesEnabled={naThemesEnabled} />}
        utilityLayer={(
          staffPreview ? (
            <StaffPreviewUtilities portalName="Nursing Education & Leadership Portal" section={naView} />
          ) : <PortalUtilityLayer
            enabled
            portalRole="nursing_academic"
            portalType="nursing_academic"
            profileId={userProfile?.id}
            pathname={location.pathname}
            unread={unread}
            messagesAuthorized={naMessagesEnabled}
            feedbackAuthorized={naFeedbackEnabled}
            onOpenMessages={() => goNaSection('messages')}
          />
        )}>
        <Suspense fallback={<PortalLoading label="Loading your portal" />}>
          <NursingAcademicsPortal view={naView}
            messagesEnabled={naMessagesEnabled} budgetEnabled={naBudgetEnabled} themesEnabled={naThemesEnabled}
            onCommandPeople={setCommandPeople}
            unread={unread} onOpenConnect={goNaSection} backPath={naBackPath} backLabel={naBackLabel} onBack={path => navigate(path)}
            threadId={naThreadId} onSelectThread={openNaThread} onBackToList={naBackToList} />
        </Suspense>
        {!staffPreview && photoDialog}
        {tourOverlay}
      </PortalShell>
      </PortalAccessSignalContext.Provider>
    )
  }

  if (roles.includes('talent_acquisition')) {
    // RESIDENCY-PORTAL-1: the fifth portal, for Cedars-Sinai Talent Acquisition. It IS the
    // staff Residency experience (the same five tabs and components) mounted under
    // /portal/residency. Appended after nursing_academic so no existing user's portal
    // changes. Messages, Send Feedback, and a Welcome Tour are not enabled for it yet.
    return (
      <PortalAccessSignalContext.Provider value={handleAccessEnded}>
      <PortalShell title="Residency Portal" userName={userProfile?.full_name} withTabBar showHeaderName command={portalCommand}
        headerVariant="nightfall" logoSrc="/cs-logo-large.png"
        homePath="/portal/residency/overview" homeLabel="At a Glance"
        profileImageUrl={userProfile?.avatar_url}
        onChangePhoto={openChangePhoto}
        publicSiteUrl="https://aspireintelligence.app"
        mainAppUrl={staffMenu.mainAppUrl} settingsUrl={staffMenu.settingsUrl}
        portalSwitcher={staffMenu.portalSwitcher}
        roleLabel={staffMenu.roleLabel}
        portalUserActionsEnabled={!staffPreview}
        weeklyDigest={residencyDigest}
        mainWidth="app"
        connectPage={Boolean(residencyConnect)}
        nav={residencyConnect ? null : <ResidencyNav tab={residencyRoute.tab} onNavigate={goResidencyTab} />}
        utilityLayer={staffPreview ? <StaffPreviewUtilities portalName="Residency Portal" section={residencyConnect ? 'connect' : residencyRoute.tab} /> : (
          // TA-MESSAGES-1: the Messages launcher, once private messaging is on. No Send Feedback yet.
          <PortalUtilityLayer
            enabled={taMessagesEnabled}
            portalRole="talent_acquisition"
            portalType="talent_acquisition"
            profileId={userProfile?.id}
            pathname={location.pathname}
            unread={unread}
            messagesAuthorized={taMessagesEnabled}
            feedbackAuthorized={false}
            onOpenMessages={() => goResidencyConnect('messages')}
          />
        )}>
        {/* Joint ownership (Owner): Talent Acquisition manages residency records and cohort
            settings alongside the ASPIRE team. A staff preview shows what that staff member
            may manage. The server decides either way. */}
        <Suspense fallback={<PortalLoading label="Loading the residency workspace" />}>
          <ResidencyPortal canManage={staffPreview ? canManageNgrp(userProfile) : true} onCommandPeople={setCommandPeople}
            connectTab={residencyConnect} onOpenConnect={goResidencyConnect}
            messagesEnabled={taMessagesEnabled} unread={unread} threadId={residencyThreadId}
            onSelectThread={openResidencyThread} onBackToList={residencyBackToList}
            backPath={residencyBackPath} backLabel={residencyBackLabel} onBack={path => navigate(path)} />
        </Suspense>
        {!staffPreview && photoDialog}
      </PortalShell>
      </PortalAccessSignalContext.Provider>
    )
  }

  return (
    <PortalAccessNotice
      state={resolveAccessState({ checkFailed: accessFailed })}
      onRetry={retryAccessCheck}
    />
  )
}

// PORTAL-ACCESS-STATE: one card, wording chosen by state.
//
// NO ILLUSTRATION HERE, deliberately. This card carried the hero image of five
// students walking in smiling, which read as a welcome above a sentence telling
// someone they have no access. Showing the artwork whole (rather than cropped to
// a strip) only made the mismatch louder. The image stays where arriving is
// actually the subject: the sign-in page.
//
// What replaces it is composition rather than absence, so the card reads as
// designed and not as a picture that failed to load: its own narrower measure, a
// heavier title carrying the top of the card, and a ruled footer holding the
// controls.
function PortalAccessNotice({ state, onRetry }) {
  const { signOut } = useAuth()
  const copy = accessCopy(state)
  return (
    <div className="ptl-page ptl-center">
      <div className="ptl-card ptl-center-card ptl-access-card" data-access-state={state}>
        <h1 className="ptl-access-title">{copy.title}</h1>
        <p className="ptl-access-body">
          {copy.body}
          {copy.showSupport && (
            <>
              {' '}Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </>
          )}
        </p>
        <div className="ptl-access-actions">
          {copy.canRetry && onRetry && (
            <button className="ptl-btn-outline" onClick={onRetry}>Try again</button>
          )}
          <button className="ptl-btn-outline" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div>
  )
}

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

import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PortalShell from './PortalShell'
import PortalUtilityLayer from './PortalUtilityLayer'
import PortalNav from './PortalNav'
import StudentPortal from './StudentPortal'
import MyProfile from './MyProfile'
import UnitLeaderPortal from './UnitLeaderPortal'
import { UnitLeaderNav } from './unit/UnitLeaderChrome'
import { AcademicPartnerNav } from './ap/AcademicPartnerChrome'
import AcademicPartnerPortal from './AcademicPartnerPortal'
import PortalMessagesWorkspace from './messages/PortalMessagesWorkspace'
// PROFILE-MENU-AVATARS-1: self-service photo dialog shared by all three portals.
import ChangePhotoDialog from './ChangePhotoDialog'
import {
  PORTAL_ACTIVE_POLL_MS, PORTAL_IDLE_UNREAD_POLL_MS, usePortalUnreadCount,
} from '../lib/messages/portalMessagesPolling'
import { usePortalHeadshotUrl } from '../lib/useStudentFile'
// WELCOME-TOUR-PORTALS-1: the same Welcome Tour engine the staff app uses, mounted here
// for the three portal experiences (student, unit_leader, academic_partner).
import CustomOnboardingTour from '../components/CustomOnboardingTour'
import { shouldAutoStartTour } from '../lib/onboardingTours'
import '../styles/aspireBrand.css'
import './portal.css'

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

export default function PortalApp() {
  const { userProfile, refreshUserProfile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [access, setAccess]   = useState(null)   // { roles, student_ids, unit_keys, school_keys }
  const [loading, setLoading] = useState(true)
  // The stage-aware mobile action (Log a Shift during Active Rotation) is
  // reported upward by StudentPortal once its summary loads, so the single
  // bottom bar can carry it without a second data fetch here.
  const [mobileAction, setMobileAction] = useState(null)

  // STUDENT-PORTAL-PROFILE-1: /portal/profile is the My Profile destination.
  const studentView = location.pathname.startsWith('/portal/messages') ? 'messages'
    : location.pathname.startsWith('/portal/profile') ? 'profile'
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
    navigate(key === 'messages' ? '/portal/messages' : `/portal/unit/${key}`)
  }, [navigate])

  // Academic Partner sections are their own URL space (/portal/ap/<section>); /portal
  // resolves to Students. Messages and Placement Requests are stable routes now, showing
  // an honest prepared state until their backends land in later phases.
  const apView = apViewFromPath(location.pathname)
  const apThreadId = apThreadIdFromPath(location.pathname)
  const goApSection = useCallback((key) => {
    navigate(`/portal/ap/${key}`)
  }, [navigate])
  const openApThread = useCallback((id) => navigate(`/portal/ap/messages/${id}`), [navigate])
  const apBackToList = useCallback(() => navigate('/portal/ap/messages'), [navigate])

  const isStudent = (access?.roles || []).includes('student')
  // UL-POLISH P0: the idle unread poll runs for Unit Leaders too, so the
  // Messages badge is live from Home and every other section, exactly like the
  // Student Portal. Same endpoint, same cadence, faster while on Messages.
  const isUnitLeader = !isStudent && (access?.roles || []).includes('unit_leader')
  // AP-PORTAL: Academic Partner messaging enablement is a SERVER capability (env flag AND applied DB
  // migration), fetched below. The client never decides it from a constant. Fail-closed (false) until
  // the server reports it, so the unread poll and launcher stay off until then.
  const isAcademicPartner = !isStudent && !isUnitLeader && (access?.roles || []).includes('academic_partner')
  const [apMessagingCapable, setApMessagingCapable] = useState(false)
  // WELCOME-TOUR-PORTALS-1: whether the AP capability fetch below has settled (succeeded or
  // failed), so the Academic Partner tour waits to decide the Messages step before it starts.
  // Student and Unit Leader have no such fetch to wait on.
  const [apCapabilityResolved, setApCapabilityResolved] = useState(false)
  const apMessagesEnabled = isAcademicPartner && apMessagingCapable
  // WELCOME-TOUR-PORTALS-1: the Welcome Tour experience for the resolved portal role, derived
  // from the same role booleans the rest of this component already uses.
  const experience = isStudent ? 'student' : isUnitLeader ? 'unit_leader' : isAcademicPartner ? 'academic_partner' : null
  const [tourRunning, setTourRunning] = useState(false)
  const tourArmedRef = useRef(false)
  const tourTimeoutRef = useRef(null)
  // PROFILE-MENU-AVATARS-1: bumping headshotVersion re-keys the portal-self
  // photo cache after a Change Photo save, so the header re-signs the new image
  // without a reload. UL/AP saves instead refresh userProfile (avatar_url).
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false)
  const [headshotVersion, setHeadshotVersion] = useState(0)
  const { url: studentHeaderPhotoUrl } = usePortalHeadshotUrl({ enabled: isStudent, refreshKey: headshotVersion })
  const openChangePhoto = useCallback(() => setPhotoDialogOpen(true), [])
  const onPhotoSaved = useCallback(() => {
    if (isStudent) setHeadshotVersion(v => v + 1)
    else refreshUserProfile?.()
  }, [isStudent, refreshUserProfile])
  const onMessagesRoute = location.pathname.startsWith('/portal/messages') || location.pathname.startsWith('/portal/ap/messages')
  const unread = usePortalUnreadCount({
    enabled: isStudent || isUnitLeader || apMessagesEnabled,
    intervalMs: onMessagesRoute ? PORTAL_ACTIVE_POLL_MS : PORTAL_IDLE_UNREAD_POLL_MS,
  })

  const goHome = useCallback(() => navigate('/portal'), [navigate])
  const goMessages = useCallback(() => navigate('/portal/messages'), [navigate])
  const goProfile = useCallback(() => navigate('/portal/profile'), [navigate])
  const openThread = useCallback((id) => navigate(`/portal/messages/${id}`), [navigate])
  const backToList = useCallback(() => navigate('/portal/messages'), [navigate])

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_my_portal_access')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) setAccess({ roles: [] })
        else setAccess({
          roles: Array.isArray(data.roles) ? data.roles : [],
          student_ids: Array.isArray(data.student_ids) ? data.student_ids : [],
          unit_keys: Array.isArray(data.unit_keys) ? data.unit_keys : [],
          school_keys: Array.isArray(data.school_keys) ? data.school_keys : [],
        })
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setAccess({ roles: [] }); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // AP-PORTAL: read the ONE canonical server capability (env flag AND applied DB migration) for
  // Academic Partner messaging, only for an Academic Partner. Fails closed on any error; the Messages
  // tab and the lower-right launcher both derive from this single value.
  useEffect(() => {
    if (!isAcademicPartner) return undefined
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
  }, [isAcademicPartner])

  // WELCOME-TOUR-PORTALS-1: unmount-only cleanup for the auto-start timer below. Kept in its own
  // effect (empty deps) so a dependency change never cancels an already-armed timer; only real
  // unmount does.
  useEffect(() => () => { if (tourTimeoutRef.current) clearTimeout(tourTimeoutRef.current) }, [])

  // WELCOME-TOUR-PORTALS-1: auto-start once, after portal access AND role resolution. Student and
  // Unit Leader need only the profile's tour fields to have loaded; Academic Partner additionally
  // waits for the capability fetch to settle, so the Messages step is decided before the tour
  // starts. tourArmedRef guards this so re-renders (e.g. a userProfile object identity change from
  // AuthContext) never re-arm or re-schedule the timeout.
  useEffect(() => {
    if (tourArmedRef.current) return
    if (!experience) return
    if (!userProfile || userProfile.onboarding_tour_completed === undefined) return
    if (experience === 'academic_partner' && !apCapabilityResolved) return
    if (!shouldAutoStartTour(userProfile, experience)) return
    tourArmedRef.current = true
    tourTimeoutRef.current = setTimeout(() => setTourRunning(true), 700)
  }, [experience, userProfile, apCapabilityResolved])

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

  const roles = access?.roles || []

  // WELCOME-TOUR-PORTALS-1: one tour instance, mounted inside whichever portal branch below is
  // active. It renders null while not running, so this is safe to include unconditionally per
  // branch. context.apMessagesEnabled lets the engine include or skip the capability-gated AP
  // messaging step for the experiences that need it.
  const tourOverlay = experience ? (
    <CustomOnboardingTour
      run={tourRunning}
      onClose={() => setTourRunning(false)}
      experience={experience}
      context={{ apMessagesEnabled }}
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
    return (
      <PortalShell title="Student Portal" userName={userProfile?.full_name}
        onEditProfile={goProfile} withTabBar
        headerVariant="nightfall" logoSrc="/cs-logo-large.png"
        profileImageUrl={studentHeaderPhotoUrl}
        onChangePhoto={openChangePhoto} publicSiteUrl="https://aspireintelligence.app"
        onRestartTour={() => setTourRunning(true)}
        nav={(
          <PortalNav
            view={studentView}
            unread={unread}
            onHome={goHome}
            onMessages={goMessages}
            onProfile={goProfile}
            action={mobileAction}
          />
        )}
        utilityLayer={(
          <PortalUtilityLayer
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
        <div style={{ display: studentView === 'home' ? 'block' : 'none' }}>
          <StudentPortal
            active={studentView === 'home'}
            onOpenProfile={goProfile}
            onMobileAction={setMobileAction}
          />
        </div>
        <div style={{ display: studentView === 'messages' ? 'block' : 'none' }}>
          <PortalMessagesWorkspace
            active={studentView === 'messages'}
            threadId={threadId}
            onSelectThread={openThread}
            onBackToList={backToList}
          />
        </div>
        {/* STUDENT-PORTAL-PROFILE-1: mounted only while visited (it fetches on
            activation), unlike the always-mounted Home/Messages pair. */}
        {studentView === 'profile' && <MyProfile active />}
        {photoDialog}
        {tourOverlay}
      </PortalShell>
    )
  }

  if (roles.includes('unit_leader')) {
    // UL-PORTAL: sections are REAL routes under /portal/unit, so back, forward,
    // refresh, and a pasted deep link all behave like the rest of the app. The
    // Messages section reuses the same /portal/messages thread URL the Student
    // Portal already uses, so one thread link works for either kind.
    return (
      <PortalShell title="Unit Leader Portal" userName={userProfile?.full_name} withTabBar showHeaderName
        headerVariant="nightfall" logoSrc="/cs-logo-large.png"
        profileImageUrl={userProfile?.avatar_url}
        onProfile={() => goUnitSection('profile')} onChangePhoto={openChangePhoto}
        publicSiteUrl="https://aspireintelligence.app"
        onRestartTour={() => setTourRunning(true)}
        nav={<UnitLeaderNav view={unitView} unread={unread} onNavigate={goUnitSection} />}
        utilityLayer={(
          <PortalUtilityLayer
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
        <UnitLeaderPortal
          view={unitView}
          composeIntent={unitHandoff}
          onNavigate={goUnitSection}
          threadId={threadId}
          onSelectThread={openThread}
          onBackToList={backToList}
        />
        {photoDialog}
        {tourOverlay}
      </PortalShell>
    )
  }

  if (roles.includes('academic_partner')) {
    // The same shared shell, Nightfall chrome, and attached nav as the Student and Unit Leader
    // portals. Messages reuses the canonical workspace + lower-right launcher, gated on the SERVER
    // capability (apMessagesEnabled): until the server reports enabled it is fail-closed
    // (messagesAuthorized false => Feedback only, no floating Messages launcher, no unread polling).
    return (
      <PortalShell title="Academic Partner Portal" userName={userProfile?.full_name} withTabBar showHeaderName
        headerVariant="nightfall" logoSrc="/cs-logo-large.png"
        profileImageUrl={userProfile?.avatar_url}
        onChangePhoto={openChangePhoto}
        publicSiteUrl="https://aspireintelligence.app"
        onRestartTour={() => setTourRunning(true)}
        nav={<AcademicPartnerNav view={apView} onNavigate={goApSection} />}
        utilityLayer={(
          <PortalUtilityLayer
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
        <AcademicPartnerPortal view={apView} onNavigate={goApSection} schoolKeys={access?.school_keys || []}
          messagesEnabled={apMessagesEnabled}
          threadId={apThreadId} onSelectThread={openApThread} onBackToList={apBackToList} />
        {photoDialog}
        {tourOverlay}
      </PortalShell>
    )
  }

  return <BeingPrepared />
}

function BeingPrepared() {
  const { signOut } = useAuth()
  return (
    <div className="ptl-page ptl-center">
      <div className="ptl-card ptl-center-card ptl-prepared">
        <div className="ptl-prepared-art" aria-hidden="true">
          <img src="/public-site/illustrations/hero.png" alt="" loading="lazy" decoding="async" />
        </div>
        <h1 className="ptl-card-title">Your ASPIRE portal is being prepared</h1>
        <p className="ptl-muted">
          Your account is active, but your portal experience is not available yet.
          The ASPIRE team will let you know as soon as it opens.
        </p>
        <button className="ptl-btn-outline" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}

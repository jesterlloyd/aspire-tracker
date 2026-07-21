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

import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PortalShell from './PortalShell'
import PortalNav from './PortalNav'
import StudentPortal from './StudentPortal'
import UnitLeaderPortal from './UnitLeaderPortal'
import AcademicPartnerPortal from './AcademicPartnerPortal'
import PortalMessagesWorkspace from './messages/PortalMessagesWorkspace'
import {
  PORTAL_ACTIVE_POLL_MS, PORTAL_IDLE_UNREAD_POLL_MS, usePortalUnreadCount,
} from '../lib/messages/portalMessagesPolling'
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
  'preceptors', 'profile', 'notifications', 'concern',
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

export default function PortalApp() {
  const { userProfile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [access, setAccess]   = useState(null)   // { roles, student_ids, unit_keys, school_keys }
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false) // student self-service profile drawer
  // The stage-aware mobile action (Log a Shift during Active Rotation) is
  // reported upward by StudentPortal once its summary loads, so the single
  // bottom bar can carry it without a second data fetch here.
  const [mobileAction, setMobileAction] = useState(null)

  const studentView = location.pathname.startsWith('/portal/messages') ? 'messages' : 'home'
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

  const isStudent = (access?.roles || []).includes('student')
  // UL-POLISH P0: the idle unread poll runs for Unit Leaders too, so the
  // Messages badge is live from Home and every other section, exactly like the
  // Student Portal. Same endpoint, same cadence, faster while on Messages.
  const isUnitLeader = !isStudent && (access?.roles || []).includes('unit_leader')
  const onMessagesRoute = location.pathname.startsWith('/portal/messages')
  const unread = usePortalUnreadCount({
    enabled: isStudent || isUnitLeader,
    intervalMs: onMessagesRoute ? PORTAL_ACTIVE_POLL_MS : PORTAL_IDLE_UNREAD_POLL_MS,
  })

  const goHome = useCallback(() => navigate('/portal'), [navigate])
  const goMessages = useCallback(() => navigate('/portal/messages'), [navigate])
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

  if (roles.includes('student')) {
    return (
      <PortalShell title="Student Portal" userName={userProfile?.full_name}
        onEditProfile={() => setEditOpen(true)} withTabBar>
        <PortalNav
          view={studentView}
          unread={unread}
          onHome={goHome}
          onMessages={goMessages}
          action={mobileAction}
        />
        <div style={{ display: studentView === 'home' ? 'block' : 'none' }}>
          <StudentPortal
            editOpen={editOpen}
            onOpenEdit={() => setEditOpen(true)}
            onCloseEdit={() => setEditOpen(false)}
            unread={unread}
            onOpenMessages={goMessages}
            onOpenThread={openThread}
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
        onProfile={() => goUnitSection('profile')} publicSiteUrl="https://aspireintelligence.app">
        <UnitLeaderPortal
          view={unitView}
          composeIntent={unitHandoff}
          onNavigate={goUnitSection}
          unread={unread}
          threadId={threadId}
          onSelectThread={openThread}
          onBackToList={backToList}
        />
      </PortalShell>
    )
  }

  if (roles.includes('academic_partner')) {
    return (
      <PortalShell title="Academic Partner Portal" userName={userProfile?.full_name}>
        <AcademicPartnerPortal />
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

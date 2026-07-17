// PHASE2-PORTAL: role-aware portal entry (lazy chunk).
//
// Resolves the signed-in user's ACTIVE portal grants via the SECURITY DEFINER
// RPC get_my_portal_access() (Phase 2 migration) and renders the matching
// portal. Client-side routing only: every read this chunk performs is
// authorized server-side (scoped views, RPCs, or JWT-verified endpoints).
// If the RPC is missing (migration not applied yet) or returns no grants,
// the user sees the "being prepared" landing, never an error.

import { useState, useEffect } from 'react'
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
import './portal.css'

export default function PortalApp() {
  const { userProfile } = useAuth()
  const [access, setAccess]   = useState(null)   // { roles, student_ids, unit_keys, school_keys }
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false) // student self-service profile drawer
  // ASPIRE MESSAGES PHASE 5B-ii: which student section is showing. The portal has
  // no router and never had URL state, so the view is plain state. A refresh
  // returns to Home, which is the portal's existing behavior.
  const [studentView, setStudentView] = useState('home')

  // The unread badge count. Hooks cannot be called after the early returns
  // below, so this is resolved here and gated by `enabled` instead: a caller
  // without an active student grant never issues a Messages request, not even
  // for a count. `roles` comes from get_my_portal_access(), which returns only
  // grants passing the canonical active predicate, so this is the same
  // authorization boundary the server enforces.
  const isStudent = (access?.roles || []).includes('student')
  const unread = usePortalUnreadCount({
    enabled: isStudent,
    intervalMs: studentView === 'messages' ? PORTAL_ACTIVE_POLL_MS : PORTAL_IDLE_UNREAD_POLL_MS,
  })

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
        <div className="ptl-muted">Loading your ASPIRE portal...</div>
      </div>
    )
  }

  const roles = access?.roles || []

  if (roles.includes('student')) {
    return (
      <PortalShell title="Student Portal" userName={userProfile?.full_name} onEditProfile={() => setEditOpen(true)}>
        {/* The nav is the first child of the shell's main, so PortalShell stays
            untouched and this file is the only activation point. */}
        <PortalNav view={studentView} onSelect={setStudentView} unread={unread} />
        {/* Both sections stay MOUNTED and are hidden with display, matching the
            staff Connect convention. Unmounting would drop a reply draft, the
            selected conversation, the mobile list-or-thread view, and
            StudentPortal's own fetched data on every switch. The workspace's
            `active` prop is what stops a hidden view from polling or marking
            anything read. */}
        <div style={{ display: studentView === 'home' ? 'block' : 'none' }}>
          <StudentPortal editOpen={editOpen} onOpenEdit={() => setEditOpen(true)} onCloseEdit={() => setEditOpen(false)} />
        </div>
        <div style={{ display: studentView === 'messages' ? 'block' : 'none' }}>
          <PortalMessagesWorkspace active={studentView === 'messages'} />
        </div>
      </PortalShell>
    )
  }

  if (roles.includes('unit_leader')) {
    return (
      <PortalShell title="Unit Leader Portal" userName={userProfile?.full_name}>
        <UnitLeaderPortal />
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
      <div className="ptl-card ptl-center-card">
        <div className="ptl-card-title">Your ASPIRE portal is being prepared</div>
        <p className="ptl-muted">
          Your account is active, but your portal experience is not available yet.
          The ASPIRE team will let you know as soon as it opens.
        </p>
        <button className="ptl-btn-outline" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}

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
import StudentPortal from './StudentPortal'
import './portal.css'

export default function PortalApp() {
  const { userProfile } = useAuth()
  const [access, setAccess]   = useState(null)   // { roles, student_ids, unit_keys, school_keys }
  const [loading, setLoading] = useState(true)

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
      <PortalShell title="Student Portal" userName={userProfile?.full_name}>
        <StudentPortal />
      </PortalShell>
    )
  }

  if (roles.includes('unit_leader') || roles.includes('academic_partner')) {
    const label = roles.includes('unit_leader') ? 'Unit Leader Portal' : 'Academic Partner Portal'
    return (
      <PortalShell title={label} userName={userProfile?.full_name}>
        <div className="ptl-card ptl-center-card">
          <div className="ptl-card-title">Your {label.toLowerCase()} is almost ready</div>
          <p className="ptl-muted">
            Your access is active, and this portal opens in an upcoming release.
            The ASPIRE team will notify you when it is available.
          </p>
        </div>
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

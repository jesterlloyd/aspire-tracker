// STUDENT-PORTAL-PROFILE-1: the student's canonical place to review and maintain the
// information they submitted through /student-form.
//
// Three states, all rendering the SAME canonical students record via the SAME form
// component the public /student-form uses (no iframe, no parallel copy):
//   1. Complete Your Profile      - not yet submitted; the full intake form, bound to
//                                   the linked record's school email; submits through
//                                   the canonical public intake endpoint.
//   2. Profile Submitted, Editable - every answer prefilled; Save Changes updates the
//                                   same row through /api/portal/my-profile (allowlist,
//                                   lock, and stale-write all enforced server-side).
//   3. Profile Locked             - interview scheduled; everything stays visible,
//                                   read-only, with the approved lock notice and a
//                                   contact path. The profile is never hidden.

import { useCallback, useEffect, useState } from 'react'
import { Mail, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { composePortalEmail } from '../lib/outlookCompose'
import StudentIntakeFormPage from '../components/StudentIntakeFormPage'
import { useReportPortalFailure, ACCESS_FAILURE } from './portalAccessSignal'

const SUPPORT = 'aspire@cshs.org'

function fmtStamp(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function MyProfile({ active = true }) {
  // The signed-in email is display context for the compose helper only (it reminds the
  // student which account they are sending from); it grants nothing.
  const { userProfile } = useAuth()
  const loginEmail = userProfile?.email || ''
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const reportFailure = useReportPortalFailure()
  const [savedAt, setSavedAt] = useState(null)     // flash confirmation after a save
  const [staleNotice, setStaleNotice] = useState(false)

  // No synchronous setState here: the initial state is already loading, and callers
  // that need a fresh spinner (Retry) set it in their event handler before calling.
  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/portal/my-profile', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        // A revoked person IS signed in, so "please sign in again" was the wrong
        // instruction: signing in again would land them right back here. The
        // reason string separates the two, and an access refusal is handed to the
        // shell, which shows the no-access card instead of this view.
        let payload = null
        try { payload = await res.clone().json() } catch { payload = null }
        const kind = reportFailure({ status: res.status, error: payload?.error })
        if (kind === ACCESS_FAILURE.ACCESS_ENDED) { setState({ loading: false, error: 'access_ended', data: null }); return }
        setState({ loading: false, error: kind === ACCESS_FAILURE.SIGNED_OUT ? 'auth' : 'load', data: null })
        return
      }
      const json = await res.json()
      setState({ loading: false, error: null, data: json })
    } catch {
      setState({ loading: false, error: 'load', data: null })
    }
  }, [])

  // Fetch-on-activation; every setState inside load happens after an await (async
  // response handling), mirroring the portal's other endpoint-backed views.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (active) load() }, [active, load])

  const contactAspire = () => {
    composePortalEmail({
      to: SUPPORT,
      subject: 'ASPIRE Student Profile Correction Request',
      body: 'Hello ASPIRE Team,\n\nI would like to request a correction to my locked student profile.\n\nRequested correction:\n\n\nThank you.',
      loginEmail,
    })
  }

  if (state.loading) {
    return <div className="ptl-card" style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary,#6b7280)' }}>Loading your profile…</div>
  }
  if (state.error === 'auth') {
    return <div className="ptl-card" style={{ padding: 28 }}>Please sign in again to view your profile.</div>
  }
  // The shell is already replacing this view with the no-access card; render
  // nothing rather than flashing a second, contradictory message on the way out.
  if (state.error === 'access_ended') return null
  if (state.error || !state.data?.student) {
    return (
      <div className="ptl-card" style={{ padding: 28 }}>
        <p style={{ margin: '0 0 12px' }}>We could not load your profile. Please try again.</p>
        <button type="button" className="ptl-btn-outline ptl-btn-sm"
          onClick={() => { setState({ loading: true, error: null, data: null }); load() }}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    )
  }

  const { student, submitted, locked, available_units: units, documents } = state.data
  const stateLabel = !submitted ? 'Complete Your Profile'
    : locked ? 'Profile Locked · Interview Scheduled'
    : 'Profile Submitted · Editable'
  const mode = !submitted ? 'intake' : locked ? 'locked' : 'edit'
  const lastUpdated = fmtStamp(student.updated_at)

  return (
    <div>
      {/* State header: name of the destination + the exact state, so the student always
          knows whether what they see is editable. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 4px' }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-heading,#191919)' }}>My Profile</h2>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999,
          background: mode === 'locked' ? '#ede9fe' : mode === 'edit' ? '#dcfce7' : '#eff6ff',
          color:      mode === 'locked' ? '#5b21b6' : mode === 'edit' ? '#166534' : '#1d4ed8' }}>
          {stateLabel}
        </span>
      </div>
      {submitted && lastUpdated && (
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-secondary,#6b7280)' }}>
          Profile last updated {lastUpdated}
        </p>
      )}

      {savedAt && (
        <div role="status" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534',
          borderRadius: 10, padding: '10px 14px', fontSize: 13.5, margin: '0 0 14px' }}>
          Your changes were saved{fmtStamp(savedAt) ? ` at ${fmtStamp(savedAt)}` : ''}.
        </div>
      )}
      {staleNotice && (
        <div role="alert" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e',
          borderRadius: 10, padding: '10px 14px', fontSize: 13.5, margin: '0 0 14px',
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Your profile was updated elsewhere since this page loaded. Nothing was overwritten.</span>
          <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={() => { setStaleNotice(false); load() }}>
            Load the latest version
          </button>
        </div>
      )}

      {/* The canonical form. Keyed by mode + record freshness so a state transition
          (submit -> editable, save -> new updated_at) remounts with clean prefill. */}
      <StudentIntakeFormPage
        key={`${mode}-${student.updated_at || 'none'}`}
        portal={{
          mode,
          student,
          units: units || [],
          documents,
          onSubmitted: () => { setTimeout(load, 800) },
          onSaved: (updatedAt) => { setSavedAt(updatedAt || new Date().toISOString()); setStaleNotice(false); load() },
          onStale: () => setStaleNotice(true),
        }}
      />

      {mode === 'locked' && (
        <div className="ptl-card" style={{ padding: '14px 16px', marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5 }}>Need a correction while your profile is locked?</span>
          <button type="button" className="ptl-btn-outline ptl-btn-sm" onClick={contactAspire}
            aria-label="Contact ASPIRE (opens an email compose in a new tab)">
            <Mail size={14} /> Contact the ASPIRE team
          </button>
        </div>
      )}
    </div>
  )
}

// ASPIRE-PORTAL-ACCESS-UI: right-side account details drawer for the Accounts &
// Access directory. One drawer for both staff and portal accounts (no stacked
// modals). Focus moves in on open, is trapped while open, Escape closes when no
// destructive confirmation is pending, and focus returns to the opening row on
// close. Internal auth identifiers, revoker ids, and tokens are never rendered.
// The portal profile id is retained internally only to submit a revoke request.
import { useEffect, useRef, useState } from 'react'
import { X, Pencil, RefreshCw, Ban, Mail } from 'lucide-react'
import StatusBadge from '../ui/StatusBadge'
import { UserInitials, displayRole, formatLoginDate } from './accountsShared'
import { PORTAL_ROLE_LABELS, PORTAL_STATUS_STYLES } from '../../lib/portalAccessStatus'
import { supabase } from '../../lib/supabase'
import { useInterviewerEntitlements } from '../../lib/useInterviewerEntitlements'

const F = 'DM Sans, sans-serif'
const sectionTitle = { margin: '0 0 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6b7280' }
const row = { display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 8, fontSize: 13 }
const dt = { color: '#6b7280' }
const dd = { margin: 0, color: '#191919', wordBreak: 'break-word' }

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

// INTERVIEWER-ENTITLEMENTS-UI-1: one line naming the cohorts this interviewer
// can actually open files for. "None" is the answer that matters most - it is
// why headshots render as initials and why Keith declines - so it is stated
// plainly rather than left blank.
function CohortAccessSummary({ profileId }) {
  const { active, isLoading, isError } = useInterviewerEntitlements(profileId)
  if (isLoading) return <span style={{ color: '#9ca3af' }}>Loading…</span>
  if (isError) return <span style={{ color: '#9ca3af' }}>Unavailable</span>
  if (!active.length) return <span style={{ color: '#b45309', fontWeight: 600 }}>None</span>
  return <>{active.map(e => e.cohortName).join(', ')}</>
}

export default function AccountDetailsDrawer({ kind, record, returnFocusRef, onClose, onEditStaff, onRenewPortal, onRevoked }) {
  const panelRef = useRef(null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  // Focus in on open; trap Tab; return focus on unmount.
  useEffect(() => {
    const prevActive = returnFocusRef?.current || null
    const t = setTimeout(() => {
      const first = panelRef.current?.querySelector('[data-drawer-initial]') || panelRef.current
      first?.focus?.()
    }, 20)
    const onKey = (e) => {
      if (e.key === 'Escape') { if (!confirmRevoke && !busy) onClose?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusables = panelRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      if (!focusables.length) return
      const list = Array.from(focusables).filter(el => !el.disabled && el.offsetParent !== null)
      const firstEl = list[0], lastEl = list[list.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t); document.removeEventListener('keydown', onKey)
      if (prevActive?.focus) prevActive.focus()
    }
  }, [onClose, returnFocusRef, confirmRevoke, busy])

  if (!record) return null
  const isPortal = kind === 'portal'
  const title = record.full_name || record.email || 'Account'

  const doRevoke = async () => {
    setBusy(true); setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const body = { role: record.portal_role, user_profile_id: record.user_profile_id, cascade: true }
      if (record.portal_role === 'student') body.student_id = record.scope?.students?.[0]?.student_id
      if (record.portal_role === 'unit_leader') body.unit_keys = (record.scope?.units || []).map(u => u.unit_key)
      if (record.portal_role === 'academic_partner') body.school_keys = (record.scope?.schools || []).map(s => s.school_key)
      // nursing_academic owns no scope rows: the grant itself is the whole revocation.
      const res = await fetch('/api/revoke-portal-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setMsg({ ok: true, text: json?.revoked?.grant_action === 'already_revoked' ? 'Access was already revoked.' : 'Access revoked. History preserved.' })
        setConfirmRevoke(false)
        onRevoked?.()
      } else if (res.status === 401 || res.status === 403) {
        setMsg({ ok: false, text: 'Owner or Admin authorization is required.' })
      } else {
        setMsg({ ok: false, text: 'Could not revoke access. Please try again.' })
      }
    } catch {
      setMsg({ ok: false, text: 'Could not revoke access. Please try again.' })
    }
    setBusy(false)
  }

  return (
    <>
      <div onClick={() => !confirmRevoke && !busy && onClose?.()} style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.40)', zIndex: 1998 }} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={`Account details for ${title}`}
        style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 460, zIndex: 1999, background: '#fff', boxShadow: '-8px 0 24px rgba(16,24,40,0.12)', display: 'flex', flexDirection: 'column', fontFamily: F }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid #f3f4f6', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#191919', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Account details</h2>
          <button type="button" data-drawer-initial onClick={onClose} aria-label="Close details" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#6b7280', display: 'flex' }}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', minHeight: 0 }}>
          {/* Identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <UserInitials user={record} size={52} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#191919', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
              <div style={{ fontSize: 12.5, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis' }}>{record.email}</div>
              <div style={{ marginTop: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563', background: '#f3f4f6', borderRadius: 12, padding: '2px 8px' }}>
                  {isPortal ? 'Portal account' : 'Staff account'}
                </span>
              </div>
            </div>
          </div>

          {!isPortal && (
            <Section title="Staff access">
              <dl style={row}>
                <dt style={dt}>Staff role</dt><dd style={dd}>{displayRole(record)}</dd>
                <dt style={dt}>Interviewer</dt><dd style={dd}>{record.can_conduct_interviews ? 'Enabled' : 'Not enabled'}</dd>
                <dt style={dt}>Status</dt><dd style={dd}>{record.is_active === false ? 'Disabled' : 'Active'}</dd>
                <dt style={dt}>Last login</dt><dd style={dd}>{formatLoginDate(record.last_login_at)}</dd>
                {/* INTERVIEWER-ENTITLEMENTS-UI-1: read-only here on purpose. An
                    interviewer's cohort access decides resume, headshot, and
                    Keith skill availability, so it belongs in the at-a-glance
                    view; granting and revoking live in Edit staff access. */}
                {(record.role || '') === 'interviewer' && !record.is_owner && (
                  <>
                    <dt style={dt}>Cohort access</dt>
                    <dd style={dd}><CohortAccessSummary profileId={record.id} /></dd>
                  </>
                )}
              </dl>
            </Section>
          )}

          {isPortal && (
            <Section title="Portal access">
              <dl style={row}>
                <dt style={dt}>Portal role</dt><dd style={dd}>{PORTAL_ROLE_LABELS[record.portal_role] || record.portal_role}</dd>
                <dt style={dt}>Status</dt><dd style={dd}><StatusBadge value={record.status} colorMap={PORTAL_STATUS_STYLES} /></dd>
                {record.portal_role === 'student' && (
                  <>
                    <dt style={dt}>Linked student</dt>
                    <dd style={dd}>{(record.scope?.students?.[0]?.name) || 'None'}{record.scope?.students?.[0]?.school ? ` · ${record.scope.students[0].school}` : ''}{record.scope?.students?.[0]?.cohort ? ` · ${record.scope.students[0].cohort}` : ''}</dd>
                  </>
                )}
                {record.portal_role === 'unit_leader' && (
                  <><dt style={dt}>Assigned units</dt><dd style={dd}>{(record.scope?.units || []).map(u => u.unit_key).join(', ') || 'None'}</dd></>
                )}
                {record.portal_role === 'academic_partner' && (
                  <><dt style={dt}>Assigned schools</dt><dd style={dd}>{(record.scope?.schools || []).map(s => s.school_key).join(', ') || 'None'}</dd></>
                )}
                {record.portal_role === 'nursing_academic' && (
                  <><dt style={dt}>Access scope</dt><dd style={dd}>ASPIRE-wide (view only)</dd></>
                )}
                <dt style={dt}>Starts</dt><dd style={dd}>{record.starts_at ? new Date(record.starts_at).toLocaleDateString() : 'Now'}</dd>
                <dt style={dt}>Expires</dt><dd style={dd}>{record.expires_at ? new Date(record.expires_at).toLocaleDateString() : 'No expiration'}</dd>
              </dl>
            </Section>
          )}

          {msg && (
            <div role="status" style={{ margin: '4px 0 16px', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, background: msg.ok ? '#f0fdf4' : '#fff1f2', border: `1px solid ${msg.ok ? '#86efac' : '#fca5a5'}`, color: msg.ok ? '#166534' : '#991b1b' }}>{msg.text}</div>
          )}

          {isPortal && confirmRevoke && (
            <div style={{ background: '#fff7f7', border: '1px solid #fca5a5', borderRadius: 10, padding: 14, marginTop: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#991b1b', marginBottom: 6 }}>Revoke portal access?</div>
              <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 12.5, color: '#7f1d1d', lineHeight: 1.6 }}>
                <li>The sign-in identity will not be deleted.</li>
                <li>The user profile will not be deleted.</li>
                <li>Access history will remain preserved.</li>
                <li>Access to the selected role and scope will close.</li>
              </ul>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setConfirmRevoke(false)} disabled={busy} style={{ padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', fontFamily: F, fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
                <button type="button" onClick={doRevoke} disabled={busy} style={{ padding: '7px 14px', border: 'none', borderRadius: 8, background: '#b91c1c', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 12.5, cursor: busy ? 'default' : 'pointer' }}>{busy ? 'Revoking…' : 'Revoke access'}</button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #f3f4f6', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          {!isPortal && (
            <button type="button" onClick={() => onEditStaff?.(record)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', fontFamily: F, fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#1D2567' }}><Pencil size={14} /> Edit staff access</button>
          )}
          {isPortal && (
            <>
              <button type="button" onClick={() => onRenewPortal?.(record)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', fontFamily: F, fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#1D2567' }}><RefreshCw size={14} /> Renew / edit</button>
              {record.status !== 'revoked' && (
                <button type="button" onClick={() => setConfirmRevoke(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1px solid #fca5a5', borderRadius: 8, background: '#fff', fontFamily: F, fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#b91c1c' }}><Ban size={14} /> Revoke access</button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

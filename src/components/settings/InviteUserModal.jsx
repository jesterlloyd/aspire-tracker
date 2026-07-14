// ACCOUNTS-ACCESS-PROFILE-BOARD-2B: compact centered "Invite New User" popup. Replaces the old inline
// invite form. Fields: Name, Email, Role only (Can Interview + calendar color are set later in the
// Account Profile modal). Preserves the exact /api/invite-user flow/payload ({ email, full_name, role })
// and role gating; on success it calls onInvited() so the caller can refresh the account list.
import { useState, useRef, useEffect } from 'react'
import { X, Mail, Loader } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ROLE_OPTIONS } from './accountsShared'

const F = 'DM Sans, sans-serif'

// The parent mounts this only while open, so state is fresh per invocation (no reset effect needed).
export default function InviteUserModal({ onClose, onInvited }) {
  const [data, setData] = useState({ email: '', full_name: '', role: 'interviewer' })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const firstFieldRef = useRef(null)

  // Focus the first field on open; Esc closes.
  useEffect(() => {
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30)
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const canSend = !!data.email && !!data.full_name && !!data.role && !loading

  const submit = async () => {
    if (!canSend) return
    setLoading(true); setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (res.ok) {
        setResult({ success: true, message: `Invitation sent to ${data.email}` })
        onInvited?.()
        setTimeout(() => onClose?.(), 900)
      } else {
        setResult({ success: false, message: json.message || json.error || 'Invitation failed.' })
      }
    } catch (err) {
      setResult({ success: false, message: err.message })
    }
    setLoading(false)
  }

  const field = { width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: F, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
  const label = { display: 'block', fontFamily: F, fontWeight: 600, fontSize: 12, color: '#374151', marginBottom: 6 }

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Invite Staff User"
      style={{ position: 'fixed', inset: 0, zIndex: 2300, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F, padding: 16 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(420px, 100%)', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #f3f4f6' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1D2567' }}>Invite Staff User</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 4, display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '18px 20px' }}>
          <div style={{ marginBottom: 12 }}>
            <label style={label} htmlFor="invite-name">Name</label>
            <input id="invite-name" ref={firstFieldRef} value={data.full_name}
              onChange={e => setData(p => ({ ...p, full_name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder="Full name" style={field} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={label} htmlFor="invite-email">Email</label>
            <input id="invite-email" type="email" value={data.email}
              onChange={e => setData(p => ({ ...p, email: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder="name@example.com" style={field} />
          </div>
          <div>
            <label style={label} htmlFor="invite-role">Role</label>
            <select id="invite-role" value={data.role}
              onChange={e => setData(p => ({ ...p, role: e.target.value }))}
              style={{ ...field, cursor: 'pointer' }}>
              {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}, {r.description}</option>)}
            </select>
          </div>

          {result && (
            <div style={{ marginTop: 14, padding: '8px 12px', borderRadius: 8, fontSize: 12, background: result.success ? '#f0fdf4' : '#fff1f2', border: `1px solid ${result.success ? '#86efac' : '#fca5a5'}`, color: result.success ? '#166534' : '#991b1b' }}>
              {result.message}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid #f3f4f6' }}>
          <button type="button" onClick={onClose}
            style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontFamily: F, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={submit} disabled={!canSend}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', border: 'none', borderRadius: 8, background: canSend ? '#1D2567' : '#e5e7eb', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: canSend ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
            {loading ? <Loader size={13} /> : <Mail size={13} />} {loading ? 'Sending…' : 'Send Invitation'}
          </button>
        </div>
      </div>
    </div>
  )
}

// CONNECT-COMMS-1D: per-user ASPIRE Connect email signature settings.
//
// Applies ONLY to manual ASPIRE Connect direct messages. Saves via the self-scoped
// update_my_connect_signature RPC (updates only the caller's own user_profiles row) - never a
// raw client update. Email is read-only (from the authenticated profile, not user-editable).
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import SurfaceCard from '../ui/SurfaceCard'
import { connectSignatureImagePath, CONNECT_SIGNATURE_DEFAULT_AFFILIATION } from '../../lib/connectSignatureAssets'

const NAVY = '#1D2567'
const CS_RED = '#dc1e34'
const RAVEN = '#191919'
const labelStyle = { display: 'block', fontSize: 11.5, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13.5, fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#191919', background: '#fff', boxSizing: 'border-box' }

export default function SignaturePanel() {
  const { userProfile, refreshUserProfile } = useAuth()
  const existing = (userProfile?.connect_signature && typeof userProfile.connect_signature === 'object') ? userProfile.connect_signature : {}
  const email = userProfile?.email || ''

  const [form, setForm] = useState({
    display_name:      existing.display_name || userProfile?.full_name || '',
    credentials:       existing.credentials || '',
    title:             existing.title || '',
    department:        existing.department || '',
    phone:             existing.phone || '',
    signature_enabled: existing.signature_enabled !== false,
  })
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null) // null | { ok, msg }

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setStatus(null) }

  const handleSave = async () => {
    if (!form.display_name.trim()) { setStatus({ ok: false, msg: 'Display name is required.' }); return }
    setSaving(true); setStatus(null)
    try {
      const { error } = await supabase.rpc('update_my_connect_signature', {
        p_signature: {
          display_name:      form.display_name.trim(),
          credentials:       form.credentials.trim(),
          title:             form.title.trim(),
          department:        form.department.trim(),
          phone:             form.phone.trim(),
          signature_enabled: !!form.signature_enabled,
        },
      })
      if (error) { setStatus({ ok: false, msg: error.message || 'Could not save signature.' }); setSaving(false); return }
      await refreshUserProfile?.()
      setStatus({ ok: true, msg: 'Signature saved.' })
    } catch (e) {
      setStatus({ ok: false, msg: e.message || 'Could not save signature.' })
    }
    setSaving(false)
  }

  // SIGNATURE-PREVIEW-PARITY-1: exactly the renderer's fallback (an unset
  // Department renders the institute line every Connect email has carried).
  const affiliation = form.department.trim() || CONNECT_SIGNATURE_DEFAULT_AFFILIATION
  // Sender-scoped handwritten image, from the SAME map the renderer reads.
  const sigImagePath = connectSignatureImagePath(email)

  return (
    <section aria-label="Email Signature">
      {/* SETTINGS-VISUAL-DENSITY-1: heading comes from the General hub. The scope note is
          genuinely operational (manual Connect emails only), so it moved INSIDE the card
          rather than living as a page subtitle. Custom border card -> canonical SurfaceCard. */}
      <SurfaceCard padding={18}>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280', lineHeight: 1.5, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          This signature is used for your <strong>manual ASPIRE Connect</strong> emails only. Automated
          program emails (reminders, notifications) are unaffected.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={labelStyle}>Display Name *</label>
            <input style={inputStyle} value={form.display_name} onChange={e => set('display_name', e.target.value)} placeholder="e.g. Krystal Rodriguez" maxLength={120} />
          </div>
          <div>
            <label style={labelStyle}>Credentials</label>
            <input style={inputStyle} value={form.credentials} onChange={e => set('credentials', e.target.value)} placeholder="e.g. DNP, RN, NPD-BC" maxLength={120} />
          </div>
          <div>
            <label style={labelStyle}>Title</label>
            <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. ASPIRE Co-Lead" maxLength={120} />
          </div>
          <div>
            <label style={labelStyle}>Department</label>
            <input style={inputStyle} value={form.department} onChange={e => set('department', e.target.value)} placeholder={CONNECT_SIGNATURE_DEFAULT_AFFILIATION} maxLength={160} />
          </div>
          <div>
            <label style={labelStyle}>Email (read-only)</label>
            <input style={{ ...inputStyle, background: '#f9fafb', color: '#6b7280' }} value={email} readOnly disabled />
          </div>
          <div>
            <label style={labelStyle}>Phone</label>
            <input style={inputStyle} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="e.g. 310-248-8964" maxLength={40} />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, cursor: 'pointer', fontSize: 13, color: '#374151', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          <input type="checkbox" checked={form.signature_enabled} onChange={e => set('signature_enabled', e.target.checked)} style={{ width: 14, height: 14, accentColor: NAVY }} />
          Include my signature on manual ASPIRE Connect emails
        </label>

        {/* SIGNATURE-PREVIEW-PARITY-1: the preview mirrors the SENT block from
            lib/server/connect/emailTemplates.js signatureBlock - "Kind regards,",
            the sender-scoped handwritten image (same shared map), the CS-Red
            bold name + credentials, title, affiliation (Department, or the
            institute default), and the nightfall email | Office: phone line. */}
        <div style={{ marginTop: 16 }}>
          <div style={labelStyle}>Preview</div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 16px', background: '#fff', fontSize: 14, color: RAVEN, lineHeight: 1.6, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            {form.signature_enabled ? (
              <>
                <div style={{ marginBottom: 6 }}>Kind regards,</div>
                {sigImagePath && (
                  <img src={sigImagePath} alt={form.display_name || 'Signature'} width={160} height={60}
                    style={{ display: 'block', width: 160, maxWidth: 160, height: 'auto', border: 0, margin: '6px 0 0' }} />
                )}
                <div><strong style={{ color: CS_RED }}>{form.display_name || '-'}{form.credentials ? `, ${form.credentials}` : ''}</strong></div>
                {form.title && <div>{form.title}</div>}
                <div>{affiliation}</div>
                {email && (
                  <div style={{ marginTop: 2 }}><a href={`mailto:${email}`} style={{ color: NAVY, textDecoration: 'none' }}>{email}</a>{form.phone ? ` | Office: ${form.phone}` : ''}</div>
                )}
              </>
            ) : (
              <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Signature disabled, manual Connect emails will use a fallback signature.</span>
            )}
          </div>
        </div>

        {status && (
          <div style={{ marginTop: 14, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontFamily: 'Plus Jakarta Sans, sans-serif',
            background: status.ok ? '#EEF7F0' : '#fef2f2', border: `1px solid ${status.ok ? '#c6d9a8' : '#fecaca'}`, color: status.ok ? '#2F7D5C' : '#dc2626' }}>
            {status.msg}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: saving ? '#e5e7eb' : NAVY, color: saving ? '#9ca3af' : '#fff', fontSize: 13, fontWeight: 600, fontFamily: 'Plus Jakarta Sans, sans-serif', cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save Signature'}
          </button>
        </div>
      </SurfaceCard>
    </section>
  )
}

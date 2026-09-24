import { useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, ImagePlus, LockKeyhole, Monitor, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import SettingsPageHeader from './SettingsPageHeader'
import SurfaceCard from '../ui/SurfaceCard'
import './organizationSettings.css'

const TEXT_FIELDS = [
  ['display_name', 'Organization display name', true], ['header_short_name', 'Header short name', true],
  ['legal_name', 'Legal name', false], ['logo_alt_text', 'Logo description / alt text', false],
  ['address_line_1', 'Address line 1', true], ['address_line_2', 'Address line 2', false],
  ['city', 'City', true], ['state_province', 'State / province', true], ['postal_code', 'Postal code', true],
  ['country', 'Country', true], ['main_phone', 'Main telephone number', true], ['general_email', 'General email', true],
  ['website', 'Website', false],
]
const emptyForm = () => Object.fromEntries(TEXT_FIELDS.map(([field]) => [field, '']))
async function authToken() { const { data: { session } } = await supabase.auth.getSession(); return session?.access_token || null }
async function call(method, body) { const accessToken = await authToken(); const response = await fetch('/api/organization-settings', { method, headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let data = null; try { data = await response.json() } catch { /* empty */ } return { ok: response.ok, status: response.status, data } }
function fileAsPayload(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, data_base64: String(reader.result).split(',')[1] }); reader.onerror = reject; reader.readAsDataURL(file) }) }

function LogoCard({ title, description, dark, url, alt, onFile, onRemove }) {
  return <div className="org-logo-card"><div className={`org-logo-preview ${dark ? 'dark' : 'light'}`}>{url ? <img src={url} alt={alt || ''} /> : <div className="org-logo-fallback"><Building2 size={22} /><span>{dark ? 'Header logo' : 'Document logo'}</span></div>}</div><div className="org-logo-body"><strong>{title}</strong><p>{description}</p><div className="org-logo-actions"><label className="org-upload"><ImagePlus size={14} /> Upload<input type="file" accept="image/svg+xml,image/png,image/jpeg" onChange={onFile} /></label>{url && <button type="button" className="org-button" onClick={onRemove}><X size={14} /> Remove</button>}</div><small>SVG, PNG, or JPEG. Maximum 2 MB.</small></div></div>
}

export default function OrganizationPanel() {
  const [form, setForm] = useState(emptyForm)
  const [saved, setSaved] = useState(null)
  const [files, setFiles] = useState({ header: null, document: null })
  const [removed, setRemoved] = useState({ header: false, document: false })
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(null)
  useEffect(() => { let live = true; call('GET').then(result => { if (!live) return; if (result.ok) { setSaved(result.data.organization); setForm(Object.fromEntries(TEXT_FIELDS.map(([field]) => [field, result.data.organization[field] || '']))) } else setNotice({ ok: false, text: result.status === 403 ? 'Only the Owner can manage organization settings.' : 'Could not load organization settings.' }); setLoading(false) }); return () => { live = false } }, [])
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(Object.fromEntries(TEXT_FIELDS.map(([field]) => [field, saved?.[field] || '']))) || Object.values(files).some(Boolean) || Object.values(removed).some(Boolean), [form, saved, files, removed])
  const setField = (field, value) => setForm(previous => ({ ...previous, [field]: value }))
  const choose = kind => async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { setNotice({ ok: false, text: 'Logo must be smaller than 2 MB.' }); return } const payload = await fileAsPayload(file); setFiles(previous => ({ ...previous, [kind]: payload })); setRemoved(previous => ({ ...previous, [kind]: false })) }
  const save = async event => { event.preventDefault(); setBusy(true); setNotice(null); const result = await call('POST', { ...form, header_logo: files.header, document_logo: files.document, header_logo_remove: removed.header, document_logo_remove: removed.document }); setBusy(false); if (!result.ok) { setNotice({ ok: false, text: result.data?.fields ? Object.values(result.data.fields).join(' ') : (result.data?.message || 'Could not save organization settings.') }); return } setSaved(result.data.organization); setFiles({ header: null, document: null }); setRemoved({ header: false, document: false }); setNotice({ ok: true, text: 'Organization settings saved.' }) }
  const cancel = () => { setForm(Object.fromEntries(TEXT_FIELDS.map(([field]) => [field, saved?.[field] || '']))); setFiles({ header: null, document: null }); setRemoved({ header: false, document: false }); setNotice(null) }
  if (loading) return <p className="org-state">Loading organization settings…</p>
  return <section className="org-panel" aria-labelledby="organization-settings-title"><SettingsPageHeader id="organization-settings-title" title="Organization" subtitle="Manage the identity and contact information used across ASPIRE Intelligence." /><form onSubmit={save}>
    <div className="org-owner-note"><LockKeyhole size={17} /><span><strong>Owner access</strong><small>Only the Owner can edit organization settings. Saved changes apply to the application, communications, reports, and student pages.</small></span></div>
    <SurfaceCard className="org-card"><div className="org-card-heading"><h2>Identity &amp; Branding</h2><p>These values appear wherever your organization is represented.</p></div><div className="org-fields">{TEXT_FIELDS.slice(0, 4).map(([field, label, required]) => <label key={field} className={field === 'logo_alt_text' ? 'full' : ''}><span>{label}{required && <i>Required</i>}</span><input value={form[field]} required={required} onChange={event => setField(field, event.target.value)} /></label>)}</div><div className="org-logo-grid"><LogoCard title="Header logo" description="Optimized for the dark application header." dark url={removed.header ? null : (files.header ? `data:${files.header.type};base64,${files.header.data_base64}` : saved?.header_logo_url)} alt={form.logo_alt_text} onFile={choose('header')} onRemove={() => setRemoved(previous => ({ ...previous, header: true }))} /><LogoCard title="Document logo" description="Used in email, reports, PDFs, and student pages." url={removed.document ? null : (files.document ? `data:${files.document.type};base64,${files.document.data_base64}` : saved?.document_logo_url)} alt={form.logo_alt_text} onFile={choose('document')} onRemove={() => setRemoved(previous => ({ ...previous, document: true }))} /></div></SurfaceCard>
    <SurfaceCard className="org-card"><div className="org-card-heading"><h2>Contact Information</h2><p>The General email is shown as “Email us” in manual, scheduled, and automated communications.</p></div><div className="org-fields">{TEXT_FIELDS.slice(4).map(([field, label, required]) => <label key={field} className={field === 'address_line_1' || field === 'address_line_2' || field === 'website' ? 'full' : ''}><span>{label}{required && <i>Required</i>}</span><input type={field === 'general_email' ? 'email' : field === 'website' ? 'url' : 'text'} value={form[field]} required={required} onChange={event => setField(field, event.target.value)} /></label>)}</div></SurfaceCard>
    <SurfaceCard className="org-card"><div className="org-card-heading"><h2>Where This Information Appears</h2><p>These surfaces use the saved organization record.</p></div><div className="org-usage"><span><CheckCircle2 size={16} /> Application header</span><span><CheckCircle2 size={16} /> Email header, footer, and support contact</span><span><CheckCircle2 size={16} /> Reports and PDF exports</span><span><CheckCircle2 size={16} /> Student-facing pages</span></div><div className="org-preview"><div><Monitor size={14} /> {form.header_short_name || 'Organization'} <b>ASPIRE Intelligence</b></div><p>Email us at {form.general_email || 'your general email'}</p><small>{form.display_name || 'Organization'} · {form.city || 'City'}, {form.state_province || 'State'}</small></div></SurfaceCard>
    {notice && <p className={`org-notice ${notice.ok ? 'success' : 'error'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>}<div className="org-actions"><button type="button" className="org-button" disabled={!dirty || busy} onClick={cancel}>Cancel Changes</button><button type="submit" className="org-button primary" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save Changes'}</button></div>
  </form></section>
}

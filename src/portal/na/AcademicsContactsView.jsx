// Contact directory for Nursing Education & Leadership portal users. Most
// grants are view-only. The narrowly scoped Contacts Editor grant adds create,
// update, deactivate, and reactivate controls, but no permanent deletion.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Mail, Pencil, Phone, Plus, Power, PowerOff, Search, UserRound, X } from 'lucide-react'
import { LoadingState, EmptyState, ErrorState } from '../unit/UnitLeaderChrome'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { useReportPortalFailure, ACCESS_FAILURE } from '../portalAccessSignal'
import { isValidEmail } from '../../lib/notifications/studentRecipient'
import { normalizeEmailForLookup } from '../../lib/emailUtils'
import {
  CONTACT_CATEGORY_ORDER, categoryChipColors, contactRoleChipColors,
  getContactCategories, getPrimaryCategory,
} from '../../lib/contactCategories'
import { createAcademicsContact, fetchAcademicsContacts, updateAcademicsContact } from './nursingAcademicsApi'

const CONTACT_CATEGORIES = ['Academic Partners', 'Unit Leadership', 'Preceptors', 'BNI Team', 'Nursing Executives', 'Other']
const CONTACT_METHODS = [
  ['no_preference', 'No preference'], ['email', 'Email'], ['phone', 'Phone'],
  ['text', 'Text'], ['teams', 'Teams'],
]

const clean = value => String(value || '').trim()
const initials = name => clean(name).split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || '?'
const displayName = contact => clean(contact.preferred_name) || clean(contact.full_name) || 'Unnamed contact'
const displayListName = contact => {
  const full = clean(contact.full_name)
  const preferred = clean(contact.preferred_name)
  if (!preferred) return full || 'Unnamed contact'
  if (full.toLowerCase() === preferred.toLowerCase() || full.toLowerCase().startsWith(`${preferred.toLowerCase()} `)) return full
  return [preferred, full.split(/\s+/).slice(1).join(' ')].filter(Boolean).join(' ')
}
const affiliationLine = contact => clean(contact.unit_name) || clean(contact.school_name) || clean(contact.organization) || 'Contact information'
const primaryCategory = contact => getPrimaryCategory(contact) || 'Other'
const rolePillStyle = contact => {
  const colors = contactRoleChipColors(contact.role, primaryCategory(contact))
  return {
    '--ptl-na-role-color': colors.color,
    '--ptl-na-role-bg': colors.bg,
    '--ptl-na-role-border': colors.border,
  }
}
const categoryPillStyle = contact => {
  const colors = categoryChipColors(primaryCategory(contact))
  return {
    '--ptl-na-category-color': colors.color,
    '--ptl-na-category-bg': colors.bg,
    '--ptl-na-category-border': colors.border,
  }
}
const contactMatches = (contact, category, query) => {
  if (category !== 'All' && !getContactCategories(contact).includes(category)) return false
  if (!query) return true
  return [contact.full_name, contact.preferred_name, contact.email, contact.role,
    contact.category, contact.organization, contact.school_name, contact.unit_name]
    .some(value => clean(value).toLowerCase().includes(query))
}

function ContactAvatar({ contact, large = false }) {
  const src = clean(contact.avatar_url)
  const [failedUrl, setFailedUrl] = useState(null)
  const showPhoto = Boolean(src && failedUrl !== src)
  return (
    <span className={`ptl-na-contact-avatar${large ? ' ptl-na-contact-avatar-lg' : ''}`} aria-hidden="true">
      {showPhoto
        ? <img src={src} alt="" onError={() => setFailedUrl(src)} />
        : initials(contact.full_name)}
    </span>
  )
}

function ContactAction({ href, icon: Icon, label }) {
  if (!href) {
    return (
      <span className="ptl-na-contact-action ptl-na-contact-action-disabled" aria-disabled="true" title={`No ${label.toLowerCase()} on file`}>
        <Icon size={15} aria-hidden="true" /> {label}
      </span>
    )
  }
  return (
    <a className="ptl-na-contact-action" href={href}>
      <Icon size={15} aria-hidden="true" /> {label}
    </a>
  )
}

function ContactEditorModal({ contact, saving, error, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    full_name: clean(contact?.full_name),
    preferred_name: clean(contact?.preferred_name),
    email: clean(contact?.email),
    phone: clean(contact?.phone),
    role: clean(contact?.role),
    category: clean(contact?.category) || 'Other',
    organization: clean(contact?.organization),
    school_name: clean(contact?.school_name),
    unit_name: clean(contact?.unit_name),
    preferred_contact_method: clean(contact?.preferred_contact_method) || 'no_preference',
  }))
  const set = (field, value) => setForm(current => ({ ...current, [field]: value }))
  const valid = Boolean(form.full_name.trim() && (!form.email.trim() || isValidEmail(form.email)))
  const submit = event => {
    event.preventDefault()
    if (valid && !saving) onSave(form)
  }
  return (
    <div className="ptl-na-contact-modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && !saving && onClose()}>
      <form className="ptl-na-contact-modal" role="dialog" aria-modal="true" aria-labelledby="na-contact-editor-title" onSubmit={submit}>
        <div className="ptl-na-contact-modal-header">
          <div><h3 id="na-contact-editor-title">{contact ? 'Edit contact' : 'Add contact'}</h3><p>Contact directory fields only</p></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="ptl-na-contact-form-grid">
          <label className="ptl-na-contact-form-wide"><span>Full name *</span><input value={form.full_name} onChange={e => set('full_name', e.target.value)} required autoFocus /></label>
          <label><span>Preferred name</span><input value={form.preferred_name} onChange={e => set('preferred_name', e.target.value)} /></label>
          <label><span>Category</span><select value={form.category} onChange={e => set('category', e.target.value)}>{CONTACT_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label>
          <label><span>Role or title</span><input value={form.role} onChange={e => set('role', e.target.value)} /></label>
          <label><span>Organization</span><input value={form.organization} onChange={e => set('organization', e.target.value)} /></label>
          <label><span>Email</span><input type="email" value={form.email} onChange={e => set('email', e.target.value)} /></label>
          <label><span>Phone</span><input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} /></label>
          <label><span>School affiliation</span><input value={form.school_name} onChange={e => set('school_name', e.target.value)} /></label>
          <label><span>Unit affiliation</span><input value={form.unit_name} onChange={e => set('unit_name', e.target.value)} /></label>
          <label><span>Preferred contact method</span><select value={form.preferred_contact_method} onChange={e => set('preferred_contact_method', e.target.value)}>{CONTACT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        {error && <p className="ptl-na-contact-form-error" role="alert">{error}</p>}
        <div className="ptl-na-contact-modal-actions">
          <button type="button" className="ptl-na-contact-editor-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ptl-na-contact-editor-primary" disabled={!valid || saving}>{saving ? 'Saving…' : (contact ? 'Save changes' : 'Add contact')}</button>
        </div>
      </form>
    </div>
  )
}

export default function AcademicsContactsView({ active = true }) {
  const [contacts, setContacts] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [copyStatus, setCopyStatus] = useState('')
  const [canManageContacts, setCanManageContacts] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [editorContact, setEditorContact] = useState(undefined)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const [mutationStatus, setMutationStatus] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const reportFailure = useReportPortalFailure()

  const reload = useCallback(() => {
    if (!active) return
    setLoading(true)
    setError(null)
    setReloadKey(key => key + 1)
  }, [active])
  useRegisterPortalRefresh(reload, active)

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    const controller = new AbortController()
    fetchAcademicsContacts({ signal: controller.signal }).then(res => {
      if (cancelled || res.error === 'aborted') return
      if (!res.ok) {
        const kind = reportFailure({ status: res.status, error: res.error })
        if (kind === ACCESS_FAILURE.ACCESS_ENDED) { setLoading(false); return }
        setError(kind === ACCESS_FAILURE.SIGNED_OUT
          ? 'Your session expired. Please sign in again.'
          : 'We could not load Contacts right now. Please try again shortly.')
        setLoading(false)
        return
      }
      const next = Array.isArray(res.data?.contacts) ? res.data.contacts : []
      setContacts(next)
      setCanManageContacts(res.data?.can_manage_contacts === true)
      const firstActive = next.find(contact => contact.is_active !== false)
      setSelectedId(current => current && next.some(contact => contact.id === current) ? current : (firstActive?.id || next[0]?.id || null))
      setLoaded(true)
      setError(null)
      setLoading(false)
    })
    return () => { cancelled = true; controller.abort() }
  }, [active, reloadKey, reportFailure])

  const query = search.trim().toLowerCase()
  const directoryContacts = useMemo(() => contacts.filter(contact => showInactive || contact.is_active !== false), [contacts, showInactive])
  const categoryCounts = useMemo(() => {
    const counts = new Map()
    directoryContacts.forEach(contact => getContactCategories(contact).forEach(value => counts.set(value, (counts.get(value) || 0) + 1)))
    return counts
  }, [directoryContacts])
  const categories = useMemo(() => {
    const available = new Set(categoryCounts.keys())
    return [
      ...CONTACT_CATEGORY_ORDER.filter(value => available.has(value)),
      ...[...available].filter(value => !CONTACT_CATEGORY_ORDER.includes(value)).sort((a, b) => a.localeCompare(b)),
    ]
  }, [categoryCounts])
  const filtered = useMemo(() => directoryContacts
    .filter(contact => contactMatches(contact, category, query))
    .sort((a, b) => displayListName(a).localeCompare(displayListName(b), undefined, { sensitivity: 'base', numeric: true })), [directoryContacts, category, query])
  const visibleEmails = useMemo(() => {
    const seen = new Set()
    return filtered.reduce((emails, contact) => {
      if (!isValidEmail(contact.email)) return emails
      const normalized = normalizeEmailForLookup(contact.email)
      if (!normalized || seen.has(normalized)) return emails
      seen.add(normalized)
      emails.push(clean(contact.email))
      return emails
    }, [])
  }, [filtered])
  const selected = contacts.find(contact => contact.id === selectedId) || null
  const chooseCategory = value => {
    setCategory(value)
    setCopyStatus('')
    setSelectedId(directoryContacts.find(contact => contactMatches(contact, value, query))?.id || null)
  }
  const updateSearch = event => {
    const value = event.target.value
    const nextQuery = value.trim().toLowerCase()
    setSearch(value)
    setCopyStatus('')
    setSelectedId(directoryContacts.find(contact => contactMatches(contact, category, nextQuery))?.id || null)
  }
  const copyVisibleEmails = async () => {
    if (visibleEmails.length === 0 || !navigator.clipboard?.writeText) {
      setCopyStatus(visibleEmails.length === 0 ? 'No visible emails to copy' : 'Copy failed')
      window.setTimeout(() => setCopyStatus(''), 2500)
      return
    }
    try {
      await navigator.clipboard.writeText(visibleEmails.join(','))
      setCopyStatus(`Copied ${visibleEmails.length} email${visibleEmails.length === 1 ? '' : 's'}`)
      window.setTimeout(() => setCopyStatus(''), 2500)
    } catch {
      setCopyStatus('Copy failed')
      window.setTimeout(() => setCopyStatus(''), 2500)
    }
  }

  const applySavedContact = contact => {
    setContacts(current => {
      const exists = current.some(row => row.id === contact.id)
      return exists ? current.map(row => row.id === contact.id ? contact : row) : [...current, contact]
    })
    setSelectedId(contact.id)
  }
  const saveContact = async payload => {
    setSaving(true); setMutationError('')
    const res = editorContact
      ? await updateAcademicsContact(editorContact.id, payload)
      : await createAcademicsContact(payload)
    setSaving(false)
    if (!res.ok) {
      setMutationError(res.status === 409 ? 'A contact with these details already exists.' : 'The contact could not be saved. Please review the fields and try again.')
      return
    }
    applySavedContact(res.data.contact)
    setEditorContact(undefined)
    setMutationStatus(editorContact ? 'Contact updated' : 'Contact added')
    window.setTimeout(() => setMutationStatus(''), 2500)
  }
  const changeContactStatus = async contact => {
    const activate = contact.is_active === false
    if (!activate && !window.confirm(`Deactivate ${displayListName(contact)}? The contact will remain available to Contacts Editors and can be reactivated later.`)) return
    setSaving(true); setMutationError('')
    const res = await updateAcademicsContact(contact.id, { is_active: activate })
    setSaving(false)
    if (!res.ok) {
      setMutationStatus('Status change failed')
      window.setTimeout(() => setMutationStatus(''), 2500)
      return
    }
    applySavedContact(res.data.contact)
    if (!activate && !showInactive) {
      const next = contacts.find(row => row.id !== contact.id && row.is_active !== false)
      setSelectedId(next?.id || null)
    }
    setMutationStatus(activate ? 'Contact reactivated' : 'Contact deactivated')
    window.setTimeout(() => setMutationStatus(''), 2500)
  }

  if (loading && !loaded) return <LoadingState label="Loading Contacts" />
  if (error) return <ErrorState detail={error} onRetry={reload} />
  if (loaded && contacts.length === 0) return <EmptyState title="No active contacts" detail="Active ASPIRE contacts will appear here." />

  return (
    <section className="ptl-na-contacts" aria-labelledby="na-contacts-heading">
      <div className="ptl-na-section-heading">
        <div>
          <h2 id="na-contacts-heading">Contacts</h2>
          <p>{canManageContacts ? 'Manage the ASPIRE contact directory. Permanent removal is not available.' : 'Read-only access to the active ASPIRE contact directory.'}</p>
        </div>
        <div className="ptl-na-contact-heading-actions">
          {mutationStatus && <span className="ptl-na-contact-save-status" role="status">{mutationStatus}</span>}
          {canManageContacts && <button type="button" className="ptl-na-contact-editor-primary" onClick={() => { setMutationError(''); setEditorContact(null) }}><Plus size={15} /> Add contact</button>}
          <span className="ptl-na-result-count">{filtered.length} of {directoryContacts.length} contacts</span>
        </div>
      </div>

      <div className="ptl-na-contact-kpis" role="group" aria-label="Filter contacts by category">
        {['All', ...categories].map(value => {
          const selected = category === value
          const colors = value === 'All'
            ? { color: '#1D2567', bg: '#eef2fb', border: '#c3cdf0' }
            : categoryChipColors(value)
          return (
            <button
              key={value}
              type="button"
              className={`ptl-na-contact-kpi${selected ? ' ptl-na-contact-kpi-active' : ''}`}
              style={{
                '--ptl-na-contact-accent': colors.color,
                '--ptl-na-contact-bg': colors.bg,
                '--ptl-na-contact-border': colors.border,
              }}
              onClick={() => chooseCategory(value)}
              aria-pressed={selected}
            >
              <strong>{value === 'All' ? directoryContacts.length : categoryCounts.get(value) || 0}</strong>
              <span>{value === 'All' ? 'All Contacts' : value}</span>
            </button>
          )
        })}
      </div>

      <div className="ptl-na-contact-controls" role="group" aria-label="Search and copy contacts">
        <label className="ptl-na-contact-search" htmlFor="na-contact-search">
          <Search size={17} aria-hidden="true" />
          <span className="ptl-visually-hidden">Search contacts</span>
          <input id="na-contact-search" type="search" value={search} onChange={updateSearch} placeholder="Search contacts" />
        </label>
        {canManageContacts && <label className="ptl-na-show-inactive"><input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} /> Show inactive</label>}
        <button
          type="button"
          className="ptl-na-copy-emails"
          onClick={copyVisibleEmails}
          disabled={visibleEmails.length === 0}
          title="Copy the visible contacts' emails as a comma-separated list"
          aria-live="polite"
        >
          <Copy size={15} aria-hidden="true" /> {copyStatus || 'Copy visible emails'}
        </button>
      </div>

      <div className="ptl-card ptl-na-contact-directory">
        <div className="ptl-na-contact-list" role="list" aria-label="Contact results">
          {filtered.map(contact => (
            <button
              key={contact.id}
              type="button"
              role="listitem"
              className={`ptl-na-contact-row${selectedId === contact.id ? ' ptl-na-contact-row-active' : ''}${contact.is_active === false ? ' ptl-na-contact-row-inactive' : ''}`}
              onClick={() => setSelectedId(contact.id)}
              aria-pressed={selectedId === contact.id}
            >
              <ContactAvatar contact={contact} />
              <span className="ptl-na-contact-row-copy">
                <strong>{displayListName(contact)}</strong>
                {contact.is_active === false && <span className="ptl-na-contact-inactive-badge">Inactive</span>}
                <span className="ptl-na-contact-affiliation-line">{affiliationLine(contact)}</span>
                {contact.role && <span className="ptl-na-contact-row-role" style={rolePillStyle(contact)}>{contact.role}</span>}
              </span>
            </button>
          ))}
          {filtered.length === 0 && <p className="ptl-na-contact-empty">No contacts match these filters.</p>}
        </div>

        <aside className="ptl-na-contact-detail" aria-live="polite">
          {selected ? (
            <>
              <div className="ptl-na-contact-detail-hero">
                <ContactAvatar contact={selected} large />
                <div className="ptl-na-contact-detail-title">
                  <h3>{displayName(selected)}</h3>
                  {selected.preferred_name && selected.full_name !== selected.preferred_name && <p>{selected.full_name}</p>}
                  <div className="ptl-na-contact-badges">
                    <span className="ptl-na-contact-category" style={categoryPillStyle(selected)}>{primaryCategory(selected)}</span>
                    {selected.role && <span className="ptl-na-contact-role" style={rolePillStyle(selected)}>{selected.role}</span>}
                    {selected.is_active === false && <span className="ptl-na-contact-inactive-badge">Inactive</span>}
                  </div>
                </div>
                <div className="ptl-na-contact-actions" aria-label={`Contact ${displayListName(selected)}`}>
                  <ContactAction href={isValidEmail(selected.email) ? `mailto:${clean(selected.email)}` : null} icon={Mail} label="Email" />
                  <ContactAction href={clean(selected.phone) ? `tel:${clean(selected.phone)}` : null} icon={Phone} label="Call" />
                  {canManageContacts && <button type="button" className="ptl-na-contact-action ptl-na-contact-action-edit" onClick={() => { setMutationError(''); setEditorContact(selected) }}><Pencil size={15} /> Edit</button>}
                  {canManageContacts && <button type="button" className={`ptl-na-contact-action ${selected.is_active === false ? 'ptl-na-contact-action-activate' : 'ptl-na-contact-action-deactivate'}`} onClick={() => changeContactStatus(selected)} disabled={saving}>{selected.is_active === false ? <><Power size={15} /> Reactivate</> : <><PowerOff size={15} /> Deactivate</>}</button>}
                </div>
              </div>
              <div className="ptl-na-contact-detail-body">
                <div className="ptl-na-contact-sections">
                  <section className="ptl-na-contact-section" aria-labelledby="na-contact-methods-heading">
                    <h4 id="na-contact-methods-heading">Contact</h4>
                    <dl>
                      <div><dt>Email</dt><dd>{selected.email || 'Not provided'}</dd></div>
                      <div><dt>Phone</dt><dd>{selected.phone || 'Not provided'}</dd></div>
                      {selected.preferred_contact_method && <div><dt>Preferred method</dt><dd>{clean(selected.preferred_contact_method).replace(/_/g, ' ')}</dd></div>}
                    </dl>
                  </section>
                  {(selected.organization || selected.school_name || selected.unit_name) && (
                    <section className="ptl-na-contact-section" aria-labelledby="na-contact-affiliation-heading">
                      <h4 id="na-contact-affiliation-heading">Affiliation</h4>
                      <dl>
                        {selected.organization && <div><dt>Organization</dt><dd>{selected.organization}</dd></div>}
                        {selected.school_name && <div><dt>School</dt><dd>{selected.school_name}</dd></div>}
                        {selected.unit_name && <div><dt>Unit</dt><dd>{selected.unit_name}</dd></div>}
                      </dl>
                    </section>
                  )}
                </div>
                <p className="ptl-na-readonly-note"><UserRound size={15} aria-hidden="true" /> {canManageContacts ? 'Contacts Editor' : 'View only'}</p>
              </div>
            </>
          ) : <p className="ptl-na-contact-empty">Select a contact to view details.</p>}
        </aside>
      </div>
      {editorContact !== undefined && <ContactEditorModal contact={editorContact} saving={saving} error={mutationError} onClose={() => !saving && setEditorContact(undefined)} onSave={saveContact} />}
    </section>
  )
}

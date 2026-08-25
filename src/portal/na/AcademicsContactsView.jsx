// Read-only contact directory for Nursing Education & Leadership portal users.
// It exposes local email, call, and clipboard actions, but no mutation,
// outreach history, notes, export, or in-app messaging capability.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Mail, Phone, Search, UserRound } from 'lucide-react'
import { LoadingState, EmptyState, ErrorState } from '../unit/UnitLeaderChrome'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { useReportPortalFailure, ACCESS_FAILURE } from '../portalAccessSignal'
import { isValidEmail } from '../../lib/notifications/studentRecipient'
import { normalizeEmailForLookup } from '../../lib/emailUtils'
import {
  CONTACT_CATEGORY_ORDER, categoryChipColors, contactRoleChipColors,
  getContactCategories, getPrimaryCategory,
} from '../../lib/contactCategories'
import { fetchAcademicsContacts } from './nursingAcademicsApi'

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

export default function AcademicsContactsView({ active = true }) {
  const [contacts, setContacts] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [copyStatus, setCopyStatus] = useState('')
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
      setSelectedId(current => current && next.some(contact => contact.id === current) ? current : (next[0]?.id || null))
      setLoaded(true)
      setError(null)
      setLoading(false)
    })
    return () => { cancelled = true; controller.abort() }
  }, [active, reloadKey, reportFailure])

  const query = search.trim().toLowerCase()
  const categoryCounts = useMemo(() => {
    const counts = new Map()
    contacts.forEach(contact => getContactCategories(contact).forEach(value => counts.set(value, (counts.get(value) || 0) + 1)))
    return counts
  }, [contacts])
  const categories = useMemo(() => {
    const available = new Set(categoryCounts.keys())
    return [
      ...CONTACT_CATEGORY_ORDER.filter(value => available.has(value)),
      ...[...available].filter(value => !CONTACT_CATEGORY_ORDER.includes(value)).sort((a, b) => a.localeCompare(b)),
    ]
  }, [categoryCounts])
  const filtered = useMemo(() => contacts
    .filter(contact => contactMatches(contact, category, query))
    .sort((a, b) => displayListName(a).localeCompare(displayListName(b), undefined, { sensitivity: 'base', numeric: true })), [contacts, category, query])
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
    setSelectedId(contacts.find(contact => contactMatches(contact, value, query))?.id || null)
  }
  const updateSearch = event => {
    const value = event.target.value
    const nextQuery = value.trim().toLowerCase()
    setSearch(value)
    setCopyStatus('')
    setSelectedId(contacts.find(contact => contactMatches(contact, category, nextQuery))?.id || null)
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

  if (loading && !loaded) return <LoadingState label="Loading Contacts" />
  if (error) return <ErrorState detail={error} onRetry={reload} />
  if (loaded && contacts.length === 0) return <EmptyState title="No active contacts" detail="Active ASPIRE contacts will appear here." />

  return (
    <section className="ptl-na-contacts" aria-labelledby="na-contacts-heading">
      <div className="ptl-na-section-heading">
        <div>
          <h2 id="na-contacts-heading">Contacts</h2>
          <p>Read-only access to the active ASPIRE contact directory.</p>
        </div>
        <span className="ptl-na-result-count">{filtered.length} of {contacts.length} contacts</span>
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
              <strong>{value === 'All' ? contacts.length : categoryCounts.get(value) || 0}</strong>
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
              className={`ptl-na-contact-row${selectedId === contact.id ? ' ptl-na-contact-row-active' : ''}`}
              onClick={() => setSelectedId(contact.id)}
              aria-pressed={selectedId === contact.id}
            >
              <ContactAvatar contact={contact} />
              <span className="ptl-na-contact-row-copy">
                <strong>{displayListName(contact)}</strong>
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
                  </div>
                </div>
                <div className="ptl-na-contact-actions" aria-label={`Contact ${displayListName(selected)}`}>
                  <ContactAction href={isValidEmail(selected.email) ? `mailto:${clean(selected.email)}` : null} icon={Mail} label="Email" />
                  <ContactAction href={clean(selected.phone) ? `tel:${clean(selected.phone)}` : null} icon={Phone} label="Call" />
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
                <p className="ptl-na-readonly-note"><UserRound size={15} aria-hidden="true" /> View only</p>
              </div>
            </>
          ) : <p className="ptl-na-contact-empty">Select a contact to view details.</p>}
        </aside>
      </div>
    </section>
  )
}

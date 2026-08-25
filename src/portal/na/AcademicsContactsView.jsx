// Read-only contact directory for Nursing Education & Leadership portal users.
// It intentionally exposes no mutation, export, copy, or messaging actions.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, UserRound } from 'lucide-react'
import { LoadingState, EmptyState, ErrorState } from '../unit/UnitLeaderChrome'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { useReportPortalFailure, ACCESS_FAILURE } from '../portalAccessSignal'
import { fetchAcademicsContacts } from './nursingAcademicsApi'

const clean = value => String(value || '').trim()
const initials = name => clean(name).split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || '?'
const displayName = contact => clean(contact.preferred_name) || clean(contact.full_name) || 'Unnamed contact'

export default function AcademicsContactsView({ active = true }) {
  const [contacts, setContacts] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
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

  const categories = useMemo(() => [...new Set(contacts.map(contact => clean(contact.category)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b)), [contacts])
  const query = search.trim().toLowerCase()
  const filtered = useMemo(() => contacts.filter(contact => {
    if (category && clean(contact.category) !== category) return false
    if (!query) return true
    return [contact.full_name, contact.preferred_name, contact.email, contact.role,
      contact.category, contact.organization, contact.school_name, contact.unit_name]
      .some(value => clean(value).toLowerCase().includes(query))
  }), [contacts, category, query])
  const selected = contacts.find(contact => contact.id === selectedId) || null

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

      <div className="ptl-na-contact-controls" role="group" aria-label="Contact directory controls">
        <label className="ptl-na-contact-search" htmlFor="na-contact-search">
          <Search size={17} aria-hidden="true" />
          <span className="ptl-visually-hidden">Search contacts</span>
          <input id="na-contact-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search contacts" />
        </label>
        <label className="ptl-na-control" htmlFor="na-contact-category">
          <span className="ptl-visually-hidden">Filter by category</span>
          <select id="na-contact-category" value={category} onChange={event => setCategory(event.target.value)}>
            <option value="">All Categories</option>
            {categories.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
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
              <span className="ptl-na-contact-avatar" aria-hidden="true">{initials(contact.full_name)}</span>
              <span className="ptl-na-contact-row-copy">
                <strong>{displayName(contact)}</strong>
                <span>{[contact.role, contact.organization].filter(Boolean).join(' · ') || 'Contact information'}</span>
              </span>
            </button>
          ))}
          {filtered.length === 0 && <p className="ptl-na-contact-empty">No contacts match these filters.</p>}
        </div>

        <aside className="ptl-na-contact-detail" aria-live="polite">
          {selected ? (
            <>
              <div className="ptl-na-contact-detail-head">
                <span className="ptl-na-contact-avatar ptl-na-contact-avatar-lg" aria-hidden="true">{initials(selected.full_name)}</span>
                <div>
                  <h3>{displayName(selected)}</h3>
                  {selected.preferred_name && selected.full_name !== selected.preferred_name && <p>{selected.full_name}</p>}
                  <span className="ptl-na-contact-category">{selected.category || 'Contact'}</span>
                </div>
              </div>
              <dl className="ptl-na-contact-fields">
                <div><dt>Email</dt><dd>{selected.email || 'Not provided'}</dd></div>
                <div><dt>Phone</dt><dd>{selected.phone || 'Not provided'}</dd></div>
                <div><dt>Role</dt><dd>{selected.role || 'Not provided'}</dd></div>
                <div><dt>Organization</dt><dd>{selected.organization || 'Not provided'}</dd></div>
                <div><dt>School</dt><dd>{selected.school_name || 'Not provided'}</dd></div>
                <div><dt>Unit</dt><dd>{selected.unit_name || 'Not provided'}</dd></div>
                <div><dt>Preferred contact method</dt><dd>{clean(selected.preferred_contact_method).replace(/_/g, ' ') || 'Not provided'}</dd></div>
              </dl>
              <p className="ptl-na-readonly-note"><UserRound size={15} aria-hidden="true" /> View only</p>
            </>
          ) : <p className="ptl-na-contact-empty">Select a contact to view details.</p>}
        </aside>
      </div>
    </section>
  )
}

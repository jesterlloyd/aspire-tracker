// Contact directory for Nursing Education & Leadership portal users. Most
// grants are view-only. The narrowly scoped Contacts Editor grant adds create,
// update, deactivate, and reactivate controls, but no permanent deletion.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, Mail, Pencil, Phone, Plus, Power, PowerOff, Search, UserRound, X } from 'lucide-react'
import { LoadingState, EmptyState, ErrorState } from '../unit/UnitLeaderChrome'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { useReportPortalFailure, ACCESS_FAILURE } from '../portalAccessSignal'
import { isValidEmail } from '../../lib/notifications/studentRecipient'
import { normalizeEmailForLookup } from '../../lib/emailUtils'
import {
  CONTACT_CATEGORY_ORDER, categoryChipColors, contactRoleChipColors,
  getContactCategories, getPrimaryCategory,
  canonicalCategory, titleOptionsFor, titleAllowsFreeText,
  affiliationKind, showsUnitAffiliation, contactServicesMeta,
  contactUnitList, splitUnitList, CSMC_AFFILIATION,
  categoryPluralLabel, contactListSubline, sortContactsForCategory, sortContactsForSearch,
} from '../../lib/contactCategories'
import { UNIT_SCOPE_OPTIONS } from '../../lib/portalScopeCatalog'
import { SCHOOL_IDENTITY_GROUPS } from '../../lib/schoolIdentity'
import MultiScopePicker from '../../components/shared/MultiScopePicker'
import Tooltip from '../../components/ui/Tooltip'
import { createAcademicsContact, fetchAcademicsContacts, updateAcademicsContact } from './nursingAcademicsApi'

// CONTACTS-CANON-1: category, title, affiliation, and units come from the
// shared canonical vocabulary; Preferred Contact Method is retired.
const SCHOOL_AFFILIATION_OPTIONS = SCHOOL_IDENTITY_GROUPS.map(g => g.operative)
const CUSTOM_TITLE = '__custom__'

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
// CONTACTS-CANON-1 row shape: name, then the Role/Title pill, then the
// per-category subline (school / unit(s) / Programs / Services / affiliation).
const affiliationLine = contact => contactListSubline(contact)
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
    contact.category, contact.organization, contact.school_name, contact.unit_name,
    contact.services, ...(Array.isArray(contact.related_units) ? contact.related_units : [])]
    .some(value => clean(value).toLowerCase().includes(query))
}
// NA-CONTACTS-POLISH-1: the ONE ordering pipeline, in exactly the order the
// list renders. Every auto-selection (category click, search, initial load)
// takes its first element, so the selected profile is always the first row the
// reader sees - not the first match in fetch order, which drifted from the
// display after the canonical sort pass.
const orderContacts = (list, category, query) => {
  const matched = list.filter(contact => contactMatches(contact, category, query))
  if (category !== 'All') return sortContactsForCategory(matched, category)
  if (query) return sortContactsForSearch(matched, query)
  const grouped = {}
  matched.forEach(contact => {
    const cat = getPrimaryCategory(contact) || 'Other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(contact)
  })
  const ordered = []
  CONTACT_CATEGORY_ORDER.forEach(cat => {
    if (grouped[cat]) ordered.push(...sortContactsForCategory(grouped[cat], cat))
  })
  return ordered
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

// NA-CONTACTS-POLISH-4: per-value copy affordance, ported from the staff
// Connect profile's CopyButton (same shared Tooltip, same copied feedback).
function ContactCopyButton({ value, label }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }
  return (
    <Tooltip label={copied ? 'Copied!' : `Copy ${label}`} placement="top">
      <button
        type="button"
        className={`ptl-na-copy-value${copied ? ' ptl-na-copy-value-copied' : ''}`}
        onClick={copy}
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
    </Tooltip>
  )
}

function ContactEditorModal({ contact, saving, error, onClose, onSave }) {
  const [form, setForm] = useState(() => {
    const storedCat = canonicalCategory(contact?.category) || 'Other'
    const storedRole = clean(contact?.role)
    return {
      full_name: clean(contact?.full_name),
      preferred_name: clean(contact?.preferred_name),
      email: clean(contact?.email),
      phone: clean(contact?.phone),
      role: storedRole,
      role_custom: Boolean(storedRole)
        && !titleOptionsFor(storedCat).includes(storedRole)
        && titleAllowsFreeText(storedCat),
      category: storedCat,
      organization: clean(contact?.organization),
      school_name: clean(contact?.school_name),
      units: contactUnitList(contact || {}),
      services: clean(contact?.services),
      linkedin_url: clean(contact?.linkedin_url),
      affiliation_mode: clean(contact?.school_name)
        ? 'school'
        : (!clean(contact?.organization) || clean(contact?.organization) === CSMC_AFFILIATION ? 'csmc' : 'custom'),
    }
  })
  const set = (field, value) => setForm(current => ({ ...current, [field]: value }))

  const cat = form.category
  const titles = titleOptionsFor(cat)
  const roleListed = titles.includes(form.role)
  const showCustomTitle = titleAllowsFreeText(cat) && form.role_custom === true
  const affKind = affiliationKind(cat)
  // NE unit passthrough: the picker appears for an executive only when units
  // were stored at open (acting-AD exception), so a clear still saves.
  const hadUnitsAtOpen = Boolean(contact) && contactUnitList(contact).length > 0
  const showUnits = showsUnitAffiliation(cat)
    || (canonicalCategory(cat) === 'Nursing Executive' && hadUnitsAtOpen)
  const servicesMeta = contactServicesMeta(cat, form.role)
  const showServices = Boolean(servicesMeta)

  const changeCategory = value => setForm(current => ({
    ...current,
    category: value,
    role: current.role && (titleOptionsFor(value).includes(current.role) || current.role === clean(contact?.role)) ? current.role : '',
    role_custom: false,
  }))
  const changeTitle = value => {
    if (value === CUSTOM_TITLE) setForm(current => ({ ...current, role_custom: true, role: '' }))
    else setForm(current => ({ ...current, role_custom: false, role: value }))
  }

  const affiliationValid =
    affKind === 'school' ? Boolean(form.school_name.trim()) :
    affKind === 'choice' ? (
      form.affiliation_mode === 'school' ? Boolean(form.school_name.trim()) :
      form.affiliation_mode === 'custom' ? Boolean(form.organization.trim()) :
      true
    ) : true
  // Mirrors the server rule: http(s) scheme and a linkedin.com host.
  const linkedinTrimmed = form.linkedin_url.trim()
  const linkedinValid = !linkedinTrimmed
    || (/^https?:\/\//.test(linkedinTrimmed) && linkedinTrimmed.includes('linkedin.com'))
  const valid = Boolean(form.full_name.trim() && affiliationValid && linkedinValid && (!form.email.trim() || isValidEmail(form.email)))

  const submit = event => {
    event.preventDefault()
    if (!valid || saving) return
    const affiliation =
      affKind === 'school' ? { school_name: form.school_name } :
      affKind === 'csmc' ? {} :
      form.affiliation_mode === 'school' ? { school_name: form.school_name, organization: '' } :
      form.affiliation_mode === 'custom' ? { school_name: '', organization: form.organization } :
      { school_name: '', organization: CSMC_AFFILIATION }
    const unitCols = showUnits ? splitUnitList(form.units) : {}
    onSave({
      full_name: form.full_name,
      preferred_name: form.preferred_name,
      email: form.email,
      phone: form.phone,
      role: form.role,
      category: form.category,
      linkedin_url: linkedinTrimmed,
      ...affiliation,
      ...(showUnits ? { unit_name: unitCols.unit_name || '', related_units: unitCols.related_units } : {}),
      ...(showServices || clean(contact?.services)
        ? { services: showServices ? form.services : '' }
        : {}),
    })
  }
  const schoolSelect = (id) => (
    <select id={id} value={form.school_name} onChange={e => set('school_name', e.target.value)} aria-label="School">
      <option value="">Select school…</option>
      {SCHOOL_AFFILIATION_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
      {form.school_name && !SCHOOL_AFFILIATION_OPTIONS.includes(form.school_name) && (
        <option value={form.school_name}>{form.school_name} (legacy)</option>
      )}
    </select>
  )
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
          <label>
            <span>Category</span>
            <select value={form.category} onChange={e => changeCategory(e.target.value)}>
              {CONTACT_CATEGORY_ORDER.map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Role or title</span>
            <select value={showCustomTitle ? CUSTOM_TITLE : form.role} onChange={e => changeTitle(e.target.value)}>
              <option value="">Select…</option>
              {titles.map(t => <option key={t} value={t}>{t}</option>)}
              {form.role && !roleListed && !showCustomTitle && <option value={form.role}>{form.role} (legacy)</option>}
              {titleAllowsFreeText(cat) && <option value={CUSTOM_TITLE}>Other (free text)</option>}
            </select>
          </label>
          {showCustomTitle && (
            <label className="ptl-na-contact-form-wide"><span>Custom role or title</span><input value={form.role} onChange={e => set('role', e.target.value)} /></label>
          )}
          {affKind === 'school' && (
            <label><span>Affiliation (school) *</span>{schoolSelect('na-contact-school')}</label>
          )}
          {affKind === 'csmc' && (
            <label><span>Affiliation</span><input value={CSMC_AFFILIATION} readOnly aria-readonly="true" /></label>
          )}
          {affKind === 'choice' && (
            <label>
              <span>Affiliation *</span>
              <select value={form.affiliation_mode} onChange={e => set('affiliation_mode', e.target.value)}>
                <option value="csmc">{CSMC_AFFILIATION}</option>
                <option value="school">School</option>
                <option value="custom">Other organization</option>
              </select>
            </label>
          )}
          {affKind === 'choice' && form.affiliation_mode === 'school' && (
            <label><span>School</span>{schoolSelect('na-contact-school-choice')}</label>
          )}
          {affKind === 'choice' && form.affiliation_mode === 'custom' && (
            <label><span>Organization</span><input value={form.organization} onChange={e => set('organization', e.target.value)} /></label>
          )}
          <label><span>Email</span><input type="email" value={form.email} onChange={e => set('email', e.target.value)} /></label>
          <label><span>Phone</span><input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} /></label>
          <label className="ptl-na-contact-form-wide"><span>LinkedIn URL</span><input type="url" value={form.linkedin_url} onChange={e => set('linkedin_url', e.target.value)} placeholder="https://www.linkedin.com/in/…" /></label>
          {showUnits && (
            <div className="ptl-na-contact-form-wide ptl-na-contact-units">
              <span>Unit affiliation (one or more units)</span>
              <MultiScopePicker
                id="na-contact-units"
                options={UNIT_SCOPE_OPTIONS}
                selected={form.units}
                onChange={next => set('units', next)}
                placeholder="Search units"
              />
            </div>
          )}
          {showServices && (
            <label className="ptl-na-contact-form-wide"><span>{servicesMeta.label}</span><input value={form.services} onChange={e => set('services', e.target.value)} placeholder={servicesMeta.label === 'Programs' ? 'e.g. ASPIRE, NGRP, Preceptor Program' : 'e.g. BNI, Surgical Services, OLAR'} /></label>
          )}
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
      // First selection follows display order (the first row of the grouped
      // All view), not fetch order.
      const firstDisplayed = orderContacts(next.filter(contact => contact.is_active !== false), 'All', '')[0]
      setSelectedId(current => current && next.some(contact => contact.id === current) ? current : (firstDisplayed?.id || next[0]?.id || null))
      setLoaded(true)
      setError(null)
      setLoading(false)
    })
    return () => { cancelled = true; controller.abort() }
  }, [active, reloadKey, reportFailure])

  const query = search.trim().toLowerCase()
  // NA-CONTACTS-POLISH-3: the directory lists active contacts only; a
  // deactivated contact is reactivated from staff ASPIRE Connect.
  const directoryContacts = useMemo(() => contacts.filter(contact => contact.is_active !== false), [contacts])
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
  // CONTACTS-CANON-1 ordering: the approved per-category sort from the ONE
  // shared comparator; the flat All view while searching is unit-aware (a
  // query naming a unit surfaces its leadership chain, acting executive on
  // top), otherwise displayed-name order.
  const filtered = useMemo(() => orderContacts(directoryContacts, category, query), [directoryContacts, category, query])
  // All Contacts with no query groups by primary category with dividers,
  // exactly like the staff ASPIRE Connect list. `filtered` is ALREADY in
  // grouped display order (orderContacts), so the dividers are derived from
  // it directly - render order and auto-selection order are one list by
  // construction.
  const listItems = useMemo(() => {
    if (category !== 'All' || query) return filtered.map(contact => ({ type: 'row', contact }))
    const counts = {}
    filtered.forEach(contact => {
      const cat = getPrimaryCategory(contact) || 'Other'
      counts[cat] = (counts[cat] || 0) + 1
    })
    const items = []
    let currentCat = null
    filtered.forEach(contact => {
      const cat = getPrimaryCategory(contact) || 'Other'
      if (cat !== currentCat) {
        currentCat = cat
        items.push({ type: 'divider', key: `divider-${cat}`, label: categoryPluralLabel(cat), count: counts[cat] })
      }
      items.push({ type: 'row', contact })
    })
    return items
  }, [filtered, category, query])
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
    setSelectedId(orderContacts(directoryContacts, value, query)[0]?.id || null)
  }
  const updateSearch = event => {
    const value = event.target.value
    const nextQuery = value.trim().toLowerCase()
    setSearch(value)
    setCopyStatus('')
    setSelectedId(orderContacts(directoryContacts, category, nextQuery)[0]?.id || null)
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
    if (!activate && !window.confirm(`Deactivate ${displayListName(contact)}? The contact will be hidden here and can be reactivated from ASPIRE Connect.`)) return
    setSaving(true); setMutationError('')
    const res = await updateAcademicsContact(contact.id, { is_active: activate })
    setSaving(false)
    if (!res.ok) {
      setMutationStatus('Status change failed')
      window.setTimeout(() => setMutationStatus(''), 2500)
      return
    }
    applySavedContact(res.data.contact)
    if (!activate) {
      const remaining = contacts.filter(row => row.id !== contact.id && row.is_active !== false)
      setSelectedId(orderContacts(remaining, category, query)[0]?.id || null)
    }
    setMutationStatus(activate ? 'Contact reactivated' : 'Contact deactivated')
    window.setTimeout(() => setMutationStatus(''), 2500)
  }

  if (loading && !loaded) return <LoadingState label="Loading Contacts" />
  if (error) return <ErrorState detail={error} onRetry={reload} />
  if (loaded && contacts.length === 0) return <EmptyState title="No active contacts" detail="Active ASPIRE contacts will appear here." />

  return (
    // NA-CONTACTS-POLISH-3: no heading block - the tab already says Contacts,
    // and Add contact lives in the controls row next to the search.
    <section className="ptl-na-contacts" aria-label="Contacts">
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
              <span>{value === 'All' ? 'All Contacts' : categoryPluralLabel(value)}</span>
            </button>
          )
        })}
      </div>

      <div className="ptl-na-contact-controls" role="group" aria-label="Search and manage contacts">
        <label className="ptl-na-contact-search" htmlFor="na-contact-search">
          <Search size={17} aria-hidden="true" />
          <span className="ptl-visually-hidden">Search contacts</span>
          <input id="na-contact-search" type="search" value={search} onChange={updateSearch} placeholder="Search contacts" />
        </label>
        {canManageContacts && <button type="button" className="ptl-na-contact-editor-primary" onClick={() => { setMutationError(''); setEditorContact(null) }}><Plus size={15} /> Add contact</button>}
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
        {mutationStatus && <span className="ptl-na-contact-save-status" role="status">{mutationStatus}</span>}
      </div>

      <div className="ptl-na-contact-directory">
        <div className="ptl-na-contact-list" role="list" aria-label="Contact results">
          {listItems.map(item => {
            if (item.type === 'divider') {
              return (
                <div key={item.key} className="ptl-na-contact-divider" role="presentation">
                  <span>{item.label}</span>
                  <span className="ptl-na-contact-divider-count">{item.count}</span>
                </div>
              )
            }
            const contact = item.contact
            return (
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
                  {contact.role && <span className="ptl-na-contact-row-role" style={rolePillStyle(contact)}>{contact.role}</span>}
                  {affiliationLine(contact) && <span className="ptl-na-contact-affiliation-line">{affiliationLine(contact)}</span>}
                </span>
              </button>
            )
          })}
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
                  {clean(selected.linkedin_url) && (
                    <a className="ptl-na-contact-linkedin" href={clean(selected.linkedin_url)} target="_blank" rel="noreferrer" aria-label="LinkedIn profile">
                      <img src="/linkedin-logo.svg" alt="LinkedIn" height={17} />
                    </a>
                  )}
                </div>
              </div>
              <div className="ptl-na-contact-detail-body">
                <div className="ptl-na-contact-sections">
                  <section className="ptl-na-contact-section" aria-labelledby="na-contact-methods-heading">
                    <h4 id="na-contact-methods-heading">Contact</h4>
                    <dl>
                      <div><dt>Email</dt><dd>{clean(selected.email) ? <>{selected.email}<ContactCopyButton value={clean(selected.email)} label="email" /></> : 'Not provided'}</dd></div>
                      <div><dt>Phone</dt><dd>{clean(selected.phone) ? <>{selected.phone}<ContactCopyButton value={clean(selected.phone)} label="phone" /></> : 'Not provided'}</dd></div>
                    </dl>
                  </section>
                  {(selected.organization || selected.school_name || contactUnitList(selected).length > 0 || selected.services) && (
                    <section className="ptl-na-contact-section" aria-labelledby="na-contact-affiliation-heading">
                      <h4 id="na-contact-affiliation-heading">Affiliation</h4>
                      <dl>
                        {selected.organization && <div><dt>Organization</dt><dd>{selected.organization}</dd></div>}
                        {selected.school_name && <div><dt>School</dt><dd>{selected.school_name}</dd></div>}
                        {contactUnitList(selected).length > 0 && (
                          <div><dt>{contactUnitList(selected).length === 1 ? 'Unit' : 'Units'}</dt><dd>{contactUnitList(selected).join(', ')}</dd></div>
                        )}
                        {selected.services && <div><dt>{contactServicesMeta(getPrimaryCategory(selected), selected.role)?.label || 'Services'}</dt><dd>{selected.services}</dd></div>}
                      </dl>
                    </section>
                  )}
                </div>
                <p className="ptl-na-readonly-note"><UserRound size={15} aria-hidden="true" /> {canManageContacts ? 'Contacts Editor' : 'View only'}</p>
                {canManageContacts && (
                  <div className="ptl-na-contact-status-bar">
                    <button
                      type="button"
                      className={`ptl-na-contact-status-wide${selected.is_active === false ? ' ptl-na-contact-status-wide-reactivate' : ''}`}
                      onClick={() => changeContactStatus(selected)}
                      disabled={saving}
                    >
                      {selected.is_active === false ? <><Power size={15} aria-hidden="true" /> Reactivate Contact</> : <><PowerOff size={15} aria-hidden="true" /> Deactivate Contact</>}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : <p className="ptl-na-contact-empty">Select a contact to view details.</p>}
        </aside>
      </div>
      {editorContact !== undefined && <ContactEditorModal contact={editorContact} saving={saving} error={mutationError} onClose={() => !saving && setEditorContact(undefined)} onSave={saveContact} />}
    </section>
  )
}

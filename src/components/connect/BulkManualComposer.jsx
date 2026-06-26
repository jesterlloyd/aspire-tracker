// src/components/connect/BulkManualComposer.jsx
//
// MANUAL-OUTREACH-TEMPLATE-LIBRARY Phase 2A — multi-source bulk audience composer (UI ONLY).
// Renders the three-panel Send-to-Many layout for manual bulk templates:
//   1. Audience  — source selector (Students / Contacts / Paste · Type), all deduped into one set
//   2. Message Type — shared selector rendered by the parent (renderTypeSelector)
//   3. Draft / Preview / Review
//
// HARD SCOPE: no sending, no endpoint, no notification_log, no message_archive. The "Send" button
// is disabled and labeled as arriving in Phase 2B. Survey Invitation is untouched (handled by the
// parent's own zones). Contacts are read with the table's existing RLS (no new endpoint/schema).

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { isValidEmail } from '../../lib/notifications/studentRecipient'
import { normalizeEmailForLookup } from '../../lib/emailUtils'
import {
  parseRecipientText, dedupeRecipients, applyMergeFields, firstNameFromName,
} from '../../lib/recipientParse'
import { buildBulkTemplate } from '../../lib/outreachTemplates'
import { getContactCategories } from '../../lib/contactCategories'
import {
  getStudentBulkEmailRoute, emailTypeLabel, EMAIL_ROUTE_FILTERS, matchesEmailRouteFilter,
} from '../../lib/studentBulkEmail'
import ContactAutocomplete from './ContactAutocomplete'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

// ── Local style tokens (mirror OutreachView's design language) ──────────────────
const panelCard = {
  background: '#ffffff', border: '1px solid rgba(29,37,103,0.10)', borderRadius: 12,
  padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', fontFamily: F,
}
const panelTitle = {
  fontSize: 12, fontWeight: 700, color: 'var(--color-accent-primary,#1D2567)',
  letterSpacing: '-0.01em', marginBottom: 2, fontFamily: F,
}
const panelSubtitle = { fontSize: 10, color: '#9ca3af', fontFamily: F, marginBottom: 14 }
const inputBase = {
  width: '100%', padding: '10px 13px', border: '1.5px solid #e5e7eb', borderRadius: 8,
  fontSize: 13, fontFamily: F, color: '#191919', background: '#fff', outline: 'none', boxSizing: 'border-box',
}
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, fontFamily: F }

const CONTACT_CATEGORIES = ['All', 'Academic Partners', 'Unit Leadership', 'Preceptors', 'BNI Team', 'Nursing Executives', 'Other']

// Default audience source per manual template (owner-approved mapping).
const DEFAULT_SOURCE = {
  academic_partner_placement:   'contacts',
  student_profile_invitation:   'students',
  student_interview_scheduling: 'students',
  announcement_broadcast:       'students',
}
const DEFAULT_CONTACT_CATEGORY = {
  academic_partner_placement: 'Academic Partners',
}

const SOURCE_BADGE = {
  student: { label: 'Student', color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  contact: { label: 'Contact', color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  manual:  { label: 'Manual',  color: '#3f3f46', bg: '#f4f4f5', border: '#e4e4e7' },
}

// App origin for static public links (browser origin, with a safe production fallback).
const APP_ORIGIN = (typeof window !== 'undefined' && window.location && window.location.origin)
  ? window.location.origin
  : 'https://aspire-tracker.vercel.app'

// Static public-link substitutions per template. These are public, tokenless routes — never
// tokenized/secure links. Deadlines and other [placeholders] stay editable. Announcement keeps
// all of its placeholders (its unit/orientation details are intentionally hand-edited).
const STATIC_LINK_SUBS = {
  academic_partner_placement:   { token: '[Insert School Form Link]',       path: '/school-form' },
  student_profile_invitation:   { token: '[Insert Student Form Link]',      path: '/student-form' },
  student_interview_scheduling: { token: '[Insert Interview Schedule Link]', path: '/interview-schedule' },
}

// Replace a template's link placeholder with the full public URL (if one is defined for the key).
function withStaticLinks(key, body) {
  const sub = STATIC_LINK_SUBS[key]
  if (!sub) return body
  return String(body || '').split(sub.token).join(`${APP_ORIGIN}${sub.path}`)
}

// students use the shared bulk email-routing rule (school during Active Rotation, personal after,
// with fallback). The routed email + type define the intended Phase 2B recipient.
function studentToRecipient(s) {
  if (!s) return null
  const route = getStudentBulkEmailRoute(s)
  if (route.emailType === 'missing' || !isValidEmail(route.email)) return null
  const name = `${s.first_name || ''} ${s.last_name || ''}`.trim()
  return {
    email: route.email, normEmail: normalizeEmailForLookup(route.email), name,
    firstName: s.first_name || '', school: s.school || null,
    source: 'student', studentId: s.id, contactId: null,
    emailType: route.emailType, emailReason: route.reason,
  }
}
function contactToRecipient(c) {
  if (!c || !isValidEmail(c.email)) return null
  const name = c.preferred_name || c.full_name || ''
  return {
    email: c.email.trim(), normEmail: normalizeEmailForLookup(c.email), name,
    firstName: firstNameFromName(name), school: c.school_name || null,
    source: 'contact', studentId: null, contactId: c.id,
  }
}

export default function BulkManualComposer({
  bulkMsgType,
  students = [],
  loadingStudents = false,
  renderTypeSelector,
}) {
  // ── Audience state ────────────────────────────────────────────────────────
  const [source, setSource]               = useState(DEFAULT_SOURCE[bulkMsgType] || 'students')

  // Students source — search + filters + sort. NOTE: an assignment-status filter is intentionally
  // NOT offered here. The only assignment data wired into Outreach (bulkActiveAssignments) reflects
  // survey/evaluation assignments for the selected survey timepoint — not a real placement/rotation
  // assignment — so exposing it on manual templates would imply more than the data supports. It is
  // deferred until a true placement indicator is available in this view.
  const [studentSearch, setStudentSearch]   = useState('')
  const [studentSchool, setStudentSchool]   = useState('')
  const [studentStatus, setStudentStatus]   = useState('')
  const [studentEmailF, setStudentEmailF]   = useState('all')   // shared EMAIL_ROUTE_FILTERS value
  const [studentSort, setStudentSort]       = useState('name')  // name | school | status | email
  const [studentSel, setStudentSel]         = useState(() => new Set()) // student ids

  // Contacts source — `contacts` is null until the first load (drives derived loading state).
  const [contacts, setContacts]           = useState(null)
  const [contactSearch, setContactSearch] = useState('')
  const [contactCat, setContactCat]       = useState(DEFAULT_CONTACT_CATEGORY[bulkMsgType] || 'All')
  const [showInactive, setShowInactive]   = useState(false)
  const [contactSel, setContactSel]       = useState(() => new Set()) // contact ids

  // Paste / Type source — ONE unified recipient control (typeahead + paste).
  const [acInput, setAcInput]             = useState('')
  const [picked, setPicked]               = useState([])  // normalized recipients (chips)
  const [manualInvalids, setManualInvalids] = useState([]) // raw tokens that failed validation

  // Draft state
  const [subject, setSubject]             = useState('')
  const [body, setBody]                   = useState('')
  const [includeSignature, setIncludeSig] = useState(true)

  // Preview / Review
  const [previewNorm, setPreviewNorm]     = useState(null)
  const [reviewOpen, setReviewOpen]       = useState(false)

  // ── Hydrate draft + default source when the template changes ────────────────
  // React's endorsed "adjust state while rendering" pattern (no effect, no extra commit):
  // when bulkMsgType differs from the last hydrated key, reset the draft/source to that
  // template's defaults. The user's edits persist until they switch templates again.
  const [hydratedType, setHydratedType] = useState(null)
  if (hydratedType !== bulkMsgType) {
    setHydratedType(bulkMsgType)
    const tpl = buildBulkTemplate(bulkMsgType)
    if (tpl) { setSubject(tpl.subject); setBody(withStaticLinks(bulkMsgType, tpl.body)) }
    setIncludeSig(true)
    setSource(DEFAULT_SOURCE[bulkMsgType] || 'students')
    setContactCat(DEFAULT_CONTACT_CATEGORY[bulkMsgType] || 'All')
  }

  // ── Load contacts once the Contacts source is first opened ──────────────────
  // All setState lives in the async resolution (the endorsed effect pattern); loading is derived.
  const contactsRequested = useRef(false)
  useEffect(() => {
    if (source !== 'contacts' || contactsRequested.current) return
    contactsRequested.current = true
    supabase.from('contacts')
      .select('id, full_name, preferred_name, email, role, category, school_name, organization, unit_name, is_active')
      .order('full_name')
      .then(({ data }) => setContacts(data || []))
      .catch(() => setContacts([]))
  }, [source])
  const loadingContacts = source === 'contacts' && contacts === null

  // ── Escape closes the review modal ──────────────────────────────────────────
  useEffect(() => {
    if (!reviewOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setReviewOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reviewOpen])

  // Distinct schools / statuses for the filter dropdowns.
  const studentSchools = useMemo(
    () => [...new Set(students.map(s => s.school).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [students],
  )
  const studentStatuses = useMemo(
    () => [...new Set(students.map(s => s.status).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [students],
  )

  // ── Derived: filtered + sorted students ─────────────────────────────────────
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase()
    const out = students.filter(s => {
      if (q) {
        const hay = `${s.first_name || ''} ${s.last_name || ''} ${s.personal_email || ''} ${s.school_email || ''} ${s.school || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (studentSchool && s.school !== studentSchool) return false
      if (studentStatus && s.status !== studentStatus) return false
      if (!matchesEmailRouteFilter(s, studentEmailF)) return false
      return true
    })
    const cmp = {
      name:   (a, b) => `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(`${b.last_name || ''} ${b.first_name || ''}`),
      school: (a, b) => String(a.school || '').localeCompare(String(b.school || '')),
      status: (a, b) => String(a.status || '').localeCompare(String(b.status || '')),
      email:  (a, b) => getStudentBulkEmailRoute(a).emailType.localeCompare(getStudentBulkEmailRoute(b).emailType),
    }[studentSort] || null
    return cmp ? [...out].sort(cmp) : out
  }, [students, studentSearch, studentSchool, studentStatus, studentEmailF, studentSort])

  // ── Derived: filtered contacts ──────────────────────────────────────────────
  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase()
    return (contacts || []).filter(c => {
      if (!showInactive && c.is_active === false) return false
      if (contactCat !== 'All' && !getContactCategories(c).includes(contactCat)) return false
      if (!q) return true
      const hay = `${c.full_name || ''} ${c.preferred_name || ''} ${c.email || ''} ${c.role || ''} ${c.organization || ''} ${c.school_name || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [contacts, contactSearch, contactCat, showInactive])

  // ── Derived: combined deduped recipients ────────────────────────────────────
  const combined = useMemo(() => {
    const fromStudents = [...studentSel].map(id => studentToRecipient(students.find(s => s.id === id))).filter(Boolean)
    const fromContacts = [...contactSel].map(id => contactToRecipient((contacts || []).find(c => c.id === id))).filter(Boolean)
    // Order matters for the dedupe rule: Students → Contacts → Paste · Type (chips).
    return dedupeRecipients([...fromStudents, ...fromContacts, ...picked])
  }, [studentSel, contactSel, picked, students, contacts])

  const recipients     = combined.recipients
  const dupCount       = combined.duplicateCount
  const invalidEntries = manualInvalids

  // Set of all chosen normalized emails — hides already-added rows from the typeahead.
  const excludeEmails = useMemo(() => new Set(recipients.map(r => r.normEmail)), [recipients])

  // Keep the preview pointer valid.
  const previewRecipient = useMemo(() => {
    if (!recipients.length) return null
    return recipients.find(r => r.normEmail === previewNorm) || recipients[0]
  }, [recipients, previewNorm])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const toggleStudent = useCallback((id) => {
    setStudentSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const toggleContact = useCallback((id) => {
    setContactSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const selectAllStudents = useCallback(() => {
    setStudentSel(prev => {
      const n = new Set(prev)
      filteredStudents.forEach(s => { if (getStudentBulkEmailRoute(s).emailType !== 'missing') n.add(s.id) })
      return n
    })
  }, [filteredStudents])
  const selectAllContacts = useCallback(() => {
    setContactSel(prev => {
      const n = new Set(prev)
      filteredContacts.forEach(c => { if (isValidEmail(c.email)) n.add(c.id) })
      return n
    })
  }, [filteredContacts])
  const clearAll = useCallback(() => {
    setStudentSel(new Set()); setContactSel(new Set()); setPicked([]); setManualInvalids([]); setAcInput('')
  }, [])

  const onTypeaheadSelect = useCallback((r) => {
    if (!r?.email || !isValidEmail(r.email)) return
    const normEmail = r.norm || normalizeEmailForLookup(r.email)
    const contactId = typeof r.key === 'string' && r.key.startsWith('contact:') ? r.key.slice('contact:'.length) : null
    const studentId = r.source === 'student' ? (r.raw?.id || null) : null
    const sourceKind = studentId ? 'student' : contactId ? 'contact' : 'manual'
    const rec = {
      email: r.email.trim(), normEmail, name: r.name || '',
      firstName: firstNameFromName(r.name), school: r.raw?.school || null,
      source: sourceKind, studentId, contactId,
    }
    setPicked(prev => prev.some(p => p.normEmail === normEmail) ? prev : [...prev, rec])
    setAcInput('')
  }, [])

  // Add parsed recipients (and surface invalids) from typed-and-committed or pasted text.
  const ingestText = useCallback((text) => {
    const { valid, invalid } = parseRecipientText(text)
    if (valid.length) setPicked(prev => {
      const seen = new Set(prev.map(p => p.normEmail))
      const add = valid.filter(v => !seen.has(v.normEmail))
      return add.length ? [...prev, ...add] : prev
    })
    if (invalid.length) setManualInvalids(prev => [...new Set([...prev, ...invalid])])
    setAcInput('')
  }, [])

  const onTypeaheadCommit = useCallback((text) => { if (text && text.trim()) ingestText(text) }, [ingestText])

  // Unified control: pasting a multi-recipient blob is parsed directly (newlines preserved here,
  // unlike a single-line input's onChange), so one field handles both typing and paste.
  const onRecipientPaste = useCallback((e) => {
    const text = e.clipboardData?.getData('text') || ''
    if (/[,;\n]/.test(text) || text.trim().split(/\s+/).length > 1) {
      e.preventDefault()
      ingestText(text)
    }
  }, [ingestText])

  const removePicked = useCallback((normEmail) => {
    setPicked(prev => prev.filter(p => p.normEmail !== normEmail))
  }, [])
  const clearInvalids = useCallback(() => setManualInvalids([]), [])

  // ── Sample preview (client-rendered; first name + school only) ───────────────
  const previewSubject = previewRecipient ? applyMergeFields(subject, previewRecipient) : subject
  const previewBody    = previewRecipient ? applyMergeFields(body, previewRecipient) : body

  // ── Render helpers ──────────────────────────────────────────────────────────
  const sourceTab = (key, label) => (
    <button
      key={key}
      onClick={() => setSource(key)}
      style={{
        flex: 1, padding: '7px 6px', fontSize: 11, fontWeight: source === key ? 700 : 600,
        fontFamily: F, cursor: 'pointer', border: 'none',
        borderBottom: source === key ? `2px solid ${NAVY}` : '2px solid transparent',
        background: 'transparent', color: source === key ? NAVY : '#6b7280',
      }}
    >{label}</button>
  )

  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start', width: '100%' }}>

      {/* ── Zone 1: Audience ─────────────────────────────────────────────── */}
      <div style={{ ...panelCard, flex: '0 0 340px', minWidth: 280, maxHeight: 'calc(100dvh - 280px)', overflowY: 'auto' }}>
        <div style={panelTitle}>Audience</div>
        <div style={panelSubtitle}>Build one recipient list from any source.</div>

        {/* Combined count — simple "N selected" language (dedup happens silently). */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 11px', marginBottom: 12,
          background: recipients.length ? '#EEF2FB' : '#f9fafb',
          border: `1px solid ${recipients.length ? '#c3cdf0' : '#e5e7eb'}`, borderRadius: 8,
        }}>
          <span style={{ fontSize: 12, fontFamily: F, color: '#374151' }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: NAVY }}>{recipients.length}</span>
            <span style={{ marginLeft: 5, color: '#6b7280' }}>selected</span>
          </span>
          <div style={{ display: 'flex', gap: 5 }}>
            {recipients.length > 0 && (
              <button onClick={() => setReviewOpen(true)} style={{
                padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, fontFamily: F, cursor: 'pointer',
              }}>Review</button>
            )}
            {(studentSel.size || contactSel.size || picked.length || manualInvalids.length) ? (
              <button onClick={clearAll} style={{
                padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontFamily: F, cursor: 'pointer',
              }}>Clear</button>
            ) : null}
          </div>
        </div>
        {(dupCount > 0 || invalidEntries.length > 0) && (
          <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginBottom: 10, lineHeight: 1.5 }}>
            {dupCount > 0 && <span>{dupCount} duplicate{dupCount === 1 ? '' : 's'} removed. </span>}
            {invalidEntries.length > 0 && <span style={{ color: '#dc2626' }}>{invalidEntries.length} invalid entr{invalidEntries.length === 1 ? 'y' : 'ies'} ignored.</span>}
          </div>
        )}

        {/* Audience Source selector */}
        <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', marginBottom: 12 }}>
          {sourceTab('students', 'Students')}
          {sourceTab('contacts', 'Contacts')}
          {sourceTab('paste', 'Paste · Type')}
        </div>

        {/* ── Students source ── */}
        {source === 'students' && (
          <div>
            <input value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
              placeholder="Search name, personal/school email, or school…"
              style={{ ...inputBase, fontSize: 12, padding: '7px 10px', marginBottom: 6 }} />
            {studentSchools.length > 1 && (
              <select value={studentSchool} onChange={e => setStudentSchool(e.target.value)}
                style={{ ...inputBase, fontSize: 11, padding: '5px 8px', marginBottom: 6 }}>
                <option value="">All schools</option>
                {studentSchools.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {studentStatuses.length > 1 && (
              <select value={studentStatus} onChange={e => setStudentStatus(e.target.value)}
                style={{ ...inputBase, fontSize: 11, padding: '5px 8px', marginBottom: 6 }}>
                <option value="">All statuses</option>
                {studentStatuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <select value={studentEmailF} onChange={e => setStudentEmailF(e.target.value)}
                style={{ ...inputBase, flex: 1, fontSize: 10, padding: '4px 6px' }}>
                {EMAIL_ROUTE_FILTERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={studentSort} onChange={e => setStudentSort(e.target.value)}
                style={{ ...inputBase, flex: 1, fontSize: 10, padding: '4px 6px' }}>
                <option value="name">Sort: Name</option>
                <option value="school">Sort: School</option>
                <option value="status">Sort: Status</option>
                <option value="email">Sort: Email route</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <button onClick={selectAllStudents} style={{
                padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, fontFamily: F, cursor: 'pointer',
              }}>Select all shown</button>
              <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: F }}>{filteredStudents.length} shown</span>
            </div>
            {loadingStudents ? (
              <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af', fontFamily: F }}>Loading students…</div>
            ) : filteredStudents.length === 0 ? (
              <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af', fontFamily: F }}>No students match.</div>
            ) : filteredStudents.map(s => {
              const route = getStudentBulkEmailRoute(s)
              const eligible = route.emailType !== 'missing'
              const sel = studentSel.has(s.id)
              const altEmail = route.emailType === 'school' ? s.personal_email
                : route.emailType === 'personal' ? s.school_email : null
              const routeColor = route.emailType === 'school' ? '#0e4e6e' : route.emailType === 'personal' ? '#1D2567' : '#dc2626'
              const routeBg    = route.emailType === 'school' ? '#E1F3FB' : route.emailType === 'personal' ? '#EEF2FB' : '#fef2f2'
              return (
                <div key={s.id} onClick={() => eligible && toggleStudent(s.id)} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 6px', borderRadius: 6, marginBottom: 3,
                  background: sel ? '#EEF2FB' : 'transparent', cursor: eligible ? 'pointer' : 'default', opacity: eligible ? 1 : 0.55,
                }}>
                  <input type="checkbox" checked={sel} readOnly disabled={!eligible} style={{ marginTop: 2, flexShrink: 0, accentColor: NAVY }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#191919', fontFamily: F, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.last_name}, {s.first_name}
                    </div>
                    <div title={isValidEmail(altEmail) ? `Alternate: ${altEmail}` : undefined}
                      style={{ fontSize: 10, color: eligible ? '#6b7280' : '#dc2626', fontFamily: F, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {eligible ? route.email : 'No email on file'}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3, alignItems: 'center' }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: routeBg, color: routeColor, fontFamily: F }}>{emailTypeLabel(route.emailType)}</span>
                      {s.school && <span style={{ fontSize: 9, color: '#9ca3af', fontFamily: F }}>{s.school}</span>}
                      {s.status && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: '#f3f4f6', color: '#6b7280', fontFamily: F }}>{s.status}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Contacts source ── */}
        {source === 'contacts' && (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {CONTACT_CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setContactCat(cat)} style={{
                  padding: '3px 8px', borderRadius: 999, fontSize: 10, fontWeight: contactCat === cat ? 700 : 600,
                  border: `1px solid ${contactCat === cat ? NAVY : '#e5e7eb'}`,
                  background: contactCat === cat ? '#EEF2FB' : '#fff', color: contactCat === cat ? NAVY : '#6b7280',
                  fontFamily: F, cursor: 'pointer',
                }}>{cat}</button>
              ))}
            </div>
            <input value={contactSearch} onChange={e => setContactSearch(e.target.value)}
              placeholder="Search name, email, role, org…"
              style={{ ...inputBase, fontSize: 12, padding: '7px 10px', marginBottom: 8 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <button onClick={selectAllContacts} style={{
                padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, fontFamily: F, cursor: 'pointer',
              }}>Select all shown</button>
              <label style={{ fontSize: 10, color: '#6b7280', fontFamily: F, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} style={{ accentColor: NAVY }} />
                Show inactive
              </label>
            </div>
            {loadingContacts ? (
              <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af', fontFamily: F }}>Loading contacts…</div>
            ) : filteredContacts.length === 0 ? (
              <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af', fontFamily: F }}>No contacts match.</div>
            ) : filteredContacts.map(c => {
              const eligible = isValidEmail(c.email)
              const sel = contactSel.has(c.id)
              return (
                <div key={c.id} onClick={() => eligible && toggleContact(c.id)} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 6px', borderRadius: 6, marginBottom: 3,
                  background: sel ? '#EEF2FB' : 'transparent', cursor: eligible ? 'pointer' : 'default', opacity: (c.is_active === false ? 0.6 : 1) * (eligible ? 1 : 0.6),
                }}>
                  <input type="checkbox" checked={sel} readOnly disabled={!eligible} style={{ marginTop: 2, flexShrink: 0, accentColor: NAVY }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#191919', fontFamily: F, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.preferred_name || c.full_name}
                      {c.is_active === false && <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#f3f4f6', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Inactive</span>}
                    </div>
                    <div style={{ fontSize: 10, color: '#6b7280', fontFamily: F, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.email || <span style={{ color: '#dc2626' }}>No email on file</span>}
                    </div>
                    <div style={{ fontSize: 9, color: '#9ca3af', fontFamily: F, marginTop: 2 }}>
                      {[getContactCategories(c)[0], c.organization].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Paste · Type source — ONE unified recipient control ── */}
        {source === 'paste' && (
          <div>
            <label style={{ ...labelStyle, fontSize: 11 }}>Search or paste recipients</label>
            <ContactAutocomplete
              value={acInput}
              onChange={setAcInput}
              placeholder="Type a name or email…"
              students={students}
              excludeEmails={excludeEmails}
              onSelect={onTypeaheadSelect}
              onCommitManual={onTypeaheadCommit}
              onPaste={onRecipientPaste}
            />
            <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 4, lineHeight: 1.5 }}>
              Type a name or email, or paste multiple recipients separated by commas, semicolons, or new lines. Supports <code>First Last &lt;email@example.com&gt;</code>.
            </div>
            {picked.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '8px 0' }}>
                {picked.map(p => {
                  const b = SOURCE_BADGE[p.source] || SOURCE_BADGE.manual
                  return (
                    <span key={p.normEmail} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999,
                      background: b.bg, border: `1px solid ${b.border}`, color: b.color, fontSize: 10, fontFamily: F,
                    }}>
                      {p.name ? `${p.name} · ` : ''}{p.email}
                      <button onClick={() => removePicked(p.normEmail)} style={{ border: 'none', background: 'transparent', color: b.color, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>×</button>
                    </span>
                  )
                })}
              </div>
            )}
            {invalidEntries.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 10, color: '#dc2626', fontFamily: F, lineHeight: 1.5, flex: 1 }}>
                  Not added (invalid): {invalidEntries.slice(0, 6).join(', ')}{invalidEntries.length > 6 ? ` +${invalidEntries.length - 6} more` : ''}
                </div>
                <button onClick={clearInvalids} style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: 10, fontFamily: F, flexShrink: 0 }}>Dismiss</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Zone 2: Message Type (shared selector from parent) ───────────── */}
      <div style={{ ...panelCard, flex: '0 0 270px', minWidth: 220 }}>
        <div style={panelTitle}>Message Type</div>
        <div style={panelSubtitle}>Bulk workflow</div>
        {renderTypeSelector?.()}
        <div style={{ marginTop: 12, padding: '8px 10px', background: '#FBF5E8', border: '1px solid #f0c9b0', borderRadius: 8, fontSize: 10, color: '#8B5E1A', fontFamily: F, lineHeight: 1.5 }}>
          Manual bulk templates compose and review here. Sending arrives in Phase 2B — no email is sent from this screen.
        </div>
      </div>

      {/* ── Zone 3: Draft / Preview / Review ─────────────────────────────── */}
      <div style={{ flex: '1 1 320px', minWidth: 280 }}>
        <div style={panelCard}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#191919', fontFamily: F, marginBottom: 10 }}>
            Draft
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} style={inputBase} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={14}
              style={{ ...inputBase, resize: 'vertical', lineHeight: 1.6, minHeight: 240, fontSize: 13 }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', fontFamily: F, cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={includeSignature} onChange={e => setIncludeSig(e.target.checked)} style={{ accentColor: NAVY }} />
            Include my email signature
          </label>
          <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, lineHeight: 1.5 }}>
            First name and school merge per recipient at send. All other [placeholders] (links, deadlines, dates, unit, preceptor) are edited once here and sent as-is.
          </div>
        </div>

        {/* Sample preview */}
        <div style={{ ...panelCard, marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#191919', fontFamily: F }}>Sample preview</div>
            {recipients.length > 0 && (
              <select value={previewRecipient?.normEmail || ''} onChange={e => setPreviewNorm(e.target.value)}
                style={{ ...inputBase, width: 'auto', maxWidth: 200, fontSize: 11, padding: '5px 8px' }}>
                {recipients.map(r => <option key={r.normEmail} value={r.normEmail}>{r.name ? `${r.name} — ` : ''}{r.email}</option>)}
              </select>
            )}
          </div>
          {recipients.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F, padding: '12px 0', textAlign: 'center' }}>
              Add recipients to preview a merged sample.
            </div>
          ) : (
            <div>
              {previewRecipient && (
                <div style={{ fontSize: 10, color: '#6b7280', fontFamily: F, marginBottom: 8, lineHeight: 1.5 }}>
                  To: <strong>{previewRecipient.email}</strong>
                  {previewRecipient.source === 'student' && previewRecipient.emailType && (
                    <span> · {emailTypeLabel(previewRecipient.emailType)}</span>
                  )}
                </div>
              )}
              <div style={{ fontSize: 12, fontWeight: 700, color: '#191919', fontFamily: F, marginBottom: 6 }}>{previewSubject}</div>
              <div style={{ fontSize: 12, color: '#374151', fontFamily: F, lineHeight: 1.6, whiteSpace: 'pre-wrap', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', maxHeight: 320, overflowY: 'auto' }}>
                {previewBody}
              </div>
              <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 6, lineHeight: 1.5 }}>
                Client-rendered preview (first name + school only). Server-rendered preview and the email signature are applied at send in Phase 2B. This does not send or log anything.
              </div>
            </div>
          )}
        </div>

        {/* Action row — no send in Phase 2A */}
        <div style={{ ...panelCard, marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setReviewOpen(true)} disabled={recipients.length === 0} style={{
            padding: '9px 18px', borderRadius: 8, border: `1px solid ${NAVY}`,
            background: recipients.length ? '#fff' : '#f3f4f6', color: recipients.length ? NAVY : '#9ca3af',
            fontSize: 13, fontWeight: 600, fontFamily: F, cursor: recipients.length ? 'pointer' : 'not-allowed',
          }}>Review recipients ({recipients.length})</button>
          <button disabled title="Sending arrives in Phase 2B" style={{
            padding: '9px 18px', borderRadius: 8, border: 'none', background: '#e5e7eb',
            color: '#9ca3af', fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'not-allowed',
          }}>Send (Phase 2B)</button>
        </div>
      </div>

      {/* ── Review Recipients modal ──────────────────────────────────────── */}
      {reviewOpen && (
        <div onClick={() => setReviewOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={{
            background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560, maxHeight: '80vh',
            display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', fontFamily: F,
          }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #f3f4f6' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: NAVY, fontFamily: F }}>Review recipients</h2>
              <div style={{ fontSize: 12, color: '#6b7280', fontFamily: F, marginTop: 4 }}>
                {recipients.length} recipient{recipients.length === 1 ? '' : 's'} (deduped)
                {dupCount > 0 && ` · ${dupCount} duplicate${dupCount === 1 ? '' : 's'} removed`}
                {invalidEntries.length > 0 && ` · ${invalidEntries.length} invalid ignored`}
              </div>
            </div>
            <div style={{ padding: '12px 22px', overflowY: 'auto', flex: 1 }}>
              {recipients.map(r => {
                const b = SOURCE_BADGE[r.source] || SOURCE_BADGE.manual
                return (
                  <div key={r.normEmail} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #f9fafb' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: b.bg, color: b.color, border: `1px solid ${b.border}`, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>{b.label}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#191919', fontFamily: F }}>{r.name || <span style={{ color: '#9ca3af', fontWeight: 400 }}>—</span>}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F }}>{r.email}</div>
                    </div>
                  </div>
                )
              })}
              {invalidEntries.length > 0 && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', fontFamily: F, marginBottom: 4 }}>Invalid entries (not included)</div>
                  <div style={{ fontSize: 11, color: '#b91c1c', fontFamily: F, lineHeight: 1.5, wordBreak: 'break-all' }}>{invalidEntries.join(', ')}</div>
                </div>
              )}
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: '#8B5E1A', fontFamily: F }}>No email is sent from this screen — sending arrives in Phase 2B.</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setReviewOpen(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'pointer' }}>Close</button>
                <button disabled title="Sending arrives in Phase 2B" style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#e5e7eb', color: '#9ca3af', fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'not-allowed' }}>Send (Phase 2B)</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

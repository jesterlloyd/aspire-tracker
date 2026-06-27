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
  emailTypeLabel, EMAIL_SOURCE_OPTIONS, studentEmailForSource, studentHasEmailSource,
} from '../../lib/studentBulkEmail'
import ContactAutocomplete from './ContactAutocomplete'
import ConnectPanel from './ConnectPanel'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

// ── Local style tokens (mirror OutreachView's design language) ──────────────────
// Panel frame/header now come from <ConnectPanel>; panelCard remains for the white action bar.
const panelCard = {
  background: '#ffffff', border: '1px solid rgba(29,37,103,0.10)', borderRadius: 12,
  padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', fontFamily: F,
}
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

// The explicit Email-source dropdown ('school' | 'personal') decides the recipient email — NOT the
// routing helper. A student without an email for that source is excluded.
function studentToRecipient(s, source) {
  if (!s) return null
  const email = studentEmailForSource(s, source)
  if (!email) return null
  const name = `${s.first_name || ''} ${s.last_name || ''}`.trim()
  return {
    email, normEmail: normalizeEmailForLookup(email), name,
    firstName: s.first_name || '', school: s.school || null,
    source: 'student', studentId: s.id, contactId: null,
    emailType: source,
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
  const [studentEmailSrc, setStudentEmailSrc] = useState('school') // explicit recipient email source
  const [studentSort, setStudentSort]       = useState('name')     // name | status
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
  const [reviewOpen, setReviewOpen]       = useState(false)
  // Branded "Preview as sent" — { html, loading, error } from the existing DM preview endpoint
  // (preview:true → no send, no log, no archive). Only for id-bearing sample recipients.
  const [preview, setPreview]             = useState({ html: '', loading: false, error: null })

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

  // Distinct schools for the school filter dropdown.
  const studentSchools = useMemo(
    () => [...new Set(students.map(s => s.school).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [students],
  )

  // ── Derived: filtered + sorted students ─────────────────────────────────────
  // The Email-source filter shows only students that have an email for the chosen source.
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase()
    const out = students.filter(s => {
      if (q) {
        const hay = `${s.first_name || ''} ${s.last_name || ''} ${s.personal_email || ''} ${s.school_email || ''} ${s.school || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (studentSchool && s.school !== studentSchool) return false
      if (!studentHasEmailSource(s, studentEmailSrc)) return false
      return true
    })
    const cmp = {
      name:   (a, b) => `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(`${b.last_name || ''} ${b.first_name || ''}`),
      status: (a, b) => String(a.status || '').localeCompare(String(b.status || '')),
    }[studentSort] || null
    return cmp ? [...out].sort(cmp) : out
  }, [students, studentSearch, studentSchool, studentEmailSrc, studentSort])

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
    const fromStudents = [...studentSel].map(id => studentToRecipient(students.find(s => s.id === id), studentEmailSrc)).filter(Boolean)
    const fromContacts = [...contactSel].map(id => contactToRecipient((contacts || []).find(c => c.id === id))).filter(Boolean)
    // Order matters for the dedupe rule: Students → Contacts → Paste · Type (chips).
    return dedupeRecipients([...fromStudents, ...fromContacts, ...picked])
  }, [studentSel, contactSel, picked, students, contacts, studentEmailSrc])

  const recipients     = combined.recipients
  const dupCount       = combined.duplicateCount
  const invalidEntries = manualInvalids

  // Set of all chosen normalized emails — hides already-added rows from the typeahead.
  const excludeEmails = useMemo(() => new Set(recipients.map(r => r.normEmail)), [recipients])

  // The preview always renders the FIRST selected recipient (merge fields differ per recipient).
  // The Audience picker is the single source of truth — no second recipient control in the preview.
  const previewRecipient = recipients[0] || null

  // ── Handlers ────────────────────────────────────────────────────────────────
  const toggleStudent = useCallback((id) => {
    setStudentSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const toggleContact = useCallback((id) => {
    setContactSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const selectAllStudents = useCallback(() => {
    // Every filtered student already has an email for the chosen source.
    setStudentSel(prev => {
      const n = new Set(prev)
      filteredStudents.forEach(s => n.add(s.id))
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

  // ── Preview as sent ─────────────────────────────────────────────────────────
  // Merge fields (first name + school) for the selected sample recipient, then render the EXACT
  // branded email via the existing DM preview endpoint (preview:true → no send/log/archive).
  const previewSubject = previewRecipient ? applyMergeFields(subject, previewRecipient) : subject
  const previewBody    = previewRecipient ? applyMergeFields(body, previewRecipient) : body
  const previewRid     = previewRecipient?.studentId || previewRecipient?.contactId || null

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      // Branded preview is only available for id-bearing (student/contact) recipients; the endpoint
      // resolves the recipient server-side by UUID and never accepts a raw email.
      if (!previewRid || !previewBody.trim()) { if (!cancelled) setPreview({ html: '', loading: false, error: null }); return }
      setPreview(p => ({ ...p, loading: true, error: null }))
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) { if (!cancelled) setPreview({ html: '', loading: false, error: 'Session expired — refresh to preview.' }); return }
        const res = await fetch('/api/connect-send-direct-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({
            preview:           true,
            recipient_type:    previewRecipient.studentId ? 'student' : 'contact',
            recipient_id:      previewRid,
            subject:           previewSubject,
            body:              previewBody,
            body_format:       'text',
            include_signature: includeSignature,
          }),
        })
        const data = await res.json().catch(() => null)
        if (cancelled) return
        if (res.ok && data?.success) setPreview({ html: data.html || '', loading: false, error: null })
        else setPreview({ html: '', loading: false, error: data?.error || 'Preview unavailable.' })
      } catch { if (!cancelled) setPreview({ html: '', loading: false, error: 'Preview unavailable.' }) }
    }, 450)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [previewRid, previewRecipient, previewSubject, previewBody, includeSignature])

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
      {/* overflow stays auto for the long Students/Contacts lists, but is visible for Paste · Type
          so the typeahead suggestion dropdown is never clipped by the card. */}
      <ConnectPanel tone="audience" title="Audience" helper="Build one recipient list from any source."
        style={{ flex: '0 0 340px', minWidth: 280, maxHeight: 'calc(100dvh - 280px)', overflowY: source === 'paste' ? 'visible' : 'auto' }}>

        {/* Audience Source selector */}
        <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', marginBottom: 10 }}>
          {sourceTab('students', 'Students')}
          {sourceTab('contacts', 'Contacts')}
          {sourceTab('paste', 'Paste · Type')}
        </div>

        {/* Combined count BELOW the source selector — consistent with Survey Invitation. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 11px', marginBottom: 8,
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

        {/* ── Students source ── */}
        {source === 'students' && (
          <div>
            <input value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
              placeholder="Search name, personal/school email, or school…"
              style={{ ...inputBase, fontSize: 12, padding: '7px 10px', marginBottom: 6 }} />
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              {studentSchools.length > 1 && (
                <select value={studentSchool} onChange={e => setStudentSchool(e.target.value)}
                  style={{ ...inputBase, flex: 1, fontSize: 10, padding: '4px 6px' }}>
                  <option value="">All schools</option>
                  {studentSchools.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              <select value={studentEmailSrc} onChange={e => setStudentEmailSrc(e.target.value)}
                style={{ ...inputBase, flex: 1, fontSize: 10, padding: '4px 6px' }}>
                {EMAIL_SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={studentSort} onChange={e => setStudentSort(e.target.value)}
                style={{ ...inputBase, flex: 1, fontSize: 10, padding: '4px 6px' }}>
                <option value="name">Alphabetically</option>
                <option value="status">By Status</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <button onClick={selectAllStudents} style={{
                padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, fontFamily: F, cursor: 'pointer',
              }}>Select all shown</button>
              <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: F }}>{filteredStudents.length} shown · {emailTypeLabel(studentEmailSrc).toLowerCase()}</span>
            </div>
            {loadingStudents ? (
              <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af', fontFamily: F }}>Loading students…</div>
            ) : filteredStudents.length === 0 ? (
              <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af', fontFamily: F }}>No students with a {emailTypeLabel(studentEmailSrc).toLowerCase()}.</div>
            ) : filteredStudents.map(s => {
              const email = studentEmailForSource(s, studentEmailSrc)
              const sel = studentSel.has(s.id)
              const altEmail = studentEmailSrc === 'school' ? s.personal_email : s.school_email
              const badgeColor = studentEmailSrc === 'school' ? '#0e4e6e' : '#1D2567'
              const badgeBg    = studentEmailSrc === 'school' ? '#E1F3FB' : '#EEF2FB'
              return (
                <div key={s.id} onClick={() => toggleStudent(s.id)} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 6px', borderRadius: 6, marginBottom: 3,
                  background: sel ? '#EEF2FB' : 'transparent', cursor: 'pointer',
                }}>
                  <input type="checkbox" checked={sel} readOnly style={{ marginTop: 2, flexShrink: 0, accentColor: NAVY }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#191919', fontFamily: F, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.last_name}, {s.first_name}
                    </div>
                    <div title={isValidEmail(altEmail) ? `Alternate: ${altEmail}` : undefined}
                      style={{ fontSize: 10, color: '#6b7280', fontFamily: F, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3, alignItems: 'center' }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: badgeBg, color: badgeColor, fontFamily: F }}>{emailTypeLabel(studentEmailSrc)}</span>
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

        {/* ── Paste · Type source — ONE unified recipient control (chips + typeahead + paste) ── */}
        {source === 'paste' && (
          <div>
            <label style={{ ...labelStyle, fontSize: 11 }}>Search or paste recipients</label>
            {/* position:relative anchors the suggestion dropdown; the bordered box gives the input a
                defined surface and holds the chips inline — same pattern as Send to One's CC field. */}
            <div style={{
              position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
              padding: '6px 8px', border: '1.5px solid #e5e7eb', borderRadius: 8, background: '#fff', minHeight: 38,
            }}>
              {picked.map(p => {
                const b = SOURCE_BADGE[p.source] || SOURCE_BADGE.manual
                return (
                  <span key={p.normEmail} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 6px 3px 9px', borderRadius: 14,
                    background: b.bg, border: `1px solid ${b.border}`, color: b.color, fontSize: 11.5, fontFamily: F,
                  }}>
                    {p.name ? `${p.name} · ` : ''}{p.email}
                    <button onClick={() => removePicked(p.normEmail)} aria-label={`Remove ${p.email}`} style={{ border: 'none', background: 'transparent', color: b.color, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                )
              })}
              <ContactAutocomplete
                value={acInput}
                onChange={setAcInput}
                placeholder={picked.length ? 'Add another…' : 'Type a name or email…'}
                students={students}
                excludeEmails={excludeEmails}
                onSelect={onTypeaheadSelect}
                onCommitManual={onTypeaheadCommit}
                onPaste={onRecipientPaste}
                onBackspaceEmpty={() => setPicked(prev => prev.slice(0, -1))}
              />
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 4, lineHeight: 1.5 }}>
              Type a name or email, or paste multiple recipients separated by commas, semicolons, or new lines. Supports <code>First Last &lt;email@example.com&gt;</code>.
            </div>
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
      </ConnectPanel>

      {/* ── Zone 2: Message Type (shared selector from parent) ───────────── */}
      <ConnectPanel tone="message" title="Message Type" helper="Bulk workflow" style={{ flex: '0 0 270px', minWidth: 220 }}>
        {renderTypeSelector?.()}
        <div style={{ marginTop: 12, padding: '8px 10px', background: '#FBF5E8', border: '1px solid #f0c9b0', borderRadius: 8, fontSize: 10, color: '#8B5E1A', fontFamily: F, lineHeight: 1.5 }}>
          Manual bulk templates compose and review here. Sending arrives in Phase 2B — no email is sent from this screen.
        </div>
      </ConnectPanel>

      {/* ── Zone 3: Draft / Preview / Review ─────────────────────────────── */}
      <div style={{ flex: '1 1 320px', minWidth: 280 }}>
        <ConnectPanel tone="draft" title="Draft">

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
        </ConnectPanel>

        {/* Email Preview — tint on the shell; the branded email card inside stays white */}
        <ConnectPanel tone="preview" title="Email Preview" padding={24} style={{ marginTop: 14 }}>

          {recipients.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F, padding: '12px 0', textAlign: 'center' }}>
              Add recipients to preview the branded email.
            </div>
          ) : (
            <div>
              {/* Audience summary — the Audience picker is the only recipient control. */}
              {recipients.length === 1 ? (
                <div style={{ fontSize: 12, color: '#374151', fontFamily: F, margin: '2px 0 10px' }}>
                  To: <strong>{previewRecipient?.email}</strong>
                  {previewRecipient?.source === 'student' && previewRecipient?.emailType && (
                    <span style={{ color: '#6b7280' }}> · {emailTypeLabel(previewRecipient.emailType)}</span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#374151', fontFamily: F, margin: '2px 0 10px' }}>
                  Recipients: <strong>{recipients.length} selected</strong>
                </div>
              )}

              {previewRid ? (
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                  {preview.loading ? (
                    <div style={{ padding: '24px 14px', fontSize: 12, color: '#9ca3af', fontFamily: F, textAlign: 'center' }}>Rendering preview…</div>
                  ) : preview.error ? (
                    <div style={{ padding: '16px 14px', fontSize: 12, color: '#dc2626', fontFamily: F }}>{preview.error}</div>
                  ) : preview.html ? (
                    <iframe
                      title="Preview as sent"
                      srcDoc={preview.html}
                      sandbox="allow-same-origin"
                      style={{ width: '100%', height: 520, border: 'none', background: '#fff', display: 'block' }}
                    />
                  ) : (
                    <div style={{ padding: '24px 14px', fontSize: 13, color: '#d1d5db', fontStyle: 'italic', fontFamily: F, textAlign: 'center' }}>
                      Add subject and message content to see the branded email…
                    </div>
                  )}
                </div>
              ) : (
                // Raw pasted recipients have no student/contact ID, so the branded preview endpoint
                // (which resolves by UUID) can't render them. Show the merged text as a fallback.
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                  <div style={{ fontSize: 11, color: '#8B5E1A', fontFamily: F, background: '#FBF5E8', borderBottom: '1px solid #f0c9b0', padding: '8px 12px', lineHeight: 1.5 }}>
                    Branded preview is available for student and contact recipients. This one was added manually — showing the merged text.
                  </div>
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#191919', fontFamily: F, marginBottom: 6 }}>{previewSubject}</div>
                    <div style={{ fontSize: 12, color: '#374151', fontFamily: F, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto' }}>
                      {previewBody}
                    </div>
                  </div>
                </div>
              )}
              <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 8, lineHeight: 1.5 }}>
                Preview reflects one selected recipient. Bulk send remains disabled.
              </div>
            </div>
          )}
        </ConnectPanel>

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

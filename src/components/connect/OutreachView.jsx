import { useState, useEffect, useCallback } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Tooltip from '../ui/Tooltip'

const F = 'DM Sans, sans-serif'

const INSTRUMENTS = [
  { slug: 'casey_fink_readiness_2024', label: 'Casey-Fink Readiness for Practice Survey, 2024' },
]

const TIMEPOINTS = [
  { value: 'baseline',                label: 'Baseline' },
  { value: 'early_rotation_baseline', label: 'Early-Rotation Baseline' },
  { value: 'midpoint',               label: 'Mid-Rotation Check-In' },
  { value: 'post_rotation',          label: 'Post-Rotation' },
]

const LAST_MODE_KEY    = 'aspire.connect.outreach.lastMode'  // inner message type key ('message'|'survey')
const RECIPIENT_MODE_KEY = 'aspire.connect.outreach.mode'   // top-level mode key ('single'|'bulk')

// Message type roster for Single Recipient mode
const MSG_TYPES = [
  { key: 'message', label: 'Direct Message',            active: true  },
  { key: 'survey',  label: 'Survey Invitation',          active: true  },
  { key: null,      label: 'Announcement / Broadcast',   active: false },
  { key: null,      label: 'Check-In',                   active: false },
  { key: null,      label: 'Reminder',                   active: false },
  { key: null,      label: 'Coordinator Update',         active: false },
  { key: null,      label: 'NGRP Update',               active: false },
  { key: null,      label: 'Preceptor Communication',    active: false },
]

const FUTURE_AUDIENCES = [
  'Contact categories',
  'Saved groups',
  'School coordinators',
  'Unit leaders',
  'Students',
  'Preceptors',
]

function defaultExpiresAt() {
  const d = new Date()
  d.setDate(d.getDate() + 28)
  return d.toISOString().split('T')[0]
}

function minExpiresAt() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

// ── Shared style tokens ───────────────────────────────────────────────────────

const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: '#374151', marginBottom: 6, fontFamily: F,
}

const inputBase = {
  width: '100%', padding: '10px 13px',
  border: '1.5px solid #e5e7eb', borderRadius: 8,
  fontSize: 13, fontFamily: F, color: '#191919',
  background: '#fff', outline: 'none', boxSizing: 'border-box',
}

const fieldWrap = { marginBottom: 18 }

const panelCard = {
  background: '#ffffff',
  border: '1px solid rgba(29,37,103,0.10)',
  borderRadius: 12,
  padding: '16px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
  fontFamily: F,
}

const panelTitle = {
  fontSize: 12, fontWeight: 700, color: 'var(--color-accent-primary,#1D2567)',
  letterSpacing: '-0.01em', marginBottom: 2, fontFamily: F,
}

const panelSubtitle = {
  fontSize: 10, color: '#9ca3af', fontFamily: F, marginBottom: 14,
}

const panelBody = {
  fontSize: 11, color: '#9ca3af', lineHeight: 1.65,
  margin: 0, fontFamily: F,
}

const futureBadge = {
  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
  background: '#f3f4f6', color: '#9ca3af', letterSpacing: '0.08em',
  fontFamily: F, textTransform: 'uppercase',
}

const sectionLabel = {
  fontSize: 10, fontWeight: 700, color: '#9ca3af',
  letterSpacing: '0.13em', textTransform: 'uppercase',
  marginBottom: 6, fontFamily: F, display: 'block',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OutreachView({ cohortId, onNavigateToStudent }) {
  const location       = useLocation()
  const [searchParams] = useSearchParams()

  // URL params provide explicit routing intent — used by Contacts Email button
  const urlMode      = searchParams.get('mode')      // 'message' | 'survey' | null
  const urlContactId = searchParams.get('contactId') // UUID | null

  // Router state carries contact display info when navigating from Contacts
  const fromContact = location.state?.fromContact || null

  // Resolved contact ID: router state preferred, URL param as fallback
  const contactId = fromContact?.id || urlContactId || null

  // Display info (name, email) only available when router state is present.
  // If contactId is from URL only (router state lost), show unavailable state.
  const contactHasDisplayInfo = !!(fromContact?.name || fromContact?.email)

  // ── Top-level recipient mode: 'single' | 'bulk' ─────────────────────────────
  // Priority: URL/router state (contact deep-link forces 'single') > localStorage > default 'single'
  const [recipientMode, setRecipientMode] = useState(() => {
    // Any contact deep-link or direct-message param forces single recipient
    if (urlMode === 'message' || fromContact) return 'single'
    // Future: if (searchParams.get('bulk') === 'survey_invitation') return 'bulk'
    const saved = localStorage.getItem(RECIPIENT_MODE_KEY)
    return saved === 'bulk' ? 'bulk' : 'single'
  })

  // ── Inner message type within Single Recipient ────────────────────────────
  // Priority: URL param > router state > localStorage > default ──
  const [outreachMode, setOutreachMode] = useState(() => {
    if (urlMode === 'message' || urlMode === 'survey') return urlMode
    if (fromContact) return 'message'
    const saved = localStorage.getItem(LAST_MODE_KEY)
    return (saved === 'survey' || saved === 'message') ? saved : 'survey'
  })

  // ── Bulk Operation scaffold state (held in-memory only, never sent anywhere) ──
  // These values are local UI state for Phase 3A scaffolding.
  // No endpoint is called, no tokens generated, no data written.
  const [bulkMsgType,     setBulkMsgType]     = useState('survey_invitation')
  const [bulkInstrument,  setBulkInstrument]  = useState('casey_fink_readiness_2024')
  const [bulkTimepoint,   setBulkTimepoint]   = useState('early_rotation_baseline')
  const [bulkExpiresAt,   setBulkExpiresAt]   = useState(defaultExpiresAt)
  const [bulkNotes,       setBulkNotes]       = useState('')

  // ── Direct Message draft — scoped to contact ID ───────────────────────────
  // Stores ONLY { subject, body }. surveyResult, surveyUrl, and tokens are
  // NEVER stored in localStorage/sessionStorage.
  const DRAFT_KEY = contactId
    ? `aspire.connect.outreach.directDraft.${contactId}`
    : null

  const [msgSubject, setMsgSubject] = useState('')
  const [msgBody,    setMsgBody]    = useState('')

  // ── Survey Invitation form state ──────────────────────────────────────────
  const [students,          setStudents]          = useState([])
  const [loadingStudents,   setLoadingStudents]   = useState(true)
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [instrument,        setInstrument]        = useState('casey_fink_readiness_2024')
  const [timepoint,         setTimepoint]         = useState('early_rotation_baseline')
  const [expiresAt,         setExpiresAt]         = useState(defaultExpiresAt)
  const [notes,             setNotes]             = useState('')
  const [duplicateExists,   setDuplicateExists]   = useState(false)
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)

  // ── Generate Link state ───────────────────────────────────────────────────
  const [generating,    setGenerating]    = useState(false)
  const [generateError, setGenerateError] = useState(null)
  // surveyResult holds the returned payload — surveyUrl, assignmentId, expiresAt, student.
  // NEVER persisted to localStorage/sessionStorage. Cleared on form field changes.
  const [surveyResult,  setSurveyResult]  = useState(null)
  const [copied,        setCopied]        = useState(false)

  // ── Persist top-level recipient mode ─────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(RECIPIENT_MODE_KEY, recipientMode)
  }, [recipientMode])

  // ── Persist inner message type ────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(LAST_MODE_KEY, outreachMode)
  }, [outreachMode])

  // ── Fetch students ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!cohortId) return
    setLoadingStudents(true)
    supabase
      .from('students')
      .select('id, first_name, last_name, school, school_email, personal_email')
      .eq('cohort_id', cohortId)
      .order('last_name')
      .order('first_name')
      .then(({ data }) => {
        setStudents(data || [])
        setLoadingStudents(false)
      })
  }, [cohortId])

  // ── Duplicate guard ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedStudentId || !timepoint || !cohortId) {
      setDuplicateExists(false)
      return
    }
    setCheckingDuplicate(true)
    supabase
      .from('evaluation_assignments')
      .select('id')
      .eq('student_id', selectedStudentId)
      .eq('cohort_id', cohortId)
      .eq('timepoint', timepoint)
      .not('status', 'in', '(revoked,expired)')
      .limit(1)
      .then(({ data }) => {
        setDuplicateExists(!!(data && data.length > 0))
        setCheckingDuplicate(false)
      })
  }, [selectedStudentId, timepoint, cohortId])

  // ── Clear generated link when form identity changes ───────────────────────
  // Raw survey URL must not persist if recipient, instrument, or timepoint changes.
  useEffect(() => {
    setSurveyResult(null)
    setGenerateError(null)
    setCopied(false)
  }, [selectedStudentId, instrument, timepoint])

  // ── Direct Message draft: restore on mount ────────────────────────────────
  useEffect(() => {
    if (!DRAFT_KEY) return
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
      if (typeof saved.subject === 'string') setMsgSubject(saved.subject)
      if (typeof saved.body    === 'string') setMsgBody(saved.body)
    } catch { /* ignore malformed draft */ }
  }, [DRAFT_KEY]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Direct Message draft: persist on change ───────────────────────────────
  // Stores ONLY { subject, body } — never surveyResult, surveyUrl, or tokens
  useEffect(() => {
    if (!DRAFT_KEY) return
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ subject: msgSubject, body: msgBody }))
  }, [msgSubject, msgBody, DRAFT_KEY])

  // ── Derived values ────────────────────────────────────────────────────────
  const selectedStudent  = students.find(s => s.id === selectedStudentId) || null
  const resolvedEmail    = selectedStudent
    ? (selectedStudent.personal_email || selectedStudent.school_email || null)
    : null
  const emailSource      = selectedStudent
    ? (selectedStudent.personal_email
        ? 'personal email'
        : selectedStudent.school_email ? 'school email' : null)
    : null
  const firstName        = selectedStudent?.first_name || null
  const instrumentLabel  = INSTRUMENTS.find(i => i.slug === instrument)?.label || ''
  const expiresFormatted = fmtDate(expiresAt)
  const formValid        = !!(selectedStudentId && instrument && timepoint)

  // ── Generate Link handler ─────────────────────────────────────────────────
  const handleGenerateLink = useCallback(async () => {
    if (!formValid || generating) return
    setGenerating(true)
    setGenerateError(null)
    setSurveyResult(null)
    setCopied(false)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setGenerateError('Session expired. Please refresh and try again.')
        return
      }

      const res = await fetch('/api/evaluation-create-invitation', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          studentId:  selectedStudentId,
          cohortId,
          timepoint,
          expiresAt,
          notes: notes.trim() || undefined,
        }),
      })

      // Parse JSON separately — Vercel returns HTML on a handler crash,
      // not JSON, which would otherwise surface as a misleading "Network error".
      let payload = null
      try {
        payload = await res.json()
      } catch {
        setGenerateError(
          `Server error (HTTP ${res.status}). Check Vercel function logs for api/evaluation-create-invitation. Likely cause: missing Production environment variable.`
        )
        return
      }

      if (res.status === 409) {
        setGenerateError(
          payload?.error ||
          'An active invitation already exists for this student and timepoint. Review in the Evaluation tab.'
        )
        return
      }
      if (!res.ok) {
        setGenerateError(payload?.error || 'Failed to generate link. Please try again.')
        return
      }

      // Store returned payload in React state only.
      // Raw survey URL is never logged or persisted beyond this state variable.
      setSurveyResult(payload)
    } catch {
      setGenerateError('Network error. Please check your connection and try again.')
    } finally {
      setGenerating(false)
    }
  }, [formValid, generating, selectedStudentId, cohortId, timepoint, expiresAt, notes])

  // ── Copy Link handler ─────────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!surveyResult?.surveyUrl) return
    try {
      await navigator.clipboard.writeText(surveyResult.surveyUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }, [surveyResult])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '20px 24px', fontFamily: F }}>

      {/* ══════════════════════════════════════════════════════════════════
          RECIPIENT MODE TOGGLE — Single vs Bulk
          Segmented control above the three zones.
      ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          display: 'flex', border: '1px solid rgba(29,37,103,0.14)',
          borderRadius: 8, overflow: 'hidden',
        }}>
          <Tooltip label="Compose a message for one contact, student, coordinator, or preceptor." placement="bottom">
            <button
              onClick={() => setRecipientMode('single')}
              style={{
                padding: '8px 20px', border: 'none', cursor: 'pointer',
                background: recipientMode === 'single' ? '#1D2567' : '#f9fafb',
                color: recipientMode === 'single' ? '#fff' : '#6b7280',
                fontSize: 12, fontWeight: 600, fontFamily: F,
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              Send to one recipient
            </button>
          </Tooltip>
          <Tooltip label="Send surveys, announcements, or updates to multiple recipients." placement="bottom">
            <button
              onClick={() => setRecipientMode('bulk')}
              style={{
                padding: '8px 20px', border: 'none', cursor: 'pointer',
                borderLeft: '1px solid rgba(29,37,103,0.14)',
                background: recipientMode === 'bulk' ? '#1D2567' : '#f9fafb',
                color: recipientMode === 'bulk' ? '#fff' : '#6b7280',
                fontSize: 12, fontWeight: 600, fontFamily: F,
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              Send to many
            </button>
          </Tooltip>
        </div>
        <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: F }}>
          {recipientMode === 'bulk' ? 'Bulk Operation — Phase 3A scaffolding' : ''}
        </span>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SINGLE RECIPIENT MODE — all existing three-zone behavior preserved
      ═══════════════════════════════════════════════════════════════════ */}
      {recipientMode === 'single' && (
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* ═══════════════════════════════════════════════════════════════
            ZONE 1 — Audience / Recipients
            Who the communication is for.
        ════════════════════════════════════════════════════════════════ */}
        <div style={{ ...panelCard, flex: '0 0 196px', minWidth: 156 }}>
          <div style={panelTitle}>Audience</div>
          <div style={panelSubtitle}>
            {outreachMode === 'message' ? '1 recipient · direct message' : 'Survey invitation'}
          </div>

          {/* Contact context (Direct Message mode) */}
          {outreachMode === 'message' && (
            contactId && contactHasDisplayInfo ? (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#191919', fontFamily: F, lineHeight: 1.3 }}>
                  {fromContact.name}
                </div>
                {fromContact.email && (
                  <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F, marginTop: 3, wordBreak: 'break-all' }}>
                    {fromContact.email}
                  </div>
                )}
                <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: '#EEF2FB', color: '#1D2567', border: '1px solid #c3cdf0',
                    fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>Contact</span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0',
                    fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>1 recipient</span>
                </div>
              </div>
            ) : contactId ? (
              // contactId from URL but no display info (router state unavailable)
              <div style={{
                marginBottom: 14, padding: '9px 11px',
                background: '#FBF5E8', border: '1px solid #f0c9b0',
                borderRadius: 8, fontSize: 11, color: '#8B5E1A', fontFamily: F, lineHeight: 1.5,
              }}>
                Contact context unavailable. Return to Contacts and click Email.
              </div>
            ) : (
              <div style={{ ...panelBody, marginBottom: 14 }}>
                No contact selected. Return to Contacts and click Email.
              </div>
            )
          )}

          {/* Student context (Survey Invitation mode) */}
          {outreachMode === 'survey' && (
            selectedStudent ? (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#191919', fontFamily: F, lineHeight: 1.3 }}>
                  {selectedStudent.first_name} {selectedStudent.last_name}
                </div>
                {selectedStudent.school && (
                  <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F, marginTop: 3 }}>
                    {selectedStudent.school}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                  {resolvedEmail ? (
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      background: '#EEF7F0', color: '#166534', border: '1px solid #c6d9a8',
                      fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>Email on file</span>
                  ) : (
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                      fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>Missing email</span>
                  )}
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: '#EEF2FB', color: '#1D2567', border: '1px solid #c3cdf0',
                    fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>
                    {TIMEPOINTS.find(t => t.value === timepoint)?.label || timepoint}
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ ...panelBody, marginBottom: 14 }}>
                Select a student to see recipient context.
              </div>
            )
          )}

          {/* Future audience options */}
          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 10, marginBottom: 10 }}>
            {FUTURE_AUDIENCES.map(label => (
              <Tooltip key={label} label="Coming in a future release" placement="right">
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 0', borderBottom: '1px solid #f3f4f6',
                  opacity: 0.45, cursor: 'default',
                }}>
                  <span style={{ fontSize: 11, color: '#374151', fontFamily: F }}>{label}</span>
                  <span style={futureBadge}>Future</span>
                </div>
              </Tooltip>
            ))}
          </div>

          <p style={panelBody}>
            {outreachMode === 'message'
              ? 'Groups and categories will be added in a future release.'
              : 'Single-student invitations are supported now. Segments and groups coming soon.'}
          </p>
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            ZONE 2 — Message Type / Workflow
            What kind of outreach this is and its workflow settings.
        ════════════════════════════════════════════════════════════════ */}
        <div style={{ ...panelCard, flex: '0 0 260px', minWidth: 220 }}>
          <div style={panelTitle}>Message Type</div>
          <div style={panelSubtitle}>Workflow</div>

          {/* Type selector */}
          <div style={{ marginBottom: 16 }}>
            {MSG_TYPES.map(({ key, label, active }) =>
              active ? (
                <button
                  key={label}
                  onClick={() => setOutreachMode(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '7px 10px',
                    border: outreachMode === key
                      ? '1.5px solid #1D2567'
                      : '1.5px solid #e5e7eb',
                    borderRadius: 7,
                    background: outreachMode === key ? '#EEF2FB' : '#fff',
                    cursor: 'pointer', marginBottom: 4,
                    fontSize: 12,
                    fontWeight: outreachMode === key ? 700 : 500,
                    color: outreachMode === key ? '#1D2567' : '#374151',
                    fontFamily: F, textAlign: 'left',
                    transition: 'all 0.1s',
                  }}
                >
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: outreachMode === key ? '#1D2567' : 'transparent',
                    border: outreachMode === key ? '2px solid #1D2567' : '2px solid #d1d5db',
                    transition: 'all 0.1s',
                  }} />
                  {label}
                </button>
              ) : (
                <Tooltip key={label} label="Coming in a future release" placement="right">
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '6px 10px',
                    border: '1.5px solid #f3f4f6', borderRadius: 7,
                    background: '#fafafa', cursor: 'not-allowed',
                    marginBottom: 4, opacity: 0.5,
                  }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: 'transparent', border: '2px solid #d1d5db',
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#9ca3af', fontFamily: F }}>
                      {label}
                    </span>
                    <span style={{ ...futureBadge, marginLeft: 'auto' }}>Future</span>
                  </div>
                </Tooltip>
              )
            )}
          </div>

          {/* Workflow settings for selected type */}
          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 14 }}>

            {/* Direct Message workflow */}
            {outreachMode === 'message' && (
              <div>
                <div style={{ ...fieldWrap }}>
                  <span style={sectionLabel}>Recipient</span>
                  {contactId && contactHasDisplayInfo ? (
                    <div style={{
                      padding: '9px 11px', background: '#f9fafb',
                      border: '1.5px solid #e5e7eb', borderRadius: 8,
                      fontSize: 12, fontFamily: F, color: '#374151',
                    }}>
                      <div style={{ fontWeight: 600, color: '#191919' }}>{fromContact.name}</div>
                      {fromContact.email && (
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, wordBreak: 'break-all' }}>
                          {fromContact.email}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={panelBody}>
                      {contactId ? 'Contact context unavailable.' : 'No contact selected.'}
                    </p>
                  )}
                </div>

                <div style={{
                  padding: '9px 11px', background: '#f9fafb',
                  border: '1px solid #e5e7eb', borderRadius: 8,
                  fontSize: 11, color: '#6b7280', fontFamily: F, lineHeight: 1.65,
                }}>
                  <div>Direct email sending will be enabled in a future release.</div>
                  {DRAFT_KEY && (
                    <div style={{ color: '#9ca3af', marginTop: 4 }}>
                      Draft is saved locally for this contact.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Survey Invitation workflow — all form fields + Generate Link */}
            {outreachMode === 'survey' && (
              <div>
                {/* Field 1 — Recipient */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>
                    Recipient <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
                  </label>
                  <select
                    value={selectedStudentId}
                    onChange={e => setSelectedStudentId(e.target.value)}
                    style={inputBase}
                  >
                    <option value="">
                      {loadingStudents ? 'Loading students…' : 'Select a student'}
                    </option>
                    {students.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.first_name} {s.last_name}{s.school ? ` — ${s.school}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Field 2 — Delivery email */}
                {selectedStudent && (
                  <div style={fieldWrap}>
                    <label style={labelStyle}>Delivery email</label>
                    {resolvedEmail ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{
                          flex: 1, padding: '10px 13px',
                          background: '#f9fafb', border: '1.5px solid #e5e7eb',
                          borderRadius: 8, fontSize: 13, color: '#374151', fontFamily: F,
                        }}>
                          {resolvedEmail}
                        </div>
                        {emailSource && (
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 7px',
                            borderRadius: 5, background: '#f3f4f6', color: '#6b7280',
                            border: '1px solid #e5e7eb', whiteSpace: 'nowrap', fontFamily: F,
                          }}>
                            {emailSource}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div style={{
                        padding: '10px 13px', background: '#fef2f2',
                        border: '1.5px solid #fecaca', borderRadius: 8,
                        fontSize: 12, color: '#dc2626', fontFamily: F, lineHeight: 1.5,
                      }}>
                        No email address on file for this student.{' '}
                        {onNavigateToStudent ? (
                          <button
                            onClick={() => onNavigateToStudent(selectedStudentId)}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              fontSize: 12, color: '#dc2626', fontFamily: F,
                              fontWeight: 600, padding: 0,
                              textDecoration: 'underline', textUnderlineOffset: 2,
                            }}
                          >
                            Update student profile →
                          </button>
                        ) : (
                          'Update the student profile before sending.'
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Field 3 — Instrument */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>
                    Instrument <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
                  </label>
                  <select
                    value={instrument}
                    onChange={e => setInstrument(e.target.value)}
                    style={inputBase}
                  >
                    {INSTRUMENTS.map(i => (
                      <option key={i.slug} value={i.slug}>{i.label}</option>
                    ))}
                  </select>
                </div>

                {/* Field 4 — Timepoint */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>
                    Timepoint <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
                  </label>
                  <select
                    value={timepoint}
                    onChange={e => setTimepoint(e.target.value)}
                    style={inputBase}
                  >
                    {TIMEPOINTS.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* Field 5 — Expires at */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>
                    Expires <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
                  </label>
                  <input
                    type="date"
                    value={expiresAt}
                    min={minExpiresAt()}
                    onChange={e => setExpiresAt(e.target.value)}
                    style={inputBase}
                  />
                </div>

                {/* Field 6 — Notes */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>
                    Notes{' '}
                    <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value.slice(0, 500))}
                    placeholder="Optional message or context for this invitation."
                    rows={3}
                    style={{ ...inputBase, resize: 'vertical', lineHeight: 1.5, minHeight: 74 }}
                  />
                  <div style={{
                    fontSize: 11, color: notes.length > 480 ? '#dc2626' : '#9ca3af',
                    textAlign: 'right', marginTop: 4, fontFamily: F,
                  }}>
                    {notes.length}/500
                  </div>
                </div>

                {/* Duplicate guard */}
                {selectedStudentId && timepoint && !checkingDuplicate && duplicateExists && (
                  <div style={{
                    padding: '11px 14px', marginBottom: 18,
                    background: '#FBF5E8', border: '1px solid #f0c9b0',
                    borderRadius: 8, fontSize: 12, color: '#8B5E1A',
                    fontFamily: F, lineHeight: 1.6,
                  }}>
                    An assignment for this student and timepoint already exists. Review in the Evaluation tab before sending a new invitation.
                  </div>
                )}

                {/* Error state */}
                {generateError && (
                  <div style={{
                    padding: '11px 14px', marginBottom: 18,
                    background: '#fef2f2', border: '1px solid #fecaca',
                    borderRadius: 8, fontSize: 12, color: '#dc2626',
                    fontFamily: F, lineHeight: 1.6,
                  }}>
                    {generateError}
                  </div>
                )}

                {/* Generate Link action */}
                <div style={{ paddingTop: 4 }}>
                  <button
                    onClick={handleGenerateLink}
                    disabled={!formValid || generating}
                    style={{
                      padding: '9px 20px',
                      background: formValid && !generating
                        ? 'var(--color-accent-primary,#1D2567)'
                        : '#e5e7eb',
                      border: 'none', borderRadius: 8,
                      fontSize: 13, fontWeight: 600, fontFamily: F,
                      color: formValid && !generating ? '#fff' : '#9ca3af',
                      cursor: formValid && !generating ? 'pointer' : 'not-allowed',
                      transition: 'background 0.15s',
                    }}
                  >
                    {generating ? 'Generating…' : 'Generate Link'}
                  </button>
                  {!formValid && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af', fontFamily: F, lineHeight: 1.5 }}>
                      Select a student, instrument, and timepoint to generate a link.
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            ZONE 3 — Compose / Preview / Action
            Actual writing, preview, generated-link placement, and actions.
        ════════════════════════════════════════════════════════════════ */}
        <div style={{ flex: '1 1 300px', minWidth: 260 }}>

          {/* Direct Message: subject + body editor + live preview + actions */}
          {outreachMode === 'message' && (
            <div style={panelCard}>

              {/* Subject input */}
              <div style={fieldWrap}>
                <label style={labelStyle}>Subject</label>
                <input
                  type="text"
                  value={msgSubject}
                  onChange={e => setMsgSubject(e.target.value)}
                  placeholder="Email subject"
                  style={inputBase}
                  disabled={!contactId}
                />
              </div>

              {/* Body textarea */}
              <div style={fieldWrap}>
                <label style={labelStyle}>Message</label>
                <textarea
                  value={msgBody}
                  onChange={e => setMsgBody(e.target.value)}
                  placeholder={
                    contactId
                      ? 'Compose your message…'
                      : 'Return to Contacts and click Email to compose a direct message.'
                  }
                  rows={8}
                  style={{ ...inputBase, resize: 'vertical', lineHeight: 1.6, minHeight: 160 }}
                  disabled={!contactId}
                />
              </div>

              {/* Action bar */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
                <Tooltip label="Draft persistence coming soon" placement="top">
                  <button disabled style={{
                    padding: '8px 16px', background: '#e5e7eb',
                    border: 'none', borderRadius: 8,
                    fontSize: 12, fontWeight: 600, fontFamily: F,
                    color: '#9ca3af', cursor: 'not-allowed',
                  }}>
                    Save Draft
                  </button>
                </Tooltip>
                <Tooltip label="Email sending will be enabled in a future release" placement="top">
                  <button disabled style={{
                    padding: '8px 16px', background: '#e5e7eb',
                    border: 'none', borderRadius: 8,
                    fontSize: 12, fontWeight: 600, fontFamily: F,
                    color: '#9ca3af', cursor: 'not-allowed',
                  }}>
                    Send Email
                  </button>
                </Tooltip>
                <p style={{
                  margin: 0, fontSize: 11, color: '#9ca3af', fontFamily: F,
                  lineHeight: 1.5, flex: '1 1 100%', paddingTop: 4,
                }}>
                  Direct email sending will be enabled in a future release.
                </p>
              </div>

              {/* Live preview */}
              <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 16 }}>
                <span style={sectionLabel}>Preview</span>
                <div style={{
                  background: '#f9fafb', borderRadius: 8,
                  border: '1px solid #e5e7eb', overflow: 'hidden',
                }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, marginBottom: 3 }}>Subject</div>
                    <div style={{ fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.5 }}>
                      {msgSubject || (
                        <span style={{ color: '#d1d5db', fontStyle: 'italic' }}>No subject yet</span>
                      )}
                    </div>
                  </div>
                  <div style={{ padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, marginBottom: 6 }}>Body</div>
                    <div style={{ fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                      {msgBody || (
                        <span style={{ color: '#d1d5db', fontStyle: 'italic' }}>
                          Start typing to see a preview…
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Survey Invitation: email preview + generated link card */}
          {outreachMode === 'survey' && (
            <div>

              {/* Survey email preview */}
              <div style={{
                ...panelCard,
                border: surveyResult
                  ? '1px solid rgba(29,37,103,0.16)'
                  : '1px solid rgba(29,37,103,0.10)',
              }}>
                {/* Subject line */}
                <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #f3f4f6' }}>
                  <span style={sectionLabel}>Subject</span>
                  <div style={{ fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.5 }}>
                    ASPIRE Program: Your Pre-Rotation Readiness Survey is ready
                  </div>
                </div>

                {/* Body preview */}
                <div>
                  <span style={sectionLabel}>Message preview</span>
                  <div style={{ fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.8 }}>
                    <p style={{ margin: '0 0 12px' }}>
                      Dear{' '}
                      {firstName
                        ? <strong>{firstName}</strong>
                        : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>[Student first name]</span>
                      },
                    </p>
                    <p style={{ margin: '0 0 12px' }}>
                      You are invited to complete the <em>{instrumentLabel}</em> as part of your participation in the ASPIRE Program.
                    </p>
                    {notes.trim() && (
                      <p style={{ margin: '0 0 12px' }}>{notes.trim()}</p>
                    )}
                    <p style={{ margin: '0 0 12px' }}>
                      Click the link below to begin. This survey expires on <strong>{expiresFormatted}</strong>.
                    </p>

                    {/* Survey link — placeholder before generation, real URL shown once after */}
                    <p style={{ margin: '0 0 12px' }}>
                      {surveyResult ? (
                        <span style={{
                          display: 'block', padding: '6px 10px',
                          background: '#EEF7F0', border: '1px solid #c6d9a8', borderRadius: 6,
                          fontSize: 11, color: '#166534',
                          fontFamily: 'ui-monospace, monospace',
                          wordBreak: 'break-all', lineHeight: 1.6,
                          userSelect: 'text',
                        }}>
                          {surveyResult.surveyUrl}
                        </span>
                      ) : (
                        <span style={{
                          display: 'inline-block', padding: '3px 9px',
                          background: '#f3f4f6', borderRadius: 5,
                          fontSize: 12, color: '#6b7280', fontStyle: 'italic', fontFamily: F,
                        }}>
                          [Secure survey link will be generated]
                        </span>
                      )}
                    </p>

                    <p style={{ margin: 0, fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>
                      Brawerman Nursing Institute · Cedars-Sinai<br />
                      ASPIRE Program
                    </p>
                  </div>
                </div>
              </div>

              {/* Generated link card — shown after successful Generate Link */}
              {surveyResult && (
                <div style={{
                  marginTop: 10,
                  background: '#fff', borderRadius: 12,
                  border: '1px solid rgba(29,37,103,0.10)',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                  overflow: 'hidden',
                }}>
                  {/* Success header */}
                  <div style={{
                    background: '#EEF7F0', borderBottom: '1px solid #c6d9a8',
                    padding: '10px 16px',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ fontSize: 12, color: '#2F7D5C', fontWeight: 600, fontFamily: F }}>
                      ✓ Link generated
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 5,
                      background: '#c6d9a8', color: '#166534', fontFamily: F,
                    }}>
                      {surveyResult.student?.firstName} {surveyResult.student?.lastName}
                    </span>
                  </div>

                  <div style={{ padding: '14px 16px' }}>
                    {/* One-time warning */}
                    <div style={{
                      padding: '9px 12px', marginBottom: 12,
                      background: '#FBF5E8', border: '1px solid #f0c9b0',
                      borderRadius: 8, fontSize: 11, color: '#8B5E1A',
                      fontFamily: F, lineHeight: 1.6,
                    }}>
                      This link is shown once. Copy it now before closing or changing the form.
                    </div>

                    {/* Copy action */}
                    <button
                      onClick={handleCopy}
                      style={{
                        padding: '7px 16px', marginBottom: 12,
                        background: copied ? '#EEF7F0' : 'var(--color-accent-primary,#1D2567)',
                        border: `1px solid ${copied ? '#c6d9a8' : 'transparent'}`,
                        borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: F,
                        color: copied ? '#2F7D5C' : '#fff', cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      {copied ? '✓ Copied' : 'Copy Link'}
                    </button>

                    {/* Assignment details */}
                    <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, lineHeight: 1.7 }}>
                      <div>
                        <strong style={{ color: '#6b7280' }}>Assignment ID:</strong>{' '}
                        {surveyResult.assignmentId}
                      </div>
                      <div>
                        <strong style={{ color: '#6b7280' }}>Expires:</strong>{' '}
                        {fmtDate(surveyResult.expiresAt?.split('T')[0])}
                      </div>
                      <div>
                        <strong style={{ color: '#6b7280' }}>Timepoint:</strong>{' '}
                        {TIMEPOINTS.find(t => t.value === surveyResult.timepoint)?.label || surveyResult.timepoint}
                      </div>
                      {surveyResult.student?.email && (
                        <div>
                          <strong style={{ color: '#6b7280' }}>Delivery email:</strong>{' '}
                          {surveyResult.student.email}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

      </div>
      )}{/* end recipientMode === 'single' */}

      {/* ══════════════════════════════════════════════════════════════════
          BULK OPERATION MODE — Phase 3A scaffold (UI only, no data sent)
          No endpoint calls. No tokens. No data mutations.
          Audience, workflow form values held in local state only.
      ═══════════════════════════════════════════════════════════════════ */}
      {recipientMode === 'bulk' && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>

          {/* ── Bulk Zone 1: Audience / Recipients ───────────────────── */}
          <div style={{ ...panelCard, flex: '0 0 220px', minWidth: 180 }}>
            <div style={panelTitle}>Audience</div>
            <div style={panelSubtitle}>Recipients</div>

            {/* Recipient count */}
            <div style={{
              padding: '10px 12px', marginBottom: 14,
              background: '#f9fafb', border: '1px solid #e5e7eb',
              borderRadius: 8, fontSize: 12, color: '#374151', fontFamily: F,
            }}>
              <span style={{ fontWeight: 700, fontSize: 18, color: '#191919' }}>0</span>
              <span style={{ marginLeft: 6, color: '#6b7280' }}>recipients selected</span>
            </div>

            {/* Audience filter controls — all disabled (Phase 3A) */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8, fontFamily: F }}>Filter by</div>
              {['Cohort', 'School', 'Status', 'Unit', 'Missing email only', 'No existing assignment'].map(label => (
                <Tooltip key={label} label="Coming in Phase 3A" placement="right">
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 8px', marginBottom: 4,
                    border: '1px solid #f3f4f6', borderRadius: 6,
                    background: '#fafafa', opacity: 0.55, cursor: 'not-allowed',
                  }}>
                    <span style={{ fontSize: 11, color: '#374151', fontFamily: F }}>{label}</span>
                    <span style={futureBadge}>3A</span>
                  </div>
                </Tooltip>
              ))}
            </div>

            {/* Bulk selection controls — disabled */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <Tooltip label="Coming in Phase 3A" placement="bottom">
                <button disabled style={{
                  flex: 1, padding: '5px 8px', borderRadius: 6,
                  border: '1px solid #e5e7eb', background: '#fafafa',
                  fontSize: 10, fontWeight: 600, color: '#9ca3af',
                  fontFamily: F, cursor: 'not-allowed',
                }}>Select all</button>
              </Tooltip>
              <Tooltip label="Coming in Phase 3A" placement="bottom">
                <button disabled style={{
                  flex: 1, padding: '5px 8px', borderRadius: 6,
                  border: '1px solid #e5e7eb', background: '#fafafa',
                  fontSize: 10, fontWeight: 600, color: '#9ca3af',
                  fontFamily: F, cursor: 'not-allowed',
                }}>Clear</button>
              </Tooltip>
            </div>

            <p style={panelBody}>
              Student audience selection will be activated in Phase 3A.
            </p>
          </div>

          {/* ── Bulk Zone 2: Message Type + Workflow form ─────────────── */}
          <div style={{ ...panelCard, flex: '0 0 280px', minWidth: 240 }}>
            <div style={panelTitle}>Message Type</div>
            <div style={panelSubtitle}>Bulk workflow</div>

            {/* Bulk message type selector */}
            <div style={{ marginBottom: 16 }}>
              {[
                { key: 'survey_invitation', label: 'Survey Invitation', badge: '3A' },
                { key: null, label: 'Announcement / Broadcast', badge: 'Future' },
                { key: null, label: 'Coordinator Update',       badge: 'Future' },
                { key: null, label: 'Reminder',                 badge: 'Future' },
                { key: null, label: 'NGRP Update',             badge: 'Future' },
                { key: null, label: 'Preceptor Communication',  badge: 'Future' },
                { key: null, label: 'Check-In',                 badge: 'Future' },
              ].map(({ key, label, badge }) =>
                key ? (
                  <button key={label} onClick={() => setBulkMsgType(key)} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '7px 10px',
                    border: bulkMsgType === key ? '1.5px solid #1D2567' : '1.5px solid #e5e7eb',
                    borderRadius: 7, background: bulkMsgType === key ? '#EEF2FB' : '#fff',
                    cursor: 'pointer', marginBottom: 4,
                    fontSize: 12, fontWeight: bulkMsgType === key ? 700 : 500,
                    color: bulkMsgType === key ? '#1D2567' : '#374151',
                    fontFamily: F, textAlign: 'left', transition: 'all 0.1s',
                  }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: bulkMsgType === key ? '#1D2567' : 'transparent',
                      border: bulkMsgType === key ? '2px solid #1D2567' : '2px solid #d1d5db',
                    }} />
                    {label}
                    <span style={{ ...futureBadge, marginLeft: 'auto', background: '#EEF2FB', color: '#1D2567', border: '1px solid #c3cdf0' }}>{badge}</span>
                  </button>
                ) : (
                  <Tooltip key={label} label="Coming in a future release" placement="right">
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '6px 10px',
                      border: '1.5px solid #f3f4f6', borderRadius: 7,
                      background: '#fafafa', cursor: 'not-allowed',
                      marginBottom: 4, opacity: 0.5,
                    }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: 'transparent', border: '2px solid #d1d5db' }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#9ca3af', fontFamily: F }}>{label}</span>
                      <span style={{ ...futureBadge, marginLeft: 'auto' }}>{badge}</span>
                    </div>
                  </Tooltip>
                )
              )}
            </div>

            {/* Survey Invitation bulk workflow — scaffold, local state only */}
            {bulkMsgType === 'survey_invitation' && (
              <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 14 }}>
                <div style={{ ...fieldWrap }}>
                  <label style={labelStyle}>Instrument</label>
                  <select value={bulkInstrument} onChange={e => setBulkInstrument(e.target.value)} style={inputBase}>
                    {INSTRUMENTS.map(i => <option key={i.slug} value={i.slug}>{i.label}</option>)}
                  </select>
                </div>
                <div style={{ ...fieldWrap }}>
                  <label style={labelStyle}>Timepoint</label>
                  <select value={bulkTimepoint} onChange={e => setBulkTimepoint(e.target.value)} style={inputBase}>
                    {TIMEPOINTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div style={{ ...fieldWrap }}>
                  <label style={labelStyle}>Expires</label>
                  <input type="date" value={bulkExpiresAt} min={minExpiresAt()}
                    onChange={e => setBulkExpiresAt(e.target.value)} style={inputBase} />
                </div>
                <div style={{ ...fieldWrap }}>
                  <label style={labelStyle}>Notes <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
                  <textarea value={bulkNotes} onChange={e => setBulkNotes(e.target.value.slice(0, 500))}
                    placeholder="Optional context for this bulk invitation."
                    rows={3} style={{ ...inputBase, resize: 'vertical', lineHeight: 1.5, minHeight: 74 }} />
                  <div style={{ fontSize: 11, color: bulkNotes.length > 480 ? '#dc2626' : '#9ca3af', textAlign: 'right', marginTop: 4, fontFamily: F }}>
                    {bulkNotes.length}/500
                  </div>
                </div>
                <div style={{ padding: '9px 11px', background: '#FBF5E8', border: '1px solid #f0c9b0', borderRadius: 8, fontSize: 11, color: '#8B5E1A', fontFamily: F, lineHeight: 1.6 }}>
                  Workflow settings are ready. Audience selection and generation will be enabled in Phase 3A.
                </div>
              </div>
            )}
          </div>

          {/* ── Bulk Zone 3: Compose / Preview / Action ───────────────── */}
          <div style={{ flex: '1 1 280px', minWidth: 240 }}>
            <div style={panelCard}>
              {/* Header */}
              <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#191919', fontFamily: F, marginBottom: 4 }}>
                  Bulk Survey Invitation
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F, lineHeight: 1.6 }}>
                  Phase 3A will generate one unique secure link per selected student and record each assignment in the Evaluation tab.
                  Links are generated individually, not shared. No student sees another student's link.
                </div>
              </div>

              {/* What will happen */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>What Phase 3A will do</div>
                {[
                  'Validate that each selected student has an email on file',
                  'Check for existing active assignments (duplicate guard per student)',
                  'Generate one unique secure survey link per eligible student',
                  'Record each assignment in the Evaluation tab with the selected timepoint',
                  'Display a results summary with per-student success or error status',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0, fontFamily: F }}>·</span>
                    <span style={{ fontSize: 11, color: '#6b7280', fontFamily: F, lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>

              {/* Action buttons — all disabled scaffold */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <Tooltip label="Coming in Phase 3A" placement="top">
                  <button disabled style={{
                    padding: '8px 16px', background: '#e5e7eb',
                    border: 'none', borderRadius: 8,
                    fontSize: 12, fontWeight: 600, fontFamily: F,
                    color: '#9ca3af', cursor: 'not-allowed',
                  }}>Review Recipients</button>
                </Tooltip>
                <Tooltip label="Coming in Phase 3A" placement="top">
                  <button disabled style={{
                    padding: '8px 16px', background: '#e5e7eb',
                    border: 'none', borderRadius: 8,
                    fontSize: 12, fontWeight: 600, fontFamily: F,
                    color: '#9ca3af', cursor: 'not-allowed',
                  }}>Generate Links</button>
                </Tooltip>
                <Tooltip label="Coming in Phase 3B" placement="top">
                  <button disabled style={{
                    padding: '8px 16px', background: '#e5e7eb',
                    border: 'none', borderRadius: 8,
                    fontSize: 12, fontWeight: 600, fontFamily: F,
                    color: '#9ca3af', cursor: 'not-allowed',
                  }}>Send via Resend</button>
                </Tooltip>
              </div>

              {/* Results placeholder */}
              <div style={{
                padding: '14px 16px',
                background: '#f9fafb', border: '1px dashed #e5e7eb',
                borderRadius: 8, fontSize: 12, color: '#9ca3af',
                fontFamily: F, lineHeight: 1.6, textAlign: 'center',
              }}>
                Generation results will appear here in Phase 3A.
              </div>
            </div>
          </div>

        </div>
      )}{/* end recipientMode === 'bulk' */}

    </div>
  )
}

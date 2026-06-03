import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Tooltip from '../ui/Tooltip'
import { downloadCSV } from '../../lib/utils'

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

// Eligible student statuses per timepoint — mirrors backend TIMEPOINT_ELIGIBILITY
const BULK_ELIGIBILITY = {
  baseline:               ['Placed', 'Active Rotation'],
  early_rotation_baseline: ['Placed', 'Active Rotation'],
  midpoint:               ['Active Rotation'],
  post_rotation:          ['Active Rotation', 'Completed'],
}

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

  // URL params — support both legacy (studentId/contactId) and new (recipientType+recipientId) formats
  const urlMode          = searchParams.get('mode')           // 'message' | 'survey' | null
  const urlRecipientType = searchParams.get('recipientType')  // 'contact' | 'student' | null
  const urlRecipientId   = searchParams.get('recipientId')    // UUID | null
  // Resolve backward-compatible student/contact IDs from either format
  const urlStudentId = urlRecipientType === 'student' ? urlRecipientId : searchParams.get('studentId')
  const urlContactId = urlRecipientType === 'contact' ? urlRecipientId : searchParams.get('contactId')

  // Router state carries display info passed by the navigating component
  const fromContact = location.state?.fromContact || null  // { id, name, email }
  const fromStudent = location.state?.fromStudent || null  // { id, name, email, school }

  // An explicit recipient is present when the URL or router state carries one.
  // Explicit routing wins over any localStorage-restored memory.
  const hasExplicitRecipient = !!(urlStudentId || urlContactId || fromStudent || fromContact)

  // Resolved IDs — explicit URL/state sources take precedence
  const contactId = fromContact?.id || urlContactId || null
  const studentId = fromStudent?.id || urlStudentId || null

  // Display info availability — router state preferred, fetched record as fallback
  const contactHasDisplayInfo = !!(fromContact?.name || fromContact?.email)
  // effectiveStudent merges router state (if present) with the fetch fallback
  // so the recipient card populates even after a page refresh or direct URL open

  // Recipient type: student URL params are checked BEFORE contact to prevent
  // a stale contact ID from shadowing an explicit student route.
  const recipientType = studentId ? 'student'
                      : contactId && contactHasDisplayInfo ? 'contact'
                      : null

  // ── Top-level recipient mode: 'single' | 'bulk' ─────────────────────────────
  // Priority: explicit URL/state recipient > localStorage > default 'single'
  const [recipientMode, setRecipientMode] = useState(() => {
    if (hasExplicitRecipient || urlMode === 'message') return 'single'
    const saved = localStorage.getItem(RECIPIENT_MODE_KEY)
    return saved === 'bulk' ? 'bulk' : 'single'
  })

  // ── Inner message type within Single Recipient ────────────────────────────
  // Priority: URL param > explicit router state > localStorage > default ──
  const [outreachMode, setOutreachMode] = useState(() => {
    if (urlMode === 'message' || urlMode === 'survey') return urlMode
    if (hasExplicitRecipient) return 'message'
    const saved = localStorage.getItem(LAST_MODE_KEY)
    return (saved === 'survey' || saved === 'message') ? saved : 'survey'
  })

  // ── Bulk Operation state ──────────────────────────────────────────────────
  const [bulkMsgType,            setBulkMsgType]            = useState('survey_invitation')
  const [bulkInstrument,         setBulkInstrument]         = useState('casey_fink_readiness_2024')
  const [bulkTimepoint,          setBulkTimepoint]          = useState('early_rotation_baseline')
  const [bulkExpiresAt,          setBulkExpiresAt]          = useState(defaultExpiresAt)
  const [bulkNotes,              setBulkNotes]              = useState('')
  // Active assignments map { student_id → { id, status } } for the selected timepoint
  const [bulkActiveAssignments,  setBulkActiveAssignments]  = useState({})
  const [bulkLoadingAssignments, setBulkLoadingAssignments] = useState(false)
  // Selection: plain array stored in state, converted to Set for membership checks
  const [bulkSelectedIds,        setBulkSelectedIds]        = useState([])
  // Filters
  const [bulkSearch,             setBulkSearch]             = useState('')
  const [bulkFilterSchool,       setBulkFilterSchool]       = useState('')
  const [bulkFilterStatus,       setBulkFilterStatus]       = useState('')
  const [bulkFilterEmail,        setBulkFilterEmail]        = useState('hide_missing')
  const [bulkFilterAssignment,   setBulkFilterAssignment]   = useState('all')
  // Generation state — surveyUrls live in bulkResults ONLY, never in storage
  const [bulkGenerating,         setBulkGenerating]         = useState(false)
  const [bulkResults,            setBulkResults]            = useState(null)
  const [bulkShowReview,         setBulkShowReview]         = useState(false)
  const [bulkReviewReady,        setBulkReviewReady]        = useState(false)
  // Per-row copy state — { assignmentId: true } for 2.5s after copy
  const [bulkCopiedIds,          setBulkCopiedIds]          = useState({})
  const bulkCopyTimers           = useRef({})
  // Per-row test send state — { assignmentId: 'sending' | 'sent' | 'error' }
  const [bulkTestSendState,      setBulkTestSendState]      = useState({})
  const [bulkTestSendMsg,        setBulkTestSendMsg]        = useState({})

  // ── Student fetch-on-demand (when router state was lost on page refresh) ────
  // When only studentId exists in URL but fromStudent has no display info,
  // fetch the student record to populate the recipient card.
  const [fetchedStudent,     setFetchedStudent]     = useState(null)
  const [studentFetchFailed, setStudentFetchFailed] = useState(false)

  // ── Direct Message send state ─────────────────────────────────────────────
  const [includeSignature,  setIncludeSignature]  = useState(true)
  const [dmConfirmOpen,     setDmConfirmOpen]      = useState(false)
  const [dmConfirmReady,    setDmConfirmReady]     = useState(false)
  const [dmSendInFlight,    setDmSendInFlight]     = useState(false)
  const [dmBodyExpanded,    setDmBodyExpanded]     = useState(false)
  const [dmSendStatus,      setDmSendStatus]       = useState(null) // null | { ok, msg }

  // ── Direct Message draft — typed key prevents contact/student UUID collisions ──
  // Stores ONLY { subject, body }. Tokens and URLs are NEVER stored.
  const draftRecipientId = studentId ? `student:${studentId}`
                         : contactId ? `contact:${contactId}`
                         : null
  const DRAFT_KEY = draftRecipientId
    ? `aspire.connect.outreach.directDraft.${draftRecipientId}`
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
      .select('id, first_name, last_name, school, school_email, personal_email, status')
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

  // ── Bulk: fetch active assignments for the selected timepoint ─────────────
  // Feeds the existing-assignment indicator in the student picker.
  // Read-only query using the anon client (same auth surface as the single-mode
  // duplicate guard that already uses evaluation_assignments client-side).
  useEffect(() => {
    if (recipientMode !== 'bulk' || !cohortId) {
      setBulkActiveAssignments({})
      return
    }
    setBulkLoadingAssignments(true)
    supabase
      .from('evaluation_assignments')
      .select('student_id, id, status')
      .eq('cohort_id', cohortId)
      .eq('timepoint', bulkTimepoint)
      .not('status', 'in', '(revoked,expired)')
      .then(({ data }) => {
        const map = {}
        ;(data || []).forEach(a => { map[a.student_id] = { id: a.id, status: a.status } })
        setBulkActiveAssignments(map)
        setBulkLoadingAssignments(false)
      })
  }, [recipientMode, cohortId, bulkTimepoint])

  // ── Bulk: clear selection + results when timepoint changes ────────────────
  useEffect(() => {
    setBulkSelectedIds([])
    setBulkResults(null)
  }, [bulkTimepoint])

  // ── Bulk: clear results when leaving Bulk mode ────────────────────────────
  // Generated survey URLs must not persist across mode switches.
  useEffect(() => {
    if (recipientMode !== 'bulk') {
      setBulkResults(null)
      setBulkShowReview(false)
    }
  }, [recipientMode])

  // ── Bulk Review modal: 2-second safety delay before confirm is enabled ────
  useEffect(() => {
    if (!bulkShowReview) { setBulkReviewReady(false); return }
    setBulkReviewReady(false)
    const t = setTimeout(() => setBulkReviewReady(true), 2000)
    return () => clearTimeout(t)
  }, [bulkShowReview])

  // ── Direct Message confirm modal: 2-second safety delay ───────────────────
  useEffect(() => {
    if (!dmConfirmOpen) { setDmConfirmReady(false); return }
    setDmConfirmReady(false)
    const t = setTimeout(() => setDmConfirmReady(true), 2000)
    return () => clearTimeout(t)
  }, [dmConfirmOpen])

  // ── Clear DM compose state on mode/recipient change ────────────────────────
  useEffect(() => {
    if (outreachMode !== 'message') {
      setDmConfirmOpen(false)
      setDmSendStatus(null)
    }
  }, [outreachMode, contactId, studentId])

  // ── Sync modes when URL recipient params change ───────────────────────────
  // OutreachView stays mounted behind display:none. useState initializers only
  // run once, so navigating here with a new URL doesn't update stale state.
  // This effect re-applies the correct mode whenever the URL recipient changes.
  useEffect(() => {
    if (urlStudentId || urlContactId) {
      setRecipientMode('single')
      setOutreachMode('message')
      // Clear any fetched student data from a previous student navigation
      setFetchedStudent(null)
      setStudentFetchFailed(false)
    }
  }, [urlStudentId, urlContactId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch student when router state is missing (URL-only navigation / refresh) ──
  useEffect(() => {
    if (!studentId || studentHasDisplayInfo || fetchedStudent?.id === studentId) return
    setFetchedStudent(null)
    setStudentFetchFailed(false)
    supabase
      .from('students')
      .select('id, first_name, last_name, personal_email, school_email, school')
      .eq('id', studentId)
      .single()
      .then(({ data }) => {
        if (data) setFetchedStudent(data)
        else setStudentFetchFailed(true)
      })
  }, [studentId, studentHasDisplayInfo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Clear compose when the active recipient changes ────────────────────────
  // Prevents showing a previous recipient's draft or status in the new context.
  // The draft-restore effect re-populates from localStorage for the new recipient.
  useEffect(() => {
    setMsgSubject('')
    setMsgBody('')
    setDmSendStatus(null)
    setDmConfirmOpen(false)
  }, [draftRecipientId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived values ────────────────────────────────────────────────────────
  // Unified student display object: prefer router state, fall back to fetched record
  const effectiveStudent = fromStudent || (fetchedStudent?.id === studentId ? fetchedStudent : null)
  const studentHasDisplayInfo = !!(effectiveStudent?.name || effectiveStudent?.email ||
    (fetchedStudent && fetchedStudent.id === studentId))

  // True when any DM recipient is loaded — enables compose fields for both contacts and students
  const dmHasAnyRecipient = !!(contactId || studentId)

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

  // ── Bulk: derived values ──────────────────────────────────────────────────
  const bulkSelectedSet    = new Set(bulkSelectedIds)
  const bulkEligible       = BULK_ELIGIBILITY[bulkTimepoint] || ['Placed', 'Active Rotation']
  const bulkSchools        = [...new Set(students.map(s => s.school).filter(Boolean))].sort()
  const bulkStatusValues   = [...new Set(students.map(s => s.status).filter(Boolean))].sort()

  const bulkFilteredStudents = students.filter(s => {
    if (bulkSearch) {
      const q = bulkSearch.toLowerCase()
      const email = (s.personal_email || s.school_email || '').toLowerCase()
      if (!`${s.first_name} ${s.last_name}`.toLowerCase().includes(q) && !email.includes(q)) return false
    }
    if (bulkFilterSchool && s.school !== bulkFilterSchool) return false
    if (bulkFilterStatus && s.status !== bulkFilterStatus) return false
    const hasEmail = !!(s.personal_email || s.school_email)
    if (bulkFilterEmail === 'only_missing'  && hasEmail)  return false
    if (bulkFilterEmail === 'hide_missing'  && !hasEmail) return false
    const hasAssignment = !!bulkActiveAssignments[s.id]
    if (bulkFilterAssignment === 'only_existing' && !hasAssignment) return false
    if (bulkFilterAssignment === 'hide_existing' && hasAssignment)  return false
    return true
  })

  // A student is checkbox-eligible if they have email AND no active assignment
  const isBulkCheckboxEligible = s =>
    !!(s.personal_email || s.school_email) && !bulkActiveAssignments[s.id]

  const bulkVisibleEligible = bulkFilteredStudents.filter(isBulkCheckboxEligible)
  const bulkHiddenSelectedCount = bulkSelectedIds.filter(
    id => !bulkFilteredStudents.some(s => s.id === id)
  ).length

  // ── Bulk: handlers ────────────────────────────────────────────────────────

  const handleBulkToggleStudent = useCallback((studentId) => {
    setBulkSelectedIds(prev =>
      prev.includes(studentId)
        ? prev.filter(id => id !== studentId)
        : [...prev, studentId]
    )
  }, [])

  const handleBulkSelectAllVisible = useCallback(() => {
    const eligibleIds = bulkVisibleEligible.map(s => s.id)
    setBulkSelectedIds(prev => {
      const existing = new Set(prev)
      eligibleIds.forEach(id => existing.add(id))
      return [...existing]
    })
  }, [bulkVisibleEligible])

  const handleBulkClearSelection = useCallback(() => {
    setBulkSelectedIds([])
  }, [])

  const handleBulkOpenReview = useCallback(() => {
    if (bulkSelectedIds.length === 0) return
    setBulkShowReview(true)
  }, [bulkSelectedIds])

  const handleBulkCloseReview = useCallback(() => {
    if (bulkGenerating) return
    setBulkShowReview(false)
  }, [bulkGenerating])

  const handleBulkGenerate = useCallback(async () => {
    if (!bulkReviewReady || bulkGenerating || bulkSelectedIds.length === 0) return
    setBulkGenerating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setBulkResults({ error: 'Session expired. Please refresh and try again.' })
        setBulkShowReview(false)
        return
      }
      const res = await fetch('/api/evaluation-bulk-invitations', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          cohortId,
          studentIds: bulkSelectedIds,
          timepoint:  bulkTimepoint,
          expiresAt:  bulkExpiresAt,
          notes:      bulkNotes.trim() || undefined,
          mode:       'generate_only',
        }),
      })
      let payload = null
      try { payload = await res.json() } catch { /* ignore */ }

      if (res.status === 401) {
        setBulkResults({ error: 'Session expired. Please refresh and try again.' })
      } else if (res.status === 403) {
        setBulkResults({ error: 'Owner or admin access required to generate links.' })
      } else if (!res.ok) {
        setBulkResults({ error: payload?.error || 'Failed to generate links. Please try again.' })
      } else {
        // Generated survey URLs live in bulkResults (React state) only.
        // They are never written to localStorage, sessionStorage, cookies, or URL params.
        setBulkResults(payload)
        setBulkShowReview(false)
        // Refresh assignment map so newly created assignments appear as "existing"
        setBulkActiveAssignments(prev => {
          const next = { ...prev }
          ;(payload.generated || []).forEach(g => {
            next[g.studentId] = { id: g.assignmentId, status: 'sent' }
          })
          return next
        })
      }
    } catch {
      setBulkResults({ error: 'Network error. Please check your connection and try again.' })
      setBulkShowReview(false)
    } finally {
      setBulkGenerating(false)
    }
  }, [bulkReviewReady, bulkGenerating, bulkSelectedIds, cohortId, bulkTimepoint, bulkExpiresAt, bulkNotes])

  const handleBulkCopyUrl = useCallback((assignmentId, url) => {
    navigator.clipboard.writeText(url).then(() => {
      setBulkCopiedIds(prev => ({ ...prev, [assignmentId]: true }))
      if (bulkCopyTimers.current[assignmentId]) clearTimeout(bulkCopyTimers.current[assignmentId])
      bulkCopyTimers.current[assignmentId] = setTimeout(() => {
        setBulkCopiedIds(prev => { const n = { ...prev }; delete n[assignmentId]; return n })
      }, 2500)
    }).catch(() => {})
  }, [])

  const handleBulkExportCSV = useCallback(() => {
    if (!bulkResults?.generated?.length) return
    const header = 'Name,Email,School,Assignment ID,Survey URL'
    const rows = bulkResults.generated.map(g => {
      const escape = v => `"${String(v || '').replace(/"/g, '""')}"`
      return [g.studentName, g.email, g.school, g.assignmentId, g.surveyUrl].map(escape).join(',')
    })
    downloadCSV([header, ...rows].join('\n'),
      `aspire-bulk-survey-${bulkTimepoint}-${new Date().toISOString().slice(0, 10)}.csv`)
  }, [bulkResults, bulkTimepoint])

  const handleBulkTestSend = useCallback(async (row) => {
    const id = row.assignmentId
    if (bulkTestSendState[id] === 'sending') return
    setBulkTestSendState(prev => ({ ...prev, [id]: 'sending' }))
    setBulkTestSendMsg(prev => { const n = { ...prev }; delete n[id]; return n })
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setBulkTestSendState(prev => ({ ...prev, [id]: 'error' }))
        setBulkTestSendMsg(prev => ({ ...prev, [id]: 'Session expired. Refresh and try again.' }))
        return
      }
      const res = await fetch('/api/evaluation-send-test-email', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          assignment_id: id,
          survey_url:    row.surveyUrl,
          student_name:  row.studentName,
          timepoint:     bulkTimepoint,
          expires_at:    bulkExpiresAt,
        }),
      })
      let payload = null
      try { payload = await res.json() } catch { /* ignore */ }
      if (res.ok && payload?.success) {
        setBulkTestSendState(prev => ({ ...prev, [id]: 'sent' }))
        setBulkTestSendMsg(prev => ({ ...prev, [id]: payload.message || 'Test email sent.' }))
      } else {
        setBulkTestSendState(prev => ({ ...prev, [id]: 'error' }))
        setBulkTestSendMsg(prev => ({ ...prev, [id]: payload?.error || 'Send failed. Try again.' }))
      }
    } catch {
      setBulkTestSendState(prev => ({ ...prev, [id]: 'error' }))
      setBulkTestSendMsg(prev => ({ ...prev, [id]: 'Network error. Check your connection.' }))
    }
  }, [bulkTestSendState, bulkTimepoint, bulkExpiresAt])

  const handleBulkClearResults = useCallback(() => {
    setBulkResults(null)
    setBulkTestSendState({})
    setBulkTestSendMsg({})
  }, [])

  const handleBulkReset = useCallback(() => {
    setBulkResults(null)
    setBulkTestSendState({})
    setBulkTestSendMsg({})
    setBulkSelectedIds([])
    setBulkSearch('')
    setBulkFilterSchool('')
    setBulkFilterStatus('')
    setBulkFilterEmail('hide_missing')
    setBulkFilterAssignment('all')
    setBulkNotes('')
    setBulkExpiresAt(defaultExpiresAt())
  }, [])

  // ── Direct Message send handler ───────────────────────────────────────────
  const handleDmSend = useCallback(async () => {
    if (!dmConfirmReady || dmSendInFlight) return
    if (!recipientType) return  // no recipient loaded
    setDmSendInFlight(true)
    setDmSendStatus(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setDmSendStatus({ ok: false, msg: 'Session expired. Please refresh and try again.' })
        setDmConfirmOpen(false)
        return
      }
      // Use unified recipient_type + recipient_id shape for both contacts and students
      const res = await fetch('/api/connect-send-direct-email', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          recipient_type:    recipientType,
          recipient_id:      recipientType === 'contact' ? contactId : studentId,
          subject:           msgSubject.trim(),
          body:              msgBody.trim(),
          body_format:       'text',
          include_signature: includeSignature,
        }),
      })
      let payload = null
      try { payload = await res.json() } catch { /* ignore */ }
      setDmConfirmOpen(false)
      if (res.ok && payload?.success) {
        setMsgSubject('')
        setMsgBody('')
        setIncludeSignature(true)
        setDmBodyExpanded(false)
        // Clear saved draft — sent content should not restore on next visit
        if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY)
        const recipientDisplayName = recipientType === 'contact' ? fromContact?.name
          : (effectiveStudent?.name || `${fetchedStudent?.first_name || ''} ${fetchedStudent?.last_name || ''}`.trim())
        setDmSendStatus({ ok: true, msg: payload.message || `Email sent to ${recipientDisplayName || 'recipient'}.` })
      } else {
        const errMsg = payload?.error || (res.status === 403 ? 'Access denied or recipient cannot receive email.' : 'Failed to send email. Please try again.')
        setDmSendStatus({ ok: false, msg: errMsg })
      }
    } catch {
      setDmConfirmOpen(false)
      setDmSendStatus({ ok: false, msg: 'Network error. Please check your connection and try again.' })
    } finally {
      setDmSendInFlight(false)
    }
  }, [dmConfirmReady, dmSendInFlight, recipientType, contactId, studentId, msgSubject, msgBody, includeSignature, fromContact, fromStudent])

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

          {/* Recipient context (Direct Message mode) — contact or student */}
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
            ) : studentId && studentHasDisplayInfo ? (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#191919', fontFamily: F, lineHeight: 1.3 }}>
                  {effectiveStudent?.name || `${fetchedStudent?.first_name || ''} ${fetchedStudent?.last_name || ''}`.trim()}
                </div>
                {(effectiveStudent?.email || fetchedStudent?.personal_email || fetchedStudent?.school_email) ? (
                  <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F, marginTop: 3, wordBreak: 'break-all' }}>
                    {effectiveStudent?.email || fetchedStudent?.personal_email || fetchedStudent?.school_email}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#dc2626', fontFamily: F, marginTop: 3 }}>No email on file</div>
                )}
                {(effectiveStudent?.school || fetchedStudent?.school) && (
                  <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, marginTop: 2 }}>{effectiveStudent?.school || fetchedStudent?.school}</div>
                )}
                <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: '#FEF3C7', color: '#92400e', border: '1px solid #fde68a',
                    fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>Student</span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0',
                    fontFamily: F, textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>1 recipient</span>
                </div>
              </div>
            ) : studentId && studentFetchFailed ? (
              <div style={{
                marginBottom: 14, padding: '9px 11px',
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 8, fontSize: 11, color: '#dc2626', fontFamily: F, lineHeight: 1.5,
              }}>
                Student context unavailable. Return to Student Profiles and click Email.
              </div>
            ) : studentId ? (
              // Fetching student display info...
              <div style={{ ...panelBody, marginBottom: 14 }}>Loading recipient…</div>
            ) : contactId ? (
              <div style={{
                marginBottom: 14, padding: '9px 11px',
                background: '#FBF5E8', border: '1px solid #f0c9b0',
                borderRadius: 8, fontSize: 11, color: '#8B5E1A', fontFamily: F, lineHeight: 1.5,
              }}>
                Contact context unavailable. Return to Contacts and click Email.
              </div>
            ) : (
              <div style={{ ...panelBody, marginBottom: 14 }}>
                Select a contact or student and click Email to compose a direct message.
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
                    <div style={{ padding: '9px 11px', background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 12, fontFamily: F, color: '#374151' }}>
                      <div style={{ fontWeight: 600, color: '#191919' }}>{fromContact.name}</div>
                      {fromContact.email && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, wordBreak: 'break-all' }}>{fromContact.email}</div>}
                    </div>
                  ) : studentId && studentHasDisplayInfo ? (
                    <div style={{ padding: '9px 11px', background: '#f9fafb', border: '1.5px solid #fde68a', borderRadius: 8, fontSize: 12, fontFamily: F, color: '#374151' }}>
                      {(() => {
                        const name  = effectiveStudent?.name || `${fetchedStudent?.first_name || ''} ${fetchedStudent?.last_name || ''}`.trim()
                        const email = effectiveStudent?.email || fetchedStudent?.personal_email || fetchedStudent?.school_email
                        const school = effectiveStudent?.school || fetchedStudent?.school
                        return (
                          <>
                            <div style={{ fontWeight: 600, color: '#191919' }}>{name}</div>
                            {email ? <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, wordBreak: 'break-all' }}>{email}</div>
                                   : <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>No email on file</div>}
                            {school && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{school}</div>}
                          </>
                        )
                      })()}
                    </div>
                  ) : (
                    <p style={panelBody}>
                      {contactId || studentId ? 'Recipient context unavailable.' : 'No recipient selected.'}
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
              {/* Subject input — enabled for any loaded recipient (contact or student) */}
              <div style={fieldWrap}>
                <label style={labelStyle}>Subject</label>
                <input
                  type="text"
                  value={msgSubject}
                  onChange={e => setMsgSubject(e.target.value)}
                  placeholder="Email subject"
                  style={inputBase}
                  disabled={!dmHasAnyRecipient}
                />
              </div>

              {/* Body textarea */}
              <div style={fieldWrap}>
                <label style={labelStyle}>Message</label>
                <textarea
                  value={msgBody}
                  onChange={e => setMsgBody(e.target.value)}
                  placeholder={
                    dmHasAnyRecipient
                      ? 'Compose your message…'
                      : 'Return to Contacts or Student Profiles and click Email to compose a direct message.'
                  }
                  rows={8}
                  style={{ ...inputBase, resize: 'vertical', lineHeight: 1.6, minHeight: 160 }}
                  disabled={!dmHasAnyRecipient}
                />
              </div>

              {/* Signature toggle */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, fontFamily: F, color: '#374151' }}>
                  <input
                    type="checkbox"
                    checked={includeSignature}
                    onChange={e => setIncludeSignature(e.target.checked)}
                    style={{ width: 14, height: 14, accentColor: '#1D2567' }}
                  />
                  Include ASPIRE Program signature
                </label>
              </div>

              {/* Action bar */}
              {(() => {
                const hasContactRecipient = !!(contactId && contactHasDisplayInfo && fromContact?.email)
                const studentEmail = effectiveStudent?.email || fetchedStudent?.personal_email || fetchedStudent?.school_email
                const hasStudentRecipient = !!(studentId && studentEmail)
                const hasRecipient = hasContactRecipient || hasStudentRecipient
                const hasSubject   = !!msgSubject.trim()
                const hasBody      = !!msgBody.trim()
                const canSend      = hasRecipient && hasSubject && hasBody

                const disabledTip = !hasRecipient && studentId && !fromStudent?.email
                                    ? 'Recipient has no email on file'
                                    : !hasRecipient ? 'Select a recipient to send'
                                    : !hasSubject   ? 'Enter a subject'
                                    : !hasBody      ? 'Enter a message body'
                                    : ''
                return (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                    <Tooltip label="Draft persistence coming soon" placement="top">
                      <button disabled style={{
                        padding: '8px 16px', background: '#e5e7eb',
                        border: 'none', borderRadius: 8,
                        fontSize: 12, fontWeight: 600, fontFamily: F,
                        color: '#9ca3af', cursor: 'not-allowed',
                      }}>Save Draft</button>
                    </Tooltip>
                    {canSend ? (
                      <button
                        onClick={() => { setDmBodyExpanded(false); setDmConfirmOpen(true) }}
                        style={{
                          padding: '8px 18px', background: '#1D2567',
                          border: 'none', borderRadius: 8,
                          fontSize: 12, fontWeight: 600, fontFamily: F,
                          color: '#fff', cursor: 'pointer', transition: 'opacity 0.12s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                      >
                        Send Email
                      </button>
                    ) : (
                      <Tooltip label={disabledTip} placement="top">
                        <button disabled style={{
                          padding: '8px 18px', background: '#e5e7eb',
                          border: 'none', borderRadius: 8,
                          fontSize: 12, fontWeight: 600, fontFamily: F,
                          color: '#9ca3af', cursor: 'not-allowed',
                        }}>Send Email</button>
                      </Tooltip>
                    )}
                  </div>
                )
              })()}

              {/* Inline send status feedback */}
              {dmSendStatus && (
                <div style={{
                  padding: '8px 12px', borderRadius: 8, marginBottom: 12,
                  background: dmSendStatus.ok ? '#EEF7F0' : '#fef2f2',
                  border: `1px solid ${dmSendStatus.ok ? '#c6d9a8' : '#fecaca'}`,
                  fontSize: 12, fontFamily: F,
                  color: dmSendStatus.ok ? '#2F7D5C' : '#dc2626',
                }}>
                  {dmSendStatus.msg}
                </div>
              )}

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
          BULK OPERATION MODE — Phase 3A active
          Calls /api/evaluation-bulk-invitations for generate_only.
          No email. No Resend. Generated surveyUrls live in React state only.
      ═══════════════════════════════════════════════════════════════════ */}
      {recipientMode === 'bulk' && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>

          {/* ── Bulk Zone 1: Student Audience Picker ─────────────────── */}
          <div style={{ ...panelCard, flex: '0 0 340px', minWidth: 280, maxHeight: 'calc(100dvh - 280px)', overflowY: 'auto' }}>
            <div style={panelTitle}>Audience</div>
            <div style={panelSubtitle}>
              {loadingStudents ? 'Loading students…' : `${students.length} students in cohort`}
            </div>

            {/* Selection summary */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 11px', marginBottom: 12,
              background: bulkSelectedIds.length > 0 ? '#EEF2FB' : '#f9fafb',
              border: `1px solid ${bulkSelectedIds.length > 0 ? '#c3cdf0' : '#e5e7eb'}`,
              borderRadius: 8,
            }}>
              <span style={{ fontSize: 12, fontFamily: F, color: '#374151' }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: '#1D2567' }}>{bulkSelectedIds.length}</span>
                <span style={{ marginLeft: 5, color: '#6b7280' }}>selected</span>
                {bulkHiddenSelectedCount > 0 && (
                  <span style={{ marginLeft: 6, fontSize: 10, color: '#9ca3af' }}>
                    ({bulkHiddenSelectedCount} hidden by filter)
                  </span>
                )}
              </span>
              <div style={{ display: 'flex', gap: 5 }}>
                {bulkVisibleEligible.length > 0 && (
                  <button onClick={handleBulkSelectAllVisible} style={{
                    padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                    border: `1px solid #1D2567`, background: '#fff', color: '#1D2567',
                    fontFamily: F, cursor: 'pointer',
                  }}>Select all eligible</button>
                )}
                {bulkSelectedIds.length > 0 && (
                  <button onClick={handleBulkClearSelection} style={{
                    padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                    border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280',
                    fontFamily: F, cursor: 'pointer',
                  }}>Clear</button>
                )}
              </div>
            </div>

            {/* Filters */}
            <div style={{ marginBottom: 10 }}>
              {/* Search */}
              <input
                value={bulkSearch} onChange={e => setBulkSearch(e.target.value)}
                placeholder="Search name or email…"
                style={{ ...inputBase, fontSize: 12, padding: '7px 10px', marginBottom: 6 }}
              />
              {/* School filter */}
              {bulkSchools.length > 1 && (
                <select value={bulkFilterSchool} onChange={e => setBulkFilterSchool(e.target.value)}
                  style={{ ...inputBase, fontSize: 11, padding: '5px 8px', marginBottom: 6 }}>
                  <option value="">All schools</option>
                  {bulkSchools.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              {/* Status filter */}
              <select value={bulkFilterStatus} onChange={e => setBulkFilterStatus(e.target.value)}
                style={{ ...inputBase, fontSize: 11, padding: '5px 8px', marginBottom: 6 }}>
                <option value="">All statuses</option>
                {bulkStatusValues.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6 }}>
                {/* Email filter */}
                <select value={bulkFilterEmail} onChange={e => setBulkFilterEmail(e.target.value)}
                  style={{ ...inputBase, flex: 1, fontSize: 10, padding: '4px 6px' }}>
                  <option value="all">Email: all</option>
                  <option value="hide_missing">Hide missing email</option>
                  <option value="only_missing">Only missing email</option>
                </select>
                {/* Assignment filter */}
                <select value={bulkFilterAssignment} onChange={e => setBulkFilterAssignment(e.target.value)}
                  style={{ ...inputBase, flex: 1, fontSize: 10, padding: '4px 6px' }}>
                  <option value="all">Assignment: all</option>
                  <option value="hide_existing">Hide existing</option>
                  <option value="only_existing">Only existing</option>
                </select>
              </div>
            </div>

            {/* Eligibility note */}
            <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginBottom: 8, lineHeight: 1.5 }}>
              Eligible for {TIMEPOINTS.find(t => t.value === bulkTimepoint)?.label || bulkTimepoint}:{' '}
              <strong style={{ color: '#6b7280' }}>{bulkEligible.join(', ')}</strong>
            </div>

            {/* Student rows */}
            {loadingStudents ? (
              <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af', fontFamily: F }}>
                Loading students…
              </div>
            ) : bulkFilteredStudents.length === 0 ? (
              <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af', fontFamily: F }}>
                No students match the current filters.
              </div>
            ) : (
              <div>
                {bulkFilteredStudents.map(s => {
                  const email       = s.personal_email || s.school_email || null
                  const hasEmail    = !!email
                  const hasAssign   = !!bulkActiveAssignments[s.id]
                  const eligible    = hasEmail && !hasAssign
                  const isSelected  = bulkSelectedSet.has(s.id)
                  return (
                    <div key={s.id} onClick={() => eligible && handleBulkToggleStudent(s.id)} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '7px 6px', borderRadius: 6, marginBottom: 3,
                      background: isSelected ? '#EEF2FB' : 'transparent',
                      cursor: eligible ? 'pointer' : 'default',
                      opacity: eligible ? 1 : 0.55,
                    }}>
                      <input
                        type="checkbox" checked={isSelected} readOnly
                        disabled={!eligible}
                        style={{ marginTop: 2, flexShrink: 0, accentColor: '#1D2567' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#191919', fontFamily: F,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.last_name}, {s.first_name}
                        </div>
                        <div style={{ fontSize: 10, color: '#6b7280', fontFamily: F, marginTop: 1,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {email || <span style={{ color: '#dc2626' }}>No email on file</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                          {s.school && <span style={{ fontSize: 9, color: '#9ca3af', fontFamily: F }}>{s.school}</span>}
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                            background: '#f3f4f6', color: '#6b7280', fontFamily: F,
                          }}>{s.status}</span>
                          {!hasEmail && <span style={{
                            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                            background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', fontFamily: F,
                          }}>No email</span>}
                          {hasAssign && <span style={{
                            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                            background: '#FBF5E8', color: '#8B5E1A', border: '1px solid #f0c9b0', fontFamily: F,
                          }}>Has active assignment</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {bulkLoadingAssignments && (
                  <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, textAlign: 'center', paddingTop: 6 }}>
                    Loading assignment indicators…
                  </div>
                )}
                <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 8, textAlign: 'center' }}>
                  {bulkFilteredStudents.length} shown · {bulkVisibleEligible.length} eligible
                </div>
              </div>
            )}
          </div>

          {/* ── Bulk Zone 2: Message Type + Workflow ──────────────────── */}
          <div style={{ ...panelCard, flex: '0 0 280px', minWidth: 240 }}>
            <div style={panelTitle}>Message Type</div>
            <div style={panelSubtitle}>Bulk workflow</div>

            {/* Bulk message type selector */}
            <div style={{ marginBottom: 16 }}>
              {[
                { key: 'survey_invitation', label: 'Survey Invitation' },
                { key: null, label: 'Announcement / Broadcast' },
                { key: null, label: 'Coordinator Update' },
                { key: null, label: 'Reminder' },
                { key: null, label: 'NGRP Update' },
                { key: null, label: 'Preceptor Communication' },
                { key: null, label: 'Check-In' },
              ].map(({ key, label }) =>
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
                      <span style={{ ...futureBadge, marginLeft: 'auto' }}>Future</span>
                    </div>
                  </Tooltip>
                )
              )}
            </div>

            {/* Survey Invitation workflow settings */}
            {bulkMsgType === 'survey_invitation' && (
              <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 14 }}>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Instrument</label>
                  <div style={{ ...inputBase, background: '#f9fafb', color: '#6b7280', fontSize: 12 }}>
                    {INSTRUMENTS.find(i => i.slug === bulkInstrument)?.label || bulkInstrument}
                  </div>
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>
                    Timepoint <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
                  </label>
                  <select value={bulkTimepoint} onChange={e => setBulkTimepoint(e.target.value)} style={inputBase}>
                    {TIMEPOINTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 4, lineHeight: 1.5 }}>
                    Eligible: {(BULK_ELIGIBILITY[bulkTimepoint] || []).join(', ')}
                  </div>
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>
                    Expires <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
                  </label>
                  <input type="date" value={bulkExpiresAt} min={minExpiresAt()}
                    onChange={e => setBulkExpiresAt(e.target.value)} style={inputBase} />
                </div>
                <div style={fieldWrap}>
                  <label style={labelStyle}>Notes <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
                  <textarea value={bulkNotes} onChange={e => setBulkNotes(e.target.value.slice(0, 500))}
                    placeholder="Optional context for this bulk invitation."
                    rows={3} style={{ ...inputBase, resize: 'vertical', lineHeight: 1.5, minHeight: 74 }} />
                  <div style={{ fontSize: 11, color: bulkNotes.length > 480 ? '#dc2626' : '#9ca3af', textAlign: 'right', marginTop: 4, fontFamily: F }}>
                    {bulkNotes.length}/500
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Bulk Zone 3: Preview / Action / Results ───────────────── */}
          <div style={{ flex: '1 1 300px', minWidth: 260 }}>

            {/* Pre-generation summary */}
            {!bulkResults && (
              <div style={panelCard}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#191919', fontFamily: F, marginBottom: 6 }}>
                  Bulk Survey Invitation
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F, lineHeight: 1.6, marginBottom: 16 }}>
                  {INSTRUMENTS.find(i => i.slug === bulkInstrument)?.label}<br />
                  {TIMEPOINTS.find(t => t.value === bulkTimepoint)?.label} · Expires {fmtDate(bulkExpiresAt)}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
                  padding: '10px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: '#1D2567', fontFamily: F }}>
                    {bulkSelectedIds.length}
                  </span>
                  <span style={{ fontSize: 12, color: '#6b7280', fontFamily: F }}>
                    {bulkSelectedIds.length === 1 ? 'student selected' : 'students selected'}
                  </span>
                </div>

                {bulkSelectedIds.length > 0 && (
                  <div style={{
                    padding: '9px 12px', marginBottom: 16,
                    background: '#FBF5E8', border: '1px solid #f0c9b0',
                    borderRadius: 8, fontSize: 11, color: '#8B5E1A', fontFamily: F, lineHeight: 1.6,
                  }}>
                    Each selected student will receive a unique secure survey link. Links are shown once and are not stored after this session.
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {bulkSelectedIds.length === 0 ? (
                    <Tooltip label="Select at least one student to generate links" placement="top">
                      <button disabled style={{
                        padding: '9px 20px', background: '#e5e7eb',
                        border: 'none', borderRadius: 8,
                        fontSize: 13, fontWeight: 600, fontFamily: F,
                        color: '#9ca3af', cursor: 'not-allowed',
                      }}>Generate Links</button>
                    </Tooltip>
                  ) : (
                    <button onClick={handleBulkOpenReview} style={{
                      padding: '9px 20px', background: '#1D2567',
                      border: 'none', borderRadius: 8,
                      fontSize: 13, fontWeight: 600, fontFamily: F,
                      color: '#fff', cursor: 'pointer', transition: 'opacity 0.12s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                    >
                      Generate {bulkSelectedIds.length} {bulkSelectedIds.length === 1 ? 'Link' : 'Links'}
                    </button>
                  )}
                  <Tooltip label="Coming in Phase 3B" placement="top">
                    <button disabled style={{
                      padding: '9px 16px', background: '#e5e7eb',
                      border: 'none', borderRadius: 8,
                      fontSize: 12, fontWeight: 600, fontFamily: F,
                      color: '#9ca3af', cursor: 'not-allowed',
                    }}>Send via Resend</button>
                  </Tooltip>
                </div>
              </div>
            )}

            {/* Results */}
            {bulkResults && (
              <div>
                {/* Error state */}
                {bulkResults.error && (
                  <div style={{ ...panelCard, padding: '14px 16px',
                    background: '#fef2f2', border: '1px solid #fecaca' }}>
                    <div style={{ fontSize: 12, color: '#dc2626', fontFamily: F, lineHeight: 1.6, marginBottom: 12 }}>
                      {bulkResults.error}
                    </div>
                    <button onClick={handleBulkClearResults} style={{
                      padding: '7px 14px', borderRadius: 7, border: '1px solid #fecaca',
                      background: '#fff', fontSize: 11, fontWeight: 600,
                      color: '#dc2626', fontFamily: F, cursor: 'pointer',
                    }}>Try again</button>
                  </div>
                )}

                {/* Success results */}
                {!bulkResults.error && (
                  <div>
                    {/* One-time warning banner */}
                    <div style={{
                      padding: '10px 14px', marginBottom: 12,
                      background: '#FBF5E8', border: '1px solid #f0c9b0',
                      borderRadius: 8, fontSize: 11, color: '#8B5E1A',
                      fontFamily: F, lineHeight: 1.6,
                    }}>
                      Survey links are shown only in this session. Copy any URLs you need now. Raw URLs are not stored by the app.
                    </div>

                    {/* Summary counts */}
                    <div style={{ ...panelCard, marginBottom: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                        {[
                          { label: 'Generated',  value: bulkResults.createdCount,              color: '#2F7D5C', bg: '#EEF7F0' },
                          { label: 'Duplicates', value: bulkResults.skippedDuplicateCount,     color: '#8B5E1A', bg: '#FBF5E8' },
                          { label: 'Skipped',    value: (bulkResults.skippedMissingEmailCount || 0) + (bulkResults.skippedInvalidStatusCount || 0), color: '#6b7280', bg: '#f9fafb' },
                        ].map(({ label, value, color, bg }) => (
                          <div key={label} style={{ textAlign: 'center', padding: '8px 6px', background: bg, borderRadius: 8 }}>
                            <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: F }}>{value}</div>
                            <div style={{ fontSize: 10, color, fontFamily: F }}>{label}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {bulkResults.generated?.length > 0 && (
                          <button onClick={handleBulkExportCSV} style={{
                            padding: '7px 14px', borderRadius: 7, border: `1px solid #1D2567`,
                            background: '#fff', fontSize: 11, fontWeight: 600,
                            color: '#1D2567', fontFamily: F, cursor: 'pointer',
                          }}>↓ Export CSV</button>
                        )}
                        <button onClick={handleBulkClearResults} style={{
                          padding: '7px 14px', borderRadius: 7, border: '1px solid #e5e7eb',
                          background: '#fff', fontSize: 11, fontWeight: 600,
                          color: '#374151', fontFamily: F, cursor: 'pointer',
                        }}>Generate more</button>
                        <button onClick={handleBulkReset} style={{
                          padding: '7px 14px', borderRadius: 7, border: '1px solid #e5e7eb',
                          background: '#f9fafb', fontSize: 11, fontWeight: 600,
                          color: '#6b7280', fontFamily: F, cursor: 'pointer',
                        }}>Clear and reset</button>
                      </div>
                    </div>

                    {/* Generated links */}
                    {bulkResults.generated?.length > 0 && (
                      <div style={{ ...panelCard, marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#2F7D5C', fontFamily: F, marginBottom: 10 }}>
                          ✓ {bulkResults.generated.length} link{bulkResults.generated.length !== 1 ? 's' : ''} generated
                        </div>
                        {bulkResults.generated.map(g => (
                          <div key={g.assignmentId} style={{
                            padding: '8px 10px', marginBottom: 6,
                            background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8,
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#191919', fontFamily: F }}>{g.studentName}</div>
                                <div style={{ fontSize: 10, color: '#6b7280', fontFamily: F }}>{g.email} · {g.school}</div>
                                <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 2 }}>ID: {g.assignmentId}</div>
                              </div>
                              <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexDirection: 'column', alignItems: 'flex-end' }}>
                                <div style={{ display: 'flex', gap: 5 }}>
                                  <button onClick={() => handleBulkCopyUrl(g.assignmentId, g.surveyUrl)} style={{
                                    padding: '4px 10px', borderRadius: 6,
                                    background: bulkCopiedIds[g.assignmentId] ? '#EEF7F0' : '#fff',
                                    border: `1px solid ${bulkCopiedIds[g.assignmentId] ? '#c6d9a8' : '#e5e7eb'}`,
                                    fontSize: 10, fontWeight: 600,
                                    color: bulkCopiedIds[g.assignmentId] ? '#2F7D5C' : '#374151',
                                    fontFamily: F, cursor: 'pointer',
                                  }}>
                                    {bulkCopiedIds[g.assignmentId] ? '✓ Copied' : 'Copy URL'}
                                  </button>
                                  <Tooltip label="Send a test email to yourself with this row's survey link" placement="top">
                                    <button
                                      onClick={() => handleBulkTestSend(g)}
                                      disabled={bulkTestSendState[g.assignmentId] === 'sending'}
                                      style={{
                                        padding: '4px 10px', borderRadius: 6,
                                        background: bulkTestSendState[g.assignmentId] === 'sent'
                                          ? '#EEF2FB'
                                          : bulkTestSendState[g.assignmentId] === 'error'
                                          ? '#fef2f2'
                                          : '#fff',
                                        border: `1px solid ${
                                          bulkTestSendState[g.assignmentId] === 'sent' ? '#c3cdf0'
                                          : bulkTestSendState[g.assignmentId] === 'error' ? '#fecaca'
                                          : '#e5e7eb'
                                        }`,
                                        fontSize: 10, fontWeight: 600,
                                        color: bulkTestSendState[g.assignmentId] === 'sent'
                                          ? '#1D2567'
                                          : bulkTestSendState[g.assignmentId] === 'error'
                                          ? '#dc2626'
                                          : '#374151',
                                        fontFamily: F,
                                        cursor: bulkTestSendState[g.assignmentId] === 'sending' ? 'not-allowed' : 'pointer',
                                      }}
                                    >
                                      {bulkTestSendState[g.assignmentId] === 'sending' ? '↑ Sending…'
                                       : bulkTestSendState[g.assignmentId] === 'sent'   ? '✓ Test sent'
                                       : bulkTestSendState[g.assignmentId] === 'error'  ? '✗ Failed'
                                       : '↑ Send test'}
                                    </button>
                                  </Tooltip>
                                </div>
                                {/* Inline feedback for test send result */}
                                {bulkTestSendMsg[g.assignmentId] && (
                                  <div style={{
                                    fontSize: 9, fontFamily: F, lineHeight: 1.3, textAlign: 'right', maxWidth: 180,
                                    color: bulkTestSendState[g.assignmentId] === 'error' ? '#dc2626' : '#6b7280',
                                  }}>
                                    {bulkTestSendMsg[g.assignmentId]}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Skipped duplicates */}
                    {bulkResults.skippedDuplicates?.length > 0 && (
                      <div style={{ ...panelCard, marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#8B5E1A', fontFamily: F, marginBottom: 8 }}>
                          {bulkResults.skippedDuplicates.length} skipped — active assignment exists
                        </div>
                        {bulkResults.skippedDuplicates.map(d => (
                          <div key={d.existingAssignmentId} style={{ fontSize: 11, color: '#6b7280', fontFamily: F, marginBottom: 4 }}>
                            {d.studentName} · existing ID: {d.existingAssignmentId} ({d.existingStatus})
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Skipped missing email */}
                    {bulkResults.skippedMissingEmails?.length > 0 && (
                      <div style={{ ...panelCard, marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', fontFamily: F, marginBottom: 8 }}>
                          {bulkResults.skippedMissingEmails.length} skipped — no email on file
                        </div>
                        {bulkResults.skippedMissingEmails.map(m => (
                          <div key={m.studentId} style={{ fontSize: 11, color: '#6b7280', fontFamily: F, marginBottom: 2 }}>
                            {m.studentName}{m.school ? ` · ${m.school}` : ''} — update student record to include.
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Skipped invalid status */}
                    {bulkResults.skippedInvalidStatus?.length > 0 && (
                      <div style={{ ...panelCard, marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', fontFamily: F, marginBottom: 8 }}>
                          {bulkResults.skippedInvalidStatus.length} skipped — status not eligible for this timepoint
                        </div>
                        {bulkResults.skippedInvalidStatus.map(si => (
                          <div key={si.studentId} style={{ fontSize: 11, color: '#6b7280', fontFamily: F, marginBottom: 2 }}>
                            {si.studentName} · current status: {si.status}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Failed */}
                    {bulkResults.failed?.length > 0 && (
                      <div style={{ ...panelCard, background: '#fef2f2', border: '1px solid #fecaca' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', fontFamily: F, marginBottom: 8 }}>
                          {bulkResults.failed.length} failed
                        </div>
                        {bulkResults.failed.map(f => (
                          <div key={f.studentId} style={{ fontSize: 11, color: '#dc2626', fontFamily: F, marginBottom: 2 }}>
                            {f.studentName} — {f.reason}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}{/* end recipientMode === 'bulk' */}

      {/* ── Review Recipients Modal ───────────────────────────────────────── */}
      {bulkShowReview && (
        <div onClick={handleBulkCloseReview} style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 12,
            padding: '28px 32px', maxWidth: 560, width: '90vw',
            maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
            fontFamily: F, boxSizing: 'border-box',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1D2567', fontFamily: F }}>
                Review Recipients
              </h2>
              <button onClick={handleBulkCloseReview} disabled={bulkGenerating} style={{
                background: 'none', border: 'none', cursor: bulkGenerating ? 'not-allowed' : 'pointer',
                fontSize: 20, color: '#9ca3af', lineHeight: 1, padding: '2px 6px',
              }}>×</button>
            </div>

            {/* Summary */}
            <div style={{
              padding: '10px 14px', marginBottom: 16,
              background: '#EEF2FB', borderRadius: 8,
              fontSize: 12, color: '#1D2567', fontFamily: F, lineHeight: 1.6,
            }}>
              You are about to generate <strong>{bulkSelectedIds.length}</strong> survey link{bulkSelectedIds.length !== 1 ? 's' : ''} for{' '}
              <strong>Casey-Fink · {TIMEPOINTS.find(t => t.value === bulkTimepoint)?.label || bulkTimepoint}</strong>.
              Links are one-time and will be shown once in the results panel.
            </div>

            {/* Student list */}
            <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 16, border: '1px solid #f3f4f6', borderRadius: 8 }}>
              {students.filter(s => bulkSelectedSet.has(s.id)).map((s, i) => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  borderBottom: i < bulkSelectedIds.length - 1 ? '1px solid #f9fafb' : 'none',
                  fontSize: 12, fontFamily: F, color: '#374151',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#191919' }}>
                      {s.last_name}, {s.first_name}
                    </div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>
                      {s.personal_email || s.school_email} · {s.school} · {s.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Safety delay note */}
            {!bulkReviewReady && (
              <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, marginBottom: 10, textAlign: 'center' }}>
                Please review the list above before confirming…
              </div>
            )}

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={handleBulkCloseReview} disabled={bulkGenerating} style={{
                padding: '8px 18px', borderRadius: 8,
                border: '1px solid #e5e7eb', background: '#fff',
                fontSize: 12, fontWeight: 600, fontFamily: F,
                color: '#374151', cursor: bulkGenerating ? 'not-allowed' : 'pointer',
              }}>Cancel</button>
              <button
                type="button"
                onClick={handleBulkGenerate}
                disabled={!bulkReviewReady || bulkGenerating}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: 'none',
                  background: (!bulkReviewReady || bulkGenerating) ? '#e5e7eb' : '#1D2567',
                  fontSize: 12, fontWeight: 600, fontFamily: F,
                  color: (!bulkReviewReady || bulkGenerating) ? '#9ca3af' : '#fff',
                  cursor: (!bulkReviewReady || bulkGenerating) ? 'not-allowed' : 'pointer',
                  transition: 'background 0.12s',
                }}
              >
                {bulkGenerating ? 'Generating…' : `Generate ${bulkSelectedIds.length} link${bulkSelectedIds.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Direct Message confirmation modal ─────────────────────────────── */}
      {dmConfirmOpen && (
        <div onClick={() => { if (!dmSendInFlight) setDmConfirmOpen(false) }} style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 12,
            padding: '28px 32px', maxWidth: 520, width: '90vw',
            maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
            fontFamily: F, boxSizing: 'border-box',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1D2567', fontFamily: F }}>
                Send direct email
              </h2>
              <button onClick={() => { if (!dmSendInFlight) setDmConfirmOpen(false) }}
                disabled={dmSendInFlight}
                style={{ background: 'none', border: 'none', cursor: dmSendInFlight ? 'not-allowed' : 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1, padding: '2px 6px' }}>×</button>
            </div>

            {/* Recipient + metadata */}
            <div style={{ padding: '10px 14px', marginBottom: 14, background: '#EEF2FB', border: '1px solid #c3cdf0', borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1D2567', fontFamily: F }}>
                {fromContact?.name || contactId}
              </div>
              {fromContact?.email && (
                <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F, marginTop: 2 }}>{fromContact.email}</div>
              )}
              {fromContact?.role && (
                <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, marginTop: 2 }}>{fromContact.role}</div>
              )}
            </div>

            {/* Subject */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: F, marginBottom: 4 }}>Subject</div>
              <div style={{ fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.5 }}>{msgSubject}</div>
            </div>

            {/* Body preview */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: F, marginBottom: 4 }}>Message</div>
              <div style={{ fontSize: 12, color: '#374151', fontFamily: F, lineHeight: 1.6, whiteSpace: 'pre-wrap', background: '#f9fafb', padding: '10px 12px', borderRadius: 6, border: '1px solid #e5e7eb', maxHeight: dmBodyExpanded ? 320 : 80, overflowY: dmBodyExpanded ? 'auto' : 'hidden' }}>
                {msgBody}
              </div>
              {msgBody.length > 200 && (
                <button onClick={() => setDmBodyExpanded(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#6b7280', fontFamily: F, padding: '4px 0', marginTop: 2 }}>
                  {dmBodyExpanded ? 'Collapse' : 'Show full message'}
                </button>
              )}
            </div>

            {/* Signature indicator */}
            <div style={{ marginBottom: 16, fontSize: 11, color: '#9ca3af', fontFamily: F }}>
              ASPIRE Program signature: <strong style={{ color: '#374151' }}>{includeSignature ? 'included' : 'omitted'}</strong>
            </div>

            {/* Safety delay note */}
            {!dmConfirmReady && (
              <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, marginBottom: 10, textAlign: 'center' }}>
                Please review the details above before sending…
              </div>
            )}

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => { if (!dmSendInFlight) setDmConfirmOpen(false) }}
                disabled={dmSendInFlight}
                style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, fontWeight: 600, fontFamily: F, color: '#374151', cursor: dmSendInFlight ? 'not-allowed' : 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={handleDmSend}
                disabled={!dmConfirmReady || dmSendInFlight}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: 'none',
                  background: (!dmConfirmReady || dmSendInFlight) ? '#e5e7eb' : '#1D2567',
                  fontSize: 12, fontWeight: 600, fontFamily: F,
                  color: (!dmConfirmReady || dmSendInFlight) ? '#9ca3af' : '#fff',
                  cursor: (!dmConfirmReady || dmSendInFlight) ? 'not-allowed' : 'pointer',
                  transition: 'background 0.12s',
                }}>
                {dmSendInFlight ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useLocation, useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Tooltip from '../ui/Tooltip'
import { downloadCSV } from '../../lib/utils'
import RecipientProfileCard from './RecipientProfileCard'
import RecipientPicker from './RecipientPicker'
import SentHistory from './SentHistory'
import ContactAutocomplete from './ContactAutocomplete'
import BulkManualComposer from './BulkManualComposer'
import RichTextEditor from './RichTextEditor'
import { isRichComposeEnabled, plainTextToHtml, htmlToPlainText } from '../../lib/connect/richCompose'
import ConnectPanel from './ConnectPanel'
import { isValidEmail, resolveStudentCorrespondenceRecipient } from '../../lib/notifications/studentRecipient'
import { normalizeEmailForLookup } from '../../lib/emailUtils'
import { useAuth } from '../../contexts/AuthContext'
import {
  buildPreceptorAssignmentDraft, buildAcademicPartnerUpdateDraft,
  buildPreceptorDetailsRequestDraft, buildUnitLeaderSupportRequestDraft,
  buildInterviewerAvailabilityRequestDraft,
} from '../../lib/outreachTemplates'
import {
  SEND_TO_ONE_TEMPLATES, SEND_TO_MANY_TEMPLATES,
  splitTemplatesForAudience, getPrimarySectionTitle, audienceForContact, AUDIENCES,
} from '../../lib/connect/templateRegistry'
import { EMAIL_SOURCE_OPTIONS, studentHasEmailSource, studentEmailForSource, emailTypeLabel } from '../../lib/studentBulkEmail'
import { getStudentPreferredFirstName, getStudentPreferredGreetingName } from '../../lib/studentNameFormatters'
import { buildStudentInvitationEmail, formatExpiresAt, TIMEPOINT_LABELS } from '../../../lib/server/evaluation/emailTemplates'

const F = 'DM Sans, sans-serif'

// Canonical default body for the editable Survey Invitation draft (Send-to-One).
// Mirrors the fixed intro paragraph the server template falls back to when no
// body_override is supplied (DEFAULT_INTRO in lib/server/evaluation/emailTemplates.js).
const SURVEY_DRAFT_DEFAULT_BODY = 'As part of ASPIRE at Cedars-Sinai, please complete the Casey-Fink Readiness for Practice Survey. This short survey helps us understand your readiness as you prepare for your clinical rotation.'

const INSTRUMENTS = [
  { slug: 'casey_fink_readiness_2024', label: 'Casey-Fink Readiness for Practice Survey' },
]

const TIMEPOINTS = [
  { value: 'baseline',                label: 'Baseline' },
  { value: 'early_rotation_baseline', label: 'Baseline' },
  { value: 'midpoint',               label: 'Mid-Rotation Check-In' },
  { value: 'post_rotation',          label: 'Post-Rotation' },
]

// Casey-Fink is sent twice: Baseline (pre-rotation start) and Post-Rotation.
// Only these two appear in the Bulk Survey Invitation UI.
// Backend validation accepts all values; historical records remain unaffected.
const BULK_CASEY_FINK_TIMEPOINTS = [
  { value: 'baseline',      label: 'Baseline' },
  { value: 'post_rotation', label: 'Post-Rotation' },
]

const LAST_MODE_KEY    = 'aspire.connect.outreach.lastMode'  // inner message type key ('message'|'survey')
const RECIPIENT_MODE_KEY = 'aspire.connect.outreach.mode'   // top-level mode key ('single'|'bulk')

// CONNECT-DRAFT-AUTOSAVE-1: versioned, TTL'd Direct Message draft autosave (browser-local).
// Per-recipient key preserves drafts across navigation; a cohort-scoped pointer lets the
// user resume the most recent draft when returning with no recipient selected.
const DRAFT_VERSION    = 1
const DRAFT_TTL_MS     = 7 * 24 * 60 * 60 * 1000 // 7 days
const DRAFT_DEBOUNCE_MS = 600
// All keys are scoped by the logged-in user so one account cannot see another's draft on a
// shared browser. token = `student:ID` | `contact:ID`. Returns null when userKey is absent
// (autosave disabled - no read/write).
const directDraftKey = (userKey, cohortId, token) =>
  (userKey && token) ? `aspire.connect.outreach.directDraft.v${DRAFT_VERSION}.${userKey}.${cohortId || 'none'}.${token}` : null
const lastDraftPointerKey = (userKey, cohortId) =>
  userKey ? `aspire.connect.outreach.lastDraftPointer.v${DRAFT_VERSION}.${userKey}.${cohortId || 'none'}` : null

// Read a stored draft (strictly versioned; no legacy migration - old unscoped drafts are
// never resurrected). Drops stale (>TTL) or invalid payloads. NOTE: uses Date.now - call
// only from effects/handlers, never during render.
function readDirectDraft(key) {
  if (!key || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || d.v !== DRAFT_VERSION) { localStorage.removeItem(key); return null }
    if (typeof d.savedAt === 'number' && Date.now() - d.savedAt > DRAFT_TTL_MS) { localStorage.removeItem(key); return null }
    return d
  } catch { try { localStorage.removeItem(key) } catch { /* ignore */ } return null }
}
function directDraftIsEmpty(d) {
  return !d || (!String(d.subject || '').trim() && !String(d.body || '').trim())
}
function readDraftPointer(userKey, cohortId) {
  const key = lastDraftPointerKey(userKey, cohortId)
  if (!key || typeof localStorage === 'undefined') return null
  try {
    const d = JSON.parse(localStorage.getItem(key) || 'null')
    if (!d || d.v !== DRAFT_VERSION || !d.id || !d.kind) return null
    if (typeof d.savedAt === 'number' && Date.now() - d.savedAt > DRAFT_TTL_MS) return null
    return d
  } catch { return null }
}

// Bulk survey send chunk size. The send endpoint caps items per request
// (a defensive guard against the Vercel function timeout), so the UI splits the
// selected recipients into chunks of this size and sends them sequentially -
// invisibly to the owner, who simply selects any group size and sends once.
// Keep aligned with the backend per-request limit.
const SEND_CHUNK_SIZE = 5
function chunkArray(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// Message type roster for Single Recipient mode - now sourced from the shared template registry
// (CONNECT-TEMPLATE-REGISTRY-1). Each entry keeps the legacy fields this view switches on:
//   kind: 'mode' = drives the composer (outreachMode radio); 'hydrate' = pre-fills the Custom Message
//   composer (editable, ASPIRE Outreach send). The registry adds audience metadata (deferred use).
// Phase-1 label change: "Direct Message" → "Custom Message" (same key 'message', same behavior).
const MSG_TYPES = SEND_TO_ONE_TEMPLATES

const FUTURE_AUDIENCES = [
  'Contact categories',
  'Saved groups',
  'School coordinators',
  'Unit leaders',
  'Students',
  'Preceptors',
]

// Eligible student statuses per timepoint - mirrors backend TIMEPOINT_ELIGIBILITY
const BULK_ELIGIBILITY = {
  baseline:               ['Placed', 'Active Rotation'],
  early_rotation_baseline: ['Placed', 'Active Rotation'],
  midpoint:               ['Active Rotation'],
  post_rotation:          ['Active Rotation', 'Completed'],
}

// Send-to-Many message types - sourced from the shared template registry
// (CONNECT-TEMPLATE-REGISTRY-1). Survey Invitation keeps its existing student-only flow; the four
// manual templates open the multi-source BulkManualComposer. Labels/behavior unchanged in Phase 1.
const BULK_MSG_TYPES = SEND_TO_MANY_TEMPLATES

// CONNECT-TEMPLATE-AUDIENCE-UX-2: keep the SELECTED template visible in the primary list even when it
// does not match the inferred audience (the active choice must never be hidden inside "Other"). The
// rest of the non-matching templates stay under the disclosure. Survey templates that the split
// already dropped (respondent mismatch) are never re-added.
function liftSelectedIntoPrimary({ primary, other }, selectedKey) {
  if (!selectedKey) return { primary, other }
  const idx = other.findIndex(t => t.key === selectedKey)
  if (idx === -1) return { primary, other }
  return { primary: [...primary, other[idx]], other: other.filter((_, i) => i !== idx) }
}

// CONNECT-TEMPLATE-AUDIENCE-UX-2: shared chrome for an audience-aware template selector - a primary
// section (audience heading + helper) plus a collapsible "Other templates" escape hatch. Each surface
// supplies its own button markup via renderItem(template) so existing visuals are untouched. When the
// audience is null (no inference yet) the caller passes the full list as `primary` with empty `other`,
// so this renders a flat list with no heading - preserving the pre-filtering look.
function TemplateGroup({ audience, helperText, primary, other, otherOpen, onToggleOther, renderItem }) {
  const title = audience ? getPrimarySectionTitle(audience) : null
  return (
    <div style={{ marginBottom: 16 }}>
      {title && (
        <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 3, fontFamily: F }}>{title}</div>
      )}
      {title && helperText && (
        <div style={{ fontSize: 10.5, color: '#9ca3af', marginBottom: 9, fontFamily: F, lineHeight: 1.5 }}>{helperText}</div>
      )}
      {primary.map(renderItem)}
      {other.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            onClick={onToggleOther}
            aria-expanded={otherOpen}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 4px',
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: F,
              fontSize: 11, fontWeight: 600, color: '#6b7280', textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 9, lineHeight: 1 }} aria-hidden="true">{otherOpen ? '▼' : '▶'}</span>
            Other templates ({other.length})
          </button>
          {otherOpen && <div style={{ marginTop: 2 }}>{other.map(renderItem)}</div>}
        </div>
      )}
    </div>
  )
}

function localDateString(d) {
  // Use local year/month/day to avoid UTC midnight rollback in Pacific timezone
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dy}`
}

function defaultExpiresAt() {
  const d = new Date()
  d.setDate(d.getDate() + 7) // 7 days default; matches email display date exactly
  return localDateString(d)
}

function minExpiresAt() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return localDateString(d)
}

function fmtDate(iso) {
  if (!iso) return '-'
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

// panelTitle / panelSubtitle now live in <ConnectPanel>'s header (panels migrated to ConnectPanel).

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

export default function OutreachView({ cohortId, toast, refreshKey = 0 }) {
  const location       = useLocation()
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()

  // URL params - support both legacy (studentId/contactId) and new (recipientType+recipientId) formats
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

  // Resolved IDs - explicit URL/state sources take precedence
  const contactId = fromContact?.id || urlContactId || null
  const studentId = fromStudent?.id || urlStudentId || null

  // Display info availability - router state preferred, fetched record as fallback
  const contactHasDisplayInfo = !!(fromContact?.name || fromContact?.email)

  // Recipient type: student URL params are checked BEFORE contact to prevent
  // a stale contact ID from shadowing an explicit student route.
  const recipientType = studentId ? 'student'
                      : contactId && contactHasDisplayInfo ? 'contact'
                      : null

  // ── Top-level recipient mode: 'single' | 'bulk' | 'history' ─────────────────
  // Priority: explicit Sent History deep link > explicit recipient > localStorage.
  const [recipientMode, setRecipientMode] = useState(() => {
    if (searchParams.get('tab') === 'sent_history') return 'history'  // Phase D.1 deep link
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
  // Pending template key awaiting the branded "Replace draft?" confirmation (null = modal closed).
  const [replaceTemplateKey, setReplaceTemplateKey] = useState(null)
  // Which hydrate template produced the current editable draft (sidebar selected-state only;
  // the composer/send path stays outreachMode='message'). null = a plain Direct Message draft.
  const [activeTemplateId, setActiveTemplateId] = useState(null)

  // ── Bulk Operation state ──────────────────────────────────────────────────
  const [bulkMsgType,            setBulkMsgType]            = useState('survey_invitation')
  const [bulkInstrument,         setBulkInstrument]         = useState('casey_fink_readiness_2024')
  const [bulkTimepoint,          setBulkTimepoint]          = useState('baseline')
  const [bulkExpiresAt,          setBulkExpiresAt]          = useState(defaultExpiresAt)
  const [bulkNotes,              setBulkNotes]              = useState('')
  // Active assignments map { student_id → { id, status } } for the selected timepoint
  const [bulkActiveAssignments,  setBulkActiveAssignments]  = useState({})
  const [bulkLoadingAssignments, setBulkLoadingAssignments] = useState(false)
  // Selection: plain array stored in state, converted to Set for membership checks
  const [bulkSelectedIds,        setBulkSelectedIds]        = useState([])
  // Filters - simplified to School / Email source / Sort (shared with manual templates).
  const [bulkSearch,             setBulkSearch]             = useState('')
  const [bulkFilterSchool,       setBulkFilterSchool]       = useState('')
  const [bulkFilterEmail,        setBulkFilterEmail]        = useState('school') // explicit email source
  const [bulkSort,               setBulkSort]               = useState('name')   // name | status
  // Generation state - surveyUrls live in bulkResults ONLY, never in storage
  const [bulkGenerating,         setBulkGenerating]         = useState(false)
  const [bulkResults,            setBulkResults]            = useState(null)
  const [bulkShowReview,         setBulkShowReview]         = useState(false)
  const [bulkReviewReady,        setBulkReviewReady]        = useState(false)
  // Per-row copy state - { assignmentId: true } for 2.5s after copy
  const [bulkCopiedIds,          setBulkCopiedIds]          = useState({})
  const bulkCopyTimers           = useRef({})
  // Per-row test send state - { assignmentId: 'sending' | 'sent' | 'error' }
  const [bulkTestSendState,      setBulkTestSendState]      = useState({})
  const [bulkTestSendMsg,        setBulkTestSendMsg]        = useState({})
  // Bulk send via Resend state (Phase 3B.2B)
  const [bulkSendConfirmOpen,    setBulkSendConfirmOpen]    = useState(false)
  const [bulkSendPhrase,         setBulkSendPhrase]         = useState('')
  const [bulkSendInFlight,       setBulkSendInFlight]       = useState(false)
  const [bulkSentIds,            setBulkSentIds]            = useState(new Set()) // assignmentIds sent this session
  const [bulkSendResults,        setBulkSendResults]        = useState(null)     // { sent, skipped, failed }

  // ── Student fetch-on-demand (when router state was lost on page refresh) ────
  // When only studentId exists in URL but fromStudent has no display info,
  // fetch the student record to populate the recipient card.
  const [fetchedStudent,     setFetchedStudent]     = useState(null)
  const [studentFetchFailed, setStudentFetchFailed] = useState(false)
  // Full contact record for the rich profile card (fromContact only has id/name/email)
  const [fetchedContact,    setFetchedContact]     = useState(null)

  // ── effectiveStudent / studentHasDisplayInfo ─────────────────────────────────
  // Declared HERE before effects that reference them to avoid TDZ in production builds.
  const effectiveStudent      = fromStudent || (fetchedStudent?.id === studentId ? fetchedStudent : null)
  const studentHasDisplayInfo = !!(effectiveStudent?.name || effectiveStudent?.email ||
    (fetchedStudent && fetchedStudent.id === studentId))

  // ── Direct Message send state ─────────────────────────────────────────────
  const [includeSignature,  setIncludeSignature]  = useState(true)
  const [dmConfirmOpen,     setDmConfirmOpen]      = useState(false)
  const [dmConfirmReady,    setDmConfirmReady]     = useState(false)
  const [dmSendInFlight,    setDmSendInFlight]     = useState(false)
  const [dmBodyExpanded,    setDmBodyExpanded]     = useState(false)
  const [dmSendStatus,      setDmSendStatus]       = useState(null) // null | { ok, msg }
  // CONNECT-COMMS-1B: true "Preview as sent" - the exact branded HTML + server-resolved recipient,
  // fetched (debounced) from the same endpoint/renderer used to send. { html, recipient, loading, error }
  const [dmPreview,         setDmPreview]          = useState({ html: '', recipient: null, cc: [], signature: null, loading: false, error: null })
  // CONNECT-COMMS-1D: CC support (Direct Message only). ccList = confirmed chips; ccInput = in-progress typing.
  // ccAutoSuggested flags that the coordinator chip was pre-filled (vs. manually added) for metadata/telemetry.
  const [ccList,            setCcList]             = useState([])
  const [ccInput,           setCcInput]            = useState('')
  const [ccInputError,      setCcInputError]       = useState(null)
  const [ccAutoSuggested,   setCcAutoSuggested]    = useState(false)

  // ── Direct Message draft - keys scoped by logged-in user + cohort + recipient ──
  // userKey: auth user id → normalized email → null. When null, autosave is DISABLED
  // (DRAFT_KEY is null), so no draft is read or written. Stores ONLY { subject, body,
  // includeSignature }. Tokens and URLs are NEVER stored.
  const { user, isOwner } = useAuth()
  // RICH-COMPOSE-1: rich editor only when the Owner has opted in (default OFF). Non-flagged users keep
  // the plain-text textarea and body_format:'text' exactly as before.
  const richEnabled = isRichComposeEnabled(isOwner)
  const userKey = user?.id || (user?.email ? normalizeEmailForLookup(user.email) : '') || null
  const draftRecipientId = studentId ? `student:${studentId}`
                         : contactId ? `contact:${contactId}`
                         : null
  const DRAFT_KEY = directDraftKey(userKey, cohortId, draftRecipientId)

  const [msgSubject, setMsgSubject] = useState('')
  const [msgBody,    setMsgBody]    = useState('')
  // Draft autosave UX state. draftStatus drives the small inline indicator;
  // resumeInfo backs the non-blocking "Resume draft" link when no recipient is selected.
  const [draftStatus, setDraftStatus] = useState(null) // 'saved' | 'restored' | 'discarded' | null
  const [resumeInfo,  setResumeInfo]  = useState(null)  // { kind, id, name, email, school } | null
  const draftTimerRef       = useRef(null)
  const draftStatusTimerRef = useRef(null)
  const draftHydratedRef    = useRef(false)
  const lastRecipientRef    = useRef(null)   // detects an actual recipient change vs. identity load
  const latestDraftRef      = useRef(null)   // latest values for the flush-on-hide/unmount writes
  // RICH-COMPOSE-2A-0: additive richDoc (TipTap JSON). When rich ON the editor updates it on edit;
  // when OFF it carries the restored draft's richDoc forward so toggling the flag never destroys it.
  const richDocRef          = useRef(null)
  const flashDraftStatus = useCallback((s) => {
    setDraftStatus(s)
    if (draftStatusTimerRef.current) clearTimeout(draftStatusTimerRef.current)
    draftStatusTimerRef.current = setTimeout(() => setDraftStatus(null), 2200)
  }, [])

  // ── Survey Invitation form state ──────────────────────────────────────────
  const [students,          setStudents]          = useState([])
  const [loadingStudents,   setLoadingStudents]   = useState(true)
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [instrument,        setInstrument]        = useState('casey_fink_readiness_2024')
  const [timepoint,         setTimepoint]         = useState('baseline')
  const [expiresAt,         setExpiresAt]         = useState(defaultExpiresAt)
  const [notes,             setNotes]             = useState('')
  // ── Editable Survey Invitation draft (single source of truth for preview + test + student send) ──
  // Initialized from the canonical Casey-Fink copy; the greeting, survey details, link, CTA, expiry,
  // and signature are added automatically and are NOT editable here.
  const [surveyDraftSubject, setSurveyDraftSubject] = useState(() => `ASPIRE: Casey-Fink Readiness Survey, ${TIMEPOINT_LABELS['baseline']}`)
  const [surveyDraftBody,    setSurveyDraftBody]    = useState(SURVEY_DRAFT_DEFAULT_BODY)
  const [surveyDraftEdited,  setSurveyDraftEdited]  = useState(false)
  const [surveyDraftTpKey,   setSurveyDraftTpKey]   = useState('baseline')
  // Keep the default subject in sync with the timepoint until the user edits the draft.
  if (surveyDraftTpKey !== timepoint) {
    setSurveyDraftTpKey(timepoint)
    if (!surveyDraftEdited) setSurveyDraftSubject(`ASPIRE: Casey-Fink Readiness Survey, ${TIMEPOINT_LABELS[timepoint] || timepoint}`)
  }
  // SURVEY-REISSUE-1: prior-invitation classification (UX assist only - server is source of truth).
  // null | 'completed' (block) | 'active' (block) | 'reissuable' (expired/revoked, incomplete → allowed)
  const [priorInvitation,   setPriorInvitation]   = useState(null)
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)

  // ── Generate Link state ───────────────────────────────────────────────────
  const [generating,    setGenerating]    = useState(false)
  const [generateError, setGenerateError] = useState(null)
  // surveyResult holds the returned payload - surveyUrl, assignmentId, expiresAt, student.
  // NEVER persisted to localStorage/sessionStorage. Cleared on form field changes.
  const [surveyResult,  setSurveyResult]  = useState(null)
  const [copied,        setCopied]        = useState(false)
  // ── Single-recipient survey result actions (Phase 3B.2D+) ────────────────
  const [singleTestSendState,   setSingleTestSendState]   = useState(null) // null|'sending'|'sent'|'error'
  const [singleTestSendMsg,     setSingleTestSendMsg]     = useState(null)
  const [singleSendConfirmOpen, setSingleSendConfirmOpen] = useState(false)
  const [singleSendPhrase,      setSingleSendPhrase]      = useState('')
  const [singleSendInFlight,    setSingleSendInFlight]    = useState(false)
  const [singleSendState,       setSingleSendState]       = useState(null) // null|'sent'|'error'
  const [singleSendMsg,         setSingleSendMsg]         = useState(null)

  // ── Recipient picker (Phase 1 - single-recipient only) ───────────────────
  // pickerOpen is the explicit "Change recipient" toggle. The picker also shows
  // implicitly as the empty state when no recipient is resolved (see showPicker
  // in render). Selecting a recipient navigates exactly like a deep link, so the
  // existing recipient/enrichment/draft pipeline is reused unchanged.
  const [pickerOpen, setPickerOpen] = useState(false)

  // CONNECT-TEMPLATE-AUDIENCE-UX-2: "Other templates" disclosure toggles (UI-only; never touch drafts
  // or send state). One for Send-to-one, one for Send-to-many.
  const [singleOtherOpen, setSingleOtherOpen] = useState(false)
  const [bulkOtherOpen,   setBulkOtherOpen]   = useState(false)

  const handlePickerSelect = useCallback((r) => {
    if (!r) return
    if (r.kind === 'contact') {
      navigate(
        `/connect/outreach?mode=message&contactId=${r.id}`,
        { state: { fromContact: { id: r.id, name: r.name, email: r.email } } },
      )
    } else {
      navigate(
        `/connect/outreach?mode=message&recipientType=student&recipientId=${r.id}`,
        { state: { fromStudent: { id: r.id, name: r.name, email: r.email, school: r.school } } },
      )
    }
    setPickerOpen(false)
  }, [navigate])

  // Cancel a "Change recipient" without picking - the previous recipient remains
  // active (we never navigated away), so its draft/compose stay intact.
  const handlePickerCancel = useCallback(() => setPickerOpen(false), [])

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
      .select('id, first_name, last_name, preferred_first_name, school, school_email, personal_email, status, school_coordinator_email, school_coordinator_name')
      .eq('cohort_id', cohortId)
      .order('last_name')
      .order('first_name')
      .then(({ data }) => {
        setStudents(data || [])
        setLoadingStudents(false)
      })
  }, [cohortId, refreshKey]) // refreshKey triggers re-fetch on Connect refresh

  // ── Prior-invitation pre-check (UX assist only; server enforces) ──────────
  // Classifies any existing assignment for the tuple so the form can show whether generation will
  // be blocked (completed / unexpired active) or allowed as a reissue (expired / revoked, no
  // completion). Mirrors the server's inlined reissue classifier in api/evaluation-create-invitation.js.
  useEffect(() => {
    if (!selectedStudentId || !timepoint || !cohortId) {
      setPriorInvitation(null)
      return
    }
    setCheckingDuplicate(true)
    supabase
      .from('evaluation_assignments')
      .select('id, status, expires_at, completed_at')
      .eq('student_id', selectedStudentId)
      .eq('cohort_id', cohortId)
      .eq('timepoint', timepoint)
      .then(({ data }) => {
        const rows  = data || []
        const nowMs = Date.now()
        const completed = rows.find(r => r.status === 'completed' || r.completed_at)
        const active    = rows.find(r =>
          !['revoked', 'expired', 'completed'].includes(r.status) &&
          !r.completed_at &&
          (!r.expires_at || new Date(r.expires_at).getTime() > nowMs)
        )
        let kind = null
        if (completed)            kind = 'completed'
        else if (active)          kind = 'active'
        else if (rows.length > 0) kind = 'reissuable'
        setPriorInvitation(kind)
        setCheckingDuplicate(false)
      })
  }, [selectedStudentId, timepoint, cohortId])

  // ── Clear generated link when form identity changes ───────────────────────
  // Raw survey URL must not persist if recipient, instrument, or timepoint changes.
  useEffect(() => {
    setSurveyResult(null)
    setGenerateError(null)
    setCopied(false)
    setSingleTestSendState(null)
    setSingleTestSendMsg(null)
    setSingleSendState(null)
    setSingleSendMsg(null)
  }, [selectedStudentId, instrument, timepoint])

  // (Direct Message draft restore is handled by the merged recipient-change effect below,
  // so a separate reset effect can never clobber the restored content.)

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
  }, [recipientMode, cohortId, bulkTimepoint, refreshKey]) // refreshKey re-fetches assignment indicators on Connect refresh

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

  // ── Sync to Sent History when the URL requests it (Phase D.1) ─────────────
  // OutreachView stays mounted, so a navigation to ?tab=sent_history while
  // already mounted must switch the sub-tab. Send-to-one / send-to-many behavior
  // is otherwise untouched.
  useEffect(() => {
    if (searchParams.get('tab') === 'sent_history') setRecipientMode('history')
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-populate the Survey Invitation dropdown from a student recipient ──
  // When the Send-to-one recipient is a student (Student Profiles → Email deep
  // link OR the Outreach picker), mirror it into selectedStudentId so switching
  // Message Type → Survey Invitation is already populated with that student.
  //
  // Keyed on the recipient identity only (studentId/contactId). A manual dropdown
  // change moves selectedStudentId but NOT the recipient, so it is preserved until
  // the recipient itself changes again. Contacts never populate the student
  // dropdown; switching to a contact recipient clears a previously-synced student
  // to avoid a stale survey target. Direct entry with no recipient leaves any
  // manual survey selection untouched.
  useEffect(() => {
    if (studentId) setSelectedStudentId(studentId)
    else if (contactId) setSelectedStudentId('')
  }, [studentId, contactId])

  // ── Fetch student when router state is missing (URL-only navigation / refresh) ──
  useEffect(() => {
    if (!studentId) { setFetchedStudent(null); setStudentFetchFailed(false); return }
    if (fetchedStudent?.id === studentId) return

    if (studentHasDisplayInfo) {
      // Display info already available from router state.
      // Lightweight headshot-only fetch so the profile card can show the student photo.
      supabase
        .from('students')
        .select('headshot_url')
        .eq('id', studentId)
        .single()
        .then(({ data }) => {
          if (data) setFetchedStudent({ id: studentId, headshot_url: data.headshot_url || null })
        })
      return
    }

    setFetchedStudent(null)
    setStudentFetchFailed(false)
    supabase
      .from('students')
      .select('id, first_name, last_name, preferred_first_name, personal_email, school_email, school, headshot_url, school_coordinator_email, school_coordinator_name')
      .eq('id', studentId)
      .single()
      .then(({ data }) => {
        if (data) setFetchedStudent(data)
        else setStudentFetchFailed(true)
      })
  }, [studentId, studentHasDisplayInfo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch full contact record for the rich profile card ──────────────────
  // fromContact only carries { id, name, email }. This fetches avatar, role,
  // category, phone, organization, and other display fields.
  useEffect(() => {
    if (!contactId) { setFetchedContact(null); return }
    if (fetchedContact?.id === contactId) return
    supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single()
      .then(({ data }) => { if (data) setFetchedContact(data) })
  }, [contactId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Restore-or-clear the composer when recipient / identity changes ──────────
  // SINGLE effect so the restore is never clobbered by a separate reset (the prior bug:
  // a reset cleared msgSubject/msgBody AFTER the restore set them). Restores this
  // recipient's saved draft if present; otherwise clears - but ONLY when the recipient
  // actually changed, so in-progress typing during auth (userKey) hydration is preserved.
  useEffect(() => {
    const recipientChanged = lastRecipientRef.current !== draftRecipientId
    lastRecipientRef.current = draftRecipientId
    if (recipientChanged) { setDmSendStatus(null); setDmConfirmOpen(false); setActiveTemplateId(null) }
    draftHydratedRef.current = false
    const d = DRAFT_KEY ? readDirectDraft(DRAFT_KEY) : null
    if (d && !directDraftIsEmpty(d)) {
      setMsgSubject(d.subject || '')
      // Carry the stored richDoc forward (additive; preserved untouched while the flag is OFF). The
      // Divider rehydrates faithfully from the body markers below via the editor's parseHTML.
      richDocRef.current = d.richDoc || null
      // Restore body honoring the draft's bodyFormat vs the current flag (backward compatible:
      // missing bodyFormat ⇒ legacy plain text). Convert between text/html as needed so the body
      // is always in the shape the active composer (editor vs textarea) expects.
      const rawBody = d.body || ''
      const isHtmlDraft = d.bodyFormat === 'html'
      const restoredBody = richEnabled
        ? (isHtmlDraft ? rawBody : plainTextToHtml(rawBody))
        : (isHtmlDraft ? htmlToPlainText(rawBody) : rawBody)
      setMsgBody(restoredBody)
      if (typeof d.includeSignature === 'boolean') setIncludeSignature(d.includeSignature)
      flashDraftStatus('restored')
    } else if (recipientChanged) {
      setMsgSubject('')
      setMsgBody('')
      richDocRef.current = null
    }
    draftHydratedRef.current = true
  }, [DRAFT_KEY, draftRecipientId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived values ────────────────────────────────────────────────────────
  // effectiveStudent and studentHasDisplayInfo are declared earlier (before effects) to avoid TDZ.

  // True when any DM recipient is loaded - enables compose fields for both contacts and students
  const dmHasAnyRecipient = !!(contactId || studentId)

  const selectedStudent  = students.find(s => s.id === selectedStudentId) || null
  // Delivery email mirrors the canonical server resolver used by the survey send
  // (resolveStudentCorrespondenceRecipient = school-first), so the displayed address always matches
  // the address the send will actually use. No email-type pill is shown.
  const resolvedEmail    = selectedStudent
    ? (resolveStudentCorrespondenceRecipient(selectedStudent)?.email || null)
    : null
  // Survey preview greeting honors the student's preferred first name (display only; the survey
  // send path already resolves the preferred greeting server-side).
  const firstName        = (selectedStudent ? getStudentPreferredFirstName(selectedStudent) : '') || null
  const expiresFormatted = fmtDate(expiresAt)
  // Branded "Email Preview" HTML - the EXACT Casey-Fink invitation template the send uses, rendered
  // client-side from the generated survey link (no send, no endpoint call).
  const surveyPreviewHtml = useMemo(() => {
    if (!surveyResult?.surveyUrl) return ''
    try {
      return buildStudentInvitationEmail({
        studentFirstName: getStudentPreferredGreetingName(selectedStudent) || surveyResult.student?.firstName || 'there',
        timepointLabel:   TIMEPOINT_LABELS[surveyResult.timepoint] || surveyResult.timepoint,
        expiresAtHuman:   formatExpiresAt(surveyResult.expiresAt),
        surveyUrl:        surveyResult.surveyUrl,
        subjectOverride:  surveyDraftSubject,
        bodyOverride:     surveyDraftBody,
      }).html
    } catch { return '' }
  }, [surveyResult, selectedStudent, surveyDraftSubject, surveyDraftBody])
  const formValid        = !!(selectedStudentId && instrument && timepoint)

  // ── Survey Invitation recipient clarity (Phase 1.2) ───────────────────────
  // Three render states for the Survey Invitation form, driven by the Send-to-one
  // recipient (URL / picker / deep link), NOT the standalone dropdown:
  //   • student recipient → hide the dropdown, show a recipient summary
  //   • contact recipient → hide the form, show a guard message
  //   • no recipient      → preserve the standalone student dropdown (fallback)
  const recipientIsContact = !!contactId

  // Display fields for the Direct Message recipient - used to label the saved-draft
  // pointer so "Resume draft for {name}" can be shown when no recipient is selected.
  const dmRecipientName = recipientType === 'contact'
    ? String(fromContact?.name || fetchedContact?.name || '').trim()
    : String(effectiveStudent?.name || (fetchedStudent ? `${fetchedStudent.first_name || ''} ${fetchedStudent.last_name || ''}`.trim() : '')).trim()
  const dmRecipientSchool = recipientType === 'student'
    ? (fromStudent?.school || fetchedStudent?.school || effectiveStudent?.school || null)
    : null

  // ── Single-recipient template selection (MANUAL-OUTREACH-TEMPLATE-LIBRARY) ──
  // 'mode'    → composer radio (Direct Message / Survey Invitation), unchanged behavior.
  // 'hydrate' → pre-fill the editable Direct Message composer (ASPIRE Outreach send), fully editable
  //             and never auto-sent. If the composer already has content, a branded confirm modal
  //             (replaceTemplate state) asks before replacing. Template bodies carry NO signature;
  //             the app's signature (Include my email signature) supplies the closing + sender block,
  //             so we turn it ON when hydrating.
  const firstNameOf = (full) => {
    const TITLES = new Set(['dr', 'dr.', 'mr', 'mr.', 'ms', 'ms.', 'mrs', 'mrs.', 'prof', 'prof.', 'professor'])
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean)
    return parts.find(p => !TITLES.has(p.toLowerCase())) || ''
  }
  const buildTemplateDraft = useCallback((key) => {
    // Salutation first name comes from the contact recipient (the recipient IS the preceptor / unit
    // leader / academic partner / interviewer for these templates); blank for student/no recipient so
    // the builder's fallback ("Preceptor"/"Colleague") is used. Student/unit/preceptor body fields
    // stay bracketed placeholders. Each hydrate key maps to its own builder (CONNECT-MANUAL-TEMPLATES-3).
    const firstName = recipientType === 'contact' ? firstNameOf(dmRecipientName) : ''
    switch (key) {
      case 'preceptor_assignment':         return buildPreceptorAssignmentDraft({ firstName })
      case 'preceptor_details_request':    return buildPreceptorDetailsRequestDraft({ firstName })
      case 'unit_leader_support_request':  return buildUnitLeaderSupportRequestDraft({ firstName })
      case 'interviewer_availability_request': return buildInterviewerAvailabilityRequestDraft({ firstName })
      case 'coordinator_acceptance':       return buildAcademicPartnerUpdateDraft({ firstName })
      default:                             return buildAcademicPartnerUpdateDraft({ firstName })
    }
  }, [recipientType, dmRecipientName])

  const applyTemplate = useCallback((key) => {
    const { subject, body, richBody } = buildTemplateDraft(key)
    setOutreachMode('message')
    setMsgSubject(subject)
    // EMAIL-MANUAL-TEMPLATE-BLOCKS-1: when rich compose is ON and this template ships a block layout
    // (richBody = HTML with Content Block markers), hydrate the editor from it - clearing richDocRef
    // first so the editor parses the markers into blocks fresh (RICH-COMPOSE-2A-1) rather than reusing
    // a stale richDoc. Otherwise the prior behavior: plain-text → safe HTML paragraphs (rich), or the
    // raw plain text (flag OFF). Placeholders are preserved verbatim either way.
    if (richEnabled && richBody) {
      richDocRef.current = null
      setMsgBody(richBody)
    } else {
      setMsgBody(richEnabled ? plainTextToHtml(body) : body)
    }
    setIncludeSignature(true)  // template body has no signature - app appends the closing + sender block
    setActiveTemplateId(key)   // sidebar selected-state: mark which template loaded the draft
  }, [buildTemplateDraft, richEnabled])

  const handleSelectSingleTemplate = useCallback((t) => {
    // Picking a composer mode (Direct Message / Survey Invitation) clears the template indicator.
    if (t.kind === 'mode') { setActiveTemplateId(null); setOutreachMode(t.key); return }
    // 'hydrate' templates (Preceptor Assignment, Coordinator Acceptance Update)
    if (msgSubject.trim() || msgBody.trim()) {
      setReplaceTemplateKey(t.key) // existing draft → confirm via branded modal
      return
    }
    applyTemplate(t.key)
  }, [msgSubject, msgBody, applyTemplate])

  // Sidebar selected-state. A hydrate template is "selected" while it owns the current draft;
  // Direct Message is selected only for a plain message draft (no active template).
  const isTypeSelected = (t) => {
    if (t.kind === 'hydrate') return activeTemplateId === t.key
    if (t.key === 'message')  return outreachMode === 'message' && !activeTemplateId
    return outreachMode === t.key // survey
  }

  // CONNECT-TEMPLATE-AUDIENCE-UX-2: inferred Send-to-one audience for template grouping.
  //   • student recipient  → 'student'
  //   • contact recipient  → category-derived audience (null while the contact row is still loading,
  //                           so we never flash a wrong filter before the category is known)
  //   • no recipient yet   → null → the selector shows the full flat list (pre-filtering look)
  const singleAudience = useMemo(() => {
    if (recipientType === 'student') return AUDIENCES.STUDENT
    if (recipientType === 'contact') return fetchedContact ? audienceForContact(fetchedContact) : null
    return null
  }, [recipientType, fetchedContact])

  // Shared Send-to-Many Message Type selector - rendered identically by the Survey zone and the
  // manual BulkManualComposer so the two paths never visually drift. Now audience-aware: the caller
  // passes the inferred audience (Survey zone → always 'student'; manual composer → from its source/
  // category). Splitting + the selected-lift keep the active choice visible; the rest go to "Other".
  const renderBulkTypeSelector = (audience = null) => {
    const split = liftSelectedIntoPrimary(
      splitTemplatesForAudience(BULK_MSG_TYPES, audience, {}),
      bulkMsgType,
    )
    const renderItem = ({ key, label }) => (
      <button key={key} onClick={() => setBulkMsgType(key)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '7px 10px',
        border: bulkMsgType === key ? '1.5px solid #1D2567' : '1.5px solid #e5e7eb',
        borderRadius: 7, background: bulkMsgType === key ? '#EEF2FB' : '#fff',
        cursor: 'pointer', marginBottom: 4,
        fontSize: 12, fontWeight: bulkMsgType === key ? 700 : 500,
        color: bulkMsgType === key ? '#1D2567' : '#374151',
        fontFamily: F, textAlign: 'left', transition: 'all 0.1s', lineHeight: 1.35,
      }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: bulkMsgType === key ? '#1D2567' : 'transparent',
          border: bulkMsgType === key ? '2px solid #1D2567' : '2px solid #d1d5db',
        }} />
        {label}
      </button>
    )
    return (
      <TemplateGroup
        audience={audience}
        helperText="Showing templates based on the selected audience."
        primary={split.primary}
        other={split.other}
        otherOpen={bulkOtherOpen}
        onToggleOther={() => setBulkOtherOpen(o => !o)}
        renderItem={renderItem}
      />
    )
  }

  // Escape closes the branded "Replace draft?" confirm modal.
  useEffect(() => {
    if (!replaceTemplateKey) return
    const onKey = (e) => { if (e.key === 'Escape') setReplaceTemplateKey(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [replaceTemplateKey])

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

      // Read the body as text ONCE, then try to parse JSON. A handler crash / platform error returns
      // HTML, not JSON - reading the raw text lets us show what actually came back instead of a
      // misleading "missing env var" guess. (Owner/Admin-only surface; no tokens are in error bodies.)
      const rawText = await res.text()
      let payload = null
      try {
        payload = rawText ? JSON.parse(rawText) : null
      } catch {
        payload = null
      }

      if (res.status === 409) {
        setGenerateError(
          payload?.error ||
          'An active invitation already exists for this student and timepoint. Review in the Evaluation tab.'
        )
        return
      }
      if (!res.ok) {
        if (payload) {
          // Our endpoint returned a structured JSON error. Surface the safe classification + Supabase
          // diagnostics (code/message) so the exact failing step is visible without Vercel logs.
          const bits = [payload.error || 'Failed to generate link.']
          const diag = [payload.code, payload.dbCode, payload.dbMessage].filter(Boolean).join(' · ')
          if (diag) bits.push(`[${diag}]`)
          setGenerateError(bits.join(' '))
        } else {
          // Non-JSON body = crash outside the handler (module load, timeout, or a stale deploy).
          // Show the status and a short, safe snippet of the actual response.
          const snippet = (rawText || '').replace(/\s+/g, ' ').trim().slice(0, 300)
          setGenerateError(`Server error (HTTP ${res.status}). Non-JSON response${snippet ? `: ${snippet}` : '.'}`)
        }
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

  const bulkFilteredStudents = (() => {
    const out = students.filter(s => {
      if (bulkSearch) {
        const q = bulkSearch.toLowerCase()
        const hay = `${s.first_name || ''} ${s.last_name || ''} ${s.personal_email || ''} ${s.school_email || ''} ${s.school || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (bulkFilterSchool && s.school !== bulkFilterSchool) return false
      if (!studentHasEmailSource(s, bulkFilterEmail)) return false
      return true
    })
    const cmp = bulkSort === 'status'
      ? (a, b) => String(a.status || '').localeCompare(String(b.status || ''))
      : (a, b) => `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(`${b.last_name || ''} ${b.first_name || ''}`)
    return [...out].sort(cmp)
  })()

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
        const testMsg = payload.message || 'Test email sent.'
        setBulkTestSendMsg(prev => ({ ...prev, [id]: testMsg }))
        toast?.success('Test email sent', testMsg)
      } else {
        const errMsg = payload?.error || 'Send failed. Try again.'
        setBulkTestSendState(prev => ({ ...prev, [id]: 'error' }))
        setBulkTestSendMsg(prev => ({ ...prev, [id]: errMsg }))
        toast?.error('Test email not sent', errMsg)
      }
    } catch {
      const networkMsg = 'Network error. Check your connection.'
      setBulkTestSendState(prev => ({ ...prev, [id]: 'error' }))
      setBulkTestSendMsg(prev => ({ ...prev, [id]: networkMsg }))
      toast?.error('Test email not sent', networkMsg)
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
    setBulkFilterEmail('school')
    setBulkSort('name')
    setBulkNotes('')
    setBulkExpiresAt(defaultExpiresAt())
  }, [])

  // ── Single-recipient survey: test send to Owner ───────────────────────────
  const handleSingleTestSend = useCallback(async () => {
    if (singleTestSendState === 'sending' || !surveyResult) return
    setSingleTestSendState('sending')
    setSingleTestSendMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setSingleTestSendState('error')
        setSingleTestSendMsg('Session expired. Refresh and try again.')
        return
      }
      const res = await fetch('/api/evaluation-send-test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          assignment_id: surveyResult.assignmentId,
          survey_url:    surveyResult.surveyUrl,
          student_name:  `${surveyResult.student.firstName} ${surveyResult.student.lastName}`.trim(),
          timepoint:     surveyResult.timepoint,
          expires_at:    surveyResult.expiresAt,
          subject_override: surveyDraftSubject,
          body_override:    surveyDraftBody,
        }),
      })
      let payload = null
      try { payload = await res.json() } catch { /* ignore */ }
      if (res.ok && payload?.success) {
        setSingleTestSendState('sent')
        const msg = payload.message || 'Test email sent.'
        setSingleTestSendMsg(msg)
        toast?.success('Test email sent', msg)
      } else {
        const errMsg = payload?.error || 'Test send failed. Try again.'
        setSingleTestSendState('error')
        setSingleTestSendMsg(errMsg)
        toast?.error('Test email not sent', errMsg)
      }
    } catch {
      const netMsg = 'Network error. Check your connection.'
      setSingleTestSendState('error')
      setSingleTestSendMsg(netMsg)
      toast?.error('Test email not sent', netMsg)
    }
  }, [singleTestSendState, surveyResult, surveyDraftSubject, surveyDraftBody])

  // ── Single-recipient survey: real send to student via Resend ──────────────
  // Reuses existing bulk send endpoint with a one-item payload.
  const handleSingleSendViaResend = useCallback(async () => {
    if (singleSendInFlight || !surveyResult) return
    setSingleSendInFlight(true)
    setSingleSendState(null)
    setSingleSendMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setSingleSendState('error')
        setSingleSendMsg('Session expired. Refresh and try again.')
        setSingleSendConfirmOpen(false)
        return
      }
      const res = await fetch('/api/evaluation-send-bulk-invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          confirmation_phrase: 'SEND SURVEYS',
          items: [{
            assignment_id: surveyResult.assignmentId,
            student_id:    surveyResult.student.id,
            survey_url:    surveyResult.surveyUrl,
          }],
          instrument_slug: 'casey_fink_readiness_2024',
          timepoint:       surveyResult.timepoint,
          expires_at:      surveyResult.expiresAt,
          subject_override: surveyDraftSubject,
          body_override:    surveyDraftBody,
        }),
      })
      let payload = null
      try { payload = await res.json() } catch { /* ignore */ }
      setSingleSendConfirmOpen(false)
      setSingleSendPhrase('')
      const name = `${surveyResult.student.firstName} ${surveyResult.student.lastName}`.trim()
      const s = payload?.summary || {}
      if (res.ok && payload?.success && s.total_sent > 0) {
        // A real email was actually sent this cycle.
        const sentMsg = `Survey sent to ${name}.`
        setSingleSendState('sent')
        setSingleSendMsg(sentMsg)
        toast?.success('Survey sent', sentMsg)
      } else if (res.ok && payload?.success && s.total_skipped > 0 && (s.total_failed || 0) === 0) {
        // Nothing sent because this invitation cycle was already emailed (legitimate idempotency).
        const skipMsg = `Survey already sent to ${name}.`
        setSingleSendState('sent')
        setSingleSendMsg(skipMsg)
        toast?.success('Survey already sent', skipMsg)
      } else {
        // Nothing sent due to a failure (or unexpected zero result). Surface the specific safe reason
        // (e.g. "Student has no email on file") rather than a misleading success.
        const errMsg = payload?.failed?.[0]?.reason || payload?.error || 'Send failed. Try again.'
        setSingleSendState('error')
        setSingleSendMsg(errMsg)
        toast?.error('Survey not sent', errMsg)
      }
    } catch {
      setSingleSendConfirmOpen(false)
      const netMsg = 'Network error. Check your connection.'
      setSingleSendState('error')
      setSingleSendMsg(netMsg)
      toast?.error('Survey not sent', netMsg)
    } finally {
      setSingleSendInFlight(false)
    }
  }, [singleSendInFlight, surveyResult, surveyDraftSubject, surveyDraftBody])

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
      // Flush any pending (un-chipped) CC text so a typed-but-not-Entered address still sends.
      const ccToSend = [...ccList]
      const pendingCc = ccInput.trim().replace(/[,;]+$/, '').trim()
      if (pendingCc && isValidEmail(pendingCc) && !ccToSend.some(x => x.toLowerCase() === pendingCc.toLowerCase())) {
        ccToSend.push(pendingCc)
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
          body_format:       richEnabled ? 'html' : 'text',
          include_signature: includeSignature,
          cc:                ccToSend,
          cc_auto_suggested: ccAutoSuggested,
        }),
      })
      let payload = null
      try { payload = await res.json() } catch { /* ignore */ }
      setDmConfirmOpen(false)
      if (res.ok && payload?.success) {
        setMsgSubject('')
        setMsgBody('')
        setActiveTemplateId(null)
        setIncludeSignature(true)
        setCcList([])
        setCcInput('')
        setCcInputError(null)
        setDmBodyExpanded(false)
        // Clear saved draft + resume pointer - sent content should not restore on next visit
        if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY)
        try {
          const sentRecipId = recipientType === 'student' ? studentId : contactId
          const ptr = readDraftPointer(userKey, cohortId)
          const ptrKey = lastDraftPointerKey(userKey, cohortId)
          if (ptr && ptr.id === sentRecipId && ptrKey) localStorage.removeItem(ptrKey)
        } catch { /* ignore */ }
        const recipientDisplayName = recipientType === 'contact' ? fromContact?.name
          : (effectiveStudent?.name || `${fetchedStudent?.first_name || ''} ${fetchedStudent?.last_name || ''}`.trim())
        const successMsg = payload.message || `Email sent to ${recipientDisplayName || 'recipient'}.`
        setDmSendStatus({ ok: true, msg: successMsg })
        toast?.success('Email sent', successMsg)
      } else {
        const errMsg = payload?.error || (res.status === 403 ? 'Access denied or recipient cannot receive email.' : 'Failed to send email. Please try again.')
        setDmSendStatus({ ok: false, msg: errMsg })
        toast?.error('Email not sent', errMsg)
      }
    } catch {
      const networkMsg = 'Network error. Please check your connection and try again.'
      setDmConfirmOpen(false)
      setDmSendStatus({ ok: false, msg: networkMsg })
      toast?.error('Email not sent', networkMsg)
    } finally {
      setDmSendInFlight(false)
    }
  }, [dmConfirmReady, dmSendInFlight, recipientType, contactId, studentId, msgSubject, msgBody, includeSignature, ccList, ccInput, ccAutoSuggested, fromContact, fromStudent, richEnabled])

  // ── CONNECT-COMMS-1B: debounced true-preview fetch ────────────────────────
  // Calls the send endpoint in preview:true mode (no send, no log) so the inline preview and the
  // confirmation modal render the EXACT branded HTML that will be sent, and show the server's
  // school-first resolved recipient. Debounced so it does not fire per keystroke.
  useEffect(() => {
    if (outreachMode !== 'message' || !recipientType) {
      setDmPreview({ html: '', recipient: null, cc: [], signature: null, loading: false, error: null })
      return
    }
    const rid = recipientType === 'contact' ? contactId : studentId
    if (!rid || !msgBody.trim()) {
      setDmPreview(p => ({ ...p, html: '', loading: false, error: null }))
      return
    }
    let cancelled = false
    setDmPreview(p => ({ ...p, loading: true, error: null }))
    const timer = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          if (!cancelled) setDmPreview(p => ({ ...p, loading: false, error: 'Session expired, refresh to preview.' }))
          return
        }
        const res = await fetch('/api/connect-send-direct-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({
            preview:           true,
            recipient_type:    recipientType,
            recipient_id:      rid,
            subject:           msgSubject,
            body:              msgBody,
            body_format:       richEnabled ? 'html' : 'text',
            include_signature: includeSignature,
            cc:                ccList,
            cc_auto_suggested: ccAutoSuggested,
          }),
        })
        const data = await res.json().catch(() => null)
        if (cancelled) return
        if (res.ok && data?.success) {
          setDmPreview({ html: data.html || '', recipient: data.recipient || null, cc: Array.isArray(data.cc) ? data.cc : [], signature: data.signature || null, loading: false, error: null })
        } else {
          setDmPreview(p => ({ ...p, loading: false, error: data?.error || 'Preview unavailable.' }))
        }
      } catch {
        if (!cancelled) setDmPreview(p => ({ ...p, loading: false, error: 'Preview unavailable.' }))
      }
    }, 450)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [outreachMode, recipientType, contactId, studentId, msgSubject, msgBody, includeSignature, ccList, richEnabled])

  // ── CONNECT-COMMS-1D: coordinator CC suggestion (removable, never forced) ──
  // The clinical coordinator's email is sourced from fetchedStudent (the navigation state in
  // fromStudent does not carry coordinator fields). We pre-fill exactly ONE removable chip when:
  // a student recipient is loaded, the coordinator email is valid, and it is not the same address
  // we'd send To (school-first). Re-runs only when the recipient or coordinator email changes -
  // so manual chip edits are preserved, and a removed coordinator chip is not re-added.
  const coordEmail = (fetchedStudent?.id === studentId ? (fetchedStudent?.school_coordinator_email || '') : '').trim()
  const coordName  = (fetchedStudent?.id === studentId ? (fetchedStudent?.school_coordinator_name  || '') : '').trim()
  useEffect(() => {
    setCcInput('')
    setCcInputError(null)
    if (recipientType === 'student' && coordEmail && isValidEmail(coordEmail)) {
      const toApprox = (
        effectiveStudent?.school_email || fetchedStudent?.school_email ||
        effectiveStudent?.personal_email || fetchedStudent?.personal_email || ''
      ).trim().toLowerCase()
      if (coordEmail.toLowerCase() !== toApprox) {
        setCcList([coordEmail])
        setCcAutoSuggested(true)
        return
      }
    }
    setCcList([])
    setCcAutoSuggested(false)
  }, [recipientType, studentId, contactId, coordEmail]) // eslint-disable-line react-hooks/exhaustive-deps

  // CONNECT-COMMS-1F: the server-resolved primary To (preferred), falling back to the school-first
  // client approximation, then a contact's email. Used to drop CC==To and to exclude it from
  // autocomplete suggestions. The server still enforces this authoritatively.
  const resolvedToEmail = (
    dmPreview.recipient?.email ||
    effectiveStudent?.school_email || fetchedStudent?.school_email ||
    effectiveStudent?.personal_email || fetchedStudent?.personal_email ||
    (recipientType === 'contact' ? (fromContact?.email || fetchedContact?.email) : '') || ''
  )

  // Add/remove CC chips. Validation mirrors the server (isValidEmail + case-insensitive dedupe,
  // drop CC==To, cap 5); the server remains the source of truth and re-validates on send.
  const addCcChip = useCallback((raw) => {
    const e = (raw || '').trim().replace(/[,;]+$/, '').trim()
    if (!e) return true
    if (!isValidEmail(e)) { setCcInputError(`"${e}" is not a valid email.`); return false }
    const norm = normalizeEmailForLookup(e)
    if (resolvedToEmail && norm === normalizeEmailForLookup(resolvedToEmail)) {
      setCcInputError('That address is already the To recipient.'); return false
    }
    let added = false
    setCcList(prev => {
      if (prev.some(x => normalizeEmailForLookup(x) === norm)) return prev   // duplicate
      if (prev.length >= 5) { return prev }                                  // cap 5
      added = true
      return [...prev, e]
    })
    if (!added && ccList.length >= 5) { setCcInputError('Maximum of 5 CC recipients.'); return false }
    setCcInputError(null)
    return true
  }, [resolvedToEmail, ccList])
  const removeCcChip = useCallback((e) => {
    setCcList(prev => prev.filter(x => x !== e))
  }, [])
  // Normalized set of addresses the autocomplete should NOT suggest (already-added CC + the To).
  const ccExcludeSet = useMemo(() => {
    const s = new Set(ccList.map(normalizeEmailForLookup))
    if (resolvedToEmail) s.add(normalizeEmailForLookup(resolvedToEmail))
    return s
  }, [ccList, resolvedToEmail])

  // ── Direct Message draft: autosave (CONNECT-DRAFT-AUTOSAVE) ────────────────
  // Mirrors the Interview Rubric localStorage pattern: a ref holds the latest values, a
  // single persist function reads from it (so flush handlers always write the newest
  // content), and we flush on tab-hide / beforeunload / unmount in addition to the
  // debounced write. Stores ONLY { subject, body, includeSignature } - never tokens or
  // preview HTML. Pointer tracks the most recent non-empty draft for the Resume link.
  useEffect(() => {
    latestDraftRef.current = {
      DRAFT_KEY, ptrKey: lastDraftPointerKey(userKey, cohortId),
      recipId: recipientType === 'student' ? studentId : contactId,
      kind: recipientType === 'student' ? 'student' : 'contact',
      subject: msgSubject, body: msgBody, includeSignature, richDoc: richDocRef.current,
      name: dmRecipientName, email: resolvedToEmail || '', school: dmRecipientSchool || null,
    }
  }, [DRAFT_KEY, userKey, cohortId, recipientType, studentId, contactId, msgSubject, msgBody, includeSignature, dmRecipientName, resolvedToEmail, dmRecipientSchool])
  const persistDraftNow = useCallback(() => {
    if (!draftHydratedRef.current) return
    const l = latestDraftRef.current
    if (!l || !l.DRAFT_KEY) return
    // richDoc is additive: persisted only when present (omitted for legacy/text-only drafts), and the
    // OFF path carries the restored richDoc forward (richDocRef holds it) so it is never destroyed.
    const payload = { v: DRAFT_VERSION, savedAt: Date.now(), subject: l.subject, body: l.body, includeSignature: l.includeSignature, bodyFormat: richEnabled ? 'html' : 'text' }
    if (l.richDoc) payload.richDoc = l.richDoc
    try {
      if (directDraftIsEmpty(payload)) {
        localStorage.removeItem(l.DRAFT_KEY)
        const ptr = readDraftPointer(userKey, cohortId)
        if (ptr && ptr.id === l.recipId && l.ptrKey) localStorage.removeItem(l.ptrKey)
      } else {
        localStorage.setItem(l.DRAFT_KEY, JSON.stringify(payload))
        if (l.ptrKey) localStorage.setItem(l.ptrKey, JSON.stringify({
          v: DRAFT_VERSION, savedAt: payload.savedAt, kind: l.kind,
          id: l.recipId, name: l.name, email: l.email, school: l.school,
        }))
      }
    } catch { /* ignore quota / serialization errors */ }
  }, [userKey, cohortId, richEnabled])

  // Debounced write + "Draft saved" indicator. The debounce coalesces the mount/restore
  // pass so it never clobbers a freshly-restored draft.
  useEffect(() => {
    if (!DRAFT_KEY || !draftHydratedRef.current) return
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    const nonEmpty = !directDraftIsEmpty({ subject: msgSubject, body: msgBody })
    draftTimerRef.current = setTimeout(() => { persistDraftNow(); if (nonEmpty) flashDraftStatus('saved') }, DRAFT_DEBOUNCE_MS)
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current) }
  }, [msgSubject, msgBody, includeSignature, DRAFT_KEY, persistDraftNow, flashDraftStatus])

  // Flush immediately on tab-hide, browser close/refresh, AND SPA unmount (navigating away
  // from Connect) so a draft typed within the debounce window is never lost.
  useEffect(() => {
    const onHide   = () => { if (document.visibilityState === 'hidden') persistDraftNow() }
    const onUnload = () => persistDraftNow()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onUnload)
      persistDraftNow()
    }
  }, [persistDraftNow])

  // Resume affordance: when the single-recipient composer is open with NO recipient,
  // surface the most recent saved draft (if still valid) as a non-blocking link.
  useEffect(() => {
    let next = null
    if (userKey && recipientMode === 'single' && !hasExplicitRecipient && !selectedStudentId) {
      const ptr = readDraftPointer(userKey, cohortId)
      if (ptr) {
        const draft = readDirectDraft(directDraftKey(userKey, cohortId, `${ptr.kind}:${ptr.id}`))
        if (draft && !directDraftIsEmpty(draft)) next = ptr
      }
    }
    setResumeInfo(next) // eslint-disable-line react-hooks/set-state-in-effect
  }, [recipientMode, hasExplicitRecipient, selectedStudentId, cohortId, userKey, DRAFT_KEY])

  // One-time cleanup: purge legacy UNSCOPED Connect draft/pointer keys (pre user-scoping).
  // They are never migrated - resurrecting them could expose another user's draft on a
  // shared browser. Keys for the current version (".v1.") are left untouched.
  useEffect(() => {
    try {
      const prefixes = ['aspire.connect.outreach.directDraft.', 'aspire.connect.outreach.lastDraftPointer.']
      const stale = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && prefixes.some(p => k.startsWith(p)) && !k.includes(`.v${DRAFT_VERSION}.`)) stale.push(k)
      }
      stale.forEach(k => localStorage.removeItem(k))
    } catch { /* ignore */ }
  }, [])

  // Explicit discard: clear the composer and the stored draft + pointer. Distinct from
  // navigating away (which preserves the draft).
  const handleDiscardDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    setMsgSubject('')
    setMsgBody('')
    richDocRef.current = null
    setActiveTemplateId(null)
    setIncludeSignature(true)
    setCcList([])
    setCcInput('')
    setCcInputError(null)
    try {
      if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY)
      const recipId = recipientType === 'student' ? studentId : contactId
      const ptr = readDraftPointer(userKey, cohortId)
      const ptrKey = lastDraftPointerKey(userKey, cohortId)
      if (ptr && ptr.id === recipId && ptrKey) localStorage.removeItem(ptrKey)
    } catch { /* ignore */ }
    flashDraftStatus('discarded')
  }, [DRAFT_KEY, recipientType, studentId, contactId, cohortId, userKey, flashDraftStatus])

  // CONNECT-COMMS-1B: recipient source chip styling (school/personal-fallback/override/contact/missing).
  const dmSourceChip = (type) => ({
    school:   { label: 'School email',        bg: '#eef5ef', color: '#2F7D5C', border: '#cfe6d6' },
    personal: { label: 'Personal (fallback)', bg: '#fdf6ec', color: '#92400e', border: '#f0c9b0' },
    override: { label: 'Override',            bg: '#eef2ff', color: '#3730a3', border: '#e0e7ff' },
    contact:  { label: 'Contact',             bg: '#f3f4f6', color: '#4A5560', border: '#e5e7eb' },
    missing:  { label: 'Missing email',       bg: '#fef2f2', color: '#991b1b', border: '#fecaca' },
  }[type] || { label: 'Recipient', bg: '#f3f4f6', color: '#4A5560', border: '#e5e7eb' })

  // ── Bulk Send via Resend handler (Phase 3B.2B) ───────────────────────────
  // Sends every eligible (not-yet-sent) recipient by splitting them into internal
  // chunks of SEND_CHUNK_SIZE and POSTing each chunk sequentially to the same
  // endpoint. Results accumulate into ONE summary; the owner never sees a hard
  // stop or a per-chunk result. Idempotency and the token/URL security model are
  // unchanged - we only pass through already-generated assignment_id + survey_url.
  const handleBulkSendViaResend = useCallback(async () => {
    if (bulkSendInFlight || !bulkResults?.generated?.length) return
    const eligibleItems = bulkResults.generated.filter(g => !bulkSentIds.has(g.assignmentId))
    if (!eligibleItems.length) return
    setBulkSendInFlight(true)
    setBulkSendResults(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setBulkSendResults({ error: 'Session expired. Please refresh and try again.' })
        return
      }

      const toItem = g => ({
        assignment_id: g.assignmentId,
        student_id:    g.studentId || g.student_id,
        survey_url:    g.surveyUrl,
      })
      const batches = chunkArray(eligibleItems, SEND_CHUNK_SIZE)
      const acc = { sent: [], skipped: [], failed: [] }
      let stoppedError = null

      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi]
        let res = null
        let payload = null
        try {
          res = await fetch('/api/evaluation-send-bulk-invitations', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({
              confirmation_phrase: 'SEND SURVEYS',
              items: batch.map(toItem),
              instrument_slug: bulkInstrument,
              timepoint:       bulkTimepoint,
              expires_at:      bulkExpiresAt,
            }),
          })
          try { payload = await res.json() } catch { /* ignore */ }
        } catch {
          stoppedError = 'Network error. Please check your connection.'
        }

        if (!stoppedError && res?.ok && payload?.success) {
          // Per-recipient outcomes accumulate; per-recipient failures inside a
          // successful response do NOT stop the run.
          acc.sent.push(...(payload.sent || []))
          acc.skipped.push(...(payload.skipped || []))
          acc.failed.push(...(payload.failed || []))
        } else {
          // Whole-request error (auth/validation/server/network). It is structural
          // and would recur, so preserve successes, mark THIS batch and every
          // remaining batch as failed, then stop.
          const errMsg = stoppedError || payload?.error || 'Failed to send emails. Please try again.'
          for (let rb = bi; rb < batches.length; rb++) {
            batches[rb].forEach(g => acc.failed.push({ ...toItem(g), reason: errMsg }))
          }
          stoppedError = errMsg
          break
        }
      }

      // Merge into the payload shape the results UI expects (one overall result).
      const summary = {
        total_sent:    acc.sent.length,
        total_skipped: acc.skipped.length,
        total_failed:  acc.failed.length,
      }
      const merged = { success: true, ...acc, summary, ...(stoppedError ? { error: stoppedError } : {}) }

      // Mark every confirmed-sent assignment so this session / retries never resend
      // them (failed/unsent stay eligible for a retry, which re-chunks the rest).
      const newSentIds = new Set(bulkSentIds)
      acc.sent.forEach(s => newSentIds.add(s.assignment_id))
      setBulkSentIds(newSentIds)
      setBulkSendResults(merged)
      // Clean completion closes the confirm dialog; a structural error keeps it open
      // with the error banner so the owner can review and retry the remainder.
      if (!stoppedError) {
        setBulkSendConfirmOpen(false)
        setBulkSendPhrase('')
      }

      // One overall summary toast - same five scenarios, on accumulated totals.
      const { total_sent: s, total_skipped: sk, total_failed: f } = summary
      if (s > 0 && f === 0 && sk === 0) {
        toast?.success('Surveys sent', `Sent ${s} survey invitation${s !== 1 ? 's' : ''}`)
      } else if (s > 0 && sk > 0 && f === 0) {
        toast?.success('Surveys sent', `Sent ${s} · Skipped ${sk} (already sent)`)
      } else if (s > 0 && f > 0) {
        toast?.warning('Surveys sent with failures', `Sent ${s} · Failed ${f}, review results below`)
      } else if (s === 0 && f > 0) {
        toast?.error('No surveys sent', `${f} failed, see error details below`)
      } else if (s === 0 && sk > 0) {
        toast?.info('All already sent', 'All recipients were sent in a previous batch')
      }
    } catch {
      setBulkSendResults({ error: 'Network error. Please check your connection.' })
    } finally {
      setBulkSendInFlight(false)
    }
  }, [bulkSendInFlight, bulkResults, bulkSentIds, bulkInstrument, bulkTimepoint, bulkExpiresAt])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '20px 24px', fontFamily: F }}>

      {/* ══════════════════════════════════════════════════════════════════
          RECIPIENT MODE TOGGLE, Single vs Bulk
          Segmented control above the three zones.
      ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          display: 'flex', border: '1px solid rgba(29,37,103,0.14)',
          borderRadius: 8, overflow: 'hidden',
        }}>
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
            Send to one
          </button>
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
          <button
            onClick={() => setRecipientMode('history')}
            style={{
              padding: '8px 20px', border: 'none', cursor: 'pointer',
              borderLeft: '1px solid rgba(29,37,103,0.14)',
              background: recipientMode === 'history' ? '#1D2567' : '#f9fafb',
              color: recipientMode === 'history' ? '#fff' : '#6b7280',
              fontSize: 12, fontWeight: 600, fontFamily: F,
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            Sent History
          </button>
        </div>
        <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: F }}>
          {recipientMode === 'bulk' ? 'Bulk Operation, Phase 3A scaffolding' : ''}
        </span>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SINGLE RECIPIENT MODE, all existing three-zone behavior preserved
      ═══════════════════════════════════════════════════════════════════ */}
      {recipientMode === 'single' && (
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* ═══════════════════════════════════════════════════════════════
            LEFT COLUMN, Recipient profile card + message type picker
            (Rich profile card replaces the former Audience card.
             Message Type picker is stacked below it in this column.)
        ════════════════════════════════════════════════════════════════ */}
        <div style={{ flex: '0 0 340px', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* ── Recipient picker (Phase 1) vs. profile card ──────────────────
              urlRecipient: recipient came from a deep link OR a picker selection
                (drives Direct Message). anyRecipient also counts a survey-mode
                student chosen via the existing dropdown (so the picker does not
                shadow the survey selection). The picker shows when explicitly
                reopened ("Change recipient") or when no recipient is resolved. */}
          <ConnectPanel tone="audience" icon="userSearch" title="Recipient">
          {(() => {
            const urlRecipient = !!(contactId || studentId)
            const anyRecipient = urlRecipient || !!selectedStudentId
            const isSurvey     = outreachMode === 'survey'
            // Survey mode: the student recipient is chosen HERE (relocated out of the
            // Message Type panel). When none is chosen yet and there is no deep-linked
            // recipient, show the required student selector. Selecting a student sets
            // selectedStudentId exactly as before, which drives the survey invitation.
            if (isSurvey && !urlRecipient && !selectedStudentId) {
              return (
                <div style={fieldWrap}>
                  <label style={labelStyle}>
                    Survey recipient <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
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
                        {s.first_name} {s.last_name}{s.school ? `, ${s.school}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )
            }
            const showPicker   = pickerOpen || !anyRecipient
            if (showPicker) {
              return (
                <>
                  {resumeInfo && (
                    <button
                      type="button"
                      onClick={() => { handlePickerSelect({ kind: resumeInfo.kind, id: resumeInfo.id, name: resumeInfo.name, email: resumeInfo.email, school: resumeInfo.school }); setResumeInfo(null) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        marginBottom: 10, padding: '9px 11px', borderRadius: 8, cursor: 'pointer',
                        background: '#f1efe9', border: '1px solid #e0ddd3', fontFamily: F,
                      }}>
                      <span aria-hidden="true" style={{ fontSize: 13 }}>↩</span>
                      <span style={{ fontSize: 12, color: '#374151', lineHeight: 1.4 }}>
                        Resume saved draft for <strong style={{ color: '#1D2567' }}>{resumeInfo.name || 'recipient'}</strong>
                      </span>
                    </button>
                  )}
                  <RecipientPicker
                    students={students}
                    onSelect={handlePickerSelect}
                    onCancel={handlePickerCancel}
                    canCancel={anyRecipient}
                  />
                </>
              )
            }
            return (
              <>
                {(urlRecipient || (isSurvey && !!selectedStudentId)) && (
                  <button
                    type="button"
                    onClick={() => { if (urlRecipient) setPickerOpen(true); else setSelectedStudentId('') }}
                    style={{
                      alignSelf: 'flex-start', background: 'none', border: 'none',
                      cursor: 'pointer', padding: 0, fontFamily: F,
                      fontSize: 11, fontWeight: 600, color: '#1D2567',
                    }}
                  >
                    ← Change recipient
                  </button>
                )}
                <RecipientProfileCard
                  recipientType={contactId ? 'contact' : (studentId || selectedStudentId) ? 'student' : null}
                  contact={fetchedContact}
                  fromContact={fromContact}
                  displayStudent={outreachMode === 'survey' ? selectedStudent : effectiveStudent}
                  fetchedStudent={fetchedStudent}
                  studentFetchFailed={studentFetchFailed}
                  outreachMode={outreachMode}
                />
              </>
            )
          })()}
          </ConnectPanel>

          {/* ── Message Type picker (moved into left column below profile card) ── */}
          <ConnectPanel tone="message" title="Message Type" helper="Workflow">

          {/* Type selector - audience-aware (CONNECT-TEMPLATE-AUDIENCE-UX-2). Grouping/behavior of
              each item is unchanged; templates are split into a primary list for the inferred
              recipient audience plus an "Other templates" escape hatch. Custom Message is pinned to
              primary; the selected template is always lifted into primary so it stays visible. */}
          {(() => {
            const renderItem = (t) => (
              t.active ? (
                <button
                  key={t.label}
                  onClick={() => handleSelectSingleTemplate(t)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '7px 10px',
                    border: isTypeSelected(t)
                      ? '1.5px solid #1D2567'
                      : '1.5px solid #e5e7eb',
                    borderRadius: 7,
                    background: isTypeSelected(t) ? '#EEF2FB' : '#fff',
                    cursor: 'pointer', marginBottom: 4,
                    fontSize: 12,
                    fontWeight: isTypeSelected(t) ? 700 : 500,
                    color: isTypeSelected(t) ? '#1D2567' : '#374151',
                    fontFamily: F, textAlign: 'left',
                    transition: 'all 0.1s',
                  }}
                >
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: isTypeSelected(t) ? '#1D2567' : 'transparent',
                    border: isTypeSelected(t) ? '2px solid #1D2567' : '2px solid #d1d5db',
                    transition: 'all 0.1s',
                  }} />
                  {t.label}
                </button>
              ) : (
                <Tooltip key={t.label} label="Coming in a future release" placement="right">
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
                      {t.label}
                    </span>
                    <span style={{ ...futureBadge, marginLeft: 'auto' }}>Future</span>
                  </div>
                </Tooltip>
              )
            )
            const split = liftSelectedIntoPrimary(
              splitTemplatesForAudience(MSG_TYPES, singleAudience, { alwaysPrimaryKeys: ['message'] }),
              MSG_TYPES.find(isTypeSelected)?.key,
            )
            return (
              <TemplateGroup
                audience={singleAudience}
                helperText="Showing templates based on the selected recipient."
                primary={split.primary}
                other={split.other}
                otherOpen={singleOtherOpen}
                onToggleOther={() => setSingleOtherOpen(o => !o)}
                renderItem={renderItem}
              />
            )
          })()}

          {/* Workflow settings for selected type */}
          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 14 }}>

            {/* Direct Message workflow - recipient details shown in profile card above */}
            {outreachMode === 'message' && (
              <div>
                <div style={{
                  padding: '9px 11px', background: '#f9fafb',
                  border: '1px solid #e5e7eb', borderRadius: 8,
                  fontSize: 11, color: '#6b7280', fontFamily: F, lineHeight: 1.65,
                }}>
                  <div>Send a direct ASPIRE email to this recipient.</div>
                  {DRAFT_KEY && (
                    <div style={{ color: '#9ca3af', marginTop: 4 }}>
                      Drafts autosave locally for this contact.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Survey Invitation - State 2: Contact recipient → guard (form hidden) */}
            {outreachMode === 'survey' && recipientIsContact && (
              <div style={{
                padding: '14px 16px',
                background: '#FBF5E8', border: '1px solid #f0c9b0',
                borderRadius: 10, fontFamily: F,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                  <span style={{ fontSize: 15, lineHeight: 1.2, flexShrink: 0 }} aria-hidden="true">ⓘ</span>
                  <div style={{ fontSize: 12.5, color: '#8B5E1A', lineHeight: 1.6 }}>
                    The Student Casey-Fink Survey is available for student recipients only.
                    Change recipient to a student to send it.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  style={{
                    marginTop: 12, padding: '8px 16px',
                    background: 'var(--color-accent-primary,#1D2567)', border: 'none',
                    borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: '#fff',
                    fontFamily: F, cursor: 'pointer',
                  }}
                >
                  Change recipient
                </button>
              </div>
            )}

            {/* Survey Invitation workflow - all form fields + Generate Link
                (State 1 student recipient → summary; State 3 no recipient → dropdown) */}
            {outreachMode === 'survey' && !recipientIsContact && (
              <div>
                {/* Recipient is chosen in the Recipient panel above (student selector when
                    none is selected; recipient card + delivery email once selected). The
                    Message Type panel holds only message-workflow + survey settings. */}
                {/* Field - Instrument */}
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

                {/* Field 4 - Timepoint (Casey-Fink is sent at Baseline and Post-Rotation only) */}
                <div style={fieldWrap}>
                  <label style={labelStyle}>
                    Timepoint <span style={{ color: '#dc2626', fontWeight: 400 }}>*</span>
                  </label>
                  <select
                    value={timepoint}
                    onChange={e => setTimepoint(e.target.value)}
                    style={inputBase}
                  >
                    {BULK_CASEY_FINK_TIMEPOINTS.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* Field 5 - Expires at */}
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

                {/* Field 6 - Notes */}
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

                {/* Prior-invitation status (server is source of truth; this is a UX assist) */}
                {selectedStudentId && timepoint && !checkingDuplicate && priorInvitation === 'completed' && (
                  <div style={{
                    padding: '11px 14px', marginBottom: 18,
                    background: '#fef2f2', border: '1px solid #fecaca',
                    borderRadius: 8, fontSize: 12, color: '#dc2626',
                    fontFamily: F, lineHeight: 1.6,
                  }}>
                    A completed response already exists for this student and timepoint.
                  </div>
                )}
                {selectedStudentId && timepoint && !checkingDuplicate && priorInvitation === 'active' && (
                  <div style={{
                    padding: '11px 14px', marginBottom: 18,
                    background: '#FBF5E8', border: '1px solid #f0c9b0',
                    borderRadius: 8, fontSize: 12, color: '#8B5E1A',
                    fontFamily: F, lineHeight: 1.6,
                  }}>
                    An active invitation already exists for this student and timepoint. Review in the Evaluation tab before sending a new invitation.
                  </div>
                )}
                {selectedStudentId && timepoint && !checkingDuplicate && priorInvitation === 'reissuable' && (
                  <div style={{
                    padding: '11px 14px', marginBottom: 18,
                    background: '#eef6ee', border: '1px solid #bcd9bf',
                    borderRadius: 8, fontSize: 12, color: '#2f6b34',
                    fontFamily: F, lineHeight: 1.6,
                  }}>
                    Previous invitation expired. A new invitation can be generated.
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
        </ConnectPanel>{/* end message type picker panel */}
        </div>{/* end left column */}

        {/* ═══════════════════════════════════════════════════════════════
            ZONE 3, Compose / Preview / Action
            Actual writing, preview, generated-link placement, and actions.
            Right column: fills remaining width.
        ════════════════════════════════════════════════════════════════ */}
        <div style={{ flex: '1 1 300px', minWidth: 260 }}>

          {/* Direct Message: subject + body editor + live preview + actions */}
          {outreachMode === 'message' && (
            <>
            <ConnectPanel tone="draft" title="Draft">

              {/* Subject input */}
              {/* Subject input - enabled for any loaded recipient (contact or student) */}
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

              {/* Body - rich editor when the Owner has opted in (flag), else the plain-text textarea. */}
              <div style={fieldWrap}>
                <label style={labelStyle}>Message</label>
                {richEnabled ? (
                  <RichTextEditor
                    html={msgBody}
                    richDocRef={richDocRef}
                    onChange={(html, json) => { setMsgBody(html); richDocRef.current = json || null }}
                    disabled={!dmHasAnyRecipient}
                    ariaLabel="Message"
                    minHeight={160}
                  />
                ) : (
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
                )}
                {/* CONNECT-DRAFT-AUTOSAVE-1: unobtrusive autosave status + explicit discard */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, minHeight: 18 }}>
                  <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, transition: 'opacity 0.2s' }}>
                    {draftStatus === 'saved' ? 'Draft saved'
                      : draftStatus === 'restored' ? 'Draft restored'
                      : draftStatus === 'discarded' ? 'Draft discarded'
                      : ''}
                  </span>
                  {dmHasAnyRecipient && (String(msgSubject).trim() || String(msgBody).trim()) && (
                    <button
                      type="button"
                      onClick={handleDiscardDraft}
                      style={{
                        marginLeft: 'auto', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        fontFamily: F, fontSize: 11, fontWeight: 600, color: '#9ca3af',
                      }}>
                      Discard draft
                    </button>
                  )}
                </div>
              </div>

              {/* CC field (CONNECT-COMMS-1D) - Direct Message only. Chips + free entry; the clinical
                  coordinator is pre-filled as a removable suggestion. Server is source of truth
                  (validates, dedupes, drops CC==To, caps at 5). */}
              <div style={fieldWrap}>
                <label style={labelStyle}>CC <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></label>
                <div style={{
                  position: 'relative',   // CONNECT-COMMS-1F: anchor for the autocomplete dropdown
                  display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
                  padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 8,
                  background: dmHasAnyRecipient ? '#fff' : '#f9fafb',
                }}>
                  {ccList.map((e) => {
                    const isCoord = ccAutoSuggested && coordEmail && e.toLowerCase() === coordEmail.toLowerCase()
                    return (
                      <span key={e} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 6px 3px 9px',
                        borderRadius: 14, fontSize: 11.5, fontFamily: F,
                        background: isCoord ? '#eef2ff' : '#f1efe9', color: '#374151',
                        border: `1px solid ${isCoord ? '#c7d2fe' : '#e5e7eb'}`,
                      }}>
                        {isCoord && <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#4338ca' }}>Clinical Coordinator ·</span>}
                        {e}
                        <button type="button" onClick={() => removeCcChip(e)} aria-label={`Remove ${e}`} style={{
                          border: 'none', background: 'transparent', cursor: 'pointer', color: '#9ca3af',
                          fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 1,
                        }}>×</button>
                      </span>
                    )
                  })}
                  {/* CONNECT-COMMS-1F: reusable contact typeahead. Suggestions augment - never replace -
                      manual entry; the server (resolveCcList) remains the source of truth. */}
                  <ContactAutocomplete
                    value={ccInput}
                    onChange={(v) => { setCcInput(v); setCcInputError(null) }}
                    disabled={!dmHasAnyRecipient}
                    maxReached={ccList.length >= 5}
                    placeholder={ccList.length ? 'Add another…' : 'Add CC email…'}
                    students={students}
                    coordinator={recipientType === 'student' && coordEmail && isValidEmail(coordEmail) ? { email: coordEmail, name: coordName } : null}
                    excludeEmails={ccExcludeSet}
                    onSelect={(r) => { if (addCcChip(r.email)) setCcInput('') }}
                    onCommitManual={(text) => { if (addCcChip(text)) setCcInput('') }}
                    onBackspaceEmpty={() => { if (ccList.length) removeCcChip(ccList[ccList.length - 1]) }}
                  />
                </div>
                {ccInputError && (
                  <div style={{ marginTop: 5, fontSize: 11, color: '#dc2626', fontFamily: F }}>{ccInputError}</div>
                )}
                {ccAutoSuggested && ccList.some(e => coordEmail && e.toLowerCase() === coordEmail.toLowerCase()) && (
                  <div style={{ marginTop: 5, fontSize: 11, color: '#6b7280', fontFamily: F }}>
                    Suggested from this student's clinical coordinator{coordName ? ` (${coordName})` : ''}. Remove if not needed.
                  </div>
                )}
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
                  Include my email signature
                </label>
              </div>

              {/* Action bar */}
              {(() => {
                const hasContactRecipient = !!(contactId && contactHasDisplayInfo && fromContact?.email)
                // CONNECT-COMMS-1B: gate on having ANY email; prefer school-first for consistency
                // with the canon (authoritative resolution + which-email-used happen server-side).
                const studentEmail = effectiveStudent?.school_email || fetchedStudent?.school_email
                                     || effectiveStudent?.personal_email || fetchedStudent?.personal_email
                                     || effectiveStudent?.email
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
                    {/* Drafts autosave automatically - no manual save button. */}
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
            </ConnectPanel>

            {/* CONNECT-COMMS-1B: branded "Email Preview" - exact server-rendered HTML from the same
                renderer/endpoint used to send, plus the server-resolved (school-first) recipient. */}
            <ConnectPanel tone="preview" title="Email Preview" style={{ marginTop: 14 }}>

                {/* Resolved recipient + source */}
                {dmPreview.recipient && (() => {
                  const c = dmSourceChip(dmPreview.recipient.type)
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '2px 0 10px' }}>
                      <span style={{ fontSize: 12, color: '#374151', fontFamily: F }}>
                        To: <strong>{dmPreview.recipient.email || '-'}</strong>
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                        textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: F,
                        background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
                        {c.label}
                      </span>
                      {dmPreview.recipient.warning && (
                        <span style={{ fontSize: 11, color: '#92400e', fontFamily: F }}>{dmPreview.recipient.warning}</span>
                      )}
                    </div>
                  )
                })()}

                {/* CC + signature source (CONNECT-COMMS-1D) */}
                {dmPreview.cc?.length > 0 && (
                  <div style={{ fontSize: 12, color: '#374151', fontFamily: F, margin: '0 0 8px' }}>
                    CC: <strong>{dmPreview.cc.join(', ')}</strong>
                  </div>
                )}
                {dmPreview.signature && (
                  <div style={{ fontSize: 11, color: dmPreview.signature.warning ? '#92400e' : '#6b7280', fontFamily: F, margin: '0 0 10px' }}>
                    Signature: <strong>{dmPreview.signature.display_name || '-'}</strong>
                    {dmPreview.signature.source && dmPreview.signature.source !== 'user' && (
                      <> · {dmPreview.signature.source === 'static' || dmPreview.signature.source === 'fallback'
                        ? 'using a fallback signature, set yours in Settings → Email Signature'
                        : `seeded (${dmPreview.signature.source})`}</>
                    )}
                  </div>
                )}

                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                  {dmPreview.loading ? (
                    <div style={{ padding: '24px 14px', fontSize: 12, color: '#9ca3af', fontFamily: F, textAlign: 'center' }}>Rendering preview…</div>
                  ) : dmPreview.error ? (
                    <div style={{ padding: '16px 14px', fontSize: 12, color: '#dc2626', fontFamily: F }}>{dmPreview.error}</div>
                  ) : dmPreview.html ? (
                    <iframe
                      title="Preview as sent"
                      srcDoc={dmPreview.html}
                      sandbox=""
                      referrerPolicy="no-referrer"
                      style={{ width: '100%', height: 520, border: 'none', background: '#fff', display: 'block' }}
                    />
                  ) : (
                    <div style={{ padding: '24px 14px', fontSize: 13, color: '#d1d5db', fontStyle: 'italic', fontFamily: F, textAlign: 'center' }}>
                      Start typing a message to see the branded email…
                    </div>
                  )}
                </div>
            </ConnectPanel>
            </>
          )}

          {/* Survey Invitation: email preview + generated link card
              Hidden for a contact recipient (State 2), the left column shows the guard. */}
          {outreachMode === 'survey' && !recipientIsContact && (
            <div>

              {/* Survey subject/message preview - Draft panel (lavender) */}
              <ConnectPanel tone="draft" title="Draft"
                style={surveyResult ? { border: '1px solid rgba(29,37,103,0.16)' } : undefined}>
                {/* Subject line - editable; this exact value is used by the preview and the actual send */}
                <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #f3f4f6' }}>
                  <span style={sectionLabel}>Subject</span>
                  <input
                    type="text"
                    value={surveyDraftSubject}
                    onChange={e => { setSurveyDraftSubject(e.target.value); setSurveyDraftEdited(true) }}
                    maxLength={200}
                    placeholder="ASPIRE: Casey-Fink Readiness Survey, Baseline"
                    style={{
                      width: '100%', boxSizing: 'border-box', marginTop: 4,
                      padding: '8px 10px', borderRadius: 7, border: '1px solid #e5e7eb',
                      fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.5,
                      background: '#fff', outline: 'none',
                    }}
                  />
                </div>

                {/* Body - editable intro/message; greeting, link, expiry, and signature are added automatically */}
                <div>
                  <span style={sectionLabel}>Message</span>
                  <div style={{ fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.8 }}>
                    {/* Greeting is system-controlled (not editable) */}
                    <p style={{ margin: '0 0 8px' }}>
                      Hi{' '}
                      {firstName
                        ? <strong>{firstName}</strong>
                        : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>[Student first name]</span>
                      },
                    </p>
                    <textarea
                      value={surveyDraftBody}
                      onChange={e => { setSurveyDraftBody(e.target.value); setSurveyDraftEdited(true) }}
                      maxLength={4000}
                      rows={5}
                      placeholder={SURVEY_DRAFT_DEFAULT_BODY}
                      style={{
                        width: '100%', boxSizing: 'border-box', margin: '0 0 12px',
                        padding: '10px 11px', borderRadius: 8, border: '1px solid #e5e7eb',
                        fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.7,
                        background: '#fff', outline: 'none', resize: 'vertical',
                      }}
                    />
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>
                      A “Complete Survey” button and the secure link are added automatically. This survey expires on <strong style={{ fontStyle: 'normal', color: '#6b7280' }}>{expiresFormatted}</strong>.
                    </p>

                    {/* Survey link - placeholder before generation, real URL shown once after.
                        The generated row carries an icon-only Copy control at the far right. */}
                    <p style={{ margin: '0 0 12px' }}>
                      {surveyResult ? (
                        <span style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 6px 5px 10px',
                          background: '#EEF7F0', border: '1px solid #c6d9a8', borderRadius: 6,
                          fontSize: 11, color: '#166534',
                          fontFamily: 'ui-monospace, monospace', lineHeight: 1.5,
                        }}>
                          <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', userSelect: 'text' }}>
                            {surveyResult.surveyUrl}
                          </span>
                          <button
                            onClick={handleCopy}
                            title="Copy survey link"
                            aria-label="Copy survey link"
                            style={{
                              flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
                              background: copied ? '#DCEFE2' : '#fff', border: '1px solid #c6d9a8',
                              color: copied ? '#2F7D5C' : '#166534', transition: 'background 0.15s',
                            }}
                          >
                            {copied ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                              </svg>
                            )}
                          </button>
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
                      ASPIRE
                    </p>
                  </div>
                </div>
              </ConnectPanel>

              {/* Generated link - inline action-required (warning) panel, shown after Generate Link */}
              {surveyResult && (
                <div style={{
                  marginTop: 14,
                  background: 'linear-gradient(160deg, #FDECEC 0%, #FEF6F6 55%, #ffffff 100%)',
                  border: '1px solid rgba(29,37,103,0.10)',
                  borderRadius: 12,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                  padding: 16,
                  fontFamily: F,
                }}>
                  {/* Warning header - circular warning icon + "Warning" */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
                    <span style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: '#FBDDDD', border: '1px solid #F3C9C9',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B42318" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: '#B42318', letterSpacing: '-0.01em', fontFamily: F }}>
                      Warning
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#9A2A22', fontFamily: F, lineHeight: 1.6, marginBottom: 12 }}>
                    ✓ Link is generated for <strong>{`${surveyResult.student?.firstName || ''} ${surveyResult.student?.lastName || ''}`.trim() || 'this student'}</strong>. This link will only be shown once. Copy it now before you leave this screen or send the form to {surveyResult.student?.firstName || 'the student'}.
                  </div>

                  {/* Two next-step actions */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <Tooltip label="Send a test survey email to your own inbox" placement="top">
                      <button
                        onClick={handleSingleTestSend}
                        disabled={singleTestSendState === 'sending'}
                        style={{
                          padding: '7px 13px', borderRadius: 8,
                          border: '1px solid #e5e7eb', fontFamily: F, fontSize: 11, fontWeight: 600,
                          background: singleTestSendState === 'sent' ? '#EEF2FB' : singleTestSendState === 'error' ? '#fef2f2' : '#fff',
                          color: singleTestSendState === 'sent' ? '#1D2567' : singleTestSendState === 'error' ? '#dc2626' : '#374151',
                          cursor: singleTestSendState === 'sending' ? 'not-allowed' : 'pointer',
                          transition: 'background 0.12s',
                        }}
                      >
                        {singleTestSendState === 'sending' ? '↑ Sending…'
                         : singleTestSendState === 'sent'   ? '✓ Test sent to me'
                         : singleTestSendState === 'error'  ? '✗ Test failed'
                         : '↑ Send test to me'}
                      </button>
                    </Tooltip>

                    {singleSendState === 'sent' ? (
                      <button disabled style={{ padding: '7px 13px', borderRadius: 8, border: '1px solid #c6d9a8', background: '#EEF7F0', fontSize: 11, fontWeight: 600, fontFamily: F, color: '#2F7D5C', cursor: 'not-allowed' }}>
                        ✓ Sent to student
                      </button>
                    ) : (
                      <button
                        onClick={() => { setSingleSendConfirmOpen(true); setSingleSendPhrase('') }}
                        disabled={singleSendInFlight}
                        style={{
                          padding: '7px 13px', borderRadius: 8, border: 'none',
                          background: singleSendInFlight ? '#e5e7eb' : '#1D2567',
                          fontSize: 11, fontWeight: 600, fontFamily: F,
                          color: singleSendInFlight ? '#9ca3af' : '#fff',
                          cursor: singleSendInFlight ? 'not-allowed' : 'pointer',
                          transition: 'opacity 0.12s',
                        }}
                        onMouseEnter={e => { if (!singleSendInFlight) e.currentTarget.style.opacity = '0.85' }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                      >
                        {singleSendInFlight ? 'Sending…' : 'Send to student'}
                      </button>
                    )}
                  </div>

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
              )}

              {/* Email Preview - the branded final survey email (below the Warning panel) */}
              {surveyResult && (
                <ConnectPanel tone="preview" title="Email Preview" style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, color: '#374151', fontFamily: F, margin: '2px 0 10px' }}>
                    To: <strong>{resolvedEmail || '-'}</strong>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                    {surveyPreviewHtml ? (
                      <iframe
                        title="Email Preview"
                        srcDoc={surveyPreviewHtml}
                        sandbox=""
                        referrerPolicy="no-referrer"
                        style={{ width: '100%', height: 520, border: 'none', background: '#fff', display: 'block' }}
                      />
                    ) : (
                      <div style={{ padding: '24px 14px', fontSize: 12, color: '#9ca3af', fontFamily: F, textAlign: 'center' }}>Preview unavailable.</div>
                    )}
                  </div>
                </ConnectPanel>
              )}

            </div>
          )}

        </div>

      </div>
      )}{/* end recipientMode === 'single' */}

      {/* ══════════════════════════════════════════════════════════════════
          BULK OPERATION MODE, Phase 3A active
          Calls /api/evaluation-bulk-invitations for generate_only.
          No email. No Resend. Generated surveyUrls live in React state only.
      ═══════════════════════════════════════════════════════════════════ */}
      {recipientMode === 'bulk' && bulkMsgType !== 'survey_invitation' && (
        <BulkManualComposer
          bulkMsgType={bulkMsgType}
          students={students}
          loadingStudents={loadingStudents}
          renderTypeSelector={renderBulkTypeSelector}
          userKey={userKey}
          cohortId={cohortId}
          richEnabled={richEnabled}
        />
      )}

      {recipientMode === 'bulk' && bulkMsgType === 'survey_invitation' && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>

          {/* ── Bulk Zone 1: Student Audience Picker ─────────────────── */}
          <ConnectPanel tone="audience" title="Audience"
            helper={loadingStudents ? 'Loading students…' : `${students.length} students in cohort`}
            style={{ flex: '0 0 340px', minWidth: 280, maxHeight: 'calc(100dvh - 280px)', overflowY: 'auto' }}>

            {/* Unified Audience Source tabs - Survey Invitation requires student recipients, so
                Students is active/required and Contacts / Paste · Type are disabled with a note. */}
            <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', marginBottom: 8 }}>
              <div style={{ flex: 1, padding: '7px 6px', fontSize: 11, fontWeight: 700, fontFamily: F, textAlign: 'center', color: '#1D2567', borderBottom: '2px solid #1D2567' }}>Students</div>
              <Tooltip label="The Student Casey-Fink Survey requires student recipients" placement="top">
                <div style={{ flex: 1, padding: '7px 6px', fontSize: 11, fontWeight: 600, fontFamily: F, textAlign: 'center', color: '#cbd5e1', borderBottom: '2px solid transparent', cursor: 'not-allowed' }}>Contacts</div>
              </Tooltip>
              <Tooltip label="The Student Casey-Fink Survey requires student recipients" placement="top">
                <div style={{ flex: 1, padding: '7px 6px', fontSize: 11, fontWeight: 600, fontFamily: F, textAlign: 'center', color: '#cbd5e1', borderBottom: '2px solid transparent', cursor: 'not-allowed' }}>Paste · Type</div>
              </Tooltip>
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginBottom: 12, lineHeight: 1.5 }}>
              Each survey link is unique to a student, so the Student Casey-Fink Survey sends to <strong>Students</strong> only.
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
                placeholder="Search name, personal/school email, or school…"
                style={{ ...inputBase, fontSize: 12, padding: '7px 10px', marginBottom: 6 }}
              />
              {/* School / Email source / Sort - shared layout with manual templates */}
              <div style={{ display: 'flex', gap: 6 }}>
                {bulkSchools.length > 1 && (
                  <select value={bulkFilterSchool} onChange={e => setBulkFilterSchool(e.target.value)}
                    style={{ ...inputBase, flex: 1, fontSize: 10, padding: '4px 6px' }}>
                    <option value="">All schools</option>
                    {bulkSchools.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                <select value={bulkFilterEmail} onChange={e => setBulkFilterEmail(e.target.value)}
                  style={{ ...inputBase, flex: 1, fontSize: 10, padding: '4px 6px' }}>
                  {EMAIL_SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select value={bulkSort} onChange={e => setBulkSort(e.target.value)}
                  style={{ ...inputBase, flex: 1, fontSize: 10, padding: '4px 6px' }}>
                  <option value="name">Alphabetically</option>
                  <option value="status">By Status</option>
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
                  const email       = studentEmailForSource(s, bulkFilterEmail)
                  const altEmail    = bulkFilterEmail === 'school' ? s.personal_email : s.school_email
                  const hasAssign   = !!bulkActiveAssignments[s.id]
                  const eligible    = !!email && !hasAssign
                  const isSelected  = bulkSelectedSet.has(s.id)
                  const badgeColor  = bulkFilterEmail === 'school' ? '#0e4e6e' : '#1D2567'
                  const badgeBg     = bulkFilterEmail === 'school' ? '#E1F3FB' : '#EEF2FB'
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
                        <div title={isValidEmail(altEmail) ? `Alternate: ${altEmail}` : undefined}
                          style={{ fontSize: 10, color: '#6b7280', fontFamily: F, marginTop: 1,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {email}
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: badgeBg, color: badgeColor, fontFamily: F }}>{emailTypeLabel(bulkFilterEmail)}</span>
                          {s.school && <span style={{ fontSize: 9, color: '#9ca3af', fontFamily: F }}>{s.school}</span>}
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                            background: '#f3f4f6', color: '#6b7280', fontFamily: F,
                          }}>{s.status}</span>
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
          </ConnectPanel>

          {/* ── Bulk Zone 2: Message Type + Workflow ──────────────────── */}
          <ConnectPanel tone="message" title="Message Type" helper="Bulk workflow" style={{ flex: '0 0 270px', minWidth: 220 }}>

            {/* Bulk message type selector (shared with the manual composer). This zone is the survey
                workflow, which is student-only, so the audience is always 'student'. */}
            {renderBulkTypeSelector(AUDIENCES.STUDENT)}

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
                    {BULK_CASEY_FINK_TIMEPOINTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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
          </ConnectPanel>

          {/* ── Bulk Zone 3: Preview / Action / Results ───────────────── */}
          <div style={{ flex: '1 1 300px', minWidth: 260 }}>

            {/* Pre-generation summary */}
            {!bulkResults && (
              <ConnectPanel tone="draft" icon="clipboardCheck" title="Bulk Student Casey-Fink Survey">
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
                  {/* Send via Resend - enabled when generated rows exist */}
                  {(() => {
                    const eligible = (bulkResults?.generated || []).filter(g => !bulkSentIds.has(g.assignmentId))
                    const allSent  = bulkResults?.generated?.length > 0 && eligible.length === 0
                    if (allSent) return (
                      <button disabled style={{ padding: '9px 16px', background: '#EEF7F0', border: '1px solid #c6d9a8', borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: F, color: '#2F7D5C', cursor: 'not-allowed' }}>
                        ✓ All sent
                      </button>
                    )
                    const hasGenerated = eligible.length > 0
                    if (!hasGenerated) return (
                      <Tooltip label="Generate links first, then send via Resend" placement="top">
                        <button disabled style={{ padding: '9px 16px', background: '#e5e7eb', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: F, color: '#9ca3af', cursor: 'not-allowed' }}>
                          Send via Resend
                        </button>
                      </Tooltip>
                    )
                    const label = bulkSentIds.size > 0 ? `Send remaining ${eligible.length}` : `Send ${eligible.length} via Resend`
                    return (
                      <button
                        onClick={() => { setBulkSendConfirmOpen(true); setBulkSendPhrase('') }}
                        style={{ padding: '9px 16px', background: '#1D2567', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, fontFamily: F, color: '#fff', cursor: 'pointer', transition: 'opacity 0.12s' }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                      >
                        {label}
                      </button>
                    )
                  })()}
                </div>
              </ConnectPanel>
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
                    {/* Session caveat */}
                    <div style={{ padding: '6px 12px', marginBottom: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 10, color: '#9ca3af', fontFamily: F }}>
                      Send status shown for this session only. Database audit is permanent.
                    </div>
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

                      {/* Send via Resend - visible in results row so it's accessible after generation */}
                      {(() => {
                        const eligibleInResults = (bulkResults.generated || []).filter(g => !bulkSentIds.has(g.assignmentId))
                        const allSentInResults  = bulkResults.generated?.length > 0 && eligibleInResults.length === 0
                        return (
                          <div style={{ marginBottom: 12, padding: '10px 12px', background: '#EEF2FB', border: '1px solid #c3cdf0', borderRadius: 8 }}>
                            <div style={{ fontSize: 11, color: '#1D2567', fontFamily: F, marginBottom: 8, lineHeight: 1.5 }}>
                              Use <strong>Send via Resend</strong> to email these survey links to students.
                              Use <strong>↑ Send test to me</strong> to preview the email in your own inbox.
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {allSentInResults ? (
                                <button disabled style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #c6d9a8', background: '#EEF7F0', fontSize: 12, fontWeight: 600, fontFamily: F, color: '#2F7D5C', cursor: 'not-allowed' }}>
                                  ✓ All sent via Resend
                                </button>
                              ) : eligibleInResults.length > 0 ? (
                                <button
                                  onClick={() => { setBulkSendConfirmOpen(true); setBulkSendPhrase('') }}
                                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1D2567', fontSize: 12, fontWeight: 600, fontFamily: F, color: '#fff', cursor: 'pointer', transition: 'opacity 0.12s' }}
                                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                                >
                                  {bulkSentIds.size > 0 ? `Send remaining ${eligibleInResults.length} via Resend` : `Send ${eligibleInResults.length} via Resend`}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        )
                      })()}

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
                                       : bulkTestSendState[g.assignmentId] === 'sent'   ? '✓ Test sent to me'
                                       : bulkTestSendState[g.assignmentId] === 'error'  ? '✗ Failed'
                                       : '↑ Send test to me'}
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
                                {/* Per-row bulk send status badge */}
                                {bulkSentIds.has(g.assignmentId) && (
                                  <div style={{ fontSize: 9, fontWeight: 700, color: '#2F7D5C', fontFamily: F, textAlign: 'right' }}>✓ Sent via Resend</div>
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
                          {bulkResults.skippedDuplicates.length} skipped, active assignment exists
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
                          {bulkResults.skippedMissingEmails.length} skipped, no email on file
                        </div>
                        {bulkResults.skippedMissingEmails.map(m => (
                          <div key={m.studentId} style={{ fontSize: 11, color: '#6b7280', fontFamily: F, marginBottom: 2 }}>
                            {m.studentName}{m.school ? ` · ${m.school}` : ''}, update student record to include.
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Skipped invalid status */}
                    {bulkResults.skippedInvalidStatus?.length > 0 && (
                      <div style={{ ...panelCard, marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', fontFamily: F, marginBottom: 8 }}>
                          {bulkResults.skippedInvalidStatus.length} skipped, status not eligible for this timepoint
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
                            {f.studentName}, {f.reason}
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

      {/* ══════════════════════════════════════════════════════════════════
          SENT HISTORY MODE, read-only outbound audit trail (Phase C.1)
      ═══════════════════════════════════════════════════════════════════ */}
      {recipientMode === 'history' && (
        <SentHistory />
      )}

      {/* ── Review Recipients Modal ───────────────────────────────────────── */}
      {/* ── Bulk Send via Resend confirmation modal (Phase 3B.2B) ─────────── */}
      {bulkSendConfirmOpen && (() => {
        const eligible = (bulkResults?.generated || []).filter(g => !bulkSentIds.has(g.assignmentId))
        const phraseMatch = bulkSendPhrase === 'SEND SURVEYS'
        return (
          <div onClick={() => { if (!bulkSendInFlight) { setBulkSendConfirmOpen(false); setBulkSendPhrase('') } }} style={{
            position: 'fixed', inset: 0, zIndex: 1001,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: '#fff', borderRadius: 12,
              padding: '28px 32px', maxWidth: 500, width: '90vw',
              maxHeight: '80vh', overflowY: 'auto',
              boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
              fontFamily: F, boxSizing: 'border-box',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#dc2626', fontFamily: F }}>Send Student Casey-Fink Surveys</h2>
                <button onClick={() => { if (!bulkSendInFlight) { setBulkSendConfirmOpen(false); setBulkSendPhrase('') } }}
                  disabled={bulkSendInFlight}
                  style={{ background: 'none', border: 'none', cursor: bulkSendInFlight ? 'not-allowed' : 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1, padding: '2px 6px' }}>×</button>
              </div>
              <div style={{ padding: '10px 14px', marginBottom: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#dc2626', fontFamily: F, lineHeight: 1.6, fontWeight: 600 }}>
                These are real emails to real students. They cannot be unsent.
              </div>
              <div style={{ marginBottom: 16, fontSize: 12, fontFamily: F, color: '#374151', lineHeight: 1.6 }}>
                <div><strong>Survey:</strong> Casey-Fink Readiness for Practice Survey</div>
                <div><strong>Timepoint:</strong> {TIMEPOINTS.find(t => t.value === bulkTimepoint)?.label || bulkTimepoint}</div>
                <div><strong>Expires:</strong> {fmtDate(bulkExpiresAt)}</div>
                <div><strong>Recipients:</strong> {eligible.length} student{eligible.length !== 1 ? 's' : ''}</div>
                {bulkSentIds.size > 0 && <div style={{ color: '#9ca3af' }}>({bulkSentIds.size} already sent this session, skipped)</div>}
                <div><strong>From:</strong> ASPIRE at Cedars-Sinai &lt;noreply@aspire-program.com&gt;</div>
                <div><strong>Reply-To:</strong> JesterLloyd.Bautista@cshs.org</div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', fontFamily: F, marginBottom: 6 }}>
                  Type <strong>SEND SURVEYS</strong> to confirm:
                </div>
                <input
                  type="text"
                  value={bulkSendPhrase}
                  onChange={e => setBulkSendPhrase(e.target.value)}
                  placeholder="SEND SURVEYS"
                  disabled={bulkSendInFlight}
                  style={{ ...inputBase, fontFamily: 'monospace', letterSpacing: '0.05em' }}
                  autoFocus
                />
              </div>
              {bulkSendResults?.error && (
                <div style={{ padding: '8px 12px', marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#dc2626', fontFamily: F }}>{bulkSendResults.error}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => { if (!bulkSendInFlight) { setBulkSendConfirmOpen(false); setBulkSendPhrase('') } }}
                  disabled={bulkSendInFlight}
                  style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, fontWeight: 600, fontFamily: F, color: '#374151', cursor: bulkSendInFlight ? 'not-allowed' : 'pointer' }}>
                  Cancel
                </button>
                <button type="button" onClick={handleBulkSendViaResend}
                  disabled={!phraseMatch || bulkSendInFlight || eligible.length === 0}
                  style={{
                    padding: '8px 20px', borderRadius: 8, border: 'none',
                    background: (!phraseMatch || bulkSendInFlight || !eligible.length) ? '#e5e7eb' : '#dc2626',
                    fontSize: 12, fontWeight: 600, fontFamily: F,
                    color: (!phraseMatch || bulkSendInFlight || !eligible.length) ? '#9ca3af' : '#fff',
                    cursor: (!phraseMatch || bulkSendInFlight || !eligible.length) ? 'not-allowed' : 'pointer',
                    transition: 'background 0.12s',
                  }}>
                  {bulkSendInFlight ? `Sending ${eligible.length}…` : `Send ${eligible.length} email${eligible.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Single-recipient survey: typed send confirmation modal ────────── */}
      {singleSendConfirmOpen && surveyResult && (
        <div onClick={() => { if (!singleSendInFlight) { setSingleSendConfirmOpen(false); setSingleSendPhrase('') } }} style={{
          position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 12, padding: '28px 32px', maxWidth: 480, width: '90vw',
            maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 8px 40px rgba(0,0,0,0.22)', fontFamily: F, boxSizing: 'border-box',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#dc2626', fontFamily: F }}>Send Student Casey-Fink Survey</h2>
              <button onClick={() => { if (!singleSendInFlight) { setSingleSendConfirmOpen(false); setSingleSendPhrase('') } }}
                disabled={singleSendInFlight}
                style={{ background: 'none', border: 'none', cursor: singleSendInFlight ? 'not-allowed' : 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1, padding: '2px 6px' }}>×</button>
            </div>
            <div style={{ padding: '9px 12px', marginBottom: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#dc2626', fontFamily: F, fontWeight: 600, lineHeight: 1.6 }}>
              This is a real email to a real student. It cannot be unsent.
            </div>
            <div style={{ marginBottom: 14, fontSize: 12, fontFamily: F, color: '#374151', lineHeight: 1.7 }}>
              <div><strong>Student:</strong> {surveyResult.student.firstName} {surveyResult.student.lastName}</div>
              <div><strong>Email:</strong> {surveyResult.student.email}</div>
              <div><strong>Timepoint:</strong> {BULK_CASEY_FINK_TIMEPOINTS.find(t => t.value === surveyResult.timepoint)?.label || surveyResult.timepoint}</div>
              <div><strong>Expires:</strong> {fmtDate(surveyResult.expiresAt?.split('T')[0])}</div>
              <div><strong>From:</strong> ASPIRE at Cedars-Sinai &lt;noreply@aspire-program.com&gt;</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', fontFamily: F, marginBottom: 6 }}>
                Type <strong>SEND SURVEYS</strong> to confirm:
              </div>
              <input
                type="text" value={singleSendPhrase} onChange={e => setSingleSendPhrase(e.target.value)}
                placeholder="SEND SURVEYS" disabled={singleSendInFlight} autoFocus
                style={{ ...inputBase, fontFamily: 'monospace', letterSpacing: '0.05em' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => { if (!singleSendInFlight) { setSingleSendConfirmOpen(false); setSingleSendPhrase('') } }}
                disabled={singleSendInFlight}
                style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, fontWeight: 600, fontFamily: F, color: '#374151', cursor: singleSendInFlight ? 'not-allowed' : 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={handleSingleSendViaResend}
                disabled={singleSendPhrase !== 'SEND SURVEYS' || singleSendInFlight}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: 'none',
                  background: singleSendPhrase !== 'SEND SURVEYS' || singleSendInFlight ? '#e5e7eb' : '#dc2626',
                  fontSize: 12, fontWeight: 600, fontFamily: F,
                  color: singleSendPhrase !== 'SEND SURVEYS' || singleSendInFlight ? '#9ca3af' : '#fff',
                  cursor: singleSendPhrase !== 'SEND SURVEYS' || singleSendInFlight ? 'not-allowed' : 'pointer',
                  transition: 'background 0.12s',
                }}>
                {singleSendInFlight ? 'Sending…' : 'Send email'}
              </button>
            </div>
          </div>
        </div>
      )}

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
      {/* Branded "Replace draft?" confirm - replaces the native window.confirm for template hydration. */}
      {replaceTemplateKey && (
        <div onClick={() => setReplaceTemplateKey(null)} style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Replace current draft" style={{
            background: '#fff', borderRadius: 12, padding: '24px 28px', maxWidth: 440, width: '90vw',
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)', fontFamily: F, boxSizing: 'border-box',
          }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#1D2567', fontFamily: F }}>
              Replace current draft?
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#475467', lineHeight: 1.55, fontFamily: F }}>
              This will replace the subject and message you are currently editing with the selected template. You can still customize the draft before sending.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button autoFocus onClick={() => setReplaceTemplateKey(null)} style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff',
                color: '#374151', fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={() => { const k = replaceTemplateKey; setReplaceTemplateKey(null); applyTemplate(k) }} style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid #1D2567', background: '#1D2567',
                color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'pointer',
              }}>Replace draft</button>
            </div>
          </div>
        </div>
      )}

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

            {/* Recipient + source - server-resolved (school-first for students). Fixes the prior
                gap where a student recipient's email did not appear in this modal. */}
            <div style={{ padding: '10px 14px', marginBottom: 14, background: '#EEF2FB', border: '1px solid #c3cdf0', borderRadius: 8 }}>
              {(() => {
                const r = dmPreview.recipient
                const name = r?.name || fromContact?.name || '-'
                const c = dmSourceChip(r?.type || (recipientType === 'contact' ? 'contact' : 'missing'))
                return (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1D2567', fontFamily: F }}>{name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 3 }}>
                      <span style={{ fontSize: 11, color: '#6b7280', fontFamily: F }}>
                        {r?.email || fromContact?.email || 'No email resolved'}
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                        textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: F,
                        background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
                        {c.label}
                      </span>
                    </div>
                    {r?.warning && (
                      <div style={{ fontSize: 11, color: '#92400e', fontFamily: F, marginTop: 4 }}>{r.warning}</div>
                    )}
                  </>
                )
              })()}
            </div>

            {/* CC + signature source (CONNECT-COMMS-1D) */}
            {dmPreview.cc?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: F, marginBottom: 4 }}>CC</div>
                <div style={{ fontSize: 12.5, color: '#374151', fontFamily: F, lineHeight: 1.5 }}>{dmPreview.cc.join(', ')}</div>
              </div>
            )}
            {dmPreview.signature && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: F, marginBottom: 4 }}>Signature</div>
                <div style={{ fontSize: 12.5, color: dmPreview.signature.warning ? '#92400e' : '#374151', fontFamily: F, lineHeight: 1.5 }}>
                  {includeSignature
                    ? <><strong>{dmPreview.signature.display_name || '-'}</strong>{dmPreview.signature.source && dmPreview.signature.source !== 'user' ? ((dmPreview.signature.source === 'static' || dmPreview.signature.source === 'fallback') ? ' · fallback (set yours in Settings → Email Signature)' : ` · seeded`) : ''}</>
                    : <span style={{ color: '#6b7280' }}>Omitted</span>}
                </div>
              </div>
            )}

            {/* Subject */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: F, marginBottom: 4 }}>Subject</div>
              <div style={{ fontSize: 13, color: '#374151', fontFamily: F, lineHeight: 1.5 }}>{msgSubject}</div>
            </div>

            {/* Preview as sent - exact branded HTML (same server renderer as send) */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: F, marginBottom: 4 }}>Preview as sent</div>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                {dmPreview.loading ? (
                  <div style={{ padding: '20px 12px', fontSize: 12, color: '#9ca3af', fontFamily: F, textAlign: 'center' }}>Rendering preview…</div>
                ) : dmPreview.error ? (
                  <div style={{ padding: '14px 12px', fontSize: 12, color: '#dc2626', fontFamily: F }}>{dmPreview.error}</div>
                ) : dmPreview.html ? (
                  <iframe
                    title="Preview as sent"
                    srcDoc={dmPreview.html}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    style={{ width: '100%', height: 360, border: 'none', background: '#fff', display: 'block' }}
                  />
                ) : (
                  <div style={{ padding: '20px 12px', fontSize: 12, color: '#9ca3af', fontFamily: F, textAlign: 'center' }}>Preview unavailable.</div>
                )}
              </div>
            </div>

            {/* CONNECT-COMMS-1B: block send if no valid recipient email resolved. */}
            {dmPreview.recipient?.type === 'missing' && (
              <div style={{ fontSize: 12, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontFamily: F }}>
                No valid email on file for this recipient, cannot send.
              </div>
            )}

            {/* Safety delay note */}
            {!dmConfirmReady && (
              <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, marginBottom: 10, textAlign: 'center' }}>
                Please review the details above before sending…
              </div>
            )}

            {/* Footer */}
            {(() => {
              const sendBlocked = !dmConfirmReady || dmSendInFlight || dmPreview.recipient?.type === 'missing'
              return (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button type="button" onClick={() => { if (!dmSendInFlight) setDmConfirmOpen(false) }}
                    disabled={dmSendInFlight}
                    style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, fontWeight: 600, fontFamily: F, color: '#374151', cursor: dmSendInFlight ? 'not-allowed' : 'pointer' }}>
                    Cancel
                  </button>
                  <button type="button" onClick={handleDmSend}
                    disabled={sendBlocked}
                    style={{
                      padding: '8px 20px', borderRadius: 8, border: 'none',
                      background: sendBlocked ? '#e5e7eb' : '#1D2567',
                      fontSize: 12, fontWeight: 600, fontFamily: F,
                      color: sendBlocked ? '#9ca3af' : '#fff',
                      cursor: sendBlocked ? 'not-allowed' : 'pointer',
                      transition: 'background 0.12s',
                    }}>
                    {dmSendInFlight ? 'Sending…' : 'Send'}
                  </button>
                </div>
              )
            })()}
          </div>
        </div>
      )}

    </div>
  )
}

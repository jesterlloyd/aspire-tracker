// src/components/connect/BulkManualComposer.jsx
//
// MANUAL-OUTREACH-TEMPLATE-LIBRARY - multi-source bulk audience composer for Send-to-Many manual
// templates. Three-panel layout:
//   1. Audience  - source selector (Students / Contacts / Paste · Type), all deduped into one set
//   2. Message Type - shared selector rendered by the parent (renderTypeSelector)
//   3. Draft / Preview / Review & send
//
// Phase 2B-3 (send wiring): the "Review & send" panel posts the selected recipients to the proven
// send endpoint (/api/connect-send-bulk-message, commit 9113dce) behind a typed-confirmation gate.
// The UI is the SECOND safety layer; the server is the floor (owner/admin auth + exact
// 'SEND MESSAGES' confirmation + UUID batch_id + 1–75 ceiling + per-recipient isolation +
// within-batch idempotency + one notification_log row per send). This component writes NO database
// rows itself, never touches message_archive, and never imports/calls the student routing resolver
// (the chosen email source is preserved). Survey Invitation is untouched (parent's own zones).
// Contacts are read with the table's existing RLS (no new endpoint/schema).

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import AttachmentPicker from './AttachmentPicker'
import { toSlugs, toDraftAttachments, fromDraftAttachments, sendBlockedReason } from '../../lib/connect/outreachAttachments'
import { CANONICAL_APP_URL } from '../../lib/appUrl'
import { isValidEmail } from '../../lib/notifications/studentRecipient'
import { getStudentPreferredFirstName } from '../../lib/studentNameFormatters'
import { normalizeEmailForLookup } from '../../lib/emailUtils'
import {
  parseRecipientText, applyMergeFields, firstNameFromName,
} from '../../lib/recipientParse'
import {
  buildCombinedRecipients, selectableShownStudentIds, visibleSelectionSplit,
  notProceedingRecipients, buildPayloadRecipients, NOT_PROCEEDING_STATUS,
} from '../../lib/connect/bulkAudience'
import { buildBulkTemplate } from '../../lib/outreachTemplates'
import { readLaunchContext, recordLaunchSendResults } from '../../lib/connect/launchContext'
import { getContactCategories, CONTACT_CATEGORY_ORDER } from '../../lib/contactCategories'
import {
  BULK_DEFAULT_SOURCE as DEFAULT_SOURCE,
  BULK_DEFAULT_CONTACT_CATEGORY as DEFAULT_CONTACT_CATEGORY,
  BULK_TEMPLATE_LABEL as TEMPLATE_LABEL,
  audienceForBulkSelection,
} from '../../lib/connect/templateRegistry'
import {
  emailTypeLabel, EMAIL_SOURCE_OPTIONS, studentEmailForSource, studentHasEmailSource,
} from '../../lib/studentBulkEmail'
import ContactAutocomplete from './ContactAutocomplete'
import ConnectPanel from './ConnectPanel'
import RichTextEditor from './RichTextEditor'
import { plainTextToHtml, htmlToPlainText } from '../../lib/connect/richCompose'

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

// ── Bulk draft autosave (CONNECT-DRAFT-AUTOSAVE-1 parity with Send-to-one) ─────────────────────────
// Mirrors the Send-to-one direct-draft pattern (OutreachView.jsx) so Send-to-many shows the same
// "Draft restored" / "Draft saved" status and an explicit "Discard draft" control. Persists ONLY
// { subject, body, includeSignature } to a SEPARATE, user-scoped key per message-type, so discarding
// a bulk draft never touches a Send-to-one draft (different key namespace). No tokens/preview HTML.
const BULK_DRAFT_VERSION    = 1
const BULK_DRAFT_DEBOUNCE_MS = 600
const bulkDraftKey = (userKey, cohortId, type) =>
  (userKey && type) ? `aspire.connect.outreach.bulkDraft.v${BULK_DRAFT_VERSION}.${userKey}.${cohortId || 'none'}.${type}` : null

function readBulkDraft(key) {
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || d.v !== BULK_DRAFT_VERSION) { localStorage.removeItem(key); return null }
    return d
  } catch { return null }
}

// The bulk composer is never blank - it starts from a message-type TEMPLATE. "Pristine" (the unedited
// template default) is the bulk analog of Send-to-one's "empty": no draft is persisted and the
// Discard control stays hidden until the user actually edits.
// The unedited template body for a type, in the shape the active composer holds: HTML in rich mode
// (RICH-COMPOSE-1), plain text otherwise. Pristine detection compares against this.
function bulkTemplateBody(type, rich) {
  const tpl = buildBulkTemplate(type)
  if (!tpl) return ''
  // ASPIRE-CONNECT-BULK-RICH-TEMPLATES-1: when rich compose is ON and this template ships a richBody
  // (Content Block HTML), hydrate the editor from it - the RichTextEditor parses the data-aspire-block
  // markers into Heading/Note blocks (same proven path as Send-to-one). Static-link tokens are still
  // substituted (a no-op when the template carries no token). Otherwise the plain body: HTML paragraphs
  // in rich mode, raw text in plain mode. Non-Owners never reach here with rich=true (Owner gate).
  if (rich && tpl.richBody) return withCohortToken(withStaticLinks(type, tpl.richBody))
  const plain = withCohortToken(withStaticLinks(type, tpl.body))
  return rich ? plainTextToHtml(plain) : plain
}
// The subject a fresh template load produces (cohort token resolved, matching bulkTemplateBody).
function bulkTemplateSubject(type) {
  const tpl = buildBulkTemplate(type)
  return tpl ? withCohortToken(tpl.subject) : ''
}
function bulkDraftIsPristine(type, subject, body, rich) {
  const tpl = buildBulkTemplate(type)
  if (!tpl) return !String(subject || '').trim() && !String(body || '').trim()
  return subject === bulkTemplateSubject(type) && body === bulkTemplateBody(type, rich)
}

// A persisted draft is worth restoring if the CONTENT was edited OR an audience was selected
// (selected students/contacts or pasted/typed chips). Tolerates legacy payloads (audience arrays
// absent) - those restore content only. Pure read of the parsed payload; no lookups.
function bulkDraftHasContent(type, d, rich) {
  if (!d) return false
  const contentEdited = !bulkDraftIsPristine(type, d.subject || '', d.body || '', rich)
  const audiencePicked =
    (Array.isArray(d.studentSel) && d.studentSel.length > 0) ||
    (Array.isArray(d.contactSel) && d.contactSel.length > 0) ||
    (Array.isArray(d.picked)     && d.picked.length     > 0)
  // OUTREACH-ATTACHMENTS-1: an attached file is a real edit, so a draft that
  // only adds attachments is still saved and restored.
  const hasAttachments = Array.isArray(d.attachments) && d.attachments.length > 0
  return contentEdited || audiencePicked || hasAttachments
}

// CONTACTS-CANON-1: derived from the shared canonical order.
const CONTACT_CATEGORIES = ['All', ...CONTACT_CATEGORY_ORDER]

// DEFAULT_SOURCE (per-template audience source) and DEFAULT_CONTACT_CATEGORY (per-template default
// category filter) now come from the shared template registry (CONNECT-TEMPLATE-REGISTRY-1) so the
// owner-approved mapping lives in one place. Imported above; values are unchanged.

const SOURCE_BADGE = {
  student: { label: 'Student', color: '#92400e', bg: '#FEF3C7', border: '#fde68a' },
  contact: { label: 'Contact', color: '#1D2567', bg: '#EEF2FB', border: '#c3cdf0' },
  manual:  { label: 'Manual',  color: '#3f3f46', bg: '#f4f4f5', border: '#e4e4e7' },
}

// ── Phase 2B-3 send wiring ──────────────────────────────────────────────────────
// The server (/api/connect-send-bulk-message, commit 9113dce) is the safety floor:
// owner/admin auth + exact 'SEND MESSAGES' confirmation + UUID batch_id + 1–75 ceiling.
// This UI is the SECOND safety layer (typed confirmation + gated/locked button).
const SEND_ENDPOINT  = '/api/connect-send-bulk-message'
const CONFIRM_PHRASE = 'SEND MESSAGES'
const MAX_RECIPIENTS = 75

// TEMPLATE_LABEL (audit-only label sent in the payload metadata) now comes from the shared template
// registry (imported above as BULK_TEMPLATE_LABEL); values are unchanged.

// Recipient-facing label for the chosen email source (shown in review before send).
function recipientSourceLabel(r) {
  if (r?.source === 'student') return emailTypeLabel(r.emailType)  // 'School email' | 'Personal email'
  if (r?.source === 'contact') return 'Contact'
  return 'Manual'
}

// App origin for static public links (browser origin, with the canonical domain as fallback).
const APP_ORIGIN = (typeof window !== 'undefined' && window.location && window.location.origin)
  ? window.location.origin
  : CANONICAL_APP_URL

// Static public-link substitutions per template. These are public, tokenless routes - never
// tokenized/secure links. Deadlines and other [placeholders] stay editable. Announcement keeps
// all of its placeholders (its unit/orientation details are intentionally hand-edited).
const STATIC_LINK_SUBS = {
  academic_partner_placement:   { token: '[Insert School Form Link]',       path: '/school-form' },
  student_profile_invitation:   { token: '[Insert Student Form Link]',      path: '/student-form' },
  student_interview_scheduling: { token: '[Insert Interview Schedule Link]', path: '/interview-schedule' },
  unit_capacity_response_request: { token: '[Insert Unit Form Link]',        path: '/unit-form' },
  unit_capacity_response_reminder: { token: '[Insert Unit Form Link]',       path: '/unit-form' },
}

// Replace a template's link placeholder with the full public URL (if one is defined for the key).
function withStaticLinks(key, body) {
  const sub = STATIC_LINK_SUBS[key]
  if (!sub) return body
  return String(body || '').split(sub.token).join(`${APP_ORIGIN}${sub.path}`)
}

// CAPACITY-RESPONSE-OUTREACH-2: '[Cohort]' always resolves at template-load time - the active launch
// context's cohort name when the composer was opened through a Send-and-confirm launch, else a neutral
// phrase - so cohort-aware templates never surface placeholder copy in the editor.
function withCohortToken(text) {
  const t = String(text || '')
  if (!t.includes('[Cohort]')) return t
  const ctx = readLaunchContext()
  const name = (ctx?.cohortName || '').trim() || 'the upcoming ASPIRE cohort'
  return t.split('[Cohort]').join(name)
}

// BULK-EXACT-RECIPIENTS-1: studentToRecipient/contactToRecipient and every other audience rule
// moved to src/lib/connect/bulkAudience.js so the model is pure, tested, and cannot drift from
// what this composer renders.

export default function BulkManualComposer({
  bulkMsgType,
  students = [],
  loadingStudents = false,
  renderTypeSelector,
  userKey = null,
  cohortId = null,
  richEnabled = false,
  // CAPACITY-RESPONSE-OUTREACH-2: one-shot audience preselection from a Send-and-confirm launch
  // ({ source, contactCategory?, contactEmails?, studentIds? }). Applied ONCE on the launched
  // template's first hydrate; manual type switches afterwards fall back to the registry defaults.
  initialAudience = null,
}) {
  // ── Audience state ────────────────────────────────────────────────────────
  const [source, setSource]               = useState(DEFAULT_SOURCE[bulkMsgType] || 'students')

  // Students source - search + filters + sort. NOTE: an assignment-status filter is intentionally
  // NOT offered here. The only assignment data wired into Outreach (bulkActiveAssignments) reflects
  // survey/evaluation assignments for the selected survey timepoint - not a real placement/rotation
  // assignment - so exposing it on manual templates would imply more than the data supports. It is
  // deferred until a true placement indicator is available in this view.
  const [studentSearch, setStudentSearch]   = useState('')
  const [studentSchool, setStudentSchool]   = useState('')
  const [studentEmailSrc, setStudentEmailSrc] = useState('school') // explicit recipient email source
  const [studentSort, setStudentSort]       = useState('name')     // name | status
  const [studentSel, setStudentSel]         = useState(() => new Set()) // student ids

  // Contacts source - `contacts` is null until the first load (drives derived loading state).
  const [contacts, setContacts]           = useState(null)
  const [contactSearch, setContactSearch] = useState('')
  const [contactCat, setContactCat]       = useState(DEFAULT_CONTACT_CATEGORY[bulkMsgType] || 'All')
  const [showInactive, setShowInactive]   = useState(false)
  const [contactSel, setContactSel]       = useState(() => new Set()) // contact ids

  // Paste / Type source - ONE unified recipient control (typeahead + paste).
  const [acInput, setAcInput]             = useState('')
  const [picked, setPicked]               = useState([])  // normalized recipients (chips)
  const [manualInvalids, setManualInvalids] = useState([]) // raw tokens that failed validation

  // Draft state
  const [subject, setSubject]             = useState('')
  const [body, setBody]                   = useState('')
  const [includeSignature, setIncludeSig] = useState(true)
  // OUTREACH-ATTACHMENTS-1: slugs + display text only.
  const [attachments, setAttachments] = useState([])
  // What actually went out, kept for the results panel after the composer clears.
  const [sentAttachments, setSentAttachments] = useState([])

  // Draft autosave UX (mirrors Send-to-one): draftStatus drives the small inline indicator
  // ('saved' | 'restored' | 'discarded' | null). Scoped per user + cohort + message-type.
  const BULK_DRAFT_KEY = bulkDraftKey(userKey, cohortId, bulkMsgType)
  const [draftStatus, setDraftStatus] = useState(null)
  const draftTimerRef       = useRef(null)
  const draftStatusTimerRef = useRef(null)
  const bulkHydratedRef     = useRef(false)
  // RICH-COMPOSE-2A-0: additive richDoc (TipTap JSON); preserved across flag toggles, never destroyed.
  const bulkRichDocRef      = useRef(null)
  const flashDraftStatus = useCallback((s) => {
    setDraftStatus(s)
    if (draftStatusTimerRef.current) clearTimeout(draftStatusTimerRef.current)
    draftStatusTimerRef.current = setTimeout(() => setDraftStatus(null), 2200)
  }, [])

  // BULK-EXACT-RECIPIENTS-1 audience-visibility state.
  // restoredAudience: how many recipients the last draft restore brought back. Drives a PERSISTENT
  // notice (not a 2-second flash) until the operator dismisses it, reviews, or clears - a restored
  // audience silently reaching a send is the exact mechanism of the 12-recipient incident.
  const [restoredAudience, setRestoredAudience] = useState(0)
  // trayOpen: the persistent selected-recipients tray, so every selection is inspectable from any
  // tab/filter view - hidden selections must never be invisible.
  const [trayOpen, setTrayOpen] = useState(false)
  // ackNotProceeding: Review-screen acknowledgment for individually included Not Proceeding
  // students. Reset whenever the review closes or the audience changes.
  const [ackNotProceeding, setAckNotProceeding] = useState(false)

  // Preview / Review
  const [reviewOpen, setReviewOpen]       = useState(false)
  // Branded "Preview as sent" - { html, loading, error } from the existing DM preview endpoint
  // (preview:true → no send, no log, no archive). Only for id-bearing sample recipients.
  const [preview, setPreview]             = useState({ html: '', attachments: [], loading: false, error: null })

  // ── Phase 2B-3 live send state ──────────────────────────────────────────────
  const [confirmText, setConfirmText]     = useState('')      // must equal CONFIRM_PHRASE exactly
  const [sending, setSending]             = useState(false)   // request in flight
  const [sendResult, setSendResult]       = useState(null)    // completed batch { batch_id, summary, sent, skipped, failed }
  const [sendError, setSendError]         = useState(null)    // request-level error (auth/confirmation/network)
  const sendInFlightRef = useRef(false)                       // synchronous double-click guard
  const sentSnapshotRef = useRef(null)                        // signature of the draft/audience that was sent

  // ── Hydrate draft + default source when the template changes ────────────────
  // React's endorsed "adjust state while rendering" pattern (no effect, no extra commit):
  // when bulkMsgType differs from the last hydrated key, reset the draft/source to that
  // template's defaults. The user's edits persist until they switch templates again.
  // One-shot launch preselection guards (CAPACITY-RESPONSE-OUTREACH-2). initialAudience is frozen by
  // OutreachView for the mount; it is honored ONLY on the FIRST hydrate (the launched template).
  // These refs are read/written exclusively inside effects (never during render).
  const launchDraftSkippedRef     = useRef(false)
  const launchContactsAppliedRef  = useRef(false)

  const [hydratedType, setHydratedType] = useState(null)
  if (hydratedType !== bulkMsgType) {
    // A launched entry applies its one-shot audience preselection (source / category / students) on
    // the first hydrate only; every later manual type switch uses the registry defaults.
    const ia = hydratedType === null ? initialAudience : null
    setHydratedType(bulkMsgType)
    const tpl = buildBulkTemplate(bulkMsgType)
    if (tpl) { setSubject(bulkTemplateSubject(bulkMsgType)); setBody(bulkTemplateBody(bulkMsgType, richEnabled)) }
    setIncludeSig(true)
    setSource(ia?.source || DEFAULT_SOURCE[bulkMsgType] || 'students')
    setContactCat(ia?.contactCategory || DEFAULT_CONTACT_CATEGORY[bulkMsgType] || 'All')
    // Per-type isolation: clear the audience selection on a type switch so one type's recipients
    // never bleed into another. The hydrate effect below restores THIS type's saved audience (if any).
    setStudentSel(new Set(Array.isArray(ia?.studentIds) ? ia.studentIds : []))
    setContactSel(new Set())
    setPicked([])
    setAcInput('')
    setManualInvalids([])
    setRestoredAudience(0)
    setAckNotProceeding(false)
    // OUTREACH-ATTACHMENTS-1: attachments are per message type. The hydrate
    // effect below restores THIS type's saved list, if it has one.
    setAttachments([])
  }

  // BULK-EXACT-RECIPIENTS-1: changing cohorts clears the audience. The students prop swaps to the
  // new cohort's roster, so any carried-over selection would be a mix of silently-dropped stale ids
  // and cohort-independent contacts/chips - never a reviewed audience. Same render-phase adjust
  // pattern as the type hydrate above. (The per-cohort draft for the NEW cohort may then restore
  // its own saved audience in the hydrate effect - announced via the restored-audience notice.)
  const [hydratedCohort, setHydratedCohort] = useState(cohortId)
  if (hydratedCohort !== cohortId) {
    setHydratedCohort(cohortId)
    setStudentSel(new Set())
    setContactSel(new Set())
    setPicked([])
    setAcInput('')
    setManualInvalids([])
    setRestoredAudience(0)
    setAckNotProceeding(false)
    setAttachments([])
  }

  // ── Draft hydrate (mirrors Send-to-one) ─────────────────────────────────────
  // After the render-phase block has set this type's template defaults, restore a saved bulk draft
  // for the same key (if present and genuinely edited) and flash "Draft restored". Defined BEFORE the
  // autosave effect so it runs first in the commit, and gates autosave via bulkHydratedRef until done.
  useEffect(() => {
    bulkHydratedRef.current = false
    bulkRichDocRef.current = null   // reset on type/key change; restored from the draft below if saved
    // A Send-and-confirm launch skips the saved-draft restore ONCE (the first hydrate is the launched
    // template): the launched defaults + audience preselection must stand exactly as prepared. The
    // draft for this type, if any, stays in storage untouched and restores normally on the next
    // non-launch visit or type switch.
    if (initialAudience && !launchDraftSkippedRef.current) {
      launchDraftSkippedRef.current = true
      bulkHydratedRef.current = true
      return
    }
    const d = readBulkDraft(BULK_DRAFT_KEY)
    if (bulkDraftHasContent(bulkMsgType, d, richEnabled)) {
      /* eslint-disable react-hooks/set-state-in-effect -- intentional synchronous restore, mirrors the Send-to-one hydrate */
      bulkRichDocRef.current = d.richDoc || null   // additive; preserved untouched while flag OFF
      setSubject(d.subject || '')
      // Restore body honoring draft bodyFormat vs the current flag (legacy/missing ⇒ text), converting
      // between text/html so the active composer (editor vs textarea) always gets the right shape.
      {
        const rawBody = d.body || ''
        const isHtmlDraft = d.bodyFormat === 'html'
        setBody(richEnabled
          ? (isHtmlDraft ? rawBody : plainTextToHtml(rawBody))
          : (isHtmlDraft ? htmlToPlainText(rawBody) : rawBody))
      }
      if (typeof d.includeSignature === 'boolean') setIncludeSig(d.includeSignature)
      // Audience selection (added in the audience-persistence hotfix). Legacy payloads omit these,
      // so each setter is guarded; stale ids are inert - the recipient derivation drops any id not
      // found in the current students/contacts data (studentToRecipient/contactToRecipient -> null).
      if (typeof d.source === 'string') setSource(d.source)
      if (typeof d.studentEmailSrc === 'string') setStudentEmailSrc(d.studentEmailSrc)
      if (Array.isArray(d.studentSel)) setStudentSel(new Set(d.studentSel))
      if (Array.isArray(d.contactSel)) setContactSel(new Set(d.contactSel))
      if (Array.isArray(d.picked))     setPicked(d.picked)
      // Only THIS cohort+type's attachments. Legacy drafts have no attachments
      // key and restore as an empty list.
      setAttachments(fromDraftAttachments(d))
      // BULK-EXACT-RECIPIENTS-1: a restored audience is never silent. The count feeds a persistent
      // notice in the Audience panel until the operator dismisses, reviews, or clears it.
      const restoredCount =
        (Array.isArray(d.studentSel) ? d.studentSel.length : 0) +
        (Array.isArray(d.contactSel) ? d.contactSel.length : 0) +
        (Array.isArray(d.picked)     ? d.picked.length     : 0)
      setRestoredAudience(restoredCount)
      flashDraftStatus('restored')
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    bulkHydratedRef.current = true
  }, [BULK_DRAFT_KEY]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced write + "Draft saved" indicator. Persists only a genuinely edited (non-pristine) draft;
  // a pristine (unedited template) state removes any stale key and shows nothing - mirroring the
  // Send-to-one debounce so a freshly-restored draft transitions "restored" -> "saved".
  useEffect(() => {
    if (!BULK_DRAFT_KEY || !bulkHydratedRef.current) return
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    // A draft is meaningful (worth persisting) if the content was edited OR an audience was chosen.
    // Selecting recipients counts; merely switching source/filters with no selection does not.
    const audienceEmpty = studentSel.size === 0 && contactSel.size === 0 && picked.length === 0
    // An attached file is a real edit: an otherwise untouched template WITH an
    // attachment must be saved, and removing the last one returns to pristine.
    const pristine = bulkDraftIsPristine(bulkMsgType, subject, body, richEnabled) && audienceEmpty && attachments.length === 0
    draftTimerRef.current = setTimeout(() => {
      try {
        if (pristine) {
          localStorage.removeItem(BULK_DRAFT_KEY)
        } else {
          localStorage.setItem(BULK_DRAFT_KEY, JSON.stringify({
            v: BULK_DRAFT_VERSION, savedAt: Date.now(),
            subject, body, includeSignature,
            bodyFormat: richEnabled ? 'html' : 'text',
            ...(bulkRichDocRef.current ? { richDoc: bulkRichDocRef.current } : {}),
            source, studentEmailSrc,
            studentSel: [...studentSel],
            contactSel: [...contactSel],
            picked,
            attachments: toDraftAttachments(attachments),
          }))
          flashDraftStatus('saved')
        }
      } catch { /* ignore quota / serialization errors */ }
    }, BULK_DRAFT_DEBOUNCE_MS)
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current) }
  }, [subject, body, includeSignature, source, studentEmailSrc, studentSel, contactSel, picked, attachments, BULK_DRAFT_KEY, bulkMsgType, richEnabled, flashDraftStatus])

  // Explicit discard: reset this message-type to its template default and clear the saved bulk draft
  // (this key only - Send-to-one drafts live under a different namespace and are untouched).
  const handleDiscardBulkDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    const tpl = buildBulkTemplate(bulkMsgType)
    if (tpl) { setSubject(tpl.subject); setBody(bulkTemplateBody(bulkMsgType, richEnabled)) }
    else { setSubject(''); setBody('') }
    bulkRichDocRef.current = null
    setIncludeSig(true)
    // Reset the audience/recipient selection back to the empty default for this type.
    setSource(DEFAULT_SOURCE[bulkMsgType] || 'students')
    setStudentSel(new Set())
    setContactSel(new Set())
    setPicked([])
    setAcInput('')
    setManualInvalids([])
    setRestoredAudience(0)
    setAckNotProceeding(false)
    setTrayOpen(false)
    setAttachments([])
    try { if (BULK_DRAFT_KEY) localStorage.removeItem(BULK_DRAFT_KEY) } catch { /* ignore */ }
    flashDraftStatus('discarded')
  }, [bulkMsgType, BULK_DRAFT_KEY, richEnabled, flashDraftStatus])

  // ── Load contacts when the Contacts source is opened OR any contact is selected ──
  // All setState lives in the async resolution (the endorsed effect pattern); loading is derived.
  // BULK-EXACT-RECIPIENTS-1: a restored draft can carry contactSel while the Contacts tab was never
  // opened. Without this eager load those selections resolve to nothing until the tab is opened -
  // and then the recipient count silently jumps. Selected contacts now always resolve immediately.
  const contactsRequested = useRef(false)
  useEffect(() => {
    if ((source !== 'contacts' && contactSel.size === 0) || contactsRequested.current) return
    contactsRequested.current = true
    supabase.from('contacts')
      .select('id, full_name, preferred_name, email, role, category, school_name, organization, unit_name, is_active')
      .order('full_name')
      .then(({ data }) => setContacts(data || []))
      .catch(() => setContacts([]))
  }, [source, contactSel])
  const loadingContacts = source === 'contacts' && contacts === null

  // CAPACITY-RESPONSE-OUTREACH-2: resolve a launch's preloaded recipient EMAILS to contact ids once
  // the lazy contacts load lands (identity by normalized email, never display label). One-shot: the
  // preselection applies exactly once whether or not every email matched; unmatched units simply stay
  // unselected for the Owner to review (they still appear in the return confirmation list).
  useEffect(() => {
    const wanted = initialAudience?.contactEmails
    if (launchContactsAppliedRef.current || !Array.isArray(wanted) || wanted.length === 0) return
    if (!Array.isArray(contacts)) return
    launchContactsAppliedRef.current = true
    const wantedSet = new Set(wanted.map(e => normalizeEmailForLookup(e)).filter(Boolean))
    const ids = contacts
      .filter(c => c?.email && c.is_active !== false && wantedSet.has(normalizeEmailForLookup(c.email)))
      .map(c => c.id)
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot launch preselection, applied when the lazy contacts load resolves (mirrors the draft hydrate pattern above) */
    if (ids.length) setContactSel(new Set(ids))
  }, [contacts, initialAudience])

  // ── Escape closes the review modal (never while a send is in flight) ─────────
  useEffect(() => {
    if (!reviewOpen) return
    const onKey = (e) => { if (e.key === 'Escape' && !sending) setReviewOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reviewOpen, sending])

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

  // ── Derived: combined deduped recipients (single source of truth in bulkAudience.js) ──
  const combined = useMemo(
    () => buildCombinedRecipients({ studentSel, contactSel, picked, students, contacts, emailSource: studentEmailSrc }),
    [studentSel, contactSel, picked, students, contacts, studentEmailSrc],
  )

  const recipients     = combined.recipients
  const dupCount       = combined.duplicateCount
  const invalidEntries = manualInvalids

  // BULK-EXACT-RECIPIENTS-1 derived visibility: how many selected recipients the CURRENT tab/filter
  // view is not showing, and which audience members need the Not Proceeding acknowledgment.
  const selectionSplit = useMemo(
    () => visibleSelectionSplit({ recipients, source, filteredStudents, filteredContacts, picked }),
    [recipients, source, filteredStudents, filteredContacts, picked],
  )
  const hiddenSelected = selectionSplit.hidden
  const notProceeding  = useMemo(() => notProceedingRecipients(recipients), [recipients])

  // Set of all chosen normalized emails - hides already-added rows from the typeahead.
  const excludeEmails = useMemo(() => new Set(recipients.map(r => r.normEmail)), [recipients])

  // The preview always renders the FIRST selected recipient (merge fields differ per recipient).
  // The Audience picker is the single source of truth - no second recipient control in the preview.
  const previewRecipient = recipients[0] || null

  // Order-independent signature of the current draft + audience (emails sorted) so harmless
  // recipient re-ordering from a refreshed `students` prop is not mistaken for an edit.
  // OUTREACH-ATTACHMENTS-1: the attachment set is part of what was reviewed, so
  // it belongs in the signature. Slugs stay in ORDER (unlike emails, which sort)
  // because order is what the recipient sees and what the server resolves. A
  // change here invalidates the completed-send context, the typed confirmation
  // and the Not Proceeding acknowledgment, so the next send needs a fresh,
  // intentional review - and the preview must re-resolve before Send re-enables.
  const draftSig = `${subject} ${body} ${recipients.map(r => r.normEmail).sort().join('|')} @${toSlugs(attachments).join('>')}`

  // ── Reset a COMPLETED batch once the draft or audience genuinely changes ─────
  // Runs in an effect (refs are safe here): on the first commit after a successful send it captures
  // the live signature; a later real edit to subject/body/audience clears the result + typed
  // confirmation so the next send is a fresh, intentional review with a fresh batch_id. (No re-send
  // from a stale completed state.) Using the LIVE post-commit signature avoids the stale-closure
  // mismatch that previously wiped the results panel immediately after a successful send.
  useEffect(() => {
    if (!sendResult) return
    if (sentSnapshotRef.current === null) {
      sentSnapshotRef.current = draftSig            // capture the signature the batch was sent for
    } else if (draftSig !== sentSnapshotRef.current) {
      sentSnapshotRef.current = null
      setSendResult(null)
      setConfirmText('')
    }
  }, [draftSig, sendResult])

  // ── Send gates (UI = second safety layer; server remains the floor) ──────────
  const overLimit       = recipients.length > MAX_RECIPIENTS
  const batchCompleted  = sendResult !== null
  const confirmOk       = confirmText === CONFIRM_PHRASE
  const needsNpAck = notProceeding.length > 0 && !ackNotProceeding
  // OUTREACH-ATTACHMENTS-1: with attachments selected, Send stays disabled until
  // the server has resolved EXACTLY that selection. A pending, stale, failed or
  // oversized resolution blocks the batch rather than sending an unverified list.
  const attachmentBlock = sendBlockedReason(attachments, preview.attachments, {
    previewError: preview.error, previewLoading: preview.loading,
  })
  const canSend = (
    recipients.length > 0 &&
    !overLimit &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    reviewOpen &&            // final review must be open
    confirmOk &&             // typed confirmation exact
    !needsNpAck &&           // Not Proceeding students require an explicit acknowledgment
    !sending &&              // not already sending
    !batchCompleted &&       // completed batch cannot be re-sent
    !attachmentBlock         // attachments must be server-resolved for THIS selection
  )

  // The acknowledgment never outlives its context: opening/closing the review or changing the
  // draft/audience resets it, so a checkbox ticked for one audience can never authorize a
  // different one. Render-phase adjust (same endorsed pattern as the type/cohort hydrates).
  const ackContext = `${reviewOpen}|${draftSig}`
  const [ackSeenContext, setAckSeenContext] = useState(ackContext)
  if (ackSeenContext !== ackContext) {
    setAckSeenContext(ackContext)
    if (ackNotProceeding) setAckNotProceeding(false)
    // OUTREACH-ATTACHMENTS-1: the typed confirmation authorises ONE reviewed
    // batch. draftSig now includes the ordered attachments, so changing them
    // while the review is open retracts the confirmation - the operator must
    // read the newly resolved attachment list and type it again.
    if (confirmText) setConfirmText('')
  }

  // ── Handlers ────────────────────────────────────────────────────────────────
  const toggleStudent = useCallback((id) => {
    setStudentSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const toggleContact = useCallback((id) => {
    setContactSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const selectAllStudents = useCallback(() => {
    // Every filtered student already has an email for the chosen source.
    // BULK-EXACT-RECIPIENTS-1: 'Select all shown' selects only currently displayed records and
    // never a Not Proceeding student (they stay individually selectable, acknowledged at Review).
    setStudentSel(prev => {
      const n = new Set(prev)
      selectableShownStudentIds(filteredStudents).forEach(id => n.add(id))
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
    setRestoredAudience(0); setAckNotProceeding(false); setTrayOpen(false)
  }, [])

  // Remove ONE recipient from wherever it is selected (tray/review). A recipient can exist in more
  // than one store (e.g. a typeahead-picked student chip AND a checkbox selection dedupe into one
  // row), so all three stores are cleaned by identity and normalized email.
  const removeRecipient = useCallback((r) => {
    if (r?.studentId) setStudentSel(prev => { const n = new Set(prev); n.delete(r.studentId); return n })
    if (r?.contactId) setContactSel(prev => { const n = new Set(prev); n.delete(r.contactId); return n })
    if (r?.normEmail) setPicked(prev => prev.filter(p => p.normEmail !== r.normEmail))
  }, [])

  const onTypeaheadSelect = useCallback((r) => {
    if (!r?.email || !isValidEmail(r.email)) return
    const normEmail = r.norm || normalizeEmailForLookup(r.email)
    const contactId = typeof r.key === 'string' && r.key.startsWith('contact:') ? r.key.slice('contact:'.length) : null
    const studentId = r.source === 'student' ? (r.raw?.id || null) : null
    const sourceKind = studentId ? 'student' : contactId ? 'contact' : 'manual'
    // For a student typeahead pick, honor the preferred first name from the full student record.
    const firstName = (sourceKind === 'student' && r.raw)
      ? getStudentPreferredFirstName(r.raw)
      : firstNameFromName(r.name)
    const rec = {
      email: r.email.trim(), normEmail, name: r.name || '',
      firstName, school: r.raw?.school || null,
      // Students carry their ASPIRE status so the Review screen can flag Not Proceeding
      // recipients no matter which source path added them.
      ...(sourceKind === 'student' ? { status: r.raw?.status || null } : {}),
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

  // ── Live bulk send (Phase 2B-3) ──────────────────────────────────────────────
  // Posts the CLIENT-SELECTED recipients (chosen email source preserved via emailType) to the
  // proven send endpoint. The endpoint performs canonical merge + all safety checks server-side.
  // resolveStudentCorrespondenceRecipient is NEVER imported or called - the chosen email is honored.
  const handleBulkSend = useCallback(async () => {
    // Synchronous double-click guard - set BEFORE any await so a rapid second click can't start a 2nd batch.
    if (sendInFlightRef.current) return
    // Re-validate every gate at click time (defense in depth; the button is also disabled).
    if (sendResult) return
    if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS) return
    if (!subject.trim() || !body.trim()) return
    if (confirmText !== CONFIRM_PHRASE) return
    if (notProceedingRecipients(recipients).length > 0 && !ackNotProceeding) return

    sendInFlightRef.current = true
    setSending(true)
    setSendError(null)

    const batch_id = crypto.randomUUID()
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setSendError('Session expired, refresh and try again.')
        return
      }
      // BULK-EXACT-RECIPIENTS-1: the payload is a pure projection of the reviewed audience -
      // exactly one entry per reviewed recipient, nothing added. emailType travels only for
      // students; status_ack only for Review-acknowledged Not Proceeding students (the server
      // rejects them without it).
      const payloadRecipients = buildPayloadRecipients(recipients, { ackNotProceeding })
      const res = await fetch(SEND_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          confirmation:      CONFIRM_PHRASE,
          batch_id,
          template_key:      bulkMsgType,
          template_label:    TEMPLATE_LABEL[bulkMsgType] || bulkMsgType,
          subject,
          body,
          body_format:       richEnabled ? 'html' : 'text',
          include_signature: includeSignature,
          attachment_slugs:  toSlugs(attachments),
          recipients:        payloadRecipients,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success) {
        // The reset effect captures the sent-signature on the next commit; a later edit clears it.
        setSendResult(data)
        // CAPACITY-RESPONSE-OUTREACH-2: record the REAL per-recipient outcome into the active launch
        // context (batch id + sent emails) so the At a Glance return confirmation can preselect what
        // was actually sent. Strictly scoped inside the lib: it no-ops unless an active launched
        // context matches this template key, so unrelated bulk sends never touch a foreign context.
        recordLaunchSendResults(bulkMsgType, data)
        // BULK-EXACT-RECIPIENTS-1: a completed batch clears ALL recipient-selection state in the
        // same commit, so a finished audience can never leak into the next send. The results panel
        // reads sendResult (not the live selection), so the outcome stays fully visible.
        // OUTREACH-ATTACHMENTS-1: snapshot the SERVER-RESOLVED attachments that
        // rode along BEFORE the composer is cleared, so the results panel keeps
        // telling the truth after the reset.
        setSentAttachments(preview.attachments?.length ? preview.attachments : [])
        clearAll()
        setAttachments([])
      } else {
        setSendError(data?.error || `Send failed (HTTP ${res.status}).`)
      }
    } catch {
      setSendError('Network error. Check your connection and try again.')
    } finally {
      setSending(false)
      sendInFlightRef.current = false
    }
  }, [recipients, subject, body, confirmText, sendResult, includeSignature, bulkMsgType, richEnabled, ackNotProceeding, clearAll])

  // ── Preview as sent ─────────────────────────────────────────────────────────
  // Merge fields (first name + school) for the selected sample recipient, then render the EXACT
  // branded email via the existing DM preview endpoint (preview:true → no send/log/archive).
  const previewSubject = previewRecipient ? applyMergeFields(subject, previewRecipient) : subject
  const previewBody    = previewRecipient ? applyMergeFields(body, previewRecipient) : body
  const previewRid     = previewRecipient?.studentId || previewRecipient?.contactId || null
  // Manual/raw pasted recipients have no UUID, so the direct-email preview can't render them. They
  // use the Phase 2B-1 preview-only endpoint (/api/connect-send-bulk-message) - preview only, no send.
  const isManualPreview = previewRecipient?.source === 'manual' && isValidEmail(previewRecipient?.email || '')

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      // id-bearing (student/contact) → direct-email preview; manual/raw → bulk-message preview endpoint.
      if ((!previewRid && !isManualPreview) || !body.trim()) { if (!cancelled) setPreview({ html: '', attachments: [], loading: false, error: null }); return }
      setPreview(p => ({ ...p, loading: true, error: null }))
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) { if (!cancelled) setPreview({ html: '', attachments: [], loading: false, error: 'Session expired, refresh to preview.' }); return }
        const url = previewRid ? '/api/connect-send-direct-email' : '/api/connect-send-bulk-message'
        // Direct-email renders the body as-given, so it gets the client-merged body. The bulk endpoint
        // performs its own canonical merge (with fallback), so it gets the RAW body + recipient.
        const payload = previewRid
          ? {
              preview:           true,
              recipient_type:    previewRecipient.studentId ? 'student' : 'contact',
              recipient_id:      previewRid,
              subject:           previewSubject,
              body:              previewBody,
              body_format:       richEnabled ? 'html' : 'text',
              include_signature: includeSignature,
              attachment_slugs:  toSlugs(attachments),
            }
          : {
              preview:           true,
              template_key:      bulkMsgType,
              subject,
              body,
              body_format:       richEnabled ? 'html' : 'text',
              include_signature: includeSignature,
              attachment_slugs:  toSlugs(attachments),
              recipient: {
                email:     previewRecipient.email,
                name:      previewRecipient.name,
                firstName: previewRecipient.firstName,
                school:    previewRecipient.school,
                source:    'manual',
              },
            }
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => null)
        if (cancelled) return
        if (res.ok && data?.success) setPreview({ html: data.html || '', attachments: Array.isArray(data.attachments) ? data.attachments : [], loading: false, error: null })
        else setPreview({ html: '', attachments: [], loading: false, error: data?.error || 'Preview unavailable.' })
      } catch { if (!cancelled) setPreview({ html: '', attachments: [], loading: false, error: 'Preview unavailable.' }) }
    }, 450)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [previewRid, isManualPreview, previewRecipient, previewSubject, previewBody, subject, body, includeSignature, bulkMsgType, richEnabled, attachments])

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

        {/* Combined count BELOW the source selector - consistent with Survey Invitation. */}
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

        {/* BULK-EXACT-RECIPIENTS-1: a restored audience is never silent. Persistent until the
            operator dismisses, reviews, or clears - this is the incident's root mechanism. */}
        {restoredAudience > 0 && recipients.length > 0 && (
          <div data-testid="restored-audience-notice" style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', marginBottom: 8,
            background: '#FBF5E8', border: '1px solid #f0c9b0', borderRadius: 8,
          }}>
            <div style={{ flex: 1, fontSize: 11, color: '#8B5E1A', fontFamily: F, lineHeight: 1.5 }}>
              <strong>{restoredAudience} recipient{restoredAudience === 1 ? '' : 's'} restored</strong> from
              your saved draft. Review the full list before sending.
            </div>
            <button onClick={() => { setTrayOpen(true); setRestoredAudience(0) }} style={{
              padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, flexShrink: 0,
              border: '1px solid #8B5E1A', background: '#fff', color: '#8B5E1A', fontFamily: F, cursor: 'pointer',
            }}>View all</button>
            <button onClick={clearAll} style={{
              padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, flexShrink: 0,
              border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontFamily: F, cursor: 'pointer',
            }}>Clear all</button>
          </div>
        )}

        {/* BULK-EXACT-RECIPIENTS-1: hidden selections are always counted, never silent. */}
        {hiddenSelected > 0 && (
          <div data-testid="hidden-selection-warning" style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', marginBottom: 8,
            background: '#FBF5E8', border: '1px solid #f0c9b0', borderRadius: 8,
          }}>
            <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: '#8B5E1A', fontFamily: F, lineHeight: 1.4 }}>
              {hiddenSelected} selected recipient{hiddenSelected === 1 ? ' is' : 's are'} not shown by the current view or filters.
            </span>
            <button onClick={() => setTrayOpen(o => !o)} style={{
              padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, flexShrink: 0,
              border: '1px solid #8B5E1A', background: trayOpen ? '#8B5E1A' : '#fff',
              color: trayOpen ? '#fff' : '#8B5E1A', fontFamily: F, cursor: 'pointer',
            }}>{trayOpen ? 'Hide all selected' : 'Show all selected'}</button>
          </div>
        )}

        {/* Persistent selected-recipients tray: every selection inspectable and removable from any
            tab/filter view. */}
        {trayOpen && recipients.length > 0 && (
          <div data-testid="selected-recipient-tray" style={{
            marginBottom: 8, padding: '8px 10px', background: '#fff',
            border: '1px solid #c3cdf0', borderRadius: 8, maxHeight: 220, overflowY: 'auto',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, fontFamily: F, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              All selected ({recipients.length})
            </div>
            {recipients.map(r => {
              const b = SOURCE_BADGE[r.source] || SOURCE_BADGE.manual
              const np = r.source === 'student' && String(r.status || '') === NOT_PROCEEDING_STATUS
              return (
                <div key={r.normEmail} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', borderBottom: '1px solid #f9fafb' }}>
                  <span style={{ fontSize: 8.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: b.bg, color: b.color, border: `1px solid ${b.border}`, textTransform: 'uppercase', flexShrink: 0 }}>{b.label}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#191919', fontFamily: F }}>{r.name || r.email}</span>
                    <span style={{ fontSize: 10, color: '#6b7280', fontFamily: F, marginLeft: 5 }}>{r.email}</span>
                    <div style={{ fontSize: 9, color: np ? '#9d174d' : '#9ca3af', fontFamily: F, fontWeight: np ? 700 : 400 }}>
                      {[r.school || r.organization, r.status].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button onClick={() => removeRecipient(r)} aria-label={`Remove ${r.email}`} style={{
                    border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer',
                    fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0,
                  }}>×</button>
                </div>
              )
            })}
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

        {/* ── Paste · Type source - ONE unified recipient control (chips + typeahead + paste) ── */}
        {source === 'paste' && (
          <div>
            <label style={{ ...labelStyle, fontSize: 11 }}>Search or paste recipients</label>
            {/* position:relative anchors the suggestion dropdown; the bordered box gives the input a
                defined surface and holds the chips inline, same pattern as Send to One's CC field. */}
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
      {/* CONNECT-TEMPLATE-AUDIENCE-UX-2: pass the audience inferred from THIS composer's live source +
          contact-category selection so the parent selector groups templates accordingly. */}
      <ConnectPanel tone="message" title="Message Type" helper="Bulk workflow" style={{ flex: '0 0 270px', minWidth: 220 }}>
        {renderTypeSelector?.(audienceForBulkSelection({ source, contactCategory: contactCat }))}
        <div style={{ marginTop: 12, padding: '8px 10px', background: '#FBF5E8', border: '1px solid #f0c9b0', borderRadius: 8, fontSize: 10, color: '#8B5E1A', fontFamily: F, lineHeight: 1.5 }}>
          Compose your audience and draft here, then open <strong>Review &amp; send</strong>. A typed confirmation is required before any email is sent.
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
            {richEnabled ? (
              // ASPIRE-CONNECT-BULK-RICH-TEMPLATES-1: key={bulkMsgType} remounts the editor on a template
              // switch so it initializes fresh from the new body HTML (parsing richBody Content Block
              // markers) rather than reusing a prior template's stale richDoc. Typing never changes
              // bulkMsgType, so there is no remount mid-edit.
              <RichTextEditor key={bulkMsgType} html={body} richDocRef={bulkRichDocRef} onChange={(html, json) => { setBody(html); bulkRichDocRef.current = json || null }} ariaLabel="Message" minHeight={240} />
            ) : (
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={14}
                style={{ ...inputBase, resize: 'vertical', lineHeight: 1.6, minHeight: 240, fontSize: 13 }} />
            )}
            {/* CONNECT-DRAFT-AUTOSAVE-1 parity: unobtrusive autosave status (bottom-left) + explicit
                discard (bottom-right), mirrors the Send-to-one composer. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, minHeight: 18 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: F, transition: 'opacity 0.2s' }}>
                {draftStatus === 'saved' ? 'Draft saved'
                  : draftStatus === 'restored' ? 'Draft restored'
                  : draftStatus === 'discarded' ? 'Draft discarded'
                  : ''}
              </span>
              {(!bulkDraftIsPristine(bulkMsgType, subject, body, richEnabled) || studentSel.size > 0 || contactSel.size > 0 || picked.length > 0) && (
                <button
                  type="button"
                  onClick={handleDiscardBulkDraft}
                  style={{
                    marginLeft: 'auto', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    fontFamily: F, fontSize: 11, fontWeight: 600, color: '#9ca3af',
                  }}>
                  Discard draft
                </button>
              )}
            </div>
          </div>
          {/* OUTREACH-ATTACHMENTS-1: the same files go to every recipient. */}
          <div style={{ marginBottom: 10 }}>
            <AttachmentPicker
              value={attachments}
              onChange={setAttachments}
              disabled={sending}
              resolvedSizes={Object.fromEntries((preview.attachments || []).map(a => [a.slug, a.size_bytes]))}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', fontFamily: F, cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={includeSignature} onChange={e => setIncludeSig(e.target.checked)} style={{ accentColor: NAVY }} />
            Include my email signature
          </label>
          <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, lineHeight: 1.5 }}>
            First name and school merge per recipient at send. All other [placeholders] (links, deadlines, dates, unit, preceptor) are edited once here and sent as-is.
          </div>
        </ConnectPanel>

        {/* Email Preview - tint on the shell; the branded email card inside stays white */}
        <ConnectPanel tone="preview" title="Email Preview" padding={24} style={{ marginTop: 14 }}>

          {recipients.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9ca3af', fontFamily: F, padding: '12px 0', textAlign: 'center' }}>
              Add recipients to preview the branded email.
            </div>
          ) : (
            <div>
              {/* Audience summary - the Audience picker is the only recipient control. */}
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

              {(previewRid || isManualPreview) ? (
                // Branded "Email Preview" - student/contact via the direct-email preview endpoint,
                // manual/raw via the Phase 2B-1 bulk-message preview endpoint. Preview only - no send.
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                  {preview.loading ? (
                    <div style={{ padding: '24px 14px', fontSize: 12, color: '#9ca3af', fontFamily: F, textAlign: 'center' }}>Rendering preview…</div>
                  ) : preview.error ? (
                    <div style={{ padding: '16px 14px', fontSize: 12, color: '#dc2626', fontFamily: F }}>{preview.error}</div>
                  ) : preview.html ? (
                    <iframe
                      title="Email Preview"
                      srcDoc={preview.html}
                      sandbox=""
                      referrerPolicy="no-referrer"
                      style={{ width: '100%', height: 520, border: 'none', background: '#fff', display: 'block' }}
                    />
                  ) : (
                    <div style={{ padding: '24px 14px', fontSize: 13, color: '#d1d5db', fontStyle: 'italic', fontFamily: F, textAlign: 'center' }}>
                      Add subject and message content to see the branded email…
                    </div>
                  )}
                </div>
              ) : (
                // Fallback (e.g. a recipient without a usable email) - merged text only.
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#191919', fontFamily: F, marginBottom: 6 }}>{previewSubject}</div>
                    <div style={{ fontSize: 12, color: '#374151', fontFamily: F, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto' }}>
                      {previewBody}
                    </div>
                  </div>
                </div>
              )}
              <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 8, lineHeight: 1.5 }}>
                Preview reflects one selected recipient. First name and school merge per recipient at send.
              </div>
            </div>
          )}
        </ConnectPanel>

        {/* Action row - Review & send opens the final review panel (the only path to a live send) */}
        <div style={{ ...panelCard, marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {(() => {
            const reviewReady = recipients.length > 0 && subject.trim() && body.trim()
            return (
              <button onClick={() => setReviewOpen(true)} disabled={!reviewReady} style={{
                padding: '9px 18px', borderRadius: 8, border: 'none',
                background: reviewReady ? NAVY : '#e5e7eb', color: reviewReady ? '#fff' : '#9ca3af',
                fontSize: 13, fontWeight: 600, fontFamily: F, cursor: reviewReady ? 'pointer' : 'not-allowed',
              }}>Review &amp; send ({recipients.length})</button>
            )
          })()}
          <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: F }}>
            {recipients.length === 0 ? 'Add recipients to continue.'
              : !subject.trim() ? 'Add a subject to continue.'
              : !body.trim() ? 'Add a message to continue.'
              : 'A typed confirmation is required in the next step.'}
          </span>
        </div>
      </div>

      {/* ── Final Review & Send panel (the only path to a live send) ─────────── */}
      {reviewOpen && (
        <div onClick={() => { if (!sending) setReviewOpen(false) }} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={{
            background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560, maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', fontFamily: F,
          }}>
            {/* Header */}
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #f3f4f6' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: NAVY, fontFamily: F }}>
                {sendResult ? 'Send results' : 'Review & send'}
              </h2>
              <div style={{ fontSize: 12, color: '#6b7280', fontFamily: F, marginTop: 4 }}>
                {sendResult ? (
                  <>
                    {`${sendResult.summary?.total ?? 0} recipient${(sendResult.summary?.total ?? 0) === 1 ? '' : 's'} in this batch`}
                    {/* Snapshot of what actually went out - survives the composer reset. */}
                    {sentAttachments.length > 0 && (
                      <div data-testid="sent-result-attachments" style={{ marginTop: 6, color: '#374151' }}>
                        📎 Sent with {sentAttachments.length} attachment{sentAttachments.length === 1 ? '' : 's'}:{' '}
                        {sentAttachments.map(a => `${a.filename} (${a.size_label})`).join(', ')}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {recipients.length} recipient{recipients.length === 1 ? '' : 's'} total (deduped)
                    {dupCount > 0 && ` · ${dupCount} duplicate${dupCount === 1 ? '' : 's'} removed`}
                    {invalidEntries.length > 0 && ` · ${invalidEntries.length} invalid ignored`}
                    {hiddenSelected > 0 && ` · ${hiddenSelected} not visible in the current audience view`}
                    {attachments.length > 0 && (
                      <div data-testid="review-attachments" style={{ marginTop: 8, color: '#374151' }}>
                        {attachmentBlock ? (
                          <div data-testid="review-attachments-blocked"
                            style={{ color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px' }}>
                            {attachmentBlock}
                          </div>
                        ) : (
                          <>
                            <div style={{ fontWeight: 600 }}>
                              📎 Every recipient also receives {preview.attachments.length} attachment
                              {preview.attachments.length === 1 ? '' : 's'}
                            </div>
                            {preview.attachments.map(a => (
                              <div key={a.slug} style={{ marginTop: 2 }}>
                                {a.filename} · {a.content_type} · {a.size_label}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: '12px 22px', overflowY: 'auto', flex: 1 }}>
              {sendResult ? (
                // ── RESULTS ── partial success must be visually unmistakable
                (() => {
                  const s = sendResult.summary || { total: 0, sent: 0, skipped: 0, failed: 0 }
                  const banner = s.failed > 0
                    ? { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c', text: `${s.failed} failed · ${s.skipped} skipped · ${s.sent} sent` }
                    : s.skipped > 0
                      ? { bg: '#FBF5E8', border: '#f0c9b0', color: '#8B5E1A', text: `${s.skipped} skipped · ${s.sent} sent` }
                      : { bg: '#EEF7F0', border: '#c6d9a8', color: '#2F7D5C', text: `All ${s.sent} sent` }
                  const bucket = (title, rows, tone) => rows.length === 0 ? null : (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: tone.color, fontFamily: F, marginBottom: 4 }}>{title} ({rows.length})</div>
                      {rows.map((row, i) => (
                        <div key={`${row.email || 'r'}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 8px', borderRadius: 6, background: tone.bg, border: `1px solid ${tone.border}`, marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: '#374151', fontFamily: F, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.email || '-'}</span>
                          {row.reason && <span style={{ fontSize: 10, fontWeight: 700, color: tone.color, fontFamily: F, flexShrink: 0 }}>{String(row.reason).replace(/_/g, ' ')}</span>}
                        </div>
                      ))}
                    </div>
                  )
                  return (
                    <div>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                        {[['Total', s.total, '#6b7280', '#f3f4f6'], ['Sent', s.sent, '#2F7D5C', '#EEF7F0'], ['Skipped', s.skipped, '#8B5E1A', '#FBF5E8'], ['Failed', s.failed, '#b91c1c', '#fef2f2']].map(([lbl, n, col, bg]) => (
                          <span key={lbl} style={{ fontSize: 11, fontWeight: 700, color: col, background: bg, padding: '4px 10px', borderRadius: 999, fontFamily: F }}>{lbl}: {n}</span>
                        ))}
                      </div>
                      <div style={{ padding: '10px 12px', borderRadius: 8, background: banner.bg, border: `1px solid ${banner.border}`, color: banner.color, fontSize: 12, fontWeight: 700, fontFamily: F, marginBottom: 14 }}>
                        {banner.text}
                      </div>
                      {bucket('Sent',    sendResult.sent    || [], { color: '#2F7D5C', bg: '#F4FAF6', border: '#dcefe2' })}
                      {bucket('Skipped', sendResult.skipped || [], { color: '#8B5E1A', bg: '#FDF8EE', border: '#f0e2c6' })}
                      {bucket('Failed',  sendResult.failed  || [], { color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' })}
                      <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 4, wordBreak: 'break-all' }}>Batch ID: {sendResult.batch_id}</div>
                    </div>
                  )
                })()
              ) : (
                // ── PRE-SEND REVIEW ──
                <div>
                  {overLimit && (
                    <div style={{ marginBottom: 12, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 11.5, color: '#b91c1c', fontFamily: F, lineHeight: 1.5 }}>
                      Selected <strong>{recipients.length}</strong> exceeds the <strong>{MAX_RECIPIENTS}</strong>-recipient limit for a single send. Remove {recipients.length - MAX_RECIPIENTS} to continue.
                    </div>
                  )}
                  <div style={{ marginBottom: 12, padding: '10px 12px', background: '#f9fafb', border: '1px solid #eef0f4', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F }}>Subject</div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#191919', fontFamily: F, marginBottom: 8 }}>{subject || <span style={{ color: '#9ca3af', fontWeight: 400 }}>-</span>}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F }}>Message</div>
                    <div style={{ fontSize: 12, color: '#374151', fontFamily: F, lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto', marginTop: 2 }}>{body}</div>
                    <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: F, marginTop: 6 }}>First name and school merge per recipient at send.</div>
                  </div>
                  {/* BULK-EXACT-RECIPIENTS-1: Not Proceeding students never send silently - each is
                      flagged on its row AND the send stays locked until explicitly acknowledged. */}
                  {notProceeding.length > 0 && (
                    <div data-testid="not-proceeding-warning" style={{ marginBottom: 12, padding: '10px 12px', background: '#fdf2f8', border: '1px solid #fbcfe8', borderRadius: 8 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#9d174d', fontFamily: F, marginBottom: 4 }}>
                        {notProceeding.length} recipient{notProceeding.length === 1 ? '' : 's'} with status Not Proceeding
                      </div>
                      <div style={{ fontSize: 11, color: '#9d174d', fontFamily: F, lineHeight: 1.5, marginBottom: 8 }}>
                        {notProceeding.map(r => r.name || r.email).join(', ')}
                      </div>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: '#9d174d', fontFamily: F, cursor: 'pointer', fontWeight: 600 }}>
                        <input
                          type="checkbox"
                          checked={ackNotProceeding}
                          onChange={e => setAckNotProceeding(e.target.checked)}
                          style={{ marginTop: 1, accentColor: '#9d174d' }}
                        />
                        I intend to include {notProceeding.length === 1 ? 'this Not Proceeding student' : 'these Not Proceeding students'} in this send.
                      </label>
                    </div>
                  )}
                  {recipients.map(r => {
                    const b = SOURCE_BADGE[r.source] || SOURCE_BADGE.manual
                    const np = r.source === 'student' && String(r.status || '') === NOT_PROCEEDING_STATUS
                    return (
                      <div key={r.normEmail} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 6px', borderBottom: '1px solid #f9fafb', borderRadius: 6, background: np ? '#fdf2f8' : 'transparent' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: b.bg, color: b.color, border: `1px solid ${b.border}`, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>{b.label}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#191919', fontFamily: F }}>{r.name || <span style={{ color: '#9ca3af', fontWeight: 400 }}>-</span>}</div>
                          <div style={{ fontSize: 11, color: '#6b7280', fontFamily: F, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.email}</div>
                          {(r.school || r.organization || r.status) && (
                            <div style={{ fontSize: 10, color: np ? '#9d174d' : '#9ca3af', fontFamily: F, fontWeight: np ? 700 : 400, marginTop: 1 }}>
                              {[r.school || r.organization, r.status].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: 10, color: '#6b7280', fontFamily: F, flexShrink: 0 }}>{recipientSourceLabel(r)}</span>
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
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '14px 22px', borderTop: '1px solid #f3f4f6' }}>
              {sendResult ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => setReviewOpen(false)} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: NAVY, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'pointer' }}>Done</button>
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, color: '#374151', fontFamily: F, marginBottom: 5 }}>
                    Type <strong style={{ color: NAVY, letterSpacing: '0.03em' }}>{CONFIRM_PHRASE}</strong> to enable sending
                  </label>
                  <input
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    disabled={sending}
                    placeholder={CONFIRM_PHRASE}
                    autoComplete="off"
                    style={{ ...inputBase, marginBottom: 10, borderColor: confirmOk ? '#2F7D5C' : '#e5e7eb' }}
                  />
                  {sendError && (
                    <div style={{ marginBottom: 10, padding: '8px 11px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 11.5, color: '#b91c1c', fontFamily: F }}>{sendError}</div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <button onClick={() => { if (!sending) setReviewOpen(false) }} disabled={sending} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontSize: 13, fontWeight: 600, fontFamily: F, cursor: sending ? 'not-allowed' : 'pointer' }}>Cancel</button>
                    <button
                      onClick={handleBulkSend}
                      disabled={!canSend}
                      title={overLimit ? `Over the ${MAX_RECIPIENTS}-recipient limit`
                        : needsNpAck ? 'Acknowledge the Not Proceeding recipients above to enable'
                        : !confirmOk ? `Type ${CONFIRM_PHRASE} to enable` : undefined}
                      style={{
                        padding: '8px 18px', borderRadius: 8, border: 'none',
                        background: canSend ? '#B42318' : '#e5e7eb', color: canSend ? '#fff' : '#9ca3af',
                        fontSize: 13, fontWeight: 700, fontFamily: F, cursor: canSend ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {sending ? `Sending ${recipients.length}…` : `Send to ${recipients.length}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
